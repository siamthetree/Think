import React, { useState } from 'react';
import { X, Check, Copy, Terminal, CheckCircle2, ArrowRight } from 'lucide-react';

interface IosBuildModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WORKFLOW_SNIPPET = `name: Build iOS IPA (Chinta / PaperPress)

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:
    inputs:
      appName:
        description: 'Output IPA file name'
        required: false
        default: 'Chinta-iOS'
      createRelease:
        description: 'Create a GitHub Release with this IPA'
        required: false
        type: boolean
        default: false

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-ipa:
    name: Compile iOS App & Package IPA
    runs-on: macos-latest
    timeout-minutes: 45
    env:
      LANG: en_US.UTF-8
      LC_ALL: en_US.UTF-8

    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Node Dependencies
        run: npm install --legacy-peer-deps

      - name: Build Web Application
        env:
          NODE_ENV: production
        run: npm run build

      - name: Setup Capacitor iOS Project
        run: |
          if [ ! -d "ios" ]; then
            npx cap add ios
          fi
          npx cap sync ios || (cd ios/App && pod install --repo-update && cd ../.. && npx cap copy ios)

      - name: Select Xcode Version
        run: |
          if [ -d "/Applications/Xcode.app/Contents/Developer" ]; then
            sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
          fi
          xcodebuild -version

      - name: Build iOS Archive (.app)
        run: |
          cd ios/App
          if [ -d "App.xcworkspace" ] || [ -f "App.xcworkspace/contents.xcworkspacedata" ]; then
            TARGET_FLAG="-workspace App.xcworkspace"
          else
            TARGET_FLAG="-project App.xcodeproj"
          fi

          xcodebuild $TARGET_FLAG \\
            -scheme App \\
            -configuration Release \\
            -sdk iphoneos \\
            -destination "generic/platform=iOS" \\
            -derivedDataPath build \\
            CODE_SIGNING_ALLOWED=NO \\
            CODE_SIGNING_REQUIRED=NO \\
            CODE_SIGN_IDENTITY="" \\
            EXPANDED_CODE_SIGN_IDENTITY="" \\
            AD_HOC_CODE_SIGNING_ALLOWED=YES \\
            COMPILER_INDEX_STORE_ENABLE=NO \\
            clean build

      - name: Package Unsigned iOS .ipa (Payload)
        run: |
          IPA_NAME="\${{ inputs.appName || 'Chinta-iOS' }}"
          APP_DIR=$(find ios/App/build -name "App.app" -type d | head -n 1)
          mkdir -p build_ipa/Payload
          cp -R "$APP_DIR" build_ipa/Payload/
          cd build_ipa
          zip -r -q "../\${IPA_NAME}.ipa" Payload/
          cd ..
          cp "\${IPA_NAME}.ipa" "Chinta-iOS.ipa"
          cp "\${IPA_NAME}.ipa" "PaperPress-iOS.ipa"

      - name: Upload IPA Artifact to GitHub Actions
        uses: actions/upload-artifact@v4
        with:
          name: Chinta-iOS-IPA
          path: "*.ipa"
          retention-days: 30`;

export const IosBuildModal: React.FC<IosBuildModalProps> = ({ isOpen, onClose }) => {
  const [copiedWorkflow, setCopiedWorkflow] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(WORKFLOW_SNIPPET);
    setCopiedWorkflow(true);
    setTimeout(() => setCopiedWorkflow(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-xs p-0 md:p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg max-h-[88vh] bg-stone-50 dark:bg-stone-900 rounded-t-3xl md:rounded-3xl border border-stone-200 dark:border-stone-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200/80 dark:border-stone-800 flex items-center justify-between bg-white dark:bg-stone-900">
          <div className="flex items-center gap-2.5">
            <div>
              <h2 className="font-serif font-bold text-base text-stone-900 dark:text-stone-100">
                Export to GitHub & Build iOS .ipa
              </h2>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Pre-configured with Capacitor iOS & GitHub Actions macOS builder
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close iOS build guide"
            className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-stone-700 dark:text-stone-300">
          {/* Ready Banner */}
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-950 dark:text-emerald-200 mb-0.5">
                Your codebase is already configured for iOS (.ipa)
              </p>
              <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/80 leading-relaxed">
                We added <code className="font-mono font-semibold">capacitor.config.json</code>, standalone iOS feed/article extraction fallbacks, and <code className="font-mono font-semibold">.github/workflows/build-ios-ipa.yml</code> directly to this project.
              </p>
            </div>
          </div>

          {/* Step 1 */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-stone-800/60 border border-stone-200/80 dark:border-stone-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
              <span className="w-5 h-5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] flex items-center justify-center font-bold">
                1
              </span>
              <span>Transfer this App to GitHub</span>
            </div>
            <p className="text-stone-600 dark:text-stone-400 leading-relaxed pl-7">
              Click the <strong>GitHub icon (Save to GitHub)</strong> in the top-right toolbar of Google AI Studio (or download the project ZIP and push it to a new GitHub repository on the <code className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">main</code> branch).
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-stone-800/60 border border-stone-200/80 dark:border-stone-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
              <span className="w-5 h-5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] flex items-center justify-center font-bold">
                2
              </span>
              <span>Download Chinta-iOS.ipa from GitHub Actions</span>
            </div>
            <p className="text-stone-600 dark:text-stone-400 leading-relaxed pl-7">
              Once your repository is on GitHub:
            </p>
            <ul className="pl-7 space-y-1 text-stone-600 dark:text-stone-400">
              <li className="flex items-center gap-1.5">
                <ArrowRight className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>Open your repository on GitHub and click the <strong>Actions</strong> tab.</span>
              </li>
              <li className="flex items-center gap-1.5">
                <ArrowRight className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>Select <strong>Build iOS IPA (Chinta)</strong> and click <strong>Run workflow</strong> (it also runs automatically on push).</span>
              </li>
              <li className="flex items-center gap-1.5">
                <ArrowRight className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>After ~3 minutes on GitHub’s macOS runner, scroll down to <strong>Artifacts</strong> and download <strong>Chinta-iOS-IPA</strong>.</span>
              </li>
            </ul>
          </div>

          {/* Step 3 */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-stone-800/60 border border-stone-200/80 dark:border-stone-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
              <span className="w-5 h-5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] flex items-center justify-center font-bold">
                3
              </span>
              <span>Install the .ipa on Your iPhone</span>
            </div>
            <p className="text-stone-600 dark:text-stone-400 leading-relaxed pl-7">
              Unzip the artifact to get <code className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">Chinta-iOS.ipa</code>. You can install it on your iPhone using <strong>Sideloadly</strong> or <strong>AltStore</strong> with your free Apple ID (after installing, go to <em>Settings → General → VPN & Device Management</em> on your iPhone to trust your developer profile).
            </p>
          </div>

          {/* Workflow Preview & Copy */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-stone-800 dark:text-stone-200">
                <Terminal className="w-3.5 h-3.5" />
                <span>Included Workflow (.github/workflows/build-ios-ipa.yml)</span>
              </span>
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 rounded-lg bg-stone-200/80 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-[11px] font-medium flex items-center gap-1 transition-colors"
              >
                {copiedWorkflow ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{copiedWorkflow ? 'Copied' : 'Copy YAML'}</span>
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-stone-900 text-stone-100 font-mono text-[10px] overflow-x-auto leading-relaxed">
              {WORKFLOW_SNIPPET}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
