import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { USE_NATIVE_BEER_SCREEN } from '../config/env';
import { AuthProvider } from '../features/auth/AuthProvider';
import { NativeBeerScreen } from '../features/beers/NativeBeerScreen';
import { NativeAccountSettingsScreen } from '../features/settings/NativeAccountSettingsScreen';

type NativeTabId = 'calendar' | 'wall' | 'yourBeer' | 'rankings' | 'settings';

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
  const [selectedTab, setSelectedTab] = useState<NativeTabId>('yourBeer');
  const [webFallbackPath, setWebFallbackPath] = useState<string | null>(null);

  if (!USE_NATIVE_BEER_SCREEN) {
    return <AuthProvider>{fallback()}</AuthProvider>;
  }

  const selectedRoute = NATIVE_TABS.find((tab) => tab.id === selectedTab) ?? NATIVE_TABS[0];
  const activeWebPath = webFallbackPath ?? selectedRoute.webPath;
  const showingCalendar = selectedRoute.id === 'calendar' && !webFallbackPath;
  const showingYourBeer = selectedRoute.id === 'yourBeer' && !webFallbackPath;

  const handleSelectTab = (tab: NativeTab) => {
    setSelectedTab(tab.id);
    setWebFallbackPath(null);
  };

  return (
    <AuthProvider>
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
          ) : selectedRoute.id === 'settings' && !webFallbackPath ? (
            <NativeAccountSettingsScreen onOpenWebFallback={(path) => setWebFallbackPath(path ?? '/')} />
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
                    <Image source={HHS_LOGO} style={styles.logoImage} resizeMode="cover" />
                  </View>
                ) : null}
                <Text style={[styles.tabText, tab.center && styles.centerTabText, active && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#191726',
    flex: 1,
  },
  content: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: '#201d30',
    borderTopColor: 'rgba(217, 124, 43, 0.18)',
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
    borderRadius: 999,
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
    backgroundColor: 'rgba(217, 124, 43, 0.12)',
  },
  tabText: {
    color: '#a69d8d',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  centerTabText: {
    color: '#d9d8d2',
    marginTop: 3,
  },
  logoCircle: {
    alignItems: 'center',
    backgroundColor: '#191726',
    borderColor: 'rgba(217, 124, 43, 0.58)',
    borderRadius: 34,
    borderWidth: 2,
    height: 62,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    width: 62,
  },
  logoCircleActive: {
    borderColor: '#d97c2b',
    backgroundColor: '#201d30',
  },
  logoImage: {
    borderRadius: 29,
    height: 56,
    width: 56,
  },
  tabTextActive: {
    color: '#d97c2b',
  },
});

