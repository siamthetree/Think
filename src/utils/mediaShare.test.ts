import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  stripDataUrlPrefix,
  buildInstagramStoryDeepLink,
  buildInstagramStoryCameraDeepLink,
  buildFacebookStoryDeepLink,
  detectClientPlatform,
  guessImageExtensionFromMime,
  sanitizePhotoFilename,
  buildImageProxyUrl,
  DEFAULT_STORY_CARD_TRANSFORM,
  clampStoryCardTransform,
  computeTwoFingerTransform,
  isStoryTransformModified,
} from './mediaShare';
import { configureIosNativeProject } from '../../scripts/configure-ios-native.mjs';

test('stripDataUrlPrefix extracts pure base64 payload from PNG data URLs', () => {
  assert.equal(stripDataUrlPrefix('data:image/png;base64,iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(stripDataUrlPrefix('iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(stripDataUrlPrefix(''), '');
});

test('Meta Stories deep links include source_application, optional app_id, and music-ready camera link', () => {
  assert.equal(
    buildInstagramStoryDeepLink('app.chinta.reader'),
    'instagram-stories://share?source_application=app.chinta.reader'
  );
  assert.equal(
    buildInstagramStoryCameraDeepLink(),
    'instagram://story-camera'
  );
  assert.equal(
    buildFacebookStoryDeepLink('app.chinta.reader'),
    'facebook-stories://share?source_application=app.chinta.reader'
  );
  assert.equal(
    buildFacebookStoryDeepLink('app.chinta.reader', '123456'),
    'facebook-stories://share?source_application=app.chinta.reader&app_id=123456'
  );
});

test('detectClientPlatform identifies iOS (including iPadOS), Android, and Desktop browsers', () => {
  assert.equal(
    detectClientPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15',
      5
    ),
    'ios-web'
  );
  assert.equal(
    detectClientPlatform(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      5
    ),
    'ios-web'
  );
  assert.equal(
    detectClientPlatform(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36',
      5
    ),
    'android-web'
  );
  assert.equal(
    detectClientPlatform(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/134.0.0.0',
      0
    ),
    'desktop-web'
  );
});

test('guessImageExtensionFromMime and sanitizePhotoFilename produce safe gallery filenames', () => {
  assert.equal(guessImageExtensionFromMime('image/png'), 'png');
  assert.equal(guessImageExtensionFromMime('image/webp'), 'webp');
  assert.equal(guessImageExtensionFromMime('', 'https://www.thedailystar.net/photo.png?w=800'), 'png');
  assert.equal(
    sanitizePhotoFilename('Central Bank Cuts Policy Rate!', 'png'),
    'central-bank-cuts-policy-rate.png'
  );
  assert.equal(sanitizePhotoFilename('---', 'jpg'), 'chinta-photo.jpg');
});

test('buildImageProxyUrl validates safe external HTTP(S) URLs directly on-device and rejects unsafe or private URLs', () => {
  assert.equal(
    buildImageProxyUrl('https://www.prothomalo.com/img/cover.jpg?a=1&b=2'),
    'https://www.prothomalo.com/img/cover.jpg?a=1&b=2'
  );
  assert.equal(buildImageProxyUrl('javascript:alert(1)'), '');
  assert.equal(buildImageProxyUrl('http://127.0.0.1/secret.jpg'), '');
});

test('computeTwoFingerTransform scales, rotates across PI wraparound, pans midpoint, and snaps near 0deg', () => {
  // 1. Scale up 1.5x + pan right by 10%
  const scaled = computeTwoFingerTransform({
    startP1: { x: 80, y: 150 },
    startP2: { x: 120, y: 150 }, // dist 40, mid (100, 150)
    currP1: { x: 90, y: 150 },
    currP2: { x: 150, y: 150 }, // dist 60 (1.5x), mid (120, 150) -> +20px / 200 = +0.1
    baseTransform: DEFAULT_STORY_CARD_TRANSFORM,
    containerWidth: 200,
    containerHeight: 400,
  });
  assert.equal(scaled.scale, 1.5);
  assert.equal(scaled.offsetX, 0.1);
  assert.equal(scaled.rotationDeg, 0);
  assert.equal(isStoryTransformModified(scaled), true);

  // 2. Rotation across -PI / +PI boundary (e.g. 170deg -> -175deg = +15deg clockwise delta)
  const rad170 = (170 * Math.PI) / 180;
  const radNeg175 = (-175 * Math.PI) / 180;
  const rotated = computeTwoFingerTransform({
    startP1: { x: 100, y: 150 },
    startP2: { x: 100 + 50 * Math.cos(rad170), y: 150 + 50 * Math.sin(rad170) },
    currP1: { x: 100, y: 150 },
    currP2: { x: 100 + 50 * Math.cos(radNeg175), y: 150 + 50 * Math.sin(radNeg175) },
    baseTransform: DEFAULT_STORY_CARD_TRANSFORM,
    containerWidth: 200,
    containerHeight: 400,
  });
  assert.equal(Math.round(rotated.rotationDeg), 15);

  // 3. Tiny jitter within 2.2deg snaps cleanly to 0deg
  const tinyJitter = computeTwoFingerTransform({
    startP1: { x: 100, y: 150 },
    startP2: { x: 150, y: 150 },
    currP1: { x: 100, y: 150 },
    currP2: { x: 150, y: 151 }, // ~1.15deg
    baseTransform: DEFAULT_STORY_CARD_TRANSFORM,
    containerWidth: 200,
    containerHeight: 400,
  });
  assert.equal(tinyJitter.rotationDeg, 0);

  // 4. Clamping respects bounds
  const clamped = clampStoryCardTransform({ scale: 4, offsetX: -2, rotationDeg: 90 });
  assert.equal(clamped.scale, 1.65);
  assert.equal(clamped.offsetX, -0.35);
  assert.equal(clamped.rotationDeg, 45);
});

test('configureIosNativeProject idempotently injects ChintaMediaPlugin, storyboard class, Info.plist keys, and PrivacyInfo.xcprivacy', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chinta-ios-cfg-'));
  try {
    const iosAppDir = path.join(tmpRoot, 'ios', 'App', 'App');
    const storyboardDir = path.join(iosAppDir, 'Base.lproj');
    const iosNativeDir = path.join(tmpRoot, 'ios-native');
    fs.mkdirSync(storyboardDir, { recursive: true });
    fs.mkdirSync(iosNativeDir, { recursive: true });

    fs.copyFileSync(
      path.join(process.cwd(), 'ios-native', 'ChintaMediaPlugin.swift'),
      path.join(iosNativeDir, 'ChintaMediaPlugin.swift')
    );

    fs.writeFileSync(
      path.join(iosAppDir, 'AppDelegate.swift'),
      'import UIKit\nimport Capacitor\n@UIApplicationMain\nclass AppDelegate: UIResponder, UIApplicationDelegate {}\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(storyboardDir, 'Main.storyboard'),
      '<viewController id="BYZ-38-t0r" customClass="CAPBridgeViewController" customModule="Capacitor" sceneMemberID="viewController"/>',
      'utf8'
    );
    fs.writeFileSync(
      path.join(iosAppDir, 'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>\n\t<key>CFBundleName</key>\n\t<string>Chinta</string>\n</dict></plist>',
      'utf8'
    );

    // Run twice to guarantee idempotency
    configureIosNativeProject(tmpRoot);
    const { appDelegatePath, storyboardPath, infoPlistPath, privacyManifestPath } =
      configureIosNativeProject(tmpRoot);

    const appDelegate = fs.readFileSync(appDelegatePath, 'utf8');
    assert.equal(appDelegate.match(/BEGIN CHINTA MEDIA BRIDGE/g)?.length, 1);
    assert.match(appDelegate, /class ChintaMediaPlugin: CAPPlugin, CAPBridgedPlugin/);
    assert.match(appDelegate, /com\.instagram\.sharedSticker\.stickerImage/);
    assert.match(appDelegate, /instagram:\/\/story-camera/);
    assert.match(appDelegate, /com\.facebook\.sharedSticker\.stickerImage/);
    assert.match(appDelegate, /class ChintaViewController: CAPBridgeViewController/);
    assert.match(appDelegate, /import Photos/);
    assert.match(appDelegate, /URLSessionConfiguration\.ephemeral/);

    const storyboard = fs.readFileSync(storyboardPath, 'utf8');
    assert.match(storyboard, /customClass="ChintaViewController" customModuleProvider="target"/);

    const plist = fs.readFileSync(infoPlistPath, 'utf8');
    assert.match(plist, /<key>NSPhotoLibraryAddUsageDescription<\/key>/);
    assert.match(plist, /<key>LSApplicationQueriesSchemes<\/key>/);
    assert.match(plist, /<string>instagram-stories<\/string>/);
    assert.match(plist, /<string>facebook-stories<\/string>/);

    const privacyManifest = fs.readFileSync(privacyManifestPath, 'utf8');
    assert.match(privacyManifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    assert.match(privacyManifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    assert.match(privacyManifest, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('source code contains only publisher feed domains and no non-user-supplied third-party https:// URLs', () => {
  const ALLOWED_PUBLISHER_HOSTS = new Set([
    'www.thedailystar.net',
    'thedailystar.net',
    'www.prothomalo.com',
    'en.prothomalo.com',
    'bdnews24.com',
    'media.bdnews24.com',
    'thefinancialexpress.com.bd',
    'www.tbsnews.net',
    'www.dhakatribune.com',
    'www.jugantor.com',
    'www.kalerkantho.com',
    'samakal.com',
    'www.ittefaq.com.bd',
    'mzamin.com',
    'www.bonikbarta.com',
    'www.jaijaidinbd.com',
    'www.bhorerkagoj.com',
    'www.inquilab.com',
    'www.nayadiganta.com',
    'www.protidinersangbad.com',
    'www.manobkantha.com.bd',
    'www.ajkerpatrika.com',
    'www.deshrupantor.com',
    'www.banglatribune.com',
    'www.dhakapost.com',
    'www.jagonews24.com',
    'www.risingbd.com',
    'sarabangla.net',
    'www.barta24.com',
    'www.newagebd.net',
    'feeds.bbci.co.uk',
    'bbc.com',
    'www.bbc.com',
    'www.reuters.com',
    'www.theguardian.com',
    'www.aljazeera.com',
    'rss.dw.com',
    'techcrunch.com',
    'www.theverge.com',
    'hnrss.org',
    'feeds.arstechnica.com',
    'www.wired.com',
    'www.technologyreview.com',
    'economist.com',
    'ft.com',
    'bloomberg.com',
    'cnbc.com',
    'foreignpolicy.com',
    'aeon.co',
    'www.newyorker.com',
    'www.theatlantic.com',
    'nautil.us',
    'www.quantamagazine.org',
    'www.nature.com',
    'www.newscientist.com',
    'phys.org',
    'www.sciencedaily.com',
    'nyt.com',
  ]);

  const filesToScan: string[] = [
    path.join(process.cwd(), 'index.html'),
    path.join(process.cwd(), 'capacitor.config.json'),
  ];

  const collectFiles = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(full);
      } else if (/\.(ts|tsx|js|mjs|json|html|css)$/.test(entry.name)) {
        filesToScan.push(full);
      }
    }
  };

  collectFiles(path.join(process.cwd(), 'src'));
  collectFiles(path.join(process.cwd(), 'scripts'));

  const disallowedUrls: Array<{ file: string; url: string }> = [];
  const urlRegex = /https:\/\/[a-zA-Z0-9.-]+(?:\/[^\s"'<>`)]*)?/g;

  for (const filePath of filesToScan) {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.matchAll(urlRegex);
    for (const m of matches) {
      const rawUrl = m[0];
      try {
        const parsed = new URL(rawUrl);
        if (!ALLOWED_PUBLISHER_HOSTS.has(parsed.hostname)) {
          disallowedUrls.push({
            file: path.relative(process.cwd(), filePath),
            url: rawUrl,
          });
        }
      } catch {
        disallowedUrls.push({
          file: path.relative(process.cwd(), filePath),
          url: rawUrl,
        });
      }
    }
  }

  assert.deepEqual(
    disallowedUrls,
    [],
    `Found non-user-supplied https:// URLs in source: ${JSON.stringify(disallowedUrls)}`
  );
});
