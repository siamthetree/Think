import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Initialize DOM environment for DOMPurify before importing sanitize
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Node = dom.window.Node;

import { sanitizeArticleHtml } from './sanitize';

test('sanitizeArticleHtml strips tracking pixels and tracker scripts', () => {
  const dirty = `
    <div>
      <p>Clean paragraph.</p>
      <img src="https://pixel.wp.com/b.gif?v=noscript" width="1" height="1" alt="" />
      <img src="https://doubleclick.net/tracker.png" alt="" />
      <img src="https://example.com/pixel.png" style="display:none; width:1px; height:1px" />
      <script>alert("evil")</script>
    </div>
  `;
  const clean = sanitizeArticleHtml(dirty);
  assert.ok(!clean.includes('pixel.wp.com'), 'pixel.wp.com should be removed');
  assert.ok(!clean.includes('doubleclick.net'), 'doubleclick.net should be removed');
  assert.ok(!clean.includes('example.com/pixel.png'), 'hidden pixel should be removed');
  assert.ok(!clean.includes('<script'), 'script tag should be removed');
  assert.ok(clean.includes('Clean paragraph'), 'clean text should be preserved');
});

test('sanitizeArticleHtml strips tracker link tags but keeps inner text', () => {
  const dirty = '<p>Read more on <a href="https://substack.com/o/feed-click-token">Substack Link</a> today.</p>';
  const clean = sanitizeArticleHtml(dirty);
  assert.ok(!clean.includes('href="https://substack.com/o/'), 'tracker link should be removed');
  assert.ok(clean.includes('Substack Link'), 'inner link text should be preserved');
});

test('sanitizeArticleHtml enforces rel and referrerpolicy on regular links', () => {
  const input = '<p><a href="https://news.ycombinator.com">Hacker News</a></p>';
  const clean = sanitizeArticleHtml(input);
  assert.ok(clean.includes('rel="noopener noreferrer"'), 'rel should be enforced');
  assert.ok(clean.includes('referrerpolicy="no-referrer"'), 'referrerpolicy should be enforced');
});

test('sanitizeArticleHtml blocks third-party media and marks with tap-to-load when enabled', () => {
  const dirty = `
    <div>
      <img src="https://thirdparty.org/image.jpg" alt="Remote ad" />
      <img src="https://news.bbc.co.uk/media/photo.jpg" alt="BBC article photo" />
    </div>
  `;
  const clean = sanitizeArticleHtml(dirty, {
    publisherUrl: 'https://bbc.co.uk/news/world',
    blockThirdPartyMedia: true,
  });

  // Third party should be replaced with placeholder data URI and data-chinta-blocked
  assert.ok(clean.includes('data-chinta-blocked="1"'), 'third-party image should be blocked');
  assert.ok(clean.includes('data-chinta-src="https://thirdparty.org/image.jpg"'), 'original src preserved in data-chinta-src');
  // First party BBC image should be allowed and proxied through proxy
  assert.ok(clean.includes('/api/image-proxy?url='), 'first-party image should be proxied');
});

test('sanitizeArticleHtml replaces all images with tap-to-load when tapToLoadMedia is true', () => {
  const dirty = '<p><img src="https://bbc.co.uk/photo.jpg" alt="Photo" /></p>';
  const clean = sanitizeArticleHtml(dirty, {
    publisherUrl: 'https://bbc.co.uk',
    tapToLoadMedia: true,
  });
  assert.ok(clean.includes('data-chinta-blocked="1"'), 'tap-to-load should block all images');
  assert.ok(clean.includes('data-chinta-src="https://bbc.co.uk/photo.jpg"'), 'src preserved');
});
