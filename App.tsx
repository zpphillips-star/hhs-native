import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { useAuth } from './src/features/auth/AuthProvider';
import { NativeAppShell } from './src/navigation/NativeAppShell';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from './src/theme/hhsTheme';

const HHS_ORIGIN = 'https://hallowedhopsociety.com';
const HOME_URL = `${HHS_ORIGIN}/`;
const BEER_URL = `${HHS_ORIGIN}/beers`;
const HHS_HOSTS = new Set(['hallowedhopsociety.com', 'www.hallowedhopsociety.com']);
const NATIVE_FALLBACK_PATHS = new Set(['/wall', '/leaderboard']);
const FIRST_LOGIN_STORAGE_PREFIX = '@hhs:first-login';
const NOTIF_PREFS_STORAGE_PREFIX = '@hhs:notif-prefs';
const PUSH_TOKEN_STORAGE_PREFIX = '@hhs:push-token';
const VENMO_HANDLE = 'zpphillips';

const COLORS = HHS_COLORS;

// ── Notification preference keys & defaults ────────────────────────────────
type NotifPrefs = {
  daily_beer: boolean;
  social_all: boolean;
  social_new_comment: boolean;
  social_new_reaction: boolean;
  social_reaction_to_your_items: boolean;
  social_comment_on_your_items: boolean;
};

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  daily_beer: true,
  social_all: true,
  social_new_comment: true,
  social_new_reaction: true,
  social_reaction_to_your_items: true,
  social_comment_on_your_items: true,
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

type FirstLoginStep = 'notifications' | 'membership' | 'payment';

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

