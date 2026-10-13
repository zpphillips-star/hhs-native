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

export type MyBeerRatingRow = {
  beer: Beer;
  userStars: number;
  userRatedAt: string | null;
  societyAvgStars: number | null;
  societyRatingCount: number;
};

export type MyBeerRatingSummary = {
  userAverageStars: number | null;
  userRatingCount: number;
  societyAverageStars: number | null;
  societyRatingCount: number;
};

export type MyBeerRatingsResult = {
  summary: MyBeerRatingSummary;
  rows: MyBeerRatingRow[];
};

type RatingRow = {
  beer_id: string;
  stars: number;
  user_id?: string;
  created_at?: string | null;
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

/**
 * Returns the signed-in user's rated beers with the Society average for each
 * beer, plus summary averages for the My Beers section in The Rankings.
 */
export async function fetchMyBeerRatings(userId: string): Promise<MyBeerRatingsResult> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const [beersResult, ratingsResult] = await Promise.all([
    supabase
      .from('beers')
      .select(
        'id,day_number,name,brewery,style,abv,description,brewery_fact,beer_fact,image_url,created_at',
      )
      .order('day_number', { ascending: true }),
    supabase
      .from('ratings')
      .select('beer_id,user_id,stars,created_at'),
  ]);

  if (beersResult.error) throw beersResult.error;
  if (ratingsResult.error) throw ratingsResult.error;

  const beers = (beersResult.data ?? []) as Beer[];
  const ratings = (ratingsResult.data ?? []) as RatingRow[];
  const ratingsByBeer: Record<string, number[]> = {};
  const userRatingsByBeer = new Map<string, RatingRow>();

  for (const rating of ratings) {
    if (!ratingsByBeer[rating.beer_id]) ratingsByBeer[rating.beer_id] = [];
    ratingsByBeer[rating.beer_id].push(rating.stars);

    if (rating.user_id === userId) {
      userRatingsByBeer.set(rating.beer_id, rating);
    }
  }

  const userStarList = Array.from(userRatingsByBeer.values()).map((rating) => rating.stars);
  const societyStarList = ratings.map((rating) => rating.stars);

  const average = (stars: number[]) => {
    if (stars.length === 0) return null;
    const total = stars.reduce((sum, star) => sum + star, 0);
    return Math.round((total / stars.length) * 10) / 10;
  };

  const rows = beers
    .map((beer) => {
      const userRating = userRatingsByBeer.get(beer.id);
      if (!userRating) return null;

      const societyStars = ratingsByBeer[beer.id] ?? [];
      return {
        beer,
        userStars: userRating.stars,
        userRatedAt: userRating.created_at ?? null,
        societyAvgStars: average(societyStars),
        societyRatingCount: societyStars.length,
      };
    })
    .filter((row): row is MyBeerRatingRow => row !== null);

  return {
    summary: {
      userAverageStars: average(userStarList),
      userRatingCount: userStarList.length,
      societyAverageStars: average(societyStarList),
      societyRatingCount: societyStarList.length,
    },
    rows,
  };
}
