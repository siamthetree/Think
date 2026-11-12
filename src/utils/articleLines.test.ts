import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTextSelection,
  splitParagraphIntoLines,
  extractSelectableArticleLines,
  composeSelectedQuote,
} from './articleLines';

test('sanitizeTextSelection normalizes whitespace and rejects tiny selections', () => {
  assert.equal(sanitizeTextSelection('   hi  '), '');
  assert.equal(
    sanitizeTextSelection('  Inflation cooled   sharply\nacross major cities. '),
    'Inflation cooled sharply across major cities.'
  );
});

test('splitParagraphIntoLines preserves abbreviations and decimals across English and Bengali', () => {
  const en =
    'The U.S. Treasury expects 3.5 percent growth this year. Analysts welcomed the policy shift immediately! Will borrowing costs drop next quarter?';
  const lines = splitParagraphIntoLines(en);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /3\.5 percent growth/);

  const bn = 'কেন্দ্রীয় ব্যাংক নতুন নীতি ঘোষণা করেছে। এতে বাজারে ইতিবাচক প্রভাব পড়েছে।';
  const bnLines = splitParagraphIntoLines(bn);
  assert.equal(bnLines.length, 2);
});

test('extractSelectableArticleLines extracts deduplicated clean lines from HTML or text and filters JS boilerplate', () => {
  const lines = extractSelectableArticleLines({
    contentHtml:
      '<p>First major sentence from the report on renewable grids.</p><p>Please turn on JavaScript to view this page.</p><p>Second major sentence detailing solar storage costs falling by half.</p>',
    title: 'Grid Storage Costs Fall',
  });
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'First major sentence from the report on renewable grids.');
  assert.equal(lines[1], 'Second major sentence detailing solar storage costs falling by half.');
  assert.equal(lines[2], 'Grid Storage Costs Fall');
});

test('composeSelectedQuote combines tapped lines in natural reading order', () => {
  const lines = ['Line zero.', 'Line one.', 'Line two.'];
  assert.equal(composeSelectedQuote(lines, [2, 0], 'Fallback'), 'Line zero. Line two.');
  assert.equal(composeSelectedQuote(lines, [], 'Fallback'), 'Fallback');
});
