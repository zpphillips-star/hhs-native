import * as ImagePicker from 'expo-image-picker';
import { uuid } from 'expo-modules-core';
import { Alert, Platform } from 'react-native';

import { HHS_WEB_ORIGIN } from '../../config/env';
import { getAuthenticatedApiHeaders } from '../../lib/nativeApiAuth';
import { supabase } from '../../lib/supabase';

const PHOTO_BUCKET = 'post-photos';
const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_DURATION_MS = 90 * 1000;
const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
};

export type WallMediaSource = 'photo-library' | 'video-library' | 'camera';

export type PickedMedia = {
  uri: string;
  mimeType: string;
  fileName: string;
  mediaType: 'image' | 'video';
  fileSize?: number | null;
  durationMs?: number | null;
};

export type UploadedPostMedia = {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl: string | null;
  mediaSizeBytes: number | null;
  videoDurationMs: number | null;
  mimeType: string | null;
  storageBucket: string;
  storagePath: string | null;
};

export type WallMultiMediaSupport = {
  supported: boolean;
  reason?: string;
};

type PostMediaPayload = {
  media_url: string;
  media_type: 'image' | 'video';
  mime_type: string | null;
  storage_bucket: string;
  storage_path: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
  sort_order: number;
};

function normalizePickedAsset(
  asset: ImagePicker.ImagePickerAsset,
  selectedMediaType: 'image' | 'video',
): PickedMedia {
  const assetType = asset.type === 'video' ? 'video' : asset.type === 'image' ? 'image' : selectedMediaType;
  // SDK 54 can return original HEIC/AVIF. Quality is NOT a conversion guarantee.
  const resolvedMimeType = asset.mimeType?.toLowerCase() || '';
  const fileSize = typeof asset.fileSize === 'number' ? asset.fileSize : null;
  const durationMs = assetType === 'video' && typeof asset.duration === 'number' ? Math.round(asset.duration) : null;

  return {
    uri: asset.uri,
    mimeType: resolvedMimeType,
    fileName: asset.fileName || 'selected-media',
    mediaType: assetType,
    fileSize,
    durationMs,
  };
}

function validatePickedMedia(media: PickedMedia): string | null {
  if (!Object.hasOwn(MEDIA_EXTENSIONS, media.mimeType) || !media.mimeType.startsWith(`${media.mediaType}/`)) {
    return `Unsupported Wall media MIME type: ${media.mimeType || 'unknown'}. Choose JPEG, PNG, GIF, WebP, MP4, MOV, WEBM, or 3GP. No format conversion was verified.`;
  }
  if (media.mediaType === 'video' && media.fileSize && media.fileSize > MAX_VIDEO_UPLOAD_BYTES) {
    return 'Wall videos must be 50 MB or smaller.';
  }
  if (media.mediaType === 'video' && media.durationMs && media.durationMs > MAX_VIDEO_DURATION_MS) {
    return 'Wall videos must be 90 seconds or shorter.';
  }
  return null;
}

export async function pickWallMedia(source: WallMediaSource, selectionLimit = 1): Promise<PickedMedia[]> {
  const selectedMediaType = source === 'video-library' ? 'video' : 'image';
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera blocked', 'Camera permission is required to add a new photo from the camera.');
        return [];
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          source === 'video-library' ? 'Videos blocked' : 'Photos blocked',
          source === 'video-library'
            ? 'Photo library permission is required to add an existing video.'
            : 'Photo library permission is required to add an existing photo.',
        );
        return [];
      }
    }

    await new Promise((resolve) => setTimeout(resolve, Platform.OS === 'android' ? 250 : 100));

    const limitedSelection = Math.max(1, selectionLimit);
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      })
      : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: source === 'video-library' ? ['videos'] : ['images'],
        allowsMultipleSelection: limitedSelection > 1,
        selectionLimit: limitedSelection,
        orderedSelection: true,
        quality: 0.85,
      });

    if (result.canceled || !result.assets?.length) return [];
    const picked = result.assets.map((asset) => normalizePickedAsset(asset, selectedMediaType));
    const valid: PickedMedia[] = [];
    const rejectedReasons = new Set<string>();
    picked.forEach((media) => {
      const validationError = validatePickedMedia(media);
      if (validationError) rejectedReasons.add(validationError);
      else valid.push(media);
    });
    if (rejectedReasons.size > 0) {
      Alert.alert(
        selectedMediaType === 'video' ? 'Video skipped' : 'Media skipped',
        Array.from(rejectedReasons).join('\n'),
      );
    }
    return valid.slice(0, limitedSelection);
  } catch (pickError) {
    Alert.alert(
      selectedMediaType === 'video' ? 'Video error' : 'Photo error',
      pickError instanceof Error ? pickError.message : `Could not pick a ${selectedMediaType === 'video' ? 'video' : 'photo'}.`,
    );
    return [];
  }
}

