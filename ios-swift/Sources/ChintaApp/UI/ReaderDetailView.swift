import SwiftUI

public struct ReaderDetailView: View {
    @Bindable var article: FeedItem
    @Environment(\.dismiss) private var dismiss
    @Environment(\.displayMetrics) private var metrics

    @AppStorage("chinta_tap_to_load_media") private var tapToLoadMedia = false
    @AppStorage("chinta_block_third_party_media") private var blockThirdPartyMedia = true
    @State private var fontSizeOffset: CGFloat = 0.0
    @State private var isOledMode = false
    @State private var isHeroImageLoaded = false

    private var readerBackgroundColor: Color {
        isOledMode
            ? Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)
            : Color(red: 24 / 255, green: 24 / 255, blue: 24 / 255) // #181818
    }

    public init(article: FeedItem) {
        self.article = article
    }

    private func isFirstPartyMediaURL(_ mediaURL: URL) -> Bool {
        guard let mediaHost = mediaURL.host?.lowercased() else { return false }
        if FeedParserService.isTrackerURL(mediaURL.absoluteString) {
            return false
        }
        guard !blockThirdPartyMedia else {
            let referenceHost = (article.link?.host ?? article.feed?.siteURL?.host ?? article.feed?.url.host)?.lowercased() ?? ""
            if referenceHost.isEmpty { return true }
            let cleanMedia = mediaHost.hasPrefix("www.") ? String(mediaHost.dropFirst(4)) : mediaHost
            let cleanRef = referenceHost.hasPrefix("www.") ? String(referenceHost.dropFirst(4)) : referenceHost
            if cleanMedia == cleanRef || cleanMedia.hasSuffix("." + cleanRef) || cleanRef.hasSuffix("." + cleanMedia) {
                return true
            }
            let baseLabel = cleanRef.split(separator: ".").first.map(String.init) ?? ""
            if baseLabel.count >= 4 && cleanMedia.contains(baseLabel) {
                return true
            }
            return false
        }
        return true
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            readerBackgroundColor
                .ignoresSafeArea(.all)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 12) {
                        // 1. Uppercase Kicker
                        if let source = article.feed?.title {
                            Text(source.uppercased())
                                .font(.system(size: metrics.fontSize(base: 12), weight: .semibold))
                                .foregroundStyle(Color(white: 0.62))
                                .tracking(0.8)
                        }

                        // 2. Bold Sans-Serif Headline
                        Text(article.title)
                            .font(.system(size: metrics.fontSize(base: 30) + fontSizeOffset, weight: .bold, design: .default))
                            .foregroundStyle(Color(white: 0.93))
                            .lineSpacing(2)

                        // 3. Overlapping Circular Avatars + Reader Mark
                        HStack {
                            HStack(spacing: -8) {
                                Circle()
                                    .fill(Color(red: 0.85, green: 0.14, blue: 0.14))
                                    .frame(width: 36, height: 36)
                                    .overlay(
                                        Text(String((article.feed?.title ?? "N").prefix(1)).uppercased())
                                            .font(.system(size: 17, weight: .bold, design: .serif))
                                            .foregroundStyle(.white)
                                    )
                                    .overlay(Circle().stroke(readerBackgroundColor, lineWidth: 2))

                                if let author = article.author, !author.isEmpty {
                                    Circle()
                                        .fill(Color(red: 0.31, green: 0.36, blue: 0.45))
                                        .frame(width: 36, height: 36)
                                        .overlay(
                                            Text(String(author.prefix(1)).uppercased())
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(.white)
                                        )
                                        .overlay(Circle().stroke(readerBackgroundColor, lineWidth: 2))
                                }

                                Circle()
                                    .fill(
                                        LinearGradient(
                                            colors: [Color(red: 1.0, green: 0.48, blue: 0.18), Color(red: 0.91, green: 0.32, blue: 0.10)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(width: 36, height: 36)
                                    .overlay(Circle().stroke(readerBackgroundColor, lineWidth: 2))
                            }

                            Spacer()

                            Text("reader")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color(white: 0.94))
                        }
                        .padding(.top, 8)

                        // 4. Uppercase Byline & Timestamp
                        VStack(alignment: .leading, spacing: 4) {
                            Text(bylineUppercased)
                                .font(.system(size: 11.5, weight: .bold))
                                .foregroundStyle(Color(white: 0.87))
                                .tracking(0.5)

                            Text(formattedTimestampUppercased)
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(Color(white: 0.56))
                                .tracking(0.5)
                        }
                        .padding(.top, 4)

                        // 5. Thin Divider
                        Rectangle()
                            .fill(Color(white: 0.17))
                            .frame(height: 1)
                            .padding(.vertical, 12)

                        // 6. Rectangular Hero Image (with Strict Tap-to-Load & Third-Party Media Blocker)
                        if let imageURL = article.imageURL, isFirstPartyMediaURL(imageURL) {
                            if tapToLoadMedia && !isHeroImageLoaded {
                                Button(action: {
                                    isHeroImageLoaded = true
                                }) {
                                    HStack(spacing: 10) {
                                        Image(systemName: "shield.lefthalf.filled")
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(Color.orange)
                                        Text("Load Image")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Color(white: 0.92))
                                        Spacer()
                                        Text(imageURL.host ?? "Remote Media")
                                            .font(.system(size: 11, weight: .regular))
                                            .foregroundStyle(Color(white: 0.56))
                                            .lineLimit(1)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 12)
                                    .frame(maxWidth: .infinity)
                                    .background(Color(white: 0.14))
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color(white: 0.22), lineWidth: 1)
                                    )
                                }
                                .buttonStyle(.plain)
                                .padding(.bottom, 12)
                            } else {
                                AsyncImage(url: imageURL) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image
                                            .resizable()
                                            .aspectRatio(contentMode: .fit)
                                            .frame(maxWidth: .infinity)
                                            .clipShape(RoundedRectangle(cornerRadius: 2))
                                            .padding(.bottom, 12)
                                    default:
                                        EmptyView()
                                    }
                                }
                            }
                        }

                        // 7. Editorial Serif Body Copy
                        Text(cleanBodyContent)
                            .font(.system(size: metrics.fontSize(base: 19) + fontSizeOffset, weight: .regular, design: .serif))
                            .foregroundStyle(Color(white: 0.90))
                            .lineSpacing(8)
                    }
                    .padding(.horizontal, metrics.horizontalGutter)
                    .padding(.top, max(metrics.safeAreaInsets.top, 20))
                    .padding(.bottom, metrics.floatingBarHeight + max(metrics.safeAreaInsets.bottom, 24) + 40)
                }
            }
            .scrollIndicators(.hidden)

            bottomReaderDock
        }
        .onAppear {
            article.isRead = true
        }
    }

    // MARK: - Bottom Reader Floating Dock
    private var bottomReaderDock: some View {
        LiquidGlassFloatingBar {
            HStack {
                Button(action: { dismiss() }) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("Feed")
                    }
                    .font(.system(size: metrics.iconSize(base: 14), weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(Color.white)
                }

                Button(action: {
                    if fontSizeOffset > -4 { fontSizeOffset -= 2 }
                }) {
                    Image(systemName: "textformat.size.smaller")
                        .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(Color.white)
                }

                Button(action: {
                    if fontSizeOffset < 8 { fontSizeOffset += 2 }
                }) {
                    Image(systemName: "textformat.size.larger")
                        .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(Color.white)
                }

                Button(action: {
                    tapToLoadMedia.toggle()
                    if !tapToLoadMedia {
                        isHeroImageLoaded = true
                    } else {
                        isHeroImageLoaded = false
                    }
                }) {
                    Image(systemName: tapToLoadMedia ? "photo.badge.shield.fill" : "photo")
                        .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(tapToLoadMedia ? Color.orange : Color.white)
                }

                Button(action: {
                    withAnimation {
                        article.isStarred.toggle()
                    }
                }) {
                    Image(systemName: article.isStarred ? "bookmark.fill" : "bookmark")
                        .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(article.isStarred ? Color.orange : Color.white)
                }

                if let link = article.link {
                    ShareLink(item: link) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: metrics.iconSize(base: 15), weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .foregroundStyle(Color.white)
                    }
                }
            }
        }
    }

    private var bylineUppercased: String {
        let feedTitle = article.feed?.title ?? "News"
        if let author = article.author, !author.isEmpty, author.lowercased() != feedTitle.lowercased() {
            return "\(feedTitle), \(author)".uppercased()
        }
        return feedTitle.uppercased()
    }

    private var formattedTimestampUppercased: String {
        let df = DateFormatter()
        df.dateFormat = "MMM d, yyyy 'AT' h:mm a"
        return df.string(from: article.publishedDate).uppercased()
    }

    private var cleanBodyContent: String {
        let raw = FeedParserService.sanitizeHTML(article.contentHTML ?? article.summary) ?? "No article text available."
        return raw.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression, range: nil)
    }
}
