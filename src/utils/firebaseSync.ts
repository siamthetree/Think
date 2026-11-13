import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { Feed, FeedItem, ReaderPreferences } from '../types';
import type { ReadingHabitState } from './feedIntelligence';
import type { ReadingSpeedProfile } from './readingSpeed';
import {
  toFirestoreSafeId,
  sanitizeUserRootPayload,
  sanitizeCloudStatePayload,
  sanitizeSourcePayload,
  sanitizeBookmarkPayload,
  sanitizeReadEntryPayload,
} from './firebaseSanitize';

const ensuredUsers = new Set<string>();

/**
 * Ensures /users/{uid} root document exists so Master Gate subcollection rules pass cleanly.
 */
export async function ensureUserRootDoc(user: User): Promise<void> {
  if (!user || !user.uid) return;
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const payload = sanitizeUserRootPayload({
    uid: user.uid,
    displayName: user.displayName,
    photoURL: user.photoURL,
  });

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (!ensuredUsers.has(user.uid)) {
      const updates: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };
      if (payload.displayName) updates.displayName = payload.displayName;
      if (payload.photoUrl) updates.photoUrl = payload.photoUrl;
      await updateDoc(userRef, updates);
    }
    ensuredUsers.add(user.uid);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function saveCloudStateToFirestore(params: {
  user: User;
  folders: string[];
  preferences: ReaderPreferences;
  readingHabit: ReadingHabitState;
  readingSpeedProfile: ReadingSpeedProfile;
}): Promise<void> {
  await ensureUserRootDoc(params.user);
  const uid = params.user.uid;
  const path = `users/${uid}/meta/state`;
  const ref = doc(db, 'users', uid, 'meta', 'state');
  const clean = sanitizeCloudStatePayload({
    uid,
    folders: params.folders,
    preferences: params.preferences,
    readingHabit: params.readingHabit,
    readingSpeedProfile: params.readingSpeedProfile,
  });

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        folders: clean.folders,
        preferences: clean.preferences,
        readingHabit: clean.readingHabit,
        readingSpeedProfile: clean.readingSpeedProfile,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncSourceToFirestore(user: User, feed: Feed): Promise<void> {
  await ensureUserRootDoc(user);
  const docId = toFirestoreSafeId(feed.id || feed.url);
  const path = `users/${user.uid}/sources/${docId}`;
  const ref = doc(db, 'users', user.uid, 'sources', docId);
  const clean = sanitizeSourcePayload(user.uid, feed);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updates: Record<string, unknown> = {
        title: clean.title,
        url: clean.url,
        category: clean.category,
        defaultTags: clean.defaultTags,
        updatedAt: serverTimestamp(),
      };
      if (clean.siteUrl !== undefined) updates.siteUrl = clean.siteUrl;
      if (clean.description !== undefined) updates.description = clean.description;
      await updateDoc(ref, updates);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteSourceFromFirestore(user: User, feed: Feed): Promise<void> {
  await ensureUserRootDoc(user);
  const docId = toFirestoreSafeId(feed.id || feed.url);
  const path = `users/${user.uid}/sources/${docId}`;
  const ref = doc(db, 'users', user.uid, 'sources', docId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncBookmarkToFirestore(user: User, article: FeedItem): Promise<void> {
  await ensureUserRootDoc(user);
  const docId = toFirestoreSafeId(article.id || article.link);
  const path = `users/${user.uid}/bookmarks/${docId}`;
  const ref = doc(db, 'users', user.uid, 'bookmarks', docId);
  const clean = sanitizeBookmarkPayload(user.uid, article);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updates: Record<string, unknown> = {
        title: clean.title,
        tags: clean.tags,
        readTimeMin: clean.readTimeMin,
        updatedAt: serverTimestamp(),
      };
      if (clean.author !== undefined) updates.author = clean.author;
      if (clean.summary !== undefined) updates.summary = clean.summary;
      if (clean.imageUrl !== undefined) updates.imageUrl = clean.imageUrl;
      await updateDoc(ref, updates);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteBookmarkFromFirestore(user: User, article: Pick<FeedItem, 'id' | 'link'>): Promise<void> {
  await ensureUserRootDoc(user);
  const docId = toFirestoreSafeId(article.id || article.link);
  const path = `users/${user.uid}/bookmarks/${docId}`;
  const ref = doc(db, 'users', user.uid, 'bookmarks', docId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function recordReadEntryToFirestore(
  user: User,
  article: Pick<FeedItem, 'id' | 'link' | 'title'>
): Promise<void> {
  await ensureUserRootDoc(user);
  const clean = sanitizeReadEntryPayload(user.uid, article);
  const docId = toFirestoreSafeId(clean.entryKey);
  const path = `users/${user.uid}/readEntries/${docId}`;
  const ref = doc(db, 'users', user.uid, 'readEntries', docId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updates: Record<string, unknown> = {
        readAt: clean.readAt,
        updatedAt: serverTimestamp(),
      };
      if (clean.canonicalUrl !== undefined) updates.canonicalUrl = clean.canonicalUrl;
      if (clean.headlineKey !== undefined) updates.headlineKey = clean.headlineKey;
      await updateDoc(ref, updates);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export interface LoadedCloudUserData {
  metaState: {
    folders?: string[];
    preferences?: ReaderPreferences;
    readingHabit?: Partial<ReadingHabitState>;
    readingSpeedProfile?: Partial<ReadingSpeedProfile>;
  } | null;
  sources: Feed[];
  bookmarks: FeedItem[];
  readSignatures: string[];
}

export async function loadAllCloudUserData(user: User): Promise<LoadedCloudUserData> {
  await ensureUserRootDoc(user);
  const uid = user.uid;

  let metaState: LoadedCloudUserData['metaState'] = null;
  const metaPath = `users/${uid}/meta/state`;
  try {
    const metaSnap = await getDoc(doc(db, 'users', uid, 'meta', 'state'));
    if (metaSnap.exists()) {
      metaState = metaSnap.data() as LoadedCloudUserData['metaState'];
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, metaPath);
  }

  const sources: Feed[] = [];
  const sourcesPath = `users/${uid}/sources`;
  try {
    const q = query(collection(db, 'users', uid, 'sources'), where('ownerId', '==', uid), limit(150));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d && typeof d.url === 'string' && typeof d.title === 'string') {
        sources.push({
          id: String(d.id || docSnap.id),
          title: d.title,
          url: d.url,
          siteUrl: typeof d.siteUrl === 'string' ? d.siteUrl : undefined,
          category: typeof d.category === 'string' ? d.category : '',
          description: typeof d.description === 'string' ? d.description : undefined,
          defaultTags: Array.isArray(d.defaultTags) ? d.defaultTags : [],
          unreadCount: 0,
        });
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, sourcesPath);
  }

  const bookmarks: FeedItem[] = [];
  const bookmarksPath = `users/${uid}/bookmarks`;
  try {
    const q = query(collection(db, 'users', uid, 'bookmarks'), where('ownerId', '==', uid), limit(150));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d && typeof d.title === 'string' && typeof d.link === 'string') {
        bookmarks.push({
          id: String(d.id || docSnap.id),
          feedId: String(d.feedId || 'feed'),
          feedTitle: String(d.feedTitle || 'Saved Source'),
          feedUrl: typeof d.feedUrl === 'string' ? d.feedUrl : d.link,
          title: d.title,
          link: d.link,
          pubDate: typeof d.pubDate === 'string' ? d.pubDate : new Date(Number(d.timestamp) || Date.now()).toISOString(),
          timestamp: typeof d.timestamp === 'number' ? d.timestamp : Date.now(),
          author: typeof d.author === 'string' ? d.author : undefined,
          summary: typeof d.summary === 'string' ? d.summary : '',
          imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : undefined,
          tags: Array.isArray(d.tags) ? d.tags : [],
          isRead: false,
          isBookmarked: true,
          isOfflineCached: false,
          readTimeMin: typeof d.readTimeMin === 'number' ? d.readTimeMin : 2,
        });
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, bookmarksPath);
  }

  const readSignatures: string[] = [];
  const readPath = `users/${uid}/readEntries`;
  try {
    const q = query(collection(db, 'users', uid, 'readEntries'), where('ownerId', '==', uid), limit(300));
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d?.entryKey && typeof d.entryKey === 'string') readSignatures.push(d.entryKey);
      if (d?.canonicalUrl && typeof d.canonicalUrl === 'string') readSignatures.push(d.canonicalUrl);
      if (d?.headlineKey && typeof d.headlineKey === 'string') readSignatures.push(d.headlineKey);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, readPath);
  }

  return { metaState, sources, bookmarks, readSignatures };
}

export function subscribeToCloudMetaState(
  user: User,
  onState: (meta: LoadedCloudUserData['metaState']) => void
): Unsubscribe {
  const metaPath = `users/${user.uid}/meta/state`;
  return onSnapshot(
    doc(db, 'users', user.uid, 'meta', 'state'),
    (snap) => {
      if (snap.exists()) {
        onState(snap.data() as LoadedCloudUserData['metaState']);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, metaPath);
    }
  );
}
