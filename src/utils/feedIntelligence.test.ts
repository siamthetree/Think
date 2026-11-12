import test from 'node:test';
import assert from 'node:assert/strict';
import type { FeedItem } from '../types';
import {
  extractSignificantTokens,
  clusterStoriesByTopic,
  buildDailyBriefing,
  generateQuickTldrBullets,
  recordArticleReadInHabit,
  normalizeReadingHabitState,
  findNewIncomingArticles,
  type ReadingHabitState,
} from './feedIntelligence';

function makeArticle(overrides: Partial<FeedItem> & { id: string; title: string }): FeedItem {
  return {
    id: overrides.id,
    feedId: overrides.feedId || 'feed_1',
    feedTitle: overrides.feedTitle || 'The Daily Star',
    feedUrl: overrides.feedUrl || 'https://thedailystar.net/rss.xml',
    title: overrides.title,
    link: overrides.link || `https://example.com/${overrides.id}`,
    pubDate: overrides.pubDate || new Date(1762940000000).toISOString(),
    timestamp: overrides.timestamp ?? 1762940000000,
    author: overrides.author,
    summary: overrides.summary || 'Detailed coverage of national policy and economic reforms.',
    contentClean: overrides.contentClean,
    contentHtml: overrides.contentHtml,
    imageUrl: overrides.imageUrl,
    tags: overrides.tags || ['tag_bd'],
    isRead: overrides.isRead ?? false,
    isBookmarked: overrides.isBookmarked ?? false,
    isOfflineCached: overrides.isOfflineCached ?? true,
    readTimeMin: overrides.readTimeMin ?? 4,
  };
}

test('extractSignificantTokens removes stop words and preserves meaningful English and Bengali words', () => {
  const tokens = extractSignificantTokens('The Bangladesh Bank announces new monetary policy for inflation control');
  assert.ok(tokens.includes('bangladesh'));
  assert.ok(tokens.includes('monetary'));
  assert.ok(tokens.includes('inflation'));
  assert.equal(tokens.includes('the'), false);
  assert.equal(tokens.includes('for'), false);
});

test('clusterStoriesByTopic groups multi-source coverage of the same developing event', () => {
  const articles: FeedItem[] = [
    makeArticle({
      id: 'a1',
      feedId: 'f1',
      feedTitle: 'The Daily Star',
      title: 'Bangladesh Bank unveils new monetary policy to curb inflation',
      summary: 'Central bank raises policy rate to stabilize foreign exchange reserves and curb inflation.',
      timestamp: 1762940000000,
    }),
    makeArticle({
      id: 'a2',
      feedId: 'f2',
      feedTitle: 'Prothom Alo',
      title: 'Monetary policy tightened by Bangladesh Bank to tame inflation',
      summary: 'Bangladesh Bank raised key interest rate under its new monetary policy framework.',
      timestamp: 1762939000000,
    }),
    makeArticle({
      id: 'a3',
      feedId: 'f3',
      feedTitle: 'TechCrunch',
      title: 'Apple introduces next-generation silicon neural engine for iOS devices',
      summary: 'New mobile processors deliver faster machine learning inference.',
      timestamp: 1762938000000,
    }),
  ];

  const clusters = clusterStoriesByTopic(articles);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].primary.id, 'a1');
  assert.equal(clusters[0].perspectives.length, 1);
  assert.equal(clusters[0].perspectives[0].id, 'a2');
  assert.ok(clusters[0].topicKeywords.includes('monetary') || clusters[0].topicKeywords.includes('bangladesh'));
  assert.equal(clusters[1].primary.id, 'a3');
  assert.equal(clusters[1].perspectives.length, 0);
});

test('buildDailyBriefing selects up to 5 diverse stories and adapts edition title to time of day', () => {
  const articles: FeedItem[] = [
    makeArticle({ id: '1', feedId: 'f1', title: 'Story 1', readTimeMin: 3 }),
    makeArticle({ id: '2', feedId: 'f1', title: 'Story 2', readTimeMin: 4 }),
    makeArticle({ id: '3', feedId: 'f2', title: 'Story 3', readTimeMin: 2 }),
    makeArticle({ id: '4', feedId: 'f3', title: 'Story 4', readTimeMin: 5 }),
    makeArticle({ id: '5', feedId: 'f4', title: 'Story 5', readTimeMin: 3 }),
    makeArticle({ id: '6', feedId: 'f5', title: 'Story 6', readTimeMin: 4 }),
  ];

  // Morning timestamp (9:00 AM local)
  const morningDate = new Date(2026, 10, 12, 9, 0, 0).getTime();
  const briefing = buildDailyBriefing(articles, morningDate);

  assert.equal(briefing.editionTitle, 'Morning Briefing');
  assert.equal(briefing.stories.length, 5);
  // First 5 should come from distinct feeds f1, f2, f3, f4, f5
  const feedIds = new Set(briefing.stories.map((s) => s.feedId));
  assert.equal(feedIds.size, 5);
  assert.equal(briefing.totalReadMinutes, 3 + 2 + 5 + 3 + 4);
});

