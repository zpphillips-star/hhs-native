import { supabase } from '../../lib/supabase';
import type { Beer, BeerRating } from './types';

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

export async function upsertUserBeerRating(userId: string, beerId: string, stars: number): Promise<BeerRating> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase
    .from('ratings')
    .upsert(
      {
        user_id: userId,
        beer_id: beerId,
        stars,
      },
      { onConflict: 'user_id,beer_id' },
    )
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

