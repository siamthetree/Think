import SwiftUI
import SwiftData

public struct SourcesManagerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(\.displayMetrics) private var metrics
    @Query(sort: \Feed.title) private var feeds: [Feed]
    
    @State private var isAddFeedPresented = false
    @State private var newFeedURLString = ""
    
    public init() {}
    
    public var body: some View {
        NavigationStack {
            ZStack {
                Color.liquidBackgroundDark
                    .ignoresSafeArea(.all)
                
                ScrollView {
                    VStack(spacing: 16) {
                        let failing = feeds.filter { $0.isFailing }
                        if !failing.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("Needs Attention (5+ Failed Attempts)", systemImage: "exclamationmark.triangle.fill")
                                    .font(.system(size: metrics.fontSize(base: 12), weight: .bold))
                                    .foregroundStyle(.orange)
                                
                                ForEach(failing) { feed in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(feed.title)
                                                .font(.system(size: metrics.fontSize(base: 14), weight: .semibold))
                                                .foregroundStyle(.white)
                                            Text(feed.lastErrorMessage ?? "Connection timed out")
                                                .font(.system(size: metrics.fontSize(base: 11)))
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Button("Retry") {
                                            let feedID = feed.id
                                            let container = modelContext.container
                                            Task {
                                                await FeedRefreshEngine.shared.pullToRefresh(feedID: feedID, container: container)
                                            }
                                        }
                                        .font(.system(size: metrics.fontSize(base: 12), weight: .semibold))
                                        .buttonStyle(.borderedProminent)
                                        .tint(.orange)
                                    }
                                    .padding(12)
                                    .liquidGlass(cornerRadius: 14, opacity: 0.8)
                                }
                            }
                            .padding(.horizontal, metrics.horizontalGutter)
                        }
                        
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Active Newspapers & Feeds")
                                .font(.system(size: metrics.fontSize(base: 12), weight: .bold))
                                .foregroundStyle(Color.emeraldBrand)
                                .textCase(.uppercase)
                            
                            ForEach(feeds) { feed in
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(feed.title)
                                            .font(.system(size: metrics.fontSize(base: 15), weight: .semibold, design: .serif))
                                            .foregroundStyle(.white)
                                        
                                        HStack(spacing: 6) {
                                            let mins = Int(feed.currentInterval / 60)
                                            Text("\(mins)m interval")
                                                .font(.system(size: metrics.fontSize(base: 10), weight: .semibold))
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(Color.white.opacity(0.1))
                                                .clipShape(Capsule())
                                            
                                            Text("\(feed.items.count) cached")
                                                .font(.system(size: metrics.fontSize(base: 11)))
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    
                                    Spacer()
                                    
                                    Button(action: {
                                        modelContext.delete(feed)
                                        try? modelContext.save()
                                    }) {
                                        Image(systemName: "trash")
                                            .font(.system(size: metrics.iconSize(base: 14)))
                                            .foregroundStyle(.red.opacity(0.8))
                                    }
                                }
                                .padding(14)
                                .liquidGlass(cornerRadius: 16, opacity: 0.75)
                            }
                        }
                        .padding(.horizontal, metrics.horizontalGutter)
                    }
                    .padding(.vertical, 16)
                }
            }
            .navigationTitle("Newspapers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Color.emeraldBrand)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { isAddFeedPresented = true }) {
                        Image(systemName: "plus")
                            .foregroundStyle(Color.emeraldBrand)
                    }
                }
            }
            .alert("Add News Portal or RSS Feed", isPresented: $isAddFeedPresented) {
                TextField("https://example.com/rss", text: $newFeedURLString)
                    .textInputAutocapitalization(.never)
                Button("Add") {
                    if let url = URL(string: newFeedURLString.trimmingCharacters(in: .whitespacesAndNewlines)) {
                        let newFeed = Feed(title: url.host ?? "Newspaper Feed", url: url)
                        modelContext.insert(newFeed)
                        try? modelContext.save()
                        let feedID = newFeed.id
                        let container = modelContext.container
                        Task {
                            await FeedRefreshEngine.shared.pullToRefresh(feedID: feedID, container: container)
                        }
                    }
                    newFeedURLString = ""
                }
                Button("Cancel", role: .cancel) {
                    newFeedURLString = ""
                }
            }
        }
    }
}
