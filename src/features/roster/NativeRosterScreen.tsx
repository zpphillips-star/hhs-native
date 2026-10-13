import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { fetchHhsRoster, type HhsRosterMember } from './rosterService';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';

type NativeRosterScreenProps = {
  onBack?: () => void;
};

function getMemberLabel(member: HhsRosterMember) {
  const username = member.username.replace(/^@+/, '').trim();
  if (member.first_name) return `${username} · ${member.first_name}`;
  return username;
}

export function NativeRosterScreen({ onBack }: NativeRosterScreenProps) {
  const { user } = useAuth();
  const [members, setMembers] = useState<HhsRosterMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupedMembers = useMemo(() => {
    const groups = new Map<string, HhsRosterMember[]>();
    for (const member of members) {
      const source = member.username.replace(/^@+/, '').trim();
      const key = source.charAt(0).toUpperCase() || '#';
      groups.set(key, [...(groups.get(key) ?? []), member]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [members]);

  const loadRoster = useCallback(async (showRefresh = false) => {
    if (!user?.id) {
      setMembers([]);
      setError('Sign in is required to view the HHS Roster.');
      return;
    }

    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const nextMembers = await fetchHhsRoster(user.id);
      setMembers(nextMembers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the HHS Roster.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor={HHS_COLORS.background} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              colors={[HHS_COLORS.gold]}
              onRefresh={() => void loadRoster(true)}
              refreshing={refreshing}
              tintColor={HHS_COLORS.gold}
            />
          }
        >
          <View style={styles.header}>
            {onBack ? (
              <TouchableOpacity activeOpacity={0.82} onPress={onBack} style={styles.backButton} accessibilityLabel="Back to Your Beer">
                <Text style={styles.backButtonText}>‹</Text>
              </TouchableOpacity>
            ) : null}
            <View>
              <Text style={styles.appKicker}>Hallowed Hop Society</Text>
              <Text style={styles.headerTitle}>HHS Roster</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionKicker}>Members Only</Text>
            <Text style={styles.cardTitle}>Society Roster</Text>
            <Text style={styles.bodyText}>
              Approved members can see usernames and first names only. Emails and last names are never shown here.
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={HHS_COLORS.gold} size="large" />
              <Text style={styles.loadingText}>Gathering the Society...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Roster unavailable</Text>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity activeOpacity={0.85} onPress={() => void loadRoster()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : members.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.bodyText}>No approved members are visible yet.</Text>
            </View>
          ) : (
            groupedMembers.map(([letter, group]) => (
              <View key={letter} style={styles.groupCard}>
                <Text style={styles.groupKicker}>{letter}</Text>
                {group.map((member) => (
                  <View key={member.id} style={styles.memberRow}>
                    <Text style={styles.memberName}>{getMemberLabel(member)}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: HHS_COLORS.background,
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  backButtonText: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.gold,
    fontSize: 32,
    lineHeight: 34,
    marginTop: -3,
  },
  appKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    letterSpacing: 2.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  headerTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 34,
  },
  card: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
    padding: 18,
  },
  sectionKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 24,
  },
  bodyText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    gap: 12,
    padding: 28,
  },
  loadingText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 15,
  },
  errorCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.borderStrong,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    marginBottom: 16,
    padding: 18,
  },
  errorTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.gold,
    fontSize: 18,
    marginBottom: 8,
  },
  errorText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.danger,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 13,
  },
  groupCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  groupKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    backgroundColor: HHS_COLORS.cardAlt,
    color: HHS_COLORS.gold,
    fontSize: 11,
    letterSpacing: 2,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  memberRow: {
    borderTopColor: HHS_COLORS.border,
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  memberName: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 16,
  },
});
