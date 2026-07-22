import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Linking,
  Image,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';

const COLORS = {
  background: '#1a0a00',
  surface: '#2d1a00',
  accent: '#d4870a',
  accentLight: '#f0a832',
  text: '#f5e6c8',
  textMuted: '#a07840',
  tabBar: '#0f0600',
  tabBarBorder: '#3d2200',
};

// ─── Home Screen ────────────────────────────────────────────────────────────
function HomeScreen() {
  const openWebsite = () => {
    Linking.openURL('https://hallowedhopsociety.com');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.homeContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header / Branding */}
        <View style={styles.heroSection}>
          <View style={styles.emblemContainer}>
            <Text style={styles.emblemIcon}>🍺</Text>
          </View>
          <Text style={styles.brandTitle}>HALLOWED HOP</Text>
          <Text style={styles.brandSubtitle}>SOCIETY</Text>
          <View style={styles.divider} />
          <Text style={styles.tagline}>Curating the craft. Celebrating the pour.</Text>
        </View>

        {/* Welcome Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome, Fellow Hop Head</Text>
          <Text style={styles.cardBody}>
            Hallowed Hop Society is your guide to the best craft breweries,
            taprooms, and beer experiences. Discover hidden gems, track your
            favorites, and join a community of passionate beer lovers.
          </Text>
        </View>

        {/* Action Button */}
        <TouchableOpacity style={styles.primaryButton} onPress={openWebsite} activeOpacity={0.8}>
          <Text style={styles.primaryButtonText}>🗺  View Breweries</Text>
        </TouchableOpacity>

        {/* Feature Cards */}
        <View style={styles.featureGrid}>
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>🏆</Text>
            <Text style={styles.featureTitle}>Top Picks</Text>
            <Text style={styles.featureDesc}>Editor-curated brewery selections</Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>📍</Text>
            <Text style={styles.featureTitle}>Nearby</Text>
            <Text style={styles.featureDesc}>Find breweries close to you</Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>⭐</Text>
            <Text style={styles.featureTitle}>Reviews</Text>
            <Text style={styles.featureDesc}>Community ratings & tasting notes</Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureIcon}>🎉</Text>
            <Text style={styles.featureTitle}>Events</Text>
            <Text style={styles.featureDesc}>Tap takeovers & beer fests</Text>
          </View>
        </View>

        <Text style={styles.footer}>© 2024 Hallowed Hop Society</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Breweries Screen ────────────────────────────────────────────────────────
function BreweriesScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="light" />
      <View style={styles.webviewHeader}>
        <Text style={styles.webviewHeaderTitle}>🍻  Breweries</Text>
      </View>
      <WebView
        source={{ uri: 'https://hallowedhopsociety.com' }}
        style={styles.webview}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading Breweries…</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

// ─── Tab Navigator ───────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: COLORS.accent,
          tabBarInactiveTintColor: COLORS.textMuted,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: 'Home',
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 20, color }}>🏠</Text>
            ),
          }}
        />
        <Tab.Screen
          name="Breweries"
          component={BreweriesScreen}
          options={{
            tabBarLabel: 'Breweries',
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 20, color }}>🍺</Text>
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  homeContent: {
    paddingBottom: 40,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 32,
    paddingHorizontal: 24,
  },
  emblemContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.surface,
    borderWidth: 3,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  emblemIcon: {
    fontSize: 48,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: COLORS.accent,
    letterSpacing: 6,
    textAlign: 'center',
  },
  brandSubtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.accentLight,
    letterSpacing: 10,
    textAlign: 'center',
    marginTop: 2,
  },
  divider: {
    width: 80,
    height: 2,
    backgroundColor: COLORS.accent,
    marginVertical: 16,
    borderRadius: 1,
  },
  tagline: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    letterSpacing: 0.5,
  },

  // Card
  card: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.tabBarBorder,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
  },
  cardBody: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 22,
  },

  // Primary Button
  primaryButton: {
    backgroundColor: COLORS.accent,
    marginHorizontal: 20,
    marginBottom: 28,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  primaryButtonText: {
    color: '#1a0a00',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Feature Grid
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    marginBottom: 24,
  },
  featureCard: {
    width: '46%',
    backgroundColor: COLORS.surface,
    margin: '2%',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.tabBarBorder,
  },
  featureIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },

  footer: {
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 8,
  },

  // Tab Bar
  tabBar: {
    backgroundColor: COLORS.tabBar,
    borderTopColor: COLORS.tabBarBorder,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },

  // WebView
  webviewHeader: {
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.tabBarBorder,
  },
  webviewHeaderTitle: {
    color: COLORS.accent,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  webview: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 16,
  },
});
