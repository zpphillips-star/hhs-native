import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

import { HHS_WEB_ORIGIN } from '../../config/env';
import { getAuthenticatedApiHeaders } from '../../lib/nativeApiAuth';
import { supabase } from '../../lib/supabase';

const PHOTO_BUCKET = 'post-photos';
const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_DURATION_MS = 90 * 1000;
const SUPPORTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'] as const;
const MEDIA_COLUMN_NAMES = ['media_type', 'media_url', 'thumbnail_url', 'media_size_bytes', 'video_duration_ms'] as const;

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
};

function getMediaExtension(media: PickedMedia) {
  const fromName = media.fileName.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  if (media.mimeType.includes('mp4')) return 'mp4';
  if (media.mimeType.includes('quicktime')) return 'mov';
  if (media.mimeType.includes('webm')) return 'webm';
  if (media.mimeType.includes('3gpp')) return '3gp';
  if (media.mimeType.includes('png')) return 'png';
  if (media.mimeType.includes('webp')) return 'webp';
  return 'jpg';
}

function isSupportedVideoMime(mimeType: string) {
  return mimeType.startsWith('video/') && SUPPORTED_VIDEO_MIME_TYPES.some((value) => value === mimeType);
}

export async function pickWallMedia(source: WallMediaSource): Promise<PickedMedia | null> {
  const selectedMediaType = source === 'video-library' ? 'video' : 'image';
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera blocked', 'Camera permission is required to add a new photo from the camera.');
        return null;
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
        return null;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, Platform.OS === 'android' ? 250 : 100));

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      })
      : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: source === 'video-library' ? ['videos'] : ['images'],
        quality: 0.85,
      });

    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    const resolvedMimeType = asset.mimeType || (selectedMediaType === 'video' ? 'video/mp4' : 'image/jpeg');
    const fileSize = typeof asset.fileSize === 'number' ? asset.fileSize : null;
    const durationMs = selectedMediaType === 'video' && typeof asset.duration === 'number' ? Math.round(asset.duration) : null;
    if (selectedMediaType === 'video' && !isSupportedVideoMime(resolvedMimeType)) {
      Alert.alert('Unsupported video', 'Use MP4, MOV, WEBM, or 3GP for Wall videos.');
      return null;
    }
    if (selectedMediaType === 'video' && fileSize && fileSize > MAX_VIDEO_UPLOAD_BYTES) {
      Alert.alert('Video too large', 'Wall videos must be 50 MB or smaller.');
      return null;
    }
    if (selectedMediaType === 'video' && durationMs && durationMs > MAX_VIDEO_DURATION_MS) {
      Alert.alert('Video too long', 'Wall videos must be 90 seconds or shorter.');
      return null;
    }

    return {
      uri: asset.uri,
      mimeType: resolvedMimeType,
      fileName: asset.fileName || (selectedMediaType === 'video' ? `wall-video-${Date.now()}.mp4` : `wall-photo-${Date.now()}.jpg`),
      mediaType: selectedMediaType,
      fileSize,
      durationMs,
    };
  } catch (pickError) {
    Alert.alert(
      selectedMediaType === 'video' ? 'Video error' : 'Photo error',
      pickError instanceof Error ? pickError.message : `Could not pick a ${selectedMediaType === 'video' ? 'video' : 'photo'}.`,
    );
    return null;
  }
}

export async function uploadPostMedia(userId: string, media: PickedMedia) {
  if (!supabase) throw new Error('Supabase is not configured for the native app.');
  if (media.mediaType === 'video' && media.fileSize && media.fileSize > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error('Videos must be 50 MB or smaller.');
  }
  if (media.mediaType === 'video' && media.durationMs && media.durationMs > MAX_VIDEO_DURATION_MS) {
    throw new Error('Videos must be 90 seconds or shorter.');
  }
  const ext = getMediaExtension(media);
  const path = `${userId}/${Date.now()}-${media.mediaType}.${ext}`;
  const response = await fetch(media.uri);
  if (!response.ok) {
    throw new Error(`Could not read selected ${media.mediaType} (${response.status}).`);
  }
  const body = await response.arrayBuffer();
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
    mediaSizeBytes: media.fileSize ?? null,
    videoDurationMs: media.mediaType === 'video' ? media.durationMs ?? null : null,
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

function getPostPayload(
  userId: string,
  content: string,
  media: UploadedPostMedia | null,
  beerId: string | null,
  includeMediaMetadata: boolean,
) {
  const payload: Record<string, string | number | null> = {
    user_id: userId,
    content,
    beer_id: beerId,
    photo_url: media?.mediaUrl ?? null,
    media_url: media?.mediaUrl ?? null,
    media_type: media?.mediaType ?? null,
  };

  if (includeMediaMetadata) {
    payload.thumbnail_url = media?.thumbnailUrl ?? null;
    payload.media_size_bytes = media?.mediaSizeBytes ?? null;
    payload.video_duration_ms = media?.videoDurationMs ?? null;
  }

  return payload;
}

export async function postViaWallApi(
  userId: string,
  content: string,
  media: UploadedPostMedia | null,
  beerId: string | null,
  includeMediaMetadata = true,
) {
  const authHeaders = await getAuthenticatedApiHeaders(userId);
  const response = await fetch(buildWallApiUrl('/api/wall/post'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(getPostPayload(userId, content, media, beerId, includeMediaMetadata)),
  });
  if (!response.ok) throw new Error(await readWallApiError(response));
  const json = await response.json() as { post?: { id?: string } };
  return json.post?.id ?? null;
}

function isMissingMediaColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return error.code === 'PGRST204' ||
    MEDIA_COLUMN_NAMES.some((column) => message.includes(column)) ||
    /media_(url|type)|thumbnail_url|video_duration_ms|media_size_bytes|column .* does not exist|Could not find .*media_/i.test(message);
}

export async function insertPostDirectly(
  userId: string,
  content: string,
  media: UploadedPostMedia | null,
  beerId: string | null,
  includeMediaMetadata = true,
) {
  if (!supabase) throw new Error('Supabase is not configured for the native app.');
  let result = await supabase
    .from('posts')
    .insert(getPostPayload(userId, content, media, beerId, includeMediaMetadata))
    .select('id')
    .maybeSingle();
  if (isMissingMediaColumnError(result.error)) {
    result = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        content,
        beer_id: beerId,
        photo_url: media?.mediaUrl ?? null,
      })
      .select('id')
      .maybeSingle();
  }
  if (result.error) throw result.error;
  return (result.data as { id?: string } | null)?.id ?? null;
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
