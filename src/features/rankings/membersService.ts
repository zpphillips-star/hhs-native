/**
 * membersService — Batch 3
 *
 * Computes a ranked member leaderboard using engagement scoring:
 *
 *   Rating    = +2 pts  (+1 timeliness if submitted on beer's Day N)
 *   Wall post = +3 pts  (+1 timeliness if posted on beer's Day N)
 *   Comment   = +2 pts  (+1 timeliness if posted on the day of the linked beer)
 *   Reaction  = +1 pt   (no timeliness)
 *
 * "Day N timeliness" means the UTC calendar day-of-month of created_at
 * equals beer.day_number for October 2026.
 *
 * Only members with score > 0 appear in the leaderboard.
 * Tied scores are broken alphabetically by display name.
 */

import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RankedMember = {
  /** 1-based rank */
  rank: number;
  userId: string;
  /** Resolved: display_name → username → "Member" */
  displayName: string;
  /** Total engagement score */
  score: number;
  ratingCount: number;
  postCount: number;
  commentCount: number;
  reactionCount: number;
};

// Internal row shapes for Supabase responses
type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
};

type RatingRow = {
  user_id: string;
  beer_id: string;
  created_at: string;
};

type BeerRow = {
  id: string;
  day_number: number | null;
};

type CommentRow = {
  user_id: string;
  created_at: string;
};

type PostRow = {
  id: string;
  user_id: string;
  created_at: string;
  beer_id: string | null;
  post_comments: CommentRow[];
};

type ReactionRow = {
  user_id: string;
};

// ─── Scoring constants ────────────────────────────────────────────────────────

const EVENT_YEAR = 2026;
const EVENT_MONTH = 10; // October (1-indexed)

const PTS_RATING = 2;
const PTS_RATING_TIMELY = 1;
const PTS_POST = 3;
const PTS_POST_TIMELY = 1;
const PTS_COMMENT = 2;
const PTS_COMMENT_TIMELY = 1;
const PTS_REACTION = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if `isoDate` falls on October `dayNumber`, 2026 (UTC calendar).
 */
function isTimely(isoDate: string, dayNumber: number | null): boolean {
  if (dayNumber == null) return false;
  try {
    const d = new Date(isoDate);
    return (
      d.getUTCFullYear() === EVENT_YEAR &&
      d.getUTCMonth() + 1 === EVENT_MONTH &&
      d.getUTCDate() === dayNumber
    );
  } catch {
    return false;
  }
}

function resolveDisplayName(profile: ProfileRow): string {
  return (
    profile.display_name?.trim() ||
    profile.username?.trim() ||
    'Member'
  );
}

// ─── Scorer helper ────────────────────────────────────────────────────────────

type MemberScore = {
  score: number;
  ratingCount: number;
  postCount: number;
  commentCount: number;
  reactionCount: number;
};

function ensureUser(
  map: Record<string, MemberScore>,
  userId: string,
): MemberScore {
  if (!map[userId]) {
    map[userId] = {
      score: 0,
      ratingCount: 0,
      postCount: 0,
      commentCount: 0,
      reactionCount: 0,
    };
  }
  return map[userId];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns all members with ≥1 engagement point, ordered by score descending.
 * Returns [] if no data exist yet.
 * Throws if Supabase is not configured or a query fails.
 */
export async function fetchRankedMembers(): Promise<RankedMember[]> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  // ── 1. Beers: id → day_number lookup ──────────────────────────────────────
  const { data: beers, error: beersError } = await supabase
    .from('beers')
    .select('id,day_number');
  if (beersError) throw beersError;

  const beerDayMap: Record<string, number | null> = {};
  for (const b of (beers ?? []) as BeerRow[]) {
    beerDayMap[b.id] = b.day_number;
  }

  // ── 2. Profiles: id → display name ────────────────────────────────────────
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id,username,display_name');
  if (profilesError) throw profilesError;

  const profileMap: Record<string, ProfileRow> = {};
  for (const p of (profiles ?? []) as ProfileRow[]) {
    profileMap[p.id] = p;
  }

  // ── 3. Ratings (includes user_id, beer_id, created_at) ────────────────────
  const { data: ratings, error: ratingsError } = await supabase
    .from('ratings')
    .select('user_id,beer_id,created_at');
  if (ratingsError) throw ratingsError;

  // ── 4. Posts + nested comments (one round-trip via FK join) ───────────────
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id,user_id,created_at,beer_id,post_comments(user_id,created_at)');
  if (postsError) throw postsError;

  // ── 5. Reactions (flat fetch — just user_id needed for counting) ──────────
  const { data: reactions, error: reactionsError } = await supabase
    .from('post_reactions')
    .select('user_id');
  if (reactionsError) throw reactionsError;

  // ── Aggregate scores ───────────────────────────────────────────────────────

  const scores: Record<string, MemberScore> = {};

  // Ratings: +2 each, +1 timeliness
  for (const r of (ratings ?? []) as RatingRow[]) {
    if (!r.user_id) continue;
    const s = ensureUser(scores, r.user_id);
    s.ratingCount++;
    s.score += PTS_RATING;
    const dayNum = r.beer_id ? (beerDayMap[r.beer_id] ?? null) : null;
    if (isTimely(r.created_at, dayNum)) {
      s.score += PTS_RATING_TIMELY;
    }
  }

  // Posts: +3 each, +1 timeliness
  // Comments nested under post: +2 each, +1 timeliness via parent beer
  for (const p of (posts ?? []) as PostRow[]) {
    if (p.user_id) {
      const s = ensureUser(scores, p.user_id);
      s.postCount++;
      s.score += PTS_POST;
      const beerDay = p.beer_id ? (beerDayMap[p.beer_id] ?? null) : null;
      if (beerDay !== null && isTimely(p.created_at, beerDay)) {
        s.score += PTS_POST_TIMELY;
      }
    }

    // Nested comments
    const beerDay = p.beer_id ? (beerDayMap[p.beer_id] ?? null) : null;
    for (const c of (p.post_comments ?? []) as CommentRow[]) {
      if (!c.user_id) continue;
      const s = ensureUser(scores, c.user_id);
      s.commentCount++;
      s.score += PTS_COMMENT;
      if (beerDay !== null && isTimely(c.created_at, beerDay)) {
        s.score += PTS_COMMENT_TIMELY;
      }
    }
  }

  // Reactions: +1 each, no timeliness
  for (const r of (reactions ?? []) as ReactionRow[]) {
    if (!r.user_id) continue;
    const s = ensureUser(scores, r.user_id);
    s.reactionCount++;
    s.score += PTS_REACTION;
  }

  // ── Build ranked list ──────────────────────────────────────────────────────

  const userIds = Object.keys(scores).filter((uid) => scores[uid].score > 0);

  userIds.sort((a, b) => {
    const diff = scores[b].score - scores[a].score;
    if (diff !== 0) return diff;
    // Tiebreak: alphabetical display name
    const nameA = profileMap[a] ? resolveDisplayName(profileMap[a]) : 'zzz';
    const nameB = profileMap[b] ? resolveDisplayName(profileMap[b]) : 'zzz';
    return nameA.localeCompare(nameB);
  });

  return userIds.map((uid, i) => ({
    rank: i + 1,
    userId: uid,
    displayName: profileMap[uid]
      ? resolveDisplayName(profileMap[uid])
      : 'Member',
    score: scores[uid].score,
    ratingCount: scores[uid].ratingCount,
    postCount: scores[uid].postCount,
    commentCount: scores[uid].commentCount,
    reactionCount: scores[uid].reactionCount,
  }));
}
