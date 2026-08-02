/**
 * NativeRankingsScreen — Batch 2
 *
 * Layout:
 *   • Page header: "The Society Standings" + subheading
 *   • Two top-tabs: "Top Beers" | "Members"
 *   • Top Beers tab: real Supabase leaderboard — medal/rank, beer name,
 *     brewery + Day N, star display, avg + count; #1 row gets a gold tint.
 *   • Members tab: auth gate → sign-in CTA if logged out; empty scaffold
 *     if signed in (member scoring is a future batch).
 *   • Pull-to-refresh triggers a full data re-fetch on the active tab.
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import { fetchTopBeers, type RankedBeer } from './rankingsService';

// ─── Types ────────────────────────────────────────────────────────────────────

type RankingsTab = 'topBeers' | 'members';

type LoadState = 'idle' | 'loading' | 'empty' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rankMedal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

/** Render filled + empty stars matching the pattern used on NativeBeerScreen */
function starsDisplay(avg: number): string {
  const filled = Math.round(avg);
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

// ─── Component ────────────────────────────────────────────────────────────────

export type NativeRankingsScreenProps = {
  /** Called when user taps "Sign in" inside the Members auth gate */
  onOpenAuth: () => void;
};

export function NativeRankingsScreen({ onOpenAuth }: NativeRankingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<RankingsTab>('topBeers');

  // ── Top Beers state ──
  const [topBeersLoadState, setTopBeersLoadState] = useState<LoadState>('idle');
  const [topBeers, setTopBeers] = useState<RankedBeer[]>([]);
  const [topBeersError, setTopBeersError] = useState<string | null>(null);

  // ── Members state (scaffold — no scoring yet) ──
  const [membersLoadState] = useState<LoadState>('empty');

  const [refreshing, setRefreshing] = useState(false);

  // Load top beers on mount
  const loadTopBeers = useCallback(async () => {
    setTopBeersLoadState('loading');
    setTopBeersError(null);
    try {
      const ranked = await fetchTopBeers();
      setTopBeers(ranked);
      setTopBeersLoadState(ranked.length === 0 ? 'empty' : 'idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[HHS Rankings] fetchTopBeers failed:', msg);
      setTopBeersError(msg);
      setTopBeersLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadTopBeers();
  }, [loadTopBeers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'topBeers') {
      await loadTopBeers();
    }
    setRefreshing(false);
  }, [activeTab, loadTopBeers]);

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
        <TopBeersTab
          loadState={topBeersLoadState}
          rankings={topBeers}
          errorMessage={topBeersError}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        />
      ) : (
        <MembersTab
          state={membersLoadState}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          onOpenAuth={onOpenAuth}
        />
      )}
    </View>
  );
}

// ─── Top Beers tab ────────────────────────────────────────────────────────────

function TopBeersTab({
  loadState,
  rankings,
  errorMessage,
  refreshing,
  onRefresh,
}: {
  loadState: LoadState;
  rankings: RankedBeer[];
  errorMessage: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentInner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={HHS_COLORS.gold} />}
    >
      {loadState === 'loading' && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={HHS_COLORS.gold} />
          <Text style={styles.statusText}>Loading standings…</Text>
        </View>
      )}
      {loadState === 'error' && (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>Couldn&apos;t load beer rankings.</Text>
          {errorMessage ? (
            <Text style={styles.errorDetail}>{errorMessage}</Text>
          ) : null}
          <Text style={styles.statusText}>Pull down to try again.</Text>
        </View>
      )}
      {loadState === 'empty' && (
        <View style={styles.centerBox}>
          <Text style={styles.emptyIcon}>🍺</Text>
          <Text style={styles.emptyTitle}>No Rankings Yet</Text>
          <Text style={styles.emptyBody}>
            Top-beer standings will appear here once the Society starts rating this month&apos;s lineup.
            Pull down to refresh.
          </Text>
        </View>
      )}
      {loadState === 'idle' && rankings.length > 0 && (
        <View style={styles.leaderboard}>
          {rankings.map((item) => (
            <BeerRankingRow key={item.beer.id} item={item} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Beer ranking row ─────────────────────────────────────────────────────────

function BeerRankingRow({ item }: { item: RankedBeer }) {
  const isFirst = item.rank === 1;
  const medalText = rankMedal(item.rank);
  const isMedalEmoji = item.rank <= 3;

  return (
    <View style={[styles.rankRow, isFirst && styles.rankRowFirst]}>
      {/* Medal / rank badge */}
      <View style={styles.rankBadge}>
        {isMedalEmoji ? (
          <Text style={styles.medalEmoji}>{medalText}</Text>
        ) : (
          <Text style={[styles.rankNumber, isFirst && styles.rankNumberFirst]}>{medalText}</Text>
        )}
      </View>

      {/* Beer info */}
      <View style={styles.rankInfo}>
        <Text style={[styles.beerName, isFirst && styles.beerNameFirst]} numberOfLines={1}>
          {item.beer.name}
        </Text>
        <Text style={styles.beerMeta} numberOfLines={1}>
          {item.beer.brewery} · Day {item.beer.day_number}
        </Text>

        {/* Stars + numeric */}
        <View style={styles.ratingRow}>
          <Text style={[styles.starsText, isFirst && styles.starsTextFirst]}>
            {starsDisplay(item.avgStars)}
          </Text>
          <Text style={styles.ratingDetail}>
            {item.avgStars.toFixed(1)} · {item.ratingCount} {item.ratingCount === 1 ? 'rating' : 'ratings'}
          </Text>
        </View>
      </View>
    </View>
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
    padding: 16,
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
  errorDetail: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
    marginBottom: 8,
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

  // Leaderboard
  leaderboard: {
    gap: 10,
  },
  rankRow: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  rankRowFirst: {
    backgroundColor: 'rgba(217, 124, 43, 0.10)',
    borderColor: HHS_COLORS.borderStrong,
  },
  rankBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 38,
  },
  medalEmoji: {
    fontSize: 28,
    lineHeight: 34,
    textAlign: 'center',
  },
  rankNumber: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.muted,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  rankNumberFirst: {
    color: HHS_COLORS.gold,
  },
  rankInfo: {
    flex: 1,
    gap: 3,
  },
  beerName: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  beerNameFirst: {
    color: HHS_COLORS.goldLight,
  },
  beerMeta: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
  },
  ratingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  starsText: {
    color: HHS_COLORS.muted,
    fontSize: 16,
    lineHeight: 20,
  },
  starsTextFirst: {
    color: HHS_COLORS.gold,
  },
  ratingDetail: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 13,
  },
});
