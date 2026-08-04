import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { HHS_WEB_ORIGIN } from '../../config/env';
import {
  getCurrentPushPermissionStatus,
  registerDeviceForPushNotifications,
  unregisterCachedPushToken,
  type PushPermissionStatus,
} from '../notifications/pushRegistrationService';
import { syncDailyBeerReminder } from '../notifications/dailyBeerReminderService';
import { useAuth } from '../auth/AuthProvider';
import {
  applyNotificationPreferenceToggle,
  DEFAULT_NOTIFICATION_PREFERENCES,
  fetchCurrentUserProfile,
  fetchNotificationPreferences,
  saveNotificationPreferences,
  type HhsProfile,
  type NotificationPreferences,
} from './accountSettingsService';
import {
  getEffectiveBeerVisibilityPreference,
  normalizeMembershipTier,
  saveBeerVisibilityPreference,
  type BeerVisibilityPreference,
} from '../membership/beerVisibilityService';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';

const COLORS = HHS_COLORS;
type NativeSettingsMode = 'auth' | 'settings' | 'about' | 'feedback';

type NativeAccountSettingsScreenProps = {
  mode?: NativeSettingsMode;
  onBack?: () => void;
  onOpenAuth?: () => void;
};

function formatTier(tier: string | null | undefined) {
  const normalized = normalizeMembershipTier(tier);
  if (normalized === 'hallowed') return 'Hallowed · 31 beers';
  if (normalized === 'oddballs') return 'Oddballs · 16 beers';
  return 'Not selected';
}

