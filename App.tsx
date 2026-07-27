import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';

const HHS_ORIGIN = 'https://hallowedhopsociety.com';
const HOME_URL = `${HHS_ORIGIN}/`;
const HHS_HOSTS = new Set(['hallowedhopsociety.com', 'www.hallowedhopsociety.com']);

const COLORS = {
  background: '#191726',
  card: '#201d30',
  text: '#d9d8d2',
  muted: '#7a7468',
  gold: '#d97c2b',
  border: 'rgba(217, 124, 43, 0.18)',
};

const injectedJavaScriptBeforeContentLoaded = `
  (function () {
    try {
      window.ReactNativeWebView && (window.__HHS_NATIVE_APP__ = true);
      var meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      if (!meta.parentNode) document.head.appendChild(meta);
    } catch (error) {}
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

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [canGoBack]);

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

    Linking.openURL(url).catch(() => undefined);
    return false;
  }, []);

  const retry = useCallback(() => {
    setLoadFailed(false);
    webViewRef.current?.reload();
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
          originWhitelist={['https://*', 'mailto:*', 'tel:*']}
          injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
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
});