export async function uploadPostMedia(userId: string, media: PickedMedia) {
  if (!supabase) throw new Error('Supabase is not configured for the native app.');
  const validationError = validatePickedMedia(media);
  if (validationError) throw new Error(validationError);
  const ext = MEDIA_EXTENSIONS[media.mimeType];
  const path = `${userId}/${uuid.v4()}.${ext}`;
  const response = await fetch(media.uri);
  if (!response.ok) {
    throw new Error(`Could not read selected ${media.mediaType} (${response.status}).`);
  }
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) throw new Error('The selected media file is empty.');
  if (media.mediaType === 'video' && body.byteLength > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error('Videos must be 50 MB or smaller.');
  }
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, {
    contentType: media.mimeType,
    upsert: false,
  });
  if (error) {
    const message = typeof error.message === 'string' ? error.message : 'Storage upload failed.';
    throw new Error(`Could not upload ${media.mediaType}: ${message}`);
  }
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return {
    mediaUrl: data.publicUrl,
    mediaType: media.mediaType,
    thumbnailUrl: null,
    mediaSizeBytes: body.byteLength,
    videoDurationMs: media.mediaType === 'video' ? media.durationMs ?? null : null,
    mimeType: media.mimeType,
    storageBucket: PHOTO_BUCKET,
    storagePath: path,
  } satisfies UploadedPostMedia;
}

export function buildWallApiUrl(path: string) {
  return `${HHS_WEB_ORIGIN}${path}`;
}

export async function readWallApiError(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed (${response.status}).`;
  try {
    const json = JSON.parse(text) as { error?: string };
    return json.error || text;
  } catch {
    return text;
  }
}

export function getPostPayload(
  userId: string,
  content: string,
  media: UploadedPostMedia | UploadedPostMedia[] | null,
  beerId: string | null,
  includeMediaMetadata: boolean,
) {
  const mediaItems = Array.isArray(media) ? media : media ? [media] : [];
  const primaryMedia = mediaItems[0] ?? null;
  const payload: Record<string, string | number | null> = {
    user_id: userId,
    content,
    beer_id: beerId,
    photo_url: primaryMedia?.mediaUrl ?? null,
    media_url: primaryMedia?.mediaUrl ?? null,
    media_type: primaryMedia?.mediaType ?? null,
  };

  if (includeMediaMetadata) {
    payload.thumbnail_url = primaryMedia?.thumbnailUrl ?? null;
    payload.media_size_bytes = primaryMedia?.mediaSizeBytes ?? null;
    payload.video_duration_ms = primaryMedia?.videoDurationMs ?? null;
  }

  return {
    ...payload,
    media: getPostMediaPayload(mediaItems),
  };
}

function getPostMediaPayload(mediaItems: UploadedPostMedia[]): PostMediaPayload[] {
  return mediaItems.map((item, index) => ({
    media_url: item.mediaUrl,
    media_type: item.mediaType,
    mime_type: item.mimeType,
    storage_bucket: item.storageBucket,
    storage_path: item.storagePath,
    duration_ms: item.videoDurationMs,
    thumbnail_url: item.thumbnailUrl,
    sort_order: index,
  }));
}

/** No table probe can prove that the API atomically commits and deduplicates. */
export async function requireAtomicWallPostSupport(userId: string): Promise<void> {
  const authHeaders = await getAuthenticatedApiHeaders(userId);
  const response = await fetchWallWithTimeout({
    method: 'GET',
    headers: { ...authHeaders, 'Cache-Control': 'no-cache' },
  });
  const json = await response.json().catch(() => null);
  const capabilities = json?.capabilities;
  if (!response.ok || json?.ok !== true ||
      capabilities?.atomic_wall_post !== 1 ||
      capabilities?.idempotency_key !== 1 ||
      capabilities?.ordered_media !== 1) {
    throw new Error('This testing build requires the atomic, idempotent Wall API capability handshake. Posting is blocked until the backend update is available.');
  }
}

// Deadline covers body reading too (a server can send headers then stall).
async function fetchWallWithTimeout(init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(buildWallApiUrl('/api/wall/post'), { ...init, signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as Response;
  } finally {
    clearTimeout(timeout);
  }
}

export class WallPostApiError extends Error {
  constructor(message: string, readonly nonCommitting: boolean) {
    super(message);
  }
}

/** Internal transport: caller must durably store this exact body BEFORE calling. */
export async function sendFrozenWallPost(userId: string, body: string): Promise<string> {
  const payload = JSON.parse(body) as { request_id: string; user_id: string };
  if (payload.user_id !== userId || !payload.request_id) throw new Error('Invalid pending Wall post owner or request ID.');
  // Recheck on every manual retry, including after app restart/backend rollback.
  await requireAtomicWallPostSupport(userId);
  const authHeaders = await getAuthenticatedApiHeaders(userId);
  const response = await fetchWallWithTimeout({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.request_id, ...authHeaders },
    body,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    // Never release a conflict, timeout, arbitrary proxy 4xx, or server failure.
    const nonCommitting = [400, 401, 403, 413, 415, 422].includes(response.status) &&
      json?.committed === false && typeof json?.error === 'string';
    throw new WallPostApiError(json?.error || `Wall request failed (${response.status}).`, nonCommitting);
  }
  if (json?.ok !== true || typeof json?.id !== 'string' || !json.id ||
      json?.post?.id !== json.id) {
    throw new WallPostApiError('The server response did not confirm a Wall post ID.', false);
  }
  return json.id;
}

export async function patchPostViaWallApi(userId: string, postId: string, content: string) {
  const authHeaders = await getAuthenticatedApiHeaders(userId);
  const response = await fetch(buildWallApiUrl('/api/wall/post'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ post_id: postId, content }),
  });
  if (!response.ok) throw new Error(await readWallApiError(response));
}
