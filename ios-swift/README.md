# Chinta (চিন্তা) — Native Swift & SwiftUI iOS App

A native Swift & SwiftUI newspaper & RSS reader engineered with **Apple Liquid Glass** (multi-layer ultra-thin material blur, specular rim reflections, floating glass dock) and an **Adaptive Display Engine** automatically calibrated for every iPhone display.

## Features
- **Apple Liquid Glass**: Multi-layer dynamic materials, glass pill switchers, floating bottom island dock, and chromatic refraction.
- **Adaptive Display Engine**: Dynamic Island & Notch safe-area geometry detection, responsive typography scaling (`iPhoneDisplayTier`), and proportional card metrics across all iPhone sizes.
- **Swift 6 Concurrency-Safe Feed Refresh Engine**:
  - `@ModelActor` (`FeedDataStore`) isolates all `ModelContext` and `@Model` (`Feed`, `FeedItem`) mutations; `Sendable` value snapshots cross actor boundaries.
  - Adaptive interval scheduler (15 min to 6 hours) with accurate 3-in-a-row streak detection.
  - Conditional GET caching (`ETag`, `Last-Modified`, `304 Not Modified`), permanent redirect persistence (`301`/`308` only, ignoring temporary `302`/`307`), permanent failure pause for `404`/`410`, and `429`/`5xx` exponential backoff with `Retry-After`.
  - Cancellation-aware host rate limiter (`HostRateLimiter`, max 4 concurrent, 1 per host).
  - Synchronous `BGTaskScheduler` registration in `ChintaApp.init()` before launch finishes, paired with `Info.plist` (`BGTaskSchedulerPermittedIdentifiers: ["app.chinta.feedrefresh"]`, `UIBackgroundModes: ["fetch", "processing"]`).
- **Multi-Format Parsing**: Supports RSS 2.0 (with `<ttl>` and `<sy:update*>`), Atom 1.0, and JSON Feed v1/v1.1 with deterministic fallback dates for undated items and multi-tier deduplication.
- **SwiftData Storage & Retention**: Persists feeds and items with safe retention (`max(500 items, 30 days)`), protecting unread and starred stories from ever being deleted, plus automatic in-memory fallback if the persistent store encounters a migration error.

## Project Structure
```
ios-swift/
├── Package.swift
└── Sources/ChintaApp/
    ├── ChintaApp.swift                 # App entry point, SwiftData container & BGTask registration
    ├── Resources/
    │   └── Info.plist                  # BGTaskSchedulerPermittedIdentifiers & UIBackgroundModes
    ├── Models/
    │   └── FeedModels.swift            # SwiftData @Model schema
    ├── Engine/
    │   ├── HostRateLimiter.swift       # Cancellation-aware global & per-host concurrency limiter
    │   ├── FeedNetworkClient.swift     # Conditional GET, 301/308 redirect & HTTP status handler
    │   ├── FeedParserService.swift     # RSS 2.0 / Atom / JSON Feed parser
    │   ├── FeedAdaptiveScheduler.swift # Adaptive streak & cadence algorithm
    │   ├── FeedRetentionManager.swift  # Safe retention pruner
    │   └── FeedRefreshEngine.swift     # @ModelActor FeedDataStore & BGAppRefreshTask coordinator
    └── UI/
        ├── AdaptiveDisplayMetrics.swift# iPhone display tier & geometry engine
        ├── LiquidGlass.swift           # Liquid glass materials & floating dock
        ├── MainFeedView.swift          # Edge-to-edge magazine & compact feeds (.task launch sync)
        ├── ReaderDetailView.swift      # Immersive distraction-free reader
        └── SourcesManagerView.swift    # Subscription & feed health console
```

## Running in Xcode
1. Open `ios-swift/Package.swift` in **Xcode 15+** (configured as an `.executableTarget`), or include `Sources/ChintaApp/Resources/Info.plist` in your Xcode App target's `INFOPLIST_FILE` build setting for background task entitlements on physical devices.
2. Select an iOS Simulator or physical iPhone destination and press **Cmd + R**.
