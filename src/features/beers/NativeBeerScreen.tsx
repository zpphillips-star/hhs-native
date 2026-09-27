import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { HHS_TEST_DATE } from '../../config/env';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';
import {
  createBeerWallPost,
  fetchBeerRatingSummary,
  fetchBeers,
  fetchUserBeerRating,
  upsertUserBeerRating,
} from './beerService';
import type { Beer, BeerRating, BeerRatingSummary } from './types';
import {
  canSeeAllBeers,
  isParticipatingBeerDay,
  useBeerVisibility,
} from '../membership/beerVisibilityService';

const COLORS = HHS_COLORS;

// ─── LAUNCH MODE CONFIG ──────────────────────────────────────────────────────
// Production October 2026 launch. Preview mode has been disabled.
// Month index is 0-based: 9 = October.
// ─────────────────────────────────────────────────────────────────────────────
const BEER_CALENDAR_YEAR = 2026;
const BEER_CALENDAR_MONTH_INDEX = 9; // October
const BEER_CALENDAR_MONTH_NAME = 'October';
const BEER_CALENDAR_DAYS = 31;
const HHS_MUG_IMAGE = require('../../../assets/mughhs.webp');

type NativeBeerScreenProps = {
  mode?: 'calendar' | 'yourBeer';
  onOpenWebFallback?: (path?: string) => void;
  onOpenWallForBeer?: (beer: { id: string; name: string; dayNumber: number; brewery?: string | null }) => void;
};

function formatBeerMeta(beer: Beer) {
  const parts = [beer.style, beer.abv ? `${beer.abv}% ABV` : null].filter(Boolean);
  return parts.join(' · ');
}

function getCalendarStart() {
  return new Date(BEER_CALENDAR_YEAR, BEER_CALENDAR_MONTH_INDEX, 1);
}

function getCalendarEnd() {
  return new Date(BEER_CALENDAR_YEAR, BEER_CALENDAR_MONTH_INDEX, BEER_CALENDAR_DAYS, 23, 59, 59, 999);
}

function getEffectiveNow() {
  if (!HHS_TEST_DATE) return new Date();

  // HHS_TEST_DATE is the exact simulated calendar date baked into the internal
  // validation build. Do not advance it by real elapsed days; Zach expects the
  // native Calendar to open on this fake day whenever the build is tested.
  const testDate = new Date(HHS_TEST_DATE);
  if (Number.isNaN(testDate.getTime())) return new Date();

  return testDate;
}

function getCountdownText(now: Date) {
  const diff = Math.max(0, getCalendarStart().getTime() - now.getTime());
  const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
  return `${days} days · ${hours} hrs`;
}

function getCountdownParts(now: Date) {
  const diff = Math.max(0, getCalendarStart().getTime() - now.getTime());
  return {
    days: Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24))),
    hours: Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))),
    minutes: Math.max(0, Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))),
    seconds: Math.max(0, Math.floor((diff % (1000 * 60)) / 1000)),
  };
}

function padCountdown(value: number) {
  return String(value).padStart(2, '0');
}

function getCalendarState(now: Date) {
  const isBeforeStart = now.getTime() < getCalendarStart().getTime();
  const isActiveMonth =
    now.getFullYear() === BEER_CALENDAR_YEAR && now.getMonth() === BEER_CALENDAR_MONTH_INDEX;
  const isComplete = now.getTime() > getCalendarEnd().getTime();
  // todayDay is ONLY non-null during Oct 1–31, 2026 (the live event window).
  // The `!isBeforeStart` guard is belt-and-suspenders: `isActiveMonth` already
  // requires the correct year+month, but the explicit pre-event null prevents
  // any future regression if month constants drift or a test date falls outside
  // the window. No calendar day should be highlighted as "today" before Oct 1.
  const todayDay = isActiveMonth && !isBeforeStart ? now.getDate() : null;
  const revealedThroughDay = isActiveMonth && !isBeforeStart ? now.getDate() : isComplete ? BEER_CALENDAR_DAYS : null;

  return {
    isBeforeStart,
    isActiveMonth,
    isComplete,
    revealedThroughDay,
    todayDay,
  };
}

