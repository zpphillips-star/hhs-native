import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { HHS_WEB_ORIGIN } from '../../config/env';
import { useAuth } from '../auth/AuthProvider';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  fetchCurrentUserProfile,
  fetchNotificationPreferences,
  type HhsProfile,
  type NotificationPreferences,
} from './accountSettingsService';

const COLORS = {
  background: '#191726',
  card: '#201d30',
  cardAlt: '#28233a',
  text: '#d9d8d2',
  muted: '#a69d8d',
  gold: '#d97c2b',
  danger: '#e57373',
  border: 'rgba(217, 124, 43, 0.18)',
  borderStrong: 'rgba(217, 124, 43, 0.45)',
};

type NativeAccountSettingsScreenProps = {
  onOpenWebFallback: (path?: string) => void;
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
};

function PreferenceRow({ label, description, enabled, indented }: PreferenceRowProps) {
  return (
    <View style={[styles.preferenceRow, indented && styles.preferenceRowIndented]}>
      <View style={styles.preferenceText}>
        <Text style={styles.preferenceLabel}>{label}</Text>
        <Text style={styles.preferenceDescription}>{description}</Text>
      </View>
      <View style={[styles.readOnlyPill, enabled ? styles.readOnlyPillOn : styles.readOnlyPillOff]}>
        <Text style={[styles.readOnlyPillText, enabled ? styles.readOnlyPillTextOn : styles.readOnlyPillTextOff]}>
          {enabled ? 'On' : 'Off'}
        </Text>
      </View>
    </View>
  );
}

export function NativeAccountSettingsScreen({ onOpenWebFallback }: NativeAccountSettingsScreenProps) {
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

  const displayName = useMemo(() => getDisplayName(profile, user?.email), [profile, user?.email]);

  const loadAccountDetails = useCallback(async (showRefresh = false) => {
    if (!user?.id) {
      setProfile(null);
      setPrefs(DEFAULT_NOTIFICATION_PREFERENCES);
      setDetailsError(null);
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
    const result = await signOut();
    setSigningOut(false);

    if (result.error) {
      setDetailsError(result.error.message);
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

      <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenWebFallback('/auth')} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Open Web Sign-In / Request Access</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSignedIn = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Account</Text>
        <Text style={styles.cardTitle}>{displayName}</Text>
        <View style={styles.infoGrid}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{profile?.email ?? user?.email ?? 'Unknown'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Member Status</Text>
            <Text style={styles.infoValue}>{formatStatus(profile?.status)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Membership Tier</Text>
            <Text style={styles.infoValue}>{formatTier(profile?.tier)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Payment Marker</Text>
            <Text style={styles.infoValue}>{profile?.venmo_clicked_at ? 'Venmo opened' : 'Not recorded'}</Text>
          </View>
        </View>
        <Text style={styles.helperText}>
          Membership payment actions remain in the existing web flow; this native screen only displays safe
          account status.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Notifications</Text>
        <Text style={styles.cardTitle}>Preference Snapshot</Text>
        <Text style={styles.bodyText}>
          Read-only for this foundation step. The social master preference is shown as a select-all
          snapshot; each child category keeps its own meaning.
        </Text>
        <PreferenceRow
          enabled={prefs.daily_beer}
          label="Daily Beer"
          description="Daily October beer reminders."
        />
        <PreferenceRow
          enabled={prefs.social_all}
          label="All Social Notifications"
          description="Master select-all value saved by the web settings flow."
        />
        <PreferenceRow
          enabled={prefs.social_new_comment}
          indented
          label="New Comment"
          description="Someone comments on any post."
        />
        <PreferenceRow
          enabled={prefs.social_new_reaction}
          indented
          label="New Reaction"
          description="Someone reacts to any post."
        />
        <PreferenceRow
          enabled={prefs.social_reaction_to_your_items}
          indented
          label="Reaction to Your Items"
          description="Someone reacts to your post."
        />
        <PreferenceRow
          enabled={prefs.social_comment_on_your_items}
          indented
          label="Comment on Your Items"
          description="Someone comments on your post."
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionKicker}>Session</Text>
        <Text style={styles.bodyText}>Signed in via Supabase native session storage.</Text>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={signingOut}
          onPress={() => void handleSignOut()}
          style={[styles.secondaryButton, signingOut && styles.buttonDisabled]}
        >
          <Text style={styles.secondaryButtonText}>{signingOut ? 'Signing out...' : 'Sign Out'}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenWebFallback('/')} style={styles.textButton}>
          <Text style={styles.textButtonText}>Open Web Home</Text>
        </TouchableOpacity>
      </View>
    </>
  );

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
            <View>
              <Text style={styles.appKicker}>Hallowed Hop Society</Text>
              <Text style={styles.headerTitle}>Account</Text>
            </View>
            <TouchableOpacity activeOpacity={0.8} onPress={() => onOpenWebFallback()} style={styles.webFallbackButton}>
              <Text style={styles.webFallbackText}>Web</Text>
            </TouchableOpacity>
          </View>

          {authLoading || loadingDetails ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={COLORS.gold} size="large" />
              <Text style={styles.loadingText}>Loading account...</Text>
            </View>
          ) : null}

          {detailsError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Account details unavailable</Text>
              <Text style={styles.errorText}>{detailsError}</Text>
              <TouchableOpacity activeOpacity={0.85} onPress={() => void loadAccountDetails()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!authLoading && !loadingDetails ? (user ? renderSignedIn() : renderSignedOut()) : null}

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
    marginBottom: 16,
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
    marginBottom: 16,
    padding: 18,
  },
  errorTitle: {
    color: COLORS.gold,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: COLORS.danger,
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
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
    marginBottom: 16,
    padding: 18,
  },
  sectionKicker: {
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
  },
  bodyText: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
  },
  helperText: {
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  warningBox: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  warningText: {
    color: COLORS.gold,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    backgroundColor: COLORS.cardAlt,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: COLORS.background,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  secondaryButtonText: {
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
    color: COLORS.gold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  infoValue: {
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
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  preferenceDescription: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  readOnlyPill: {
    borderRadius: 999,
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
    color: COLORS.muted,
    fontSize: 12,
    opacity: 0.6,
    textAlign: 'center',
  },
});
