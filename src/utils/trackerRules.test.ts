import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stripTrackingParams,
  isTrackerUrl,
  isTrackingPixel,
  TRACKER_HOST_PATTERNS,
} from './trackerRules';

test('stripTrackingParams removes utm_source, utm_medium, and fbclid while preserving legitimate params and hash', () => {
  const input = 'https://news.example.com/story?utm_source=twitter&page=2&utm_medium=social&fbclid=12345#comments';
  const output = stripTrackingParams(input);
  assert.equal(output, 'https://news.example.com/story?page=2#comments');

  const onlyTracking = 'https://news.example.com/story?utm_source=rss&fbclid=xyz';
  assert.equal(stripTrackingParams(onlyTracking), 'https://news.example.com/story');

  const withTrailingQuestion = 'https://news.example.com/story?';
  assert.equal(stripTrackingParams(withTrailingQuestion), 'https://news.example.com/story');
});

test('stripTrackingParams leaves non-http(s) and invalid input unchanged without throwing', () => {
  assert.equal(stripTrackingParams('not a url'), 'not a url');
  assert.equal(stripTrackingParams('/relative/path?utm_source=1'), '/relative/path?utm_source=1');
  assert.equal(stripTrackingParams('ftp://example.com/file?utm_source=1'), 'ftp://example.com/file?utm_source=1');
  assert.equal(stripTrackingParams(''), '');
});

test('isTrackingPixel identifies 1x1, 0x0, hidden styles, and tracker src correctly', () => {
  assert.equal(isTrackingPixel({ width: '1', height: '1' }), true);
  assert.equal(isTrackingPixel({ width: '0', height: '0' }), true);
  assert.equal(isTrackingPixel({ width: '1px' }), true);
  assert.equal(isTrackingPixel({ height: '0px' }), true);

  assert.equal(isTrackingPixel({ style: 'display: none;' }), true);
  assert.equal(isTrackingPixel({ style: 'visibility: hidden;' }), true);
  assert.equal(isTrackingPixel({ style: 'opacity: 0' }), true);
  assert.equal(isTrackingPixel({ style: 'width: 1px; height: 1px;' }), true);

  assert.equal(isTrackingPixel({ src: 'https://pixel.wp.com/b.gif' }), true);

  assert.equal(
    isTrackingPixel({
      width: '600',
      height: '400',
      style: 'border-radius: 8px;',
      src: 'https://news.example.com/cover.jpg',
    }),
    false
  );
});

test('isTrackerUrl detects each listed tracker host and its subdomains, and allows normal news sites', () => {
  for (const pattern of TRACKER_HOST_PATTERNS) {
    const testPath = pattern.pathPrefix ? `${pattern.pathPrefix}click` : '/track.gif';
    const directUrl = `https://${pattern.host}${testPath}`;
    const subUrl = `https://analytics.${pattern.host}${testPath}`;
    assert.equal(isTrackerUrl(directUrl), true, `Expected ${directUrl} to be flagged`);
    assert.equal(isTrackerUrl(subUrl), true, `Expected ${subUrl} to be flagged`);
  }

  assert.equal(isTrackerUrl('https://feeds.feedburner.com/normal-path'), false);
  assert.equal(isTrackerUrl('https://substack.com/post/123'), false);
  assert.equal(isTrackerUrl('https://list-manage.com/about'), false);

  assert.equal(isTrackerUrl('https://www.nytimes.com/world'), false);
  assert.equal(isTrackerUrl('https://en.prothomalo.com/bangladesh'), false);
  assert.equal(isTrackerUrl('https://bbc.com/news'), false);
});
