# Chinta (চিন্তা) — iPhone Newspaper & RSS Reader (`.ipa` Ready)

Minimalist, distraction-free iPhone newspaper & RSS reader built for **Bangladeshi newspapers** (*The Daily Star*, *Prothom Alo*, *bdnews24.com*, *The Financial Express BD*, *The Business Standard*, *Dhaka Tribune*) and global press.

- **Native Swift & SwiftUI Liquid Glass Engine (`ios-swift/`)**: Complete native iOS 17+ Swift package featuring Apple Liquid Glass material blur, adaptive font/icon display engine, SwiftData persistence (`@ModelActor`), and the complete feed refresh engine with `BGTaskScheduler`.
- **Direct Web Portal & URL Reader (RSS Auto-Discovery + Portal Fallback)**: Searches for an RSS feed link first whenever a URL is added; if an RSS feed is available it subscribes to the RSS link, otherwise it keeps the website link and extracts articles into clean, distraction-free Reader View.
- **Offline Reading & Custom Tag Categorization**: Automatically caches articles in `localStorage` and `IndexedDB` on your iPhone for durable offline reading and lets you organize stories with custom folders and tags.
- **Native iOS `.ipa` Ready via Capacitor (`CapacitorHttp`) + GitHub Actions**: Automatically compiles an installable `Chinta-iOS.ipa` on GitHub's `macos-latest` Xcode runners.

---

## How to Build the iOS `.ipa` File on GitHub (No Mac Required)

This repository includes a pre-configured GitHub Actions workflow at [`.github/workflows/build-ios-ipa.yml`](.github/workflows/build-ios-ipa.yml) and Capacitor iOS configuration at [`capacitor.config.json`](capacitor.config.json).

### Step 1: Push / Transfer to GitHub
1. In Google AI Studio, click the **GitHub** button in the top-right bar to export this project to your GitHub account.
2. Or from a local terminal:
   ```bash
   git init
   git add .
   git commit -m "Chinta iOS RSS & Newspaper Reader"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

### Step 2: Download `Chinta-iOS.ipa` from GitHub Actions
1. Go to your GitHub repository and click the **Actions** tab.
2. Select the **Build iOS IPA (Chinta)** workflow (it triggers automatically on every push to `main`, or you can click **Run workflow** manually).
3. Once the workflow finishes (~3 minutes), scroll down to the **Artifacts** section at the bottom of the run summary.
4. Download **`Chinta-iOS-IPA`** and unzip it to get **`Chinta-iOS.ipa`**.

### Step 3: Install `Chinta-iOS.ipa` on Your iPhone
You can install the unsigned `Chinta-iOS.ipa` onto your iPhone using any standard sideloading tool with a free Apple ID:
- **Sideloadly** (Windows / macOS): Connect your iPhone, drag `Chinta-iOS.ipa` into Sideloadly, enter your Apple ID, and click **Start**.
- **AltStore / SideStore**: Send `Chinta-iOS.ipa` to your iPhone (via AirDrop or iCloud Drive) and open it inside AltStore or SideStore.
- **TrollStore / Feather**: Import `Chinta-iOS.ipa` directly on-device and tap **Install**.

---

## Local Development & Local `.ipa` Build (macOS with Xcode)

```bash
# 1. Install dependencies
npm install

# 2. Start local development server (Port 3000)
npm run dev

# 3. Build web assets + bundled server (dist/ + server.js)
npm run build

# 4. Build Chinta-iOS.ipa locally on macOS
npm run build:ios-ipa
```
