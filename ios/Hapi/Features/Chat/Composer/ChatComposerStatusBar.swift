import HapiClient
import HapiProtocol
import HapiUI
import SwiftUI

/// Quiet one-line status above the composer: connection/thinking state plus
/// the active model, effort and permission labels. Tapping any chip opens the
/// existing session config sheet; this is a readout, not a second settings UI.
struct ChatComposerStatusBar: View {
    let model: ChatModel

    @Environment(\.hapiTheme) private var theme
    @Environment(\.hapiTypography) private var typography

    private var status: (label: String, color: Color) {
        ChatSessionStatus.label(
            active: model.header.active,
            thinking: model.header.thinking,
            reconnecting: model.isReconnecting
        )
    }

    private var config: SessionConfigState {
        model.interactor.config
    }

    private var modelLabel: String? {
        // The transcript is more truthful than session.model for local Claude
        // sessions whose provider maps an alias to a different backend model.
        if let latest = model.latestModel, !latest.isEmpty {
            return latest
        }
        if let label = config.modelOptions?.first(where: { $0.value == config.model })?.label {
            return label
        }
        return config.model ?? model.header.model
    }

    private var effortLabel: String? {
        if let effort = config.effort ?? model.header.effort {
            return config.effortOptions?.first { $0.value == effort }?.label ?? effort
        }
        // Codex's default has no wire value; show it without forcing a
        // model-catalog request just to render the status strip.
        return model.header.flavor == "codex" ? "Default" : nil
    }

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Circle()
                    .fill(status.color)
                    .frame(width: 6, height: 6)
                Text(status.label)
                    .foregroundStyle(status.color)
            }
            .lineLimit(1)

            Spacer(minLength: 8)

            if let usage = model.latestUsage {
                ContextUsagePill(usage: usage, window: usage.contextWindow)
            }
            if model.header.isCompacting {
                statusChip("Compacting", icon: "archivebox.fill", tint: theme.warning)
            }
            if model.header.backgroundTaskCount > 0 {
                // Not a settings button: Claude Code's background tasks
                // (long-running commands/subagents) still running. A terminal
                // reads as work; the old gear read as settings. Tapping lists
                // the task descriptions the hub forwarded.
                backgroundTasksChip(
                    count: model.header.backgroundTaskCount,
                    tasks: model.header.backgroundTasks
                )
            }
            if model.header.serviceTier == "fast" {
                statusChip("Fast", icon: "bolt.fill", tint: theme.success)
            }
            if let mode = model.header.collaborationMode, mode != .default {
                statusChip(mode.label, icon: "person.2")
            }
            if modelLabel != nil || effortLabel != nil {
                HStack(spacing: 4) {
                    if let modelLabel {
                        Image(systemName: "cpu")
                            .font(.system(size: 9, weight: .medium))
                        Text(modelLabel)
                    }
                    if let modelLabel, let effortLabel {
                        Text(verbatim: "·")
                            .foregroundStyle(theme.textHint)
                    }
                    if let effortLabel {
                        Text(effortLabel)
                    }
                }
                .lineLimit(1)
            }
        }
        .font(typography.captionFont)
        .foregroundStyle(theme.textSecondary)
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .hapiReadingColumn()
        .accessibilityElement(children: .combine)
    }

    /// Background-task count chip; tap opens the running task list instead of
    /// leaving a number with no explanation.
    private func backgroundTasksChip(count: Int, tasks: [HapiProtocol.BackgroundTask]?) -> some View {
        Menu {
            Text("Background tasks: \(count)")
            Divider()
            if let tasks, !tasks.isEmpty {
                ForEach(tasks) { task in
                    Text(verbatim: task.description.isEmpty ? task.type : task.description)
                }
            }
        } label: {
            statusChip("\(count)", icon: "terminal.fill")
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel(Text("Background tasks: \(count)"))
    }

    private func statusChip(_ label: String, icon: String, tint: Color? = nil) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .medium))
            Text(label)
                .lineLimit(1)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(theme.surface, in: Capsule())
        .foregroundStyle(tint ?? theme.textSecondary)
    }
}


/// Compact context-window meter. The ring and percentage answer “do I need to
/// compact?” without opening the settings sheet.
private struct ContextUsagePill: View {
    let usage: LatestUsage
    /// Nil when the agent did not report a context window. The meter then
    /// shows used tokens without pretending to know a percentage.
    let window: Double?

    @Environment(\.hapiTheme) private var theme

    private var validWindow: Double? {
        guard let window, window > 0 else { return nil }
        return window
    }

    private var fraction: Double? {
        guard let window = validWindow else { return nil }
        return min(1, max(0, usage.contextSize / window))
    }

    private var percent: Int? {
        guard let fraction else { return nil }
        return Int((fraction * 100).rounded())
    }

    private var tint: Color {
        guard let percent else { return theme.accent }
        if percent >= 95 { return theme.danger }
        if percent >= 80 { return theme.warning }
        return theme.accent
    }

    private var usedText: String { tokenText(usage.contextSize) }
    private var windowText: String { validWindow.map(tokenText) ?? "—" }
    private var remainingText: String {
        guard let window = validWindow else { return "—" }
        return tokenText(max(0, window - usage.contextSize))
    }

    var body: some View {
        Menu {
            if let percent {
                Text("Context \(usedText) / \(windowText)")
                Text("Used \(percent)%")
                Text("Remaining \(remainingText)")
            } else {
                Text("Context used \(usedText)")
                Text("Window unknown")
            }
            if usage.cacheRead > 0 {
                Text("Cache read \(tokenText(usage.cacheRead))")
            }
        } label: {
            HStack(spacing: 3) {
                if let fraction {
                    ZStack {
                        Circle()
                            .stroke(theme.divider, lineWidth: 2)
                        Circle()
                            .trim(from: 0, to: fraction)
                            .stroke(tint, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                    .frame(width: 12, height: 12)
                    Text("\(percent ?? 0)%")
                        .font(.system(size: 9, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(tint)
                } else {
                    Image(systemName: "circle.dotted")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                    Text(usedText)
                        .font(.system(size: 9, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(theme.textSecondary)
                }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(theme.surface, in: Capsule())
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel(Text("Context"))
        .accessibilityValue(Text(verbatim: percent.map { "\($0)%" } ?? usedText))
    }

    private func tokenText(_ value: Double) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", value / 1_000_000)
        }
        if value >= 1_000 {
            return "\(Int((value / 1_000).rounded()))k"
        }
        return String(Int(value.rounded()))
    }
}
