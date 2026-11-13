import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReadTime,
  stripHtml,
  formatRelativeTime,
  parseXmlFeed,
  parseHtmlPortalToFeed,
  filterArticles,
  buildRssDiscoveryCandidates,
  extractReadableArticleFromHtml,
} from './feedParser';
import type { FeedItem } from '../types';

test('calculateReadTime returns accurate minutes based on word count', () => {
  assert.equal(calculateReadTime(''), 1);
  assert.equal(calculateReadTime('short title with six words here'), 1);
  
  // 440 words should be 2 minutes
  const words440 = Array(440).fill('word').join(' ');
  assert.equal(calculateReadTime(words440), 2);

  // 1100 words should be 5 minutes
  const words1100 = Array(1100).fill('article').join(' ');
  assert.equal(calculateReadTime(words1100), 5);
});

test('stripHtml cleans HTML tags and entities', () => {
  const dirty = '<p>Hello <strong>world</strong> &amp; friends! <script>alert(1)</script></p>';
  const clean = stripHtml(dirty);
  assert.equal(clean, 'Hello world & friends!');
});

test('formatRelativeTime formats timestamps cleanly', () => {
  const now = Date.now();
  assert.equal(formatRelativeTime(now - 10 * 1000), 'Just now');
  assert.equal(formatRelativeTime(now - 5 * 60 * 1000), '5m ago');
  assert.equal(formatRelativeTime(now - 3 * 3600 * 1000), '3h ago');
});

test('parseXmlFeed correctly parses RSS 2.0 XML with enclosures and categories', () => {
  const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel>
      <title>The Daily Chronicle</title>
      <link>https://example.com</link>
      <description>World News</description>
      <item>
        <title>Breakthrough in Global Climate Policy</title>
        <link>https://example.com/climate-breakthrough</link>
        <pubDate>Mon, 10 Nov 2026 12:00:00 GMT</pubDate>
        <author>Jane Reporter</author>
        <description>&lt;p&gt;Delegates reach a historic landmark accord today.&lt;/p&gt;</description>
        <content:encoded>&lt;p&gt;Delegates reached a historic landmark accord in Geneva today following weeks of deliberation.&lt;/p&gt;</content:encoded>
        <enclosure url="https://example.com/photo.jpg" type="image/jpeg" length="12345" />
      </item>
    </channel>
  </rss>`;

  const result = parseXmlFeed(mockRss, {
    id: 'feed_daily',
    title: 'The Daily Chronicle',
    url: 'https://example.com/rss',
    defaultTags: ['news', 'world'],
  });

  assert.equal(result.feedTitle, 'The Daily Chronicle');
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.title, 'Breakthrough in Global Climate Policy');
  assert.equal(item.author, 'Jane Reporter');
  assert.equal(item.imageUrl, 'https://example.com/photo.jpg');
  assert.deepEqual(item.tags, ['news', 'world']);
  assert.equal(item.isOfflineCached, true);
});

test('filterArticles filters by tag, unread status, bookmark status, and search query', () => {
  const sampleArticles: FeedItem[] = [
    {
      id: '1',
      feedId: 'f1',
      feedTitle: 'New York Times',
      feedUrl: 'https://nyt.com/rss',
      title: 'Global Markets Rally on Tech Surge',
      link: 'https://nyt.com/1',
      pubDate: '2026-11-10T10:00:00Z',
      timestamp: 1000,
      summary: 'Tech stocks climbed to record highs.',
      contentHtml: '<p>Tech stocks climbed</p>',
      contentClean: 'Tech stocks climbed',
      tags: ['markets', 'tech'],
      isRead: false,
      isBookmarked: true,
      isOfflineCached: true,
      readTimeMin: 2,
    },
    {
      id: '2',
      feedId: 'f2',
      feedTitle: 'BBC News',
      feedUrl: 'https://bbc.com/rss',
      title: 'Archaeologists Discover Ancient Library',
      link: 'https://bbc.com/2',
      pubDate: '2026-11-10T09:00:00Z',
      timestamp: 900,
      summary: 'A 2000-year-old archive was uncovered.',
      contentHtml: '<p>Archive uncovered</p>',
      contentClean: 'Archive uncovered',
      tags: ['culture', 'history'],
      isRead: true,
      isBookmarked: false,
      isOfflineCached: true,
      readTimeMin: 4,
    },
  ];

  // Test tag filter
  const marketFiltered = filterArticles(sampleArticles, { selectedTagId: 'markets' });
  assert.equal(marketFiltered.length, 1);
  assert.equal(marketFiltered[0].id, '1');

  // Test unread filter
  const unreadFiltered = filterArticles(sampleArticles, { filterMode: 'unread' });
  assert.equal(unreadFiltered.length, 1);
  assert.equal(unreadFiltered[0].id, '1');

  // Test bookmark filter
  const bookmarkedFiltered = filterArticles(sampleArticles, { filterMode: 'bookmarked' });
  assert.equal(bookmarkedFiltered.length, 1);
  assert.equal(bookmarkedFiltered[0].id, '1');

  // Test search query
  const searchFiltered = filterArticles(sampleArticles, { searchQuery: 'ancient library' });
  assert.equal(searchFiltered.length, 1);
  assert.equal(searchFiltered[0].id, '2');
});

test('parseXmlFeed successfully parses feeds with unclosed HTML tags in description (like The Daily Star)', () => {
  const dailyStarStyleXml = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0">
    <channel>
      <title>The Daily Star</title>
      <link>https://www.thedailystar.net/</link>
      <item>
        <title>Renewable Energy Transition in South Asia</title>
        <link>https://www.thedailystar.net/news/energy/1</link>
        <pubDate>Mon, 01 Jun 2026 10:43:08 +0000</pubDate>
        <description><img src="/sites/default/files/solar.jpg"> <p>Detailed investigative report on energy grid upgrades.</p></description>
      </item>
      <item>
        <title>Preserving Historical Bengali Architectural Heritage</title>
        <link>https://www.thedailystar.net/news/culture/2</link>
        <pubDate>Sun, 31 May 2026 08:00:00 +0000</pubDate>
        <description><img src="/sites/default/files/heritage.jpg"> <p>Efforts to safeguard centuries-old terracotta structures.</p></description>
      </item>
    </channel>
  </rss>`;

  const result = parseXmlFeed(dailyStarStyleXml, {
    id: 'feed_dailystar',
    title: 'The Daily Star',
    url: 'https://www.thedailystar.net/rss.xml',
    defaultTags: ['tag_world'],
  });

  assert.equal(result.feedTitle, 'The Daily Star');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, 'Renewable Energy Transition in South Asia');
  assert.equal(result.items[0].imageUrl, 'https://www.thedailystar.net/sites/default/files/solar.jpg');
  assert.equal(result.items[1].title, 'Preserving Historical Bengali Architectural Heritage');
  assert.equal(result.items[1].imageUrl, 'https://www.thedailystar.net/sites/default/files/heritage.jpg');
});

