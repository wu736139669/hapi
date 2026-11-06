import SwiftUI

/// Brand logo per agent flavor inside the widget extension.
///
/// Mirrors `Hapi/Features/Sessions/AgentFlavorIcon.swift`; the widget target
/// cannot see app-target sources, so it ships its own copy plus the
/// `AgentIcons` asset catalog under `HapiWidgets/Assets.xcassets`.
struct AgentFlavorIconView: View {
    let flavor: String?
    var size: CGFloat = 16

    @Environment(\.colorScheme) private var colorScheme

    /// Flavors with a bundled `AgentIcons/<flavor>` image set.
    private static let bundledFlavors: Set<String> = [
        "agy", "claude", "codex", "copilot", "cursor",
        "gemini", "grok", "kimi", "opencode", "pi",
    ]

    /// Asset name for a raw `metadata.flavor` value; nil when no icon ships.
    static func assetName(forFlavor flavor: String?) -> String? {
        guard let flavor else { return nil }
        let normalized = flavor.trimmingCharacters(in: .whitespaces).lowercased()
        return bundledFlavors.contains(normalized) ? normalized : nil
    }

    var body: some View {
        content
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var content: some View {
        if let name = Self.assetName(forFlavor: flavor) {
            let icon = Image(name)
                .resizable()
                .scaledToFit()
            if name == "copilot" {
                icon.foregroundStyle(colorScheme == .dark
                    ? Color(red: 230 / 255, green: 237 / 255, blue: 243 / 255)
                    : Color(red: 36 / 255, green: 41 / 255, blue: 47 / 255))
            } else {
                icon
            }
        } else {
            // Raw flavors without a bundled logo keep the status dot instead
            // of a generic placeholder badge: the dot is more useful here.
            Color.clear
        }
    }
}
