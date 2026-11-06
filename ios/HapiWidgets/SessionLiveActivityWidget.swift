import ActivityKit
import HapiProtocol
import SwiftUI
import WidgetKit

/// Lock-screen + Dynamic Island surface for one HAPI session.
///
/// The APNs `content-state` is an encrypted envelope; the widget extension
/// decrypts it with the shared per-install push key and renders this view.
/// No plaintext names or counts ever travel through APNs.
struct SessionLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionActivityAttributes.self) { context in
            SessionActivityLockScreen(
                state: Self.decrypt(context.state),
                isStale: context.isStale
            )
            .widgetURL(SessionLink.url(
                sessionId: context.attributes.sessionId,
                hubUrl: context.attributes.hubUrl
            ))
        } dynamicIsland: { context in
            let state = Self.decrypt(context.state)
            let color = Self.statusColor(state?.status)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(state?.title ?? "HAPI")
                            .font(.headline)
                            .lineLimit(1)
                        if let project = state?.project, !project.isEmpty {
                            Text(project)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let state {
                        ElapsedText(startedAt: state.startedAt)
                            .font(.headline.monospacedDigit())
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    if let status = state?.status {
                        StatusBadge(status: status, isStale: context.isStale)
                    } else {
                        Text("Open HAPI")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let state {
                        ActivityCounts(state: state)
                            .font(.caption2)
                    }
                }
            } compactLeading: {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
            } compactTrailing: {
                if let state {
                    ElapsedText(startedAt: state.startedAt)
                        .font(.caption2.monospacedDigit())
                } else {
                    Image(systemName: "waveform")
                        .font(.caption2)
                }
            } minimal: {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
            }
        }
    }

    private static func decrypt(_ state: EncryptedLiveActivityState) -> LiveActivityContentState? {
        guard let key = WidgetKeychain.pushKey() else { return nil }
        return try? LiveActivityCipher.open(state, key: key)
    }

    private static func statusColor(_ status: LiveActivityContentState.Status?) -> Color {
        switch status {
        case .working: return .blue
        case .needsApproval: return .orange
        case .needsInput: return .purple
        case .needsAttention: return .red
        case .done: return .green
        case .error: return .red
        case nil: return .gray
        }
    }
}

private struct SessionActivityLockScreen: View {
    let state: LiveActivityContentState?
    let isStale: Bool

    var body: some View {
        Group {
            if let state {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle()
                            .fill(color(for: state.status))
                            .frame(width: 9, height: 9)
                        Text(state.title)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        ElapsedText(startedAt: state.startedAt)
                            .font(.headline.monospacedDigit())
                    }

                    HStack(spacing: 8) {
                        if !state.project.isEmpty {
                            Label(state.project, systemImage: "folder")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        StatusBadge(status: state.status, isStale: isStale)
                    }

                    ActivityCounts(state: state)
                        .font(.caption2)
                }
                .padding(.horizontal, 4)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("HAPI")
                        .font(.headline)
                    Text("Open the app to view this session.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func color(for status: LiveActivityContentState.Status) -> Color {
        switch status {
        case .working: return .blue
        case .needsApproval: return .orange
        case .needsInput: return .purple
        case .needsAttention: return .red
        case .done: return .green
        case .error: return .red
        }
    }
}

private struct ElapsedText: View {
    let startedAt: Int

    var body: some View {
        let start = Date(timeIntervalSince1970: Double(startedAt) / 1000)
        Text(timerInterval: min(start, Date())...Date.distantFuture, countsDown: false)
    }
}

private struct StatusBadge: View {
    let status: LiveActivityContentState.Status
    let isStale: Bool

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isStale ? Color.secondary : color)
            .lineLimit(1)
    }

    private var label: String {
        if isStale { return String(localized: "Paused") }
        switch status {
        case .working: return String(localized: "Working")
        case .needsApproval: return String(localized: "Needs approval")
        case .needsInput: return String(localized: "Needs input")
        case .needsAttention: return String(localized: "Needs attention")
        case .done: return String(localized: "Done")
        case .error: return String(localized: "Error")
        }
    }

    private var symbol: String {
        if isStale { return "pause.circle" }
        switch status {
        case .working: return "gearshape.2.fill"
        case .needsApproval: return "hand.raised.fill"
        case .needsInput: return "bubble.left.fill"
        case .needsAttention: return "exclamationmark.bubble.fill"
        case .done: return "checkmark.circle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    private var color: Color {
        switch status {
        case .working: return .blue
        case .needsApproval: return .orange
        case .needsInput: return .purple
        case .needsAttention: return .red
        case .done: return .green
        case .error: return .red
        }
    }
}

private struct ActivityCounts: View {
    let state: LiveActivityContentState

    var body: some View {
        HStack(spacing: 10) {
            if state.pendingCount > 0 {
                Label("\(state.pendingCount)", systemImage: "hand.raised.fill")
                    .foregroundStyle(.orange)
            }
            if state.todoTotal > 0 {
                HStack(spacing: 4) {
                    ProgressView(
                        value: Double(state.todoCompleted),
                        total: Double(max(state.todoTotal, 1))
                    )
                    .frame(width: 48)
                    Text("\(state.todoCompleted)/\(state.todoTotal)")
                        .monospacedDigit()
                }
            }
            if state.backgroundTaskCount > 0 {
                Label("\(state.backgroundTaskCount)", systemImage: "gearshape.2.fill")
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.secondary)
    }
}
