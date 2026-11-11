import SwiftUI

public struct ReaderDetailView: View {
    @Bindable var article: FeedItem
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayMetrics) private var metrics
    
    @State private var fontSizeOffset: CGFloat = 0.0
    @State private var isSepiaMode = false
    @State private var showFormattingControls = false
    
    public init(article: FeedItem) {
        self.article = article
    }
    
    public var body: some View {
        ZStack(alignment: .bottom) {
            (isSepiaMode ? Color(red: 0.96, green: 0.93, blue: 0.87) : Color.liquidBackgroundDark)
                .ignoresSafeArea(.all)
            
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let imageURL = article.imageURL {
                        AsyncImage(url: imageURL) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(maxWidth: .infinity, maxHeight: metrics.tier == .compact ? 220 : 300)
                                    .clipped()
                            default:
                                EmptyView()
                            }
                        }
                    }
                    
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            if let source = article.feed?.title {
                                Text(source)
                                    .font(.system(size: metrics.fontSize(base: 12), weight: .bold))
                                    .foregroundStyle(Color.emeraldBrand)
                                    .textCase(.uppercase)
                                    .tracking(1.0)
                            }
                            
                            Spacer()
                            
                            Text(article.publishedDate, style: .date)
                                .font(.system(size: metrics.fontSize(base: 12)))
                                .foregroundStyle(isSepiaMode ? Color.black.opacity(0.6) : Color.white.opacity(0.6))
                        }
                        
                        Text(article.title)
                            .font(.system(size: metrics.fontSize(base: 26) + fontSizeOffset, weight: .bold, design: .serif))
                            .foregroundStyle(isSepiaMode ? Color.black.opacity(0.9) : Color.white)
                            .lineSpacing(4)
                        
                        if let author = article.author, !author.isEmpty {
                            Text("By \(author)")
                                .font(.system(size: metrics.fontSize(base: 13), weight: .medium))
                                .foregroundStyle(isSepiaMode ? Color.black.opacity(0.6) : Color.white.opacity(0.6))
                        }
                        
                        Divider()
                            .background(Color.white.opacity(0.15))
                            .padding(.vertical, 8)
                        
                        Text(cleanBodyContent)
                            .font(.system(size: metrics.fontSize(base: 17) + fontSizeOffset, weight: .regular, design: .serif))
                            .foregroundStyle(isSepiaMode ? Color(red: 0.15, green: 0.13, blue: 0.10) : Color(white: 0.90))
                            .lineSpacing(8)
                    }
                    .padding(.horizontal, metrics.horizontalGutter)
                    .padding(.top, 20)
                    .padding(.bottom, metrics.floatingBarHeight + max(metrics.safeAreaInsets.bottom, 24) + 40)
                }
            }
            .scrollIndicators(.hidden)
            
            topFloatingNav
            bottomReaderDock
        }
        .onAppear {
            article.isRead = true
        }
    }
    
    // MARK: - Top Floating Glass Nav
    private var topFloatingNav: some View {
        VStack {
            HStack {
                Button(action: { dismiss() }) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                        .foregroundStyle(isSepiaMode ? Color.black : Color.white)
                        .frame(width: metrics.iconSize(base: 38), height: metrics.iconSize(base: 38))
                        .liquidGlass(cornerRadius: 19, opacity: 0.85)
                }
                
                Spacer()
                
                Button(action: {
                    withAnimation {
                        article.isStarred.toggle()
                    }
                }) {
                    Image(systemName: article.isStarred ? "bookmark.fill" : "bookmark")
                        .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                        .foregroundStyle(article.isStarred ? Color.amber : (isSepiaMode ? Color.black : Color.white))
                        .frame(width: metrics.iconSize(base: 38), height: metrics.iconSize(base: 38))
                        .liquidGlass(cornerRadius: 19, opacity: 0.85)
                }
            }
            .padding(.horizontal, metrics.horizontalGutter)
            .padding(.top, max(metrics.safeAreaInsets.top, 12))
            
            Spacer()
        }
    }
    
    // MARK: - Bottom Reader Floating Dock
    private var bottomReaderDock: some View {
        LiquidGlassFloatingBar {
            HStack {
                Button(action: {
                    if fontSizeOffset > -4 { fontSizeOffset -= 2 }
                }) {
                    Image(systemName: "textformat.size.smaller")
                        .font(.system(size: metrics.iconSize(base: 16), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(isSepiaMode ? Color.black : Color.white)
                }
                
                Button(action: {
                    if fontSizeOffset < 8 { fontSizeOffset += 2 }
                }) {
                    Image(systemName: "textformat.size.larger")
                        .font(.system(size: metrics.iconSize(base: 16), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(isSepiaMode ? Color.black : Color.white)
                }
                
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isSepiaMode.toggle()
                    }
                }) {
                    Image(systemName: isSepiaMode ? "moon.stars.fill" : "sun.max.fill")
                        .font(.system(size: metrics.iconSize(base: 16), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(isSepiaMode ? Color.black : Color.white)
                }
                
                if let link = article.link {
                    ShareLink(item: link) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: metrics.iconSize(base: 16), weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .foregroundStyle(isSepiaMode ? Color.black : Color.white)
                    }
                }
            }
        }
    }
    
    private var cleanBodyContent: String {
        let raw = article.contentHTML ?? article.summary ?? "No article text available."
        return raw.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression, range: nil)
    }
}