test('parseHtmlPortalToFeed extracts news articles directly from Bangladeshi news portal HTML without RSS', () => {
  const samplePortalHtml = `<!DOCTYPE html>
  <html>
    <head>
      <title>bdnews24.com - Bangladesh News Portal</title>
      <meta property="og:site_name" content="bdnews24.com" />
    </head>
    <body>
      <nav>
        <a href="/about">About Us</a>
        <a href="/category/bangladesh">Bangladesh</a>
      </nav>
      <main>
        <article>
          <a href="/bangladesh/708mysm1cv">
            <h2>Metro Rail Phase Two Expansion Approved in Dhaka</h2>
            <img src="https://media.bdnews24.com/metro-rail.jpg" />
          </a>
        </article>
        <article>
          <a href="https://bdnews24.com/economy/export-growth-remittance-surge-2026">
            <h3> Garment Exports and Remittance Inflows Reach New Quarterly High </h3>
          </a>
        </article>
      </main>
    </body>
  </html>`;

  const result = parseHtmlPortalToFeed(samplePortalHtml, {
    id: 'bdnews24',
    title: 'Newspaper Feed',
    url: 'https://bdnews24.com',
    defaultTags: ['tag_bd'],
  });

  assert.equal(result.feedTitle, 'bdnews24.com');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, 'Metro Rail Phase Two Expansion Approved in Dhaka');
  assert.equal(result.items[0].link, 'https://bdnews24.com/bangladesh/708mysm1cv');
  assert.equal(result.items[0].imageUrl, 'https://media.bdnews24.com/metro-rail.jpg');
  assert.equal(result.items[1].title, 'Garment Exports and Remittance Inflows Reach New Quarterly High');

  // Verify selectedFeedId filtering isolates only the clicked source
  const mixedArticles = [
    ...result.items,
    {
      ...result.items[0],
      id: 'other_1',
      feedId: 'prothom_alo',
      feedTitle: 'Prothom Alo',
    },
  ];
  const onlyBdnews = filterArticles(mixedArticles, { selectedFeedId: 'bdnews24' });
  assert.equal(onlyBdnews.length, 2);
  assert.equal(onlyBdnews.every((a) => a.feedId === 'bdnews24'), true);
});

