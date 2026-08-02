import { supabase } from '../../lib/supabase';
import { HHS_WEB_ORIGIN } from '../../config/env';
import type { Beer, BeerRating, BeerRatingSummary, BeerWallActivity } from './types';

const BEER_LIST_SELECT = [
  'id',
  'day_number',
  'name',
  'brewery',
  'style',
  'abv',
  'description',
  'brewery_fact',
  'beer_fact',
  'image_url',
  'created_at',
].join(',');

export async function fetchBeers(): Promise<Beer[]> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase
    .from('beers')
    .select(BEER_LIST_SELECT)
    .order('day_number', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as Beer[];
}

export async function fetchUserBeerRating(userId: string, beerId: string): Promise<BeerRating | null> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase
    .from('ratings')
    .select('id,user_id,beer_id,stars,notes,created_at')
    .eq('user_id', userId)
    .eq('beer_id', beerId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as BeerRating | null;
}

export async function fetchBeerRatingSummary(beerId: string): Promise<BeerRatingSummary> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase.from('ratings').select('stars').eq('beer_id', beerId);

  if (error) {
    throw error;
  }

  const ratings = data ?? [];
  if (ratings.length === 0) {
    return { average: null, count: 0 };
  }

  const total = ratings.reduce((sum, rating) => sum + rating.stars, 0);
  return {
    average: Math.round((total / ratings.length) * 10) / 10,
    count: ratings.length,
  };
}

export async function upsertUserBeerRating(
  userId: string,
  beerId: string,
  stars: number,
  notes?: string | null,
): Promise<BeerRating> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const payload: Record<string, unknown> = { user_id: userId, beer_id: beerId, stars };
  if (notes !== undefined) {
    payload.notes = notes;
  }

  const { data, error } = await supabase
    .from('ratings')
    .upsert(payload, { onConflict: 'user_id,beer_id' })
    .select('id,user_id,beer_id,stars,notes,created_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Rating was saved but no rating row was returned.');
  }

  return data as BeerRating;
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

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
};

type BeerWallPostRow = {
  id: string;
  user_id: string;
  content: string | null;
  photo_url: string | null;
  created_at: string;
  post_reactions?: { id: string }[] | null;
  post_comments?: { id: string }[] | null;
};

export async function fetchBeerWallActivity(beerId: string, limit = 3): Promise<BeerWallActivity[]> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data: posts, error } = await supabase
    .from('posts')
    .select('id,user_id,content,photo_url,created_at,post_reactions(id),post_comments(id)')
    .eq('beer_id', beerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = (posts ?? []) as unknown as BeerWallPostRow[];
  const userIds = Array.from(new Set(rows.map((post) => post.user_id).filter(Boolean)));
  let profileMap: Record<string, ProfileRow> = {};

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id,username,display_name')
      .in('id', userIds);
    if (profileError) throw profileError;
    profileMap = Object.fromEntries(((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  }

  return rows.map((post) => {
    const profile = profileMap[post.user_id];
    return {
      id: post.id,
      content: post.content ?? '',
      photo_url: post.photo_url,
      created_at: post.created_at,
      author: profile?.display_name || profile?.username || 'Member',
      reactionCount: post.post_reactions?.length ?? 0,
      commentCount: post.post_comments?.length ?? 0,
    };
  });
}

export async function createBeerWallPost(userId: string, beerId: string, content: string): Promise<string | null> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Write a Wall post before publishing.');

  try {
    const response = await fetch(buildApiUrl('/api/wall/post'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, beer_id: beerId, content: trimmed, photo_url: null }),
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const json = await response.json() as { post?: { id?: string } };
    return json.post?.id ?? null;
  } catch (apiError) {
    if (!supabase) throw apiError;
    console.warn(
      '[HHS native beer] Wall post API failed; falling back to Supabase insert:',
      apiError instanceof Error ? apiError.message : apiError,
    );
    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id: userId, beer_id: beerId, content: trimmed, photo_url: null })
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return (data as { id?: string } | null)?.id ?? null;
  }
}

