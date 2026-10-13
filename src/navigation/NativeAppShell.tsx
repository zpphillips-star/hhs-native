import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, BackHandler, Image, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { ModernAntiqua_400Regular, useFonts } from '@expo-google-fonts/modern-antiqua';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HHS_WEB_ORIGIN, USE_NATIVE_BEER_SCREEN } from '../config/env';
import { AuthProvider } from '../features/auth/AuthProvider';
import { useAuth } from '../features/auth/AuthProvider';
import { NativeBeerScreen } from '../features/beers/NativeBeerScreen';
import { NativeFeedbackScreen } from '../features/feedback/NativeFeedbackScreen';
import {
  getCurrentPushPermissionStatus,
  isDeviceRegisteredLocally,
  registerDeviceForPushNotifications,
} from '../features/notifications/pushRegistrationService';
import { NativeRankingsScreen } from '../features/rankings/NativeRankingsScreen';
import { NativeRosterScreen } from '../features/roster/NativeRosterScreen';
import { NativeAccountSettingsScreen } from '../features/settings/NativeAccountSettingsScreen';
import { NativeWallBeerContext, NativeWallScreen } from '../features/wall/NativeWallScreen';
import { syncDailyBeerReminderOnStartup } from '../features/notifications/dailyBeerReminderService';
import { configureHhsNativeTypography, HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../theme/hhsTheme';

configureHhsNativeTypography();

type NativeTabId = 'calendar' | 'wall' | 'yourBeer' | 'rankings' | 'settings';
type NativeContentMode = NativeTabId | 'auth' | 'settingsPage' | 'roster' | 'aboutHhs' | 'feedback';

type NativeTab = {
  id: NativeTabId;
  label: string;
  webPath?: string;
  center?: boolean;
};

const NATIVE_TABS: readonly NativeTab[] = [
  { id: 'calendar', label: 'The\nCalendar', webPath: '/beers?hhs_app=1&hhs_view=calendar' },
  { id: 'wall', label: 'The\nWall', webPath: '/wall?hhs_app=1&hhs_native_fallback=1' },
  { id: 'yourBeer', label: '', center: true, webPath: '/beers?hhs_app=1&hhs_view=today' },
  { id: 'rankings', label: 'The\nRankings', webPath: '/leaderboard?hhs_app=1&hhs_native_fallback=1' },
  { id: 'settings', label: 'The\nSettings' },
] as const;

const HHS_LOGO = require('../../assets/icon.png');
const NOTIFICATION_ONBOARDING_STORAGE_PREFIX = '@hhs:notification-onboarding:v1';
const HHS_INSTAGRAM_URL = 'https://www.instagram.com/HallowedHopSociety_Official/';

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type NativeAppShellProps = {
  fallback: (initialPath?: string) => React.ReactNode;
};

export function NativeAppShell({ fallback }: NativeAppShellProps) {
  if (!USE_NATIVE_BEER_SCREEN) {
    return <AuthProvider>{fallback()}</AuthProvider>;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NativeAppShellContent fallback={fallback} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function NativeAppShellContent({ fallback }: NativeAppShellProps) {
  const [fontsLoaded] = useFonts({ ModernAntiqua_400Regular });
  const [selectedTab, setSelectedTab] = useState<NativeTabId>('yourBeer');
  const [contentMode, setContentMode] = useState<NativeContentMode>('yourBeer');
  const [settingsMenuVisible, setSettingsMenuVisible] = useState(false);
  const [wallBeerContext, setWallBeerContext] = useState<NativeWallBeerContext | null>(null);
  const [notificationOnboardingVisible, setNotificationOnboardingVisible] = useState(false);
  const [notificationOnboardingBusy, setNotificationOnboardingBusy] = useState(false);
  const [notificationOnboardingMessage, setNotificationOnboardingMessage] = useState<string | null>(null);
  const [notificationOnboardingCanContinue, setNotificationOnboardingCanContinue] = useState(false);
  const insets = useSafeAreaInsets();
  const { loading: authLoading, user } = useAuth();
  const attemptedAutoRegisterRef = React.useRef<string | null>(null);
  const checkedNotificationOnboardingRef = React.useRef<string | null>(null);

  const signedInUserKey = user?.id ? `${user.id}:${user.email ?? ''}` : null;

  // Startup sync: re-schedule daily beer reminder if it was cleared (e.g. by an app update)
  // without ever prompting for permission.
  useEffect(() => {
    void syncDailyBeerReminderOnStartup();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      attemptedAutoRegisterRef.current = null;
      return;
    }

    const userKey = `${user.id}:${user.email ?? ''}`;
    if (attemptedAutoRegisterRef.current === userKey) return;
    attemptedAutoRegisterRef.current = userKey;

    registerDeviceForPushNotifications(
      { id: user.id, email: user.email },
      { requestPermission: false },
    ).then((result) => {
      if (!result.ok && result.status !== 'denied' && result.status !== 'undetermined') {
        console.warn('[HHS native] automatic push registration skipped:', result.message);
      }
    }).catch((error: unknown) => {
      console.warn('[HHS native] automatic push registration failed:', error instanceof Error ? error.message : error);
    });
  }, [user?.email, user?.id]);

  useEffect(() => {
    if (authLoading) return;

    if (!user?.id) {
      checkedNotificationOnboardingRef.current = null;
      setNotificationOnboardingVisible(false);
      setNotificationOnboardingBusy(false);
      setNotificationOnboardingCanContinue(false);
      setNotificationOnboardingMessage(null);
      setSettingsMenuVisible(false);
      setSelectedTab('settings');
      setContentMode('auth');
      return;
    }

    const userKey = `${user.id}:${user.email ?? ''}`;
    if (checkedNotificationOnboardingRef.current === userKey) return;
    checkedNotificationOnboardingRef.current = userKey;

    let cancelled = false;
    const onboardingStorageKey = `${NOTIFICATION_ONBOARDING_STORAGE_PREFIX}:${user.id}`;

    const sendMemberToApp = () => {
      setSettingsMenuVisible(false);
      setSelectedTab('yourBeer');
      setContentMode('yourBeer');
    };

    const showNotificationOnboarding = (message?: string | null) => {
      setNotificationOnboardingMessage(message ?? null);
      setNotificationOnboardingCanContinue(false);
      setNotificationOnboardingVisible(true);
      sendMemberToApp();
    };

    const checkNotificationOnboarding = async () => {
      try {
        const [completedState, permissionStatus, registeredLocally] = await Promise.all([
          AsyncStorage.getItem(onboardingStorageKey).catch(() => null),
          getCurrentPushPermissionStatus(),
          isDeviceRegisteredLocally({ id: user.id, email: user.email }),
        ]);

        if (cancelled) return;

        if (permissionStatus === 'granted' && registeredLocally) {
          await AsyncStorage.setItem(onboardingStorageKey, 'registered').catch(() => {});
          if (!cancelled) {
            setNotificationOnboardingVisible(false);
            sendMemberToApp();
          }
          return;
        }

        if ((completedState === 'denied' || completedState === 'skipped') && permissionStatus !== 'granted') {
          setNotificationOnboardingVisible(false);
          sendMemberToApp();
          return;
        }

        if (permissionStatus === 'granted') {
          setNotificationOnboardingBusy(true);
          const result = await registerDeviceForPushNotifications(
            { id: user.id, email: user.email },
            { requestPermission: false },
          );
          if (cancelled) return;
          setNotificationOnboardingBusy(false);

          if (result.ok && result.registered) {
            const stillConfirmed = await isDeviceRegisteredLocally({ id: user.id, email: user.email });
            if (cancelled) return;
            if (stillConfirmed) {
              await AsyncStorage.setItem(onboardingStorageKey, 'registered').catch(() => {});
              setNotificationOnboardingVisible(false);
              sendMemberToApp();
              return;
            }
          }

          showNotificationOnboarding(result.message);
          return;
        }

        showNotificationOnboarding();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Notification setup could not be checked.';
        showNotificationOnboarding(`${message} You can keep using HHS and retry from Settings.`);
      } finally {
        if (!cancelled) setNotificationOnboardingBusy(false);
      }
    };

    void checkNotificationOnboarding();

    return () => {
      cancelled = true;
    };
  }, [authLoading, signedInUserKey, user?.email, user?.id]);

  const handleEnableNotificationsFromOnboarding = React.useCallback(async () => {
    if (!user?.id || notificationOnboardingBusy) return;

    setNotificationOnboardingBusy(true);
    setNotificationOnboardingMessage(null);
    setNotificationOnboardingCanContinue(false);

    const onboardingStorageKey = `${NOTIFICATION_ONBOARDING_STORAGE_PREFIX}:${user.id}`;
    try {
      const result = await registerDeviceForPushNotifications(
        { id: user.id, email: user.email },
        { requestPermission: true },
      );

      if (result.ok && result.registered) {
        const [permissionStatus, registeredLocally] = await Promise.all([
          getCurrentPushPermissionStatus(),
          isDeviceRegisteredLocally({ id: user.id, email: user.email }),
        ]);

        if (permissionStatus === 'granted' && registeredLocally) {
          await AsyncStorage.setItem(onboardingStorageKey, 'registered').catch(() => {});
          setNotificationOnboardingMessage('You’re all set — HHS notifications are ready on this phone.');
          setNotificationOnboardingCanContinue(false);
          await pause(900);
          setNotificationOnboardingVisible(false);
          setSelectedTab('yourBeer');
          setContentMode('yourBeer');
          return;
        }

        setNotificationOnboardingMessage(
          'Notifications are allowed, but HHS could not confirm this phone yet. Please try again, or continue and retry later from Membership and Notifications.',
        );
        setNotificationOnboardingCanContinue(true);
        return;
      }

      if (result.status === 'denied') {
        await AsyncStorage.setItem(onboardingStorageKey, 'denied').catch(() => {});
        setNotificationOnboardingMessage(
          'Notifications are blocked in system settings. You can continue now and turn them on later from Membership and Notifications.',
        );
        setNotificationOnboardingCanContinue(true);
        return;
      }

      if (result.status === 'undetermined') {
        await AsyncStorage.setItem(onboardingStorageKey, 'skipped').catch(() => {});
        setNotificationOnboardingMessage(
          'No problem — you can keep using HHS and turn notifications on later from Membership and Notifications.',
        );
        setNotificationOnboardingCanContinue(true);
        return;
      }

      setNotificationOnboardingMessage(
        `${result.message} You can continue now and retry later from Membership and Notifications.`,
      );
      setNotificationOnboardingCanContinue(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification setup could not be completed.';
      setNotificationOnboardingMessage(`${message} You can continue now and retry later from Membership and Notifications.`);
      setNotificationOnboardingCanContinue(true);
    } finally {
      setNotificationOnboardingBusy(false);
    }
  }, [notificationOnboardingBusy, user?.email, user?.id]);

  const handleContinueWithoutNotifications = React.useCallback(async () => {
    if (!user?.id || notificationOnboardingBusy) return;

    const permissionStatus = await getCurrentPushPermissionStatus();
    const onboardingStorageKey = `${NOTIFICATION_ONBOARDING_STORAGE_PREFIX}:${user.id}`;
    await AsyncStorage.setItem(
      onboardingStorageKey,
      permissionStatus === 'denied' ? 'denied' : 'skipped',
    ).catch(() => {});
    setNotificationOnboardingVisible(false);
    setNotificationOnboardingCanContinue(false);
    setNotificationOnboardingMessage(null);
    setSelectedTab('yourBeer');
    setContentMode('yourBeer');
  }, [notificationOnboardingBusy, user?.id]);

  const selectedRoute = NATIVE_TABS.find((tab) => tab.id === selectedTab) ?? NATIVE_TABS[0];
  const activeWebPath = selectedRoute.webPath;

  const returnToYourBeer = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('yourBeer');
    setContentMode('yourBeer');
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (notificationOnboardingVisible) {
        if (!notificationOnboardingBusy) void handleContinueWithoutNotifications();
        return true;
      }

      if (settingsMenuVisible) {
        setSettingsMenuVisible(false);
        return true;
      }

      if (!user && contentMode === 'auth') {
        return true;
      }

      if (contentMode === 'auth' || contentMode === 'settingsPage' || contentMode === 'roster' || contentMode === 'aboutHhs' || contentMode === 'feedback') {
        returnToYourBeer();
        return true;
      }

      return false;
    });

    return () => subscription.remove();
  }, [
    contentMode,
    handleContinueWithoutNotifications,
    notificationOnboardingBusy,
    notificationOnboardingVisible,
    settingsMenuVisible,
    user,
  ]);

  const handleSelectTab = (tab: NativeTab) => {
    if (!user) {
      setSettingsMenuVisible(false);
      setSelectedTab('settings');
      setContentMode('auth');
      return;
    }

    if (tab.id === 'settings') {
      setSettingsMenuVisible(true);
      return;
    }

    setSelectedTab(tab.id);
    setContentMode(tab.id);
    if (tab.id !== 'wall') setWallBeerContext(null);
  };

  const openSettingsInfo = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('settingsPage');
  };

  const openAuth = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('auth');
  };

  const openAboutHhs = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('aboutHhs');
  };

  const openRoster = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('roster');
  };

  const openFeedback = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('feedback');
  };

  const openWallAfterBeerPost = (beerContext: NativeWallBeerContext) => {
    setSettingsMenuVisible(false);
    setWallBeerContext(beerContext);
    setSelectedTab('wall');
    setContentMode('wall');
  };

  const openInstagram = () => {
    setSettingsMenuVisible(false);
    void Linking.openURL(HHS_INSTAGRAM_URL);
  };

  return (
    <>
      <View style={styles.shell}>
        <View style={styles.content} key={`${contentMode}:${activeWebPath ?? 'native'}`}>
          {!fontsLoaded || authLoading ? (
            <View style={styles.fontLoadingScreen} />
          ) : !user ? (
            <NativeAccountSettingsScreen mode="auth" onBack={undefined} onOpenAuth={openAuth} />
          ) : contentMode === 'calendar' ? (
            <NativeBeerScreen mode="calendar" onBeerWallPostSuccess={openWallAfterBeerPost} />
          ) : contentMode === 'yourBeer' ? (
            <NativeBeerScreen mode="yourBeer" onBeerWallPostSuccess={openWallAfterBeerPost} />
          ) : contentMode === 'wall' ? (
            <NativeWallScreen initialBeerContext={wallBeerContext} />
          ) : contentMode === 'rankings' ? (
            <NativeRankingsScreen onOpenAuth={openAuth} />
          ) : contentMode === 'auth' ? (
            <NativeAccountSettingsScreen mode="auth" onBack={user ? returnToYourBeer : undefined} onOpenAuth={openAuth} />
          ) : contentMode === 'roster' ? (
            <NativeRosterScreen onBack={returnToYourBeer} />
          ) : contentMode === 'aboutHhs' ? (
            <NativeAccountSettingsScreen mode="about" onBack={returnToYourBeer} onOpenAuth={openAuth} />
          ) : contentMode === 'feedback' ? (
            <NativeFeedbackScreen onBack={returnToYourBeer} />
          ) : contentMode === 'settingsPage' ? (
            <NativeAccountSettingsScreen mode="settings" onBack={returnToYourBeer} onOpenAuth={openAuth} />
          ) : (
            fallback(activeWebPath)
          )}
        </View>
        {user ? (
          <View style={[styles.tabBar, { paddingBottom: Math.max(9, insets.bottom + 4) }]}>
            {NATIVE_TABS.map((tab) => {
              const active = tab.id === selectedTab;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tabButton, tab.center && styles.centerTabButton, active && styles.tabButtonActive]}
                  onPress={() => handleSelectTab(tab)}
                  activeOpacity={0.8}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.center ? 'Your Beer' : tab.label.replace('\n', ' ')}
                  accessibilityState={{ selected: active }}
                >
                  {tab.center ? (
                    <View style={[styles.logoCircle, active && styles.logoCircleActive]}>
                      <Image source={HHS_LOGO} style={styles.logoImage} resizeMode="contain" />
                    </View>
                  ) : null}
                  {tab.label ? (
                    <Text
                      style={[styles.tabText, tab.center && styles.centerTabText, active && styles.tabTextActive]}
                      numberOfLines={2}
                      allowFontScaling={false}
                    >
                      {tab.label}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        <Modal
          visible={settingsMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSettingsMenuVisible(false)}
          statusBarTranslucent
        >
          <TouchableWithoutFeedback onPress={() => setSettingsMenuVisible(false)}>
            <View style={styles.menuBackdrop}>
              <TouchableWithoutFeedback>
                <View style={[styles.menuSheet, { paddingBottom: Math.max(34, insets.bottom + 16) }]}>
                  <View style={styles.menuHandle} />
                  <View style={styles.menuLogoCircle}>
                    <Image source={HHS_LOGO} style={styles.menuLogoImage} resizeMode="contain" />
                  </View>
                  <Text style={styles.menuKicker}>Hallowed Hop Society</Text>
                  <Text style={styles.menuTitle}>The Settings</Text>
                  <Text style={styles.menuBody}>Choose a Society action.</Text>

                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={openSettingsInfo}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Membership and Notifications"
                  >
                    <Text style={styles.menuItemText}>Membership and Notifications</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={openRoster}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="HHS Roster"
                  >
                    <Text style={styles.menuItemText}>HHS Roster</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={openAboutHhs}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="About HHS"
                  >
                    <Text style={styles.menuItemText}>About HHS</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={openInstagram}
                    activeOpacity={0.78}
                    accessibilityRole="link"
                    accessibilityLabel="Instagram"
                  >
                    <Text style={styles.menuItemText}>Instagram</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={openFeedback}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Feedback"
                  >
                    <Text style={styles.menuItemText}>Feedback</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={openAuth}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Sign in or out"
                  >
                    <Text style={styles.menuItemText}>Sign in / out</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>

                  <Text style={styles.menuFooter}>
                    {HHS_WEB_ORIGIN.replace('https://', '')}
                  </Text>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
        <Modal
          visible={notificationOnboardingVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!notificationOnboardingBusy) void handleContinueWithoutNotifications();
          }}
          statusBarTranslucent
        >
          <TouchableWithoutFeedback
            onPress={() => {
              if (!notificationOnboardingBusy) void handleContinueWithoutNotifications();
            }}
          >
            <View style={styles.onboardingBackdrop}>
              <TouchableWithoutFeedback>
                <View style={styles.onboardingCard}>
              <Image source={HHS_LOGO} style={styles.onboardingLogo} resizeMode="contain" />
              <Text style={styles.onboardingKicker}>Hallowed Hop Society</Text>
              <Text style={styles.onboardingTitle}>Stay in the Loop</Text>
              <Text style={styles.onboardingBody}>
                Turn on notifications once and HHS will finish the setup for this phone, then open your beer for today.
              </Text>
              {notificationOnboardingMessage ? (
                <Text style={styles.onboardingMessage}>{notificationOnboardingMessage}</Text>
              ) : null}
              {notificationOnboardingBusy ? (
                <View style={styles.onboardingProgress}>
                  <ActivityIndicator color={HHS_COLORS.gold} size="small" />
                  <Text style={styles.onboardingProgressText}>Finishing notification setup…</Text>
                </View>
              ) : null}
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={notificationOnboardingBusy}
                onPress={() => void handleEnableNotificationsFromOnboarding()}
                style={[styles.onboardingPrimaryButton, notificationOnboardingBusy && styles.onboardingButtonDisabled]}
                accessibilityRole="button"
              >
                <Text style={styles.onboardingPrimaryButtonText}>
                  {notificationOnboardingBusy ? 'Setting Up…' : 'Turn On Notifications'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={notificationOnboardingBusy}
                onPress={() => void handleContinueWithoutNotifications()}
                style={styles.onboardingSecondaryButton}
                accessibilityRole="button"
              >
                <Text style={styles.onboardingSecondaryButtonText}>
                  {notificationOnboardingCanContinue ? 'Continue Without Notifications' : 'Not Now'}
                </Text>
              </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: HHS_COLORS.background,
    flex: 1,
  },
  fontLoadingScreen: {
    backgroundColor: HHS_COLORS.background,
    flex: 1,
  },
  content: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: HHS_COLORS.card,
    borderTopColor: HHS_COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    overflow: 'visible',
    paddingBottom: 9,
    paddingHorizontal: 8,
    paddingTop: 9,
  },
  tabButton: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: HHS_STYLES.pillRadius,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  centerTabButton: {
    marginTop: -28,
    paddingTop: 0,
  },
  tabButtonActive: {
    // No pill, no background — active state is expressed only through text/ring color.
  },
  tabText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  centerTabText: {
    color: HHS_COLORS.text,
    marginTop: 3,
  },
  logoCircle: {
    alignItems: 'center',
    backgroundColor: '#08070d',
    // Inactive: very thin, dim ring — just enough to hint at the circle boundary.
    borderColor: HHS_COLORS.borderStrong,   // rgba(217, 124, 43, 0.45)
    borderRadius: 36,
    borderWidth: 1.5,
    height: 66,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: HHS_COLORS.gold,
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    width: 66,
  },
  logoCircleActive: {
    // Active: thick, bright orange ring with strong glow — unmistakably selected.
    borderColor: HHS_COLORS.goldLight,      // #e8953a — full bright orange
    backgroundColor: HHS_COLORS.card,
    borderWidth: 5,
    shadowOpacity: 0.90,
    shadowRadius: 14,
    elevation: 14,
  },
  logoImage: {
    height: 104,
    width: 104,
  },
  tabTextActive: {
    color: HHS_COLORS.gold,
  },
  menuBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.borderStrong,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  menuHandle: {
    alignSelf: 'center',
    backgroundColor: HHS_COLORS.borderStrong,
    borderRadius: 999,
    height: 4,
    marginBottom: 18,
    width: 42,
  },
  menuLogoCircle: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#08070d',
    borderColor: HHS_COLORS.gold,
    borderRadius: 34,
    borderWidth: 2,
    height: 62,
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
    width: 62,
  },
  menuLogoImage: {
    height: 96,
    transform: [{ translateY: 4 }],
    width: 96,
  },
  menuKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    marginBottom: 6,
    textAlign: 'center',
  },
  menuTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 28,
    textAlign: 'center',
  },
  menuBody: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 14,
    marginBottom: 18,
    marginTop: 6,
    textAlign: 'center',
  },
  menuItem: {
    alignItems: 'center',
    borderBottomColor: HHS_COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 16,
  },
  menuItemText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    flex: 1,
    fontSize: 17,
  },
  menuChevron: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 24,
  },
  menuFooter: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 12,
    marginTop: 16,
    opacity: 0.72,
    textAlign: 'center',
  },
  onboardingBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.74)',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  onboardingCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.borderStrong,
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    maxWidth: 430,
    padding: 22,
    width: '100%',
  },
  onboardingLogo: {
    alignSelf: 'center',
    height: 86,
    marginBottom: -6,
    width: 86,
  },
  onboardingKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    textAlign: 'center',
  },
  onboardingTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 30,
    textAlign: 'center',
  },
  onboardingBody: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.text,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  onboardingMessage: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: HHS_COLORS.cardAlt,
    borderColor: HHS_COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: HHS_COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
    textAlign: 'center',
  },
  onboardingProgress: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  onboardingProgressText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.gold,
    fontSize: 14,
  },
  onboardingPrimaryButton: {
    alignItems: 'center',
    backgroundColor: HHS_COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  onboardingPrimaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.background,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  onboardingSecondaryButton: {
    alignItems: 'center',
    borderColor: HHS_COLORS.borderStrong,
    borderRadius: HHS_STYLES.buttonRadius,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  onboardingSecondaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: HHS_COLORS.text,
    fontSize: 13,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  onboardingButtonDisabled: {
    opacity: 0.65,
  },
  aboutScreen: {
    backgroundColor: HHS_COLORS.background,
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  aboutCard: {
    backgroundColor: HHS_COLORS.card,
    borderColor: HHS_COLORS.border,
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    padding: 22,
  },
  aboutKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: HHS_COLORS.gold,
    fontSize: 11,
    marginBottom: 10,
    textAlign: 'center',
  },
  aboutTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: HHS_COLORS.text,
    fontSize: 28,
    marginBottom: 14,
    textAlign: 'center',
  },
  aboutBody: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 16,
    lineHeight: 25,
    textAlign: 'center',
  },
});
