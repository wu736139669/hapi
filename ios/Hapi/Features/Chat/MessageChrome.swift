import HapiProtocol
import HapiUI
import SwiftUI
import UIKit

/// Timestamp formatting for transcript chrome. The web uses a compact
/// same-day clock and a date prefix for older messages; keep the same
/// information density without copying its typography.
enum ChatTimeLabel {
    static func text(for epochMs: Int, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: Double(epochMs) / 1000)
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
        }
        return date.formatted(.dateTime.year().month(.abbreviated).day().hour().minute())
    }
}

/// Shared live-state wording for the nav header and composer strip.
enum ChatSessionStatus {
    static func label(
        active: Bool,
        thinking: Bool,
        reconnecting: Bool
    ) -> (label: String, color: Color) {
        if reconnecting {
            return (String(localized: "Reconnecting"), .orange)
        }
        if !active {
            return (String(localized: "Inactive"), .secondary)
        }
        if thinking {
            return (String(localized: "Vibing"), .blue)
        }
        return (String(localized: "Online"), .green)
    }
}

/// Shared duration wording for assistant metadata and tool timing.
enum ChatDurationLabel {
    static func text(ms: Int) -> String? {
        guard ms > 0 else { return nil }
        let seconds = Double(ms) / 1000
        if seconds < 60 {
            return String(format: "%.1fs", seconds)
        }
        let total = Int(seconds.rounded())
        return "\(total / 60)m \(total % 60)s"
    }
}

/// Compact timing for a tool summary: completed duration, or the start clock
/// while running. Kept in the existing trailing area so card height does not
/// grow.
enum ChatToolTiming {
    static func text(for block: ToolCallBlock) -> String? {
        let start = block.tool.startedAt ?? block.tool.execStartedAt
        if let start, let end = block.tool.completedAt ?? block.tool.execCompletedAt {
            return ChatDurationLabel.text(ms: max(0, end - start))
        }
        if block.tool.state == .running, let start {
            return String(localized: "Started \(ChatTimeLabel.text(for: start))")
        }
        if let duration = block.durationMs {
            return ChatDurationLabel.text(ms: duration)
        }
        return nil
    }
}

/// Data already carried by the chat blocks but previously not shown. Keep the
/// adapter here so transcript rows stay presentation-only.
struct ChatMessageMeta: Equatable {
    var durationMs: Int?
    var model: String?
    var inputTokens: Double?
    var outputTokens: Double?

    init(
        durationMs: Int? = nil,
        model: String? = nil,
        usage: UsageData? = nil
    ) {
        self.durationMs = durationMs
        self.model = model
        self.inputTokens = usage?.inputTokens
        self.outputTokens = usage?.outputTokens
    }

    var hasDetails: Bool {
        durationMs != nil || model != nil || inputTokens != nil || outputTokens != nil
    }

    var durationLabel: String? {
        guard let durationMs else { return nil }
        return ChatDurationLabel.text(ms: durationMs)
    }

    var tokenLabel: String? {
        guard inputTokens != nil || outputTokens != nil else { return nil }
        let input = Int(inputTokens ?? 0)
        let output = Int(outputTokens ?? 0)
        return "\(input) / \(output)"
    }
}

/// Compact footer under a message: time, copy, and (for assistant prose)
/// duration/model/token details. Kept visually quiet so the transcript remains
/// the primary surface.
struct ChatMessageActionRow: View {
    enum Alignment {
        case leading
        case trailing
    }

    let timestamp: Int?
    let copyText: String?
    let metadata: ChatMessageMeta?
    var alignment: Alignment = .leading

    @Environment(\.hapiTheme) private var theme
    @Environment(\.hapiTypography) private var typography
    @State private var copied = false

    var body: some View {
        HStack(spacing: 8) {
            if alignment == .trailing {
                Spacer(minLength: 0)
            }
            if let timestamp, timestamp > 0 {
                Text(ChatTimeLabel.text(for: timestamp))
                    .monospacedDigit()
            }
            if let copyText, !copyText.isEmpty {
                Button {
                    UIPasteboard.general.string = copyText
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        copied = false
                    }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copied ? Text("Copied") : Text("Copy"))
            }
            if let metadata, metadata.hasDetails {
                Menu {
                    if let duration = metadata.durationLabel {
                        Text("Duration \(duration)")
                    }
                    if let model = metadata.model {
                        Text("Model \(model)")
                    }
                    if let tokens = metadata.tokenLabel {
                        Text("Tokens \(tokens)")
                    }
                } label: {
                    Image(systemName: "info.circle")
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .menuStyle(.borderlessButton)
                .accessibilityLabel("Info")
            }
            if alignment == .leading {
                Spacer(minLength: 0)
            }
        }
        .font(typography.captionFont)
        .foregroundStyle(theme.textSecondary)
        .padding(.top, 2)
    }
}