test('generateQuickTldrBullets extracts 3 distinct key takeaway bullets', () => {
  const article = makeArticle({
    id: 'tldr_1',
    title: 'Renewable Solar Grid Expansion Reaches Milestone',
    contentClean:
      'Utility-scale solar installations across northern districts added 450 megawatts to the national grid this quarter. Grid operators reported a 14 percent reduction in peak evening load shedding following battery storage integration. Energy economists project residential tariff stability through next summer as clean capacity scales.',
  });

  const bullets = generateQuickTldrBullets(article);
  assert.equal(bullets.length, 3);
  assert.ok(bullets[0].includes('450 megawatts'));
  assert.ok(bullets[1].includes('14 percent reduction'));
  assert.ok(bullets[2].includes('tariff stability'));
});

test('recordArticleReadInHabit tracks daily goal completion and increments consecutive day streak', () => {
  const initialState: ReadingHabitState = {
    dailyGoal: 3,
    todayDate: '2026-11-11',
    todayReadIds: ['old1', 'old2', 'old3'],
    todayMinutes: 10,
    streakDays: 2,
    lastCompletedDate: '2026-11-11',
  };

  // Next day (2026-11-12): Read 1st story
  const step1 = recordArticleReadInHabit(initialState, 'art_1', 4, '2026-11-12');
  assert.equal(step1.nextState.todayReadIds.length, 1);
  assert.equal(step1.justHitDailyGoal, false);
  assert.equal(step1.nextState.streakDays, 2);

  // Read 2nd story
  const step2 = recordArticleReadInHabit(step1.nextState, 'art_2', 3, '2026-11-12');
  assert.equal(step2.nextState.todayReadIds.length, 2);
  assert.equal(step2.justHitDailyGoal, false);

  // Read 3rd story -> hits daily goal of 3 and increments streak from 2 -> 3!
  const step3 = recordArticleReadInHabit(step2.nextState, 'art_3', 5, '2026-11-12');
  assert.equal(step3.nextState.todayReadIds.length, 3);
  assert.equal(step3.justHitDailyGoal, true);
  assert.equal(step3.nextState.streakDays, 3);
  assert.equal(step3.nextState.todayMinutes, 12);
  assert.equal(step3.nextState.lastCompletedDate, '2026-11-12');

  // Re-reading same article does not double-count
  const stepDuplicate = recordArticleReadInHabit(step3.nextState, 'art_3', 5, '2026-11-12');
  assert.equal(stepDuplicate.nextState.todayReadIds.length, 3);
  assert.equal(stepDuplicate.justHitDailyGoal, false);
});

test('normalizeReadingHabitState resets streak if a full day was missed', () => {
  const staleState: ReadingHabitState = {
    dailyGoal: 3,
    todayDate: '2026-11-09',
    todayReadIds: ['a', 'b', 'c'],
    todayMinutes: 9,
    streakDays: 5,
    lastCompletedDate: '2026-11-09',
  };

  const normalized = normalizeReadingHabitState(staleState, '2026-11-12');
  assert.equal(normalized.todayDate, '2026-11-12');
  assert.equal(normalized.todayReadIds.length, 0);
  assert.equal(normalized.streakDays, 0);
});

test('findNewIncomingArticles returns only articles not already present by id or link', () => {
  const existing = [
    makeArticle({ id: '1', title: 'Existing 1', link: 'https://example.com/1' }),
    makeArticle({ id: '2', title: 'Existing 2', link: 'https://example.com/2' }),
  ];
  const incoming = [
    makeArticle({ id: '2', title: 'Existing 2', link: 'https://example.com/2' }),
    makeArticle({ id: '3', title: 'Brand New 3', link: 'https://example.com/3' }),
  ];

  const diff = findNewIncomingArticles(existing, incoming);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].id, '3');
});
