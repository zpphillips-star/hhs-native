import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ImageURISource } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { isSupabaseEnvConfigured } from '../../config/env';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { getAuthenticatedApiHeaders } from '../../lib/nativeApiAuth';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';
import {
  buildWallApiUrl as buildApiUrl,
  insertPostDirectly,
  patchPostViaWallApi,
  pickWallMedia,
  postViaWallApi,
  readWallApiError as readApiError,
  uploadPostMedia,
  type PickedMedia,
} from './wallPostService';

const PAGE_SIZE = 15;
const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v|webm|3gp|3gpp)(?:$|[?#])/i;

const REACTIONS = [
  { key: 'cheers', emoji: '🍺', label: 'Cheers' },
  { key: 'dead', emoji: '💀', label: 'Dead' },
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'trophy', emoji: '🏆', label: 'Top Pick' },
  { key: 'rough', emoji: '🤢', label: 'Rough' },
] as const;

type ReactionKey = typeof REACTIONS[number]['key'];

type Profile = {
  username: string;
  display_name: string | null;
};

type WallComment = {
  id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
  user_id: string;
  profiles: Profile | null;
};

type WallReaction = {
  id: string;
  user_id: string;
  reaction: string;
  profiles?: Profile | null;
};

type WallPost = {
  id: string;
  content: string;
  photo_url: string | null;
  media_url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  media_type?: string | null;
  created_at: string;
  updated_at?: string | null;
  beer_id: string | null;
  user_id: string;
  profiles: Profile | null;
  post_reactions: WallReaction[];
  post_comments: WallComment[];
  beers: { name: string; brewery: string; day_number: number | null; style: string | null; abv: number | null } | null;
};


type NativeWallError = {
  title: string;
  detail: string;
};

type WallMediaInfo = {
  mediaType: 'image' | 'video';
  previewUrl: string;
  fullSizeUrl: string;
};

export type NativeWallBeerContext = {
  id: string;
  name: string;
  dayNumber: number;
  brewery?: string | null;
};

function getDisplayName(profile: Profile | null | undefined) {
  return profile?.display_name || profile?.username || 'Member';
}

function formatPostTimestamp(value: string) {
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatCommentTimestamp(value: string) {
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function getCachedImageSource(uri: string): ImageURISource {
  return { uri, cache: 'force-cache' };
}

function getWallMedia(post: WallPost): WallMediaInfo | null {
  const mediaUrl = post.media_url || post.photo_url || post.image_url || null;
  if (!mediaUrl) return null;
  const mediaType = (post.media_type || '').toLowerCase().startsWith('video') || VIDEO_EXTENSION_RE.test(mediaUrl)
    ? 'video'
    : 'image';
  if (mediaType === 'video') {
    return { mediaType, previewUrl: mediaUrl, fullSizeUrl: mediaUrl };
  }
  return {
    mediaType,
    previewUrl: post.thumbnail_url || post.image_url || post.photo_url || mediaUrl,
    fullSizeUrl: post.media_url || post.photo_url || post.image_url || mediaUrl,
  };
}


function getPostVideoHtml(mediaUrl: string) {
  const src = JSON.stringify(mediaUrl);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:#000;width:100%;height:100%;overflow:hidden}video{width:100%;height:100%;object-fit:contain;background:#000}</style></head><body><video src=${src} controls playsinline webkit-playsinline preload="metadata"></video></body></html>`;
}

function mergeProfiles(postsData: WallPost[], profileMap: Record<string, Profile>): WallPost[] {
  return postsData.map((post) => ({
    ...post,
    profiles: profileMap[post.user_id] || { username: 'Member', display_name: null },
    post_reactions: (post.post_reactions || []).map((reaction) => ({
      ...reaction,
      profiles: profileMap[reaction.user_id] || { username: 'Member', display_name: null },
    })),
    post_comments: (post.post_comments || []).map((comment) => ({
      ...comment,
      profiles: profileMap[comment.user_id] || { username: 'Member', display_name: null },
    })),
  }));
}

async function fetchProfilesMap() {
  if (!supabase) return {};
  const { data, error } = await supabase.from('profiles').select('id, username, display_name');
  if (error) throw error;
  const profileMap: Record<string, Profile> = {};
  for (const profile of (data || []) as Array<Profile & { id: string }>) {
    profileMap[profile.id] = {
      username: profile.username,
      display_name: profile.display_name,
    };
  }
  return profileMap;
}

async function fetchWallPost(postId: string) {
  if (!supabase) return null;
  const [{ data, error }, profileMap] = await Promise.all([
    supabase
      .from('posts')
      .select('*, post_reactions(*), post_comments(*), beers(name, brewery, day_number, style, abv)')
      .eq('id', postId)
      .maybeSingle(),
    fetchProfilesMap(),
  ]);
  if (error) throw error;
  if (!data) return null;
  return mergeProfiles([data as WallPost], profileMap)[0];
}


export function NativeWallScreen({ initialBeerContext = null }: { initialBeerContext?: NativeWallBeerContext | null }) {
  const { user, loading: authLoading, configured } = useAuth();
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);
  const pickingMediaRef = useRef(false);

  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<NativeWallError | null>(null);
  const [composerText, setComposerText] = useState('');
  const [pickedMedia, setPickedMedia] = useState<PickedMedia | null>(null);
  const [posting, setPosting] = useState(false);
  const [pickingMedia, setPickingMedia] = useState(false);
  const [filterBeerId, setFilterBeerId] = useState<string | null>(initialBeerContext?.id ?? null);
  const [filterBeerLabel, setFilterBeerLabel] = useState(
    initialBeerContext ? `${initialBeerContext.name} · Day ${initialBeerContext.dayNumber}` : '',
  );
  const [tierNoticeVisible, setTierNoticeVisible] = useState(false);
  const [expandedPhotoUrl, setExpandedPhotoUrl] = useState<string | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(false);

  const signedInUserId = user?.id ?? null;
  const canPost = Boolean(signedInUserId && (composerText.trim() || pickedMedia) && !posting && !pickingMedia);
  const mediaButtonsDisabled = pickingMedia || posting;

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (!initialBeerContext) return;
    setFilterBeerId(initialBeerContext.id);
    setFilterBeerLabel(`${initialBeerContext.name} · Day ${initialBeerContext.dayNumber}`);
    // Do not pre-fill composer; beer context attaches behind the scenes for filtering only.
    setPosts([]);
    setHasMore(true);
  }, [initialBeerContext?.id, initialBeerContext?.name, initialBeerContext?.dayNumber]);

  const fetchPage = useCallback(async (pageIndex: number, replace = false, beerId: string | null = null) => {
    if (!supabase) {
      setError({
        title: 'Wall unavailable',
        detail: 'Supabase public configuration is missing in this native build.',
      });
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }

    if (pageIndex === 0 && !replace) setLoading(true);
    if (pageIndex > 0) setLoadingMore(true);
    setError(null);

    try {
      const from = pageIndex * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('posts')
        .select('*, post_reactions(*), post_comments(*), beers(name, brewery, day_number, style, abv)')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (beerId) query = query.eq('beer_id', beerId);

      const [{ data, error: fetchError }, profileMap] = await Promise.all([query, fetchProfilesMap()]);
      if (fetchError) throw fetchError;

      const incoming = mergeProfiles((data as WallPost[]) || [], profileMap);
      setPosts((prev) => (replace ? incoming : [...prev, ...incoming]));
      setHasMore(incoming.length === PAGE_SIZE);
      setPage(pageIndex);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setError({ title: 'Wall load failed', detail: message });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  const refreshWall = useCallback(async () => {
    setRefreshing(true);
    await fetchPage(0, true, filterBeerId);
  }, [fetchPage, filterBeerId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void fetchPage(0, true, filterBeerId);
  }, [authLoading, fetchPage, filterBeerId, user]);

  useEffect(() => {
    if (!supabase || !user?.id) return;
    let cancelled = false;
    void Promise.all([
      supabase.from('app_settings').select('tier_selection_open').eq('id', 1).maybeSingle(),
      supabase.from('profiles').select('tier').eq('id', user.id).maybeSingle(),
    ]).then(([settingsResult, profileResult]) => {
      if (cancelled) return;
      const settings = settingsResult.data as { tier_selection_open?: boolean } | null;
      const profile = profileResult.data as { tier?: string | null } | null;
      setTierNoticeVisible(Boolean(settings?.tier_selection_open && !profile?.tier));
    }).catch(() => {
      if (!cancelled) setTierNoticeVisible(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const reloadPost = useCallback(async (postId: string) => {
    try {
      const post = await fetchWallPost(postId);
      if (post) setPosts((prev) => prev.map((item) => (item.id === postId ? post : item)));
    } catch (reloadError) {
      console.warn('[HHS native wall] post reload failed:', reloadError instanceof Error ? reloadError.message : reloadError);
    }
  }, []);

  const handlePickMedia = useCallback(async (source: 'photo-library' | 'video-library' | 'camera') => {
    if (pickingMediaRef.current || !mountedRef.current) return;
    pickingMediaRef.current = true;
    setPickingMedia(true);
    try {
      const media = await pickWallMedia(source);
      if (media && mountedRef.current) setPickedMedia(media);
    } finally {
      pickingMediaRef.current = false;
      if (mountedRef.current) setPickingMedia(false);
    }
  }, []);

  const clearComposer = useCallback(() => {
    setComposerText('');
    setPickedMedia(null);
  }, []);

  const handlePost = useCallback(async () => {
    if (!user?.id || !canPost) return;
    setPosting(true);
    setError(null);

    try {
      const content = composerText.trim();
      const uploadedMedia = pickedMedia ? await uploadPostMedia(user.id, pickedMedia) : null;
      let postId: string | null = null;
      try {
        postId = await postViaWallApi(user.id, content, uploadedMedia, filterBeerId, true);
      } catch (apiError) {
        console.warn('[HHS native wall] post API failed; falling back to Supabase insert:', apiError instanceof Error ? apiError.message : apiError);
        postId = await insertPostDirectly(user.id, content, uploadedMedia, filterBeerId, true);
      }

      clearComposer();
      if (postId) {
        const post = await fetchWallPost(postId);
        if (post) setPosts((prev) => [post, ...prev]);
        else await refreshWall();
      } else {
        await refreshWall();
      }
    } catch (postError) {
      Alert.alert('Post failed', postError instanceof Error ? postError.message : 'Could not publish this post.');
    } finally {
      setPosting(false);
    }
  }, [canPost, clearComposer, composerText, filterBeerId, pickedMedia, refreshWall, user?.id]);

  const handleReact = useCallback(async (postId: string, reaction: ReactionKey) => {
    if (!user?.id) return;
    try {
      const response = await fetch(buildApiUrl('/api/wall/react'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, user_id: user.id, reaction }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await reloadPost(postId);
    } catch (reactError) {
      Alert.alert('Reaction failed', reactError instanceof Error ? reactError.message : 'Could not update the reaction.');
    }
  }, [reloadPost, user?.id]);

  const handleComment = useCallback(async (postId: string, content: string) => {
    if (!user?.id) return;
    try {
      const authHeaders = await getAuthenticatedApiHeaders(user.id);
      const response = await fetch(buildApiUrl('/api/wall/comment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ post_id: postId, user_id: user.id, content }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await reloadPost(postId);
    } catch (commentError) {
      Alert.alert('Comment failed', commentError instanceof Error ? commentError.message : 'Could not add this comment.');
    }
  }, [reloadPost, user?.id]);

  const handleEditComment = useCallback(async (post: WallPost, comment: WallComment, content: string) => {
    if (!supabase) throw new Error('Supabase is not configured for the native app.');
    if (!user?.id || comment.user_id !== user.id) throw new Error('You can only edit your own comments.');
    const nextContent = content.trim();
    if (!nextContent) throw new Error('Comment content cannot be empty.');
    const { error: updateError } = await supabase
      .from('post_comments')
      .update({ content: nextContent })
      .eq('id', comment.id)
      .eq('user_id', user.id);
    if (updateError) {
      Alert.alert('Edit failed', updateError.message);
      throw updateError;
    }
    await reloadPost(post.id);
  }, [reloadPost, user?.id]);

  const handleDeleteComment = useCallback((post: WallPost, comment: WallComment) => {
    if (!supabase || !user?.id || comment.user_id !== user.id) return;
    const wallClient = supabase;
    Alert.alert('Delete Comment', 'Remove this comment? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void wallClient
            .from('post_comments')
            .delete()
            .eq('id', comment.id)
            .eq('user_id', user.id)
            .then(({ error: deleteError }) => {
              if (deleteError) {
                Alert.alert('Delete failed', deleteError.message);
                return;
              }
              setPosts((prev) => prev.map((item) => (
                item.id === post.id
                  ? { ...item, post_comments: item.post_comments.filter((existing) => existing.id !== comment.id) }
                  : item
              )));
            });
        },
      },
    ]);
  }, [user?.id]);

  const handleDelete = useCallback((post: WallPost) => {
    if (!supabase || !user?.id || post.user_id !== user.id) return;
    const wallClient = supabase;
    Alert.alert('Delete Post', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void wallClient
            .from('posts')
            .delete()
            .eq('id', post.id)
            .eq('user_id', user.id)
            .then(({ error: deleteError }) => {
              if (deleteError) {
                Alert.alert('Delete failed', deleteError.message);
                return;
              }
              setPosts((prev) => prev.filter((item) => item.id !== post.id));
            });
        },
      },
    ]);
  }, [user?.id]);

  const handleEdit = useCallback(async (post: WallPost, content: string) => {
    if (!user?.id || post.user_id !== user.id) return;
    try {
      await patchPostViaWallApi(user.id, post.id, content);
      await reloadPost(post.id);
    } catch (editError) {
      Alert.alert('Edit failed', editError instanceof Error ? editError.message : 'Could not save this post.');
      throw editError;
    }
  }, [reloadPost, user?.id]);

  const handleBeerFilter = useCallback((post: WallPost) => {
    if (!post.beer_id || !post.beers) return;
    const label = `${post.beers.name}${post.beers.day_number ? ` · Day ${post.beers.day_number}` : ''}`;
    setFilterBeerId(post.beer_id);
    setFilterBeerLabel(label);
    setPosts([]);
    setHasMore(true);
    void fetchPage(0, true, post.beer_id);
  }, [fetchPage]);

  const clearBeerFilter = useCallback(() => {
    setFilterBeerId(null);
    setFilterBeerLabel('');
    setPosts([]);
    setHasMore(true);
    void fetchPage(0, true, null);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    void fetchPage(page + 1, false, filterBeerId);
  }, [fetchPage, filterBeerId, hasMore, loading, loadingMore, page]);

  const openPhotoLightbox = useCallback((url: string) => {
    setExpandedPhotoUrl(url);
    setLightboxLoading(true);
    // Warm the native image cache so large storage-backed originals do not
    // leave the lightbox blank while Android fetches them.
    void Image.prefetch(url).catch(() => undefined);
  }, []);

  const closePhotoLightbox = useCallback(() => {
    setExpandedPhotoUrl(null);
    setLightboxLoading(false);
  }, []);

  const authGate = useMemo(() => {
    if (authLoading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={HHS_COLORS.gold} />
          <Text style={styles.centerKicker}>Opening the archives...</Text>
        </View>
      );
    }

    if (!configured || !isSupabaseEnvConfigured) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.centerIcon}>🍺</Text>
          <Text style={styles.centerKicker}>Wall unavailable</Text>
          <Text style={styles.centerTitle}>Supabase is not configured in this native build.</Text>
        </View>
      );
    }

    if (!user) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.centerIcon}>🐦‍⬛</Text>
          <Text style={styles.centerKicker}>Members Only</Text>
          <Text style={styles.centerTitle}>This space belongs to the Society.</Text>
          <Text style={styles.centerBody}>Sign in from Settings to post, comment, and see what members are sharing.</Text>
        </View>
      );
    }

    return null;
  }, [authLoading, configured, user]);

  if (authGate) {
    return <View style={[styles.screen, { paddingTop: Math.max(16, insets.top + 10) }]}>{authGate}</View>;
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(18, insets.top + 8), paddingBottom: 132 }]}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent }) => {
          const distanceFromBottom = nativeEvent.contentSize.height - (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height);
          if (distanceFromBottom < 120) loadMore();
        }}
        scrollEventThrottle={400}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={HHS_COLORS.gold} onRefresh={refreshWall} />}
      >
        {tierNoticeVisible ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeKicker}>Society Notice</Text>
            <Text style={styles.noticeText}>Tier selection is open. Use the web account flow if you still need to choose a Society tier.</Text>
          </View>
        ) : null}

        <View style={styles.composerCard}>
          <TextInput
            value={composerText}
            onChangeText={setComposerText}
            placeholder={filterBeerId ? 'Post about this beer...' : 'Share your thoughts with the Society...'}
            placeholderTextColor={HHS_COLORS.muted}
            multiline
            numberOfLines={3}
            style={styles.composerInput}
            textAlignVertical="top"
          />
          {pickedMedia ? (
            <View style={styles.previewWrap}>
              {pickedMedia.mediaType === 'video' ? (
                <View style={styles.previewVideo}>
                  <Text style={styles.previewVideoIcon}>🎥</Text>
                  <Text style={styles.previewVideoText} numberOfLines={2}>{pickedMedia.fileName}</Text>
                </View>
              ) : (
                <Image source={{ uri: pickedMedia.uri }} style={styles.previewImage} resizeMode="cover" />
              )}
              <TouchableOpacity style={styles.previewRemove} onPress={() => setPickedMedia(null)} activeOpacity={0.78}>
                <Text style={styles.previewRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.composerActions}>
            <View style={styles.photoButtons}>
              <TouchableOpacity
                style={[styles.ghostButton, mediaButtonsDisabled && styles.ghostButtonDisabled]}
                onPress={() => handlePickMedia('photo-library')}
                disabled={mediaButtonsDisabled}
                activeOpacity={0.78}
              >
                <Text style={[styles.ghostButtonText, mediaButtonsDisabled && styles.ghostButtonTextDisabled]}>
                  {pickingMedia ? 'Opening...' : '📎 Photo'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ghostButton, mediaButtonsDisabled && styles.ghostButtonDisabled]}
                onPress={() => handlePickMedia('camera')}
                disabled={mediaButtonsDisabled}
                activeOpacity={0.78}
              >
                <Text style={[styles.ghostButtonText, mediaButtonsDisabled && styles.ghostButtonTextDisabled]}>📷 Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ghostButton, mediaButtonsDisabled && styles.ghostButtonDisabled]}
                onPress={() => handlePickMedia('video-library')}
                disabled={mediaButtonsDisabled}
                activeOpacity={0.78}
              >
                <Text style={[styles.ghostButtonText, mediaButtonsDisabled && styles.ghostButtonTextDisabled]}>🎥 Video</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.postButton, !canPost && styles.postButtonDisabled]}
              disabled={!canPost}
              onPress={handlePost}
              activeOpacity={0.82}
            >
              {posting ? (
                <ActivityIndicator color={HHS_COLORS.background} size="small" />
              ) : (
                <Text style={[styles.postButtonText, !canPost && styles.postButtonTextDisabled]}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>The Wall</Text>
          <View style={styles.dividerLine} />
        </View>

        {filterBeerId ? (
          <View style={styles.filterBanner}>
            <Text style={styles.filterText}>🍺 {filterBeerLabel}</Text>
            <TouchableOpacity onPress={clearBeerFilter} activeOpacity={0.78}>
              <Text style={styles.filterClear}>✕ all posts</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={HHS_COLORS.gold} />
            <Text style={styles.loadingText}>Consulting the archives...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{error.title}</Text>
            <Text style={styles.errorDetail}>{error.detail}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refreshWall} activeOpacity={0.82}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🍺</Text>
            <Text style={styles.emptyText}>The wall is empty. Be the first to post.</Text>
          </View>
        ) : (
          <View style={styles.feed}>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                userId={signedInUserId}
                onReact={handleReact}
                onComment={handleComment}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onEditComment={handleEditComment}
                onDeleteComment={handleDeleteComment}
                onBeerFilter={handleBeerFilter}
                onOpenPhoto={openPhotoLightbox}
              />
            ))}
          </View>
        )}

        {!loading && !error && posts.length > 0 ? (
          hasMore ? (
            <TouchableOpacity style={styles.loadMoreButton} disabled={loadingMore} onPress={loadMore} activeOpacity={0.82}>
              {loadingMore ? <ActivityIndicator color={HHS_COLORS.gold} /> : <Text style={styles.loadMoreText}>Load more...</Text>}
            </TouchableOpacity>
          ) : (
            <View style={styles.endRow}>
              <View style={styles.endLine} />
              <Text style={styles.endText}>End of the Wall</Text>
              <View style={styles.endLine} />
            </View>
          )
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(expandedPhotoUrl)} transparent animationType="fade" onRequestClose={closePhotoLightbox} statusBarTranslucent>
        <Pressable style={styles.lightboxBackdrop} onPress={closePhotoLightbox}>
          {expandedPhotoUrl ? (
            <>
              {lightboxLoading ? (
                <View style={styles.lightboxLoading}>
                  <ActivityIndicator color={HHS_COLORS.gold} size="large" />
                  <Text style={styles.lightboxLoadingText}>Loading photo...</Text>
                </View>
              ) : null}
              <View pointerEvents="none" style={styles.lightboxImageFrame}>
                <Image
                  source={getCachedImageSource(expandedPhotoUrl)}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                  onLoadStart={() => setLightboxLoading(true)}
                  onLoadEnd={() => setLightboxLoading(false)}
                  onError={() => setLightboxLoading(false)}
                />
              </View>
            </>
          ) : null}
          <TouchableOpacity style={[styles.lightboxClose, { top: Math.max(18, insets.top + 8) }]} onPress={closePhotoLightbox} activeOpacity={0.8}>
            <Text style={styles.lightboxCloseText}>✕</Text>
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  );
}

