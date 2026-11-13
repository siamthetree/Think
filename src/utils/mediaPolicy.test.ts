import test from 'node:test';
import assert from 'node:assert/strict';
import { isFirstPartyMedia, getRegistrableDomain } from './mediaPolicy';

test('getRegistrableDomain extracts domains with two-part suffixes correctly', () => {
  assert.equal(getRegistrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(getRegistrableDomain('en.prothomalo.com.bd'), 'prothomalo.com.bd');
  assert.equal(getRegistrableDomain('theguardian.com'), 'theguardian.com');
  assert.equal(getRegistrableDomain('media.theage.com.au'), 'theage.com.au');
});

test('isFirstPartyMedia allows same domain, subdomains, publisher CDNs, and blocks third-party ad hosts', () => {
  // Same domain
  assert.equal(
    isFirstPartyMedia('https://example.com/images/hero.jpg', 'https://example.com/article/1'),
    true
  );

  // Subdomain on standard TLD
  assert.equal(
    isFirstPartyMedia('https://media.example.com/images/hero.jpg', 'https://example.com/article/1'),
    true
  );

  // Subdomain on .com.bd publisher
  assert.equal(
    isFirstPartyMedia('https://media.prothomalo.com.bd/pic.jpg', 'https://en.prothomalo.com.bd/story'),
    true
  );

  // BBC ichef CDN
  assert.equal(
    isFirstPartyMedia('https://ichef.bbci.co.uk/news/1024/branded_news/abc.jpg', 'https://www.bbc.com/news/123'),
    true
  );
  assert.equal(
    isFirstPartyMedia('https://ichef.bbci.co.uk/news/1024/branded_news/abc.jpg', 'https://www.bbc.co.uk/news/123'),
    true
  );

  // Guardian i.guim and media.guim CDNs
  assert.equal(
    isFirstPartyMedia('https://i.guim.co.uk/img/media/xyz.jpg', 'https://www.theguardian.com/world/article'),
    true
  );
  assert.equal(
    isFirstPartyMedia('https://media.guim.co.uk/img/media/xyz.jpg', 'https://www.theguardian.com/world/article'),
    true
  );

  // Unrelated ad or tracker host is blocked
  assert.equal(
    isFirstPartyMedia('https://adserver.doubleclick.net/ad.png', 'https://www.bbc.com/news/123'),
    false
  );
  assert.equal(
    isFirstPartyMedia('https://tracker.pixel.wp.com/p.gif', 'https://en.prothomalo.com.bd/story'),
    false
  );
  assert.equal(
    isFirstPartyMedia('https://random-cdn.com/asset.png', 'https://example.com/article'),
    false
  );
});
