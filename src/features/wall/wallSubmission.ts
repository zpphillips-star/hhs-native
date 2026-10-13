import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from 'expo-modules-core';
import { getAuthenticatedApiHeaders } from '../../lib/nativeApiAuth';
import {
  getPostPayload,
  requireAtomicWallPostSupport,
  sendFrozenWallPost,
  uploadPostMedia,
  WallPostApiError,
  type PickedMedia,
} from './wallPostService';

export type WallDraft = {
  content: string;
  beerId: string | null;
  media: PickedMedia[];
};

type PendingSubmission = {
  version: 1;
  owner: string;
  fingerprint: string;
  // Store the serialized body, not a reconstructable draft: retries are byte-identical.
  body: string;
  attempted: boolean;
};

const storageKey = (owner: string) => `hhs:wall-pending:v1:${owner}`;
const active = new Map<string, { fingerprint: string | null; promise: Promise<string | null> }>();
const pendingInstruction = 'An earlier Wall post may already be published. Use "Retry pending post" to resolve the original unchanged post first. Your edited draft has not been sent.';

function exclusively(
  owner: string,
  fingerprint: string | null,
  work: () => Promise<string | null>,
): Promise<string | null> {
  const current = active.get(owner);
  if (current) {
    if (fingerprint === null || current.fingerprint === fingerprint) return current.promise;
    return Promise.reject(new Error('Another Wall submission is still running. Wait for it to finish, then resolve any pending post before publishing a different draft.'));
  }
  const promise = work().finally(() => {
    if (active.get(owner)?.promise === promise) active.delete(owner);
  });
  active.set(owner, { fingerprint, promise });
  return promise;
}

async function readPending(owner: string): Promise<PendingSubmission | null> {
  const raw = await AsyncStorage.getItem(storageKey(owner));
  if (raw === null) return null;
  try {
    const pending = JSON.parse(raw) as PendingSubmission;
    const body = JSON.parse(pending.body);
    if (pending.version !== 1 || pending.owner !== owner ||
        typeof pending.fingerprint !== 'string' || typeof pending.attempted !== 'boolean' ||
        body.user_id !== owner || typeof body.request_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id) ||
        !Array.isArray(body.media)) throw new Error('Invalid pending record');
    return pending;
  } catch {
    // Never overwrite a damaged record that could refer to an already-committed post.
    throw new Error('The saved pending Wall post cannot be read safely. Do not republish it; check the Wall and contact support to resolve the saved submission.');
  }
}

async function deliver(pending: PendingSubmission): Promise<string> {
  const previouslyAttempted = pending.attempted;
  await getAuthenticatedApiHeaders(pending.owner);
  // Persist uncertainty BEFORE dispatch so a process death cannot lose the key.
  pending.attempted = true;
  await AsyncStorage.setItem(storageKey(pending.owner), JSON.stringify(pending));
  let postId: string;
  try {
    postId = await sendFrozenWallPost(pending.owner, pending.body);
  } catch (error) {
    if (!previouslyAttempted && error instanceof WallPostApiError && error.nonCommitting) {
      await AsyncStorage.removeItem(storageKey(pending.owner));
      throw new Error(`${error.message} Nothing was published; you can correct the draft and submit again.`);
    }
    // A later 4xx cannot disprove a commit from an earlier ambiguous attempt.
    const reason = error instanceof Error ? error.message : 'The response was interrupted.';
    throw new Error(`${reason} The original submission is saved. It may already be published; use "Retry pending post" to safely confirm it without changing its content.`);
  }
  try {
    await AsyncStorage.removeItem(storageKey(pending.owner));
  } catch {
    // The API confirmed success. A leftover record remains safe to retry with the
    // same key; never turn a local cleanup failure into a new create operation.
  }
  return postId;
}

export function submitWallPost(owner: string, draft: WallDraft): Promise<string> {
  // Capture immediately; callers may edit/unmount while uploads are in flight.
  const snapshot: WallDraft = {
    content: draft.content.trim(),
    beerId: draft.beerId,
    media: draft.media.map((item) => ({ ...item })),
  };
  const fingerprint = JSON.stringify(snapshot);
  return exclusively(owner, fingerprint, async () => {
    await getAuthenticatedApiHeaders(owner);
    const pending = await readPending(owner);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new Error(pendingInstruction);
      return deliver(pending);
    }
    if (!snapshot.content && snapshot.media.length === 0) throw new Error('Write a Wall post or select media before publishing.');
    // A legacy backend must not receive a POST, even for text/single-media posts.
    await requireAtomicWallPostSupport(owner);
    const uploaded = await Promise.all(snapshot.media.map((item) => uploadPostMedia(owner, item)));
    await getAuthenticatedApiHeaders(owner);
    const submission: PendingSubmission = {
      version: 1,
      owner,
      fingerprint,
      body: JSON.stringify({
        ...getPostPayload(owner, snapshot.content, uploaded, snapshot.beerId, true),
        request_id: uuid.v4(),
      }),
      attempted: false,
    };
    // No POST if durable storage fails. Uploads may be orphaned, never posts.
    await AsyncStorage.setItem(storageKey(owner), JSON.stringify(submission));
    return deliver(submission);
  }) as Promise<string>;
}

/** Explicit manual recovery, also works with an empty composer after restart. */
export function retryPendingWallPost(owner: string): Promise<string | null> {
  return exclusively(owner, null, async () => {
    await getAuthenticatedApiHeaders(owner);
    const pending = await readPending(owner);
    return pending ? deliver(pending) : null;
  });
}
