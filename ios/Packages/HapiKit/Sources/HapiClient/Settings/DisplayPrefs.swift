import Foundation
import Observation

/// User-adjustable display sizes, independent of Dynamic Type.
///
/// The web sidebar exposes a global font scale and a terminal font size. iOS
/// keeps the scales app-local and applies the list scale only to the session
/// list; the code scale applies to terminal-styled output and code blocks.
@MainActor @Observable
public final class DisplayPrefs {
    public static let listFontScaleKey = "settings.sessionListFontScale"
    public static let codeFontSizeKey = "settings.codeFontSize"

    public static let listFontScales: [Double] = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
    public static let codeFontSizes: [Double] = [9, 11, 13, 15, 17]

    public static let defaultListFontScale = 1.0
    public static let defaultCodeFontSize = 13.0

    public private(set) var listFontScale: Double
    public private(set) var codeFontSize: Double

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let storedScale = defaults.object(forKey: Self.listFontScaleKey) as? Double
        self.listFontScale = Self.validScale(storedScale) ?? Self.defaultListFontScale
        let storedCode = defaults.object(forKey: Self.codeFontSizeKey) as? Double
        self.codeFontSize = Self.validCodeSize(storedCode) ?? Self.defaultCodeFontSize
    }

    public func setListFontScale(_ value: Double) {
        guard let value = Self.validScale(value) else { return }
        listFontScale = value
        defaults.set(value, forKey: Self.listFontScaleKey)
    }

    public func setCodeFontSize(_ value: Double) {
        guard let value = Self.validCodeSize(value) else { return }
        codeFontSize = value
        defaults.set(value, forKey: Self.codeFontSizeKey)
    }

    private static func validScale(_ value: Double?) -> Double? {
        guard let value, listFontScales.contains(value) else { return nil }
        return value
    }

    private static func validCodeSize(_ value: Double?) -> Double? {
        guard let value, codeFontSizes.contains(value) else { return nil }
        return value
    }
}
