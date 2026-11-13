import type { FeedSource, FeedItem } from '../types';
import type { ReadingHabitState, ReadHistoryEntry } from './feedIntelligence';
import type { ReadingSpeedProfile } from './readingSpeed';
import type { PrivacySettings } from './storage';

/**
 * Local-only no-op stubs.
 * Chinta stores all sources, bookmarks, and reading habits strictly on-device
 * in localStorage and IndexedDB without contacting Firebase or any external cloud server.
 */

export interface CloudMetaState {
  darkMode?: boolean;
  feedLanguageFilter?: 'all' | 'bn' | 'en';
  feedCategoryFilter?: string;
  privacySettings?: PrivacySettings;
  readingHabit?: ReadingHabitState;
  readingSpeedProfile?: ReadingSpeedProfile;
  updatedAt?: number;
}

export async function saveCloudStateToFirestore(
  _uid: string,
  _state: Partial<CloudMetaState>
): Promise<void> {}

export async function syncAllSourcesToFirestore(
  _uid: string,
  _sources: FeedSource[]
): Promise<void> {}

export async function syncSourceToFirestore(
  _uid: string,
  _source: FeedSource
): Promise<void> {}

export async function deleteSourceFromFirestore(
  _uid: string,
  _sourceId: string
): Promise<void> {}

export async function syncBookmarkToFirestore(
  _uid: string,
  _article: FeedItem
): Promise<void> {}

export async function deleteBookmarkFromFirestore(
  _uid: string,
  _articleId: string
): Promise<void> {}

export async function syncAllBookmarksToFirestore(
  _uid: string,
  _bookmarks: Record<string, FeedItem>
): Promise<void> {}

export async function recordReadEntryToFirestore(
  _uid: string,
  _entry: ReadHistoryEntry
): Promise<void> {}

export interface CloudUserDataSnapshot {
  meta: CloudMetaState | null;
  sources: FeedSource[];
  bookmarks: Record<string, FeedItem>;
}

export async function loadAllCloudUserData(_uid: string): Promise<CloudUserDataSnapshot> {
  return {
    meta: null,
    sources: [],
    bookmarks: {},
  };
}

export function subscribeToCloudMetaState(
  _uid: string,
  _onUpdate: (meta: CloudMetaState) => void
): () => void {
  return () => {};
}
