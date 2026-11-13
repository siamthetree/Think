import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_ID_REGEX,
  toFirestoreSafeId,
  sanitizeUserRootPayload,
  sanitizeCloudStatePayload,
  sanitizeSourcePayload,
  sanitizeBookmarkPayload,
  sanitizeReadEntryPayload,
} from './firebaseSanitize';

test('toFirestoreSafeId normalizes arbitrary RSS/URL IDs into valid Firestore doc IDs <= 128 chars', () => {
  const dirtyIds = [
    'feed_1700000_https://en.prothomalo.com/bangladesh/some-story?utm_source=fb#top',
    '../../../etc/passwd',
    'a'.repeat(300),
    'prothom_alo_bn',
  ];

  for (const raw of dirtyIds) {
    const safe = toFirestoreSafeId(raw);
    assert.ok(safe.length >= 1 && safe.length <= 128);
    assert.equal(SAFE_ID_REGEX.test(safe), true);
  }
  assert.notEqual(toFirestoreSafeId('https://example.com/a'), toFirestoreSafeId('https://example.com/b'));
});

test('Firebase payload sanitizers enforce blueprint string length bounds, list limits, and whitelist keys', () => {
  const userRoot = sanitizeUserRootPayload({
    uid: 'alice_uid_123',
    displayName: 'A'.repeat(250),
    photoURL: 'https://example.com/' + 'x'.repeat(600),
  });
  assert.equal(userRoot.ownerId, 'alice_uid_123');
  assert.equal(userRoot.displayName?.length, 120);
  assert.equal(userRoot.photoUrl?.length, 512);

  const cloudState = sanitizeCloudStatePayload({
    uid: 'alice_uid_123',
    folders: Array.from({ length: 70 }, (_, i) => `Folder_${i}_` + 'Z'.repeat(80)),
    preferences: {
      font: 'serif',
      fontSize: 99,
      lineHeight: 'relaxed',
      theme: 'oled',
      distractionFree: true,
    },
    readingHabit: {
      dailyGoal: 500,
      todayDate: '2026-11-12',
      todayReadIds: Array.from({ length: 250 }, (_, i) => `id_${i}`),
      todayMinutes: -5,
      streakDays: 3,
      lastCompletedDate: null,
    },
    readingSpeedProfile: {
      en: {
        observedCount: 8,
        learnedWpm: 240,
        learnedMsPerWord: 212,
        learnedMsPerLine: 300,
        observations: [
          {
            articleId: 'en_1',
            language: 'en',
            wordCount: 1000,
            lineCount: 100,
            activeMs: 250000,
            wpm: 240,
            timestamp: 1700000,
          },
        ],
      },
      bn: {
        observedCount: 7,
        learnedWpm: 200,
        learnedMsPerWord: 255,
        learnedMsPerLine: 360,
        observations: [],
      },
    },
  });

  assert.equal(cloudState.folders.length, 50);
  assert.equal(cloudState.folders[0].length, 64);
  assert.equal(cloudState.preferences.font, 'serif');
  assert.equal(cloudState.preferences.fontSize, 36);
  assert.equal(cloudState.preferences.lineHeight, 'relaxed');
  assert.equal(cloudState.preferences.distractionFree, true);
  assert.equal(cloudState.readingHabit.dailyGoal, 100);
  assert.equal(cloudState.readingHabit.todayReadIds.length, 200);
  assert.equal(cloudState.readingHabit.todayMinutes, 0);
  assert.equal(cloudState.readingSpeedProfile.en.observedCount, 8);
  assert.equal(cloudState.readingSpeedProfile.en.observations.length, 1);

  const bookmark = sanitizeBookmarkPayload('alice_uid_123', {
    id: 'b1',
    feedId: 'f1',
    feedTitle: 'T'.repeat(300),
    feedUrl: 'https://example.com',
    title: 'H'.repeat(800),
    link: 'https://example.com/news',
    pubDate: new Date().toISOString(),
    timestamp: -10,
    author: 'N'.repeat(300),
    summary: 'S'.repeat(900),
    tags: Array.from({ length: 30 }, (_, i) => `t_${i}`),
    isRead: false,
    isBookmarked: true,
    isOfflineCached: false,
    readTimeMin: 0,
  });

  assert.equal(bookmark.title.length, 400);
  assert.equal(bookmark.feedTitle.length, 200);
  assert.equal(bookmark.summary?.length, 600);
  assert.equal(bookmark.author?.length, 160);
  assert.equal(bookmark.tags.length, 20);
  assert.equal(bookmark.readTimeMin, 1);
  assert.equal(bookmark.timestamp, 0);

  const source = sanitizeSourcePayload('alice_uid_123', {
    id: 'src1',
    title: 'S'.repeat(300),
    url: 'https://example.com/' + 'u'.repeat(1200),
    category: 'C'.repeat(120),
    defaultTags: ['bd'],
    unreadCount: 0,
  });
  assert.equal(source.title.length, 200);
  assert.equal(source.url.length, 1024);
  assert.equal(source.category.length, 80);

  const readEntry = sanitizeReadEntryPayload('alice_uid_123', {
    id: 'art_123',
    link: 'https://www.example.com/story?utm_source=fb',
    title: 'Test Read Headline',
  });
  assert.equal(readEntry.ownerId, 'alice_uid_123');
  assert.equal(readEntry.canonicalUrl, 'https://example.com/story');
  assert.ok(readEntry.headlineKey?.startsWith('title:'));
});
