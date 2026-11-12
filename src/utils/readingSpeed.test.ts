import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_ARTICLE_THRESHOLD,
  DEFAULT_BN_WPM,
  DEFAULT_EN_WPM,
  countWords,
  createDefaultReadingSpeedProfile,
  detectArticleLanguage,
  estimateArticleReadTime,
  recordCompletedReadingSession,
} from './readingSpeed';

function makeEnglishText(wordCount: number): string {
  const sample = ['grid', 'battery', 'energy', 'coastal', 'system', 'policy', 'market', 'report'];
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    out.push(sample[i % sample.length]);
  }
  return out.join(' ');
}

function makeBanglaText(wordCount: number): string {
  const sample = ['বাংলাদেশ', 'অর্থনীতি', 'বিদ্যুৎ', 'প্রকল্প', 'উন্নয়ন', 'বাজার', 'প্রতিবেদন', 'শহর'];
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    out.push(sample[i % sample.length]);
  }
  return out.join(' ');
}

test('detectArticleLanguage distinguishes Bangla and English accurately even with mixed brand names', () => {
  assert.equal(detectArticleLanguage(makeEnglishText(120)), 'en');
  assert.equal(
    detectArticleLanguage(`${makeBanglaText(80)} BBC News USD AI`),
    'bn'
  );
});

test('uses baseline speed before 15 observed articles and concludes personalized English vs Bangla speeds at 15 articles', () => {
  let profile = createDefaultReadingSpeedProfile();
  const en10k = makeEnglishText(10000);
  const bn10k = makeBanglaText(10000);

  // Before 15 English observations: uses baseline English speed (220 WPM)
  for (let i = 1; i < CALIBRATION_ARTICLE_THRESHOLD; i++) {
    const res = recordCompletedReadingSession(profile, {
      articleId: `en_${i}`,
      text: en10k,
      activeMs: 5 * 60 * 1000, // 5 minutes for 10,000 words = 2,000 WPM
    });
    profile = res.nextProfile;
    assert.equal(res.recorded, true);
    assert.equal(res.language, 'en');
    assert.equal(res.justCalibrated, false);
    assert.equal(res.learnedWpm, null);
  }

  const preCalEstimate = estimateArticleReadTime({ contentClean: en10k }, profile);
  assert.equal(preCalEstimate.isPersonalized, false);
  assert.equal(preCalEstimate.wpmUsed, DEFAULT_EN_WPM);

  // 15th English article triggers conclusion -> 2,000 WPM (5 minutes for 10,000 words)
  const calEn = recordCompletedReadingSession(profile, {
    articleId: `en_${CALIBRATION_ARTICLE_THRESHOLD}`,
    text: en10k,
    activeMs: 5 * 60 * 1000,
  });
  profile = calEn.nextProfile;
  assert.equal(calEn.justCalibrated, true);
  assert.equal(calEn.learnedWpm, 2000);

  const postEnEstimate = estimateArticleReadTime({ contentClean: en10k }, profile);
  assert.equal(postEnEstimate.isPersonalized, true);
  assert.equal(postEnEstimate.language, 'en');
  assert.equal(postEnEstimate.minutes, 5);

  // Bangla remains uncalibrated until 15 Bangla articles are observed independently
  const preBnEstimate = estimateArticleReadTime({ contentClean: bn10k }, profile);
  assert.equal(preBnEstimate.isPersonalized, false);
  assert.equal(preBnEstimate.language, 'bn');
  assert.equal(preBnEstimate.wpmUsed, DEFAULT_BN_WPM);

  // Observe 15 Bangla articles of 10,000 words finished in 4 minutes each -> 2,500 WPM
  for (let i = 1; i <= CALIBRATION_ARTICLE_THRESHOLD; i++) {
    const res = recordCompletedReadingSession(profile, {
      articleId: `bn_${i}`,
      text: bn10k,
      activeMs: 4 * 60 * 1000,
    });
    profile = res.nextProfile;
    if (i === CALIBRATION_ARTICLE_THRESHOLD) {
      assert.equal(res.justCalibrated, true);
      assert.equal(res.learnedWpm, 2500);
    } else {
      assert.equal(res.justCalibrated, false);
    }
  }

  // English stays 5 minutes (2,000 WPM) while Bangla estimates 4 minutes (2,500 WPM)
  const finalEn = estimateArticleReadTime({ contentClean: en10k }, profile);
  const finalBn = estimateArticleReadTime({ contentClean: bn10k }, profile);
  assert.equal(finalEn.minutes, 5);
  assert.equal(finalBn.minutes, 4);
  assert.notEqual(finalEn.wpmUsed, finalBn.wpmUsed);
});

test('deduplicates re-opened articleId and ignores unrealistically brief or tiny snippets', () => {
  let profile = createDefaultReadingSpeedProfile();
  const en500 = makeEnglishText(500);

  // Too short duration (<5s) -> ignored
  const tooFast = recordCompletedReadingSession(profile, {
    articleId: 'a1',
    text: en500,
    activeMs: 1200,
  });
  assert.equal(tooFast.recorded, false);
  assert.equal(tooFast.observedCount, 0);

  // Tiny text (<40 words) -> ignored
  const tooTiny = recordCompletedReadingSession(profile, {
    articleId: 'a2',
    text: makeEnglishText(15),
    activeMs: 15000,
  });
  assert.equal(tooTiny.recorded, false);

  // Valid completion + duplicate completion of same articleId should keep observedCount === 1
  const first = recordCompletedReadingSession(profile, {
    articleId: 'a3',
    text: en500,
    activeMs: 60000,
  });
  profile = first.nextProfile;
  assert.equal(first.observedCount, 1);

  const second = recordCompletedReadingSession(profile, {
    articleId: 'a3',
    text: en500,
    activeMs: 65000,
  });
  assert.equal(second.observedCount, 1);
});

test('countWords ignores standalone punctuation tokens across English and Bangla', () => {
  assert.equal(countWords('Hello — world । বাংলাদেশ ২০২৬ !'), 4);
});
