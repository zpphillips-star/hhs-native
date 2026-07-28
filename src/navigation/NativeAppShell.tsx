import React, { useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';

import { USE_NATIVE_BEER_SCREEN } from '../config/env';
import { AuthProvider } from '../features/auth/AuthProvider';
import { useAuth } from '../features/auth/AuthProvider';
import { NativeBeerScreen } from '../features/beers/NativeBeerScreen';
import { NativeAccountSettingsScreen } from '../features/settings/NativeAccountSettingsScreen';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../theme/hhsTheme';

type NativeTabId = 'calendar' | 'wall' | 'yourBeer' | 'rankings' | 'settings';
type NativeContentMode = NativeTabId | 'aboutHhs';

type NativeTab = {
  id: NativeTabId;
  label: string;
  webPath?: string;
  center?: boolean;
};

const NATIVE_TABS: readonly NativeTab[] = [
  { id: 'calendar', label: 'The Calendar' },
  { id: 'wall', label: 'The Wall', webPath: '/wall' },
  { id: 'yourBeer', label: 'Your Beer', center: true },
  { id: 'rankings', label: 'The Rankings', webPath: '/leaderboard' },
  { id: 'settings', label: 'The Settings' },
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
    <AuthProvider>
      <NativeAppShellContent fallback={fallback} />
    </AuthProvider>
  );
}

function NativeAppShellContent({ fallback }: NativeAppShellProps) {
  const { user } = useAuth();
  const [selectedTab, setSelectedTab] = useState<NativeTabId>('yourBeer');
  const [contentMode, setContentMode] = useState<NativeContentMode>('yourBeer');
  const [settingsMenuVisible, setSettingsMenuVisible] = useState(false);
  const [webFallbackPath, setWebFallbackPath] = useState<string | null>(null);

  const selectedRoute = NATIVE_TABS.find((tab) => tab.id === selectedTab) ?? NATIVE_TABS[0];
  const activeWebPath = webFallbackPath ?? selectedRoute.webPath;
  const showingCalendar = contentMode === 'calendar' && !webFallbackPath;
  const showingYourBeer = contentMode === 'yourBeer' && !webFallbackPath;

  const handleSelectTab = (tab: NativeTab) => {
    if (tab.id === 'settings') {
      setSettingsMenuVisible(true);
      return;
    }

    setSelectedTab(tab.id);
    setContentMode(tab.id);
    setWebFallbackPath(null);
  };

  const openNativeSettings = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('settings');
    setWebFallbackPath(null);
  };

  const openAboutHhs = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('aboutHhs');
    setWebFallbackPath(null);
  };

  const openFeedback = () => {
    setSettingsMenuVisible(false);
    setSelectedTab('settings');
    setContentMode('settings');
    setWebFallbackPath('/feedback');
  };

  return (
    <>
      {/*
        The native tab foundation is intentionally opt-in behind
        EXPO_PUBLIC_HHS_NATIVE_BEER_SCREEN=1. Native Calendar, Your Beer, and
        Settings are first-class native routes here; Wall and Rankings remain WebView
        fallbacks until their native data/side-effect parity is implemented.
      */}
      <View style={styles.shell}>
        <View style={styles.content} key={`${selectedRoute.id}:${activeWebPath ?? 'native'}`}>
          {showingCalendar ? (
            <NativeBeerScreen mode="calendar" onOpenWebFallback={(path) => setWebFallbackPath(path ?? '/beers')} />
          ) : showingYourBeer ? (
            <NativeBeerScreen mode="yourBeer" onOpenWebFallback={(path) => setWebFallbackPath(path ?? '/beers')} />
          ) : contentMode === 'settings' && !webFallbackPath ? (
            <NativeAccountSettingsScreen onOpenWebFallback={(path) => setWebFallbackPath(path ?? '/')} />
          ) : contentMode === 'aboutHhs' && !webFallbackPath ? (
            <NativeAboutHhsScreen />
          ) : (
            fallback(activeWebPath)
          )}
        </View>
        <View style={styles.tabBar}>
          {NATIVE_TABS.map((tab) => {
            const active = tab.id === selectedTab && !webFallbackPath;
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
                <Text style={[styles.tabText, tab.center && styles.centerTabText, active && styles.tabTextActive]}>
                  {tab.label}
                </Text>
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
                <View style={styles.menuSheet}>
                  <View style={styles.menuHandle} />
                  <Text style={styles.menuKicker}>Hallowed Hop Society</Text>
                  <Text style={styles.menuTitle}>The Settings</Text>
                  <Text style={styles.menuBody}>Choose a Society action.</Text>

                  <TouchableOpacity style={styles.menuItem} onPress={openNativeSettings} activeOpacity={0.78}>
                    <Text style={styles.menuItemText}>Sign-in / out</Text>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={openNativeSettings} activeOpacity={0.78}>
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

                  {user?.email ? <Text style={styles.menuFooter}>{user.email}</Text> : null}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </View>
    </>
  );
}

function NativeAboutHhsScreen() {
  return (
    <View style={styles.aboutScreen}>
      <View style={styles.aboutCard}>
        <Text style={styles.aboutKicker}>About HHS</Text>
        <Text style={styles.aboutTitle}>The Society of the Sip</Text>
        <Text style={styles.aboutBody}>
          Hallowed Hop Society is an annual October ritual: 31 unique beers in 31 haunted days.
          Through ritual we pour, through hops we unite.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
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
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  centerTabButton: {
    marginTop: -28,
    paddingTop: 0,
  },
  tabButtonActive: {
    borderColor: 'rgba(217, 124, 43, 0.45)',
    backgroundColor: HHS_COLORS.goldDim,
  },
  tabText: {
    ...HHS_TYPOGRAPHY.body,
    color: HHS_COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  centerTabText: {
    color: HHS_COLORS.text,
    marginTop: 3,
  },
  logoCircle: {
    alignItems: 'center',
    backgroundColor: '#08070d',
    borderColor: 'rgba(217, 124, 43, 0.58)',
    borderRadius: 36,
    borderWidth: 2,
    height: 66,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    width: 66,
  },
  logoCircleActive: {
    borderColor: HHS_COLORS.gold,
    backgroundColor: HHS_COLORS.card,
  },
  logoImage: {
    height: 96,
    width: 96,
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

