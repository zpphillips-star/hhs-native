import { HHS_WEB_ORIGIN } from '../../config/env';
import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchBeerVisibilityPreference,
  type BeerVisibilityPreference,
} from '../membership/beerVisibilityService';

export type HhsProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  display_name: string | null;
  display_name_native: string | null;
  email: string | null;
  status: string | null;
  tier: string | null;
  beer_visibility_preference: BeerVisibilityPreference | null;
  tier_selected_at: string | null;
  venmo_clicked_at: string | null;
  native_membership_amount: number | null;
};

export type NotificationPreferences = {
  daily_beer: boolean;
  social_all: boolean;
  social_new_comment: boolean;
  social_new_reaction: boolean;
  social_reaction_to_your_items: boolean;
  social_comment_on_your_items: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  daily_beer: true,
  social_all: true,
  social_new_comment: true,
  social_new_reaction: true,
  social_reaction_to_your_items: true,
  social_comment_on_your_items: true,
};

function getNotificationPrefsStorageKey(userId: string) {
  return `@hhs:notification-preferences:${userId}`;
}

async function loadLocalNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(getNotificationPrefsStorageKey(userId));
    if (raw) {
      return {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...(JSON.parse(raw) as Partial<NotificationPreferences>),
      };
    }
  } catch (err) {
    console.warn('[HHS settings] failed to load local notification preferences:', err);
  }

  return { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

async function saveLocalNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(getNotificationPrefsStorageKey(userId), JSON.stringify(prefs));
  } catch (err) {
    console.warn('[HHS settings] failed to save local notification preferences:', err);
  }
}

export const SOCIAL_NOTIFICATION_KEYS: (keyof Pick<
  NotificationPreferences,
  | 'social_new_comment'
  | 'social_new_reaction'
  | 'social_reaction_to_your_items'
  | 'social_comment_on_your_items'
>)[] = [
  'social_new_comment',
  'social_new_reaction',
  'social_reaction_to_your_items',
  'social_comment_on_your_items',
];

export function applyNotificationPreferenceToggle(
  currentPrefs: NotificationPreferences,
  key: keyof NotificationPreferences,
  value: boolean,
): NotificationPreferences {
  if (key === 'social_all') {
    return {
      ...currentPrefs,
      social_all: value,
      social_new_comment: value,
      social_new_reaction: value,
      social_reaction_to_your_items: value,
      social_comment_on_your_items: value,
    };
  }

  const nextPrefs = {
    ...currentPrefs,
    [key]: value,
  };

  if (key !== 'daily_beer') {
    nextPrefs.social_all = SOCIAL_NOTIFICATION_KEYS.every((socialKey) => nextPrefs[socialKey]);
  }

  return nextPrefs;
}

export async function fetchCurrentUserProfile(userId: string): Promise<HhsProfile | null> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, first_name, last_name, username, display_name, display_name_native, email, status, tier, tier_selected_at, venmo_clicked_at, native_membership_amount',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const profile = (data as Omit<HhsProfile, 'beer_visibility_preference'> | null) ?? null;
  if (!profile) return null;

  let preference: BeerVisibilityPreference | null = null;
  try {
    const result = await fetchBeerVisibilityPreference(userId);
    preference = result.preference;
  } catch (err) {
    console.warn(
      '[HHS settings] beer visibility preference unavailable; using safe default:',
      err instanceof Error ? err.message : err,
    );
  }
  return {
    ...profile,
    beer_visibility_preference: preference,
  };
}

export async function fetchNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const localPrefs = await loadLocalNotificationPreferences(userId);

  // Use a 7-second timeout so a hanging server never blocks the settings UI from rendering.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(
      `${HHS_WEB_ORIGIN}/api/notification-preferences?user_id=${encodeURIComponent(userId)}`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      console.warn('[HHS settings] notification preferences fetch failed:', response.status);
      return localPrefs;
    }

    const json = (await response.json()) as {
      ok?: boolean;
      prefs?: Partial<NotificationPreferences>;
      error?: string;
    };

    if (!json.ok) {
      console.warn('[HHS settings] notification preferences response was not successful:', json.error);
      return localPrefs;
    }

    const nextPrefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...localPrefs,
      ...(json.prefs ?? {}),
    };
    await saveLocalNotificationPreferences(userId, nextPrefs);
    return nextPrefs;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) {
      console.warn('[HHS settings] notification preferences fetch timed out; using local cache.');
    } else {
      console.warn('[HHS settings] notification preferences fetch error:', message);
    }
    return localPrefs;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveNotificationPreferences(
  userId: string,
  email: string | null | undefined,
  prefs: NotificationPreferences,
): Promise<void> {
  // Always persist locally first — keeps optimistic update durable across restarts.
  await saveLocalNotificationPreferences(userId, prefs);

  // Use a 7-second timeout so a hanging server never keeps prefSavingKey set and
  // freezes all toggles in a disabled state for the rest of the session.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(`${HHS_WEB_ORIGIN}/api/notification-preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        email: email ?? undefined,
        ...prefs,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn('[HHS settings] notification preferences backend save failed:', response.status, text);
      return;
    }

    const json = (await response.json()) as {
      ok?: boolean;
      error?: string;
    };

    if (!json.ok) {
      console.warn('[HHS settings] notification preferences backend save was not successful:', json.error);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      console.warn('[HHS settings] notification preferences backend save timed out; preference kept in local cache.');
    } else {
      console.warn('[HHS settings] notification preferences backend save error:', err instanceof Error ? err.message : err);
    }
  } finally {
    clearTimeout(timer);
  }
}
