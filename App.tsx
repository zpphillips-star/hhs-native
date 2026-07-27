import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

const HHS_ORIGIN = 'https://hallowedhopsociety.com';
const HOME_URL = `${HHS_ORIGIN}/`;
const HHS_HOSTS = new Set(['hallowedhopsociety.com', 'www.hallowedhopsociety.com']);
const FIRST_LOGIN_STORAGE_PREFIX = '@hhs:first-login';
const VENMO_HANDLE = 'zpphillips';
const APP_VERSION = 'HHS v1.0.3 (4)';

const COLORS = {
  background: '#191726',
  card: '#201d30',
  cardAlt: '#28233a',
  text: '#d9d8d2',
  muted: '#a69d8d',
  gold: '#d97c2b',
  goldDark: '#9f561c',
  border: 'rgba(217, 124, 43, 0.18)',
  borderStrong: 'rgba(217, 124, 43, 0.45)',
};

type LoggedInUser = {
  id?: string;
  email: string;
  name: string;
};

type MembershipPackage = {
  id: 'hallowed' | 'oddballs';
  title: string;
  details: string;
  beerCount: number;
  amount: number;
};

type FirstLoginStep = 'notifications' | 'membership' | 'payment' | 'welcome';

type NativeBridgeMessage = {
  type?: string;
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
  };
};

type FirstLoginRecord = {
  source: 'hhs-native';
  name: string;
  email: string;
  userId?: string;
  selectedBeerPackage: string;
  selectedBeerPackageId: MembershipPackage['id'];
  selectedBeerCount: number;
  selectedAmount: number;
  clickedVenmoPayment: boolean;
  clickedVenmoPaymentAt: string | null;
  eventName: 'membership_selected' | 'venmo_clicked';
  paymentStatusNote: string;
  updatedAt: string;
};

const MEMBERSHIP_PACKAGES: MembershipPackage[] = [
  {
    id: 'hallowed',
    title: 'The Hallowed',
    details: '31 beers',
    beerCount: 31,
    amount: 150,
  },
  {
    id: 'oddballs',
    title: 'The Oddballs',
    details: '16 beers — consume on the odd days of the month',
    beerCount: 16,
    amount: 100,
  },
];

const injectedJavaScriptBeforeContentLoaded = `
  (function () {
    try {
      // Mark this context as the HHS native app — unconditionally, so the web app
      // can check window.__HHS_NATIVE_APP__ before ReactNativeWebView is bridged.
      window.__HHS_NATIVE_APP__ = true;
      var meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      if (!meta.parentNode) document.head.appendChild(meta);
    } catch (error) {
      console.warn('[HHS native] viewport/native flag setup failed', error);
    }
  })();
  true;
`;

