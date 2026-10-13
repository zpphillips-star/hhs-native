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

// Deliberately narrow disposable-device contract: ADB reverse only, no LAN/DNS.
// Use direct env reads so Expo inlines these values in development bundles.
const localTestFlag = process.env.EXPO_PUBLIC_HHS_LOCAL_TEST;
export const HHS_LOCAL_TEST = localTestFlag === '1';
if (localTestFlag !== undefined && localTestFlag !== '0' && localTestFlag !== '1') {
  throw new Error('Invalid HHS local-test flag; expected 0 or 1.');
}
if (HHS_LOCAL_TEST && !__DEV__) {
  throw new Error('HHS local-test configuration is development-only.');
}

function localOrigin(value: string | undefined, expected: string) {
  // Exact strings intentionally reject credentials, paths, queries, fragments,
  // alternate IP spellings and lookalike hosts before any client is created.
  if (value !== expected) throw new Error('HHS local-test requires explicit loopback endpoints.');
  return value;
}

function localAnonKey(value: string | undefined) {
  // Local CLI legacy anon JWT only. This is a configuration guard, NOT token
  // authentication; GoTrue still verifies signatures and enforces auth/RLS.
  try {
    const parts = value?.split('.');
    if (!parts || parts.length !== 3 || !parts.every(Boolean)) throw new Error();
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    if (claims.role !== 'anon' || claims.iss !== 'supabase-demo' || claims.ref) throw new Error();
    return value!;
  } catch {
    // Never include the supplied key in errors or logs.
    throw new Error('HHS local-test requires an explicit local Supabase anon JWT.');
  }
}

export const HHS_WEB_ORIGIN = HHS_LOCAL_TEST
  ? localOrigin(process.env.EXPO_PUBLIC_HHS_WEB_ORIGIN, 'http://127.0.0.1:3100')
  : 'https://hallowedhopsociety.com';

export function isHhsInternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (HHS_LOCAL_TEST) {
      return url.origin === HHS_WEB_ORIGIN && !url.username && !url.password;
    }
    return url.protocol === 'https:' &&
      (url.hostname === 'hallowedhopsociety.com' || url.hostname === 'www.hallowedhopsociety.com');
  } catch {
    return false;
  }
}

export const HHS_WEBVIEW_ORIGINS = HHS_LOCAL_TEST
  // WebView opens non-whitelisted URLs in the OS BEFORE calling our predicate.
  // Route every candidate through the fail-closed local callback instead. This
  // wildcard is interception, not permission to navigate to arbitrary origins.
  ? ['*']
  : ['https://*', 'mailto:*', 'tel:*', 'venmo:*'];

export const SUPABASE_URL = HHS_LOCAL_TEST
  ? localOrigin(process.env.EXPO_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321')
  :
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (typeof expoExtra.supabaseUrl === 'string' ? expoExtra.supabaseUrl : undefined) ??
  PRODUCTION_SUPABASE_URL;

// Prefer the explicit native anon key name, but accept the web app's public
// publishable-key name so the repos can share safe public config during the
// migration. Never put service-role keys in Expo public env.
export const SUPABASE_ANON_KEY = HHS_LOCAL_TEST
  ? localAnonKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
  :
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  (typeof expoExtra.supabaseAnonKey === 'string' ? expoExtra.supabaseAnonKey : undefined) ??
  (typeof expoExtra.supabasePublishableKey === 'string' ? expoExtra.supabasePublishableKey : undefined) ??
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseEnvConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Internal-only test hook for validating the October beer reveal flow.
// Remove hhsTestDate from app.json, or leave EXPO_PUBLIC_HHS_TEST_DATE unset,
// before production release builds that should use the device clock.
export const HHS_TEST_DATE =
  process.env.EXPO_PUBLIC_HHS_TEST_DATE ??
  (typeof expoExtra.hhsTestDate === 'string' ? expoExtra.hhsTestDate : undefined);

// The native shell is now the production app surface. Default to native even if
// expo-constants does not expose embedded app.json `extra` at runtime; only an
// explicit 0 disables it for local fallback debugging.
const nativeBeerScreenFlag =
  process.env.EXPO_PUBLIC_HHS_NATIVE_BEER_SCREEN ??
  (typeof expoExtra.hhsNativeBeerScreen === 'string' ? expoExtra.hhsNativeBeerScreen : undefined);

export const USE_NATIVE_BEER_SCREEN = nativeBeerScreenFlag !== '0';
