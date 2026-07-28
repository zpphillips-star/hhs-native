import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'hhs.supabase';
const ASYNC_FALLBACK_PREFIX = '@hhs:supabase-fallback';
const CHUNK_SIZE = 1800;

type ChunkMeta = {
  chunks: number;
};

function storageKey(key: string) {
  return `${KEY_PREFIX}.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function fallbackKey(key: string) {
  return `${ASYNC_FALLBACK_PREFIX}:${key}`;
}

async function removeSecureChunks(baseKey: string) {
  const rawMeta = await SecureStore.getItemAsync(`${baseKey}.meta`).catch(() => null);
  if (rawMeta) {
    try {
      const meta = JSON.parse(rawMeta) as Partial<ChunkMeta>;
      const count = typeof meta.chunks === 'number' ? meta.chunks : 0;
      await Promise.all(
        Array.from({ length: count }, (_, index) =>
          SecureStore.deleteItemAsync(`${baseKey}.${index}`).catch(() => undefined),
        ),
      );
    } catch {
      // Best-effort cleanup; stale chunks are harmless once the meta key is gone.
    }
  }

  await Promise.all([
    SecureStore.deleteItemAsync(baseKey).catch(() => undefined),
    SecureStore.deleteItemAsync(`${baseKey}.meta`).catch(() => undefined),
  ]);
}

async function secureStoreAvailable() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export const supabaseSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const baseKey = storageKey(key);

    if (await secureStoreAvailable()) {
      try {
        const rawMeta = await SecureStore.getItemAsync(`${baseKey}.meta`);
        if (rawMeta) {
          const meta = JSON.parse(rawMeta) as Partial<ChunkMeta>;
          const count = typeof meta.chunks === 'number' ? meta.chunks : 0;
          if (count > 0) {
            const chunks = await Promise.all(
              Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${baseKey}.${index}`)),
            );
            if (chunks.every((chunk): chunk is string => typeof chunk === 'string')) {
              return chunks.join('');
            }
          }
          return null;
        }

        const legacyValue = await SecureStore.getItemAsync(baseKey);
        if (legacyValue) return legacyValue;
      } catch (error) {
        console.warn('[HHS native] SecureStore session read failed; checking fallback storage.', error);
      }
    }

    return AsyncStorage.getItem(fallbackKey(key));
  },

  async setItem(key: string, value: string): Promise<void> {
    const baseKey = storageKey(key);

    if (await secureStoreAvailable()) {
      try {
        await removeSecureChunks(baseKey);
        const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) ?? [''];
        await Promise.all(
          chunks.map((chunk, index) => SecureStore.setItemAsync(`${baseKey}.${index}`, chunk)),
        );
        await SecureStore.setItemAsync(`${baseKey}.meta`, JSON.stringify({ chunks: chunks.length } satisfies ChunkMeta));
        await AsyncStorage.removeItem(fallbackKey(key)).catch(() => undefined);
        return;
      } catch (error) {
        console.warn('[HHS native] SecureStore session write failed; using AsyncStorage fallback.', error);
      }
    }

    await AsyncStorage.setItem(fallbackKey(key), value);
  },

  async removeItem(key: string): Promise<void> {
    await Promise.all([
      secureStoreAvailable().then((available) => (available ? removeSecureChunks(storageKey(key)) : undefined)),
      AsyncStorage.removeItem(fallbackKey(key)).catch(() => undefined),
    ]);
  },
};

