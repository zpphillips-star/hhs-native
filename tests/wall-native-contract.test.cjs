'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..');
const projectRequire = createRequire(path.join(project, 'package.json'));
const ts = projectRequire('typescript');
const OWNER = 'owner-a';
const NOW = 1_800_000_000_000;
const KEY = `hhs:wall-pending:v1:${OWNER}`;
const ORIGIN = 'https://wall-api.invalid';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourcePaths = {
  auth: path.join(project, 'src', 'lib', 'nativeApiAuth.ts'),
  service: path.join(project, 'src', 'features', 'wall', 'wallPostService.ts'),
  coordinator: path.join(project, 'src', 'features', 'wall', 'wallSubmission.ts'),
  beer: path.join(project, 'src', 'features', 'beers', 'beerService.ts'),
};
const compiled = new Map(Object.values(sourcePaths).map((filename) => [
  filename,
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText,
]));

function response(status, json) {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function picked(overrides = {}) {
  return {
    uri: 'file:///picked-0',
    mimeType: 'image/png',
    fileName: 'misleading.jpg',
    mediaType: 'image',
    fileSize: 999_999,
    durationMs: null,
    ...overrides,
  };
}

function draft(overrides = {}) {
  return { content: '  A native Wall post  ', beerId: 'beer-1', media: [picked()], ...overrides };
}

// Only allowlisted real TS modules execute. Every external dependency, including
// fetch, is fake; the test loader never falls through to a native/network module.
function harness(options = {}) {
  const storage = options.storage || new Map();
  const events = [];
  const uploads = [];
  const requests = [];
  const dbReads = [];
  const dbWrites = [];
  const alerts = [];
  let nextUuid = 0;
  let setCount = 0;
  const state = {
    storage, events, uploads, requests, dbReads, dbWrites, alerts,
    assets: [],
    session: { user: { id: OWNER }, access_token: 'original-token', expires_at: NOW / 1000 + 3600 },
    refreshedSession: { user: { id: OWNER }, access_token: 'refreshed-token', expires_at: NOW / 1000 + 3600 },
    refreshCalls: 0,
    get: async () => response(200, {
      ok: true,
      capabilities: { atomic_wall_post: 1, idempotency_key: 1, ordered_media: 1 },
    }),
    post: async () => response(201, { ok: true, post: { id: 'post-1' }, id: 'post-1' }),
    readMedia: async () => new Uint8Array(153).buffer,
    failSetAt: options.failSetAt,
  };
  const asyncStorage = {
    async getItem(key) { events.push(['getItem', key]); return storage.get(key) ?? null; },
    async setItem(key, value) {
      events.push(['setItem', key, value]);
      if (++setCount === state.failSetAt) throw new Error('Persistence unavailable');
      storage.set(key, value);
    },
    async removeItem(key) { events.push(['removeItem', key]); storage.delete(key); },
  };
  const supabase = {
    auth: {
      async getSession() { return { data: { session: state.session }, error: null }; },
      async refreshSession() {
        state.refreshCalls++;
        state.session = state.refreshedSession;
        return { data: { session: state.session }, error: null };
      },
    },
    storage: {
      from(bucket) {
        return {
          async upload(storagePath, body, uploadOptions) {
            uploads.push({ bucket, path: storagePath, body, options: uploadOptions });
            events.push(['upload', storagePath]);
            return { error: null };
          },
          getPublicUrl(storagePath) { return { data: { publicUrl: `https://storage.invalid/${bucket}/${storagePath}` } }; },
        };
      },
    },
    from(table) {
      // A table probe would succeed, but must never authorize legacy writes.
      const query = {
        select() { dbReads.push(table); return query; },
        limit() { return query; },
        eq() { return query; },
        single() { return query; },
        insert(value) { dbWrites.push({ table, value }); return query; },
        upsert(value) { dbWrites.push({ table, value }); return query; },
        then(resolve, reject) { return Promise.resolve({ data: [{ id: 'legacy-post' }], error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
  const fakes = new Map([
    ['expo-modules-core', { uuid: { v4: () => `00000000-0000-4000-8000-${(++nextUuid).toString(16).padStart(12, '0')}` } }],
    ['@react-native-async-storage/async-storage', asyncStorage],
    ['react-native', { Platform: { OS: 'android' }, Alert: { alert: (...args) => alerts.push(args) } }],
    ['expo-image-picker', {
      requestCameraPermissionsAsync: async () => ({ granted: true }),
      requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async () => ({ canceled: false, assets: state.assets }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: state.assets }),
    }],
    [path.join(project, 'src', 'lib', 'supabase.ts'), { supabase }],
    [path.join(project, 'src', 'config', 'env.ts'), { HHS_WEB_ORIGIN: ORIGIN }],
  ]);
  class FixedDate extends Date { static now() { return NOW; } }
  const context = vm.createContext({
    Error, TypeError, ArrayBuffer, Uint8Array, AbortController, Date: FixedDate,
    setTimeout(callback, ms) {
      if (ms <= 250) { queueMicrotask(callback); return undefined; }
      return setTimeout(callback, ms);
    },
    clearTimeout,
    async fetch(url, init = {}) {
      if (typeof url === 'string' && url.startsWith('file:///')) {
        events.push(['readMedia', url]);
        return { ok: true, status: 200, arrayBuffer: () => state.readMedia(url) };
      }
      assert.equal(url, `${ORIGIN}/api/wall/post`, 'unexpected fake network URL');
      const method = init.method || 'GET';
      const record = { method, headers: { ...init.headers }, body: init.body };
      requests.push(record);
      events.push([method, record]);
      if (method === 'GET') return state.get(record);
      assert.equal(method, 'POST', 'unexpected network method');
      return state.post(record);
    },
  });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    assert.ok(compiled.has(filename), `Unallowlisted source module: ${filename}`);
    const module = { exports: {} };
    modules.set(filename, module);
    const localRequire = (specifier) => {
      if (fakes.has(specifier)) return fakes.get(specifier);
      assert.ok(specifier.startsWith('.'), `Unfaked dependency: ${specifier}`);
      const resolved = path.resolve(path.dirname(filename), `${specifier}.ts`);
      if (fakes.has(resolved)) return fakes.get(resolved);
      return load(resolved);
    };
    const execute = new vm.Script(`(function(require,module,exports){\n${compiled.get(filename)}\n})`, { filename }).runInContext(context);
    execute(localRequire, module, module.exports);
    return module.exports;
  }
  state.auth = load(sourcePaths.auth);
  state.service = load(sourcePaths.service);
  state.coordinator = load(sourcePaths.coordinator);
  state.beer = load(sourcePaths.beer);
  state.reloadCoordinator = () => {
    modules.delete(sourcePaths.coordinator);
    state.coordinator = load(sourcePaths.coordinator);
    return state.coordinator;
  };
  state.posts = () => requests.filter((item) => item.method === 'POST');
  state.pending = () => storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null;
  return state;
}

test('concurrent same-type uploads at the same time use unique UUID paths and MIME extensions', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    h.service.uploadPostMedia(OWNER, picked({ uri: `file:///same-time-${i}`, fileName: 'same.mp4' }))));
  assert.equal(new Set(results.map((item) => item.storagePath)).size, 12);
  for (const item of results) {
    assert.match(item.storagePath.slice(`${OWNER}/`.length, -4), UUID);
    assert.ok(item.storagePath.startsWith(`${OWNER}/`));
    assert.ok(item.storagePath.endsWith('.png'));
    assert.equal(item.mediaSizeBytes, 153, 'actual byteLength, not picker fileSize');
  }
  for (const upload of h.uploads) {
    assert.equal(upload.body.byteLength, 153);
    assert.equal(upload.bucket, 'post-photos');
    assert.equal(upload.options.contentType, 'image/png');
    assert.equal(upload.options.upsert, false);
  }
});

for (const [mimeType, ext] of Object.entries({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
})) {
  test(`supported ${mimeType} remains truthful from picker through upload`, async () => {
    const h = harness();
    const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';
    h.assets = [{ uri: 'file:///truthful', type: mediaType, mimeType: mimeType.toUpperCase(), fileName: 'wrong.bin', fileSize: 1, duration: 1234 }];
    const selected = await h.service.pickWallMedia(mediaType === 'video' ? 'video-library' : 'photo-library');
    assert.equal(selected.length, 1);
    assert.equal(selected[0].mimeType, mimeType);
    const uploaded = await h.service.uploadPostMedia(OWNER, selected[0]);
    assert.equal(uploaded.mimeType, mimeType);
    assert.ok(uploaded.storagePath.endsWith(`.${ext}`));
    assert.equal(uploaded.mediaSizeBytes, 153);
    assert.equal(uploaded.videoDurationMs, mediaType === 'video' ? 1234 : null);
    assert.equal(h.uploads[0].options.contentType, mimeType);
    assert.equal(h.alerts.length, 0);
  });
}

for (const mimeType of ['image/heic', 'image/avif', 'application/octet-stream', '', undefined, 'toString', 'video/mp4']) {
  test(`unsupported/missing/mismatched MIME ${String(mimeType)} is rejected, never relabeled`, async () => {
    const h = harness();
    h.assets = [{ uri: 'file:///unsupported', type: 'image', mimeType, fileName: 'plausible.jpg' }];
    const selected = await h.service.pickWallMedia('photo-library');
    assert.equal(selected.length, 0);
    assert.match(h.alerts[0][1], /Unsupported Wall media MIME type/);
    assert.match(h.alerts[0][1], /No format conversion was verified/);
    await assert.rejects(h.service.uploadPostMedia(OWNER, picked({ mimeType: mimeType || '' })), /Unsupported/);
    assert.equal(h.uploads.length, 0);
    assert.equal(h.events.filter(([event]) => event === 'readMedia').length, 0);
  });
}

test('video actual bytes over 50 MiB are blocked despite a tiny picker size', async () => {
  const h = harness();
  h.readMedia = async () => new ArrayBuffer(50 * 1024 * 1024 + 1);
  await assert.rejects(h.service.uploadPostMedia(OWNER, picked({
    mediaType: 'video', mimeType: 'video/mp4', fileSize: 1,
  })), /50 MB/);
  assert.equal(h.uploads.length, 0);
});

test('video actual bytes at 50 MiB are accepted and measured exactly', async () => {
  const h = harness();
  h.readMedia = async () => new ArrayBuffer(50 * 1024 * 1024);
  const uploaded = await h.service.uploadPostMedia(OWNER, picked({
    mediaType: 'video', mimeType: 'video/mp4', fileSize: null, durationMs: 90_000,
  }));
  assert.equal(uploaded.mediaSizeBytes, 50 * 1024 * 1024);
  assert.equal(uploaded.videoDurationMs, 90_000);
  assert.equal(h.uploads.length, 1);
});

test('empty actual media and overlong videos are blocked', async () => {
  const h = harness();
  h.readMedia = async () => new ArrayBuffer(0);
  await assert.rejects(h.service.uploadPostMedia(OWNER, picked()), /empty/);
  await assert.rejects(h.service.uploadPostMedia(OWNER, picked({
    mediaType: 'video', mimeType: 'video/mp4', durationMs: 90_001,
  })), /90 seconds/);
  assert.equal(h.uploads.length, 0);
});

for (const media of [[], [picked()], [picked(), picked({ uri: 'file:///second' })]]) {
  test(`GET without capabilities blocks ${media.length}-attachment submission even with available tables`, async () => {
    const h = harness();
    h.get = async () => response(200, { ok: true });
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft({ media })), /capability handshake/);
    assert.deepEqual(h.requests.map((item) => item.method), ['GET']);
    assert.equal(h.uploads.length, 0);
    assert.equal(h.dbReads.length, 0);
    assert.equal(h.dbWrites.length, 0);
    assert.equal(h.storage.size, 0);
  });
}

