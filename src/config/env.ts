import Constants from 'expo-constants';

declare const process: {
  env: Record<string, string | undefined>;
};

const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const PRODUCTION_SUPABASE_URL = 'https://dnicdsjvqxthkktlcshe.supabase.co';
// Supabase publishable/anon keys are public client config. Keep this fallback so
// local signed release builds do not silently ship with Supabase undefined when
// the shell that invokes Gradle is missing EXPO_PUBLIC_* values.
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZs3CdtGLw3GJdlAxFtxFQ_z4VW2SDB';

export const HHS_WEB_ORIGIN = 'https://hallowedhopsociety.com';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (typeof expoExtra.supabaseUrl === 'string' ? expoExtra.supabaseUrl : undefined) ??
  PRODUCTION_SUPABASE_URL;

// Prefer the explicit native anon key name, but accept the web app's public
// publishable-key name so the repos can share safe public config during the
// migration. Never put service-role keys in Expo public env.
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  (typeof expoExtra.supabaseAnonKey === 'string' ? expoExtra.supabaseAnonKey : undefined) ??
  (typeof expoExtra.supabasePublishableKey === 'string' ? expoExtra.supabasePublishableKey : undefined) ??
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseEnvConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Internal-only test hook for validating the October beer reveal flow.
// Remove `hhsTestDate` from app.json, or leave EXPO_PUBLIC_HHS_TEST_DATE unset,
// before production release builds that should use the device clock.
export const HHS_TEST_DATE =
  process.env.EXPO_PUBLIC_HHS_TEST_DATE ??
  (typeof expoExtra.hhsTestDate === 'string' ? expoExtra.hhsTestDate : undefined);

// Controlled native migration flag. Keep the WebView as the default app surface
// until a native route/shell is intentionally enabled for validation.
export const USE_NATIVE_BEER_SCREEN =
  process.env.EXPO_PUBLIC_HHS_NATIVE_BEER_SCREEN === '1' || expoExtra.hhsNativeBeerScreen === '1';