function formatStatus(status: string | null | undefined) {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getDisplayName(profile: HhsProfile | null, fallbackEmail: string | undefined) {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  const nativeDisplayName = profile?.display_name_native?.trim();
  if (nativeDisplayName) return nativeDisplayName;
  const displayName = profile?.display_name?.trim();
  if (displayName) return displayName;
  const username = profile?.username?.trim();
  if (username) return username;
  return fallbackEmail?.trim() ?? 'Signed-in member';
}

type PreferenceRowProps = {
  label: string;
  description: string;
  enabled: boolean;
  indented?: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
};

function PreferenceRow({ label, description, enabled, indented, disabled, onValueChange }: PreferenceRowProps) {
  return (
    <View style={[styles.preferenceRow, indented && styles.preferenceRowIndented]}>
      <View style={styles.preferenceText}>
        <Text style={styles.preferenceLabel}>{label}</Text>
        <Text style={styles.preferenceDescription}>{description}</Text>
      </View>
      <Switch
        disabled={disabled}
        ios_backgroundColor={COLORS.cardAlt}
        onValueChange={onValueChange}
        thumbColor={enabled ? COLORS.gold : COLORS.muted}
        trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
        value={enabled}
      />
    </View>
  );
}

function getHeaderTitle(mode: NativeSettingsMode) {
  if (mode === 'auth') return 'Sign in / out';
  if (mode === 'about') return 'About HHS';
  if (mode === 'feedback') return 'Feedback';
  return 'Membership and Notifications';
}

export function NativeAccountSettingsScreen({
  mode = 'settings',
  onBack,
  onOpenAuth,
}: NativeAccountSettingsScreenProps) {
  const { configured, loading: authLoading, signIn, signOut, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profile, setProfile] = useState<HhsProfile | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [prefSavingKey, setPrefSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [beerVisibilitySaving, setBeerVisibilitySaving] = useState(false);
  const [beerVisibilityError, setBeerVisibilityError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus>('unknown');
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [registeringPush, setRegisteringPush] = useState(false);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDescription, setFeedbackDescription] = useState('');
  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  const displayName = useMemo(() => getDisplayName(profile, user?.email), [profile, user?.email]);
  const normalizedTier = useMemo(() => normalizeMembershipTier(profile?.tier), [profile?.tier]);

  const loadAccountDetails = useCallback(async (showRefresh = false) => {
    if (!user?.id) {
      setProfile(null);
      setPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
      setDetailsError(null);
      setPrefError(null);
      setBeerVisibilityError(null);
      setPushMessage(null);
      setPushStatus('unknown');
      setLoadingDetails(false);
      setRefreshing(false);
      return;
    }

    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoadingDetails(true);
    }
    setDetailsError(null);

    try {
      const nextProfile = await fetchCurrentUserProfile(user.id);
      setProfile(nextProfile);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load account profile.';
      setProfile(null);
      setDetailsError(`Profile: ${message}`);
    }

    try {
      const nextPrefs = await fetchNotificationPreferences(user.id);
      setPrefs(nextPrefs);
      setPrefError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load notification preferences.';
      setPrefError(message);
    }

    try {
      const nextPushStatus = await getCurrentPushPermissionStatus();
      setPushStatus(nextPushStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not read push permission status.';
      setPushStatus('unknown');
      setPushMessage(message);
    } finally {
      setLoadingDetails(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadAccountDetails();
  }, [loadAccountDetails]);

  useEffect(() => {
    if (mode !== 'about') return undefined;
    const tick = () => {
      const now = new Date();
      if (now.getMonth() === 9) return; // October — no countdown needed
      const oct1 = new Date(now.getFullYear(), 9, 1);
      if (now > oct1) oct1.setFullYear(oct1.getFullYear() + 1);
      const diff = oct1.getTime() - now.getTime();
      setCountdown({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode]);

  const handleRegisterPush = useCallback(async () => {
    if (!user?.id || registeringPush) return;

    setRegisteringPush(true);
    setPushMessage(null);

    const result = await registerDeviceForPushNotifications(
      { id: user.id, email: profile?.email ?? user.email },
      { requestPermission: true },
    );

    setPushStatus(result.status);
    setPushMessage(result.message);
    setRegisteringPush(false);
  }, [profile?.email, registeringPush, user?.email, user?.id]);

  const handlePreferenceChange = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      if (!user?.id || prefSavingKey) return;

      const previousPrefs = prefs;
      const nextPrefs = applyNotificationPreferenceToggle(prefs, key, value);
      setPrefSavingKey(key);
      setPrefError(null);
      setPrefs(nextPrefs);

      try {
        await saveNotificationPreferences(user.id, profile?.email ?? user.email, nextPrefs);
        // Sync daily local reminder if the daily_beer toggle changed.
        if (key === 'daily_beer') {
          void syncDailyBeerReminder(value);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save notification preferences.';
        setPrefs(previousPrefs);
        setPrefError(message);
      } finally {
        setPrefSavingKey(null);
      }
    },
    [prefSavingKey, prefs, profile?.email, user?.email, user?.id],
  );

  const handleBeerVisibilityChange = useCallback(
    async (showAll: boolean) => {
      if (!user?.id || beerVisibilitySaving || normalizedTier === 'unknown' || normalizedTier === 'logged_out') return;

      const previousProfile = profile;
      const nextPreference: BeerVisibilityPreference = showAll ? 'all' : 'participating_only';
      setBeerVisibilitySaving(true);
      setBeerVisibilityError(null);
      setProfile((current) =>
        current
          ? {
              ...current,
              beer_visibility_preference: nextPreference,
            }
          : current,
      );

      try {
        await saveBeerVisibilityPreference(user.id, nextPreference);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save beer visibility preference.';
        setProfile(previousProfile);
        setBeerVisibilityError(message);
      } finally {
        setBeerVisibilitySaving(false);
      }
    },
    [beerVisibilitySaving, normalizedTier, profile, user?.id],
  );

  const handleSignIn = async () => {
    if (signingIn || !email.trim() || !password) return;

    setSigningIn(true);
    setSignInError(null);
    const result = await signIn(email, password);
    setSigningIn(false);

    if (result.error) {
      setSignInError(result.error.message);
      return;
    }

    setPassword('');
  };

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    if (user?.id) {
      const cleanup = await unregisterCachedPushToken({ id: user.id, email: profile?.email ?? user.email });
      if (!cleanup.ok) {
        console.warn('[HHS sign-out] Push token cleanup failed (non-fatal):', cleanup.message);
      }
    }
    const result = await signOut();
    setSigningOut(false);

    if (result.error) {
      setDetailsError(result.error.message);
    }
  };

  const handleSubmitFeedback = async () => {
    if (feedbackSubmitting || !feedbackTitle.trim()) return;

    setFeedbackSubmitting(true);
    setFeedbackMessage(null);
    setFeedbackError(null);
    try {
      const response = await fetch(`${HHS_WEB_ORIGIN}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: feedbackTitle.trim(),
          description: feedbackDescription.trim() || undefined,
          name: feedbackName.trim() || user?.email || undefined,
          image_urls: [],
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setFeedbackError(json.error ?? `Feedback submit failed (${response.status}).`);
        return;
      }
      setFeedbackTitle('');
      setFeedbackDescription('');
      setFeedbackName('');
      setFeedbackMessage('Thanks — your suggestion was submitted for review.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setFeedbackError(message);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const renderSignedOut = () => (
    <View style={styles.card}>
      <Text style={styles.sectionKicker}>Session</Text>
      <Text style={styles.cardTitle}>Sign in to HHS</Text>
      <Text style={styles.bodyText}>
        Native email/password sign-in uses the same Supabase auth method as the web app. Request access
        and password recovery still open the web flow.
      </Text>

      {!configured ? (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>Supabase public env is not configured in this native build.</Text>
        </View>
      ) : null}

      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!signingIn && configured}
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder="your@email.com"
        placeholderTextColor="rgba(166, 157, 141, 0.7)"
        style={styles.input}
        textContentType="emailAddress"
        value={email}
      />
      <TextInput
        editable={!signingIn && configured}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor="rgba(166, 157, 141, 0.7)"
        secureTextEntry
        style={styles.input}
        textContentType="password"
        value={password}
      />

      {signInError ? <Text style={styles.errorText}>{signInError}</Text> : null}

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={signingIn || !configured || !email.trim() || !password}
        onPress={() => void handleSignIn()}
        style={[
          styles.primaryButton,
          (signingIn || !configured || !email.trim() || !password) && styles.buttonDisabled,
        ]}
      >
        <Text style={styles.primaryButtonText}>{signingIn ? 'Signing in...' : 'Sign In'}</Text>
      </TouchableOpacity>

    </View>
  );

  const renderAccountSummary = () => (
    <View style={styles.card}>
      <Text style={styles.sectionKicker}>Account</Text>
      <Text style={styles.cardTitle}>{displayName}</Text>
      <View style={styles.infoGrid}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Username</Text>
          <Text style={styles.infoValue}>
            {profile?.username?.trim() || profile?.display_name_native?.trim() || profile?.display_name?.trim() || displayName}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{profile?.email?.trim() || user?.email || 'Unknown'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Member Status</Text>
          <Text style={styles.infoValue}>{formatStatus(profile?.status)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Purchased Membership</Text>
          <Text style={styles.infoValue}>{formatTier(profile?.tier)}</Text>
        </View>
      </View>
      <Text style={styles.helperText}>
        Membership payment actions remain in the existing web flow; this native screen only displays safe
        account status.
      </Text>
    </View>
  );

  const renderNotificationSettings = () => (
    <View style={styles.card}>
      <Text style={styles.sectionKicker}>Notifications</Text>
      <Text style={styles.cardTitle}>Notification Settings</Text>
      <Text style={styles.bodyText}>
        Manage native push registration and the same saved preferences used by the web app. All Social
        is a select-all helper; each child category still controls its own notification type.
      </Text>
      <View style={styles.pushStatusBox}>
        <Text style={styles.infoLabel}>Push Device</Text>
        <Text style={styles.infoValue}>
          {pushStatus === 'granted'
            ? 'System permission granted'
            : pushStatus === 'denied'
              ? 'System permission denied'
              : pushStatus === 'undetermined'
                ? 'Permission not requested'
                : 'Permission status unknown'}
        </Text>
        {pushMessage ? <Text style={styles.helperText}>{pushMessage}</Text> : null}
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={registeringPush}
          onPress={() => void handleRegisterPush()}
          style={[styles.primaryButton, registeringPush && styles.buttonDisabled]}
        >
          <Text style={styles.primaryButtonText}>
            {registeringPush ? 'Registering...' : pushStatus === 'granted' ? 'Register This Device' : 'Enable Push Notifications'}
          </Text>
        </TouchableOpacity>
      </View>
      {prefError ? <Text style={styles.errorText}>{prefError}</Text> : null}
      <PreferenceRow
        disabled={Boolean(prefSavingKey)}
        enabled={prefs.daily_beer}
        label="Daily Beer"
        description="Daily 4 PM reminder when your beer of the day drops."
        onValueChange={(value) => void handlePreferenceChange('daily_beer', value)}
      />
      <PreferenceRow
        disabled={Boolean(prefSavingKey)}
        enabled={prefs.social_all}
        label="All Social Notifications"
        description="Turn all four social notification categories on or off together."
        onValueChange={(value) => void handlePreferenceChange('social_all', value)}
      />
      <PreferenceRow
        disabled={Boolean(prefSavingKey)}
        enabled={prefs.social_new_comment}
        indented
        label="New Comment"
        description="Someone comments on any post."
        onValueChange={(value) => void handlePreferenceChange('social_new_comment', value)}
      />
      <PreferenceRow
        disabled={Boolean(prefSavingKey)}
        enabled={prefs.social_new_reaction}
        indented
        label="New Reaction"
        description="Someone reacts to any post."
        onValueChange={(value) => void handlePreferenceChange('social_new_reaction', value)}
      />
      <PreferenceRow
        disabled={Boolean(prefSavingKey)}
        enabled={prefs.social_reaction_to_your_items}
        indented
        label="Reaction to Your Items"
        description="Someone reacts to your post."
        onValueChange={(value) => void handlePreferenceChange('social_reaction_to_your_items', value)}
      />
      <PreferenceRow
        disabled={Boolean(prefSavingKey)}
        enabled={prefs.social_comment_on_your_items}
        indented
        label="Comment on Your Items"
        description="Someone comments on your post."
        onValueChange={(value) => void handlePreferenceChange('social_comment_on_your_items', value)}
      />
      {prefSavingKey ? <Text style={styles.settingsSavingText}>Saving notification preferences…</Text> : null}
    </View>
  );

  const renderBeerVisibilitySettings = () => {
    if (!user || !profile) return null;

    const effectivePreference = getEffectiveBeerVisibilityPreference(
      normalizedTier,
      profile.beer_visibility_preference ?? null,
    );
    const showingHallowedCalendar = effectivePreference === 'all';

    if (normalizedTier === 'unknown') {
      return (
        <View style={styles.card}>
          <Text style={styles.sectionKicker}>Membership</Text>
          <Text style={styles.cardTitle}>Beer Calendar Visibility</Text>
          <Text style={styles.bodyText}>
            This setting controls whether you see only the beers for your membership tier or the full 31-beer
            lineup.{'\n\n'}
            Oddballs members (16 beers, odd-numbered days) can turn on &quot;Show all 31 beers&quot; to peek at
            revealed Full Society beers — even-day entries stay read-only.{'\n\n'}
            Your membership tier is not yet set in your profile. Contact HHS or check your membership
            confirmation to get your tier configured.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Membership</Text>
        <Text style={styles.cardTitle}>Beer Calendar Visibility</Text>
        <Text style={styles.bodyText}>
          Your membership: {formatTier(profile?.tier)}.{'\n\n'}
          Choose which beer calendar list you want to see. Hallowed shows all 31 beers; Oddballs shows the
          16 odd-numbered beer days.
          {normalizedTier === 'oddballs'
            ? ' If you view the Hallowed list, even-day beers stay view-only: no rating and no beer-specific Wall post.'
            : ' This changes calendar visibility only; your actual membership stays unchanged.'}
        </Text>
        {beerVisibilityError ? <Text style={styles.errorText}>{beerVisibilityError}</Text> : null}
        <PreferenceRow
          disabled={beerVisibilitySaving}
          enabled={showingHallowedCalendar}
          label="Hallowed calendar"
          description={
            showingHallowedCalendar
              ? 'Showing the full 31-beer calendar.'
              : 'Showing the Oddballs 16-beer calendar.'
          }
          onValueChange={(value) => void handleBeerVisibilityChange(value)}
        />
        {beerVisibilitySaving ? <Text style={styles.settingsSavingText}>Saving beer visibility…</Text> : null}
      </View>
    );
  };

  const renderSignOutPage = () => (
    <View style={styles.card}>
      <Text style={styles.sectionKicker}>Session</Text>
      <Text style={styles.cardTitle}>Signed in</Text>
      <Text style={styles.bodyText}>Use this screen only to end your current HHS app session.</Text>
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={signingOut}
        onPress={() => void handleSignOut()}
        style={[styles.secondaryButton, signingOut && styles.buttonDisabled]}
      >
        <Text style={styles.secondaryButtonText}>{signingOut ? 'Signing out...' : 'Sign Out'}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderAboutHhs = () => {
    const isOctober = new Date().getMonth() === 9;
    return (
      <>
        {/* Featured hero title — no card, full-width branded display */}
        <View style={styles.aboutHeroSection}>
          <Text style={styles.aboutHeroKicker}>The Annual October Ritual</Text>
          <Text style={styles.aboutDisplayTitle}>HALLOWED{'\n'}HOP SOCIETY</Text>
          <Image
            resizeMode="contain"
            source={require('../../../assets/mughhs.webp')}
            style={styles.aboutHeroImage}
          />
        </View>

        <View style={styles.aboutDivider} />

        {/* Main copy — mug image as a subtle watermark behind the text */}
        <ImageBackground
          imageStyle={styles.aboutWatermarkImage}
          resizeMode="cover"
          source={require('../../../assets/mughhs.webp')}
          style={styles.aboutBodySection}
        >
          <View style={styles.aboutBodyContent}>
            <Text style={styles.bodyText}>
              As October's chill creeps in and shadows grow long, a devoted fellowship rises to honor the sacred tradition of the hop.
            </Text>
            <Text style={styles.bodyText}>
              <Text style={styles.aboutBodyStrong}>The Hallowed Hop Society</Text>
              {' is an annual gathering of beer enthusiasts who embark on a solemn (and slightly ridiculous) ritual: '}
              <Text style={styles.aboutBodyEmphasis}>31 unique beers in 31 haunted days.</Text>
              {' No repeats. No excuses. Just pure, unfiltered reverence for the craft of brewing.'}
            </Text>
            <Text style={styles.bodyText}>
              Each year brings a new theme, a new lineup of brews, and new initiates brave enough to take the oath. From spiced pumpkin ales to bone-chilling stouts, we drink not just for the flavor—but for the fellowship.
            </Text>
            <Text style={styles.quoteText}>Through ritual we pour, through hops we unite.</Text>
            <Text style={styles.bodyText}>
              We are a society of the sip, the story, and the sacred pour.
            </Text>
            <Text style={styles.bodyText}>
              If you've got a taste for adventure (and good beer), your place at the circle awaits.
            </Text>
          </View>
        </ImageBackground>

        <View style={styles.aboutDivider} />

        {/* Countdown to October (only shown pre-October) */}
        {!isOctober ? (
          <>
            <View style={styles.aboutSection}>
              <Text style={styles.sectionKicker}>The ritual begins in</Text>
              <View style={styles.aboutCountdownRow}>
                {[
                  { val: countdown.days, label: 'Days' },
                  { val: countdown.hours, label: 'Hours' },
                  { val: countdown.minutes, label: 'Min' },
                  { val: countdown.seconds, label: 'Sec' },
                ].map(({ val, label }) => (
                  <View key={label} style={styles.aboutCountdownUnit}>
                    <Text style={styles.aboutCountdownNum}>{String(val).padStart(2, '0')}</Text>
                    <Text style={styles.aboutCountdownLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.aboutDivider} />
          </>
        ) : null}

        {/* Join CTA */}
        <View style={styles.aboutCtaSection}>
          <Text style={styles.joinTitle}>WANT TO JOIN{'\n'}THE SOCIETY?</Text>
          <TouchableOpacity activeOpacity={0.85} onPress={onOpenAuth} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{user ? 'View Membership' : 'I Want In'}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const renderSignInRequired = () => (
    <View style={styles.card}>
      <Text style={styles.sectionKicker}>Members Only</Text>
      <Text style={styles.cardTitle}>Sign in required</Text>
      <Text style={styles.bodyText}>
        Sign in to view your username, purchased membership, and saved notification settings.
      </Text>
      <TouchableOpacity activeOpacity={0.85} onPress={onOpenAuth} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Sign In</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSettingsContent = () => (
    <>
      {user ? (
        <>
          {renderAccountSummary()}
          {renderBeerVisibilitySettings()}
          {renderNotificationSettings()}
        </>
      ) : (
        renderSignInRequired()
      )}
    </>
  );

  const renderFeedback = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Roadmap & Feedback</Text>
        <Text style={styles.cardTitle}>Suggest a Feature</Text>
        <Text style={styles.bodyText}>
          Tell the Society what should be improved next. This posts to the same feedback board used by
          the web app.
        </Text>
        {feedbackMessage ? <Text style={styles.successText}>{feedbackMessage}</Text> : null}
        {feedbackError ? <Text style={styles.errorText}>{feedbackError}</Text> : null}
        <TextInput
          editable={!feedbackSubmitting}
          onChangeText={setFeedbackTitle}
          placeholder="Short title"
          placeholderTextColor="rgba(166, 157, 141, 0.7)"
          style={styles.input}
          value={feedbackTitle}
        />
        <TextInput
          editable={!feedbackSubmitting}
          multiline
          numberOfLines={4}
          onChangeText={setFeedbackDescription}
          placeholder="Describe your idea"
          placeholderTextColor="rgba(166, 157, 141, 0.7)"
          style={[styles.input, styles.textArea]}
          textAlignVertical="top"
          value={feedbackDescription}
        />
        <TextInput
          editable={!feedbackSubmitting}
          onChangeText={setFeedbackName}
          placeholder={user?.email ? `Name (optional) · ${user.email}` : 'Your name (optional)'}
          placeholderTextColor="rgba(166, 157, 141, 0.7)"
          style={styles.input}
          value={feedbackName}
        />
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={feedbackSubmitting || !feedbackTitle.trim()}
          onPress={() => void handleSubmitFeedback()}
          style={[styles.primaryButton, (feedbackSubmitting || !feedbackTitle.trim()) && styles.buttonDisabled]}
        >
          <Text style={styles.primaryButtonText}>{feedbackSubmitting ? 'Submitting...' : 'Submit Feedback'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Board</Text>
        <Text style={styles.bodyText}>
          Feedback images and admin board moves stay in the web/admin workflow for now; this native page
          keeps suggestion submission reliable.
        </Text>
      </View>
    </>
  );

  const renderBody = () => {
    if (mode === 'auth') return user ? renderSignOutPage() : renderSignedOut();
    if (mode === 'about') return renderAboutHhs();
    if (mode === 'feedback') return renderFeedback();
    return renderSettingsContent();
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor={COLORS.background} />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            user ? (
              <RefreshControl
                colors={[COLORS.gold]}
                onRefresh={() => void loadAccountDetails(true)}
                refreshing={refreshing}
                tintColor={COLORS.gold}
              />
            ) : undefined
          }
        >
          <View style={styles.header}>
            {onBack ? (
              <TouchableOpacity activeOpacity={0.82} onPress={onBack} style={styles.backButton} accessibilityLabel="Back to Your Beer">
                <Text style={styles.backButtonText}>‹</Text>
              </TouchableOpacity>
            ) : null}
          {mode !== 'about' ? (
              <View>
                <Text style={styles.appKicker}>Hallowed Hop Society</Text>
                <Text style={styles.headerTitle}>{getHeaderTitle(mode)}</Text>
              </View>
            ) : null}
          </View>

          {(mode === 'auth' || mode === 'settings') && (authLoading || loadingDetails) ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={COLORS.gold} size="large" />
              <Text style={styles.loadingText}>Loading account...</Text>
            </View>
          ) : null}

          {(mode === 'auth' || mode === 'settings') && detailsError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Account details unavailable</Text>
              <Text style={styles.errorText}>{detailsError}</Text>
              <TouchableOpacity activeOpacity={0.85} onPress={() => void loadAccountDetails()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {mode === 'about' || mode === 'feedback' || (!authLoading && !loadingDetails) ? renderBody() : null}

          <Text style={styles.footerNote}>{HHS_WEB_ORIGIN.replace('https://', '')}</Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
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
    justifyContent: 'flex-start',
    marginBottom: 24,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  backButtonText: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 32,
    lineHeight: 34,
    marginTop: -3,
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
  loadingCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
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
    marginBottom: 16,
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
    color: COLORS.danger,
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
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    gap: 14,
    marginBottom: 16,
    padding: 18,
  },
  sectionKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
  },
  bodyText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  helperText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  successText: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: 'rgba(95, 166, 95, 0.12)',
    borderColor: 'rgba(95, 166, 95, 0.24)',
    borderRadius: 10,
    borderWidth: 1,
    color: '#8fd48f',
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  quoteText: {
    ...HHS_TYPOGRAPHY.body,
    borderLeftColor: COLORS.gold,
    borderLeftWidth: 3,
    color: COLORS.text,
    fontSize: 15,
    fontStyle: 'italic',
    fontWeight: '700',
    lineHeight: 23,
    paddingLeft: 14,
  },
  pushStatusBox: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 13,
  },
  warningBox: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  warningText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textArea: {
    minHeight: 112,
  },
  joinBox: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginTop: 4,
    padding: 16,
  },
  joinTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1.8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.background,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: COLORS.borderStrong,
    borderRadius: HHS_STYLES.buttonRadius,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  infoGrid: {
    gap: 10,
  },
  infoRow: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 13,
  },
  infoLabel: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  infoValue: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 21,
  },
  preferenceRow: {
    alignItems: 'center',
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 13,
  },
  preferenceRowIndented: {
    marginLeft: 18,
  },
  preferenceText: {
    flex: 1,
  },
  preferenceLabel: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  preferenceDescription: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  settingsSavingText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  footerNote: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
  // --- About HHS page styles ---
  aboutHeroKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.5,
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  aboutHeroImage: {
    height: 170,
    marginTop: 14,
    opacity: 0.82,
    width: '72%',
  },

  aboutDisplayTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 2.5,
    lineHeight: 54,
    marginTop: 6,
    textAlign: 'center',
  },
  aboutHeroSection: {
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 28,
    paddingTop: 16,
  },
  aboutDivider: {
    backgroundColor: COLORS.border,
    height: 1,
    marginBottom: 24,
    marginHorizontal: 4,
    marginTop: 4,
  },
  aboutSection: {
    gap: 14,
    marginBottom: 8,
    paddingVertical: 4,
  },
  aboutBodySection: {
    marginBottom: 8,
    overflow: 'hidden',
  },
  aboutBodyContent: {
    gap: 14,
    paddingVertical: 16,
  },
  aboutCtaSection: {
    alignItems: 'center',
    gap: 16,
    paddingBottom: 8,
    paddingTop: 16,
  },
  aboutWatermarkCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  aboutWatermarkImage: {
    opacity: 0.09,
  },
  aboutWatermarkContent: {
    gap: 14,
    padding: 18,
  },
  aboutBodyEmphasis: {
    color: COLORS.gold,
    fontStyle: 'italic',
    fontWeight: '700',
  },
  aboutCountdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  aboutCountdownUnit: {
    alignItems: 'center',
    flex: 1,
  },
  aboutCountdownNum: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 38,
  },
  aboutCountdownLabel: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.muted,
    fontSize: 10,
    letterSpacing: 1.4,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  aboutCtaCard: {
    alignItems: 'center',
    borderTopColor: COLORS.gold,
    borderTopWidth: 2,
    gap: 14,
    paddingTop: 22,
  },
  aboutBodyStrong: {
    color: COLORS.text,
    fontWeight: '700',
  },
});