function PostCard({
  post,
  userId,
  onReact,
  onComment,
  onEdit,
  onDelete,
  onEditComment,
  onDeleteComment,
  onBeerFilter,
  onOpenPhoto,
}: {
  post: WallPost;
  userId: string | null;
  onReact: (postId: string, reaction: ReactionKey) => Promise<void>;
  onComment: (postId: string, content: string) => Promise<void>;
  onEdit: (post: WallPost, content: string) => Promise<void>;
  onDelete: (post: WallPost) => void;
  onEditComment: (post: WallPost, comment: WallComment, content: string) => Promise<void>;
  onDeleteComment: (post: WallPost, comment: WallComment) => void;
  onBeerFilter: (post: WallPost) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [reactionViewerVisible, setReactionViewerVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditText, setCommentEditText] = useState('');
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [commentEditError, setCommentEditError] = useState('');

  const reactions = post.post_reactions || [];
  const comments = [...(post.post_comments || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const reactionGroups = REACTIONS
    .map((reaction) => ({
      reaction,
      names: reactions
        .filter((item) => item.reaction === reaction.key)
        .map((item) => getDisplayName(item.profiles)),
    }))
    .filter((group) => group.names.length > 0);

  const submitComment = useCallback(async () => {
    const content = commentText.trim();
    if (!content || submittingComment) return;
    setSubmittingComment(true);
    await onComment(post.id, content);
    setCommentText('');
    setSubmittingComment(false);
  }, [commentText, onComment, post.id, submittingComment]);

  const startEdit = useCallback(() => {
    setEditText(post.content);
    setEditError('');
    setEditing(true);
  }, [post.content]);

  const saveEdit = useCallback(async () => {
    const nextContent = editText.trim();
    if (!nextContent) {
      setEditError('Post content cannot be empty.');
      return;
    }
    if (savingEdit) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await onEdit(post, nextContent);
      setEditing(false);
    } catch {
      setEditError('Unable to save edit.');
    } finally {
      setSavingEdit(false);
    }
  }, [editText, onEdit, post, savingEdit]);

  const startCommentEdit = useCallback((comment: WallComment) => {
    setEditingCommentId(comment.id);
    setCommentEditText(comment.content);
    setCommentEditError('');
  }, []);

  const cancelCommentEdit = useCallback(() => {
    setEditingCommentId(null);
    setCommentEditText('');
    setCommentEditError('');
  }, []);

  const saveCommentEdit = useCallback(async (comment: WallComment) => {
    const nextContent = commentEditText.trim();
    if (!nextContent) {
      setCommentEditError('Comment cannot be empty.');
      return;
    }
    if (savingCommentId) return;
    setSavingCommentId(comment.id);
    setCommentEditError('');
    try {
      await onEditComment(post, comment, nextContent);
      cancelCommentEdit();
    } catch {
      setCommentEditError('Unable to save comment.');
    } finally {
      setSavingCommentId(null);
    }
  }, [cancelCommentEdit, commentEditText, onEditComment, post, savingCommentId]);

  const media = getWallMedia(post);
  const mediaUrl = media?.fullSizeUrl ?? null;
  const hasVideo = media?.mediaType === 'video';
  const imageUrl = media?.mediaType === 'image' ? media.previewUrl : null;
  const fullSizeImageUrl = media?.mediaType === 'image' ? media.fullSizeUrl : null;
  const updatedAtMs = post.updated_at ? new Date(post.updated_at).getTime() : 0;
  const createdAtMs = new Date(post.created_at).getTime();
  const isEdited = Boolean(updatedAtMs && updatedAtMs - createdAtMs > 1000);

  return (
    <View style={styles.postCard}>
      {post.beers ? (
        <TouchableOpacity style={styles.beerTag} onPress={() => onBeerFilter(post)} activeOpacity={0.78}>
          <Text style={styles.beerTagText}>🍺 {post.beers.name}{post.beers.day_number ? ` · Day ${post.beers.day_number}` : ''}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.postHeader}>
        <Text style={styles.postAuthor}>{getDisplayName(post.profiles)}</Text>
        <Text style={styles.postTimestamp}>· {formatPostTimestamp(post.created_at)}{isEdited ? ' · edited' : ''}</Text>
        {userId && post.user_id === userId ? (
          <View style={styles.ownerActions}>
            <TouchableOpacity style={styles.ownerActionButton} onPress={startEdit} disabled={editing} activeOpacity={0.72}>
              <Text style={[styles.ownerActionText, editing && styles.ownerActionTextDisabled]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ownerActionButton} onPress={() => onDelete(post)} activeOpacity={0.72}>
              <Text style={styles.ownerActionText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {editing ? (
        <View style={styles.editBox}>
          <TextInput
            value={editText}
            onChangeText={(value) => {
              setEditText(value);
              if (editError) setEditError('');
            }}
            multiline
            numberOfLines={4}
            style={[styles.editInput, editError ? styles.editInputError : null]}
            textAlignVertical="top"
          />
          {editError ? <Text style={styles.editErrorText}>{editError}</Text> : null}
          <View style={styles.editActions}>
            <TouchableOpacity
              style={styles.editCancelButton}
              disabled={savingEdit}
              onPress={() => {
                setEditText(post.content);
                setEditError('');
                setEditing(false);
              }}
              activeOpacity={0.78}
            >
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.editSaveButton, (!editText.trim() || savingEdit) && styles.editSaveButtonDisabled]}
              disabled={!editText.trim() || savingEdit}
              onPress={saveEdit}
              activeOpacity={0.82}
            >
              {savingEdit ? <ActivityIndicator color={HHS_COLORS.background} size="small" /> : <Text style={styles.editSaveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        post.content ? <Text style={styles.postContent}>{post.content}</Text> : null
      )}

      {hasVideo && mediaUrl ? (
        <View style={styles.videoWrap}>
          <WebView
            source={{ html: getPostVideoHtml(mediaUrl) }}
            style={styles.postVideoWebView}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled={false}
            domStorageEnabled={false}
            scrollEnabled={false}
          />
        </View>
      ) : null}

      {imageUrl ? (
        <TouchableOpacity style={styles.photoWrap} onPress={() => onOpenPhoto(fullSizeImageUrl || imageUrl)} activeOpacity={0.88}>
          <Image
            source={getCachedImageSource(imageUrl)}
            style={styles.postPhoto}
            resizeMode="cover"
            onLoadEnd={() => {
              if (fullSizeImageUrl && fullSizeImageUrl !== imageUrl) {
                void Image.prefetch(fullSizeImageUrl).catch(() => undefined);
              }
            }}
          />
        </TouchableOpacity>
      ) : null}

      <View style={styles.reactionRow}>
        {REACTIONS.map((reaction) => {
          const count = reactions.filter((item) => item.reaction === reaction.key).length;
          const active = Boolean(userId && reactions.some((item) => item.reaction === reaction.key && item.user_id === userId));
          return (
            <TouchableOpacity
              key={reaction.key}
              style={[styles.reactionButton, active && styles.reactionButtonActive]}
              onPress={() => userId && onReact(post.id, reaction.key)}
              onLongPress={() => count > 0 && setReactionViewerVisible(true)}
              disabled={!userId}
              activeOpacity={0.78}
              accessibilityHint={count > 0 ? 'Long press to see who reacted.' : undefined}
            >
              <Text style={[styles.reactionEmoji, !active && styles.reactionEmojiInactive]}>{reaction.emoji}</Text>
              {count > 0 ? <Text style={[styles.reactionCount, active && styles.reactionCountActive]}>{count}</Text> : null}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[styles.commentToggle, showComments && styles.commentToggleActive]}
          onPress={() => setShowComments((value) => !value)}
          activeOpacity={0.78}
          accessibilityLabel={comments.length > 0 ? `${comments.length} comments` : 'Add a comment'}
        >
          <View style={styles.commentIconBubble}>
            <View style={styles.commentIconTail} />
          </View>
          {comments.length > 0 ? <Text style={styles.commentToggleText}>{comments.length}</Text> : null}
        </TouchableOpacity>
      </View>

      {showComments ? (
        <View style={styles.commentsBox}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.commentItem}>
              <View style={styles.commentHeader}>
                <Text style={styles.commentAuthor}>{getDisplayName(comment.profiles)}</Text>
                <Text style={styles.commentTimestamp}>· {formatCommentTimestamp(comment.created_at)}</Text>
                {userId && comment.user_id === userId ? (
                  <View style={styles.commentOwnerActions}>
                    <TouchableOpacity
                      style={styles.commentOwnerActionButton}
                      onPress={() => startCommentEdit(comment)}
                      disabled={editingCommentId === comment.id || savingCommentId === comment.id}
                      activeOpacity={0.72}
                    >
                      <Text style={[
                        styles.commentOwnerActionText,
                        (editingCommentId === comment.id || savingCommentId === comment.id) && styles.ownerActionTextDisabled,
                      ]}>
                        Edit
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.commentOwnerActionButton}
                      onPress={() => onDeleteComment(post, comment)}
                      disabled={savingCommentId === comment.id}
                      activeOpacity={0.72}
                    >
                      <Text style={styles.commentOwnerActionText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
              {editingCommentId === comment.id ? (
                <View style={styles.commentEditBox}>
                  <TextInput
                    value={commentEditText}
                    onChangeText={(value) => {
                      setCommentEditText(value);
                      if (commentEditError) setCommentEditError('');
                    }}
                    multiline
                    style={[styles.commentEditInput, commentEditError ? styles.editInputError : null]}
                    textAlignVertical="top"
                  />
                  {commentEditError ? <Text style={styles.editErrorText}>{commentEditError}</Text> : null}
                  <View style={styles.commentEditActions}>
                    <TouchableOpacity
                      style={styles.editCancelButton}
                      disabled={savingCommentId === comment.id}
                      onPress={cancelCommentEdit}
                      activeOpacity={0.78}
                    >
                      <Text style={styles.editCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editSaveButton, (!commentEditText.trim() || savingCommentId === comment.id) && styles.editSaveButtonDisabled]}
                      disabled={!commentEditText.trim() || savingCommentId === comment.id}
                      onPress={() => saveCommentEdit(comment)}
                      activeOpacity={0.82}
                    >
                      {savingCommentId === comment.id ? (
                        <ActivityIndicator color={HHS_COLORS.background} size="small" />
                      ) : (
                        <Text style={styles.editSaveText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={styles.commentContent}>{comment.content}</Text>
              )}
            </View>
          ))}
          {userId ? (
            <View style={styles.commentComposer}>
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment..."
                placeholderTextColor={HHS_COLORS.muted}
                style={styles.commentInput}
                returnKeyType="send"
                onSubmitEditing={submitComment}
              />
              <TouchableOpacity
                style={[styles.commentPostButton, !commentText.trim() && styles.commentPostButtonDisabled]}
                disabled={!commentText.trim() || submittingComment}
                onPress={submitComment}
                activeOpacity={0.82}
              >
                {submittingComment ? <ActivityIndicator color={HHS_COLORS.background} size="small" /> : <Text style={styles.commentPostButtonText}>Post</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      <Modal visible={reactionViewerVisible} transparent animationType="fade" onRequestClose={() => setReactionViewerVisible(false)}>
        <Pressable style={styles.likersBackdrop} onPress={() => setReactionViewerVisible(false)}>
          <Pressable style={styles.likersCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.likersKicker}>Wall Reactions</Text>
            <Text style={styles.likersTitle}>All reactions</Text>
            <Text style={styles.likersSubtitle}>People who reacted to this post, grouped by reaction</Text>
            {reactionGroups.length > 0 ? (
              reactionGroups.map((group) => (
                <View key={group.reaction.key} style={styles.likerGroup}>
                  <Text style={styles.likerGroupTitle}>{group.reaction.emoji} {group.reaction.label}</Text>
                  {group.names.map((name, index) => (
                    <Text key={`${group.reaction.key}-${name}-${index}`} style={styles.likerName}>{name}</Text>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.likersEmpty}>No reactions yet.</Text>
            )}
            <TouchableOpacity style={styles.likersCloseButton} onPress={() => setReactionViewerVisible(false)} activeOpacity={0.82}>
              <Text style={styles.likersCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: HHS_COLORS.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  centerIcon: {
    fontSize: 74,
    marginBottom: 18,
  },
  centerKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    marginTop: 12,
    textAlign: 'center',
  },
  centerTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 25,
    lineHeight: 34,
    marginTop: 14,
    textAlign: 'center',
  },
  centerBody: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 12,
    textAlign: 'center',
  },
  noticeCard: {
    backgroundColor: HHS_COLORS.goldDim,
    borderColor: HHS_COLORS.borderStrong,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  noticeKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 10,
    marginBottom: 7,
  },
  noticeText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 14,
    lineHeight: 21,
  },
  composerCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 26,
    padding: 16,
  },
  composerInput: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 15,
    lineHeight: 23,
    minHeight: 88,
    padding: 0,
  },
  previewWrap: {
    alignSelf: 'flex-start',
    marginTop: 12,
    maxWidth: '100%',
  },
  previewImage: {
    borderRadius: 8,
    height: 190,
    width: 260,
  },
  previewVideo: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 150,
    justifyContent: 'center',
    padding: 16,
    width: 260,
  },
  previewVideoIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  previewVideoText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 13,
    textAlign: 'center',
  },
  previewRemove: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 7,
    top: 7,
    width: 28,
  },
  previewRemoveText: {
    ...HHS_TYPOGRAPHY.body,
    color: '#fff',
    fontSize: 12,
  },
  composerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-start',
    marginTop: 12,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  ghostButton: {
    alignItems: 'center',
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  ghostButtonDisabled: {
    opacity: 0.45,
  },
  ghostButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
  },
  ghostButtonTextDisabled: {
    color: HHS_COLORS.muted,
  },
  postButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    minWidth: 82,
    paddingHorizontal: 18,
  },
  postButtonDisabled: {
    backgroundColor: 'transparent',
    borderColor: HHS_COLORS.border,
    borderWidth: 1,
  },
  postButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 12,
  },
  postButtonTextDisabled: {
    color: HHS_COLORS.gold,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  dividerLine: {
    backgroundColor: 'rgba(255,140,0,0.35)',
    flex: 1,
    height: 1,
  },
  dividerText: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 10,
  },
  filterBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,140,0,0.08)',
    borderColor: 'rgba(255,140,0,0.3)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filterText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    flex: 1,
    fontSize: 13,
  },
  filterClear: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: 58,
  },
  loadingText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 15,
    marginTop: 12,
  },
  errorCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
  },
  errorTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.danger,
    fontSize: 18,
    marginBottom: 8,
  },
  errorDetail: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 14,
    lineHeight: 22,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: 8,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  retryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 58,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 16,
    textAlign: 'center',
  },
  feed: {
    gap: 12,
  },
  postCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  beerTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,140,0,0.1)',
    borderColor: 'rgba(255,140,0,0.25)',
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  beerTagText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 11,
    letterSpacing: 1.1,
  },
  postHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    marginBottom: 10,
  },
  postAuthor: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 15,
  },
  postTimestamp: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 12,
    marginLeft: 6,
  },
  ownerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginLeft: 'auto',
  },
  ownerActionButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  ownerActionText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
    opacity: 0.75,
  },
  ownerActionTextDisabled: {
    opacity: 0.35,
  },
  postContent: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 16,
    lineHeight: 26,
  },
  editBox: {
    gap: 8,
  },
  editInput: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: HHS_COLORS.background,
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: HHS_COLORS.text,
    fontSize: 15,
    lineHeight: 23,
    minHeight: 104,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  editInputError: {
    borderColor: HHS_COLORS.danger,
  },
  editErrorText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.danger,
    fontSize: 12,
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  editCancelButton: {
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  editCancelText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
  },
  editSaveButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: 8,
    justifyContent: 'center',
    minWidth: 70,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  editSaveButtonDisabled: {
    backgroundColor: HHS_COLORS.goldDim,
  },
  editSaveText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 12,
  },
  photoWrap: {
    alignSelf: 'stretch',
    marginTop: 12,
    maxWidth: '100%',
  },
  postPhoto: {
    borderRadius: 8,
    height: 250,
    width: '100%',
  },
  videoWrap: {
    alignSelf: 'stretch',
    backgroundColor: '#000',
    borderRadius: 8,
    height: 250,
    marginTop: 12,
    overflow: 'hidden',
  },
  postVideoWebView: {
    backgroundColor: '#000',
    flex: 1,
  },
  reactionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 5,
    marginTop: 14,
  },
  reactionButton: {
    alignItems: 'center',
    borderColor: HHS_COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    minHeight: 30,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  reactionButtonActive: {
    backgroundColor: HHS_COLORS.goldDim,
    borderColor: 'rgba(217,124,43,0.4)',
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionEmojiInactive: {
    opacity: Platform.OS === 'android' ? 0.62 : 0.7,
  },
  reactionCount: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 12,
  },
  reactionCountActive: {
    color: HHS_COLORS.gold,
  },
  commentToggle: {
    alignItems: 'center',
    borderColor: HHS_COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    marginLeft: 'auto',
    minHeight: 30,
    minWidth: 34,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  commentToggleActive: {
    backgroundColor: HHS_COLORS.goldDim,
    borderColor: 'rgba(217,124,43,0.4)',
  },
  commentIconBubble: {
    borderColor: HHS_COLORS.gold,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 13,
    width: 15,
  },
  commentIconTail: {
    backgroundColor: HHS_COLORS.card,
    borderBottomColor: HHS_COLORS.gold,
    borderBottomWidth: 1.5,
    borderRightColor: HHS_COLORS.gold,
    borderRightWidth: 1.5,
    bottom: -4,
    height: 6,
    left: 3,
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    width: 6,
  },
  commentToggleText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 12,
  },
  commentsBox: {
    borderTopColor: HHS_COLORS.border,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  commentItem: {
    marginBottom: 10,
  },
  commentHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 6,
  },
  commentAuthor: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 13,
  },
  commentTimestamp: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 11,
  },
  commentOwnerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginLeft: 'auto',
  },
  commentOwnerActionButton: {
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  commentOwnerActionText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 12,
    opacity: 0.75,
  },
  commentContent: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 3,
  },
  commentEditBox: {
    gap: 7,
    marginTop: 6,
  },
  commentEditInput: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: HHS_COLORS.background,
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: HHS_COLORS.text,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 72,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  commentEditActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  commentComposer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  commentInput: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: HHS_COLORS.background,
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: HHS_COLORS.text,
    flex: 1,
    fontSize: 14,
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  commentPostButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 62,
    paddingHorizontal: 13,
  },
  commentPostButtonDisabled: {
    backgroundColor: HHS_COLORS.cardAlt,
  },
  commentPostButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.background,
    fontSize: 12,
  },
  likersBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  likersCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 360,
    padding: 20,
    width: '100%',
  },
  likersKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 10,
    marginBottom: 8,
  },
  likersTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 20,
    marginBottom: 4,
  },
  likersSubtitle: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 12,
    marginBottom: 12,
  },
  likerGroup: {
    borderTopColor: HHS_COLORS.border,
    borderTopWidth: 1,
    paddingTop: 10,
    paddingBottom: 4,
  },
  likerGroupTitle: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  likerName: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 15,
    paddingVertical: 6,
  },
  likersEmpty: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 14,
    paddingVertical: 10,
  },
  likersCloseButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: 8,
    marginTop: 16,
    paddingVertical: 10,
  },
  likersCloseText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 12,
  },
  loadMoreButton: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 16,
  },
  loadMoreText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 14,
    letterSpacing: 1.2,
  },
  endRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 34,
  },
  endLine: {
    backgroundColor: HHS_COLORS.border,
    flex: 1,
    height: 1,
  },
  endText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 11,
    letterSpacing: 2,
  },
  lightboxBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
    flex: 1,
    justifyContent: 'center',
  },
  lightboxImageFrame: {
    height: '90%',
    width: '95%',
  },
  lightboxImage: {
    borderRadius: 8,
    height: '100%',
    width: '100%',
  },
  lightboxLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '45%',
    zIndex: 2,
  },
  lightboxLoadingText: {
    ...HHS_TYPOGRAPHY.body,
    color: '#fff',
    fontSize: 13,
    marginTop: 10,
    opacity: 0.82,
  },
  lightboxClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    width: 36,
  },
  lightboxCloseText: {
    ...HHS_TYPOGRAPHY.body,
    color: '#fff',
    fontSize: 16,
  },
});
