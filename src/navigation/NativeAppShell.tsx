import React, { useState } from 'react';

import { USE_NATIVE_BEER_SCREEN } from '../config/env';
import { AuthProvider } from '../features/auth/AuthProvider';
import { NativeBeerScreen } from '../features/beers/NativeBeerScreen';

type NativeAppShellProps = {
  fallback: React.ReactNode;
};

export function NativeAppShell({ fallback }: NativeAppShellProps) {
  const [showWebFallback, setShowWebFallback] = useState(!USE_NATIVE_BEER_SCREEN);

  return (
    <AuthProvider>
      {/*
        Native Beer is opt-in while the migration foundation settles. The
        WebView remains the default app surface and stays reachable from the
        native Beer screen during validation. Wall, Rankings, and Feedback stay
        web-only until their native data/side-effect parity is implemented.
      */}
      {showWebFallback ? fallback : <NativeBeerScreen onOpenWebFallback={() => setShowWebFallback(true)} />}
    </AuthProvider>
  );
}

