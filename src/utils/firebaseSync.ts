import type { Feed, FeedSource, FeedItem, ReaderPreferences } from '../types';
import type { ReadingHabitState, ReadHistoryEntry } from './feedIntelligence';
import type { ReadingSpeedProfile } from './readingSpeed';
import type { PrivacySettings } from './storage';
import type { LocalPrivacyUser } from '../contexts/FirebaseContext';

/**
 * Local-only no-op stubs.
 * Chinta stores all sources, bookmarks, and reading habits strictly on-device
 * in localStorage and IndexedDB without contacting Firebase or any external cloud server.
 */

export type UserOrUid = string | LocalPrivacyUser | { uid: string };

export interface CloudMetaState {
  folders?: string[];
  preferences?: ReaderPreferences;
  darkMode?: boolean;
  feedLanguageFilter?: 'all' | 'bn' | 'en';
  feedCategoryFilter?: string;
  privacySettings?: PrivacySettings;
  readingHabit?: ReadingHabitState;
  readingSpeedProfile?: ReadingSpeedProfile;
  updatedAt?: number;
}

export async function saveCloudStateToFirestore(
  _uidOrParams:
    | UserOrUid
    | {
        user: UserOrUid;
        folders?: string[];
        preferences?: ReaderPreferences;
        readingHabit?: ReadingHabitState;
        readingSpeedProfile?: ReadingSpeedProfile;
      },
  _state?: Partial<CloudMetaState>
): Promise<void> {}

export async function syncAllSourcesToFirestore(
  _userOrUid: UserOrUid,
  _sources: FeedSource[]
): Promise<void> {}

export async function syncSourceToFirestore(
  _userOrUid: UserOrUid,
  _source: Feed | FeedSource
): Promise<void> {}

export async function deleteSourceFromFirestore(
  _userOrUid: UserOrUid,
  _sourceOrId: string | Feed | FeedSource
): Promise<void> {}

export async function syncBookmarkToFirestore(
  _userOrUid: UserOrUid,
  _article: FeedItem
): Promise<void> {}

export async function deleteBookmarkFromFirestore(
  _userOrUid: UserOrUid,
  _articleOrId: string | FeedItem
): Promise<void> {}

export async function syncAllBookmarksToFirestore(
  _userOrUid: UserOrUid,
  _bookmarks: Record<string, FeedItem> | FeedItem[]
): Promise<void> {}

export async function recordReadEntryToFirestore(
  _userOrUid: UserOrUid,
  _entry: ReadHistoryEntry | FeedItem
): Promise<void> {}

export interface CloudUserDataSnapshot {
  meta: CloudMetaState | null;
  metaState: CloudMetaState | null;
  sources: FeedSource[];
  bookmarks: FeedItem[];
  readSignatures: string[];
}

export async function loadAllCloudUserData(_userOrUid: UserOrUid): Promise<CloudUserDataSnapshot> {
  return {
    meta: null,
    metaState: null,
    sources: [],
    bookmarks: [],
    readSignatures: [],
  };
}

export function subscribeToCloudMetaState(
  _userOrUid: UserOrUid,
  _onUpdate: (meta: CloudMetaState | null) => void
): () => void {
  return () => {};
}
