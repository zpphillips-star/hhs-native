import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { fetchBeers, fetchUserBeerRating, upsertUserBeerRating } from './beerService';
import type { Beer, BeerRating } from './types';

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
  mode?: 'calendar' | 'yourBeer';
  onOpenWebFallback: (path?: string) => void;
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

export function NativeBeerScreen({ mode = 'calendar', onOpenWebFallback }: NativeBeerScreenProps) {
  const { user } = useAuth();
  const [beers, setBeers] = useState<Beer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBeer, setSelectedBeer] = useState<Beer | null>(null);
  const [selectedRating, setSelectedRating] = useState<BeerRating | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [todayRating, setTodayRating] = useState<BeerRating | null>(null);
  const [todayRatingLoading, setTodayRatingLoading] = useState(false);
  const [todayRatingSaving, setTodayRatingSaving] = useState(false);
  const [todayRatingError, setTodayRatingError] = useState<string | null>(null);

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

  const loadSelectedRating = useCallback(async (beer: Beer | null, userId: string | undefined) => {
    setSelectedRating(null);
    setRatingError(null);

    if (!beer || !userId) {
      setRatingLoading(false);
      return;
    }

    setRatingLoading(true);
    try {
      const rating = await fetchUserBeerRating(userId, beer.id);
      setSelectedRating(rating);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load your rating.';
      setRatingError(message);
    } finally {
      setRatingLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void loadSelectedRating(selectedBeer, user?.id);
  }, [loadSelectedRating, selectedBeer, user?.id]);

  useEffect(() => {
    setTodayRating(null);
    setTodayRatingError(null);

    if (mode !== 'yourBeer' || !todayBeer || !user?.id) {
      setTodayRatingLoading(false);
      return;
    }

    let cancelled = false;
    setTodayRatingLoading(true);
    fetchUserBeerRating(user.id, todayBeer.id)
      .then((rating) => {
        if (!cancelled) setTodayRating(rating);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Could not load your rating.';
          setTodayRatingError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setTodayRatingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, todayBeer, user?.id]);

  const openBeerDetail = (beer: Beer) => {
    setSelectedBeer(beer);
  };

  const closeBeerDetail = () => {
    setSelectedBeer(null);
    setSelectedRating(null);
    setRatingError(null);
    setRatingSaving(false);
  };

  const handleRateSelectedBeer = async (stars: number) => {
    if (!user || !selectedBeer || ratingSaving) return;

    setRatingSaving(true);
    setRatingError(null);
    try {
      const rating = await upsertUserBeerRating(user.id, selectedBeer.id, stars);
      setSelectedRating(rating);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your rating.';
      setRatingError(message);
    } finally {
      setRatingSaving(false);
    }
  };

  const handleRateTodayBeer = async (stars: number) => {
    if (!user || !todayBeer || todayRatingSaving) return;

    setTodayRatingSaving(true);
    setTodayRatingError(null);
    try {
      const rating = await upsertUserBeerRating(user.id, todayBeer.id, stars);
      setTodayRating(rating);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your rating.';
      setTodayRatingError(message);
    } finally {
      setTodayRatingSaving(false);
    }
  };

  const renderRatingPanel = ({
    errorMessage,
    loadingRating,
    onRate,
    rating,
    savingRating,
  }: {
    errorMessage: string | null;
    loadingRating: boolean;
    onRate: (stars: number) => void;
    rating: BeerRating | null;
    savingRating: boolean;
  }) => (
    <View style={styles.ratingCard}>
      <Text style={styles.factLabel}>{rating ? 'Your Rating' : 'Rate This Beer'}</Text>
      {user ? (
        <>
          {loadingRating ? (
            <View style={styles.ratingLoadingRow}>
              <ActivityIndicator color={COLORS.gold} />
              <Text style={styles.ratingHelpText}>Loading your rating...</Text>
            </View>
          ) : (
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((star) => {
                const active = star <= (rating?.stars ?? 0);
                return (
                  <TouchableOpacity
                    key={star}
                    style={[styles.starButton, active && styles.starButtonActive]}
                    onPress={() => onRate(star)}
                    activeOpacity={0.8}
                    disabled={savingRating}
                  >
                    <Text style={[styles.starText, active && styles.starTextActive]}>★</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {savingRating ? <Text style={styles.ratingHelpText}>Saving...</Text> : null}
          {errorMessage ? <Text style={styles.ratingErrorText}>{errorMessage}</Text> : null}
        </>
      ) : (
        <Text style={styles.ratingHelpText}>Sign in from The Settings tab or web view to rate this beer.</Text>
      )}
    </View>
  );

  const renderCalendarIntro = () => {
    if (!isOctober) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>The Calendar Is Being Set</Text>
          <Text style={styles.countdown}>{getCountdownText(now)}</Text>
          <Text style={styles.bodyText}>
            Every October, the Society convenes. Thirty-one days. Thirty-one beers. The 2026 calendar
            remains veiled until the ritual begins.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.heroCard}>
        <Text style={styles.kicker}>October {year}</Text>
        <Text style={styles.bodyText}>
          Revealed beers are visible through today. Future pours stay hidden until their day arrives.
        </Text>
      </View>
    );
  };

  const renderYourBeer = () => {
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
          <Text style={styles.kicker}>Your Beer Awaits</Text>
          <Text style={styles.countdown}>{getCountdownText(now)}</Text>
          <Text style={styles.bodyText}>
            Today&apos;s beer becomes the center ritual when October begins. Until then, the circle is
            gathering and the taps remain under wraps.
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
        {renderRatingPanel({
          errorMessage: todayRatingError,
          loadingRating: todayRatingLoading,
          onRate: (stars) => void handleRateTodayBeer(stars),
          rating: todayRating,
          savingRating: todayRatingSaving,
        })}
        <View style={styles.actionGrid}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onOpenWebFallback('/wall')}
            style={styles.detailButton}
          >
            <Text style={styles.detailButtonText}>Open The Wall</Text>
          </TouchableOpacity>
          <View style={styles.placeholderAction}>
            <Text style={styles.placeholderActionTitle}>Check-In</Text>
            <Text style={styles.placeholderActionText}>Native wall posts and check-ins are planned for a later pass.</Text>
          </View>
        </View>
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
            <TouchableOpacity
              key={day}
              style={[
                styles.listItem,
                isToday && styles.todayListItem,
                isPast && !isToday && styles.pastListItem,
                shouldReveal && styles.selectableListItem,
              ]}
              onPress={() => {
                if (shouldReveal && beer) openBeerDetail(beer);
              }}
              activeOpacity={shouldReveal ? 0.82 : 1}
              disabled={!shouldReveal || !beer}
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
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderDetailModal = () => {
    if (!selectedBeer) return null;

    const meta = formatBeerMeta(selectedBeer);

    return (
      <Modal visible transparent animationType="fade" onRequestClose={closeBeerDetail}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalDayLabel}>Day {selectedBeer.day_number} · October {selectedBeer.day_number}</Text>
              <TouchableOpacity style={styles.closeButton} onPress={closeBeerDetail} accessibilityLabel="Close beer detail">
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollContent}>
              {selectedBeer.image_url ? (
                <Image source={{ uri: selectedBeer.image_url }} style={styles.detailImage} resizeMode="cover" />
              ) : null}
              <Text style={styles.modalBeerTitle}>{selectedBeer.name}</Text>
              <Text style={styles.modalBreweryTitle}>{selectedBeer.brewery}</Text>
              {meta ? <Text style={styles.modalMetaText}>{meta}</Text> : null}
              {selectedBeer.description ? (
                <Text style={styles.modalDescriptionText}>{selectedBeer.description}</Text>
              ) : null}

              {(selectedBeer.beer_fact || selectedBeer.brewery_fact) ? (
                <View style={styles.factCard}>
                  {selectedBeer.beer_fact ? (
                    <View>
                      <Text style={styles.factLabel}>The Beer</Text>
                      <Text style={styles.factText}>{selectedBeer.beer_fact}</Text>
                    </View>
                  ) : null}
                  {selectedBeer.beer_fact && selectedBeer.brewery_fact ? <View style={styles.divider} /> : null}
                  {selectedBeer.brewery_fact ? (
                    <View>
                      <Text style={styles.factLabel}>The Brewery</Text>
                      <Text style={styles.factText}>{selectedBeer.brewery_fact}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {renderRatingPanel({
                errorMessage: ratingError,
                loadingRating: ratingLoading,
                onRate: (stars) => void handleRateSelectedBeer(stars),
                rating: selectedRating,
                savingRating: ratingSaving,
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
              <Text style={styles.headerTitle}>{mode === 'calendar' ? 'The Calendar' : 'Your Beer'}</Text>
            </View>
            <TouchableOpacity
              style={styles.webFallbackButton}
              onPress={() => onOpenWebFallback('/beers')}
              activeOpacity={0.8}
            >
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
            mode === 'calendar' ? (
              <>
                {renderCalendarIntro()}
                <View style={styles.calendarHeader}>
                  <Text style={styles.calendarTitle}>October {year}</Text>
                  <View style={styles.calendarRule} />
                </View>
                {renderList()}
              </>
            ) : (
              renderYourBeer()
            )
          ) : null}
        </ScrollView>
        {renderDetailModal()}
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
  detailButton: {
    alignSelf: 'flex-start',
    borderColor: COLORS.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  detailButtonText: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  actionGrid: {
    gap: 12,
    marginTop: 14,
  },
  placeholderAction: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  placeholderActionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  placeholderActionText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
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
  selectableListItem: {
    borderColor: COLORS.borderStrong,
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
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.74)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.borderStrong,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '86%',
    overflow: 'hidden',
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalDayLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  closeButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  closeButtonText: {
    color: COLORS.muted,
    fontSize: 18,
    fontWeight: '700',
  },
  modalScrollContent: {
    padding: 18,
  },
  detailImage: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 14,
    height: 190,
    marginBottom: 16,
    width: '100%',
  },
  modalBeerTitle: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 31,
    marginBottom: 6,
  },
  modalBreweryTitle: {
    color: COLORS.gold,
    fontSize: 18,
    marginBottom: 4,
  },
  modalMetaText: {
    color: COLORS.muted,
    fontSize: 14,
    marginBottom: 14,
  },
  modalDescriptionText: {
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 16,
    paddingTop: 14,
  },
  ratingCard: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  ratingLoadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  starRow: {
    flexDirection: 'row',
    gap: 8,
  },
  starButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  starButtonActive: {
    backgroundColor: 'rgba(217, 124, 43, 0.16)',
    borderColor: COLORS.gold,
  },
  starText: {
    color: COLORS.muted,
    fontSize: 22,
  },
  starTextActive: {
    color: COLORS.gold,
  },
  ratingHelpText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  ratingErrorText: {
    color: '#ffb4a8',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
});

