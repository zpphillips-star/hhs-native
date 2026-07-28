import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { HHS_WEB_ORIGIN } from '../../config/env';

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
  registered?: boolean;
  skipped?: boolean;
  message: string;
};

function getPushTokenStorageKey(user: PushRegistrationUser) {
  const userKey = (user.id || user.email || '').toLowerCase();
  return `${PUSH_TOKEN_STORAGE_PREFIX}:${userKey}`;
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

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: HHS_EXPO_PROJECT_ID,
    });
    const token = tokenData.data;
    if (!token) {
      return {
        ok: false,
        status: permission.status,
        message: 'Expo did not return a push token for this device.',
      };
    }

    const cacheKey = getPushTokenStorageKey(pushUser);
    const cachedToken = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cachedToken === token) {
      return {
        ok: true,
        status: permission.status,
        token,
        registered: true,
        skipped: true,
        message: 'This device is already registered for push notifications.',
      };
    }

    const response = await fetch(`${HHS_WEB_ORIGIN}/api/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: pushUser.id,
        email: pushUser.email,
        token,
        platform: Platform.OS,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        status: permission.status,
        token,
        registered: false,
        message: text || `Push token registration failed (${response.status}).`,
      };
    }

    await AsyncStorage.setItem(cacheKey, token);
    return {
      ok: true,
      status: permission.status,
      token,
      registered: true,
      message: 'This device is registered for push notifications.',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unknown',
      message: error instanceof Error ? error.message : 'Push registration failed.',
    };
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
    const response = await fetch(`${HHS_WEB_ORIGIN}/api/push-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
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