for (const phase of ['GET', 'POST']) {
  for (const failure of ['network', 'non-JSON 500']) {
    test(`${phase} ${failure} never falls back to DB writes`, async () => {
      const h = harness();
      h[phase === 'GET' ? 'get' : 'post'] = async () => {
        if (failure === 'network') throw new Error('Network lost');
        return response(500, '<html>Proxy failure</html>');
      };
      await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()));
      assert.equal(h.dbWrites.length, 0);
      assert.equal(h.dbReads.length, 0);
      assert.equal(h.uploads.length, phase === 'GET' ? 0 : 1);
      assert.equal(h.posts().length, phase === 'GET' ? 0 : 1);
      if (phase === 'POST') {
        assert.equal(h.pending().attempted, true);
        assert.equal(h.pending().body, h.posts()[0].body);
      }
    });
  }
}

test('201 {ok:true,post,id} confirms ID, frozen body, headers and durable-before-POST ordering', async () => {
  const h = harness();
  h.post = async (request) => {
    assert.equal(h.pending().attempted, true);
    assert.equal(h.pending().body, request.body);
    return response(201, { ok: true, post: { id: 'created-201' }, id: 'created-201' });
  };
  assert.equal(await h.coordinator.submitWallPost(OWNER, draft()), 'created-201');
  assert.equal(h.pending(), null);
  assert.equal(h.posts().length, 1);
  const request = h.posts()[0];
  const body = JSON.parse(request.body);
  assert.match(body.request_id, UUID);
  assert.equal(request.headers['Idempotency-Key'], body.request_id);
  assert.equal(request.headers.Authorization, 'Bearer original-token');
  assert.equal(request.headers['Content-Type'], 'application/json');
  const postIndex = h.events.findIndex(([event]) => event === 'POST');
  const persisted = h.events.slice(0, postIndex).filter(([event]) => event === 'setItem').map(([, , raw]) => JSON.parse(raw));
  assert.deepEqual(persisted.map((item) => item.attempted), [false, true]);
  assert.ok(persisted.every((item) => item.body === request.body));
});

