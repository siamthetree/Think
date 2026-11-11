import Foundation
import UIKit
import CoreHaptics

/// Apple-Level Native Haptic Feedback Engine
/// Leveraging CoreHaptics and UIKit Feedback Generators for hardware-grade tactile sensation.
@MainActor
public final class AppleHapticEngine {
    public static let shared = AppleHapticEngine()
    
    private var hapticEngine: CHHapticEngine?
    private let impactLight = UIImpactFeedbackGenerator(style: .light)
    private let impactMedium = UIImpactFeedbackGenerator(style: .medium)
    private let impactRigid = UIImpactFeedbackGenerator(style: .rigid)
    private let notification = UINotificationFeedbackGenerator()
    
    private init() {
        prepareEngine()
        prepareGenerators()
    }
    
    private func prepareGenerators() {
        impactLight.prepare()
        impactMedium.prepare()
        impactRigid.prepare()
        notification.prepare()
    }
    
    private func prepareEngine() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            hapticEngine = try CHHapticEngine()
            try hapticEngine?.start()
            
            hapticEngine?.resetHandler = { [weak self] in
                do {
                    try self?.hapticEngine?.start()
                } catch {
                    print("Failed to restart CoreHaptics engine: \(error)")
                }
            }
        } catch {
            print("CoreHaptics not available on this device: \(error)")
        }
    }
    
    /// Apple pull-to-refresh detent click
    /// Fires precisely when the pull gesture reaches the refresh threshold.
    public func pullThresholdDetent() {
        if CHHapticEngine.capabilitiesForHardware().supportsHaptics, let engine = hapticEngine {
            do {
                try engine.start()
                let intensity = CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.95)
                let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.85)
                let event = CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [intensity, sharpness],
                    relativeTime: 0
                )
                let pattern = try CHHapticPattern(events: [event], parameters: [])
                let player = try engine.makePlayer(with: pattern)
                try player.start(atTime: CHHapticTimeImmediate)
                return
            } catch {
                // Fall back to UIKit
            }
        }
        
        impactRigid.prepare()
        impactRigid.impactOccurred(intensity: 1.0)
    }
    
    /// Apple pull-to-refresh completion pulse
    /// Gentle, subtle success vibration when feed synchronization finishes.
    public func refreshCompleted() {
        if CHHapticEngine.capabilitiesForHardware().supportsHaptics, let engine = hapticEngine {
            do {
                try engine.start()
                let p1 = CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.65),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.40)
                    ],
                    relativeTime: 0
                )
                let p2 = CHHapticEvent(
                    eventType: .hapticTransient,
                    parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.50),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.30)
                    ],
                    relativeTime: 0.045
                )
                let pattern = try CHHapticPattern(events: [p1, p2], parameters: [])
                let player = try engine.makePlayer(with: pattern)
                try player.start(atTime: CHHapticTimeImmediate)
                return
            } catch {
                // Fall back to UIKit
            }
        }
        
        notification.prepare()
        notification.notificationOccurred(.success)
    }
    
    /// Card tap / micro-selection feedback
    public func selectionTick() {
        impactLight.prepare()
        impactLight.impactOccurred(intensity: 0.7)
    }
    
    /// Action ribbon toggle (Like / Restack / Bookmark)
    public func toggleSuccess() {
        impactMedium.prepare()
        impactMedium.impactOccurred(intensity: 0.85)
    }
}
