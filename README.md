# Chinta (চিন্তা) - iPhone Newspaper & RSS Reader (`.ipa` Ready)

Minimalist, distraction-free, 100% tracker-free iPhone newspaper & RSS reader built for **Bangladeshi newspapers** (*The Daily Star*, *Prothom Alo*, *bdnews24.com*, *The Financial Express BD*, *The Business Standard*, *Dhaka Tribune*) and global press.

- **100% On-Device & Tracker-Free**: Fetches feeds, extracts readable articles, generates extractive summaries, and caches article images directly on-device via `CapacitorHttp` with zero cloud backends, zero AI APIs, and zero third-party requests.
- **Native Swift & SwiftUI Liquid Glass Engine (`ios-swift/`)**: Complete native iOS 17+ Swift package featuring Apple Liquid Glass material blur, adaptive font/icon display engine, SwiftData persistence (`@ModelActor`), and the complete feed refresh engine with `BGTaskScheduler`.
- **Direct Web Portal & URL Reader (RSS Auto-Discovery + Portal Fallback)**: Searches for an RSS feed link first whenever a URL is added; if an RSS feed is available it subscribes to the RSS link, otherwise it keeps the website link and extracts articles into clean, distraction-free Reader View.
- **Offline Reading & Custom Tag Categorization**: Automatically caches articles and images in `localStorage` and `IndexedDB` on your iPhone for durable offline reading and lets you organize stories with custom folders and tags.
- **Native iOS `.ipa` Ready via Capacitor (`CapacitorHttp`) + GitHub Actions**: Automatically compiles an installable `Chinta-iOS.ipa` on GitHub's `macos-latest` Xcode runners.

---

## Privacy

Chinta is strictly on-device and makes **zero** requests to Google, cloud backends, analytics services, font CDNs, favicon services, or AI endpoints.

The app makes **only** the following network requests, and only to news publisher servers the user subscribes to or opens:
1. **Feed & Portal Fetch (`GET <publisher-feed-or-portal-url>`)**: Direct HTTP `GET` request to the publisher's RSS/Atom XML feed or news portal HTML page (plus RSS auto-discovery path probes on that same publisher domain when adding a new feed).
2. **Reader View Article Extraction (`GET <publisher-article-url>`)**: Direct HTTP `GET` request to the publisher's article URL when the user opens a story that requires full-text extraction.
3. **Article Image Loading (`GET <publisher-image-url>`)**: Direct HTTP `GET` request via `CapacitorHttp` to fetch lead and inline article images, which are then cached locally on-device in `IndexedDB` as `data:` URLs.

Every request is hardened with:
- A single generic Safari iOS `User-Agent` (`Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`) with no custom app identifiers or custom `X-*` headers.
- No cookies sent or stored (`credentials: 'omit'`, `HTTPCookieStorage.shared.cookieAcceptPolicy = .never`, and `URLSessionConfiguration.ephemeral`).
- No `Referer` header sent (`referrerPolicy: 'no-referrer'`).
- SSRF validation via `checkSafeExternalUrl` blocking private, loopback, link-local, and non-HTTP(S) addresses.
- Bundled local `.woff2` fonts (`Lora`, `Plus Jakarta Sans`, `Noto Serif Bengali`), local letter/color source avatars, local extractive summarization, and an iOS `PrivacyInfo.xcprivacy` manifest declaring `NSPrivacyTracking = false`, no tracking domains, and no collected data types.

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

# 3. Build static web bundle (dist/)
npm run build

# 4. Build Chinta-iOS.ipa locally on macOS
npm run build:ios-ipa
```