test('full actual 153-item payload preserves selection order and compatibility metadata despite reversed uploads', async () => {
  const h = harness();
  const gates = Array.from({ length: 153 }, deferred);
  const readsStarted = deferred();
  let reads = 0;
  h.readMedia = (uri) => {
    const index = Number(uri.split('-').at(-1));
    if (++reads === gates.length) readsStarted.resolve();
    return gates[index].promise;
  };
  const media = gates.map((_, i) => picked({
    uri: `file:///ordered-${i}`,
    mediaType: i % 2 ? 'image' : 'video',
    mimeType: i % 2 ? 'image/png' : 'video/mp4',
    durationMs: i % 2 ? null : 1000 + i,
    fileSize: 1,
  }));
  const submission = h.coordinator.submitWallPost(OWNER, draft({ media }));
  await readsStarted.promise;
  // Let the VM adopt every host promise before deliberately reversing completion.
  await new Promise(setImmediate);
  for (let i = gates.length - 1; i >= 0; i--) gates[i].resolve(new ArrayBuffer(153 + i));
  await submission;
  assert.equal(h.uploads.length, 153);
  assert.ok(h.uploads[0].path.endsWith('000000000099.mp4'), 'completion order was reversed');
  const request = h.posts()[0];
  const body = JSON.parse(request.body);
  assert.equal(body.media.length, 153);
  assert.equal(body.content, 'A native Wall post');
  assert.equal(body.user_id, OWNER);
  assert.equal(body.beer_id, 'beer-1');
  for (let i = 0; i < 153; i++) {
    const ext = i % 2 ? 'png' : 'mp4';
    const storagePath = `${OWNER}/00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}.${ext}`;
    assert.deepEqual(body.media[i], {
      media_url: `https://storage.invalid/post-photos/${storagePath}`,
      media_type: media[i].mediaType,
      mime_type: media[i].mimeType,
      storage_bucket: 'post-photos',
      storage_path: storagePath,
      duration_ms: media[i].durationMs,
      thumbnail_url: null,
      sort_order: i,
    });
  }
  assert.equal(body.photo_url, body.media[0].media_url);
  assert.equal(body.media_url, body.media[0].media_url);
  assert.equal(body.media_type, 'video');
  assert.equal(body.thumbnail_url, null);
  assert.equal(body.media_size_bytes, 153);
  assert.equal(body.video_duration_ms, 1000);
  assert.match(body.request_id, UUID);
  assert.equal(request.headers['Idempotency-Key'], body.request_id);
  assert.equal(h.dbWrites.length, 0);
});

