import SwiftUI

public enum iPhoneDisplayTier: String, Sendable {
    case compact    // iPhone SE (2nd/3rd gen), iPhone 12/13 mini (width <= 375pt)
    case standard   // iPhone 12/13/14/15/16, iPhone Pro (390pt - 402pt)
    case proMax     // iPhone Plus, iPhone Pro Max (width >= 428pt)
    
    public var scaleFactor: CGFloat {
        switch self {
        case .compact:  return 0.90
        case .standard: return 1.00
        case .proMax:   return 1.12
        }
    }
}

@Observable
public final class DisplayMetrics {
    public var windowSize: CGSize = .zero
    public var safeAreaInsets: EdgeInsets = EdgeInsets()
    public var tier: iPhoneDisplayTier = .standard
    public var hasDynamicIsland: Bool = false
    public var hasHomeIndicator: Bool = true
    
    public init() {}
    
    public func update(geometry: GeometryProxy) {
        self.windowSize = geometry.size
        self.safeAreaInsets = geometry.safeAreaInsets
        
        let width = geometry.size.width
        if width <= 380 {
            self.tier = .compact
        } else if width >= 420 {
            self.tier = .proMax
        } else {
            self.tier = .standard
        }
        
        self.hasDynamicIsland = geometry.safeAreaInsets.top >= 54
        self.hasHomeIndicator = geometry.safeAreaInsets.bottom > 0
    }
    
    public func fontSize(base: CGFloat) -> CGFloat {
        round(base * tier.scaleFactor)
    }
    
    public func iconSize(base: CGFloat) -> CGFloat {
        round(base * tier.scaleFactor)
    }
    
    public var horizontalGutter: CGFloat {
        switch tier {
        case .compact: return 14
        case .standard: return 18
        case .proMax:   return 22
        }
    }
    
    public var cardCornerRadius: CGFloat {
        switch tier {
        case .compact: return 18
        case .standard: return 22
        case .proMax:   return 26
        }
    }
    
    public var floatingBarHeight: CGFloat {
        switch tier {
        case .compact: return 58
        case .standard: return 64
        case .proMax:   return 70
        }
    }
}

private struct DisplayMetricsKey: EnvironmentKey {
    static let defaultValue: DisplayMetrics = DisplayMetrics()
}

public extension EnvironmentValues {
    var displayMetrics: DisplayMetrics {
        get { self[DisplayMetricsKey.self] }
        set { self[DisplayMetricsKey.self] = newValue }
    }
}

public struct AdaptiveViewportContainer<Content: View>: View {
    @State private var metrics = DisplayMetrics()
    let content: (DisplayMetrics) -> Content
    
    public init(@ViewBuilder content: @escaping (DisplayMetrics) -> Content) {
        self.content = content
    }
    
    public var body: some View {
        GeometryReader { proxy in
            content(metrics)
                .environment(\.displayMetrics, metrics)
                .onAppear {
                    metrics.update(geometry: proxy)
                }
                .onChange(of: proxy.size) { _, _ in
                    metrics.update(geometry: proxy)
                }
        }
        .ignoresSafeArea(.all)
    }
}
