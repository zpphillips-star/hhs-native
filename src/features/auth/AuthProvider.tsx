import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { isSupabaseEnvConfigured } from '../../config/env';
import { startSupabaseAuthLifecycle, supabase } from '../../lib/supabase';

type SignInResult = {
  error: AuthError | Error | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<SignInResult>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.warn('[HHS native] Supabase session restore failed:', error.message);
      }
      setSession(data.session ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setLoading(false);
      return undefined;
    }

    const stopLifecycle = startSupabaseAuthLifecycle();
    void refreshSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      authListener.subscription.unsubscribe();
      stopLifecycle();
    };
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    if (!supabase) {
      return { error: new Error('Supabase public env is not configured for the native app.') };
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSession(data.session ?? null);
    setLoading(false);
    return { error };
  }, []);

  const signOut = useCallback(async (): Promise<SignInResult> => {
    if (!supabase) {
      setSession(null);
      return { error: null };
    }

    setLoading(true);
    const { error } = await supabase.auth.signOut();
    setSession(null);
    setLoading(false);
    return { error };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: isSupabaseEnvConfigured,
      signIn,
      signOut,
      refreshSession,
    }),
    [loading, refreshSession, session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