test('repeated submit and explicit manual retry preserve identical body/key without reupload', async () => {
  const h = harness();
  h.post = async () => { throw new Error('Response lost after possible commit'); };
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /original submission is saved/);
  const frozen = h.pending().body;
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /original submission is saved/);
  await assert.rejects(h.coordinator.retryPendingWallPost(OWNER), /original submission is saved/);
  h.post = async () => response(201, { ok: true, id: 'recovered', post: { id: 'recovered' } });
  assert.equal(await h.coordinator.retryPendingWallPost(OWNER), 'recovered');
  assert.equal(h.uploads.length, 1);
  assert.equal(h.posts().length, 4);
  assert.ok(h.posts().every((item) => item.body === frozen));
  assert.equal(new Set(h.posts().map((item) => item.headers['Idempotency-Key'])).size, 1);
  assert.equal(h.pending(), null);
  assert.equal(await h.coordinator.retryPendingWallPost(OWNER), null);
  assert.equal(h.posts().length, 4);
});

test('simultaneous identical submissions and recovery share the exact promise', async () => {
  const h = harness();
  const gate = deferred();
  h.readMedia = () => gate.promise;
  const first = h.coordinator.submitWallPost(OWNER, draft());
  const second = h.coordinator.submitWallPost(OWNER, draft());
  const recovery = h.coordinator.retryPendingWallPost(OWNER);
  assert.strictEqual(first, second);
  assert.strictEqual(first, recovery);
  gate.resolve(new ArrayBuffer(153));
  assert.deepEqual(await Promise.all([first, second, recovery]), ['post-1', 'post-1', 'post-1']);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.posts().length, 1);
});

