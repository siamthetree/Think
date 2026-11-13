#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/**
 * Configures the generated Capacitor iOS project (`ios/App/`) with:
 *   1. Native ChintaMediaPlugin & ChintaViewController injected into AppDelegate.swift
 *   2. Main.storyboard pointing initial ViewController to ChintaViewController
 *   3. Info.plist LSApplicationQueriesSchemes (Instagram/Facebook Stories on explicit user tap) & Photos permissions
 *   4. PrivacyInfo.xcprivacy declaring NSPrivacyTracking = false, no tracking domains, and no collected data types
 */

export const PRIVACY_MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<false/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array/>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array/>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>CA92.1</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`;

export function configureIosNativeProject(rootDir = process.cwd()) {
  const iosAppDir = path.join(rootDir, 'ios', 'App', 'App');
  const swiftSrcPath = path.join(rootDir, 'ios-native', 'ChintaMediaPlugin.swift');

  if (!fs.existsSync(iosAppDir)) {
    throw new Error(`Capacitor iOS directory not found at ${iosAppDir}`);
  }
  if (!fs.existsSync(swiftSrcPath)) {
    throw new Error(`Native Swift plugin source not found at ${swiftSrcPath}`);
  }

  // 1. Inject native plugin Swift classes into AppDelegate.swift (idempotent)
  const appDelegatePath = path.join(iosAppDir, 'AppDelegate.swift');
  if (!fs.existsSync(appDelegatePath)) {
    throw new Error(`AppDelegate.swift not found at ${appDelegatePath}`);
  }

  let appDelegate = fs.readFileSync(appDelegatePath, 'utf8');
  const MARKER_START = '// BEGIN CHINTA MEDIA BRIDGE';
  const MARKER_END = '// END CHINTA MEDIA BRIDGE';

  const swiftSource = fs.readFileSync(swiftSrcPath, 'utf8');
  const swiftBodyWithoutImports = swiftSource
    .split('\n')
    .filter((line) => !/^import\s+/.test(line.trim()))
    .join('\n')
    .trim();

  if (!appDelegate.includes('import Photos')) {
    appDelegate = appDelegate.replace(
      'import Capacitor',
      'import Capacitor\nimport Photos'
    );
  }

  const blockRegex = new RegExp(
    `${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`,
    'g'
  );
  appDelegate = appDelegate.replace(blockRegex, '').trimEnd();
  appDelegate += `\n\n${MARKER_START}\n${swiftBodyWithoutImports}\n${MARKER_END}\n`;
  fs.writeFileSync(appDelegatePath, appDelegate, 'utf8');

  // 2. Point Main.storyboard root ViewController to ChintaViewController
  const storyboardPath = path.join(iosAppDir, 'Base.lproj', 'Main.storyboard');
  if (fs.existsSync(storyboardPath)) {
    let storyboard = fs.readFileSync(storyboardPath, 'utf8');
    storyboard = storyboard.replace(
      /customClass="CAPBridgeViewController"\s+customModule="Capacitor"/g,
      'customClass="ChintaViewController" customModuleProvider="target"'
    );
    fs.writeFileSync(storyboardPath, storyboard, 'utf8');
  }

  // 3. Patch Info.plist with Instagram/Facebook URL schemes (explicit user tap only) + Photo Library usage descriptions
  const infoPlistPath = path.join(iosAppDir, 'Info.plist');
  if (!fs.existsSync(infoPlistPath)) {
    throw new Error(`Info.plist not found at ${infoPlistPath}`);
  }

  let plist = fs.readFileSync(infoPlistPath, 'utf8');

  plist = upsertPlistStringKey(
    plist,
    'NSPhotoLibraryAddUsageDescription',
    'Chinta saves your reading story cards and article photos directly to your Photos gallery.'
  );
  plist = upsertPlistStringKey(
    plist,
    'NSPhotoLibraryUsageDescription',
    'Chinta accesses Photos to save story cards and article images to your gallery.'
  );
  plist = upsertPlistArrayValues(plist, 'LSApplicationQueriesSchemes', [
    'instagram-stories',
    'instagram',
    'facebook-stories',
    'fb-stories',
    'fbapi',
  ]);

  fs.writeFileSync(infoPlistPath, plist, 'utf8');

  // 4. Write PrivacyInfo.xcprivacy declaring NSPrivacyTracking = false, no tracking domains, and no collected data types
  const privacyManifestPath = path.join(iosAppDir, 'PrivacyInfo.xcprivacy');
  fs.writeFileSync(privacyManifestPath, PRIVACY_MANIFEST_XML, 'utf8');

  return {
    appDelegatePath,
    storyboardPath,
    infoPlistPath,
    privacyManifestPath,
  };
}

export function upsertPlistStringKey(plistXml, key, value) {
  const escapedValue = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const keyRegex = new RegExp(
    `<key>${key}</key>\\s*<string>[\\s\\S]*?</string>`,
    'm'
  );
  const entry = `\t<key>${key}</key>\n\t<string>${escapedValue}</string>`;
  if (keyRegex.test(plistXml)) {
    return plistXml.replace(keyRegex, entry);
  }
  return plistXml.replace('</dict>', `${entry}\n</dict>`);
}

export function upsertPlistArrayValues(plistXml, key, values) {
  const keyRegex = new RegExp(
    `<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`,
    'm'
  );
  const existing = [];
  const match = plistXml.match(keyRegex);
  if (match) {
    const strMatches = match[1].matchAll(/<string>([\s\S]*?)<\/string>/g);
    for (const m of strMatches) {
      existing.push(m[1].trim());
    }
  }
  const merged = Array.from(new Set([...existing, ...values]));
  const itemsXml = merged.map((v) => `\t\t<string>${v}</string>`).join('\n');
  const replacement = `\t<key>${key}</key>\n\t<array>\n${itemsXml}\n\t</array>`;

  if (keyRegex.test(plistXml)) {
    return plistXml.replace(keyRegex, replacement);
  }
  return plistXml.replace('</dict>', `${replacement}\n</dict>`);
}

// Run directly when executed from CLI
const isCli =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]));

if (isCli) {
  const res = configureIosNativeProject(process.cwd());
  console.log('Configured Capacitor iOS native Story, Photos & Privacy manifest bridge:', res);
}
