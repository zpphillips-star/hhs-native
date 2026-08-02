import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  fetchBeerWallActivity,
  fetchUserBeerRating,
  upsertUserBeerRating,
} from './beerService';
import type { Beer, BeerRating, BeerRatingSummary, BeerWallActivity } from './types';

const COLORS = HHS_COLORS;
const BEER_CALENDAR_YEAR = 2026;
const BEER_CALENDAR_MONTH_INDEX = 9;
const BEER_CALENDAR_DAYS = 31;

type NativeBeerScreenProps = {
  mode?: 'calendar' | 'yourBeer';
  onOpenWebFallback?: (path?: string) => void;
  onOpenWallForBeer?: (beer: { id: string; name: string; dayNumber: number; brewery?: string | null }) => void;
};

function formatBeerMeta(beer: Beer) {
  const parts = [beer.style, beer.abv ? `${beer.abv}% ABV` : null].filter(Boolean);
  return parts.join(' · ');
}

function formatWallTimestamp(value: string) {
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function getOctoberStart() {
  return new Date(BEER_CALENDAR_YEAR, BEER_CALENDAR_MONTH_INDEX, 1);
}

function getOctoberEnd() {
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
  const diff = Math.max(0, getOctoberStart().getTime() - now.getTime());
  const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
  return `${days} days · ${hours} hrs`;
}

function getCountdownParts(now: Date) {
  const diff = Math.max(0, getOctoberStart().getTime() - now.getTime());
  return {
    days: Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24))),
    hours: Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))),
  };
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

