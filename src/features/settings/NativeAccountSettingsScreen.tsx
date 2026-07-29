import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';

const COLORS = HHS_COLORS;
type NativeSettingsMode = 'auth' | 'settings' | 'about' | 'feedback';

type NativeAccountSettingsScreenProps = {
  mode?: NativeSettingsMode;
  onBack?: () => void;
  onOpenAuth?: () => void;
};

function formatTier(tier: string | null | undefined) {
  if (tier === 'hallowed') return 'Hallowed · 31 beers';
  if (tier === 'oddballs') return 'Oddballs · 16 beers';
  return 'Not selected';
}

function formatStatus(status: string | null | undefined) {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getDisplayName(profile: HhsProfile | null, fallbackEmail: string | undefined) {
  if (profile?.display_name) return profile.display_name;
  if (profile?.username) return profile.username;
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  return fallbackEmail ?? 'Signed-in member';
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
  if (mode === 'auth') return 'Sign In';
  if (mode === 'about') return 'About HHS';
  if (mode === 'feedback') return 'Feedback';
  return 'The Settings';
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
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus>('unknown');
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [registeringPush, setRegisteringPush] = useState(false);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDescription, setFeedbackDescription] = useState('');
  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const displayName = useMemo(() => getDisplayName(profile, user?.email), [profile, user?.email]);

  const loadAccountDetails = useCallback(async (showRefresh = false) => {
    if (!user?.id) {
      setProfile(null);
      setPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
      setDetailsError(null);
      setPrefError(null);
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
      const [nextProfile, nextPrefs] = await Promise.all([
        fetchCurrentUserProfile(user.id),
        fetchNotificationPreferences(user.id),
      ]);
      setProfile(nextProfile);
      setPrefs(nextPrefs);
      setPrefError(null);
      const nextPushStatus = await getCurrentPushPermissionStatus();
      setPushStatus(nextPushStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load account details.';
      setDetailsError(message);
    } finally {
      setLoadingDetails(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadAccountDetails();
  }, [loadAccountDetails]);

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

      const nextPrefs = applyNotificationPreferenceToggle(prefs, key, value);
      setPrefSavingKey(key);
      setPrefError(null);

      try {
        await saveNotificationPreferences(user.id, profile?.email ?? user.email, nextPrefs);
        setPrefs(nextPrefs);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save notification preferences.';
        setPrefError(message);
      } finally {
        setPrefSavingKey(null);
      }
    },
    [prefSavingKey, prefs, profile?.email, user?.email, user?.id],
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
        setDetailsError(`Push token cleanup failed: ${cleanup.message}`);
        setSigningOut(false);
        return;
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
          <Text style={styles.infoValue}>{profile?.username ?? profile?.display_name ?? displayName}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{profile?.email ?? user?.email ?? 'Unknown'}</Text>
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
        description="Daily October beer reminders."
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

  const renderSignOutPage = () => (
    <>
      {renderAccountSummary()}
      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Session</Text>
        <Text style={styles.cardTitle}>Signed in</Text>
        <Text style={styles.bodyText}>You are signed in via Supabase native session storage.</Text>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={signingOut}
          onPress={() => void handleSignOut()}
          style={[styles.secondaryButton, signingOut && styles.buttonDisabled]}
        >
          <Text style={styles.secondaryButtonText}>{signingOut ? 'Signing out...' : 'Sign Out'}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderAboutHhs = () => (
    <View style={styles.card}>
      <Text style={styles.sectionKicker}>About HHS</Text>
      <Text style={styles.cardTitle}>The Society of the Sip</Text>
      <Text style={styles.bodyText}>
        The Hallowed Hop Society is an annual gathering of beer enthusiasts who embark on a solemn
        (and slightly ridiculous) ritual: 31 unique beers in 31 haunted days.
      </Text>
      <Text style={styles.bodyText}>
        Each year brings a new theme, a new lineup, and new initiates brave enough to take the oath.
        We drink not just for the flavor — but for the fellowship.
      </Text>
      <Text style={styles.quoteText}>Through ritual we pour, through hops we unite.</Text>
      <View style={styles.joinBox}>
        <Text style={styles.joinTitle}>Want to join the Society?</Text>
        <TouchableOpacity activeOpacity={0.85} onPress={onOpenAuth} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{user ? 'View Membership' : 'I Want In'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

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
            <View>
              <Text style={styles.appKicker}>Hallowed Hop Society</Text>
              <Text style={styles.headerTitle}>{getHeaderTitle(mode)}</Text>
            </View>
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
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
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
  textButton: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  textButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
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
  readOnlyPill: {
    borderRadius: HHS_STYLES.pillRadius,
    borderWidth: 1,
    minWidth: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readOnlyPillOn: {
    backgroundColor: 'rgba(217, 124, 43, 0.12)',
    borderColor: COLORS.borderStrong,
  },
  readOnlyPillOff: {
    backgroundColor: 'rgba(166, 157, 141, 0.08)',
    borderColor: 'rgba(166, 157, 141, 0.25)',
  },
  readOnlyPillText: {
    ...HHS_TYPOGRAPHY.button,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  readOnlyPillTextOn: {
    color: COLORS.gold,
  },
  readOnlyPillTextOff: {
    color: COLORS.muted,
  },
  footerNote: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
});
