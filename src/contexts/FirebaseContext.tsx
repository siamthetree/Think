import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { ensureUserRootDoc } from '../utils/firebaseSync';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  isSigningIn: boolean;
  cloudSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastSyncedAt: number | null;
  cloudError: string | null;
  setCloudSyncStatus: (status: 'idle' | 'syncing' | 'synced' | 'error', syncedAt?: number) => void;
  setCloudError: (msg: string | null) => void;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [cloudSyncStatus, setStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        try {
          await ensureUserRootDoc(nextUser);
          setCloudError(null);
        } catch (err) {
          setCloudError(err instanceof Error ? err.message : 'Unable to initialize cloud profile');
        }
      } else {
        setStatus('idle');
      }
    });
    return () => unsubscribe();
  }, []);

  const setCloudSyncStatus = useCallback(
    (status: 'idle' | 'syncing' | 'synced' | 'error', syncedAt?: number) => {
      setStatus(status);
      if (syncedAt) setLastSyncedAt(syncedAt);
    },
    []
  );

  const signInWithGoogle = useCallback(async () => {
    setIsSigningIn(true);
    setCloudError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        await ensureUserRootDoc(cred.user);
      }
      return cred.user;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.';
      setCloudError(message);
      setStatus('error');
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setCloudError(null);
    try {
      await signOut(auth);
      setStatus('idle');
      setLastSyncedAt(null);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to sign out');
    }
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        isSigningIn,
        cloudSyncStatus,
        lastSyncedAt,
        cloudError,
        setCloudSyncStatus,
        setCloudError,
        signInWithGoogle,
        signOutUser,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside <FirebaseProvider>');
  }
  return ctx;
}
