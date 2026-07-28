declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const env = typeof process !== 'undefined' ? process.env ?? {} : {};

export const HHS_WEB_ORIGIN = 'https://hallowedhopsociety.com';

export const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;

// Prefer the explicit native anon key name, but accept the web app's public
// publishable-key name so the repos can share safe public config during the
// migration. Never put service-role keys in Expo public env.
export const SUPABASE_ANON_KEY =
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseEnvConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

