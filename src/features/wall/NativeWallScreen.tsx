import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HHS_WEB_ORIGIN, isSupabaseEnvConfigured } from '../../config/env';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';

const PAGE_SIZE = 15;
const PHOTO_BUCKET = 'post-photos';

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
  user_id: string;
  profiles: Profile | null;
};

type WallPost = {
  id: string;
  content: string;
  photo_url: string | null;
  created_at: string;
  beer_id: string | null;
  user_id: string;
  profiles: Profile | null;
  post_reactions: { id: string; user_id: string; reaction: string }[];
  post_comments: WallComment[];
  beers: { name: string; brewery: string; day_number: number | null; style: string | null; abv: number | null } | null;
};

type PickedPhoto = {
  uri: string;
  mimeType: string;
  fileName: string;
};

type NativeWallError = {
  title: string;
  detail: string;
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

function getPhotoExtension(photo: PickedPhoto) {
  const fromName = photo.fileName.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  if (photo.mimeType.includes('png')) return 'png';
  if (photo.mimeType.includes('webp')) return 'webp';
  return 'jpg';
}

function mergeProfiles(postsData: WallPost[], profileMap: Record<string, Profile>): WallPost[] {
  return postsData.map((post) => ({
    ...post,
    profiles: profileMap[post.user_id] || { username: 'Member', display_name: null },
    post_reactions: post.post_reactions || [],
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

async function uploadPostPhoto(userId: string, photo: PickedPhoto) {
  if (!supabase) throw new Error('Supabase is not configured for the native app.');
  const ext = getPhotoExtension(photo);
  const path = `${userId}/${Date.now()}.${ext}`;
  const response = await fetch(photo.uri);
  const body = await response.arrayBuffer();
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, {
    contentType: photo.mimeType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function buildApiUrl(path: string) {
  return `${HHS_WEB_ORIGIN}${path}`;
}

async function readApiError(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed (${response.status}).`;
  try {
    const json = JSON.parse(text) as { error?: string };
    return json.error || text;
  } catch {
    return text;
  }
}

async function postViaWallApi(userId: string, content: string, photoUrl: string | null, beerId: string | null) {
  const response = await fetch(buildApiUrl('/api/wall/post'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, content, beer_id: beerId, photo_url: photoUrl }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const json = await response.json() as { post?: { id?: string } };
  return json.post?.id ?? null;
}

async function insertPostDirectly(userId: string, content: string, photoUrl: string | null, beerId: string | null) {
  if (!supabase) throw new Error('Supabase is not configured for the native app.');
  const { data, error } = await supabase
    .from('posts')
    .insert({ user_id: userId, content, beer_id: beerId, photo_url: photoUrl })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return (data as { id?: string } | null)?.id ?? null;
}

export function NativeWallScreen({ initialBeerContext = null }: { initialBeerContext?: NativeWallBeerContext | null }) {
  const { user, loading: authLoading, configured } = useAuth();
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<NativeWallError | null>(null);
  const [composerText, setComposerText] = useState('');
  const [pickedPhoto, setPickedPhoto] = useState<PickedPhoto | null>(null);
  const [posting, setPosting] = useState(false);
  const [filterBeerId, setFilterBeerId] = useState<string | null>(initialBeerContext?.id ?? null);
  const [filterBeerLabel, setFilterBeerLabel] = useState(
    initialBeerContext ? `${initialBeerContext.name} · Day ${initialBeerContext.dayNumber}` : '',
  );
  const [tierNoticeVisible, setTierNoticeVisible] = useState(false);
  const [expandedPhotoUrl, setExpandedPhotoUrl] = useState<string | null>(null);

  const signedInUserId = user?.id ?? null;
  const canPost = Boolean(signedInUserId && (composerText.trim() || pickedPhoto) && !posting);

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

  const handlePickPhoto = useCallback(async (source: 'library' | 'camera') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera blocked', 'Camera permission is required to add a new photo from the camera.');
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Photos blocked', 'Photo library permission is required to add an existing photo.');
          return;
        }
      }

      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      setPickedPhoto({
        uri: asset.uri,
        mimeType: asset.mimeType || 'image/jpeg',
        fileName: asset.fileName || `wall-photo-${Date.now()}.jpg`,
      });
    } catch (pickError) {
      Alert.alert('Photo error', pickError instanceof Error ? pickError.message : 'Could not pick a photo.');
    }
  }, []);

  const clearComposer = useCallback(() => {
    setComposerText('');
    setPickedPhoto(null);
  }, []);

  const handlePost = useCallback(async () => {
    if (!user?.id || !canPost) return;
    setPosting(true);
    setError(null);

    try {
      const content = composerText.trim();
      const photoUrl = pickedPhoto ? await uploadPostPhoto(user.id, pickedPhoto) : null;
      let postId: string | null = null;
      try {
        postId = await postViaWallApi(user.id, content, photoUrl, filterBeerId);
      } catch (apiError) {
        console.warn('[HHS native wall] post API failed; falling back to Supabase insert:', apiError instanceof Error ? apiError.message : apiError);
        postId = await insertPostDirectly(user.id, content, photoUrl, filterBeerId);
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
  }, [canPost, clearComposer, composerText, filterBeerId, pickedPhoto, refreshWall, user?.id]);

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
      const response = await fetch(buildApiUrl('/api/wall/comment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, user_id: user.id, content }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await reloadPost(postId);
    } catch (commentError) {
      Alert.alert('Comment failed', commentError instanceof Error ? commentError.message : 'Could not add this comment.');
    }
  }, [reloadPost, user?.id]);

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
          {pickedPhoto ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: pickedPhoto.uri }} style={styles.previewImage} resizeMode="cover" />
              <TouchableOpacity style={styles.previewRemove} onPress={() => setPickedPhoto(null)} activeOpacity={0.78}>
                <Text style={styles.previewRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.composerActions}>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.ghostButton} onPress={() => handlePickPhoto('library')} activeOpacity={0.78}>
                <Text style={styles.ghostButtonText}>📎 Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostButton} onPress={() => handlePickPhoto('camera')} activeOpacity={0.78}>
                <Text style={styles.ghostButtonText}>📷 Camera</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.postButton, !canPost && styles.postButtonDisabled]}
              disabled={!canPost}
              onPress={handlePost}
              activeOpacity={0.82}
            >
              {posting ? <ActivityIndicator color={HHS_COLORS.background} size="small" /> : <Text style={styles.postButtonText}>Post</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>The Society Wall</Text>
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
                onDelete={handleDelete}
                onBeerFilter={handleBeerFilter}
                onOpenPhoto={setExpandedPhotoUrl}
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

      <Modal visible={Boolean(expandedPhotoUrl)} transparent animationType="fade" onRequestClose={() => setExpandedPhotoUrl(null)} statusBarTranslucent>
        <Pressable style={styles.lightboxBackdrop} onPress={() => setExpandedPhotoUrl(null)}>
          {expandedPhotoUrl ? (
            <Image source={{ uri: expandedPhotoUrl }} style={styles.lightboxImage} resizeMode="contain" />
          ) : null}
          <TouchableOpacity style={[styles.lightboxClose, { top: Math.max(18, insets.top + 8) }]} onPress={() => setExpandedPhotoUrl(null)} activeOpacity={0.8}>
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
  onDelete,
  onBeerFilter,
  onOpenPhoto,
}: {
  post: WallPost;
  userId: string | null;
  onReact: (postId: string, reaction: ReactionKey) => Promise<void>;
  onComment: (postId: string, content: string) => Promise<void>;
  onDelete: (post: WallPost) => void;
  onBeerFilter: (post: WallPost) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const reactions = post.post_reactions || [];
  const comments = [...(post.post_comments || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const submitComment = useCallback(async () => {
    const content = commentText.trim();
    if (!content || submittingComment) return;
    setSubmittingComment(true);
    await onComment(post.id, content);
    setCommentText('');
    setSubmittingComment(false);
  }, [commentText, onComment, post.id, submittingComment]);

  return (
    <View style={styles.postCard}>
      {post.beers ? (
        <TouchableOpacity style={styles.beerTag} onPress={() => onBeerFilter(post)} activeOpacity={0.78}>
          <Text style={styles.beerTagText}>🍺 {post.beers.name}{post.beers.day_number ? ` · Day ${post.beers.day_number}` : ''}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.postHeader}>
        <Text style={styles.postAuthor}>{getDisplayName(post.profiles)}</Text>
        <Text style={styles.postTimestamp}>· {formatPostTimestamp(post.created_at)}</Text>
        {userId && post.user_id === userId ? (
          <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(post)} activeOpacity={0.72}>
            <Text style={styles.deleteButtonText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {post.content ? <Text style={styles.postContent}>{post.content}</Text> : null}

      {post.photo_url ? (
        <TouchableOpacity style={styles.photoWrap} onPress={() => onOpenPhoto(post.photo_url!)} activeOpacity={0.88}>
          <Image source={{ uri: post.photo_url }} style={styles.postPhoto} resizeMode="cover" />
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
              disabled={!userId}
              activeOpacity={0.78}
            >
              <Text style={[styles.reactionEmoji, !active && styles.reactionEmojiInactive]}>{reaction.emoji}</Text>
              {count > 0 ? <Text style={[styles.reactionCount, active && styles.reactionCountActive]}>{count}</Text> : null}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.commentToggle} onPress={() => setShowComments((value) => !value)} activeOpacity={0.78}>
          <Text style={styles.commentToggleText}>💬 {comments.length > 0 ? comments.length : 'Comment'}</Text>
        </TouchableOpacity>
      </View>

      {showComments ? (
        <View style={styles.commentsBox}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.commentItem}>
              <View style={styles.commentHeader}>
                <Text style={styles.commentAuthor}>{getDisplayName(comment.profiles)}</Text>
                <Text style={styles.commentTimestamp}>· {formatCommentTimestamp(comment.created_at)}</Text>
              </View>
              <Text style={styles.commentContent}>{comment.content}</Text>
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
    fontWeight: '700',
  },
  composerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  ghostButton: {
    borderColor: HHS_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  ghostButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
  },
  postButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 82,
    paddingHorizontal: 18,
    paddingVertical: 8,
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
    fontWeight: '700',
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
    fontWeight: '700',
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
    fontWeight: '700',
  },
  postTimestamp: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 12,
    marginLeft: 6,
  },
  deleteButton: {
    marginLeft: 'auto',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  deleteButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
    opacity: 0.75,
  },
  postContent: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 16,
    lineHeight: 26,
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
  reactionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 14,
  },
  reactionButton: {
    alignItems: 'center',
    borderColor: HHS_COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 30,
    paddingHorizontal: 9,
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
    borderColor: HHS_COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 'auto',
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  commentToggleText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
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
    fontWeight: '700',
  },
  commentTimestamp: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 11,
  },
  commentContent: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 3,
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
    fontWeight: '700',
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
  lightboxImage: {
    borderRadius: 8,
    height: '90%',
    width: '95%',
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
    fontWeight: '700',
  },
});