const hhsNativeBridgeJavaScript = `
  (function () {
    // Extended pattern: also covers "Add to Home Screen" heading and "add this app to your Home Screen"
    var installPromptPattern = /(download|add\\s+to\\s+(your\\s+)?phone|add\\s+to\\s+(your\\s+)?home\\s+screen|save\\s+to\\s+home\\s+screen|install\\s+(the\\s+)?app|getting\\s+started|setup\\s+required|enable\\s+notifications)/i;

    function ensureNativeStyles() {
      var styleId = 'hhs-native-hide-web-onboarding';
      if (document.getElementById(styleId)) return;
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = '[data-hhs-native-hidden="true"]{display:none!important;visibility:hidden!important;}';
      document.head.appendChild(style);
    }

    function hideWebInstallPrompts() {
      ensureNativeStyles();
      var nodes = Array.prototype.slice.call(document.querySelectorAll('a,button,section,article,aside,div,[role="dialog"]'));
      nodes.forEach(function (node) {
        if (!node || node === document.body || node === document.documentElement) return;
        var text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text && text.length < 700 && installPromptPattern.test(text)) {
          node.setAttribute('data-hhs-native-hidden', 'true');
        }
      });
    }

    function normalizeUser(rawUser) {
      if (!rawUser || !rawUser.email) return null;
      var metadata = rawUser.user_metadata || rawUser.raw_user_meta_data || {};
      var name = rawUser.name || metadata.full_name || metadata.name || rawUser.email;
      return {
        id: rawUser.id || rawUser.sub || rawUser.user_id,
        email: String(rawUser.email),
        name: String(name || rawUser.email)
      };
    }

    function userFromSupabaseStorage() {
      for (var index = 0; index < localStorage.length; index += 1) {
        var key = localStorage.key(index) || '';
        if (!/^sb-.+-auth-token$/.test(key)) continue;
        var parsed = JSON.parse(localStorage.getItem(key) || '{}');
        var session = parsed.currentSession || parsed.session || parsed;
        var user = normalizeUser(session.user || parsed.user);
        if (user) return user;
      }
      return null;
    }

    function userFromDom() {
      var emailNode = document.querySelector('[data-user-email], [data-email]');
      var rawEmail = emailNode && (emailNode.getAttribute('data-user-email') || emailNode.getAttribute('data-email') || emailNode.textContent);
      if (!rawEmail || rawEmail.indexOf('@') === -1) return null;
      var nameNode = document.querySelector('[data-user-name], [data-name]');
      return {
        email: String(rawEmail).trim(),
        name: String((nameNode && (nameNode.getAttribute('data-user-name') || nameNode.getAttribute('data-name') || nameNode.textContent)) || rawEmail).trim()
      };
    }

    function postLoggedInUser() {
      try {
        var user = userFromSupabaseStorage() || userFromDom();
        if (!user || !window.ReactNativeWebView) return;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HHS_AUTH_USER', user: user }));
      } catch (error) {
        console.warn('[HHS native] logged-in user detection failed', error);
      }
    }

    try {
      window.__HHS_NATIVE_APP__ = true;
      // Persist the native-app flag in localStorage so the web app can also check
      // it synchronously before any async auth/Supabase calls complete.
      try { localStorage.setItem('__hhs_native_app__', '1'); } catch (_) {}
      hideWebInstallPrompts();
      postLoggedInUser();
      if (!window.__HHS_NATIVE_BRIDGE_INSTALLED__) {
        window.__HHS_NATIVE_BRIDGE_INSTALLED__ = true;
        var attempts = 0;
        var intervalId = window.setInterval(function () {
          attempts += 1;
          hideWebInstallPrompts();
          postLoggedInUser();
          if (attempts >= 30) window.clearInterval(intervalId);
        }, 2000);
        var observer = new MutationObserver(function () {
          hideWebInstallPrompts();
          postLoggedInUser();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch (error) {
      console.warn('[HHS native] bridge setup failed', error);
    }
  })();
  true;
`;

function isInternalUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && HHS_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getUserStorageKey(user: LoggedInUser) {
  return `${FIRST_LOGIN_STORAGE_PREFIX}:${(user.id || user.email).toLowerCase()}`;
}

function sanitizeBridgeUser(message: NativeBridgeMessage): LoggedInUser | null {
  const rawUser = message.user;
  if (!rawUser || typeof rawUser.email !== 'string' || !rawUser.email.includes('@')) {
    return null;
  }

  const email = rawUser.email.trim();
  const rawName = typeof rawUser.name === 'string' ? rawUser.name.trim() : '';
  const rawId = typeof rawUser.id === 'string' ? rawUser.id.trim() : undefined;

  return {
    id: rawId || undefined,
    email,
    name: rawName || email,
  };
}

function buildVenmoUrl(membership: MembershipPackage) {
  const note = encodeURIComponent(`Hallowed Hop Society - ${membership.title}`);
  return `venmo://paycharge?txn=pay&recipients=${VENMO_HANDLE}&amount=${membership.amount}&note=${note}`;
}

function buildVenmoFallbackUrl(membership: MembershipPackage) {
  const note = encodeURIComponent(`Hallowed Hop Society - ${membership.title}`);
  return `https://venmo.com/${VENMO_HANDLE}?txn=pay&amount=${membership.amount}&note=${note}`;
}

