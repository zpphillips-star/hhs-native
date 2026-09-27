import { supabase } from './supabase';

export async function getAuthenticatedApiHeaders(expectedUserId: string): Promise<Record<string, string>> {
  if (!supabase) {
    throw new Error('Supabase public env is not configured for the native app.');
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }

  const session = data.session;
  const accessToken = session?.access_token;
  const sessionUserId = session?.user?.id;

  if (!accessToken || !sessionUserId) {
    throw new Error('Your session expired. Sign in again to manage notifications.');
  }

  if (sessionUserId !== expectedUserId) {
    throw new Error('Signed-in user does not match the notification settings request.');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}
