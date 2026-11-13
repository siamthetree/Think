import React, { createContext, useContext } from 'react';

export interface LocalPrivacyUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface FirebaseContextValue {
  user: LocalPrivacyUser | null;
  isAuthReady: boolean;
  isSyncing: boolean;
  authError: string | null;
  lastSyncedAt: number | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  setIsSyncing: (syncing: boolean) => void;
  setLastSyncedAt: (timestamp: number | null) => void;
}

const FirebaseContext = createContext<FirebaseContextValue>({
  user: null,
  isAuthReady: true,
  isSyncing: false,
  authError: null,
  lastSyncedAt: null,
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
  setIsSyncing: () => {},
  setLastSyncedAt: () => {},
});

export const useFirebase = () => useContext(FirebaseContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <FirebaseContext.Provider
      value={{
        user: null,
        isAuthReady: true,
        isSyncing: false,
        authError: null,
        lastSyncedAt: null,
        signInWithGoogle: async () => {},
        signOutUser: async () => {},
        setIsSyncing: () => {},
        setLastSyncedAt: () => {},
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};
