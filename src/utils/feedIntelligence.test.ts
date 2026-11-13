import test from 'node:test';
import assert from 'node:assert/strict';
import type { Feed, FeedItem, Tag } from '../types';
import {
  extractSignificantTokens,
  normalizeTopicToken,
  extractTopicBigrams,
  clusterStoriesByTopic,
  searchPerspectivesAcrossSources,
  findPerspectivesAcrossSources,
  buildDailyBriefing,
  generateQuickTldrBullets,
  recordArticleReadInHabit,
  normalizeReadingHabitState,
  computeSpotifyReadingStats,
  findNewIncomingArticles,
  canonicalizeArticleLink,
  filterOutAlreadyReadIncoming,
  clearReadArticlesForRefresh,
  type ReadingHabitState,
} from './feedIntelligence';

function makeArticle(overrides: Partial<FeedItem> & { id: string; title: string }): FeedItem {
  return {
    id: overrides.id,
    feedId: overrides.feedId || 'feed_1',
    feedTitle: overrides.feedTitle || 'The Daily Star',
    feedUrl: overrides.feedUrl || 'https://thedailystar.net/rss.xml',
    title: overrides.title,
    link: overrides.link || `https://www.thedailystar.net/${overrides.id}`,
    pubDate: overrides.pubDate || new Date(1762940000000).toISOString(),
    timestamp: overrides.timestamp ?? 1762940000000,
    author: overrides.author,
    summary: overrides.summary || 'Detailed reporting on infrastructure and civic developments.',
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

test('normalizeTopicToken and extractSignificantTokens filter broad stop words and stem tokens', () => {
  assert.equal(normalizeTopicToken('tightening'), 'tighten');
  assert.equal(normalizeTopicToken('rates'), 'rate');
  const tokens = extractSignificantTokens(
    'The Bangladesh Bank announces monetary tightening for inflation control in Dhaka'
  );
  assert.ok(tokens.includes('monetary'));
  assert.ok(tokens.includes('tighten'));
  assert.ok(tokens.includes('inflation'));
  // Broad geographic & category stop words should be excluded
  assert.equal(tokens.includes('bangladesh'), false);
  assert.equal(tokens.includes('dhaka'), false);
  assert.equal(tokens.includes('bank'), false);
});

test('extractTopicBigrams produces ordered 2-word topic phrases', () => {
  const bigrams = extractTopicBigrams(['monetary', 'policy', 'inflation']);
  assert.deepEqual(bigrams, ['monetary_policy', 'policy_inflation']);
});

test('clusterStoriesByTopic groups multi-source coverage of the same event while avoiding broad category false positives', () => {
  const articles: FeedItem[] = [
    makeArticle({
      id: 'a1',
      feedId: 'f1',
      feedTitle: 'The Daily Star',
      title: 'Central regulators unveil monetary tightening to curb inflation',
      summary: 'Policy interest adjustments target consumer inflation.',
      timestamp: 1762940000000,
    }),
    makeArticle({
      id: 'a2',
      feedId: 'f2',
      feedTitle: 'Prothom Alo',
      title: 'Monetary tightening enacted to tame consumer inflation',
      summary: 'Regulators raised key policy interest rates.',
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
  assert.equal(clusters[1].primary.id, 'a3');
  assert.equal(clusters[1].perspectives.length, 0);
});

test('findPerspectivesAcrossSources uses strict topic matching and excludes unrelated same-country/category stories', () => {
  const target = makeArticle({
    id: 'target_1',
    feedId: 'f1',
    feedTitle: 'The Daily Star',
    title: 'Metro rail viaduct pillar repair halts Uttara Agargaon trains',
    summary: 'Commuters face delays as engineers inspect bearing pads on metro viaduct.',
  });

  const allArticles: FeedItem[] = [
    target,
    makeArticle({
      id: 'match_same_1',
      feedId: 'f2',
      feedTitle: 'Prothom Alo',
      title: 'Uttara to Agargaon metro rail suspended for viaduct bearing repair',
      summary: 'Engineers replace faulty bearing pad on metro viaduct pillar.',
    }),
    makeArticle({
      id: 'unrelated_bd_economy',
      feedId: 'f3',
      feedTitle: 'The Business Standard',
      title: 'Bangladesh Bank updates Dhaka market policy for exporters',
      summary: 'Government minister spoke at economic forum in Dhaka today.',
    }),
  ];

  const result = findPerspectivesAcrossSources(target, allArticles);
  assert.equal(searchPerspectivesAcrossSources, findPerspectivesAcrossSources);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].article.id, 'match_same_1');
  assert.equal(result.matches[0].matchType, 'same-story');
  assert.equal(result.sourceCount, 2);
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

  const morningDate = new Date(2026, 10, 12, 9, 0, 0).getTime();
  const briefing = buildDailyBriefing(articles, morningDate);

  assert.equal(briefing.editionTitle, 'Morning Briefing');
  assert.equal(briefing.stories.length, 5);
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

test('recordArticleReadInHabit tracks daily goal, streak, and persistent Wrapped stats history', () => {
  const initialState: ReadingHabitState = {
    dailyGoal: 3,
    todayDate: '2026-11-11',
    todayReadIds: ['old1', 'old2', 'old3'],
    todayMinutes: 10,
    streakDays: 2,
    lastCompletedDate: '2026-11-11',
  };

  const step1 = recordArticleReadInHabit(initialState, 'art_1', 4, '2026-11-12', {
    title: 'Solar Milestone',
    feedId: 'f1',
    feedTitle: 'The Daily Star',
    tags: ['tag_markets'],
  });
  assert.equal(step1.nextState.todayReadIds.length, 1);
  assert.equal(step1.justHitDailyGoal, false);
  assert.equal(step1.nextState.streakDays, 2);

  const step2 = recordArticleReadInHabit(step1.nextState, 'art_2', 3, '2026-11-12', {
    title: 'Grid Storage',
    feedId: 'f1',
    feedTitle: 'The Daily Star',
    tags: ['tag_tech'],
  });
  const step3 = recordArticleReadInHabit(step2.nextState, 'art_3', 5, '2026-11-12', {
    title: 'Tariff Stability',
    feedId: 'f2',
    feedTitle: 'BBC News',
    tags: ['tag_world'],
  });

  assert.equal(step3.nextState.todayReadIds.length, 3);
  assert.equal(step3.justHitDailyGoal, true);
  assert.equal(step3.nextState.streakDays, 3);
  assert.equal(step3.nextState.todayMinutes, 12);
  assert.equal(step3.nextState.totalReadIds?.length, 3);
  assert.equal(step3.nextState.readHistory?.length, 3);
});

test('computeSpotifyReadingStats aggregates top sources, beats, minutes, and Reader Aura', () => {
  const feeds: Feed[] = [
    { id: 'f1', title: 'The Daily Star', url: 'https://thedailystar.net/rss.xml', category: '', defaultTags: ['tag_markets'] },
    { id: 'f2', title: 'TechCrunch', url: 'https://techcrunch.com/feed', category: '', defaultTags: ['tag_tech'] },
  ];
  const tags: Tag[] = [
    { id: 'tag_markets', name: 'Economy & Finance', color: '#0D9488' },
    { id: 'tag_tech', name: 'Technology', color: '#4338CA' },
  ];
  const articles: FeedItem[] = [
    makeArticle({ id: 'a1', feedId: 'f1', feedTitle: 'The Daily Star', title: 'Macro A', readTimeMin: 5, isRead: true, tags: ['tag_markets'] }),
    makeArticle({ id: 'a2', feedId: 'f1', feedTitle: 'The Daily Star', title: 'Macro B', readTimeMin: 4, isRead: true, tags: ['tag_markets'] }),
    makeArticle({ id: 'a3', feedId: 'f2', feedTitle: 'TechCrunch', title: 'Chip C', readTimeMin: 6, isRead: true, tags: ['tag_tech'] }),
  ];

  const habit: ReadingHabitState = {
    dailyGoal: 3,
    todayDate: '2026-11-12',
    todayReadIds: ['a1', 'a2', 'a3'],
    todayMinutes: 15,
    streakDays: 4,
    lastCompletedDate: '2026-11-12',
    totalReadIds: ['a1', 'a2', 'a3'],
    totalMinutes: 15,
    sourceReadCounts: { f1: 2, f2: 1 },
  };

  const stats = computeSpotifyReadingStats(habit, articles, feeds, tags);
  assert.equal(stats.totalStoriesRead, 3);
  assert.equal(stats.totalMinutesRead, 15);
  assert.equal(stats.estimatedWordsRead, 3300);
  assert.equal(stats.topSources[0].rank, 1);
  assert.equal(stats.topSources[0].title, 'The Daily Star');
  assert.equal(stats.topSources[0].storyCount, 2);
  assert.equal(stats.topGenres[0].name, 'Economy & Finance');
  assert.equal(stats.readerAura.title, 'Macro Pulse Analyst');
});

test('normalizeReadingHabitState resets streak if a full day was missed while keeping persistent history', () => {
  const staleState: ReadingHabitState = {
    dailyGoal: 3,
    todayDate: '2026-11-09',
    todayReadIds: ['a', 'b', 'c'],
    todayMinutes: 9,
    streakDays: 5,
    lastCompletedDate: '2026-11-09',
    totalReadIds: ['a', 'b', 'c'],
    totalMinutes: 9,
  };

  const normalized = normalizeReadingHabitState(staleState, '2026-11-12');
  assert.equal(normalized.todayDate, '2026-11-12');
  assert.equal(normalized.todayReadIds.length, 0);
  assert.equal(normalized.streakDays, 0);
  assert.equal(normalized.totalReadIds?.length, 3);
  assert.equal(normalized.totalMinutes, 9);
});

test('findNewIncomingArticles returns only articles not already present by id or link', () => {
  const existing = [
    makeArticle({ id: '1', title: 'Existing 1', link: 'https://www.thedailystar.net/1' }),
    makeArticle({ id: '2', title: 'Existing 2', link: 'https://www.thedailystar.net/2' }),
  ];
  const incoming = [
    makeArticle({ id: '2', title: 'Existing 2', link: 'https://www.thedailystar.net/2' }),
    makeArticle({ id: '3', title: 'Brand New 3', link: 'https://www.thedailystar.net/3' }),
  ];

  const diff = findNewIncomingArticles(existing, incoming);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].id, '3');
});

test('filterOutAlreadyReadIncoming and clearReadArticlesForRefresh prevent read stories from returning on refresh', () => {
  const readStory = makeArticle({
    id: 'art_read_1',
    feedId: 'f1',
    title: 'Already read story',
    link: 'https://www.thedailystar.net/news/story-1/?utm_source=rss',
    isRead: true,
    isBookmarked: false,
  });
  const savedReadStory = makeArticle({
    id: 'art_saved_read',
    feedId: 'f1',
    title: 'Bookmarked read story',
    link: 'https://www.thedailystar.net/news/story-2',
    isRead: true,
    isBookmarked: true,
  });
  const unreadStory = makeArticle({
    id: 'art_unread_1',
    feedId: 'f1',
    title: 'Unread story still in feed',
    link: 'https://www.thedailystar.net/news/story-3',
    isRead: false,
  });

  const { nextArticles, newlyRecordedKeys } = clearReadArticlesForRefresh([
    readStory,
    savedReadStory,
    unreadStory,
  ]);

  assert.equal(nextArticles.some((a) => a.id === 'art_read_1'), false);
  const keptSaved = nextArticles.find((a) => a.id === 'art_saved_read');
  assert.ok(keptSaved);
  assert.equal(keptSaved.hiddenFromFeed, true);
  assert.equal(nextArticles.some((a) => a.id === 'art_unread_1'), true);

  const readKeys = new Set(newlyRecordedKeys);
  const incomingFromRss = [
    makeArticle({
      id: 'art_read_1_new_guid',
      feedId: 'f1',
      title: 'Already read story',
      link: 'https://www.thedailystar.net/news/story-1',
      isRead: false,
    }),
    makeArticle({
      id: 'art_brand_new',
      feedId: 'f1',
      title: 'Fresh breaking report',
      link: 'https://www.thedailystar.net/news/story-4',
      isRead: false,
    }),
  ];

  const filteredIncoming = filterOutAlreadyReadIncoming(incomingFromRss, readKeys);
  assert.equal(filteredIncoming.length, 1);
  assert.equal(filteredIncoming[0].id, 'art_brand_new');
  assert.equal(
    canonicalizeArticleLink('https://www.thedailystar.net/news/story-1/?utm_source=rss'),
    'https://thedailystar.net/news/story-1'
  );
});