test('different simultaneous draft is blocked without uploading or posting it', async () => {
  const h = harness();
  const gate = deferred();
  h.readMedia = () => gate.promise;
  const first = h.coordinator.submitWallPost(OWNER, draft());
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft({ content: 'different' })), /Another Wall submission/);
  gate.resolve(new ArrayBuffer(153));
  await first;
  assert.equal(h.uploads.length, 1);
  assert.equal(h.posts().length, 1);
  assert.equal(JSON.parse(h.posts()[0].body).content, 'A native Wall post');
});

test('draft snapshot is captured before caller mutation during upload', async () => {
  const h = harness();
  const gate = deferred();
  h.readMedia = () => gate.promise;
  const input = draft();
  const submission = h.coordinator.submitWallPost(OWNER, input);
  input.content = 'edited';
  input.beerId = 'edited-beer';
  input.media[0].mimeType = 'image/gif';
  input.media.push(picked({ uri: 'file:///added' }));
  gate.resolve(new ArrayBuffer(153));
  await submission;
  const body = JSON.parse(h.posts()[0].body);
  assert.equal(body.content, 'A native Wall post');
  assert.equal(body.beer_id, 'beer-1');
  assert.equal(body.media.length, 1);
  assert.equal(body.media[0].mime_type, 'image/png');
});

test('restart reloads real coordinator against shared AsyncStorage and keeps exact body/key', async () => {
  const sharedStorage = new Map();
  const first = harness({ storage: sharedStorage });
  first.post = async () => { throw new Error('Process lost response'); };
  await assert.rejects(first.coordinator.submitWallPost(OWNER, draft()));
  const original = first.posts()[0];
  const restarted = harness({ storage: sharedStorage });
  const oldCoordinator = restarted.coordinator;
  assert.notStrictEqual(restarted.reloadCoordinator(), oldCoordinator);
  assert.equal(await restarted.coordinator.retryPendingWallPost(OWNER), 'post-1');
  assert.equal(restarted.posts()[0].body, original.body);
  assert.equal(restarted.posts()[0].headers['Idempotency-Key'], original.headers['Idempotency-Key']);
  assert.equal(restarted.uploads.length, 0);
  assert.equal(sharedStorage.size, 0);
});

for (const [label, change] of [
  ['content', { content: 'corrected' }],
  ['beer', { beerId: 'different-beer' }],
  ['media', { media: [picked({ uri: 'file:///edited' })] }],
]) {
  test(`edited ${label} cannot replace a pending draft`, async () => {
    const h = harness();
    h.post = async () => { throw new Error('Ambiguous'); };
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()));
    const saved = h.storage.get(KEY);
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft(change)), /edited draft has not been sent/);
    assert.equal(h.storage.get(KEY), saved);
    assert.equal(h.posts().length, 1);
    assert.equal(h.uploads.length, 1);
  });
}

