import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { HHS_WEB_ORIGIN } from '../../config/env';
import { getAuthenticatedApiHeaders } from '../../lib/nativeApiAuth';

const PUSH_TOKEN_STORAGE_PREFIX = '@hhs:push-token';
const HHS_EXPO_PROJECT_ID = '7c415298-5d23-4f3d-b818-60a6ba5475a2';

export type PushRegistrationUser = {
  id?: string | null;
  email?: string | null;
};

export type PushPermissionStatus = Notifications.PermissionStatus | 'unknown';

export type PushRegistrationResult = {
  ok: boolean;
  status: PushPermissionStatus;
  token?: string;
  provider?: 'expo' | 'fcm';
  registered?: boolean;
  skipped?: boolean;
  message: string;
};

export type PushRegistrationSupport = {
  canRegister: boolean;
  reason?: string;
};

function getPushTokenStorageKey(user: PushRegistrationUser) {
  const userKey = (user.id || user.email || '').toLowerCase();
  return `${PUSH_TOKEN_STORAGE_PREFIX}:${Platform.OS}:${userKey}`;
}

function requirePushUser(user: PushRegistrationUser) {
  if (!user.id) {
    throw new Error('A signed-in user id is required to register this device for push notifications.');
  }
  return {
    id: user.id,
    email: user.email ?? undefined,
  };
}

export async function getCurrentPushPermissionStatus(): Promise<PushPermissionStatus> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    return permission.status;
  } catch {
    return 'unknown';
  }
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('hhs-updates', {
    name: 'Hallowed Hop Society updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function getGrantedPushPermission(shouldRequestPermission: boolean) {
  await ensureAndroidNotificationChannel();

  const existingPermission = await Notifications.getPermissionsAsync();
  if (existingPermission.status === 'granted') return existingPermission;
  if (!shouldRequestPermission) return existingPermission;
  return Notifications.requestPermissionsAsync();
}

function hasAndroidGoogleServicesConfig() {
  const androidConfig = (Constants.expoConfig?.android ?? {}) as { googleServicesFile?: unknown };
  return typeof androidConfig.googleServicesFile === 'string' && androidConfig.googleServicesFile.trim().length > 0;
}

export function getPushRegistrationSupport(): PushRegistrationSupport {
  const executionEnvironment = getExecutionEnvironmentName();

  if (executionEnvironment === 'storeClient') {
    return {
      canRegister: false,
      reason: 'Social push registration only works in the installed HHS app build, not Expo Go.',
    };
  }

  if (Platform.OS === 'android' && !hasAndroidGoogleServicesConfig()) {
    return {
      canRegister: false,
      reason: 'Android social push is not ready in this build yet. Firebase google-services.json is still missing, so device registration stays disabled until a rebuilt app includes it.',
    };
  }

  return { canRegister: true };
}

export async function requestNotificationPermission(): Promise<{
  ok: boolean;
  status: PushPermissionStatus;
  message: string;
}> {
  try {
    const permission = await getGrantedPushPermission(true);
    if (permission.status === 'granted') {
      return {
        ok: true,
        status: permission.status,
        message: 'Notification permission is enabled for this device.',
      };
    }

    return {
      ok: false,
      status: permission.status,
      message:
        permission.status === 'denied'
          ? 'Notifications are blocked in system settings.'
          : 'Notification permission has not been granted yet.',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unknown',
      message: formatPushRegistrationError(error),
    };
  }
}

function getExecutionEnvironmentName() {
  const runtime = (Constants as { executionEnvironment?: unknown }).executionEnvironment;
  return typeof runtime === 'string' ? runtime : '';
}

function formatPushRegistrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Push registration failed.');
  const normalized = message.toLowerCase();
  const executionEnvironment = getExecutionEnvironmentName();

  if (executionEnvironment === 'storeClient') {
    return 'Push registration only works in the installed HHS app build, not Expo Go.';
  }

  if (
    Platform.OS === 'android' &&
    (
      normalized.includes('firebaseapp') ||
      normalized.includes('default firebase') ||
      normalized.includes('messaging') ||
      normalized.includes('google-services')
    )
  ) {
    return 'Android push is not fully configured in this build yet. Add a valid google-services.json / Firebase setup and rebuild the app.';
  }

  if (normalized.includes('projectid')) {
    return 'Expo push project configuration is missing or invalid for this build.';
  }

  return message || 'Push registration failed.';
}

