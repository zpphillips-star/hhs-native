import { supabase } from './supabase';

export async function getAuthenticatedApiHeaders(expectedUserId: string): Promise<Record<string, string>> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }

  let session = data.session;
  if (session?.user?.id !== expectedUserId) {
    throw new Error('Sign in as the original account to continue this request.');
  }
  if (session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw new Error(refreshed.error.message);
    session = refreshed.data.session;
  }
  const accessToken = session?.access_token;
  const sessionUserId = session?.user?.id;

  if (!accessToken || !sessionUserId) {
    throw new Error('Your session expired. Sign in again to continue.');
  }

  if (sessionUserId !== expectedUserId) {
    throw new Error('Sign in as the original account to continue this request.');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}
