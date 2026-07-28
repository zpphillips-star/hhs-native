import Constants from 'expo-constants';

declare const process: {
  env: Record<string, string | undefined>;
};

const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

export const HHS_WEB_ORIGIN = 'https://hallowedhopsociety.com';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

// Prefer the explicit native anon key name, but accept the web app's public
// publishable-key name so the repos can share safe public config during the
// migration. Never put service-role keys in Expo public env.
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseEnvConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Controlled native migration flag. Keep the WebView as the default app surface
// until a native route/shell is intentionally enabled for validation.
export const USE_NATIVE_BEER_SCREEN =
  process.env.EXPO_PUBLIC_HHS_NATIVE_BEER_SCREEN === '1' || expoExtra.hhsNativeBeerScreen === '1';
