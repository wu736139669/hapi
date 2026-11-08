import Foundation

/// A `(wire value, display label)` pair for the create-form option pickers.
public struct NewSessionOption: Equatable, Hashable, Sendable {
    public let value: String
    public let label: String
    /// Optional picker section (the web renders these as `<optgroup>`).
    public let group: String?

    public init(value: String, label: String, group: String? = nil) {
        self.value = value
        self.label = label
        self.group = group
    }
}

/// Static option catalogs for the new-session form. The claude rows are
/// **derived** from `ClaudeModels` / `ClaudeEfforts` (issue #39: one source
/// of truth shared with `ModelCatalog`'s composer builders) rather than
/// duplicating the preset/label tables. Only the codex reasoning list is its
/// own data — a port of the web `CODEX_REASONING_EFFORT_OPTIONS`
/// (`web/src/components/NewSession/types.ts`; the web drops `max` for codex
/// — `EffortField.tsx`). Android keeps a feature-local copy
/// (`NewSessionCatalogs.kt`); here the catalogs live in one package so the
/// pure form logic and the app UI share one source.
public enum NewSessionCatalogs {
    /// `'auto'` sentinel row uses the web's "Default" label; preset rows come
    /// from `ClaudeModels` in picker order.
    public static let claudeModels: [NewSessionOption] =
        [NewSessionOption(value: "auto", label: "Default")]
            + ClaudeModels.presets.map {
                NewSessionOption(value: $0, label: ClaudeModels.label(for: $0) ?? $0)
            }

    /// `'auto'` sentinel row, then the `ClaudeEfforts` levels in ascending
    /// order.
    public static let claudeEfforts: [NewSessionOption] =
        [NewSessionOption(value: "auto", label: "Default")]
            + ClaudeEfforts.levels.map {
                NewSessionOption(value: $0, label: ClaudeEfforts.label(for: $0) ?? effortLabel($0))
            }

    /// Launch model rows for Claude, mirroring the web
    /// `getClaudeLaunchModelOptions`: the machine CLI catalog replaces the
    /// built-in presets when available; earlier family versions go under the
    /// "Other models" section; a saved model the catalog no longer lists stays
    /// selectable with a suffix.
    public static func claudeLaunchModelOptions(
        catalog: [ClaudeModelSummary]?,
        selectedModel: String?,
        notListedSuffix: String,
        otherModelsLabel: String
    ) -> [NewSessionOption] {
        guard let catalog, !catalog.isEmpty else { return claudeModels }

        var familySeen = Set<String>()
        var main: [NewSessionOption] = []
        var other: [NewSessionOption] = []
        for row in catalog where row.value != "default" {
            let family = claudeFamily(row.value)
            let isMain = familySeen.insert(family).inserted
            let option = NewSessionOption(
                value: row.value,
                label: row.displayName ?? ClaudeModels.label(for: row.value) ?? row.value,
                group: isMain ? nil : otherModelsLabel
            )
            if isMain { main.append(option) } else { other.append(option) }
        }

        let listed = Set((main + other).map(\.value))
        let normalized = (selectedModel?.trimmingCharacters(in: .whitespaces) ?? "")
        let selected = normalized.isEmpty || normalized == "auto" || normalized == "default"
            ? nil
            : normalized
        var options = [NewSessionOption(value: "auto", label: "Default")]
        if let selected, !listed.contains(selected) {
            let base = ClaudeModels.label(for: selected) ?? selected
            options.append(NewSessionOption(value: selected, label: "\(base) (\(notListedSuffix))"))
        }
        options.append(contentsOf: main)
        options.append(contentsOf: other)
        return options
    }

    /// Custom model names configured for a non-Anthropic Claude endpoint.
    /// They replace the built-in aliases because those aliases would name
    /// models the configured endpoint does not serve.
    public static func claudeCustomModelOptions(
        _ models: [String],
        selectedModel: String?
    ) -> [NewSessionOption] {
        let normalized = (selectedModel?.trimmingCharacters(in: .whitespaces) ?? "")
        let selected = normalized.isEmpty || normalized == "auto" || normalized == "default"
            ? nil
            : normalized
        var options = [NewSessionOption(value: "auto", label: "Default")]
        if let selected, !models.contains(selected) {
            options.append(NewSessionOption(value: selected, label: selected))
        }
        options.append(contentsOf: models.map {
            NewSessionOption(value: $0, label: $0)
        })
        return options
    }

    /// Effort rows for the selected Claude model. Unknown support keeps the
    /// static levels; an empty catalog row means only Default is offered.
    public static func claudeEffortOptions(
        catalog: [ClaudeModelSummary]?,
        model: String?,
        currentEffort: String?
    ) -> [NewSessionOption]? {
        guard let catalog, !catalog.isEmpty else { return claudeEfforts }
        let normalizedModel = (model?.trimmingCharacters(in: .whitespaces) ?? "")
        let lookup = normalizedModel.isEmpty || normalizedModel == "auto" || normalizedModel == "default"
            ? "default"
            : normalizedModel
        guard let levels = catalog.first(where: { $0.value == lookup })?.effortLevels else {
            return claudeEfforts
        }
        let supported = ClaudeEfforts.levels.filter { levels.contains($0) }
        var options = [NewSessionOption(value: "auto", label: "Default")]
        let normalizedEffort = (currentEffort?.trimmingCharacters(in: .whitespaces).lowercased() ?? "")
        if !normalizedEffort.isEmpty,
           normalizedEffort != "auto", normalizedEffort != "default",
           !supported.contains(normalizedEffort) {
            options.append(NewSessionOption(value: normalizedEffort, label: effortLabel(normalizedEffort)))
        }
        options.append(contentsOf: supported.map {
            NewSessionOption(value: $0, label: ClaudeEfforts.label(for: $0) ?? effortLabel($0))
        })
        return options
    }

    private static func claudeFamily(_ value: String) -> String {
        let trimmed = value.hasPrefix("claude-") ? String(value.dropFirst("claude-".count)) : value
        return trimmed.split(whereSeparator: { $0 == "-" || $0 == "[" }).first.map(String.init) ?? trimmed
    }

    /// Static codex fallback when the model row advertises no efforts
    /// (the web drops `max` for codex — `EffortField.tsx`).
    public static let codexReasoningEfforts: [NewSessionOption] = [
        NewSessionOption(value: "default", label: "Default"),
        NewSessionOption(value: "low", label: "Low"),
        NewSessionOption(value: "medium", label: "Medium"),
        NewSessionOption(value: "high", label: "High"),
        NewSessionOption(value: "xhigh", label: "XHigh"),
    ]

    /// Capitalized label for a server-advertised effort id (`high` → `High`).
    public static func effortLabel(_ value: String) -> String {
        ModelCatalog.capitalizedFirst(value)
    }
}