test('extractReadableArticleFromHtml extracts clean reader content on standalone iOS IPA', async () => {
  const { extractReadableArticleFromHtml } = await import('./nativeFetcher');
  const articleHtml = `<!DOCTYPE html>
  <html>
    <head>
      <meta property="og:title" content="Padma Bridge Rail Link Boosts Regional Trade" />
      <meta property="og:image" content="/images/padma-rail.jpg" />
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "headline": "Padma Bridge Rail Link Boosts Regional Trade",
          "author": { "@type": "Person", "name": "Staff Correspondent" },
          "articleBody": "Freight and passenger train services across the Padma Bridge have significantly reduced travel times between Dhaka and southwestern districts.\\n\\nEconomists say agricultural producers are now reaching capital markets in record time."
        }
      </script>
    </head>
    <body>
      <article>
        <p>Freight and passenger train services across the Padma Bridge have significantly reduced travel times between Dhaka and southwestern districts.</p>
      </article>
    </body>
  </html>`;

  const extracted = extractReadableArticleFromHtml(articleHtml, 'https://en.prothomalo.com/bangladesh/padma-rail');
  assert.equal(extracted.title, 'Padma Bridge Rail Link Boosts Regional Trade');
  assert.equal(extracted.author, 'Staff Correspondent');
  assert.equal(extracted.leadImage, 'https://en.prothomalo.com/images/padma-rail.jpg');
  assert.equal(extracted.paragraphCount >= 2, true);
  assert.equal(extracted.contentClean.includes('agricultural producers'), true);
});

test('buildRssDiscoveryCandidates discovers <link rel="alternate" type="application/rss+xml"> and standard RSS paths', () => {
  const html = `<!DOCTYPE html>
  <html>
    <head>
      <link rel="alternate" type="application/rss+xml" title="Prothom Alo RSS" href="/feed/latest-rss.xml" />
    </head>
    <body></body>
  </html>`;

  const candidates = buildRssDiscoveryCandidates('https://www.prothomalo.com', html);
  assert.equal(candidates[0], 'https://www.prothomalo.com/feed/latest-rss.xml');
  assert.equal(candidates.includes('https://www.prothomalo.com/feed'), true);
  assert.equal(candidates.includes('https://www.prothomalo.com/rss.xml'), true);
});

test('extractReadableArticleFromHtml strips "turn on JavaScript" warnings and extracts Quintype/br-separated content', () => {
  const htmlWithJsWarning = `<!DOCTYPE html>
  <html>
    <head>
      <title> Central Bank Announces New Monetary Policy Framework </title>
    </head>
    <body>
      <noscript><p>Please turn on JavaScript to read the full content of this newspaper.</p></noscript>
      <p>You need to enable JavaScript to run this app.</p>
      <div class="news-details">
        The central bank unveiled its semi-annual monetary policy today aiming to curb inflation and stabilize foreign exchange reserves across commercial banks.<br><br>
        Senior economists noted that tighter credit growth ceilings and market-based interest rates are expected to ease pressure on import payments over the coming quarter.
      </div>
    </body>
  </html>`;

  const res = extractReadableArticleFromHtml(htmlWithJsWarning, 'https://www.jugantor.com/economics/101');
  assert.equal(res.success, true);
  assert.equal(/turn on javascript|enable javascript/i.test(res.contentClean), false);
  assert.equal(res.blocks.some((b) => b.text?.includes('central bank unveiled')), true);
  assert.equal(res.blocks.some((b) => b.text?.includes('Senior economists noted')), true);
});