function getInitialWebUrl(initialPath?: string) {
  if (!initialPath) {
    const url = new URL(HOME_URL);
    url.searchParams.set('hhs_app', '1');
    return url.toString();
  }
  if (!initialPath.startsWith('/')) {
    const url = new URL(HOME_URL);
    url.searchParams.set('hhs_app', '1');
    return url.toString();
  }

  const url = new URL(initialPath, HHS_ORIGIN);
  url.searchParams.set('hhs_app', '1');
  if (NATIVE_FALLBACK_PATHS.has(url.pathname.replace(/\/$/, ''))) {
    url.searchParams.set('hhs_native_fallback', '1');
  }
  return url.toString();
}

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

    function isNativeAppModePage() {
      try {
        var params = new URLSearchParams(window.location.search);
        return params.get('hhs_app') === '1' ||
          params.get('hhs_native_fallback') === '1' ||
          window.__HHS_NATIVE_APP__ === true ||
          localStorage.getItem('__hhs_native_app__') === '1';
      } catch (_) {
        return false;
      }
    }

    function hideNativeFallbackChrome() {
      if (!isNativeAppModePage()) return;
      var styleId = 'hhs-native-fallback-hide-chrome';
      if (!document.getElementById(styleId)) {
        var style = document.createElement('style');
        style.id = styleId;
        style.textContent = 'nav,[data-hhs-web-nav="true"],[data-hhs-native-hidden="true"]{display:none!important;visibility:hidden!important;}body{overscroll-behavior:none;}';
        document.head.appendChild(style);
      }
      document.documentElement.setAttribute('data-hhs-native-fallback', 'true');
      try {
        sessionStorage.setItem('__hhs_native_fallback__', '1');
      } catch (_) {}
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

    // ── Hamburger injection fallback ─────────────────────────────────────────
    // If the deployed web app has not yet updated its Nav (stale build),
    // the Members Only link or Sign Out button will still appear.  This
    // fallback detects that situation and replaces the auth slot with a
    // styled hamburger that posts HHS_OPEN_MENU to the native bridge.
    // It is idempotent: if the web already rendered [aria-label="Open menu"]
    // we leave it alone.
    function ensureNativeHamburger() {
      try {
        var nav = document.querySelector('nav');
        if (!nav) return;
        // Web app already rendered the hamburger — nothing to do
        if (nav.querySelector('button[aria-label="Open menu"]')) return;
        // Find the Members Only link or Sign Out button
        var authEl = null;
        var candidates = nav.querySelectorAll('a[href="/auth"], button');
        for (var ci = 0; ci < candidates.length; ci++) {
          var ctext = (candidates[ci].textContent || '').trim();
          if (ctext === 'Members Only' || ctext === 'Sign Out') {
            authEl = candidates[ci];
            break;
          }
        }
        if (!authEl || !authEl.parentNode) return;
        // Build a hamburger button that matches the HHS gold style
        var btn = document.createElement('button');
        btn.setAttribute('aria-label', 'Open menu');
        btn.style.cssText = 'display:flex;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:4px 2px;align-items:center;justify-content:center;';
        for (var bi = 0; bi < 3; bi++) {
          var bar = document.createElement('span');
          bar.style.cssText = 'display:block;width:20px;height:2px;background:var(--gold,#d97c2b);border-radius:1px;';
          btn.appendChild(bar);
        }
        btn.addEventListener('click', function () {
          try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HHS_OPEN_MENU' })); } catch (e) {}
        });
        authEl.parentNode.replaceChild(btn, authEl);
      } catch (hErr) {
        console.warn('[HHS native] hamburger injection failed', hErr);
      }
    }

    try {
      window.__HHS_NATIVE_APP__ = true;
      // Persist the native-app flag in localStorage so the web app can also check
      // it synchronously before any async auth/Supabase calls complete.
      try { localStorage.setItem('__hhs_native_app__', '1'); } catch (_) {}
      // Mark setup as done so /welcome and SetupBanner/SetupGuide never show.
      try { localStorage.setItem('hhs_setup_done', '1'); } catch (_) {}
      hideNativeFallbackChrome();
      hideWebInstallPrompts();
      postLoggedInUser();
      ensureNativeHamburger();
      if (!window.__HHS_NATIVE_BRIDGE_INSTALLED__) {
        window.__HHS_NATIVE_BRIDGE_INSTALLED__ = true;
        var attempts = 0;
        var intervalId = window.setInterval(function () {
          attempts += 1;
          hideNativeFallbackChrome();
          hideWebInstallPrompts();
          postLoggedInUser();
          ensureNativeHamburger();
          if (attempts >= 30) window.clearInterval(intervalId);
        }, 2000);
        var observer = new MutationObserver(function () {
          hideNativeFallbackChrome();
          hideWebInstallPrompts();
          postLoggedInUser();
          ensureNativeHamburger();
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

function isInternalDocumentNavigationUrl(url?: string | null) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !HHS_HOSTS.has(parsed.hostname)) return false;

    const pathname = parsed.pathname || '/';
    if (
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/api/') ||
      pathname === '/sw.js' ||
      pathname === '/manifest.json'
    ) {
      return false;
    }

    // Next/App Router subresource requests can reuse clean route paths such as
    // /wall with an RSC query. Those are not top-frame document loads and must
    // never be allowed to cover a successfully loaded screen with the native
    // full-screen retry overlay.
    if (parsed.searchParams.has('_rsc')) return false;

    // Treat clean app routes as document navigations, and ignore static asset
    // failures (images/fonts/icons/etc.) so they do not cover a loaded screen.
    const lastSegment = pathname.split('/').pop() || '';
    return !/\.[a-z0-9]{2,8}$/i.test(lastSegment);
  } catch {
    return false;
  }
}

function normalizeDocumentUrl(url?: string | null) {
  if (!isInternalDocumentNavigationUrl(url)) return null;
  try {
    const parsed = new URL(url!);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function isSameDocumentUrl(a?: string | null, b?: string | null) {
  const normalizedA = normalizeDocumentUrl(a);
  const normalizedB = normalizeDocumentUrl(b);
  return !!normalizedA && !!normalizedB && normalizedA === normalizedB;
}

function isFeedbackUrl(url: string) {
  try {
    const parsed = new URL(url);
    return HHS_HOSTS.has(parsed.hostname) && parsed.pathname.replace(/\/$/, '') === '/feedback';
  } catch {
    return false;
  }
}

function getUserStorageKey(user: LoggedInUser) {
  return `${FIRST_LOGIN_STORAGE_PREFIX}:${(user.id || user.email).toLowerCase()}`;
}

function getNotifPrefsStorageKey(user: LoggedInUser) {
  return `${NOTIF_PREFS_STORAGE_PREFIX}:${(user.id || user.email).toLowerCase()}`;
}

function getPushTokenStorageKey(user: LoggedInUser) {
  return `${PUSH_TOKEN_STORAGE_PREFIX}:${(user.id || user.email).toLowerCase()}`;
}

async function loadLocalNotifPrefs(user: LoggedInUser): Promise<NotifPrefs> {
  try {
    const raw = await AsyncStorage.getItem(getNotifPrefsStorageKey(user));
    if (raw) return { ...DEFAULT_NOTIF_PREFS, ...(JSON.parse(raw) as Partial<NotifPrefs>) };
  } catch (err) {
    console.warn('[HHS native] failed to load local notif prefs', err);
  }
  return { ...DEFAULT_NOTIF_PREFS };
}

async function saveLocalNotifPrefs(user: LoggedInUser, prefs: NotifPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(getNotifPrefsStorageKey(user), JSON.stringify(prefs));
  } catch (err) {
    console.warn('[HHS native] failed to save local notif prefs', err);
  }
}

async function syncPrefsToBackend(user: LoggedInUser, prefs: NotifPrefs): Promise<void> {
  if (!user.id) return; // need a UUID for the API
  try {
    const res = await fetch(`${HHS_ORIGIN}/api/notification-preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, email: user.email, ...prefs }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('[HHS native] prefs sync failed:', res.status, text);
    }
  } catch (err) {
    console.warn('[HHS native] prefs sync network error:', err instanceof Error ? err.message : err);
  }
}

async function fetchPrefsFromBackend(user: LoggedInUser): Promise<NotifPrefs | null> {
  if (!user.id) return null;
  try {
    const res = await fetch(`${HHS_ORIGIN}/api/notification-preferences?user_id=${encodeURIComponent(user.id)}`);
    if (!res.ok) return null;
    const json = await res.json() as { ok?: boolean; prefs?: NotifPrefs };
    if (json.ok && json.prefs) return { ...DEFAULT_NOTIF_PREFS, ...json.prefs };
  } catch (err) {
    console.warn('[HHS native] prefs fetch error:', err instanceof Error ? err.message : err);
  }
  return null;
}

async function registerAndStorePushToken(user: LoggedInUser): Promise<string | null> {
  if (!user.id) return null;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '7c415298-5d23-4f3d-b818-60a6ba5475a2',
    });
    const token = tokenData.data;
    if (!token) return null;

    // Cache locally so we can check if it was already sent
    const cacheKey = getPushTokenStorageKey(user);
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached === token) return token; // already registered this token

    const res = await fetch(`${HHS_ORIGIN}/api/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        email: user.email,
        token,
        platform: Platform.OS,
      }),
    });
    if (res.ok) {
      await AsyncStorage.setItem(cacheKey, token).catch(() => {});
    } else {
      const text = await res.text();
      console.warn('[HHS native] push token registration failed:', res.status, text);
    }
    return token;
  } catch (err) {
    // getExpoPushTokenAsync may throw on simulator/emulator — not fatal
    console.warn('[HHS native] push token registration error:', err instanceof Error ? err.message : err);
    return null;
  }
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

// FIX 1: Single-recipient Venmo deep link — NO `note` param.
// Venmo can misparse a `note` containing text as a second recipient under some
// app versions. We omit the note entirely and rely on the profile page if the
// deep link is unavailable.  Amount is preserved; single recipient guaranteed.
function buildVenmoUrl(membership: MembershipPackage) {
  return `venmo://paycharge?txn=pay&recipients=${VENMO_HANDLE}&amount=${membership.amount}`;
}

function buildVenmoFallbackUrl(_membership: MembershipPackage) {
  // Clean profile link — no query params that could be misread as extra recipients.
  return `https://venmo.com/${VENMO_HANDLE}`;
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

function getDisplayName(user: LoggedInUser): string {
  const { name, email } = user;
  // Prefer a real name that is not an email address
  if (name && name.trim() && !name.includes('@')) return name.trim();
  // Fall back to email prefix, humanized (dots/underscores/dashes → spaces, title-cased)
  const prefix = (name || email).split('@')[0];
  if (prefix) return prefix.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return 'Member';
}

function HhsWebViewFallbackApp({ initialPath }: { initialPath?: string }) {
  const { signOut: signOutNative } = useAuth();
  const initialUrl = getInitialWebUrl(initialPath);
  const webViewRef = useRef<WebView>(null);
  const checkedUserKeyRef = useRef<string | null>(null);
  const hasNavigatedToBeerRef = useRef(false);
  const currentUrlRef = useRef(initialUrl);
  const pendingDocumentUrlRef = useRef<string | null>(initialUrl);
  const completedDocumentUrlRef = useRef<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<LoggedInUser | null>(null);
  const [firstLoginVisible, setFirstLoginVisible] = useState(false);
  const [firstLoginStep, setFirstLoginStep] = useState<FirstLoginStep>('notifications');
  const [selectedMembership, setSelectedMembership] = useState<MembershipPackage | null>(null);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);
  const [isOpeningVenmo, setIsOpeningVenmo] = useState(false);

  // ── Hamburger menu state ─────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  // ── Notification preferences state ───────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({ ...DEFAULT_NOTIF_PREFS });
  const [prefsSaving, setPrefsSaving] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (firstLoginVisible) {
        return true;
      }

      if (settingsVisible) {
        setSettingsVisible(false);
        return true;
      }

      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }

      if (isFeedbackUrl(currentUrlRef.current)) {
        webViewRef.current?.injectJavaScript(`window.location.assign('${HOME_URL}'); true;`);
        return true;
      }

      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [canGoBack, firstLoginVisible, menuOpen, settingsVisible]);

  const prepareFirstLoginFlow = useCallback(async (user: LoggedInUser) => {
    const userStorageKey = getUserStorageKey(user);
    if (checkedUserKeyRef.current === userStorageKey) return;
    checkedUserKeyRef.current = userStorageKey;

    // Load notification preferences (local first, then sync from backend)
    try {
      const localPrefs = await loadLocalNotifPrefs(user);
      setNotifPrefs(localPrefs);
      // Background sync from backend — updates UI if server has newer prefs
      fetchPrefsFromBackend(user).then(serverPrefs => {
        if (serverPrefs) {
          setNotifPrefs(serverPrefs);
          saveLocalNotifPrefs(user, serverPrefs).catch(() => {});
        }
      }).catch(() => {});
    } catch (err) {
      console.warn('[HHS native] prefs load failed:', err);
    }

    try {
      const completed = await AsyncStorage.getItem(`${userStorageKey}:completed`);
      if (completed === 'true') {
        setFirstLoginVisible(false);
        if (!hasNavigatedToBeerRef.current) {
          hasNavigatedToBeerRef.current = true;
          webViewRef.current?.injectJavaScript(`window.location.replace('${BEER_URL}'); true;`);
        }
        // Re-register push token in the background (token may have changed)
        registerAndStorePushToken(user).catch(() => {});
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
    currentUrlRef.current = navState.url || HOME_URL;
    const documentUrl = normalizeDocumentUrl(navState.url);
    if (documentUrl && !navState.loading) {
      completedDocumentUrlRef.current = documentUrl;
      pendingDocumentUrlRef.current = null;
      setLoadFailed(false);
    }
    setCanGoBack(navState.canGoBack);
  }, []);

  const handleShouldStartLoad = useCallback((request: { url: string; isTopFrame?: boolean }) => {
    const { url } = request;

    if (
      url === 'about:blank' ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      isInternalUrl(url)
    ) {
      if (request.isTopFrame !== false) {
        const documentUrl = normalizeDocumentUrl(url);
        if (documentUrl) pendingDocumentUrlRef.current = documentUrl;
      }
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
        if (message.type === 'HHS_OPEN_MENU') {
          setMenuOpen(true);
          return;
        }
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
        // Register Expo push token now that we have permission
        if (loggedInUser) {
          registerAndStorePushToken(loggedInUser).catch(() => {});
          // Initialize prefs with defaults if this is first time
          const prefs = { ...DEFAULT_NOTIF_PREFS };
          setNotifPrefs(prefs);
          saveLocalNotifPrefs(loggedInUser, prefs).catch(() => {});
          syncPrefsToBackend(loggedInUser, prefs).catch(() => {});
        }
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
  }, [loggedInUser]);

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
        console.warn('[HHS native] Could not open Venmo:', primaryDetail, fallbackDetail);
      }
    } finally {
      setIsOpeningVenmo(false);
      setFirstLoginVisible(false);
      hasNavigatedToBeerRef.current = true;
      webViewRef.current?.injectJavaScript(`window.location.replace('${BEER_URL}'); true;`);
    }
  }, [loggedInUser, recordFirstLoginEvent, selectedMembership]);

  // ── Hamburger menu handlers ───────────────────────────────────────────────

  const handleSignOut = useCallback(() => {
    setMenuOpen(false);
    void signOutNative();
    // Clear all Supabase auth tokens from the WebView's localStorage, then reload home
    const signOutJS = `
      (function() {
        try {
          Object.keys(localStorage).forEach(function(k) {
            if ((k.startsWith('sb-') && k.endsWith('-auth-token')) || k === '__hhs_native_app__') {
              localStorage.removeItem(k);
            }
          });
        } catch(e) {}
        window.location.replace('${HOME_URL}');
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(signOutJS);
    setLoggedInUser(null);
    checkedUserKeyRef.current = null;
    hasNavigatedToBeerRef.current = false;
  }, [signOutNative]);

  const handleSignIn = useCallback(() => {
    setMenuOpen(false);
    webViewRef.current?.injectJavaScript(`window.location.replace('${HHS_ORIGIN}/auth'); true;`);
  }, []);

  const handleOpenFeedback = useCallback(() => {
    setMenuOpen(false);
    webViewRef.current?.injectJavaScript(`window.location.replace('${HHS_ORIGIN}/feedback'); true;`);
  }, []);

  const handleOpenAboutHhs = useCallback(() => {
    setMenuOpen(false);
    webViewRef.current?.injectJavaScript(`window.location.replace('${HOME_URL}'); true;`);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setMenuOpen(false);
    setSettingsVisible(true);
  }, []);

  const handleUpdateNotifPref = useCallback(
    async (key: keyof NotifPrefs, value: boolean) => {
      let newPrefs: NotifPrefs;

      if (key === 'social_all') {
        // Master social toggle — cascade to all individual social toggles
        newPrefs = {
          ...notifPrefs,
          social_all: value,
          social_new_comment: value,
          social_new_reaction: value,
          social_reaction_to_your_items: value,
          social_comment_on_your_items: value,
        };
      } else {
        newPrefs = { ...notifPrefs, [key]: value };
        // Recompute social_all: true only when ALL four social children are enabled.
        // Toggling one child on does NOT automatically set All Social on.
        if (key !== 'daily_beer') {
          const socialKeys: (keyof NotifPrefs)[] = [
            'social_new_comment',
            'social_new_reaction',
            'social_reaction_to_your_items',
            'social_comment_on_your_items',
          ];
          const allOn = socialKeys.every(k => newPrefs[k]);
          const anyOn = socialKeys.some(k => newPrefs[k]);
          newPrefs.social_all = allOn;
          // If all are off, ensure social_all is also off
          if (!anyOn) newPrefs.social_all = false;
        }
      }

      // Always update the UI immediately — the Switch is controlled and will
      // snap back if we don't call setNotifPrefs regardless of login state.
      setNotifPrefs(newPrefs);

      // Remote persist only requires a logged-in user with a valid UUID.
      if (!loggedInUser) return;
      setPrefsSaving(true);
      await saveLocalNotifPrefs(loggedInUser, newPrefs);
      await syncPrefsToBackend(loggedInUser, newPrefs).finally(() => setPrefsSaving(false));
    },
    [loggedInUser, notifPrefs],
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor={COLORS.background} />

        {/* ── Hamburger menu overlay ── */}
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
          statusBarTranslucent
        >
          <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
            <View style={styles.menuBackdrop}>
              <TouchableWithoutFeedback>
                <View style={styles.menuSheet}>
                  <View style={styles.menuHeader}>
                    <Text style={styles.menuTitle}>Menu</Text>
                    <TouchableOpacity
                      onPress={() => setMenuOpen(false)}
                      style={styles.menuCloseButton}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.menuCloseText}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  {loggedInUser && (
                    <View style={styles.menuUserBadge}>
                      <Text style={styles.menuUserName} numberOfLines={1}>
                        {getDisplayName(loggedInUser)}
                      </Text>
                      <Text style={styles.menuUserEmail} numberOfLines={1}>
                        {loggedInUser.email}
                      </Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={loggedInUser ? handleSignOut : handleSignIn}
                    activeOpacity={0.75}
                  >
                    <View style={styles.menuItemText}>
                      <Text style={styles.menuItemLabel}>Sign-in / out</Text>
                    </View>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.menuItem} onPress={handleOpenSettings} activeOpacity={0.75}>
                    <View style={styles.menuItemText}>
                      <Text style={styles.menuItemLabel}>Settings</Text>
                      <Text style={styles.menuItemSub}>App preferences</Text>
                    </View>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.menuItem} onPress={handleOpenAboutHhs} activeOpacity={0.75}>
                    <View style={styles.menuItemText}>
                      <Text style={styles.menuItemLabel}>About HHS</Text>
                      <Text style={styles.menuItemSub}>Return to the Society welcome</Text>
                    </View>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.menuItem} onPress={handleOpenFeedback} activeOpacity={0.75}>
                    <View style={styles.menuItemText}>
                      <Text style={styles.menuItemLabel}>Feedback</Text>
                      <Text style={styles.menuItemSub}>Suggest a feature or report an issue</Text>
                    </View>
                    <Text style={styles.menuChevron}>›</Text>
                  </TouchableOpacity>

                  {/* Version footer — helps confirm the installed build */}
                  <Text style={styles.menuVersionFooter}>HHS v1.0.28 (29)</Text>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* ── Settings modal ── */}
        <Modal
          visible={settingsVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setSettingsVisible(false)}
          statusBarTranslucent
        >
          {/* Backdrop — absolute Pressable behind the sheet so Switch touches
              reach their target without being intercepted by a parent Touchable */}
          <View style={styles.menuBackdrop} pointerEvents="box-none">
            <Pressable
              style={styles.menuBackdropPressable}
              onPress={() => setSettingsVisible(false)}
            />
            <View style={[styles.menuSheet, styles.settingsSheet]}>
                  <View style={styles.menuHeader}>
                    <Text style={styles.menuTitle}>Settings</Text>
                    <TouchableOpacity
                      onPress={() => setSettingsVisible(false)}
                      style={styles.menuCloseButton}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.menuCloseText}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    style={styles.settingsScroll}
                    contentContainerStyle={styles.settingsScrollContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {!loggedInUser && (
                      <View style={styles.settingsSignInNote}>
                        <Text style={styles.settingsSignInNoteText}>
                          Sign in to change notification settings. Signed-out switches are locked so they do not appear to save and then snap back.
                        </Text>
                      </View>
                    )}

                    {/* Daily Beer Notifications */}
                    <View style={styles.settingsSection}>
                      <Text style={styles.settingsSectionLabel}>Beer Notifications</Text>
                      <View style={styles.settingsRow}>
                        <View style={styles.settingsRowText}>
                          <Text style={styles.settingsRowLabel}>Daily Beer</Text>
                          <Text style={styles.settingsRowSub}>
                            Get notified each day your next beer is ready
                          </Text>
                        </View>
                        <Switch
                          disabled={!loggedInUser || prefsSaving}
                          value={notifPrefs.daily_beer}
                          onValueChange={v => void handleUpdateNotifPref('daily_beer', v)}
                          thumbColor={notifPrefs.daily_beer ? COLORS.gold : COLORS.muted}
                          trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
                          ios_backgroundColor={COLORS.cardAlt}
                        />
                      </View>
                    </View>

                    {/* Social Notifications */}
                    <View style={styles.settingsSection}>
                      <Text style={styles.settingsSectionLabel}>Social Notifications</Text>

                      {/* Master toggle */}
                      <View style={[styles.settingsRow, styles.settingsRowMaster]}>
                        <View style={styles.settingsRowText}>
                          <Text style={styles.settingsRowLabel}>All Social Notifications</Text>
                          <Text style={styles.settingsRowSub}>
                            Enable or disable all social alerts at once
                          </Text>
                        </View>
                        <Switch
                          disabled={!loggedInUser || prefsSaving}
                          value={notifPrefs.social_all}
                          onValueChange={v => void handleUpdateNotifPref('social_all', v)}
                          thumbColor={notifPrefs.social_all ? COLORS.gold : COLORS.muted}
                          trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
                          ios_backgroundColor={COLORS.cardAlt}
                        />
                      </View>

                      {/* Individual social toggles */}
                      <View style={styles.settingsIndented}>
                        <View style={styles.settingsRow}>
                          <View style={styles.settingsRowText}>
                            <Text style={styles.settingsRowLabel}>New Comment</Text>
                            <Text style={styles.settingsRowSub}>When someone comments on any post</Text>
                          </View>
                          <Switch
                            disabled={!loggedInUser || prefsSaving}
                            value={notifPrefs.social_new_comment}
                            onValueChange={v => void handleUpdateNotifPref('social_new_comment', v)}
                            thumbColor={notifPrefs.social_new_comment ? COLORS.gold : COLORS.muted}
                            trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
                            ios_backgroundColor={COLORS.cardAlt}
                          />
                        </View>

                        <View style={styles.settingsRow}>
                          <View style={styles.settingsRowText}>
                            <Text style={styles.settingsRowLabel}>New Reaction</Text>
                            <Text style={styles.settingsRowSub}>When someone reacts to any post</Text>
                          </View>
                          <Switch
                            disabled={!loggedInUser || prefsSaving}
                            value={notifPrefs.social_new_reaction}
                            onValueChange={v => void handleUpdateNotifPref('social_new_reaction', v)}
                            thumbColor={notifPrefs.social_new_reaction ? COLORS.gold : COLORS.muted}
                            trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
                            ios_backgroundColor={COLORS.cardAlt}
                          />
                        </View>

                        <View style={styles.settingsRow}>
                          <View style={styles.settingsRowText}>
                            <Text style={styles.settingsRowLabel}>Reaction to Your Items</Text>
                            <Text style={styles.settingsRowSub}>When someone reacts to your post</Text>
                          </View>
                          <Switch
                            disabled={!loggedInUser || prefsSaving}
                            value={notifPrefs.social_reaction_to_your_items}
                            onValueChange={v => void handleUpdateNotifPref('social_reaction_to_your_items', v)}
                            thumbColor={notifPrefs.social_reaction_to_your_items ? COLORS.gold : COLORS.muted}
                            trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
                            ios_backgroundColor={COLORS.cardAlt}
                          />
                        </View>

                        <View style={styles.settingsRow}>
                          <View style={styles.settingsRowText}>
                            <Text style={styles.settingsRowLabel}>Comment on Your Items</Text>
                            <Text style={styles.settingsRowSub}>When someone comments on your post</Text>
                          </View>
                          <Switch
                            disabled={!loggedInUser || prefsSaving}
                            value={notifPrefs.social_comment_on_your_items}
                            onValueChange={v => void handleUpdateNotifPref('social_comment_on_your_items', v)}
                            thumbColor={notifPrefs.social_comment_on_your_items ? COLORS.gold : COLORS.muted}
                            trackColor={{ false: COLORS.cardAlt, true: COLORS.goldDark }}
                            ios_backgroundColor={COLORS.cardAlt}
                          />
                        </View>
                      </View>
                    </View>

                    {prefsSaving && (
                      <Text style={styles.settingsSavingText}>Saving…</Text>
                    )}
                  </ScrollView>
                </View>
              </View>
            </Modal>
        <WebView
          ref={webViewRef}
          source={{ uri: initialUrl }}
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
          onLoadStart={({ nativeEvent }) => {
            const documentUrl = normalizeDocumentUrl(nativeEvent.url);
            if (documentUrl && isSameDocumentUrl(documentUrl, pendingDocumentUrlRef.current)) {
              pendingDocumentUrlRef.current = documentUrl;
              setLoadFailed(false);
            }
          }}
          onError={({ nativeEvent }) => {
            const documentUrl = normalizeDocumentUrl(nativeEvent.url);
            const isPendingDocumentError =
              !!documentUrl &&
              isSameDocumentUrl(documentUrl, pendingDocumentUrlRef.current) &&
              !isSameDocumentUrl(documentUrl, completedDocumentUrlRef.current);

            if (isPendingDocumentError) {
              console.warn('[HHS native] main document load error:', nativeEvent.url, nativeEvent.description);
              setLoadFailed(true);
            } else {
              console.warn('[HHS native] ignored non-document load error:', nativeEvent.url, nativeEvent.description);
            }
          }}
          onHttpError={({ nativeEvent }) => {
            const documentUrl = normalizeDocumentUrl(nativeEvent.url);
            const isPendingDocumentHttpError =
              !!documentUrl &&
              isSameDocumentUrl(documentUrl, pendingDocumentUrlRef.current) &&
              !isSameDocumentUrl(documentUrl, completedDocumentUrlRef.current);

            if (nativeEvent.statusCode >= 500 && isPendingDocumentHttpError) {
              console.warn('[HHS native] main document HTTP error:', nativeEvent.statusCode, nativeEvent.url);
              setLoadFailed(true);
            } else if (nativeEvent.statusCode >= 500) {
              console.warn('[HHS native] ignored non-document HTTP error:', nativeEvent.statusCode, nativeEvent.url);
            }
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
                <Text style={styles.flowTitle}>Welcome, {getDisplayName(loggedInUser)}</Text>
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
              </View>
            </ScrollView>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function App() {
  return <NativeAppShell fallback={(initialPath) => <HhsWebViewFallbackApp initialPath={initialPath} />} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // Menu overlay
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  menuSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: HHS_STYLES.cardRadius + 4,
    borderTopRightRadius: HHS_STYLES.cardRadius + 4,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingBottom: 32,
    paddingHorizontal: 0,
    zIndex: 1,
    elevation: 8,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  menuCloseButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: COLORS.cardAlt,
  },
  menuCloseText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  menuUserBadge: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 4,
  },
  menuUserName: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  menuUserEmail: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  menuItemIcon: {
    fontSize: 22,
    width: 30,
    textAlign: 'center',
  },
  menuItemText: {
    flex: 1,
    gap: 2,
  },
  menuItemLabel: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  menuItemSub: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
  },
  menuChevron: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 22,
    fontWeight: '300',
  },
  menuVersionFooter: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 4,
    letterSpacing: 0.5,
    opacity: 0.7,
  },
  // Settings modal
  settingsSheet: {
    maxHeight: '85%',
  },
  settingsScroll: {
    flexGrow: 0,
  },
  settingsScrollContent: {
    paddingBottom: 32,
  },
  settingsSignInNote: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingsSignInNoteText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  settingsSection: {
    marginTop: 20,
    marginHorizontal: 20,
  },
  settingsSectionLabel: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  settingsRowMaster: {
    paddingVertical: 14,
  },
  settingsRowText: {
    flex: 1,
    gap: 3,
  },
  settingsRowLabel: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  settingsRowSub: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  settingsIndented: {
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    marginLeft: 4,
    marginTop: 4,
  },
  settingsSavingText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
    letterSpacing: 0.5,
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
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  errorBody: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: HHS_STYLES.buttonRadius,
    backgroundColor: COLORS.gold,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  retryButtonText: {
    ...HHS_TYPOGRAPHY.button,
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
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.7,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  flowTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  flowBody: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  flowMessage: {
    ...HHS_TYPOGRAPHY.body,
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
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.gold,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: HHS_STYLES.buttonRadius,
    backgroundColor: COLORS.gold,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
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
    borderRadius: HHS_STYLES.buttonRadius,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    ...HHS_TYPOGRAPHY.button,
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
});
