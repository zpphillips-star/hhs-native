import 'react-native-url-polyfill/auto';

import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseEnvConfigured } from '../config/env';
import { supabaseSessionStorage } from './secureSessionStorage';

export type HhsSupabaseClient = SupabaseClient;

export const supabase: HhsSupabaseClient | null = isSupabaseEnvConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        storage: supabaseSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

let appStateSubscription: { remove: () => void } | null = null;

export function startSupabaseAuthLifecycle() {
  if (!supabase || appStateSubscription) return () => undefined;

  if (AppState.currentState === 'active') {
    supabase.auth.startAutoRefresh();
  }

  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    supabase.auth.stopAutoRefresh();
  };
}