test('parseXmlFeed unwraps Bing News apiclick redirect URLs to direct newspaper links', () => {
  const bingRss = `<?xml version="1.0" encoding="utf-8" ?>
  <rss version="2.0" xmlns:News="https://www.bing.com:443/news/search?q=site:jugantor.com&amp;format=rss">
    <channel>
      <title>site:jugantor.com - Bing News</title>
      <item>
        <title>জাতীয় অর্থনীতিতে প্রবাসী আয়ের নতুন রেকর্ড</title>
        <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=123&amp;url=https%3a%2f%2fwww.jugantor.com%2fnational%2f998877&amp;c=456&amp;mkt=en-us</link>
        <description>চলতি মাসে প্রবাসী আয়ে নতুন গতি এসেছে বলে জানিয়েছে বাংলাদেশ ব্যাংক।</description>
        <pubDate>Mon, 10 Nov 2026 10:00:00 GMT</pubDate>
        <News:Image>https://www.bing.com/th?id=OVFT.testimg</News:Image>
      </item>
    </channel>
  </rss>`;

  const parsed = parseXmlFeed(bingRss, {
    id: 'jugantor',
    title: 'Daily Jugantor',
    url: 'https://www.jugantor.com',
  });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].link, 'https://www.jugantor.com/national/998877');
  assert.equal(parsed.items[0].imageUrl, 'https://www.bing.com/th?id=OVFT.testimg');
});

test('validateSafeExternalUrl and isPrivateOrReservedIp block SSRF private, loopback, link-local, and metadata addresses', async () => {
  const { isPrivateOrReservedIp, checkSafeExternalUrl } = await import('./urlSecurity');

  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.42'), true);
  assert.equal(isPrivateOrReservedIp('172.16.5.1'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.100'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);

  assert.equal(checkSafeExternalUrl('http://127.0.0.1:8080/admin').ok, false);
  assert.equal(checkSafeExternalUrl('http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(checkSafeExternalUrl('http://localhost:3000/api/rss').ok, false);
  assert.equal(checkSafeExternalUrl('file:///etc/passwd').ok, false);
  assert.equal(checkSafeExternalUrl('https://www.thedailystar.net/rss.xml').ok, true);
});

test('truncateHtmlSafely truncates at block boundaries without cutting mid-tag', async () => {
  const { truncateHtmlSafely } = await import('./urlSecurity');
  const html =
    '<article><p>First complete paragraph with important context.</p><p>Second paragraph with <a href="https://example.com/very/long/path">a link inside</a> and more text that exceeds the budget.</p></article>';
  const truncated = truncateHtmlSafely(html, 75);
  assert.equal(truncated.includes('<a href="https://example.com'), false);
  assert.equal(truncated.endsWith('</article>'), true);
  assert.equal((truncated.match(/</g) || []).length, (truncated.match(/>/g) || []).length);
});

test('parseFeedDate does not fall back to Date.now() for unparseable dates and blogs.json timestamps match publishedAt', async () => {
  const { parseFeedDate, UNDATED_FALLBACK_EPOCH } = await import('./feedParser');
  const fs = await import('node:fs');

  const invalid = parseFeedDate('not-a-valid-date', 2);
  assert.equal(invalid.hasValidDate, false);
  assert.equal(invalid.timestamp <= UNDATED_FALLBACK_EPOCH, true);
  assert.equal(formatRelativeTime(invalid.timestamp), '');

  const blogsRaw = JSON.parse(fs.readFileSync('data/blogs.json', 'utf-8'));
  for (const blog of blogsRaw) {
    assert.equal(blog.timestamp, Date.parse(blog.publishedAt));
  }
});

test('parseHtmlPortalToFeed extracts at least 50 unique articles from a rich newspaper homepage', () => {
  const anchors = Array.from({ length: 65 }, (_, i) => {
    const idx = i + 1;
    return `<article><a href="/bangladesh/story-report-update-${idx}"><h3>Major Economic and Infrastructure Update Headline Number ${idx}</h3></a></article>`;
  }).join('\n');
  const portalHtml = `<!DOCTYPE html><html><head><title>Large Portal</title></head><body><main>${anchors}</main></body></html>`;

  const parsed = parseHtmlPortalToFeed(portalHtml, {
    id: 'large_portal',
    title: 'Large Portal',
    url: 'https://largeportal.example.com',
  });
  assert.ok(parsed.items.length >= 50, `Expected >= 50 items, got ${parsed.items.length}`);
});