export function NativeBeerScreen({ mode = 'calendar', onOpenWallForBeer }: NativeBeerScreenProps) {
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
  // Notes / review state
  const [selectedNotesText, setSelectedNotesText] = useState('');
  const [selectedNotesSaving, setSelectedNotesSaving] = useState(false);
  const [todayNotesText, setTodayNotesText] = useState('');
  const [todayNotesSaving, setTodayNotesSaving] = useState(false);
  // Society rating summary for the detail modal
  const [selectedRatingSummary, setSelectedRatingSummary] = useState<BeerRatingSummary>({ average: null, count: 0 });
  const [selectedRatingSummaryLoading, setSelectedRatingSummaryLoading] = useState(false);
  const [selectedWallActivity, setSelectedWallActivity] = useState<BeerWallActivity[]>([]);
  const [selectedWallLoading, setSelectedWallLoading] = useState(false);
  const [selectedWallError, setSelectedWallError] = useState<string | null>(null);
  const [selectedWallPostText, setSelectedWallPostText] = useState('');
  const [selectedWallPosting, setSelectedWallPosting] = useState(false);
  const [selectedWallPosted, setSelectedWallPosted] = useState(false);

  const now = useMemo(() => getEffectiveNow(), []);
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
      // Pre-fill notes text so existing saved notes are visible immediately in the detail modal.
      setSelectedNotesText(rating?.notes ?? '');
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
    setTodayNotesText('');

    if (mode !== 'yourBeer' || !todayBeer || !user?.id) {
      setTodayRatingLoading(false);
      return;
    }

    let cancelled = false;
    setTodayRatingLoading(true);
    fetchUserBeerRating(user.id, todayBeer.id)
      .then((rating) => {
        if (!cancelled) {
          setTodayRating(rating);
          setTodayNotesText(rating?.notes ?? '');
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
    setSelectedWallActivity([]);
    setSelectedWallError(null);
    setSelectedWallPosted(false);
    setSelectedWallPostText(selectedBeer ? `Day ${selectedBeer.day_number} — ${selectedBeer.name}: ` : '');

    if (!selectedBeer) {
      setSelectedWallLoading(false);
      return;
    }

    let cancelled = false;
    setSelectedWallLoading(true);
    fetchBeerWallActivity(selectedBeer.id, 3)
      .then((activity) => {
        if (!cancelled) setSelectedWallActivity(activity);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Could not load related Wall activity.';
          setSelectedWallError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedWallLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBeer]);

  const openBeerDetail = (beer: Beer) => {
    setSelectedBeer(beer);
  };

  const closeBeerDetail = () => {
    setSelectedBeer(null);
    setSelectedRating(null);
    setRatingError(null);
    setRatingSaving(false);
    setSelectedNotesText('');
    setSelectedNotesSaving(false);
    setSelectedRatingSummary({ average: null, count: 0 });
    setSelectedRatingSummaryLoading(false);
    setSelectedWallActivity([]);
    setSelectedWallError(null);
    setSelectedWallPostText('');
    setSelectedWallPosting(false);
    setSelectedWallPosted(false);
  };

  const handleRateSelectedBeer = async (stars: number) => {
    if (!user || !selectedBeer || ratingSaving) return;

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
    if (!user || !todayBeer || todayRatingSaving) return;

    setTodayRatingSaving(true);
    setTodayRatingError(null);
    try {
      // Stars-only save on tap — parity with Calendar detail modal star-tap behavior.
      // Notes are saved separately via handleSaveTodayNotes; do not overwrite unsaved
      // notes text the user may be editing.
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

  const handleSaveSelectedNotes = async () => {
    if (!user || !selectedBeer || selectedNotesSaving || !selectedRating) return;
    setSelectedNotesSaving(true);
    setRatingError(null);
    try {
      const rating = await upsertUserBeerRating(
        user.id,
        selectedBeer.id,
        selectedRating.stars,
        selectedNotesText.trim() || null,
      );
      setSelectedRating(rating);
      setSelectedNotesText(rating.notes ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your review.';
      setRatingError(message);
    } finally {
      setSelectedNotesSaving(false);
    }
  };

  const handleSaveTodayNotes = async () => {
    if (!user || !todayBeer || todayNotesSaving || !todayRating) return;
    setTodayNotesSaving(true);
    setTodayRatingError(null);
    try {
      const rating = await upsertUserBeerRating(
        user.id,
        todayBeer.id,
        todayRating.stars,
        todayNotesText.trim() || null,
      );
      setTodayRating(rating);
      setTodayNotesText(rating.notes ?? '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your review.';
      setTodayRatingError(message);
    } finally {
      setTodayNotesSaving(false);
    }
  };

  const openBeerWall = (beer: Beer | null) => {
    if (!beer || !onOpenWallForBeer) return;
    closeBeerDetail();
    onOpenWallForBeer({
      id: beer.id,
      name: beer.name,
      dayNumber: beer.day_number,
      brewery: beer.brewery,
    });
  };

  const handleSelectedWallPost = async () => {
    if (!user || !selectedBeer || selectedWallPosting) return;
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
      setSelectedWallPostText(`Day ${selectedBeer.day_number} — ${selectedBeer.name}: `);
      setSelectedWallPosted(true);
      // Non-blocking activity refresh — failure must not overwrite post success.
      try {
        setSelectedWallActivity(await fetchBeerWallActivity(selectedBeer.id, 3));
      } catch (refreshErr) {
        console.warn('[BeerScreen] Wall activity refresh failed after post (non-fatal):', refreshErr);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not post to the Wall.';
      setSelectedWallError(message);
    } finally {
      setSelectedWallPosting(false);
    }
  };

  const renderRatingPanel = ({
    errorMessage,
    loadingRating,
    notesText,
    onNotesChange,
    onRate,
    onSaveNotes,
    rating,
    savingNotes,
    savingRating,
  }: {
    errorMessage: string | null;
    loadingRating: boolean;
    notesText: string;
    onNotesChange: (t: string) => void;
    onRate: (stars: number) => void;
    onSaveNotes: () => void;
    rating: BeerRating | null;
    savingNotes: boolean;
    savingRating: boolean;
  }) => {
    const savedNotes = rating?.notes?.trim() ?? '';
    const notesChanged = notesText.trim() !== savedNotes;
    const busy = savingRating || savingNotes;

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
              <TextInput
                style={styles.notesInput}
                placeholder="Add a tasting note or review… (optional)"
                placeholderTextColor={COLORS.muted}
                multiline
                numberOfLines={3}
                value={notesText}
                onChangeText={onNotesChange}
                editable={!busy && !!rating}
              />
              {!rating ? (
                <Text style={styles.ratingHelpText}>Tap stars to rate — then add a review note.</Text>
              ) : notesChanged ? (
                <TouchableOpacity
                  style={[styles.saveNotesButton, busy && styles.saveNotesButtonDisabled]}
                  onPress={onSaveNotes}
                  disabled={busy}
                  activeOpacity={0.82}
                >
                  <Text style={styles.saveNotesText}>{savingNotes ? 'Saving…' : 'Save Review'}</Text>
                </TouchableOpacity>
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
              {onOpenWallForBeer ? (
                <TouchableOpacity style={styles.wallSecondaryButton} onPress={() => openBeerWall(beer)} activeOpacity={0.78}>
                  <Text style={styles.wallSecondaryButtonText}>Open Wall + Photos</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {selectedWallPosted ? <Text style={styles.wallSuccessText}>Posted to the Wall for this beer.</Text> : null}
          </>
        ) : (
          <Text style={styles.ratingHelpText}>Sign in from The Settings tab or web view to post about this beer.</Text>
        )}

        {selectedWallError ? <Text style={styles.ratingErrorText}>{selectedWallError}</Text> : null}

        <View style={styles.relatedWallHeader}>
          <Text style={styles.factLabel}>What Others Are Saying</Text>
          {onOpenWallForBeer ? (
            <TouchableOpacity onPress={() => openBeerWall(beer)} activeOpacity={0.78}>
              <Text style={styles.wallLinkText}>See all ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {selectedWallLoading ? (
          <View style={styles.ratingLoadingRow}>
            <ActivityIndicator color={COLORS.gold} />
            <Text style={styles.ratingHelpText}>Loading related Wall posts...</Text>
          </View>
        ) : selectedWallActivity.length > 0 ? (
          <View style={styles.relatedWallList}>
            {selectedWallActivity.map((post) => (
              <View key={post.id} style={styles.relatedWallPost}>
                <Text style={styles.relatedWallMeta}>
                  {post.author} · {formatWallTimestamp(post.created_at)}
                </Text>
                {post.content ? <Text style={styles.relatedWallContent}>{post.content}</Text> : null}
                {post.photo_url ? <Text style={styles.relatedWallMeta}>Photo attached</Text> : null}
                <Text style={styles.relatedWallCounts}>
                  {post.reactionCount} reactions · {post.commentCount} comments
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.ratingHelpText}>No Wall posts are tagged to this beer yet. Be the first to start the discussion.</Text>
        )}
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
          <Text style={styles.countdownLabel}>October 1st begins in</Text>
          <View style={styles.countdownRow}>
            <Text style={styles.countdownNumber}>{countdown.days}</Text>
            <Text style={styles.countdownUnit}>days</Text>
            <Text style={styles.countdownDot}>·</Text>
            <Text style={styles.countdownNumber}>{countdown.hours}</Text>
            <Text style={styles.countdownUnit}>hrs</Text>
          </View>
          <View style={styles.manifestoCard}>
            <Text style={styles.manifestoText}>
              Every October, the Society convenes. Thirty-one days. Thirty-one beers. The deliberation is
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
        {renderRatingPanel({
          errorMessage: todayRatingError,
          loadingRating: todayRatingLoading,
          notesText: todayNotesText,
          onNotesChange: setTodayNotesText,
          onRate: (stars) => void handleRateTodayBeer(stars),
          onSaveNotes: () => void handleSaveTodayNotes(),
          rating: todayRating,
          savingNotes: todayNotesSaving,
          savingRating: todayRatingSaving,
        })}
        <View style={styles.actionGrid}>
          <TouchableOpacity
            style={styles.dailyActionCard}
            onPress={() => openBeerWall(todayBeer)}
            disabled={!onOpenWallForBeer}
            activeOpacity={0.82}
          >
            <Text style={styles.dailyActionTitle}>Post to the Wall</Text>
            <Text style={styles.dailyActionText}>Open the beer-tagged Wall composer for posts, photos, comments, and reactions.</Text>
          </TouchableOpacity>
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
              ]}
              onPress={() => {
                if (canOpenDetail && beer) openBeerDetail(beer);
              }}
              activeOpacity={canOpenDetail ? 0.82 : 1}
              disabled={!canOpenDetail}
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

    return (
      <Modal visible transparent animationType="fade" onRequestClose={closeBeerDetail} statusBarTranslucent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalDayLabel}>
                {isSelectedToday ? 'Today · ' : ''}Day {selectedBeer.day_number} · October {selectedBeer.day_number}, {BEER_CALENDAR_YEAR}
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
              <Text style={styles.hubKicker}>{isSelectedToday ? 'Here is what you do today' : 'Calendar beer detail'}</Text>
              {selectedBeer.image_url ? (
                <Image source={{ uri: selectedBeer.image_url }} style={styles.detailImage} resizeMode="cover" />
              ) : null}
              <Text style={styles.modalBeerTitle}>{selectedBeer.name}</Text>
              <Text style={styles.modalBreweryTitle}>{selectedBeer.brewery}</Text>
              {meta ? <Text style={styles.modalMetaText}>{meta}</Text> : null}
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
              <View style={styles.ratingCard}>
                <Text style={styles.factLabel}>Society Rating</Text>
                {selectedRatingSummaryLoading ? (
                  <View style={styles.ratingLoadingRow}>
                    <ActivityIndicator color={COLORS.gold} />
                    <Text style={styles.ratingHelpText}>Loading Society rating...</Text>
                  </View>
                ) : selectedRatingSummary.average !== null ? (
                  <View style={styles.societyRatingRow}>
                    <Text style={styles.societyStars}>
                      {'★'.repeat(Math.round(selectedRatingSummary.average))}
                      {'☆'.repeat(5 - Math.round(selectedRatingSummary.average))}
                    </Text>
                    <Text style={styles.ratingHelpText}>
                      {selectedRatingSummary.average} / 5 · {selectedRatingSummary.count}{' '}
                      {selectedRatingSummary.count === 1 ? 'rating' : 'ratings'}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.ratingHelpText}>
                    No ratings yet. Be the first Society member to weigh in.
                  </Text>
                )}
              </View>

              {renderRatingPanel({
                errorMessage: ratingError,
                loadingRating: ratingLoading,
                notesText: selectedNotesText,
                onNotesChange: setSelectedNotesText,
                onRate: (stars) => void handleRateSelectedBeer(stars),
                onSaveNotes: () => void handleSaveSelectedNotes(),
                rating: selectedRating,
                savingNotes: selectedNotesSaving,
                savingRating: ratingSaving,
              })}
              {renderSelectedWallPanel(selectedBeer)}
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
          {/* Only show the screen header in yourBeer mode; Calendar's intro section provides its own context */}
          {mode === 'yourBeer' ? (
            <View style={styles.header}>
              <View>
                <Text style={styles.appKicker}>Hallowed Hop Society</Text>
                <Text style={styles.headerTitle}>Your Beer</Text>
              </View>
            </View>
          ) : null}

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
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
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

