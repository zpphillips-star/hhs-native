import { useCallback, useEffect, useMemo, useState } from 'react';

import { supabase } from '../../lib/supabase';

export type MembershipTier = 'hallowed' | 'oddballs' | 'unknown' | 'logged_out';
export type BeerVisibilityPreference = 'participating_only' | 'all';

export type BeerVisibilityProfile = {
  userId: string | null;
  tier: MembershipTier;
  rawTier: string | null;
  preference: BeerVisibilityPreference | null;
  effectivePreference: BeerVisibilityPreference;
  loading: boolean;
  error: string | null;
  preferenceColumnAvailable: boolean | null;
};

type ProfileTierRow = {
  id: string;
  tier: string | null;
};

type ProfilePreferenceRow = {
  beer_visibility_preference?: string | null;
};

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST200', 'PGRST202', 'PGRST204']);

export function normalizeMembershipTier(tier: string | null | undefined): MembershipTier {
  const normalized = (tier ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');

  if (!normalized) return 'unknown';
  if (['hallowed', 'full', 'fullsociety', 'hallowedsociety', 'hallowedmember', 'all31', '31'].includes(normalized)) {
    return 'hallowed';
  }
  if (['oddballs', 'oddball', 'odd', 'oddbeer', 'oddbeers', 'oddsonly', 'odddays', '16'].includes(normalized)) {
    return 'oddballs';
  }

  return 'unknown';
}

export function normalizeBeerVisibilityPreference(
  preference: string | null | undefined,
): BeerVisibilityPreference | null {
  const normalized = (preference ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
  if (['all', 'show_all', 'show_all_31', 'full_calendar'].includes(normalized)) return 'all';
  if (['participating_only', 'participating', 'included', 'included_only', 'odd_only', 'odds_only'].includes(normalized)) {
    return 'participating_only';
  }
  return null;
}

export function getEffectiveBeerVisibilityPreference(
  tier: MembershipTier,
  preference: BeerVisibilityPreference | null,
): BeerVisibilityPreference {
  if (tier === 'oddballs') return preference ?? 'participating_only';
  return 'all';
}

export function isParticipatingBeerDay(tier: MembershipTier, dayNumber: number | null | undefined): boolean {
  if (!dayNumber) return true;
  if (tier === 'oddballs') return dayNumber % 2 === 1;
  return true;
}

export function canSeeAllBeers(profile: Pick<BeerVisibilityProfile, 'effectivePreference' | 'tier'>): boolean {
  return profile.tier !== 'oddballs' || profile.effectivePreference === 'all';
}

function isMissingPreferenceColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return (
    Boolean(error.code && MISSING_COLUMN_CODES.has(error.code)) ||
    message.includes('beer_visibility_preference') ||
    (message.includes('column') && message.includes('not found'))
  );
}

export async function fetchBeerVisibilityPreference(
  userId: string,
): Promise<{ preference: BeerVisibilityPreference | null; columnAvailable: boolean }> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('beer_visibility_preference')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingPreferenceColumnError(error)) {
      console.warn('[HHS beer visibility] profiles.beer_visibility_preference is unavailable; using safe defaults.');
      return { preference: null, columnAvailable: false };
    }
    throw new Error(error.message);
  }

  const row = (data ?? null) as ProfilePreferenceRow | null;
  return {
    preference: normalizeBeerVisibilityPreference(row?.beer_visibility_preference),
    columnAvailable: true,
  };
}

export async function fetchBeerVisibilityProfile(userId: string | null | undefined): Promise<BeerVisibilityProfile> {
  if (!userId) {
    return {
      userId: null,
      tier: 'logged_out',
      rawTier: null,
      preference: null,
      effectivePreference: 'all',
      loading: false,
      error: null,
      preferenceColumnAvailable: null,
    };
  }

  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id,tier')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const profile = (data ?? null) as ProfileTierRow | null;
  const tier = normalizeMembershipTier(profile?.tier);
  let preference: BeerVisibilityPreference | null = null;
  let preferenceColumnAvailable: boolean | null = null;

  try {
    const prefResult = await fetchBeerVisibilityPreference(userId);
    preference = prefResult.preference;
    preferenceColumnAvailable = prefResult.columnAvailable;
  } catch (prefError) {
    console.warn(
      '[HHS beer visibility] preference load failed; using safe default:',
      prefError instanceof Error ? prefError.message : prefError,
    );
    preferenceColumnAvailable = null;
  }

  return {
    userId,
    tier,
    rawTier: profile?.tier ?? null,
    preference,
    effectivePreference: getEffectiveBeerVisibilityPreference(tier, preference),
    loading: false,
    error: null,
    preferenceColumnAvailable,
  };
}

export async function saveBeerVisibilityPreference(
  userId: string,
  preference: BeerVisibilityPreference,
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { error } = await supabase
    .from('profiles')
    .update({ beer_visibility_preference: preference })
    .eq('id', userId);

  if (error) {
    if (isMissingPreferenceColumnError(error)) {
      throw new Error(
        'profiles.beer_visibility_preference is missing in Supabase. Add it before this setting can be saved.',
      );
    }
    throw new Error(error.message);
  }
}

export function useBeerVisibility(userId: string | null | undefined) {
  const [state, setState] = useState<BeerVisibilityProfile>(() => ({
    userId: userId ?? null,
    tier: userId ? 'unknown' : 'logged_out',
    rawTier: null,
    preference: null,
    effectivePreference: userId ? 'participating_only' : 'all',
    loading: Boolean(userId),
    error: null,
    preferenceColumnAvailable: null,
  }));

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({
        userId: null,
        tier: 'logged_out',
        rawTier: null,
        preference: null,
        effectivePreference: 'all',
        loading: false,
        error: null,
        preferenceColumnAvailable: null,
      });
      return;
    }

    setState((current) => ({
      ...current,
      userId,
      tier: current.userId === userId ? current.tier : 'unknown',
      loading: true,
      error: null,
    }));

    try {
      const profile = await fetchBeerVisibilityProfile(userId);
      setState(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load beer visibility profile.';
      setState({
        userId,
        tier: 'unknown',
        rawTier: null,
        preference: null,
        effectivePreference: 'all',
        loading: false,
        error: message,
        preferenceColumnAvailable: null,
      });
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}
