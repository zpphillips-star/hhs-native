'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/config/env.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const jwt = claims => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'synthetic-signature'].join('.');
const anon = jwt({ iss: 'supabase-demo', role: 'anon' });
const local = {
  EXPO_PUBLIC_HHS_LOCAL_TEST: '1',
  EXPO_PUBLIC_HHS_WEB_ORIGIN: 'http://127.0.0.1:3100',
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: anon,
};
function load(env = {}, dev = true, extra = {}) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process: { env }, __DEV__: dev, URL, atob,
    require(name) {
      assert.equal(name, 'expo-constants');
      return { expoConfig: { extra } };
    },
  });
  return exports;
}

test('production defaults unchanged in development and release', () => {
  for (const dev of [true, false]) {
    const config = load({}, dev);
    assert.equal(config.HHS_WEB_ORIGIN, 'https://hallowedhopsociety.com');
    assert.equal(config.SUPABASE_URL, 'https://dnicdsjvqxthkktlcshe.supabase.co');
    assert.equal(config.SUPABASE_ANON_KEY, 'sb_publishable_fZs3CdtGLw3GJdlAxFtxFQ_z4VW2SDB');
    assert.equal(config.HHS_LOCAL_TEST, false);
    assert.equal(config.isSupabaseEnvConfigured, true);
    assert.equal(config.isHhsInternalUrl('https://www.hallowedhopsociety.com/wall'), true);
    assert.equal(config.isHhsInternalUrl('http://hallowedhopsociety.com/wall'), false);
    assert.deepEqual(Array.from(config.HHS_WEBVIEW_ORIGINS), ['https://*', 'mailto:*', 'tel:*', 'venmo:*']);
  }
});
test('normal env and extra precedence is preserved, including explicit disabled mode', () => {
  for (const flag of [undefined, '0']) {
    const config = load({ EXPO_PUBLIC_HHS_LOCAL_TEST: flag, EXPO_PUBLIC_HHS_WEB_ORIGIN: local.EXPO_PUBLIC_HHS_WEB_ORIGIN,
      EXPO_PUBLIC_SUPABASE_URL: 'normal-url', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'normal-anon',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'normal-publishable' }, false, { supabaseUrl: 'extra' });
    assert.equal(config.HHS_WEB_ORIGIN, 'https://hallowedhopsociety.com');
    assert.equal(config.SUPABASE_URL, 'normal-url');
    assert.equal(config.SUPABASE_ANON_KEY, 'normal-anon');
  }
  assert.equal(load({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key' }).SUPABASE_ANON_KEY, 'public-key');
  const extra = load({}, false, { supabaseUrl: 'extra-url', supabaseAnonKey: 'extra-anon' });
  assert.equal(extra.SUPABASE_URL, 'extra-url');
  assert.equal(extra.SUPABASE_ANON_KEY, 'extra-anon');
  assert.equal(load({}, false, { supabasePublishableKey: 'extra-public' }).SUPABASE_ANON_KEY, 'extra-public');
});
test('opt-in selects both loopback services with no fallback', () => {
  const config = load(local);
  assert.equal(config.HHS_WEB_ORIGIN, local.EXPO_PUBLIC_HHS_WEB_ORIGIN);
  assert.equal(config.SUPABASE_URL, local.EXPO_PUBLIC_SUPABASE_URL);
  assert.equal(config.SUPABASE_ANON_KEY, anon);
  assert.deepEqual(Array.from(config.HHS_WEBVIEW_ORIGINS), ['*']);
});
test('release opt-in throws before clients initialize', () => {
  assert.throws(() => load(local, false), /development-only/);
});
for (const flag of ['', 'true', 'yes', ' 1']) {
  test(`invalid explicit flag ${JSON.stringify(flag)} fails closed`, () => {
    assert.throws(() => load({ ...local, EXPO_PUBLIC_HHS_LOCAL_TEST: flag }), /Invalid HHS/);
  });
}
for (const field of ['EXPO_PUBLIC_HHS_WEB_ORIGIN', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
  test(`missing ${field} cannot use extras or production fallback`, () => {
    for (const missing of [undefined, '']) {
      assert.throws(() => load({ ...local, [field]: missing }, true, {
        supabaseUrl: local.EXPO_PUBLIC_SUPABASE_URL, supabaseAnonKey: anon,
      }), /HHS local-test/);
    }
  });
}
for (const field of ['EXPO_PUBLIC_HHS_WEB_ORIGIN', 'EXPO_PUBLIC_SUPABASE_URL']) {
  test(`${field} rejects mixed, external, malformed and ambiguous origins`, () => {
    for (const value of [
      'https://hallowedhopsociety.com', 'https://dnicdsjvqxthkktlcshe.supabase.co',
      local[field] + '/', local[field] + '?x=1', local[field] + '#fragment',
      local[field].replace('127.0.0.1', 'user:password@127.0.0.1'),
      local[field].replace('127.0.0.1', 'localhost'), local[field].replace('127.0.0.1', '10.0.2.2'),
      local[field].replace('127.0.0.1', '127.1'), local[field].replace('http:', 'https:'),
      'not a URL', 'http://127.0.0.1:8081', 'http://127.0.0.1.evil.invalid:3100',
    ]) assert.throws(() => load({ ...local, [field]: value }), /explicit loopback/);
  });
}
test('local mode rejects privileged, hosted and malformed keys without echoing them', () => {
  for (const key of ['sb_secret_do-not-log', 'sb_publishable_hosted', 'invalid-secret',
    jwt({ role: 'service_role', iss: 'supabase-demo' }),
    jwt({ role: 'authenticated', iss: 'supabase-demo' }),
    jwt({ role: 'anon', iss: 'supabase', ref: 'hosted' }), 'e30.@@@@.signature']) {
    assert.throws(() => load({ ...local, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }), error => {
      assert.match(error.message, /explicit local Supabase anon JWT/);
      assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});
test('local navigation trusts only exact backend origin and port', () => {
  const config = load(local);
  assert.equal(config.isHhsInternalUrl(`${local.EXPO_PUBLIC_HHS_WEB_ORIGIN}/wall?x=1`), true);
  for (const url of ['https://hallowedhopsociety.com/wall', 'http://127.0.0.1:54321/wall',
    'http://127.0.0.1:8081', 'http://user@127.0.0.1:3100/wall', 'http://localhost:3100',
    'venmo://paycharge', 'invalid']) assert.equal(config.isHhsInternalUrl(url), false);
});
test('shell uses centralized endpoint and trust predicates, not a second production origin', () => {
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  assert.match(app, /const HHS_ORIGIN = HHS_WEB_ORIGIN;/);
  assert.doesNotMatch(app, /const HHS_ORIGIN = ['"]https:/);
  assert.match(app, /return isHhsInternalUrl\(url\)/);
  assert.match(app, /if \(!isInternalUrl\(url\)\) return false/);
  assert.match(app, /originWhitelist=\{HHS_WEBVIEW_ORIGINS\}/);
});

test('actual shell callback rejects external navigation without opening OS links in local mode', () => {
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const tree = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleShouldStartLoad') {
      callback = node.initializer.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(callback);
  const code = ts.transpileModule(`const handler = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText + '\nhandler;';
  for (const env of [local, {}]) {
    const config = load(env);
    const links = [];
    const handler = vm.runInNewContext(code, {
      HHS_LOCAL_TEST: config.HHS_LOCAL_TEST, isInternalUrl: config.isHhsInternalUrl,
      normalizeDocumentUrl: value => value, pendingDocumentUrlRef: { current: null },
      Linking: { openURL: url => { links.push(url); return Promise.resolve(); } },
      setFlowMessage() {},
    });
    assert.equal(handler({ url: `${config.HHS_WEB_ORIGIN}/wall` }), true);
    for (const url of ['https://external.invalid', 'venmo://pay', 'http://127.0.0.1:54321',
      'https://hallowedhopsociety.com/wall', 'data:text/html,test', 'about:blank']) {
      if (config.HHS_LOCAL_TEST) assert.equal(handler({ url }), false);
    }
    assert.deepEqual(links, []);
    if (!config.HHS_LOCAL_TEST) {
      assert.equal(handler({ url: 'https://external.invalid' }), false);
      assert.deepEqual(links, ['https://external.invalid']);
    }
  }
});
