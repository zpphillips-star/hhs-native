import AsyncStorage from '@react-native-async-storage/async-storage';

export type RankingsDisplayPreferences = {
  showMyBeersInRankings: boolean;
};

export const DEFAULT_RANKINGS_DISPLAY_PREFERENCES: RankingsDisplayPreferences = {
  showMyBeersInRankings: true,
};

function getRankingsDisplayPreferencesStorageKey(userId?: string | null) {
  return userId ? `@hhs:rankings-display-preferences:${userId}` : '@hhs:rankings-display-preferences';
}

export async function loadRankingsDisplayPreferences(userId?: string | null): Promise<RankingsDisplayPreferences> {
  try {
    const raw = await AsyncStorage.getItem(getRankingsDisplayPreferencesStorageKey(userId));
    if (raw) {
      return {
        ...DEFAULT_RANKINGS_DISPLAY_PREFERENCES,
        ...(JSON.parse(raw) as Partial<RankingsDisplayPreferences>),
      };
    }
  } catch (err) {
    console.warn('[HHS rankings] failed to load local rankings display preferences:', err);
  }

  return { ...DEFAULT_RANKINGS_DISPLAY_PREFERENCES };
}

export async function saveRankingsDisplayPreferences(
  userId: string | undefined | null,
  preferences: RankingsDisplayPreferences,
): Promise<void> {
  try {
    await AsyncStorage.setItem(getRankingsDisplayPreferencesStorageKey(userId), JSON.stringify(preferences));
  } catch (err) {
    console.warn('[HHS rankings] failed to save local rankings display preferences:', err);
    throw new Error('Could not save Rankings display preference on this device.');
  }
}