function buildAdminRecordJavaScript(record: FirstLoginRecord) {
  const serializedRecord = JSON.stringify(record).replace(/</g, '\\u003c');

  return `
    (function () {
      try {
        var record = ${serializedRecord};
        var userKey = String(record.userId || record.email).toLowerCase();
        var storageKey = 'hhs_native_first_login:' + userKey;
        window.__HHS_NATIVE_FIRST_LOGIN_RECORD__ = record;
        localStorage.setItem(storageKey, JSON.stringify(record));
        localStorage.setItem('hhs_native_first_login_latest', JSON.stringify(record));
        window.dispatchEvent(new CustomEvent('hhs:native-first-login', { detail: record }));
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HHS_MOBILE_FLOW_RECORD_STORED', storageKey: storageKey }));
        }

        // POST to /api/native-membership so admin console can see the selection
        // immediately in Supabase — no manual admin action required.
        try {
          var payload = {
            user_id: record.userId || undefined,
            email: record.email,
            name: record.name,
            tier: record.selectedBeerPackageId,
            tier_selected_at: record.eventName === 'membership_selected' ? record.updatedAt : undefined,
            venmo_clicked: record.clickedVenmoPayment,
            venmo_clicked_at: record.clickedVenmoPaymentAt || undefined,
            selected_amount: record.selectedAmount,
            source: record.source,
          };
          fetch('/api/native-membership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).then(function(res) {
            if (!res.ok) {
              res.text().then(function(t) {
                console.warn('[HHS native] native-membership API error:', res.status, t);
              });
            }
          }).catch(function(err) {
            console.warn('[HHS native] native-membership fetch failed:', err);
          });
        } catch (fetchError) {
          console.warn('[HHS native] native-membership fetch setup failed:', fetchError);
        }
      } catch (error) {
        console.warn('[HHS native] first-login record bridge failed', error);
      }
    })();
    true;
  `;
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const checkedUserKeyRef = useRef<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<LoggedInUser | null>(null);
  const [firstLoginVisible, setFirstLoginVisible] = useState(false);
  const [firstLoginStep, setFirstLoginStep] = useState<FirstLoginStep>('notifications');
  const [selectedMembership, setSelectedMembership] = useState<MembershipPackage | null>(null);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);
  const [isOpeningVenmo, setIsOpeningVenmo] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (firstLoginVisible) {
        return true;
      }

      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [canGoBack, firstLoginVisible]);

  const prepareFirstLoginFlow = useCallback(async (user: LoggedInUser) => {
    const userStorageKey = getUserStorageKey(user);
    if (checkedUserKeyRef.current === userStorageKey) return;
    checkedUserKeyRef.current = userStorageKey;

    try {
      const completed = await AsyncStorage.getItem(`${userStorageKey}:completed`);
      if (completed === 'true') {
        setFirstLoginVisible(false);
        return;
      }

      setFlowMessage(null);
      setSelectedMembership(null);
      setFirstLoginStep('notifications');
      setFirstLoginVisible(true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown storage error';
      setFlowMessage(`We could not confirm your first-login status on this device (${detail}). You can continue.`);
      setSelectedMembership(null);
      setFirstLoginStep('notifications');
      setFirstLoginVisible(true);
    }
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
  }, []);

  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    const { url } = request;

    if (
      url === 'about:blank' ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      isInternalUrl(url)
    ) {
      return true;
    }

    Linking.openURL(url).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Unknown link error';
      setFlowMessage(`We could not open that external link (${detail}).`);
    });
    return false;
  }, []);

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { data } = event.nativeEvent;
      if (!data || data[0] !== '{') return;

      try {
        const message = JSON.parse(data) as NativeBridgeMessage;
        if (message.type !== 'HHS_AUTH_USER') return;

        const user = sanitizeBridgeUser(message);
        if (!user) return;

        setLoggedInUser((currentUser) => {
          if (currentUser?.email === user.email && currentUser?.id === user.id) return currentUser;
          return user;
        });
        void prepareFirstLoginFlow(user);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown bridge message error';
        setFlowMessage(`The mobile app could not read a page message (${detail}).`);
      }
    },
    [prepareFirstLoginFlow],
  );

  const retry = useCallback(() => {
    setLoadFailed(false);
    webViewRef.current?.reload();
  }, []);

  const recordFirstLoginEvent = useCallback(
    async (
      membership: MembershipPackage,
      clickedVenmoPayment: boolean,
      eventName: FirstLoginRecord['eventName'],
    ) => {
      if (!loggedInUser) {
        setFlowMessage('Sign in before choosing a Society membership.');
        return;
      }

      const now = new Date().toISOString();
      const record: FirstLoginRecord = {
        source: 'hhs-native',
        name: loggedInUser.name,
        email: loggedInUser.email,
        userId: loggedInUser.id,
        selectedBeerPackage: membership.title,
        selectedBeerPackageId: membership.id,
        selectedBeerCount: membership.beerCount,
        selectedAmount: membership.amount,
        clickedVenmoPayment,
        clickedVenmoPaymentAt: clickedVenmoPayment ? now : null,
        eventName,
        paymentStatusNote:
          'Venmo click-through is tracked by the native app; it is not payment confirmation without a Venmo callback/API.',
        updatedAt: now,
      };

      const userStorageKey = getUserStorageKey(loggedInUser);
      try {
        await AsyncStorage.multiSet([
          [`${userStorageKey}:record`, JSON.stringify(record)],
          [`${FIRST_LOGIN_STORAGE_PREFIX}:latest-record`, JSON.stringify(record)],
        ]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown storage error';
        setFlowMessage(`We could not save the first-login record on this device (${detail}).`);
      }

      webViewRef.current?.injectJavaScript(buildAdminRecordJavaScript(record));
    },
    [loggedInUser],
  );

  const handleRequestPushPermission = useCallback(async () => {
    setIsRequestingNotifications(true);
    setFlowMessage(null);

    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('hhs-updates', {
          name: 'Hallowed Hop Society updates',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const existingPermission = await Notifications.getPermissionsAsync();
      const finalPermission =
        existingPermission.status === 'granted'
          ? existingPermission
          : await Notifications.requestPermissionsAsync();

      if (finalPermission.status === 'granted') {
        setFlowMessage('Notifications are enabled. Welcome to the inner circle.');
      } else {
        setFlowMessage('Notifications are not enabled. You can still continue and change this later in system settings.');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown notification permission error';
      setFlowMessage(`The notification prompt could not be completed (${detail}). You can still continue.`);
    } finally {
      setIsRequestingNotifications(false);
      setFirstLoginStep('membership');
    }
  }, []);

  const handleSelectMembership = useCallback(
    (membership: MembershipPackage) => {
      setSelectedMembership(membership);
      setFirstLoginStep('payment');
      setFlowMessage(null);
      void recordFirstLoginEvent(membership, false, 'membership_selected');
    },
    [recordFirstLoginEvent],
  );

  const handleOpenVenmo = useCallback(async () => {
    if (!selectedMembership || !loggedInUser) return;

    setIsOpeningVenmo(true);
    setFlowMessage(null);

    await recordFirstLoginEvent(selectedMembership, true, 'venmo_clicked');

    try {
      await AsyncStorage.setItem(`${getUserStorageKey(loggedInUser)}:completed`, 'true');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown storage error';
      setFlowMessage(`We could not mark first-login complete on this device (${detail}).`);
    }

    try {
      await Linking.openURL(buildVenmoUrl(selectedMembership));
    } catch (primaryError) {
      try {
        await Linking.openURL(buildVenmoFallbackUrl(selectedMembership));
      } catch (fallbackError) {
        const primaryDetail = primaryError instanceof Error ? primaryError.message : 'Unknown Venmo app error';
        const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : 'Unknown Venmo web error';
        setFlowMessage(`We recorded your Venmo click, but could not open Venmo (${primaryDetail}; ${fallbackDetail}).`);
      }
    } finally {
      setIsOpeningVenmo(false);
      setFirstLoginStep('welcome');
    }
  }, [loggedInUser, recordFirstLoginEvent, selectedMembership]);

  const finishFirstLogin = useCallback(() => {
    setFirstLoginVisible(false);
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor={COLORS.background} />
        <WebView
          ref={webViewRef}
          source={{ uri: HOME_URL }}
          style={styles.webView}
          containerStyle={styles.webViewContainer}
          originWhitelist={['https://*', 'mailto:*', 'tel:*', 'venmo:*']}
          injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
          injectedJavaScript={hhsNativeBridgeJavaScript}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          geolocationEnabled
          pullToRefreshEnabled
          startInLoadingState
          onNavigationStateChange={handleNavigationStateChange}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onMessage={handleWebViewMessage}
          onLoadEnd={() => webViewRef.current?.injectJavaScript(hhsNativeBridgeJavaScript)}
          onLoadStart={() => setLoadFailed(false)}
          onError={() => setLoadFailed(true)}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 500) setLoadFailed(true);
          }}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={COLORS.gold} size="large" />
              <Text style={styles.loadingText}>Summoning the Society…</Text>
            </View>
          )}
        />

        {loadFailed && (
          <View style={styles.errorOverlay}>
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Hallowed Hop Society</Text>
              <Text style={styles.errorBody}>
                The Society could not be reached. Check your connection and try again.
              </Text>
              <TouchableOpacity style={styles.retryButton} onPress={retry} activeOpacity={0.85}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {firstLoginVisible && loggedInUser && (
          <View style={styles.flowOverlay}>
            <ScrollView contentContainerStyle={styles.flowScroll}>
              <View style={styles.flowCard}>
                <Text style={styles.kicker}>Hallowed Hop Society</Text>
                <Text style={styles.flowTitle}>Welcome, {loggedInUser.name}</Text>
                <Text style={styles.flowBody}>
                  A quick native-app setup replaces the old web install prompts and gets your Society
                  membership ready.
                </Text>

                {flowMessage && <Text style={styles.flowMessage}>{flowMessage}</Text>}

                {firstLoginStep === 'notifications' && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.stepTitle}>Step 1: Allow push notifications</Text>
                    <Text style={styles.flowBody}>
                      Enable Society reminders, release updates, and membership notices. If you deny the
                      prompt, you can still continue.
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryButton, isRequestingNotifications && styles.disabledButton]}
                      onPress={handleRequestPushPermission}
                      disabled={isRequestingNotifications}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.primaryButtonText}>
                        {isRequestingNotifications ? 'Opening Prompt…' : 'Allow Notifications'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {firstLoginStep === 'membership' && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.stepTitle}>Step 2: Choose your membership</Text>
                    {MEMBERSHIP_PACKAGES.map((membership) => (
                      <TouchableOpacity
                        key={membership.id}
                        style={styles.packageCard}
                        onPress={() => handleSelectMembership(membership)}
                        activeOpacity={0.88}
                      >
                        <View style={styles.packageHeader}>
                          <Text style={styles.packageTitle}>{membership.title}</Text>
                          <Text style={styles.packageAmount}>${membership.amount}</Text>
                        </View>
                        <Text style={styles.packageDetails}>{membership.details}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {firstLoginStep === 'payment' && selectedMembership && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.stepTitle}>Pay with Venmo</Text>
                    <View style={styles.paymentSummary}>
                      <Text style={styles.packageTitle}>{selectedMembership.title}</Text>
                      <Text style={styles.packageDetails}>{selectedMembership.details}</Text>
                      <Text style={styles.paymentAmount}>${selectedMembership.amount}</Text>
                    </View>
                    <Text style={styles.flowBody}>
                      Tap below to open Venmo and pay @{VENMO_HANDLE}. The app records only that you
                      clicked to pay; this is not payment confirmation.
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryButton, isOpeningVenmo && styles.disabledButton]}
                      onPress={handleOpenVenmo}
                      disabled={isOpeningVenmo}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.primaryButtonText}>
                        {isOpeningVenmo ? 'Opening Venmo…' : `Pay $${selectedMembership.amount} on Venmo`}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => setFirstLoginStep('membership')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.secondaryButtonText}>Choose a Different Membership</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {firstLoginStep === 'welcome' && (
                  <View style={styles.stepContainer}>
                    <Text style={styles.stepTitle}>Welcome to the Hallowed Hop Society</Text>
                    <Text style={styles.flowBody}>
                      Your membership choice and Venmo click-through have been recorded for the mobile
                      app. A Society admin still needs actual Venmo payment confirmation.
                    </Text>
                    <TouchableOpacity style={styles.primaryButton} onPress={finishFirstLogin} activeOpacity={0.85}>
                      <Text style={styles.primaryButtonText}>Enter the Society</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <Text style={styles.versionLabel}>{APP_VERSION}</Text>
              </View>
            </ScrollView>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  webView: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: COLORS.background,
  },
  loadingText: {
    color: COLORS.text,
    fontSize: 17,
    letterSpacing: 0.8,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: COLORS.background,
  },
  errorCard: {
    width: '100%',
    maxWidth: 420,
    padding: 24,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  errorTitle: {
    color: COLORS.gold,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  errorBody: {
    color: COLORS.text,
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  retryButtonText: {
    color: COLORS.background,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  flowOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
  },
  flowScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  flowCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    padding: 24,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    gap: 14,
  },
  kicker: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.7,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  flowTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  flowBody: {
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  flowMessage: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardAlt,
    textAlign: 'center',
  },
  stepContainer: {
    gap: 16,
    marginTop: 8,
  },
  stepTitle: {
    color: COLORS.gold,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: COLORS.gold,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: COLORS.background,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  disabledButton: {
    opacity: 0.65,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  packageCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.cardAlt,
    gap: 8,
  },
  packageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  packageTitle: {
    flex: 1,
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '800',
  },
  packageAmount: {
    color: COLORS.gold,
    fontSize: 20,
    fontWeight: '900',
  },
  packageDetails: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 21,
  },
  paymentSummary: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardAlt,
    gap: 6,
  },
  paymentAmount: {
    color: COLORS.gold,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'right',
  },
  versionLabel: {
    color: COLORS.muted,
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 0.5,
    opacity: 0.6,
    marginTop: 4,
  },
});
