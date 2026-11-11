import SwiftUI

public struct LiquidGlassModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let cornerRadius: CGFloat
    let interactiveSheen: Bool
    let opacity: CGFloat
    
    public init(cornerRadius: CGFloat = 24, interactiveSheen: Bool = true, opacity: CGFloat = 0.85) {
        self.cornerRadius = cornerRadius
        self.interactiveSheen = interactiveSheen
        self.opacity = opacity
    }
    
    public var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(.ultraThinMaterial)
                .opacity(opacity)
            
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: colorScheme == .dark
                            ? [Color(white: 0.12).opacity(0.45), Color(white: 0.04).opacity(0.70)]
                            : [Color.white.opacity(0.65), Color.white.opacity(0.35)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        stops: [
                            .init(color: Color.white.opacity(colorScheme == .dark ? 0.35 : 0.75), location: 0.0),
                            .init(color: Color.white.opacity(colorScheme == .dark ? 0.10 : 0.25), location: 0.35),
                            .init(color: Color.clear, location: 0.65),
                            .init(color: Color.black.opacity(colorScheme == .dark ? 0.40 : 0.10), location: 1.0)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.0
                )
        }
        .shadow(
            color: colorScheme == .dark ? Color.black.opacity(0.40) : Color.black.opacity(0.08),
            radius: 16,
            x: 0,
            y: 8
        )
    }
}

public extension View {
    func liquidGlass(cornerRadius: CGFloat = 24, interactiveSheen: Bool = true, opacity: CGFloat = 0.85) -> some View {
        self.background(LiquidGlassModifier(cornerRadius: cornerRadius, interactiveSheen: interactiveSheen, opacity: opacity))
    }
}

public struct LiquidGlassFloatingBar<Content: View>: View {
    @Environment(\.displayMetrics) private var metrics
    let content: Content
    
    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }
    
    public var body: some View {
        HStack(spacing: 0) {
            content
        }
        .padding(.horizontal, 10)
        .frame(height: metrics.floatingBarHeight)
        .liquidGlass(cornerRadius: metrics.floatingBarHeight / 2, opacity: 0.90)
        .padding(.horizontal, metrics.horizontalGutter)
        .padding(.bottom, max(metrics.safeAreaInsets.bottom, 12))
    }
}

public struct LiquidGlassPillButton: View {
    let title: String
    let icon: String?
    let isSelected: Bool
    let badgeCount: Int
    let action: () -> Void
    @Environment(\.displayMetrics) private var metrics
    
    public init(
        title: String,
        icon: String? = nil,
        isSelected: Bool,
        badgeCount: Int = 0,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.isSelected = isSelected
        self.badgeCount = badgeCount
        self.action = action
    }
    
    public var body: some View {
        Button(action: {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                action()
            }
        }) {
            HStack(spacing: 5) {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: metrics.iconSize(base: 13), weight: .semibold))
                }
                
                Text(title)
                    .font(.system(size: metrics.fontSize(base: 13), weight: isSelected ? .semibold : .medium))
                
                if badgeCount > 0 {
                    Text("\(badgeCount)")
                        .font(.system(size: metrics.fontSize(base: 10), weight: .bold, design: .rounded))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(isSelected ? Color.white.opacity(0.25) : Color.emeraldBrand.opacity(0.18))
                        .foregroundStyle(isSelected ? Color.white : Color.emeraldBrand)
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, metrics.tier == .compact ? 10 : 14)
            .padding(.vertical, 7)
            .background {
                if isSelected {
                    Capsule(style: .continuous)
                        .fill(Color.emeraldBrand)
                        .shadow(color: Color.emeraldBrand.opacity(0.4), radius: 8, y: 3)
                }
            }
            .foregroundStyle(isSelected ? Color.white : Color.primary.opacity(0.75))
        }
        .buttonStyle(.plain)
    }
}

public extension Color {
    static let emeraldBrand = Color(red: 0.03, green: 0.58, blue: 0.42)
    static let liquidBackgroundDark = Color(red: 0.04, green: 0.05, blue: 0.06)
}
