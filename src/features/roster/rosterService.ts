import { HHS_WEB_ORIGIN } from '../../config/env';
import { getAuthenticatedApiHeaders } from '../../lib/nativeApiAuth';
import { isVisibleMember } from '../../lib/memberVisibility';
import { supabase } from '../../lib/supabase';

export type HhsRosterMember = {
  id: string;
  username: string;
  first_name: string | null;
};

type RosterResponse = {
  ok?: boolean;
  members?: HhsRosterMember[];
  error?: string;
};

type ProfileRosterRow = {
  id: string;
  username: string | null;
  first_name: string | null;
  status: string | null;
  payment_review_status: string | null;
};

const REQUIRED_VISIBLE_ROSTER_USERNAMES = ['zacula'] as const;

async function readJsonError(response: Response) {
  try {
    const json = (await response.json()) as { error?: string };
    return json.error || `Roster request failed (${response.status}).`;
  } catch {
    return `Roster request failed (${response.status}).`;
  }
}

function normalizeUsername(username: string | null | undefined) {
  return username?.replace(/^@+/, '').trim().toLowerCase() ?? '';
}

function normalizeRosterMembers(members: HhsRosterMember[]) {
  return members
    .filter((member) => typeof member.id === 'string' && typeof member.username === 'string')
    .filter(isVisibleMember)
    .map((member) => ({
      id: member.id,
      username: member.username.trim(),
      first_name: typeof member.first_name === 'string' && member.first_name.trim()
        ? member.first_name.trim()
        : null,
    }));
}

async function fetchRequiredVisibleRosterMembers(existingMembers: HhsRosterMember[]): Promise<HhsRosterMember[]> {
  if (!supabase) return [];

  const existingUsernames = new Set(existingMembers.map((member) => normalizeUsername(member.username)));
  const missingUsernames = REQUIRED_VISIBLE_ROSTER_USERNAMES.filter(
    (username) => !existingUsernames.has(username),
  );
  if (missingUsernames.length === 0) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id,username,first_name,status,payment_review_status')
    .in('username', missingUsernames);

  if (error) {
    console.warn('[HHS Roster] required roster member lookup failed:', error.message);
    return [];
  }

  return ((data ?? []) as ProfileRosterRow[])
    .filter((profile) => (
      typeof profile.id === 'string' &&
      typeof profile.username === 'string' &&
      profile.status === 'approved' &&
      profile.payment_review_status === 'paid'
    ))
    .map((profile) => ({
      id: profile.id,
      username: profile.username!,
      first_name: typeof profile.first_name === 'string' && profile.first_name.trim()
        ? profile.first_name.trim()
        : null,
    }))
    .filter(isVisibleMember);
}

export async function fetchHhsRoster(userId: string): Promise<HhsRosterMember[]> {
  const authHeaders = await getAuthenticatedApiHeaders(userId);
  const response = await fetch(`${HHS_WEB_ORIGIN}/api/hhs-roster`, {
    headers: authHeaders,
  });

  if (!response.ok) {
    throw new Error(await readJsonError(response));
  }

  const json = (await response.json()) as RosterResponse;
  if (!json.ok || !Array.isArray(json.members)) {
    throw new Error(json.error || 'Could not load the HHS Roster.');
  }

  const normalizedMembers = normalizeRosterMembers(json.members);
  const requiredMembers = await fetchRequiredVisibleRosterMembers(normalizedMembers);
  if (requiredMembers.length === 0) return normalizedMembers;

  return normalizeRosterMembers([...normalizedMembers, ...requiredMembers])
    .sort((a, b) => normalizeUsername(a.username).localeCompare(normalizeUsername(b.username)));
}
