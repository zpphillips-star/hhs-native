import { HHS_WEB_ORIGIN } from '../../config/env';
import { supabase } from '../../lib/supabase';

export type HhsProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  display_name: string | null;
  email: string | null;
  status: string | null;
  tier: string | null;
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
      'id, first_name, last_name, username, display_name, email, status, tier, tier_selected_at, venmo_clicked_at, native_membership_amount',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as HhsProfile | null) ?? null;
}

export async function fetchNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const response = await fetch(
    `${HHS_WEB_ORIGIN}/api/notification-preferences?user_id=${encodeURIComponent(userId)}`,
  );

  if (!response.ok) {
    throw new Error(`Notification preferences request failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    ok?: boolean;
    prefs?: Partial<NotificationPreferences>;
    error?: string;
  };

  if (!json.ok) {
    throw new Error(json.error ?? 'Notification preferences response was not successful.');
  }

  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(json.prefs ?? {}),
  };
}

export async function saveNotificationPreferences(
  userId: string,
  email: string | null | undefined,
  prefs: NotificationPreferences,
): Promise<void> {
  const response = await fetch(`${HHS_WEB_ORIGIN}/api/notification-preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      email: email ?? undefined,
      ...prefs,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Notification preferences save failed (${response.status}).`);
  }

  const json = (await response.json()) as {
    ok?: boolean;
    error?: string;
  };

  if (!json.ok) {
    throw new Error(json.error ?? 'Notification preferences save was not successful.');
  }
}
