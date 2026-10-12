import { supabase } from '../../lib/supabase';

export const WALL_MEDIA_BUCKET = 'post-photos';
export const WALL_MEDIA_MAX_ATTACHMENTS = 10;
export const WALL_MEDIA_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const WALL_MEDIA_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export type WallMediaKind = 'image' | 'video' | 'gif';

export type PickedWallMedia = {
  uri: string;
  mimeType: string;
  fileName: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export type WallMediaItem = {
  id?: string;
  post_id?: string | null;
  comment_id?: string | null;
  user_id?: string | null;
  bucket: string;
  storage_path: string;
  public_url: string | null;
  media_kind: WallMediaKind;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumbnail_bucket?: string | null;
  thumbnail_path?: string | null;
  thumbnail_url?: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  legacy?: boolean;
};

export type UploadedWallMedia = WallMediaItem & {
  localUri: string;
};

export function normalizeMimeType(mimeType: string | null | undefined) {
  return (mimeType || 'image/jpeg').toLowerCase().trim();
}

export function getWallMediaKind(mimeType: string): WallMediaKind {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === 'image/gif') return 'gif';
  if (normalized.startsWith('video/')) return 'video';
  return 'image';
}

export function assertAllowedWallMedia(media: PickedWallMedia[]) {
  if (media.length > WALL_MEDIA_MAX_ATTACHMENTS) {
    throw new Error(`Attach up to ${WALL_MEDIA_MAX_ATTACHMENTS} files per post.`);
  }

  let knownTotal = 0;
  for (const item of media) {
    const mimeType = normalizeMimeType(item.mimeType);
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error('Unsupported file type. Use JPG, PNG, WebP, GIF, MP4, MOV, or WebM.');
    }
    if (item.byteSize !== null) {
      if (item.byteSize > WALL_MEDIA_MAX_ATTACHMENT_BYTES) {
        throw new Error('That file is too large. Attachments must be 25 MB or smaller.');
      }
      knownTotal += item.byteSize;
    }
  }

  if (knownTotal > WALL_MEDIA_MAX_TOTAL_BYTES) {
    throw new Error('Attachments are too large. Keep the total upload under 100 MB.');
  }
}

function getExtension(media: PickedWallMedia) {
  const fromName = media.fileName.split('.').pop();
  if (fromName && /^[a-z0-9]{2,5}$/i.test(fromName)) return fromName.toLowerCase();
  const mimeType = normalizeMimeType(media.mimeType);
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('quicktime')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'jpg';
}

function buildStoragePath(userId: string, media: PickedWallMedia) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  const ext = getExtension(media);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${safeUserId}/wall/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomPart}.${ext}`;
}

export function isOwnedWallMediaPath(userId: string, storagePath: string) {
  return storagePath.startsWith(`${userId}/wall/`);
}

export function buildLegacyWallMedia(photoUrl: string | null | undefined): WallMediaItem[] {
  if (!photoUrl) return [];
  return [{
    bucket: WALL_MEDIA_BUCKET,
    storage_path: '',
    public_url: photoUrl,
    media_kind: 'image',
    mime_type: 'image/jpeg',
    byte_size: 0,
    width: null,
    height: null,
    duration_ms: null,
    sort_order: 0,
    legacy: true,
  }];
}

export function normalizeWallMedia(media: WallMediaItem[] | null | undefined, legacyPhotoUrl: string | null | undefined) {
  const normalized = (media || [])
    .filter((item) => item && item.public_url)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return normalized.length > 0 ? normalized : buildLegacyWallMedia(legacyPhotoUrl);
}

export async function uploadWallMedia(userId: string, media: PickedWallMedia, sortOrder = 0): Promise<UploadedWallMedia> {
  if (!supabase) throw new Error('Supabase is not configured for the native app.');
  assertAllowedWallMedia([media]);

  const path = buildStoragePath(userId, media);
  if (!isOwnedWallMediaPath(userId, path)) {
    throw new Error('Invalid Wall media storage path.');
  }

  const response = await fetch(media.uri);
  const body = await response.arrayBuffer();
  if (body.byteLength > WALL_MEDIA_MAX_ATTACHMENT_BYTES) {
    throw new Error('That file is too large. Attachments must be 25 MB or smaller.');
  }

  const mimeType = normalizeMimeType(media.mimeType);
  const { error } = await supabase.storage.from(WALL_MEDIA_BUCKET).upload(path, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(WALL_MEDIA_BUCKET).getPublicUrl(path);
  return {
    localUri: media.uri,
    bucket: WALL_MEDIA_BUCKET,
    storage_path: path,
    public_url: data.publicUrl,
    media_kind: getWallMediaKind(mimeType),
    mime_type: mimeType,
    byte_size: body.byteLength,
    width: media.width,
    height: media.height,
    duration_ms: media.durationMs,
    thumbnail_bucket: null,
    thumbnail_path: null,
    thumbnail_url: null,
    sort_order: sortOrder,
  };
}

export async function insertWallMediaRows(postId: string, userId: string, media: UploadedWallMedia[]) {
  if (!supabase || media.length === 0) return;
  assertAllowedWallMedia(media.map((item) => ({
    uri: item.localUri,
    mimeType: item.mime_type,
    fileName: item.storage_path,
    byteSize: item.byte_size,
    width: item.width,
    height: item.height,
    durationMs: item.duration_ms,
  })));

  const rows = media.map((item) => {
    if (!isOwnedWallMediaPath(userId, item.storage_path)) {
      throw new Error('Invalid Wall media storage path.');
    }
    return {
      post_id: postId,
      comment_id: null,
      user_id: userId,
      bucket: item.bucket,
      storage_path: item.storage_path,
      public_url: item.public_url,
      media_kind: item.media_kind,
      mime_type: item.mime_type,
      byte_size: item.byte_size,
      width: item.width,
      height: item.height,
      duration_ms: item.duration_ms,
      thumbnail_bucket: item.thumbnail_bucket ?? null,
      thumbnail_path: item.thumbnail_path ?? null,
      thumbnail_url: item.thumbnail_url ?? null,
      sort_order: item.sort_order,
    };
  });

  const { error } = await supabase.from('wall_media').insert(rows);
  if (error) throw error;
}

