# Chinta (চিন্তা) — Native Swift & SwiftUI iOS App

A native Swift & SwiftUI newspaper & RSS reader engineered with **Apple Liquid Glass** (multi-layer ultra-thin material blur, specular rim reflections, floating glass dock) and an **Adaptive Display Engine** automatically calibrated for every iPhone display.

## Features
- **Apple Liquid Glass**: Multi-layer dynamic materials, glass pill switchers, floating bottom island dock, and chromatic refraction.
- **Adaptive Display Engine**: Dynamic Island & Notch safe-area geometry detection, responsive typography scaling (`iPhoneDisplayTier`), and proportional card metrics across all iPhone sizes.
- **Feed Refresh Engine**: Adaptive interval scheduler (15 min to 6 hours), conditional GET caching (`ETag`, `Last-Modified`, 304), 301 redirect following, 429/5xx exponential backoff with `Retry-After`, and host-based rate limiting (max 4 concurrent, 1 per host).
- **Multi-Format Parsing**: Supports RSS 2.0 (with `<ttl>` and `<sy:update*>`), Atom 1.0, and JSON Feed v1/v1.1 with multi-tier deduplication.
- **SwiftData Storage & Retention**: Persists feeds and items with safe retention (`max(500 items, 30 days)`), protecting unread and starred stories from ever being deleted.
- **5-Strike Failing Warning**: Highlights feeds failing 5+ times with retry countdowns and error diagnostics while retrying gently in the background.

## Project Structure
```
ios-swift/
├── Package.swift
└── Sources/ChintaApp/
    ├── ChintaApp.swift                 # App entry point & SwiftData container
    ├── Models/
    │   └── FeedModels.swift            # SwiftData @Model schema
    ├── Engine/
    │   ├── HostRateLimiter.swift       # Global & per-host concurrency controller
    │   ├── FeedNetworkClient.swift     # Conditional GET & network executor
    │   ├── FeedParserService.swift     # RSS 2.0 / Atom / JSON Feed parser
    │   ├── FeedAdaptiveScheduler.swift # Adaptive streak & cadence algorithm
    │   ├── FeedRetentionManager.swift  # Safe retention pruner
    │   └── FeedRefreshEngine.swift     # Coordinator actor & BGAppRefreshTask
    └── UI/
        ├── AdaptiveDisplayMetrics.swift# iPhone display tier & geometry engine
        ├── LiquidGlass.swift           # Liquid glass materials & floating dock
        ├── MainFeedView.swift          # Edge-to-edge magazine & compact feeds
        ├── ReaderDetailView.swift      # Immersive distraction-free reader
        └── SourcesManagerView.swift    # Subscription & feed health console
```

## How to Open in Xcode
1. Double-click `Package.swift` or open the `ios-swift` folder in **Xcode 15+**.
2. Select your target device (e.g., iPhone 15 Pro, iPhone 16 Pro Max, or iPhone SE).
3. Press **Cmd + R** to run.
