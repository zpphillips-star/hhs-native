/**
 * NativeRankingsScreen — Batch 1 shell
 *
 * Layout:
 *   • Page header: "The Society Standings" + subheading
 *   • Two top-tabs: "Top Beers" | "Members"
 *   • Top Beers tab: loading / empty / error scaffold (no scoring data yet)
 *   • Members tab: auth gate → sign-in CTA if logged out; empty scaffold if signed in
 *   • Pull-to-refresh scaffold on both tabs
 *
 * Batch 2 will add real Supabase queries for rankings/member scores.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';

// ─── Types ────────────────────────────────────────────────────────────────────

type RankingsTab = 'topBeers' | 'members';

type LoadState = 'idle' | 'loading' | 'empty' | 'error';

// ─── Component ────────────────────────────────────────────────────────────────

export type NativeRankingsScreenProps = {
  /** Called when user taps "Sign in" inside the Members auth gate */
  onOpenAuth: () => void;
};

export function NativeRankingsScreen({ onOpenAuth }: NativeRankingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<RankingsTab>('topBeers');
  const [topBeersState] = useState<LoadState>('empty'); // Batch 2 will drive this
  const [membersState] = useState<LoadState>('empty');  // Batch 2 will drive this
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Batch 2: trigger real data re-fetch here
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* ── Page header ── */}
      <View style={styles.header}>
        <Text style={styles.kicker}>Hallowed Hop Society</Text>
        <Text style={styles.title}>The Society Standings</Text>
        <Text style={styles.subheading}>Who&apos;s drinking. What&apos;s winning.</Text>
      </View>

      {/* ── Tab row ── */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabPill, activeTab === 'topBeers' && styles.tabPillActive]}
          onPress={() => setActiveTab('topBeers')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabPillText, activeTab === 'topBeers' && styles.tabPillTextActive]}>
            Top Beers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabPill, activeTab === 'members' && styles.tabPillActive]}
          onPress={() => setActiveTab('members')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabPillText, activeTab === 'members' && styles.tabPillTextActive]}>
            Members
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Tab content ── */}
      {activeTab === 'topBeers' ? (
        <TopBeersTab state={topBeersState} refreshing={refreshing} onRefresh={onRefresh} />
      ) : (
        <MembersTab state={membersState} refreshing={refreshing} onRefresh={onRefresh} onOpenAuth={onOpenAuth} />
      )}
    </View>
  );
}

// ─── Top Beers tab ────────────────────────────────────────────────────────────

function TopBeersTab({
  state,
  refreshing,
  onRefresh,
}: {
  state: LoadState;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentInner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={HHS_COLORS.gold} />}
    >
      {state === 'loading' && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={HHS_COLORS.gold} />
          <Text style={styles.statusText}>Loading standings…</Text>
        </View>
      )}
      {state === 'error' && (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>Couldn&apos;t load beer rankings.</Text>
          <Text style={styles.statusText}>Pull down to try again.</Text>
        </View>
      )}
      {state === 'empty' && (
        <View style={styles.centerBox}>
          <Text style={styles.emptyIcon}>🍺</Text>
          <Text style={styles.emptyTitle}>Rankings Coming Soon</Text>
          <Text style={styles.emptyBody}>
            Top-beer standings will appear here once the Society starts rating this month&apos;s lineup.
            Pull down to refresh.
          </Text>
        </View>
      )}
      {/* Batch 2: render ranked beer rows here */}
    </ScrollView>
  );
}

// ─── Members tab ──────────────────────────────────────────────────────────────

function MembersTab({
  state,
  refreshing,
  onRefresh,
  onOpenAuth,
}: {
  state: LoadState;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenAuth: () => void;
}) {
  const { user, loading } = useAuth();

  // Auth gate: show sign-in CTA when not signed in
  if (!loading && !user) {
    return (
      <View style={styles.authGate}>
        <Text style={styles.emptyIcon}>🔒</Text>
        <Text style={styles.emptyTitle}>Members Only</Text>
        <Text style={styles.emptyBody}>
          Sign in to see where you rank among Society members.
        </Text>
        <TouchableOpacity style={styles.signInButton} onPress={onOpenAuth} activeOpacity={0.82}>
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={HHS_COLORS.gold} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentInner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={HHS_COLORS.gold} />}
    >
      {state === 'loading' && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={HHS_COLORS.gold} />
          <Text style={styles.statusText}>Loading members…</Text>
        </View>
      )}
      {state === 'error' && (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>Couldn&apos;t load member rankings.</Text>
          <Text style={styles.statusText}>Pull down to try again.</Text>
        </View>
      )}
      {state === 'empty' && (
        <View style={styles.centerBox}>
          <Text style={styles.emptyIcon}>🏅</Text>
          <Text style={styles.emptyTitle}>Member Standings Coming Soon</Text>
          <Text style={styles.emptyBody}>
            Member scores and leaderboard will appear here. Pull down to refresh.
          </Text>
        </View>
      )}
      {/* Batch 2: render member score rows here */}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    backgroundColor: HHS_COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: HHS_COLORS.border,
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  kicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    marginBottom: 6,
    textAlign: 'center',
  },
  title: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  subheading: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },

  // Tab row
  tabRow: {
    borderBottomColor: HHS_COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabPill: {
    alignItems: 'center',
    borderColor: HHS_COLORS.border,
    borderRadius: HHS_STYLES.pillRadius,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 9,
  },
  tabPillActive: {
    backgroundColor: HHS_COLORS.goldDim,
    borderColor: HHS_COLORS.borderStrong,
  },
  tabPillText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  tabPillTextActive: {
    color: HHS_COLORS.gold,
  },

  // Shared tab content
  tabContent: {
    flex: 1,
  },
  tabContentInner: {
    flexGrow: 1,
    padding: 20,
  },

  // State boxes
  centerBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 44,
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyBody: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  statusText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  errorText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.danger,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },

  // Auth gate
  authGate: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  signInButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: HHS_STYLES.pillRadius,
    marginTop: 20,
    paddingHorizontal: 36,
    paddingVertical: 13,
  },
  signInButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 15,
    fontWeight: '700',
  },
});
