import React from 'react';

import { AuthProvider } from '../features/auth/AuthProvider';

type NativeAppShellProps = {
  fallback: React.ReactNode;
};

export function NativeAppShell({ fallback }: NativeAppShellProps) {
  return (
    <AuthProvider>
      {/*
        Phase 1 foundation only: keep the existing WebView fallback as the
        rendered surface while native auth/session modules come online.
        Next coding step is the first native Beer screen, backed by this auth
        provider and Supabase client; Wall, Rankings, and Feedback stay web-only
        until their native data/side-effect parity is implemented.
      */}
      {fallback}
    </AuthProvider>
  );
}