test('first-attempt explicit 400 committed:false releases draft for correction with a new key', async () => {
  const h = harness();
  h.post = async () => response(400, { committed: false, error: 'Correct your draft' });
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /Nothing was published/);
  assert.equal(h.pending(), null);
  const firstKey = h.posts()[0].headers['Idempotency-Key'];
  h.post = async () => response(201, { ok: true, id: 'corrected', post: { id: 'corrected' } });
  assert.equal(await h.coordinator.submitWallPost(OWNER, draft({ content: 'corrected' })), 'corrected');
  const corrected = h.posts()[1];
  assert.notEqual(corrected.headers['Idempotency-Key'], firstKey);
  assert.match(corrected.headers['Idempotency-Key'], UUID);
  assert.equal(JSON.parse(corrected.body).content, 'corrected');
});

for (const [status, body] of [
  [400, { error: 'No explicit noncommit proof' }],
  [401, '<html>Proxy authentication</html>'],
  [403, { error: 'Forbidden' }],
  [404, { error: 'Not found', committed: false }],
  [408, { error: 'Timeout', committed: false }],
  [409, { error: 'Conflict', committed: false }],
  [422, { committed: false }],
  [429, { error: 'Rate limited', committed: false }],
  [500, { error: 'Server failure', committed: false }],
  [503, { error: 'Unavailable' }],
]) {
  test(`arbitrary ${status} without reliable first-attempt noncommit proof retains frozen submission`, async () => {
    const h = harness();
    h.post = async () => response(status, body);
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /original submission is saved/);
    assert.equal(h.pending().attempted, true);
    assert.equal(h.pending().body, h.posts()[0].body);
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft({ content: 'changed' })), /edited draft/);
    assert.equal(h.posts().length, 1);
    assert.equal(h.dbWrites.length, 0);
  });
}

for (const status of [400, 401, 403, 413, 415, 422]) {
  test(`previously ambiguous attempt followed by explicit ${status} cannot clear pending`, async () => {
    const h = harness();
    h.post = async () => { throw new Error('Connection lost'); };
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()));
    const frozen = h.pending().body;
    h.post = async () => response(status, { error: 'Rejected retry', committed: false });
    await assert.rejects(h.coordinator.retryPendingWallPost(OWNER), /original submission is saved/);
    assert.equal(h.pending().body, frozen);
    assert.equal(h.pending().attempted, true);
    assert.ok(h.posts().every((item) => item.body === frozen));
    assert.equal(h.uploads.length, 1);
  });
}

for (const failSetAt of [1, 2]) {
  test(`persistence failure on write ${failSetAt} blocks POST`, async () => {
    const h = harness({ failSetAt });
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /Persistence unavailable/);
    assert.equal(h.posts().length, 0);
    assert.equal(h.dbWrites.length, 0);
    if (failSetAt === 2) {
      const frozen = h.pending().body;
      assert.equal(h.pending().attempted, false);
      h.failSetAt = undefined;
      assert.equal(await h.coordinator.retryPendingWallPost(OWNER), 'post-1');
      assert.equal(h.posts()[0].body, frozen);
      assert.equal(h.uploads.length, 1);
    }
  });
}

for (const body of [
  { ok: true, id: 'only-id' },
  { ok: false, id: 'post-1', post: { id: 'post-1' } },
  { ok: true, id: 'post-1', post: { id: 'different' } },
  { ok: true, id: '', post: { id: '' } },
  '<html>Success proxy</html>',
]) {
  test(`unconfirmed 201 response stays pending: ${JSON.stringify(body)}`, async () => {
    const h = harness();
    h.post = async () => response(201, body);
    await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /did not confirm/);
    assert.equal(h.pending().body, h.posts()[0].body);
  });
}

