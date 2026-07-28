import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { USE_NATIVE_BEER_SCREEN } from '../config/env';
import { AuthProvider } from '../features/auth/AuthProvider';
import { NativeBeerScreen } from '../features/beers/NativeBeerScreen';
import { NativeAccountSettingsScreen } from '../features/settings/NativeAccountSettingsScreen';

type NativeTabId = 'beer' | 'wall' | 'rankings' | 'feedback' | 'menu';

type NativeTab = {
  id: NativeTabId;
  label: string;
  webPath?: string;
};

const NATIVE_TABS: readonly NativeTab[] = [
  { id: 'beer', label: 'Beer' },
  { id: 'wall', label: 'Wall', webPath: '/wall' },
  { id: 'rankings', label: 'Rankings', webPath: '/leaderboard' },
  { id: 'feedback', label: 'Feedback', webPath: '/feedback' },
  { id: 'menu', label: 'Menu' },
] as const;

type NativeAppShellProps = {
  fallback: (initialPath?: string) => React.ReactNode;
};

export function NativeAppShell({ fallback }: NativeAppShellProps) {
  const [selectedTab, setSelectedTab] = useState<NativeTabId>('beer');
  const [webFallbackPath, setWebFallbackPath] = useState<string | null>(null);

  if (!USE_NATIVE_BEER_SCREEN) {
    return <AuthProvider>{fallback()}</AuthProvider>;
  }

  const selectedRoute = NATIVE_TABS.find((tab) => tab.id === selectedTab) ?? NATIVE_TABS[0];
  const activeWebPath = webFallbackPath ?? selectedRoute.webPath;
  const showingNativeBeer = selectedRoute.id === 'beer' && !webFallbackPath;

  const handleSelectTab = (tab: NativeTab) => {
    setSelectedTab(tab.id);
    setWebFallbackPath(null);
  };

  return (
    <AuthProvider>
      {/*
        The native tab foundation is intentionally opt-in behind
        EXPO_PUBLIC_HHS_NATIVE_BEER_SCREEN=1. Native Beer is the only first-class
        native routes here; Wall, Rankings, and Feedback remain WebView
        fallbacks until their native data/side-effect parity is implemented.
      */}
      <View style={styles.shell}>
        <View style={styles.content} key={`${selectedRoute.id}:${activeWebPath ?? 'native'}`}>
          {showingNativeBeer ? (
            <NativeBeerScreen onOpenWebFallback={() => setWebFallbackPath('/beers')} />
          ) : selectedRoute.id === 'menu' && !webFallbackPath ? (
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
                style={[styles.tabButton, active && styles.tabButtonActive]}
                onPress={() => handleSelectTab(tab)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
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
    paddingBottom: 10,
    paddingHorizontal: 8,
    paddingTop: 8,
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
  tabButtonActive: {
    borderColor: 'rgba(217, 124, 43, 0.45)',
    backgroundColor: 'rgba(217, 124, 43, 0.12)',
  },
  tabText: {
    color: '#a69d8d',
    fontSize: 11,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#d97c2b',
  },
});

