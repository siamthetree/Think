import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  stripDataUrlPrefix,
  buildInstagramStoryDeepLink,
  buildFacebookStoryDeepLink,
  detectClientPlatform,
  guessImageExtensionFromMime,
  sanitizePhotoFilename,
  buildImageProxyUrl,
} from './mediaShare';
import { configureIosNativeProject } from '../../scripts/configure-ios-native.mjs';

test('stripDataUrlPrefix extracts pure base64 payload from PNG data URLs', () => {
  assert.equal(stripDataUrlPrefix('data:image/png;base64,iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(stripDataUrlPrefix('iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(stripDataUrlPrefix(''), '');
});

test('Meta Stories deep links include source_application and optional app_id', () => {
  assert.equal(
    buildInstagramStoryDeepLink('app.chinta.reader'),
    'instagram-stories://share?source_application=app.chinta.reader'
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
  assert.equal(guessImageExtensionFromMime('', 'https://cdn.example.com/photo.png?w=800'), 'png');
  assert.equal(
    sanitizePhotoFilename('Central Bank Cuts Policy Rate!', 'png'),
    'central-bank-cuts-policy-rate.png'
  );
  assert.equal(sanitizePhotoFilename('---', 'jpg'), 'chinta-photo.jpg');
});

test('buildImageProxyUrl encodes valid HTTP(S) URLs and rejects non-HTTP schemes', () => {
  assert.equal(
    buildImageProxyUrl('https://news.example.com/img/cover.jpg?a=1&b=2'),
    '/api/image-proxy?url=https%3A%2F%2Fnews.example.com%2Fimg%2Fcover.jpg%3Fa%3D1%26b%3D2'
  );
  assert.equal(buildImageProxyUrl('javascript:alert(1)'), '');
});

test('configureIosNativeProject idempotently injects ChintaMediaPlugin, storyboard class, and Info.plist keys', () => {
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
    const { appDelegatePath, storyboardPath, infoPlistPath } = configureIosNativeProject(tmpRoot);

    const appDelegate = fs.readFileSync(appDelegatePath, 'utf8');
    assert.equal(appDelegate.match(/BEGIN CHINTA MEDIA BRIDGE/g)?.length, 1);
    assert.match(appDelegate, /class ChintaMediaPlugin: CAPPlugin, CAPBridgedPlugin/);
    assert.match(appDelegate, /class ChintaViewController: CAPBridgeViewController/);
    assert.match(appDelegate, /import Photos/);

    const storyboard = fs.readFileSync(storyboardPath, 'utf8');
    assert.match(storyboard, /customClass="ChintaViewController" customModuleProvider="target"/);

    const plist = fs.readFileSync(infoPlistPath, 'utf8');
    assert.match(plist, /<key>NSPhotoLibraryAddUsageDescription<\/key>/);
    assert.match(plist, /<key>LSApplicationQueriesSchemes<\/key>/);
    assert.match(plist, /<string>instagram-stories<\/string>/);
    assert.match(plist, /<string>facebook-stories<\/string>/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