export function NativeBeerScreen({ mode = 'calendar' }: NativeBeerScreenProps) {
  const { user } = useAuth();
  const beerVisibility = useBeerVisibility(user?.id);
  const [beers, setBeers] = useState<Beer[]>([]);

  // ─── Auto-scroll-to-today (calendar mode only) ───────────────────────────
  const scrollViewRef = useRef<ScrollView>(null);
  const [listY, setListY] = useState(0);
  const [todayRowY, setTodayRowY] = useState<number | null>(null);
  // Guard: only scroll once per mount; re-mounts when tab is re-selected.
  const hasScrolledToToday = useRef(false);
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
  // Notes / review state — kept for rating load compat; UI text boxes removed (v1.0.58+)
  // Wall post state for Calendar detail modal

  const [selectedRatingSummary, setSelectedRatingSummary] = useState<BeerRatingSummary>({ average: null, count: 0 });
  const [selectedRatingSummaryLoading, setSelectedRatingSummaryLoading] = useState(false);
  const [selectedWallError, setSelectedWallError] = useState<string | null>(null);
  const [selectedWallPostText, setSelectedWallPostText] = useState('');
  const [selectedWallPosting, setSelectedWallPosting] = useState(false);
  const [selectedWallPosted, setSelectedWallPosted] = useState(false);
  // Today wall post / activity state (Your Beer tab)
  const [todayWallError, setTodayWallError] = useState<string | null>(null);
  const [todayWallPostText, setTodayWallPostText] = useState('');
  const [todayWallPosting, setTodayWallPosting] = useState(false);
  const [todayWallPosted, setTodayWallPosted] = useState(false);
  const [todayPeekEnabled, setTodayPeekEnabled] = useState(false);

  const [now, setNow] = useState(() => getEffectiveNow());
  const calendarState = useMemo(() => getCalendarState(now), [now]);
  const { isActiveMonth, isBeforeStart, isComplete, revealedThroughDay, todayDay } = calendarState;

  const beerMap = useMemo(() => {
    const map = new Map<number, Beer>();
    beers.forEach((beer) => map.set(beer.day_number, beer));
    return map;
  }, [beers]);

  const todayBeer = todayDay ? beerMap.get(todayDay) ?? null : null;
  const canShowAllForOddballs = canSeeAllBeers(beerVisibility);
  const todayParticipates = isParticipatingBeerDay(beerVisibility.tier, todayBeer?.day_number);
  const todayIsOddballsFullSocietyBeer = Boolean(todayBeer && beerVisibility.tier === 'oddballs' && !todayParticipates);
  const todayPeekMode = Boolean(todayIsOddballsFullSocietyBeer && (todayPeekEnabled || canShowAllForOddballs));
  const selectedParticipates = isParticipatingBeerDay(beerVisibility.tier, selectedBeer?.day_number);
  const selectedIsFullSocietyPeek = Boolean(selectedBeer && beerVisibility.tier === 'oddballs' && !selectedParticipates);

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
    if (HHS_TEST_DATE) return undefined;
    const interval = setInterval(() => setNow(getEffectiveNow()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    void loadSelectedRating(selectedParticipates ? selectedBeer : null, user?.id);
  }, [loadSelectedRating, selectedBeer, selectedParticipates, user?.id]);

  useEffect(() => {
    setTodayPeekEnabled(false);
  }, [todayBeer?.id, beerVisibility.effectivePreference, beerVisibility.tier]);

  useEffect(() => {
    setTodayRating(null);
    setTodayRatingError(null);

    if (mode !== 'yourBeer' || !todayBeer || !user?.id || !todayParticipates) {
      setTodayRatingLoading(false);
      return;
    }

    let cancelled = false;
    setTodayRatingLoading(true);
    fetchUserBeerRating(user.id, todayBeer.id)
      .then((rating) => {
        if (!cancelled) {
          setTodayRating(rating);
        }
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
  }, [mode, todayBeer, todayParticipates, user?.id]);

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

  // Load society rating summary whenever the detail modal opens for a past/today beer
  useEffect(() => {
    setSelectedRatingSummary({ average: null, count: 0 });

    if (!selectedBeer) {
      setSelectedRatingSummaryLoading(false);
      return;
    }

    let cancelled = false;
    setSelectedRatingSummaryLoading(true);
    fetchBeerRatingSummary(selectedBeer.id)
      .then((summary) => {
        if (!cancelled) setSelectedRatingSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setSelectedRatingSummary({ average: null, count: 0 });
      })
      .finally(() => {
        if (!cancelled) setSelectedRatingSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBeer]);

  useEffect(() => {
    setSelectedWallError(null);
    setSelectedWallPosted(false);
    setSelectedWallPostText('');
  }, [selectedBeer]);

  // Today wall post composer state (Your Beer tab) — activity list removed in v1.0.58+
  useEffect(() => {
    setTodayWallPosted(false);
    setTodayWallPostText('');
  }, [todayBeer]);

  // ─── Auto-scroll to today when calendar loads ────────────────────────────
  // Fires once per mount when: mode=calendar, loading complete, todayDay
  // exists, and both layout positions have been measured.
  useEffect(() => {
    if (mode !== 'calendar') return;
    if (loading) return;
    if (!todayDay) return;
    if (todayRowY === null) return;
    if (hasScrolledToToday.current) return;

    hasScrolledToToday.current = true;
    // Place today's row ~60 px from the top so there's visible context above.
    const targetY = Math.max(0, listY + todayRowY - 60);
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [mode, loading, todayDay, listY, todayRowY]);

  const openBeerDetail = (beer: Beer) => {
    setSelectedBeer(beer);
  };

  const closeBeerDetail = () => {
    setSelectedBeer(null);
    setSelectedRating(null);
    setRatingError(null);
    setRatingSaving(false);
    setSelectedRatingSummary({ average: null, count: 0 });
    setSelectedRatingSummaryLoading(false);
    setSelectedWallError(null);
    setSelectedWallPostText('');
    setSelectedWallPosting(false);
    setSelectedWallPosted(false);
  };

  const handleRateSelectedBeer = async (stars: number) => {
    if (!user || !selectedBeer || ratingSaving || !selectedParticipates) return;

    setRatingSaving(true);
    setRatingError(null);
    try {
      const rating = await upsertUserBeerRating(user.id, selectedBeer.id, stars);
      setSelectedRating(rating);
      // Refresh society aggregate so it reflects the new rating immediately.
      try {
        setSelectedRatingSummary(await fetchBeerRatingSummary(selectedBeer.id));
      } catch {
        // Non-fatal: summary stays as-is if the refresh fails.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your rating.';
      setRatingError(message);
    } finally {
      setRatingSaving(false);
    }
  };

  const handleRateTodayBeer = async (stars: number) => {
    if (!user || !todayBeer || todayRatingSaving || !todayParticipates) return;

    setTodayRatingSaving(true);
    setTodayRatingError(null);
    try {
      const rating = await upsertUserBeerRating(user.id, todayBeer.id, stars);
      setTodayRating(rating);
      // Refresh society aggregate — non-fatal if it fails.
      try {
        setTodayRatingSummary(await fetchBeerRatingSummary(todayBeer.id));
      } catch {
        // Non-fatal: summary stays as-is if the refresh fails.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your rating.';
      setTodayRatingError(message);
    } finally {
      setTodayRatingSaving(false);
    }
  };

  const handleSelectedWallPost = async () => {
    if (!user || !selectedBeer || selectedWallPosting || !selectedParticipates) return;
    const trimmed = selectedWallPostText.trim();
    if (!trimmed) {
      setSelectedWallError('Write a Wall post before publishing.');
      return;
    }

    setSelectedWallPosting(true);
    setSelectedWallError(null);
    setSelectedWallPosted(false);
    try {
      await createBeerWallPost(user.id, selectedBeer.id, trimmed);
      setSelectedWallPostText('');
      setSelectedWallPosted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not post to the Wall.';
      setSelectedWallError(message);
    } finally {
      setSelectedWallPosting(false);
    }
  };

  const handleTodayWallPost = async () => {
    if (!user || !todayBeer || todayWallPosting || !todayParticipates) return;
    const trimmed = todayWallPostText.trim();
    if (!trimmed) {
      setTodayWallError('Write a Wall post before publishing.');
      return;
    }

    setTodayWallPosting(true);
    setTodayWallError(null);
    setTodayWallPosted(false);
    try {
      await createBeerWallPost(user.id, todayBeer.id, trimmed);
      setTodayWallPostText('');
      setTodayWallPosted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not post to the Wall.';
      setTodayWallError(message);
    } finally {
      setTodayWallPosting(false);
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
  }) => {
    const busy = savingRating;

    return (
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
            <>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = star <= (rating?.stars ?? 0);
                  return (
                    <TouchableOpacity
                      key={star}
                      style={[styles.starButton, active && styles.starButtonActive]}
                      onPress={() => onRate(star)}
                      activeOpacity={0.8}
                      disabled={busy}
                    >
                      <Text style={[styles.starText, active && styles.starTextActive]}>★</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!rating ? (
                <Text style={styles.ratingHelpText}>Tap a star to rate this beer.</Text>
              ) : null}
            </>
          )}
          {savingRating ? <Text style={styles.ratingHelpText}>Saving rating...</Text> : null}
          {errorMessage ? <Text style={styles.ratingErrorText}>{errorMessage}</Text> : null}
        </>
      ) : (
        <Text style={styles.ratingHelpText}>Sign in from The Settings tab or web view to rate this beer.</Text>
      )}
    </View>
    );
  };

  const renderSocietyPanel = ({
    average,
    count,
    loading,
  }: {
    average: number | null;
    count: number;
    loading: boolean;
  }) => (
    <View style={styles.ratingCard}>
      <Text style={styles.factLabel}>Society Rating</Text>
      {loading ? (
        <View style={styles.ratingLoadingRow}>
          <ActivityIndicator color={COLORS.gold} />
          <Text style={styles.ratingHelpText}>Loading Society rating...</Text>
        </View>
      ) : average !== null ? (
        <View style={styles.societyRatingRow}>
          <Text style={styles.societyStars}>
            {'★'.repeat(Math.round(average))}
            {'☆'.repeat(5 - Math.round(average))}
          </Text>
          <Text style={styles.ratingHelpText}>
            {average} / 5 · {count} {count === 1 ? 'rating' : 'ratings'}
          </Text>
        </View>
      ) : (
        <Text style={styles.ratingHelpText}>No ratings yet. Be the first Society member to weigh in.</Text>
      )}
    </View>
  );

  const renderSocietyRatingPanel = () =>
    renderSocietyPanel({
      average: todayRatingSummary.average,
      count: todayRatingSummary.count,
      loading: todayRatingSummaryLoading,
    });

  const renderReadOnlyParticipationCard = (context: 'rating' | 'wall') => (
    <View style={styles.ratingCard}>
      <Text style={styles.factLabel}>{context === 'rating' ? 'Rating Disabled' : 'Wall Posting Disabled'}</Text>
      <Text style={styles.ratingHelpText}>
        This is a Full Society even-day beer. Oddballs can peek, but it does not count as a participating beer,
        so beer-specific {context === 'rating' ? 'ratings' : 'Wall posts'} are disabled.
      </Text>
    </View>
  );

  const renderOddballsInfoBanner = (variant: 'participating' | 'peek') => (
    <View style={variant === 'peek' ? styles.fullSocietyBanner : styles.oddballsBanner}>
      <Text style={styles.bannerTitle}>
        {variant === 'peek' ? 'Full Society beer · peek mode' : 'Oddballs participating beer'}
      </Text>
      <Text style={styles.bannerText}>
        {variant === 'peek'
          ? 'You can read what Hallowed members are drinking today. Rating and beer-specific Wall posting stay off for this even-day beer.'
          : 'This odd-numbered beer is part of your Oddballs lineup — rating and beer-specific Wall posting are available.'}
      </Text>
    </View>
  );

  const renderSelectedWallPanel = (beer: Beer) => {
    const canPublish = Boolean(user && selectedWallPostText.trim() && !selectedWallPosting);

    return (
      <View style={styles.wallHubCard}>
        <Text style={styles.factLabel}>Post to the Wall</Text>
        <Text style={styles.wallHelpText}>
          Share a beer-tagged post for Day {beer.day_number}. Photo posting remains available from the filtered Wall composer.
        </Text>

        {user ? (
          <>
            <TextInput
              style={styles.wallPostInput}
              placeholder="Share your thoughts on this beer..."
              placeholderTextColor={COLORS.muted}
              multiline
              numberOfLines={3}
              value={selectedWallPostText}
              onChangeText={setSelectedWallPostText}
              editable={!selectedWallPosting}
              textAlignVertical="top"
            />
            <View style={styles.wallActionRow}>
              <TouchableOpacity
                style={[styles.wallPrimaryButton, !canPublish && styles.wallButtonDisabled]}
                onPress={() => void handleSelectedWallPost()}
                disabled={!canPublish}
                activeOpacity={0.82}
              >
                {selectedWallPosting ? (
                  <ActivityIndicator color={COLORS.background} size="small" />
                ) : (
                  <Text style={styles.wallPrimaryButtonText}>Post</Text>
                )}
              </TouchableOpacity>
            </View>
            {selectedWallPosted ? <Text style={styles.wallSuccessText}>Posted to the Wall for this beer.</Text> : null}
          </>
        ) : (
          <Text style={styles.ratingHelpText}>Sign in from The Settings tab or web view to post about this beer.</Text>
        )}

        {selectedWallError ? <Text style={styles.ratingErrorText}>{selectedWallError}</Text> : null}
      </View>
    );
  };

  // Renders the inline post-to-Wall composer for today's beer (Your Beer tab)
  const renderTodayWallPanel = (beer: Beer) => {
    const canPublish = Boolean(user && todayWallPostText.trim() && !todayWallPosting);

    return (
      <View style={styles.wallHubCard}>
        <Text style={styles.factLabel}>Post to the Wall</Text>
        <Text style={styles.wallHelpText}>
          Share a beer-tagged post for Day {beer.day_number}. Photo posting remains available from the filtered Wall composer.
        </Text>

        {user ? (
          <>
            <TextInput
              style={styles.wallPostInput}
              placeholder="Share your thoughts on this beer..."
              placeholderTextColor={COLORS.muted}
              multiline
              numberOfLines={3}
              value={todayWallPostText}
              onChangeText={setTodayWallPostText}
              editable={!todayWallPosting}
              textAlignVertical="top"
            />
            <View style={styles.wallActionRow}>
              <TouchableOpacity
                style={[styles.wallPrimaryButton, !canPublish && styles.wallButtonDisabled]}
                onPress={() => void handleTodayWallPost()}
                disabled={!canPublish}
                activeOpacity={0.82}
              >
                {todayWallPosting ? (
                  <ActivityIndicator color={COLORS.background} size="small" />
                ) : (
                  <Text style={styles.wallPrimaryButtonText}>Post</Text>
                )}
              </TouchableOpacity>
            </View>
            {todayWallPosted ? <Text style={styles.wallSuccessText}>Posted to the Wall for this beer.</Text> : null}
          </>
        ) : (
          <Text style={styles.ratingHelpText}>Sign in from The Settings tab or web view to post about this beer.</Text>
        )}

        {todayWallError ? <Text style={styles.ratingErrorText}>{todayWallError}</Text> : null}
      </View>
    );
  };

  const renderHomeAbout = () => (
    <View style={styles.homeAboutBlock}>
      <Text style={styles.homeAboutText}>
        As October&apos;s chill creeps in and shadows grow long, a devoted fellowship rises to honor the sacred tradition of the hop.
      </Text>
      <Text style={styles.homeAboutText}>
        <Text style={styles.homeAboutStrong}>The Hallowed Hop Society</Text> is an annual gathering of beer enthusiasts who embark on a solemn (and slightly ridiculous) ritual:{' '}
        <Text style={styles.homeAboutEmphasis}>31 unique beers in 31 haunted days.</Text> No repeats. No excuses. Just pure, unfiltered reverence for the craft of brewing.
      </Text>
      <Text style={styles.homeAboutText}>
        Each year brings a new theme, a new lineup of brews, and new initiates brave enough to take the oath. From spiced pumpkin ales to bone-chilling stouts, we drink not just for the flavor—but for the fellowship.
      </Text>
      <View style={styles.homeQuote}>
        <Text style={styles.homeQuoteText}>Through ritual we pour, through hops we unite.</Text>
      </View>
      <Text style={styles.homeAboutText}>We are a society of the sip, the story, and the sacred pour.</Text>
      <Text style={styles.homeAboutText}>
        If you&apos;ve got a taste for adventure (and good beer), your place at the circle awaits.
      </Text>
    </View>
  );

  const renderHomeHeroIntro = () => (
    <View style={styles.homeHero}>
      <Text style={styles.homeHeroTitle}>HALLOWED{'\n'}HOP SOCIETY</Text>
      <Image source={HHS_MUG_IMAGE} style={styles.homeHeroImage} resizeMode="contain" />
      {renderHomeAbout()}
    </View>
  );

  const renderHomeCountdown = () => {
    const countdown = getCountdownParts(now);
    const parts = [
      { value: countdown.days, label: 'Days' },
      { value: countdown.hours, label: 'Hours' },
      { value: countdown.minutes, label: 'Minutes' },
      { value: countdown.seconds, label: 'Seconds' },
    ];

    return (
      <View style={styles.homeCountdownSection}>
        <Text style={styles.homeCountdownKicker}>The ritual begins in</Text>
        <View style={styles.homeCountdownGrid}>
          {parts.map((part) => (
            <View key={part.label} style={styles.homeCountdownItem}>
              <Text style={styles.homeCountdownNumber}>{padCountdown(part.value)}</Text>
              <Text style={styles.homeCountdownUnit}>{part.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderCalendarIntro = () => {
    if (isBeforeStart) {
      const countdown = getCountdownParts(now);
      return (
        <View style={styles.preOctoberSection}>
          <View style={styles.ritualDivider}>
            <View style={styles.ritualLine} />
            <Text style={styles.kicker}>The Calendar Is Being Set</Text>
            <View style={styles.ritualLine} />
          </View>
          <Text style={styles.countdownLabel}>{BEER_CALENDAR_MONTH_NAME} 1st begins in</Text>
          <View style={styles.countdownRow}>
            <Text style={styles.countdownNumber}>{countdown.days}</Text>
            <Text style={styles.countdownUnit}>days</Text>
            <Text style={styles.countdownDot}>·</Text>
            <Text style={styles.countdownNumber}>{countdown.hours}</Text>
            <Text style={styles.countdownUnit}>hrs</Text>
          </View>
          <View style={styles.manifestoCard}>
            <Text style={styles.manifestoText}>
              Every {BEER_CALENDAR_MONTH_NAME}, the Society convenes. Thirty-one days. Thirty-one beers. The deliberation is
              underway — each selection debated, contested, and earned. The calendar isn’t set yet. But it
              will be.
            </Text>
          </View>
          <Text style={styles.bodyText}>
            The 31 slots below are reserved. The beers have yet to be named.
          </Text>
        </View>
      );
    }

    if (isComplete) {
      return (
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>{BEER_CALENDAR_MONTH_NAME} {BEER_CALENDAR_YEAR}</Text>
          <Text style={styles.bodyText}>
            The 2026 ritual is complete. All thirty-one beers are now visible in the archive below.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.heroCard}>
        <Text style={styles.kicker}>{BEER_CALENDAR_MONTH_NAME} {BEER_CALENDAR_YEAR}</Text>
        <Text style={styles.bodyText}>
          Revealed beers are visible through today. Future pours stay hidden until their day arrives.
        </Text>
      </View>
    );
  };

  const renderYourBeer = () => {
    if (isActiveMonth && !todayBeer) {
      return (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>Today&apos;s beer hasn&apos;t been added yet. Check back soon.</Text>
        </View>
      );
    }

    if (!isActiveMonth || !todayBeer) {
      if (isBeforeStart) {
        return (
          <View>
            {renderHomeHeroIntro()}
            {renderHomeCountdown()}
          </View>
        );
      }
      return (
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>Hallowed Hop Society</Text>
          <Text style={styles.bodyText}>
            {isComplete
              ? 'The 2026 ritual is complete. All thirty-one beers are now visible in The Calendar.'
              : 'Your daily beer will appear here when October 2026 begins.'}
          </Text>
        </View>
      );
    }

    if (todayIsOddballsFullSocietyBeer && !todayPeekMode) {
      return (
        <View style={styles.todaySection}>
          <View style={styles.messageCard}>
            <Text style={styles.kicker}>Oddballs Day</Text>
            <Text style={styles.cardHeadline}>No designated Oddballs beer today</Text>
            <Text style={styles.messageText}>
              Day {todayBeer.day_number} is an even-numbered Full Society beer. Oddballs drink the odd days, so
              rating and beer-specific Wall posting are paused today.
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setTodayPeekEnabled(true)}
              style={styles.peekButton}
            >
              <Text style={styles.peekButtonText}>See what Hallowed members are drinking</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const meta = formatBeerMeta(todayBeer);
    return (
      <View style={styles.todaySection}>
        <Text style={styles.kicker}>Today&apos;s Beer</Text>
        <Text style={styles.dayLabel}>
          Day {todayBeer.day_number} · {BEER_CALENDAR_MONTH_NAME} {todayBeer.day_number}, {BEER_CALENDAR_YEAR}
        </Text>
        {todayBeer.image_url ? (
          <Image source={{ uri: todayBeer.image_url }} style={styles.heroImage} resizeMode="cover" />
        ) : null}
        <Text style={styles.beerTitle}>{todayBeer.name}</Text>
        <Text style={styles.breweryTitle}>{todayBeer.brewery}</Text>
        {meta ? <Text style={styles.metaText}>{meta}</Text> : null}
        {todayIsOddballsFullSocietyBeer
          ? renderOddballsInfoBanner('peek')
          : beerVisibility.tier === 'oddballs'
            ? renderOddballsInfoBanner('participating')
            : null}
        {todayBeer.description ? (
          <Text style={styles.descriptionText}>{todayBeer.description}</Text>
        ) : (
          <Text style={styles.missingDataText}>No description field has been added for this beer yet.</Text>
        )}
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
        ) : (
          <View style={styles.factCard}>
            <Text style={styles.factLabel}>Beer write-up</Text>
            <Text style={styles.factText}>
              No beer_fact or brewery_fact field has been added for this beer yet.
            </Text>
          </View>
        )}
        {renderSocietyRatingPanel()}
        {todayParticipates
          ? renderRatingPanel({
              errorMessage: todayRatingError,
              loadingRating: todayRatingLoading,
              onRate: (stars) => void handleRateTodayBeer(stars),
              rating: todayRating,
              savingRating: todayRatingSaving,
            })
          : renderReadOnlyParticipationCard('rating')}
        {todayParticipates ? renderTodayWallPanel(todayBeer) : renderReadOnlyParticipationCard('wall')}
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
      <View style={styles.list} onLayout={(e) => setListY(e.nativeEvent.layout.y)}>
        {days.map((day) => {
          const beer = beerMap.get(day);
          // todayDay is null outside Oct 1–31 → no row is highlighted pre-event.
          const isToday = day === todayDay;
          const isPast = revealedThroughDay ? day < revealedThroughDay : false;
          const shouldReveal = Boolean(beer && revealedThroughDay && day <= revealedThroughDay);
          const participates = isParticipatingBeerDay(beerVisibility.tier, day);
          const visibleInSelectedCalendar = beerVisibility.effectivePreference === 'all' || day % 2 === 1;
          const isOddballsLockedEvenDay =
            Boolean(beer && shouldReveal && beerVisibility.tier === 'oddballs' && !participates && !canShowAllForOddballs);
          const isOddballsFullSocietyVisible =
            Boolean(beer && shouldReveal && beerVisibility.tier === 'oddballs' && !participates && canShowAllForOddballs);
          const isHiddenByOddballsCalendarView =
            Boolean(beer && shouldReveal && !visibleInSelectedCalendar && beerVisibility.tier !== 'oddballs');
          const shouldShowBeerIdentity = shouldReveal && !isOddballsLockedEvenDay && !isHiddenByOddballsCalendarView;
          // Today's beer is also tappable — opens the same detail/rating modal as past days
          const canOpenDetail = Boolean(beer && revealedThroughDay && day <= revealedThroughDay);
          const isLast = day === 31;

          return (
            <TouchableOpacity
              key={day}
              style={[
                styles.listItem,
                !isLast && styles.listItemSeparator,
                isToday && styles.todayListItem,
                isPast && !isToday && styles.pastListItem,
                (isOddballsLockedEvenDay || isOddballsFullSocietyVisible || isHiddenByOddballsCalendarView) && styles.lockedListItem,
              ]}
              onPress={() => {
                if (canOpenDetail && beer) openBeerDetail(beer);
              }}
              activeOpacity={canOpenDetail ? 0.82 : 1}
              disabled={!canOpenDetail}
              onLayout={isToday ? (e) => setTodayRowY(e.nativeEvent.layout.y) : undefined}
            >
              <Text style={[styles.dayNumber, isToday && styles.todayText]}>{day}</Text>
              <View style={styles.listText}>
                {shouldShowBeerIdentity && beer ? (
                  <>
                    <Text style={styles.listBeerName} numberOfLines={1}>{beer.name}</Text>
                    <Text style={styles.listBrewery} numberOfLines={1}>
                      {beer.brewery}
                      {isOddballsFullSocietyVisible ? ' · Full Society / not participating' : ''}
                    </Text>
                  </>
                ) : isOddballsLockedEvenDay ? (
                  <>
                    <Text style={styles.unrevealedText}>Full Society beer · tap to peek</Text>
                    <Text style={styles.listBrewery} numberOfLines={1}>Even-day beer hidden for Oddballs</Text>
                  </>
                ) : (
                  <Text style={styles.unrevealedText}>To be revealed...</Text>
                )}
              </View>
              {isToday ? (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>TODAY</Text>
                </View>
              ) : canOpenDetail ? (
                <Text style={styles.listChevron}>›</Text>
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
    const isSelectedToday = selectedBeer.day_number === todayDay;
    // Past day = revealed but not today. Only today's beer gets the inline Wall composer.
    const isPastDay = !isSelectedToday;

    return (
      <Modal visible transparent animationType="fade" onRequestClose={closeBeerDetail} statusBarTranslucent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalDayLabel}>
                {isSelectedToday ? 'Today · ' : ''}Day {selectedBeer.day_number} · {BEER_CALENDAR_MONTH_NAME} {selectedBeer.day_number}, {BEER_CALENDAR_YEAR}
              </Text>
              <TouchableOpacity style={styles.closeButton} onPress={closeBeerDetail} accessibilityLabel="Close beer detail">
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalKAV}
            >
              <ScrollView contentContainerStyle={styles.modalScrollContent}>
              {selectedBeer.image_url ? (
                <Image source={{ uri: selectedBeer.image_url }} style={styles.detailImage} resizeMode="cover" />
              ) : null}
              <Text style={styles.modalBeerTitle}>{selectedBeer.name}</Text>
              <Text style={styles.modalBreweryTitle}>{selectedBeer.brewery}</Text>
              {meta ? <Text style={styles.modalMetaText}>{meta}</Text> : null}
              {selectedIsFullSocietyPeek ? renderOddballsInfoBanner('peek') : null}
              {selectedBeer.description ? (
                <Text style={styles.modalDescriptionText}>{selectedBeer.description}</Text>
              ) : (
                <Text style={styles.missingDataText}>
                  No description field has been added for this beer yet.
                </Text>
              )}

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
              ) : (
                <View style={styles.factCard}>
                  <Text style={styles.factLabel}>Beer write-up</Text>
                  <Text style={styles.factText}>
                    No beer_fact or brewery_fact field has been added for this beer yet.
                  </Text>
                </View>
              )}

              {/* Society rating — shown first so user sees group consensus before rating */}
              {renderSocietyPanel({
                average: selectedRatingSummary.average,
                count: selectedRatingSummary.count,
                loading: selectedRatingSummaryLoading,
              })}

              {selectedParticipates
                ? renderRatingPanel({
                    errorMessage: ratingError,
                    loadingRating: ratingLoading,
                    onRate: (stars) => void handleRateSelectedBeer(stars),
                    rating: selectedRating,
                    savingRating: ratingSaving,
                  })
                : renderReadOnlyParticipationCard('rating')}
              {!isPastDay
                ? selectedParticipates
                  ? renderSelectedWallPanel(selectedBeer)
                  : renderReadOnlyParticipationCard('wall')
                : null}
            </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="light" backgroundColor={COLORS.background} />
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.scrollContent, mode === 'calendar' && styles.calendarScrollContent]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadBeers(true)}
              tintColor={COLORS.gold}
              colors={[COLORS.gold]}
            />
          }
        >
          {loading ?(
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
                  <Text style={styles.calendarTitle}>{BEER_CALENDAR_MONTH_NAME} {BEER_CALENDAR_YEAR}</Text>
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
  calendarScrollContent: {
    paddingTop: 8,
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
  homeHero: {
    paddingBottom: 18,
    paddingTop: 18,
  },
  homeHeroTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 1.2,
    lineHeight: 48,
    marginBottom: 14,
  },
  homeHeroImage: {
    alignSelf: 'flex-end',
    height: 170,
    marginBottom: 8,
    marginLeft: 18,
    opacity: 0.9,
    width: '50%',
  },
  homeAboutBlock: {
    gap: 12,
  },
  homeAboutText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 17,
    lineHeight: 30,
  },
  homeAboutStrong: {
    color: COLORS.text,
    fontWeight: '700',
  },
  homeAboutEmphasis: {
    color: COLORS.text,
    fontStyle: 'italic',
  },
  homeQuote: {
    borderLeftColor: COLORS.gold,
    borderLeftWidth: 3,
    marginVertical: 8,
    paddingLeft: 18,
  },
  homeQuoteText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 28,
  },
  homeCountdownSection: {
    alignItems: 'center',
    paddingBottom: 22,
    paddingTop: 34,
  },
  homeCountdownKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.muted,
    fontSize: 12,
    letterSpacing: 3,
    marginBottom: 20,
    textAlign: 'center',
  },
  homeCountdownGrid: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
  },
  homeCountdownItem: {
    alignItems: 'center',
    minWidth: 64,
  },
  homeCountdownNumber: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
  },
  homeCountdownUnit: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.muted,
    fontSize: 10,
    letterSpacing: 1.4,
    marginTop: 6,
  },
  preOctoberSection: {
    alignItems: 'center',
    marginBottom: 30,
    paddingBottom: 8,
    paddingTop: 30,
  },
  ritualDivider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
    width: '100%',
  },
  ritualLine: {
    backgroundColor: COLORS.borderStrong,
    flex: 1,
    height: 1,
    opacity: 0.78,
  },
  countdownLabel: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  countdownRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 28,
  },
  countdownNumber: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 48,
    lineHeight: 54,
  },
  countdownUnit: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 18,
    lineHeight: 35,
    marginLeft: 7,
  },
  countdownDot: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.borderStrong,
    fontSize: 30,
    lineHeight: 44,
    marginHorizontal: 16,
  },
  manifestoCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 22,
    paddingHorizontal: 22,
    paddingVertical: 20,
    width: '100%',
  },
  manifestoText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 16,
    fontStyle: 'italic',
    lineHeight: 29,
    textAlign: 'center',
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
  cardHeadline: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  peekButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  peekButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.background,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    textTransform: 'uppercase',
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
    letterSpacing: 3,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  countdown: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 32,
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
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 16,
    paddingTop: 14,
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
  oddballsBanner: {
    backgroundColor: 'rgba(217, 124, 43, 0.10)',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 13,
  },
  fullSocietyBanner: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 13,
  },
  bannerTitle: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  bannerText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
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
    // Flat row list — no card background, border, or radius.
    // Dividers come from listItemSeparator on each row.
  },
  listItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 0,
    paddingVertical: 14,
  },
  listItemSeparator: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  todayListItem: {
    backgroundColor: COLORS.goldDim,
  },
  pastListItem: {
    opacity: 0.78,
  },
  lockedListItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
    opacity: 0.7,
  },
  dayNumber: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.muted,
    fontSize: 22,
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
    height: '86%',
    maxHeight: '86%',
    overflow: 'hidden',
    width: '100%',
  },
  modalKAV: {
    flex: 1,
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
  hubKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 10,
    letterSpacing: 2.5,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
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
  missingDataText: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: 14,
    padding: 12,
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
    gap: 4,
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
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  starButtonActive: {
    // active state conveyed by starTextActive color — no background or border
  },
  starText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 40,
    lineHeight: 44,
    textAlign: 'center',
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
  notesSavedText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 10,
  },
  notesInput: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  saveNotesButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  saveNotesButtonDisabled: {
    opacity: 0.48,
  },
  saveNotesText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.background,
    fontSize: 13,
    fontWeight: '700',
  },
  dailyActionCard: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  dailyActionTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  dailyActionText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  wallHubCard: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  wallHelpText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  wallPostInput: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    minHeight: 82,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  wallActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  wallPrimaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 88,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  wallPrimaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.background,
    fontSize: 13,
    fontWeight: '700',
  },
  wallSecondaryButton: {
    borderColor: COLORS.border,
    borderRadius: HHS_STYLES.buttonRadius,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  wallSecondaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  wallButtonDisabled: {
    opacity: 0.48,
  },
  wallSuccessText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  relatedWallHeader: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 14,
  },
  wallLinkText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 13,
  },
  relatedWallList: {
    gap: 10,
  },
  relatedWallPost: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  relatedWallMeta: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 12,
    lineHeight: 17,
  },
  relatedWallContent: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  relatedWallCounts: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  listChevron: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.borderStrong,
    fontSize: 22,
    paddingLeft: 4,
  },
});

