import { supabase } from '../../lib/supabase';
import type { Beer } from './types';

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