async function getPushTokenForCurrentPlatform(): Promise<{ token: string; provider: 'expo' | 'fcm' }> {
  if (Platform.OS === 'android') {
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const token = typeof tokenData.data === 'string' ? tokenData.data.trim() : '';
    if (!token) {
      throw new Error('Firebase Cloud Messaging did not return a device token for this Android device.');
    }
    return { token, provider: 'fcm' };
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: HHS_EXPO_PROJECT_ID,
  });
  const token = tokenData.data?.trim();
  if (!token) {
    throw new Error('Expo did not return a push token for this device.');
  }
  return { token, provider: 'expo' };
}

export async function registerDeviceForPushNotifications(
  user: PushRegistrationUser,
  options: { requestPermission: boolean } = { requestPermission: false },
): Promise<PushRegistrationResult> {
  let pushUser: { id: string; email?: string };
  try {
    pushUser = requirePushUser(user);
  } catch (error) {
    return {
      ok: false,
      status: 'unknown',
      message: error instanceof Error ? error.message : 'Signed-in user is required.',
    };
  }

  try {
    const support = getPushRegistrationSupport();
    if (!support.canRegister) {
      return {
        ok: false,
        status: await getCurrentPushPermissionStatus(),
        message: support.reason ?? 'Push registration is not available in this build.',
      };
    }

    const permission = await getGrantedPushPermission(options.requestPermission);
    if (permission.status !== 'granted') {
      return {
        ok: false,
        status: permission.status,
        message:
          permission.status === 'denied'
            ? 'Push notifications are blocked in system settings.'
            : 'Push notification permission has not been granted yet.',
      };
    }

    const authHeaders = await getAuthenticatedApiHeaders(pushUser.id);
    const { token, provider } = await getPushTokenForCurrentPlatform();
    if (!token) {
      return {
        ok: false,
        status: permission.status,
        provider,
        message: 'No push token was returned for this device.',
      };
    }

    const cacheKey = getPushTokenStorageKey(pushUser);
    const cachedToken = await AsyncStorage.getItem(cacheKey).catch(() => null);

    const response = await fetch(`${HHS_WEB_ORIGIN}/api/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        user_id: pushUser.id,
        email: pushUser.email,
        token,
        platform: Platform.OS,
        token_provider: provider,
        token_type: provider === 'fcm' ? 'native' : 'expo',
        previous_token: cachedToken && cachedToken !== token ? cachedToken : undefined,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        status: permission.status,
        token,
        provider,
        registered: false,
        message: text || `Push token registration failed (${response.status}).`,
      };
    }

    await AsyncStorage.setItem(cacheKey, token);
    return {
      ok: true,
      status: permission.status,
      token,
      provider,
      registered: true,
      skipped: cachedToken === token,
      message:
        provider === 'fcm'
          ? 'This Android device is registered directly with Firebase Cloud Messaging.'
          : 'This device is registered for push notifications.',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unknown',
      message: formatPushRegistrationError(error),
    };
  }
}

/**
 * Returns true if this device has a locally-cached push token for the given user,
 * meaning registration completed successfully at least once.
 * Does NOT validate that the token is still accepted by the backend or Expo.
 */
export async function isDeviceRegisteredLocally(user: PushRegistrationUser): Promise<boolean> {
  try {
    if (!user.id) return false;
    const cacheKey = getPushTokenStorageKey({ id: user.id, email: user.email });
    const cached = await AsyncStorage.getItem(cacheKey);
    return Boolean(cached);
  } catch {
    return false;
  }
}

export async function unregisterCachedPushToken(user: PushRegistrationUser): Promise<{ ok: boolean; skipped?: boolean; message: string }> {
  let pushUser: { id: string; email?: string };
  try {
    pushUser = requirePushUser(user);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Signed-in user is required.',
    };
  }

  const cacheKey = getPushTokenStorageKey(pushUser);
  const cachedToken = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (!cachedToken) {
    return {
      ok: true,
      skipped: true,
      message: 'No cached push token was found for this device; no backend token was removed.',
    };
  }

  try {
    const authHeaders = await getAuthenticatedApiHeaders(pushUser.id);
    const response = await fetch(`${HHS_WEB_ORIGIN}/api/push-token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ user_id: pushUser.id, token: cachedToken }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        message: text || `Push token removal failed (${response.status}).`,
      };
    }

    await AsyncStorage.removeItem(cacheKey);
    return {
      ok: true,
      message: 'This device push token was removed from the backend.',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Push token removal failed.',
    };
  }
}
