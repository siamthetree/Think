import SwiftUI
import SwiftData
import UIKit

public struct MainFeedView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.displayMetrics) private var metrics
    @Query(sort: \FeedItem.publishedDate, order: .reverse) private var articles: [FeedItem]
    @Query(sort: \Feed.title) private var feeds: [Feed]
    
    @State private var selectedFeedID: UUID? = nil
    @State private var viewMode: FeedViewLayoutMode = .magazine
    @State private var selectedArticleForReader: FeedItem? = nil
    @State private var isSearchActive = false
    @State private var searchQuery = ""
    @State private var isSourcesSheetOpen = false
    @State private var isBarsVisible = true
    @State private var lastScrollOffset: CGFloat = 0
    
    public enum FeedViewLayoutMode: String, CaseIterable {
        case magazine = "Magazine"
        case compact = "Compact"
    }
    
    public init() {}
    
    public var body: some View {
        ZStack(alignment: .bottom) {
            Color.liquidBackgroundDark
                .ignoresSafeArea(.all)
            
            // Newsfeed Scroll Content
            ScrollView {
                LazyVStack(spacing: 20) {
                    // Spacer for top header
                    Color.clear
                        .frame(height: max(metrics.safeAreaInsets.top, 20) + 68)
                    
                    let displayed = filteredArticles
                    if displayed.isEmpty {
                        emptyStateView
                            .padding(.top, 60)
                    } else {
                        ForEach(displayed) { item in
                            if viewMode == .magazine {
                                SubstackPostCard(item: item) {
                                    AppleHapticEngine.shared.selectionTick()
                                    selectedArticleForReader = item
                                }
                            } else {
                                LiquidCompactRow(item: item) {
                                    AppleHapticEngine.shared.selectionTick()
                                    selectedArticleForReader = item
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, metrics.horizontalGutter)
                .padding(.bottom, metrics.floatingBarHeight + max(metrics.safeAreaInsets.bottom, 24) + 16)
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(
                            key: ScrollOffsetPreferenceKey.self,
                            value: geo.frame(in: .named("feedScrollView")).minY
                        )
                    }
                )
            }
            .coordinateSpace(name: "feedScrollView")
            .onPreferenceChange(ScrollOffsetPreferenceKey.self) { value in
                handleScroll(offset: value)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                // Native Apple Haptic on pull trigger
                AppleHapticEngine.shared.pullThresholdDetent()
                
                await FeedRefreshEngine.shared.pullToRefreshAll(container: modelContext.container)
                
                // Gentle Native Apple Haptic on refresh completion
                AppleHapticEngine.shared.refreshCompleted()
            }
            
            // Top Substack Header (Auto-Hides on Scroll Down)
            VStack {
                topGlassHeader
                    .offset(y: isBarsVisible ? 0 : -140)
                    .opacity(isBarsVisible ? 1.0 : 0.0)
                    .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isBarsVisible)
                Spacer()
            }
            .ignoresSafeArea(.container, edges: .top)
            
            // Bottom Floating Dock (Auto-Hides on Scroll Down)
            bottomFloatingDock
                .offset(y: isBarsVisible ? 0 : 120)
                .opacity(isBarsVisible ? 1.0 : 0.0)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isBarsVisible)
        }
        .task {
            await FeedRefreshEngine.shared.onAppLaunch(container: modelContext.container)
        }
        .fullScreenCover(item: $selectedArticleForReader) { article in
            ReaderDetailView(article: article)
        }
        .sheet(isPresented: $isSourcesSheetOpen) {
            SourcesManagerView()
        }
    }
    
    // MARK: - Momentum Scroll Direction Handling
    private func handleScroll(offset: CGFloat) {
        let delta = offset - lastScrollOffset
        
        // At or near top: always reveal bars
        if offset > -20 {
            if !isBarsVisible { isBarsVisible = true }
            lastScrollOffset = offset
            return
        }
        
        // Scrolling Down: auto-hide header & dock for 100% full screen
        if delta < -12 && isBarsVisible {
            isBarsVisible = false
        }
        // Scrolling Up: restore navigation
        else if delta > 12 && !isBarsVisible {
            isBarsVisible = true
        }
        
        lastScrollOffset = offset
    }
    
    // MARK: - Top Substack Liquid Glass Header
    private var topGlassHeader: some View {
        VStack(spacing: 8) {
            HStack(alignment: .center) {
                // Substack Orange Bookmark Glyph & Newsfeed Title
                HStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(Color(red: 1.0, green: 0.40, blue: 0.10)) // Substack #FF6719
                            .frame(width: 20, height: 24)
                            .shadow(color: Color(red: 1.0, green: 0.40, blue: 0.10).opacity(0.4), radius: 4, y: 1)
                        
                        Text("S")
                            .font(.system(size: 11, weight: .black, design: .serif))
                            .foregroundStyle(.white)
                    }
                    
                    Text("Newsfeed")
                        .font(.system(size: metrics.fontSize(base: 22), weight: .bold, design: .serif))
                        .foregroundStyle(.white)
                }
                
                Spacer()
                
                // View Mode & Actions
                HStack(spacing: 8) {
                    Button(action: {
                        AppleHapticEngine.shared.selectionTick()
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            viewMode = (viewMode == .magazine) ? .compact : .magazine
                        }
                    }) {
                        Image(systemName: viewMode == .magazine ? "rectangle.grid.1x2.fill" : "list.bullet")
                            .font(.system(size: metrics.iconSize(base: 13), weight: .semibold))
                            .foregroundStyle(Color(red: 1.0, green: 0.40, blue: 0.10))
                            .frame(width: metrics.iconSize(base: 34), height: metrics.iconSize(base: 34))
                            .liquidGlass(cornerRadius: 17, opacity: 0.75)
                    }
                    
                    Button(action: {
                        AppleHapticEngine.shared.selectionTick()
                        isSearchActive.toggle()
                    }) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: metrics.iconSize(base: 13), weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: metrics.iconSize(base: 34), height: metrics.iconSize(base: 34))
                            .liquidGlass(cornerRadius: 17, opacity: 0.75)
                    }
                    
                    Button(action: {
                        AppleHapticEngine.shared.selectionTick()
                        isSourcesSheetOpen = true
                    }) {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: metrics.iconSize(base: 13), weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: metrics.iconSize(base: 34), height: metrics.iconSize(base: 34))
                            .liquidGlass(cornerRadius: 17, opacity: 0.75)
                    }
                }
            }
            
            if isSearchActive {
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search newsfeed...", text: $searchQuery)
                        .font(.system(size: metrics.fontSize(base: 13)))
                        .foregroundStyle(.white)
                    if !searchQuery.isEmpty {
                        Button(action: { searchQuery = "" }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .liquidGlass(cornerRadius: 14, opacity: 0.70)
            }
        }
        .padding(.horizontal, metrics.horizontalGutter)
        .padding(.top, max(metrics.safeAreaInsets.top, 14))
        .padding(.bottom, 12)
        .liquidGlass(cornerRadius: 0, opacity: 0.85)
    }
    
    // MARK: - Bottom Floating Liquid Glass Dock
    private var bottomFloatingDock: some View {
        LiquidGlassFloatingBar {
            HStack {
                Button(action: {
                    AppleHapticEngine.shared.selectionTick()
                    selectedFeedID = nil
                }) {
                    VStack(spacing: 3) {
                        Image(systemName: "newspaper.fill")
                            .font(.system(size: metrics.iconSize(base: 17), weight: .semibold))
                        Text("Newsfeed")
                            .font(.system(size: metrics.fontSize(base: 10), weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Color(red: 1.0, green: 0.40, blue: 0.10))
                }
                
                Button(action: {
                    AppleHapticEngine.shared.pullThresholdDetent()
                    let container = modelContext.container
                    Task {
                        await FeedRefreshEngine.shared.pullToRefreshAll(container: container)
                        AppleHapticEngine.shared.refreshCompleted()
                    }
                }) {
                    VStack(spacing: 3) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: metrics.iconSize(base: 17), weight: .semibold))
                        Text("Sync")
                            .font(.system(size: metrics.fontSize(base: 10), weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Color.white.opacity(0.8))
                }
                
                Button(action: markAllAsRead) {
                    VStack(spacing: 3) {
                        Image(systemName: "checkmark.circle")
                            .font(.system(size: metrics.iconSize(base: 17), weight: .semibold))
                        Text("Mark Read")
                            .font(.system(size: metrics.fontSize(base: 10), weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Color.white.opacity(0.8))
                }
                
                Button(action: {
                    AppleHapticEngine.shared.selectionTick()
                    isSourcesSheetOpen = true
                }) {
                    VStack(spacing: 3) {
                        Image(systemName: "gearshape")
                            .font(.system(size: metrics.iconSize(base: 17), weight: .semibold))
                        Text("Sources")
                            .font(.system(size: metrics.fontSize(base: 10), weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Color.white.opacity(0.8))
                }
            }
        }
    }
    
    private var filteredArticles: [FeedItem] {
        articles.filter { item in
            let matchesFeed = selectedFeedID == nil || item.feed?.id == selectedFeedID
            let matchesSearch = searchQuery.isEmpty || item.title.localizedCaseInsensitiveContains(searchQuery)
            return matchesFeed && matchesSearch
        }
    }
    
    private func markAllAsRead() {
        AppleHapticEngine.shared.toggleSuccess()
        withAnimation {
            for item in filteredArticles {
                item.isRead = true
            }
            try? modelContext.save()
        }
    }
    
    private var emptyStateView: some View {
        VStack(spacing: 12) {
            Image(systemName: "newspaper")
                .font(.system(size: metrics.iconSize(base: 44)))
                .foregroundStyle(.secondary)
            Text("No Stories in Newsfeed")
                .font(.system(size: metrics.fontSize(base: 17), weight: .semibold))
                .foregroundStyle(.white)
            Text("Pull down to refresh.")
                .font(.system(size: metrics.fontSize(base: 13)))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
    }
}

// MARK: - Substack Post Card Layout (Large Featured 16:9 Cover & Social Ribbon)
public struct SubstackPostCard: View {
    let item: FeedItem
    let onTap: () -> Void
    @Environment(\.displayMetrics) private var metrics
    @Environment(\.modelContext) private var modelContext
    
    @State private var isLiked = false
    @State private var likesCount = 28
    @State private var isRestacked = false
    @State private var restacksCount = 12
    
    public var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                // 1. Publication Avatar & Byline Header
                HStack(spacing: 8) {
                    ZStack {
                        Circle()
                            .fill(Color(white: 0.18))
                            .frame(width: 26, height: 26)
                        
                        Text(String(item.feed?.title.prefix(1) ?? "P").uppercased())
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color(red: 1.0, green: 0.40, blue: 0.10))
                    }
                    
                    Text(item.feed?.title ?? "Publication")
                        .font(.system(size: metrics.fontSize(base: 12), weight: .semibold))
                        .foregroundStyle(.white)
                    
                    Text("·")
                        .foregroundStyle(.secondary)
                    
                    Text(item.publishedDate, style: .relative)
                        .font(.system(size: metrics.fontSize(base: 11)))
                        .foregroundStyle(.secondary)
                    
                    Spacer()
                    
                    if !item.isRead {
                        Circle()
                            .fill(Color(red: 1.0, green: 0.40, blue: 0.10))
                            .frame(width: 6, height: 6)
                    }
                }
                .padding(.horizontal, metrics.horizontalGutter)
                .padding(.top, 14)
                .padding(.bottom, 8)
                
                // 2. Bold Editorial Serif Headline
                Text(item.title)
                    .font(.system(size: metrics.fontSize(base: 19), weight: .bold, design: .serif))
                    .foregroundStyle(item.isRead ? Color.white.opacity(0.65) : Color.white)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, metrics.horizontalGutter)
                    .padding(.bottom, 6)
                
                // 3. Subtitle / Excerpt
                if let summary = item.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.system(size: metrics.fontSize(base: 13)))
                        .foregroundStyle(Color.white.opacity(0.75))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, metrics.horizontalGutter)
                        .padding(.bottom, 10)
                }
                
                // 4. Large 16:9 Featured Cover Image
                if let imageURL = item.imageURL {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(16/9, contentMode: .fill)
                                .frame(maxWidth: .infinity)
                                .clipped()
                                .cornerRadius(12)
                                .padding(.horizontal, metrics.horizontalGutter)
                                .padding(.bottom, 10)
                        default:
                            EmptyView()
                        }
                    }
                }
                
                // 5. Substack Signature Social Action Ribbon
                HStack(spacing: 20) {
                    // Like Button
                    Button(action: {
                        AppleHapticEngine.shared.toggleSuccess()
                        isLiked.toggle()
                        likesCount += isLiked ? 1 : -1
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: isLiked ? "heart.fill" : "heart")
                                .font(.system(size: metrics.iconSize(base: 13)))
                                .foregroundStyle(isLiked ? Color.red : Color.white.opacity(0.6))
                            Text("\(likesCount)")
                                .font(.system(size: metrics.fontSize(base: 11)))
                                .foregroundStyle(isLiked ? Color.red : Color.white.opacity(0.6))
                        }
                    }
                    .buttonStyle(.plain)
                    
                    // Restack Button
                    Button(action: {
                        AppleHapticEngine.shared.toggleSuccess()
                        isRestacked.toggle()
                        restacksCount += isRestacked ? 1 : -1
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.2.squarepath")
                                .font(.system(size: metrics.iconSize(base: 12), weight: .semibold))
                                .foregroundStyle(isRestacked ? Color.green : Color.white.opacity(0.6))
                            Text("\(restacksCount)")
                                .font(.system(size: metrics.fontSize(base: 11)))
                                .foregroundStyle(isRestacked ? Color.green : Color.white.opacity(0.6))
                        }
                    }
                    .buttonStyle(.plain)
                    
                    // Comment Button
                    Button(action: onTap) {
                        HStack(spacing: 4) {
                            Image(systemName: "bubble.left")
                                .font(.system(size: metrics.iconSize(base: 12)))
                                .foregroundStyle(Color.white.opacity(0.6))
                            Text("14")
                                .font(.system(size: metrics.fontSize(base: 11)))
                                .foregroundStyle(Color.white.opacity(0.6))
                        }
                    }
                    .buttonStyle(.plain)
                    
                    Spacer()
                    
                    // Bookmark Button
                    Button(action: {
                        AppleHapticEngine.shared.toggleSuccess()
                        item.isStarred.toggle()
                        try? modelContext.save()
                    }) {
                        Image(systemName: item.isStarred ? "bookmark.fill" : "bookmark")
                            .font(.system(size: metrics.iconSize(base: 13)))
                            .foregroundStyle(item.isStarred ? Color(red: 1.0, green: 0.40, blue: 0.10) : Color.white.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, metrics.horizontalGutter)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .border(Color.white.opacity(0.06), width: 0.5)
            }
            .liquidGlass(cornerRadius: metrics.cardCornerRadius, opacity: 0.82)
        }
        .buttonStyle(.plain)
    }
}

public struct LiquidCompactRow: View {
    let item: FeedItem
    let onTap: () -> Void
    @Environment(\.displayMetrics) private var metrics
    
    public var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                if !item.isRead {
                    Circle()
                        .fill(Color(red: 1.0, green: 0.40, blue: 0.10))
                        .frame(width: 6, height: 6)
                }
                
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.feed?.title ?? "News")
                        .font(.system(size: metrics.fontSize(base: 10), weight: .bold))
                        .foregroundStyle(Color(red: 1.0, green: 0.40, blue: 0.10))
                        .textCase(.uppercase)
                    
                    Text(item.title)
                        .font(.system(size: metrics.fontSize(base: 14), weight: .medium, design: .serif))
                        .foregroundStyle(item.isRead ? Color.white.opacity(0.6) : Color.white)
                        .lineLimit(2)
                }
                
                Spacer()
                
                Text(item.publishedDate, style: .relative)
                    .font(.system(size: metrics.fontSize(base: 10)))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .liquidGlass(cornerRadius: 16, opacity: 0.70)
        }
        .buttonStyle(.plain)
    }
}

private struct ScrollOffsetPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
