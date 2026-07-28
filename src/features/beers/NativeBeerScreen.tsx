import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { fetchBeers } from './beerService';
import type { Beer } from './types';

const COLORS = {
  background: '#191726',
  card: '#201d30',
  cardAlt: '#28233a',
  text: '#d9d8d2',
  muted: '#a69d8d',
  gold: '#d97c2b',
  border: 'rgba(217, 124, 43, 0.18)',
  borderStrong: 'rgba(217, 124, 43, 0.45)',
};

type NativeBeerScreenProps = {
  onOpenWebFallback: () => void;
};

function formatBeerMeta(beer: Beer) {
  const parts = [beer.style, beer.abv ? `${beer.abv}% ABV` : null].filter(Boolean);
  return parts.join(' · ');
}

function getOctoberStart(now: Date) {
  const octoberStart = new Date(now.getFullYear(), 9, 1);
  if (octoberStart.getTime() < now.getTime()) {
    octoberStart.setFullYear(octoberStart.getFullYear() + 1);
  }
  return octoberStart;
}

function getCountdownText(now: Date) {
  const diff = getOctoberStart(now).getTime() - now.getTime();
  const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
  return `${days} days · ${hours} hrs`;
}

export function NativeBeerScreen({ onOpenWebFallback }: NativeBeerScreenProps) {
  const [beers, setBeers] = useState<Beer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const isOctober = now.getMonth() === 9;
  const year = now.getFullYear();
  const todayDay = isOctober ? now.getDate() : null;

  const beerMap = useMemo(() => {
    const map = new Map<number, Beer>();
    beers.forEach((beer) => map.set(beer.day_number, beer));
    return map;
  }, [beers]);

  const todayBeer = todayDay ? beerMap.get(todayDay) ?? null : null;

  const loadBeers = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const list = await fetchBeers();
      setBeers(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load the beer list.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadBeers();
  }, [loadBeers]);

  const renderToday = () => {
    if (isOctober && !todayBeer) {
      return (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>Today&apos;s beer hasn&apos;t been added yet. Check back soon.</Text>
        </View>
      );
    }

    if (!isOctober || !todayBeer) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>The Calendar Is Being Set</Text>
          <Text style={styles.countdown}>{getCountdownText(now)}</Text>
          <Text style={styles.bodyText}>
            Every October, the Society convenes. Thirty-one days. Thirty-one beers. The calendar
            isn&apos;t set yet — but the 31 slots below are reserved.
          </Text>
        </View>
      );
    }

    const meta = formatBeerMeta(todayBeer);
    return (
      <View style={styles.todaySection}>
        <Text style={styles.kicker}>Today&apos;s Beer</Text>
        <Text style={styles.dayLabel}>Day {todayBeer.day_number} · October {todayBeer.day_number}, {year}</Text>
        {todayBeer.image_url ? (
          <Image source={{ uri: todayBeer.image_url }} style={styles.heroImage} resizeMode="cover" />
        ) : null}
        <Text style={styles.beerTitle}>{todayBeer.name}</Text>
        <Text style={styles.breweryTitle}>{todayBeer.brewery}</Text>
        {meta ? <Text style={styles.metaText}>{meta}</Text> : null}
        {todayBeer.description ? <Text style={styles.descriptionText}>{todayBeer.description}</Text> : null}
        {(todayBeer.beer_fact || todayBeer.brewery_fact) ? (
          <View style={styles.factCard}>
            {todayBeer.beer_fact ? (
              <View>
                <Text style={styles.factLabel}>The Beer</Text>
                <Text style={styles.factText}>{todayBeer.beer_fact}</Text>
              </View>
            ) : null}
            {todayBeer.beer_fact && todayBeer.brewery_fact ? <View style={styles.divider} /> : null}
            {todayBeer.brewery_fact ? (
              <View>
                <Text style={styles.factLabel}>The Brewery</Text>
                <Text style={styles.factText}>{todayBeer.brewery_fact}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderList = () => {
    if (!loading && !error && beers.length === 0) {
      return (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>The sacred list is empty for now.</Text>
        </View>
      );
    }

    const days = Array.from({ length: 31 }, (_, index) => index + 1);
    return (
      <View style={styles.list}>
        {days.map((day) => {
          const beer = beerMap.get(day);
          const isToday = day === todayDay;
          const isPast = todayDay ? day < todayDay : false;
          const shouldReveal = Boolean(beer && (isPast || isToday));

          return (
            <View
              key={day}
              style={[
                styles.listItem,
                isToday && styles.todayListItem,
                isPast && !isToday && styles.pastListItem,
              ]}
            >
              <Text style={[styles.dayNumber, isToday && styles.todayText]}>{day}</Text>
              <View style={styles.listText}>
                {shouldReveal && beer ? (
                  <>
                    <Text style={styles.listBeerName} numberOfLines={1}>{beer.name}</Text>
                    <Text style={styles.listBrewery} numberOfLines={1}>{beer.brewery}</Text>
                  </>
                ) : (
                  <Text style={styles.unrevealedText}>To be revealed...</Text>
                )}
              </View>
              {isToday ? (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>TODAY</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor={COLORS.background} />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadBeers(true)}
              tintColor={COLORS.gold}
              colors={[COLORS.gold]}
            />
          }
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.appKicker}>Hallowed Hop Society</Text>
              <Text style={styles.headerTitle}>Beers</Text>
            </View>
            <TouchableOpacity style={styles.webFallbackButton} onPress={onOpenWebFallback} activeOpacity={0.8}>
              <Text style={styles.webFallbackText}>Web</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={COLORS.gold} size="large" />
              <Text style={styles.loadingText}>Loading the sacred list...</Text>
            </View>
          ) : null}

          {!loading && error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Couldn&apos;t load beers</Text>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadBeers()} activeOpacity={0.85}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!loading && !error ? (
            <>
              {renderToday()}
              <View style={styles.calendarHeader}>
                <Text style={styles.calendarTitle}>October {year}</Text>
                <View style={styles.calendarRule} />
              </View>
              {renderList()}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  appKicker: {
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '700',
  },
  webFallbackButton: {
    borderColor: COLORS.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  webFallbackText: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 28,
  },
  loadingText: {
    color: COLORS.gold,
    fontSize: 15,
  },
  errorCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
  },
  errorTitle: {
    color: COLORS.gold,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gold,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: COLORS.background,
    fontSize: 13,
    fontWeight: '700',
  },
  messageCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
  },
  messageText: {
    color: COLORS.muted,
    fontSize: 15,
    fontStyle: 'italic',
    lineHeight: 22,
    textAlign: 'center',
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 30,
    padding: 22,
  },
  kicker: {
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  countdown: {
    color: COLORS.gold,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 18,
    textAlign: 'center',
  },
  bodyText: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 26,
    textAlign: 'center',
  },
  todaySection: {
    marginBottom: 30,
  },
  dayLabel: {
    color: COLORS.muted,
    fontSize: 12,
    letterSpacing: 1.8,
    marginBottom: 14,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  heroImage: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 14,
    height: 210,
    marginBottom: 18,
    width: '100%',
  },
  beerTitle: {
    color: COLORS.text,
    fontSize: 31,
    fontWeight: '700',
    lineHeight: 36,
    marginBottom: 6,
  },
  breweryTitle: {
    color: COLORS.gold,
    fontSize: 18,
    marginBottom: 4,
  },
  metaText: {
    color: COLORS.muted,
    fontSize: 14,
    marginBottom: 14,
  },
  descriptionText: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 14,
  },
  factCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  factLabel: {
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  factText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 23,
  },
  divider: {
    backgroundColor: COLORS.border,
    height: 1,
  },
  calendarHeader: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 24,
  },
  calendarTitle: {
    color: COLORS.gold,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 4,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  calendarRule: {
    backgroundColor: COLORS.gold,
    height: 2,
    marginBottom: 20,
    opacity: 0.6,
    width: 96,
  },
  list: {
    gap: 10,
  },
  listItem: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  todayListItem: {
    borderColor: COLORS.gold,
  },
  pastListItem: {
    opacity: 0.68,
  },
  dayNumber: {
    color: COLORS.muted,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    width: 32,
  },
  todayText: {
    color: COLORS.gold,
  },
  listText: {
    flex: 1,
    minWidth: 0,
  },
  listBeerName: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 3,
  },
  listBrewery: {
    color: COLORS.gold,
    fontSize: 14,
  },
  unrevealedText: {
    color: COLORS.muted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  todayBadge: {
    backgroundColor: COLORS.gold,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  todayBadgeText: {
    color: COLORS.background,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

