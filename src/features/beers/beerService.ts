import { supabase } from '../../lib/supabase';
import type { Beer, BeerRating, BeerRatingSummary, BeerWallActivity, UserBeerRatingListItem } from './types';
import type { PickedMedia } from '../wall/wallPostService';
import { submitWallPost } from '../wall/wallSubmission';

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

export async function fetchUserBeerRatingList(userId: string): Promise<UserBeerRatingListItem[]> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const [beers, ratingsResult] = await Promise.all([
    fetchBeers(),
    supabase
      .from('ratings')
      .select('id,user_id,beer_id,stars,notes,created_at')
      .eq('user_id', userId),
  ]);

  if (ratingsResult.error) {
    throw ratingsResult.error;
  }

  const ratingsByBeerId = new Map(
    ((ratingsResult.data ?? []) as BeerRating[]).map((rating) => [rating.beer_id, rating]),
  );

  return beers.map((beer) => ({
    beer,
    rating: ratingsByBeerId.get(beer.id) ?? null,
  }));
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

export async function createBeerWallPost(
  userId: string,
  beerId: string,
  content: string,
  media: PickedMedia[] = [],
): Promise<string> {
  return submitWallPost(userId, { content, beerId, media });
}

