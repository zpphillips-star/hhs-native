import React, { useEffect, useState } from 'react';
import { BackHandler, Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { ModernAntiqua_400Regular, useFonts } from '@expo-google-fonts/modern-antiqua';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HHS_WEB_ORIGIN, USE_NATIVE_BEER_SCREEN } from '../config/env';
import { AuthProvider } from '../features/auth/AuthProvider';
import { NativeBeerScreen } from '../features/beers/NativeBeerScreen';
import { NativeFeedbackScreen } from '../features/feedback/NativeFeedbackScreen';
import { NativeRankingsScreen } from '../features/rankings/NativeRankingsScreen';
import { NativeAccountSettingsScreen } from '../features/settings/NativeAccountSettingsScreen';
import { NativeWallBeerContext, NativeWallScreen } from '../features/wall/NativeWallScreen';
import { syncDailyBeerReminderOnStartup } from '../features/notifications/dailyBeerReminderService';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../theme/hhsTheme';

type NativeTabId = 'calendar' | 'wall' | 'yourBeer' | 'rankings' | 'settings';
type NativeContentMode = NativeTabId | 'auth' | 'settingsPage' | 'aboutHhs' | 'feedback';

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
  const insets = useSafeAreaInsets();

  // Startup sync: re-schedule daily beer reminder if it was cleared (e.g. by an app update)
  // without ever prompting for permission.
  useEffect(() => {
    void syncDailyBeerReminderOnStartup();
  }, []);

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
      if (settingsMenuVisible) {
        setSettingsMenuVisible(false);
        return true;
      }

      if (contentMode === 'auth' || contentMode === 'settingsPage' || contentMode === 'aboutHhs' || contentMode === 'feedback') {
        returnToYourBeer();
        return true;
      }

      return false;
    });

    return () => subscription.remove();
  }, [contentMode, settingsMenuVisible]);

  const handleSelectTab = (tab: NativeTab) => {
    if (tab.id === 'settings') {
      setSettingsMenuVisible(true);
      return;
    }

    setSelectedTab(tab.id);
    setContentMode(tab.id);
    if (tab.id !== 'wall') setWallBeerContext(null);
  };

  const openWallForBeer = (beer: NativeWallBeerContext) => {
    setSettingsMenuVisible(false);
    setWallBeerContext(beer);
    setSelectedTab('wall');
    setContentMode('wall');
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

  const openFeedback = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('feedback');
  };

  return (
    <>
      <View style={styles.shell}>
        <View style={styles.content} key={`${contentMode}:${activeWebPath ?? 'native'}`}>
          {!fontsLoaded ? (
            <View style={styles.fontLoadingScreen} />
          ) : contentMode === 'calendar' ? (
            <NativeBeerScreen mode="calendar" onOpenWallForBeer={openWallForBeer} />
          ) : contentMode === 'yourBeer' ? (
            <NativeBeerScreen mode="yourBeer" onOpenWallForBeer={openWallForBeer} />
          ) : contentMode === 'wall' ? (
            <NativeWallScreen initialBeerContext={wallBeerContext} />
          ) : contentMode === 'rankings' ? (
            <NativeRankingsScreen onOpenAuth={openAuth} />
          ) : contentMode === 'auth' ? (
            <NativeAccountSettingsScreen mode="auth" onBack={returnToYourBeer} onOpenAuth={openAuth} />
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
        <View style={[styles.tabBar, { paddingBottom: Math.max(9, insets.bottom + 4) }]}>
          {NATIVE_TABS.map((tab) => {
            const active = tab.id === selectedTab;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabButton, tab.center && styles.centerTabButton, active && styles.tabButtonActive]}
                onPress={() => handleSelectTab(tab)}
                activeOpacity={0.8}
              >
                {tab.center ? (
                  <View style={[styles.logoCircle, active && styles.logoCircleActive]}>
                    <Image source={HHS_LOGO} style={styles.logoImage} resizeMode="contain" />
                  </View>
                ) : null}
                {tab.label ? (
                  <Text style={[styles.tabText, tab.center && styles.centerTabText, active && styles.tabTextActive]}>
                    {tab.label}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
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

                  <TouchableOpacity style={styles.menuItem} onPress={openAuth} activeOpacity={0.78}>
                    <Text style={styles.menuItemText}>Sign in / out</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={openSettingsInfo} activeOpacity={0.78}>
                    <Text style={styles.menuItemText}>Settings</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={openAboutHhs} activeOpacity={0.78}>
                    <Text style={styles.menuItemText}>About HHS</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={openFeedback} activeOpacity={0.78}>
                    <Text style={styles.menuItemText}>Feedback</Text>
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
    fontWeight: '600',
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
    borderColor: HHS_COLORS.gold,
    borderRadius: 36,
    borderWidth: 3,
    height: 66,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: HHS_COLORS.gold,
    shadowOpacity: 0.55,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    width: 66,
  },
  logoCircleActive: {
    borderColor: HHS_COLORS.goldLight,
    backgroundColor: HHS_COLORS.card,
    borderWidth: 3.5,
    shadowOpacity: 0.75,
    elevation: 9,
  },
  logoImage: {
    height: 104,
    transform: [{ translateY: 5 }],
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
    fontWeight: '700',
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
    fontWeight: '700',
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

