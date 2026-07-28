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
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';
import { fetchBeerRatingSummary, fetchBeers, fetchUserBeerRating, upsertUserBeerRating } from './beerService';
import type { Beer, BeerRating, BeerRatingSummary } from './types';

const COLORS = HHS_COLORS;
const BEER_CALENDAR_YEAR = 2026;
const BEER_CALENDAR_MONTH_INDEX = 9;
const BEER_CALENDAR_DAYS = 31;

type NativeBeerScreenProps = {
  mode?: 'calendar' | 'yourBeer';
  onOpenWebFallback: (path?: string) => void;
};

function formatBeerMeta(beer: Beer) {
  const parts = [beer.style, beer.abv ? `${beer.abv}% ABV` : null].filter(Boolean);
  return parts.join(' · ');
}

function getOctoberStart() {
  return new Date(BEER_CALENDAR_YEAR, BEER_CALENDAR_MONTH_INDEX, 1);
}

function getOctoberEnd() {
  return new Date(BEER_CALENDAR_YEAR, BEER_CALENDAR_MONTH_INDEX, BEER_CALENDAR_DAYS, 23, 59, 59, 999);
}

function getCountdownText(now: Date) {
  const diff = Math.max(0, getOctoberStart().getTime() - now.getTime());
  const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
  return `${days} days · ${hours} hrs`;
}