test('auth owner mismatch blocks new submission and pending recovery before uploads/POST', async () => {
  const h = harness();
  h.session.user.id = 'other-owner';
  await assert.rejects(h.auth.getAuthenticatedApiHeaders(OWNER), /original account/);
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /original account/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.uploads.length, 0);
  h.session.user.id = OWNER;
  h.post = async () => { throw new Error('Lost response'); };
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()));
  const frozen = h.storage.get(KEY);
  h.session.user.id = 'other-owner';
  await assert.rejects(h.coordinator.retryPendingWallPost(OWNER), /original account/);
  assert.equal(h.storage.get(KEY), frozen);
  assert.equal(h.posts().length, 1);
});

test('same-owner near-expiry refresh supplies the refreshed bearer for real GET/POST', async () => {
  const h = harness();
  h.session.expires_at = NOW / 1000 + 15;
  const headers = await h.auth.getAuthenticatedApiHeaders(OWNER);
  assert.equal(headers.Authorization, 'Bearer refreshed-token');
  assert.equal(h.refreshCalls, 1);
  await h.coordinator.submitWallPost(OWNER, draft());
  assert.ok(h.requests.every((item) => item.headers.Authorization === 'Bearer refreshed-token'));
});

test('refresh returning another owner fails before API or upload', async () => {
  const h = harness();
  h.session.expires_at = NOW / 1000 - 1;
  h.refreshedSession.user.id = 'other-owner';
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /original account/);
  assert.equal(h.refreshCalls, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.uploads.length, 0);
});

test('owner changing during upload is rechecked before persistence and POST', async () => {
  const h = harness();
  h.readMedia = async () => {
    h.session = { ...h.session, user: { id: 'other-owner' } };
    return new ArrayBuffer(153);
  };
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()), /original account/);
  assert.equal(h.posts().length, 0);
  assert.equal(h.storage.size, 0);
});

test('retry rechecks capability and preserves original body if backend rolls back', async () => {
  const h = harness();
  h.post = async () => { throw new Error('Ambiguous'); };
  await assert.rejects(h.coordinator.submitWallPost(OWNER, draft()));
  const frozen = h.pending().body;
  h.get = async () => response(200, { ok: true });
  await assert.rejects(h.coordinator.retryPendingWallPost(OWNER), /capability handshake/);
  assert.equal(h.pending().body, frozen);
  assert.equal(h.posts().length, 1);
  assert.equal(h.uploads.length, 1);
});

test('real beer service adapter passes owner, beer, draft and media through the real coordinator', async () => {
  const h = harness();
  assert.equal(await h.beer.createBeerWallPost(OWNER, 'selected-beer', ' Beer post ', [picked()]), 'post-1');
  const body = JSON.parse(h.posts()[0].body);
  assert.equal(body.user_id, OWNER);
  assert.equal(body.beer_id, 'selected-beer');
  assert.equal(body.content, 'Beer post');
  assert.equal(body.media.length, 1);
  assert.match(body.request_id, UUID);
  assert.equal(h.posts()[0].headers['Idempotency-Key'], body.request_id);
});

