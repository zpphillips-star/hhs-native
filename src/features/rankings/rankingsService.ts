/**
 * rankingsService — Batch 2
 *
 * Fetches all beers and all ratings from Supabase, aggregates avg star
 * rating and count per beer, and returns a sorted leaderboard.
 *
 * Sort order: avg descending, then count descending (tiebreak).
 * Only beers with at least one rating appear in the leaderboard.
 */

import { supabase } from '../../lib/supabase';
import type { Beer } from '../beers/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RankedBeer = {
  /** 1-based rank (1 = best rated) */
  rank: number;
  beer: Beer;
  /** Average star rating, rounded to 1 decimal */
  avgStars: number;
  /** Total number of individual ratings */
  ratingCount: number;
};

type RatingRow = {
  beer_id: string;
  stars: number;
};

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Returns all beers that have been rated, ordered best → worst.
 * Returns [] if no beers or no ratings exist yet.
 * Throws if the Supabase env is not configured or a query fails.
 */
export async function fetchTopBeers(): Promise<RankedBeer[]> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  // 1. Fetch all beers (same fields used elsewhere in the app)
  const { data: beers, error: beersError } = await supabase
    .from('beers')
    .select(
      'id,day_number,name,brewery,style,abv,description,brewery_fact,beer_fact,image_url,created_at',
    )
    .order('day_number', { ascending: true });

  if (beersError) throw beersError;
  if (!beers || beers.length === 0) return [];

  // 2. Fetch all ratings (only the two columns we need)
  const { data: ratings, error: ratingsError } = await supabase
    .from('ratings')
    .select('beer_id,stars');

  if (ratingsError) throw ratingsError;

  // 3. Aggregate stars by beer_id
  const ratingsByBeer: Record<string, number[]> = {};
  for (const r of (ratings ?? []) as RatingRow[]) {
    if (!ratingsByBeer[r.beer_id]) ratingsByBeer[r.beer_id] = [];
    ratingsByBeer[r.beer_id].push(r.stars);
  }

  // 4. Build candidate list — only beers with ≥1 rating
  const candidates = (beers as Beer[])
    .filter((beer) => (ratingsByBeer[beer.id]?.length ?? 0) > 0)
    .map((beer) => {
      const starList = ratingsByBeer[beer.id];
      const total = starList.reduce((sum, v) => sum + v, 0);
      const avg = Math.round((total / starList.length) * 10) / 10;
      return {
        beer,
        avgStars: avg,
        ratingCount: starList.length,
        rank: 0,
      };
    });

  // 5. Sort: avg desc, then count desc
  candidates.sort((a, b) => b.avgStars - a.avgStars || b.ratingCount - a.ratingCount);

  // 6. Assign 1-based ranks
  candidates.forEach((item, i) => {
    item.rank = i + 1;
  });

  return candidates;
}