function getCalendarState(now: Date) {
  const isBeforeStart = now.getTime() < getOctoberStart().getTime();
  const isActiveOctober =
    now.getFullYear() === BEER_CALENDAR_YEAR && now.getMonth() === BEER_CALENDAR_MONTH_INDEX;
  const isComplete = now.getTime() > getOctoberEnd().getTime();
  const todayDay = isActiveOctober ? now.getDate() : null;
  const revealedThroughDay = isActiveOctober ? now.getDate() : isComplete ? BEER_CALENDAR_DAYS : null;

  return {
    isBeforeStart,
    isActiveOctober,
    isComplete,
    revealedThroughDay,
    todayDay,
  };
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
  const [todayRatingSummary, setTodayRatingSummary] = useState<BeerRatingSummary>({ average: null, count: 0 });
  const [todayRatingSummaryLoading, setTodayRatingSummaryLoading] = useState(false);

  const now = useMemo(() => new Date(), []);
  const calendarState = useMemo(() => getCalendarState(now), [now]);
  const { isActiveOctober, isBeforeStart, isComplete, revealedThroughDay, todayDay } = calendarState;

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

  useEffect(() => {
    setTodayRatingSummary({ average: null, count: 0 });

    if (mode !== 'yourBeer' || !todayBeer) {
      setTodayRatingSummaryLoading(false);
      return;
    }

    let cancelled = false;
    setTodayRatingSummaryLoading(true);
    fetchBeerRatingSummary(todayBeer.id)
      .then((summary) => {
        if (!cancelled) setTodayRatingSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setTodayRatingSummary({ average: null, count: 0 });
      })
      .finally(() => {
        if (!cancelled) setTodayRatingSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, todayBeer]);

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
      setTodayRatingSummary(await fetchBeerRatingSummary(todayBeer.id));
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

  const renderSocietyRatingPanel = () => (
    <View style={styles.ratingCard}>
      <Text style={styles.factLabel}>Society Rating</Text>
      {todayRatingSummaryLoading ? (
        <View style={styles.ratingLoadingRow}>
          <ActivityIndicator color={COLORS.gold} />
          <Text style={styles.ratingHelpText}>Loading Society rating...</Text>
        </View>
      ) : todayRatingSummary.average !== null ? (
        <View style={styles.societyRatingRow}>
          <Text style={styles.societyStars}>
            {'★'.repeat(Math.round(todayRatingSummary.average))}
            {'☆'.repeat(5 - Math.round(todayRatingSummary.average))}
          </Text>
          <Text style={styles.ratingHelpText}>
            {todayRatingSummary.average} / 5 · {todayRatingSummary.count}{' '}
            {todayRatingSummary.count === 1 ? 'rating' : 'ratings'}
          </Text>
        </View>
      ) : (
        <Text style={styles.ratingHelpText}>No ratings yet. Be the first Society member to weigh in.</Text>
      )}
    </View>
  );

  const renderCalendarIntro = () => {
    if (isBeforeStart) {
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

    if (isComplete) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>October {BEER_CALENDAR_YEAR}</Text>
          <Text style={styles.bodyText}>
            The 2026 ritual is complete. All thirty-one beers are now visible in the archive below.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.heroCard}>
        <Text style={styles.kicker}>October {BEER_CALENDAR_YEAR}</Text>
        <Text style={styles.bodyText}>
          Revealed beers are visible through today. Future pours stay hidden until their day arrives.
        </Text>
      </View>
    );
  };

  const renderYourBeer = () => {
    if (isActiveOctober && !todayBeer) {
      return (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>Today&apos;s beer hasn&apos;t been added yet. Check back soon.</Text>
        </View>
      );
    }

    if (!isActiveOctober || !todayBeer) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>Your Beer Awaits</Text>
          {isBeforeStart ? <Text style={styles.countdown}>{getCountdownText(now)}</Text> : null}
          <Text style={styles.bodyText}>
            {isComplete
              ? 'The 2026 calendar is complete. Use The Calendar to revisit the revealed beers.'
              : 'Today’s beer becomes the center ritual when October 2026 begins. Until then, the circle is gathering and the taps remain under wraps.'}
          </Text>
        </View>
      );
    }

    const meta = formatBeerMeta(todayBeer);
    return (
      <View style={styles.todaySection}>
        <Text style={styles.kicker}>Today&apos;s Beer</Text>
        <Text style={styles.dayLabel}>
          Day {todayBeer.day_number} · October {todayBeer.day_number}, {BEER_CALENDAR_YEAR}
        </Text>
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
        {renderSocietyRatingPanel()}
        {renderRatingPanel({
          errorMessage: todayRatingError,
          loadingRating: todayRatingLoading,
          onRate: (stars) => void handleRateTodayBeer(stars),
          rating: todayRating,
          savingRating: todayRatingSaving,
        })}
        <View style={styles.actionGrid}>
          <View style={styles.placeholderAction}>
            <Text style={styles.placeholderActionTitle}>Post to the Wall</Text>
            <Text style={styles.placeholderActionText}>
              Native wall posting is not wired yet. Use The Wall tab for the current web flow.
            </Text>
          </View>
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
          const isPast = revealedThroughDay ? day < revealedThroughDay : false;
          const shouldReveal = Boolean(beer && revealedThroughDay && day <= revealedThroughDay);

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
              <Text style={styles.modalDayLabel}>
                Day {selectedBeer.day_number} · October {selectedBeer.day_number}, {BEER_CALENDAR_YEAR}
              </Text>
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
            {mode === 'calendar' ? (
              <TouchableOpacity
                style={styles.webFallbackButton}
                onPress={() => onOpenWebFallback('/beers')}
                activeOpacity={0.8}
              >
                <Text style={styles.webFallbackText}>Web</Text>
              </TouchableOpacity>
            ) : null}
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
                  <Text style={styles.calendarTitle}>October {BEER_CALENDAR_YEAR}</Text>
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
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  headerTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '700',
  },
  webFallbackButton: {
    borderColor: COLORS.borderStrong,
    borderRadius: HHS_STYLES.pillRadius,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  webFallbackText: {
    ...HHS_TYPOGRAPHY.button,
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
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    ...HHS_TYPOGRAPHY.button,
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
    ...HHS_TYPOGRAPHY.body,
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
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    marginBottom: 30,
    padding: 22,
  },
  kicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  countdown: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 18,
    textAlign: 'center',
  },
  bodyText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 26,
    textAlign: 'center',
  },
  todaySection: {
    marginBottom: 30,
  },
  dayLabel: {
    ...HHS_TYPOGRAPHY.kicker,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 31,
    fontWeight: '700',
    lineHeight: 36,
    marginBottom: 6,
  },
  breweryTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 18,
    marginBottom: 4,
  },
  metaText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 14,
    marginBottom: 14,
  },
  descriptionText: {
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.button,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  placeholderActionText: {
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  factText: {
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.display,
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
    ...HHS_TYPOGRAPHY.display,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 3,
  },
  listBrewery: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 14,
  },
  unrevealedText: {
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.button,
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
    ...HHS_TYPOGRAPHY.kicker,
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
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 31,
    marginBottom: 6,
  },
  modalBreweryTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 18,
    marginBottom: 4,
  },
  modalMetaText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 14,
    marginBottom: 14,
  },
  modalDescriptionText: {
    ...HHS_TYPOGRAPHY.body,
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
  societyRatingRow: {
    gap: 6,
  },
  societyStars: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 20,
    lineHeight: 24,
  },
  starButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: HHS_STYLES.pillRadius,
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
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 22,
  },
  starTextActive: {
    color: COLORS.gold,
  },
  ratingHelpText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  ratingErrorText: {
    ...HHS_TYPOGRAPHY.body,
    color: '#ffb4a8',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
});