// These AST assertions check source wiring only. They are NOT device integration
// tests and make no claims about rendered native behavior or physical taps.
function parseSource(...parts) {
  const filename = path.join(project, 'src', ...parts);
  return ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findAll(node, predicate) {
  const found = [];
  function visit(current) {
    if (predicate(current)) found.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}
function handler(source, name) {
  const matches = findAll(source, (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  assert.equal(matches.length, 1, `handler ${name} exists exactly once`);
  return matches[0];
}
function calls(node, name) {
  return findAll(node, (item) => ts.isCallExpression(item) && item.expression.getText() === name);
}
function importedFrom(source, name, suffix) {
  assert.ok(findAll(source, (node) => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text.endsWith(suffix)
    && node.importClause?.namedBindings
    && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some((item) => item.name.text === name)).length,
  `${name} must be imported from ${suffix}`);
}
function pressButtons(source) {
  return findAll(source, (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'TouchableOpacity')
    .map((node) => ({
      node,
      press: node.openingElement.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === 'onPress'),
      disabled: node.openingElement.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === 'disabled'),
    }));
}

test('source-wiring unit assertions (NOT device integration): Wall publish and explicit recovery', () => {
  const source = parseSource('features', 'wall', 'NativeWallScreen.tsx');
  importedFrom(source, 'submitWallPost', '/wallSubmission');
  importedFrom(source, 'retryPendingWallPost', '/wallSubmission');
  const publish = handler(source, 'handlePost');
  const submit = calls(publish, 'submitWallPost');
  assert.equal(submit.length, 1);
  assert.equal(submit[0].arguments[0].getText(source), 'user.id');
  const fields = submit[0].arguments[1].properties.map((item) => [item.name.getText(source), item.initializer.getText(source)]);
  assert.deepEqual(fields, [['content', 'composerText'], ['beerId', 'filterBeerId'], ['media', 'pickedMedia']]);
  const recovery = handler(source, 'handleRetryPendingPost');
  assert.equal(calls(recovery, 'retryPendingWallPost').length, 1);
  assert.equal(calls(recovery, 'retryPendingWallPost')[0].arguments[0].getText(source), 'user.id');
  assert.equal(calls(recovery, 'clearComposer').length, 0, 'recovery keeps current draft');
  assert.equal(calls(recovery, 'submitWallPost').length, 0, 'recovery never creates a replacement draft');
  const buttons = pressButtons(source);
  assert.ok(buttons.some((item) => item.press?.initializer?.getText(source) === '{handlePost}'));
  const retry = buttons.find((item) => item.press?.initializer?.getText(source) === '{handleRetryPendingPost}');
  assert.ok(retry);
  assert.match(retry.node.getText(source), />Retry pending post</);
  assert.doesNotMatch(retry.disabled.getText(source), /canPost|composerText|pickedMedia/, 'retry remains available without a draft');
  assert.equal(calls(publish, 'uploadPostMedia').length, 0);
  assert.equal(calls(publish, 'sendFrozenWallPost').length, 0);
});

for (const target of ['selected', 'today']) {
  test(`source-wiring unit assertions (NOT device integration): ${target} beer publish and recovery`, () => {
    const source = parseSource('features', 'beers', 'NativeBeerScreen.tsx');
    const beer = parseSource('features', 'beers', 'beerService.ts');
    importedFrom(source, 'createBeerWallPost', '/beerService');
    importedFrom(source, 'retryPendingWallPost', '/wallSubmission');
    importedFrom(beer, 'submitWallPost', '/wallSubmission');
    const adapter = findAll(beer, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'createBeerWallPost')[0];
    assert.ok(adapter);
    assert.equal(calls(adapter, 'submitWallPost').length, 1);
    const name = target === 'selected' ? 'handleSelectedWallPost' : 'handleTodayWallPost';
    const publish = handler(source, name);
    const submit = calls(publish, 'createBeerWallPost');
    assert.equal(submit.length, 1);
    assert.deepEqual(submit[0].arguments.map((item) => item.getText(source)), [
      'user.id', `${target}Beer.id`, `${target}WallPostText`, `${target}WallMedia`,
    ]);
    const recovery = handler(source, 'handleRetryPendingWallPost');
    assert.equal(calls(recovery, 'retryPendingWallPost').length, 1);
    assert.equal(calls(recovery, 'retryPendingWallPost')[0].arguments[0].getText(source), 'user.id');
    assert.equal(calls(recovery, 'createBeerWallPost').length, 0);
    for (const setter of ['setSelectedWallPostText', 'setTodayWallPostText', 'setSelectedWallMedia', 'setTodayWallMedia']) {
      assert.equal(calls(recovery, setter).length, 0, 'recovery keeps both composers');
    }
    const buttons = pressButtons(source);
    assert.ok(buttons.some((item) => item.press && calls(item.press, name).length === 1));
    const retry = buttons.find((item) => item.press && calls(item.press, 'handleRetryPendingWallPost')
      .some((call) => call.arguments[0]?.text === target));
    assert.ok(retry, `${target} has its own recovery action`);
    assert.match(retry.node.getText(source), />Retry pending post</);
    assert.doesNotMatch(retry.disabled.getText(source), /canPublish|WallPostText|WallMedia/);
    assert.equal(calls(publish, 'uploadPostMedia').length, 0);
    assert.equal(calls(publish, 'sendFrozenWallPost').length, 0);
  });
}
