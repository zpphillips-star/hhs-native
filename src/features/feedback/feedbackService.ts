/**
 * feedbackService — native feedback board
 *
 * Uses the Supabase anon client directly.
 * RLS policies on `feedback_items` allow:
 *   - public SELECT (anyone can read all items)
 *   - public INSERT (anyone can submit)
 * No image upload is exposed here — native submission is text-only.
 */

import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackStatus = 'submitted' | 'backlog' | 'in_progress' | 'live';

export type FeedbackItem = {
  id: string;
  title: string;
  description: string | null;
  name: string | null;
  status: FeedbackStatus;
  image_urls: string[];
  created_at: string;
};

export type FeedbackStage = {
  id: FeedbackStatus;
  label: string;
  description: string;
  color: string;
  borderColor: string;
  bg: string;
};

export const FEEDBACK_STAGES: readonly FeedbackStage[] = [
  {
    id: 'submitted',
    label: 'Submitted',
    description: 'New suggestions under review',
    color: '#a69d8d',
    borderColor: 'rgba(166,157,141,0.2)',
    bg: 'rgba(166,157,141,0.06)',
  },
  {
    id: 'backlog',
    label: 'Planned',
    description: 'Accepted and scheduled to build',
    color: '#d97c2b',
    borderColor: 'rgba(217,124,43,0.22)',
    bg: 'rgba(217,124,43,0.06)',
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    description: 'Actively being built right now',
    color: '#e8953a',
    borderColor: 'rgba(232,149,58,0.25)',
    bg: 'rgba(232,149,58,0.06)',
  },
  {
    id: 'live',
    label: 'Live ✓',
    description: 'Shipped and available in the app',
    color: '#5fa65f',
    borderColor: 'rgba(95,166,95,0.2)',
    bg: 'rgba(95,166,95,0.06)',
  },
] as const;

const VALID_STATUSES = new Set<string>(['submitted', 'backlog', 'in_progress', 'live']);

function normalizeItem(raw: Record<string, unknown>): FeedbackItem {
  const rawImages = raw.image_urls;
  const status =
    typeof raw.status === 'string' && VALID_STATUSES.has(raw.status)
      ? (raw.status as FeedbackStatus)
      : 'submitted';
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    description: typeof raw.description === 'string' ? raw.description : null,
    name: typeof raw.name === 'string' ? raw.name : null,
    status,
    image_urls: Array.isArray(rawImages)
      ? (rawImages as unknown[]).filter(
          (u): u is string => typeof u === 'string' && /^https:\/\//i.test(u),
        )
      : [],
    created_at: String(raw.created_at ?? ''),
  };
}

// ─── Service functions ────────────────────────────────────────────────────────

/** Fetch all feedback items ordered newest-first. */
export async function fetchFeedbackItems(): Promise<FeedbackItem[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('feedback_items')
    .select('id, title, description, name, status, image_urls, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeItem);
}

/** Submit a new feedback suggestion (text-only; images not supported from native). */
export async function submitFeedbackItem(params: {
  title: string;
  description?: string;
  name?: string;
  email?: string;
}): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase.from('feedback_items').insert({
    title: params.title.trim(),
    description: params.description?.trim() || null,
    name: params.name?.trim() || null,
    email: params.email?.trim() || null,
    status: 'submitted',
    image_urls: [],
  });

  if (error) throw error;
}
