import React, { createContext, useContext } from 'react';

export interface LocalPrivacyUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface FirebaseContextValue {
  user: LocalPrivacyUser | null;
  authReady: boolean;
  isAuthReady: boolean;
  isSyncing: boolean;
  cloudSyncStatus: CloudSyncStatus;
  cloudError: string | null;
  authError: string | null;
  lastSyncedAt: number | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  setIsSyncing: (syncing: boolean) => void;
  setLastSyncedAt: (timestamp: number | null) => void;
  setCloudSyncStatus: (status: CloudSyncStatus, syncedAt?: number) => void;
  setCloudError: (error: string | null) => void;
}

const defaultContextValue: FirebaseContextValue = {
  user: null,
  authReady: true,
  isAuthReady: true,
  isSyncing: false,
  cloudSyncStatus: 'idle',
  cloudError: null,
  authError: null,
  lastSyncedAt: null,
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
  setIsSyncing: () => {},
  setLastSyncedAt: () => {},
  setCloudSyncStatus: () => {},
  setCloudError: () => {},
};

const FirebaseContext = createContext<FirebaseContextValue>(defaultContextValue);

export const useFirebase = () => useContext(FirebaseContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <FirebaseContext.Provider value={defaultContextValue}>
      {children}
    </FirebaseContext.Provider>
  );
};
