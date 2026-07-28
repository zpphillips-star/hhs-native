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
