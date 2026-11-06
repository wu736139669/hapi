import ActivityKit
import HapiProtocol
import OSLog
import SwiftUI
import UIKit
import WidgetKit

/// Lock-screen + Dynamic Island surface for one HAPI session.
///
/// The APNs `content-state` is an encrypted envelope; the widget extension
/// decrypts it with the shared per-install push key and renders this view.
/// No plaintext names or counts ever travel through APNs.
struct SessionLiveActivityWidget: Widget {
    private static let log = Logger(subsystem: "run.hapi.companion.widget", category: "live-activity")

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionActivityAttributes.self) { context in
            SessionActivityLockScreen(
                state: Self.decrypt(context.state, sessionId: context.attributes.sessionId),
                isStale: context.isStale
            )
            .widgetURL(SessionLink.url(
                sessionId: context.attributes.sessionId,
                hubUrl: context.attributes.hubUrl
            ))
        } dynamicIsland: { context in
            let state = Self.decrypt(context.state, sessionId: context.attributes.sessionId)
            let color = state?.status.tint ?? .gray
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(alignment: .center, spacing: 6) {
                        Circle()
                            .fill(color)
                            .frame(width: 7, height: 7)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: state?.title ?? "Happy Coding")
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            if let project = state?.project, !project.isEmpty {
                                Text(project)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let state {
                        LiveActivityTimeText(state: state, isStale: context.isStale)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let state {
                        HStack(spacing: 8) {
                            StatusBadge(status: state.status, isStale: context.isStale)
                            if state.hasCounts {
                                ActivityCounts(state: state)
                                    .font(.caption2)
                            }
                            Spacer(minLength: 0)
                        }
                    } else {
                        Text("Open the app to view this session.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: state?.status.symbol ?? "waveform")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(color)
            } compactTrailing: {
                if let state {
                    LiveActivityTimeText(state: state, isStale: context.isStale)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                } else {
                    Image(systemName: "waveform")
                        .font(.caption2)
                }
            } minimal: {
                Image(systemName: state?.status.symbol ?? "waveform")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(color)
            }
        }
    }

    private static func decrypt(
        _ state: EncryptedLiveActivityState,
        sessionId: String
    ) -> LiveActivityContentState? {
        let (key, status) = WidgetKeychain.pushKeyWithStatus()
        guard let key else {
            log.error("push key unavailable for \(sessionId, privacy: .public): \(status, privacy: .public)")
            return nil
        }
        do {
            return try LiveActivityCipher.open(state, key: key)
        } catch {
            log.error("decrypt failed for \(sessionId, privacy: .public): \(error, privacy: .public)")
            return nil
        }
    }
}

private struct SessionActivityLockScreen: View {
    let state: LiveActivityContentState?
    let isStale: Bool

    var body: some View {
        Group {
            if let state {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Circle()
                            .fill(isStale ? Color.secondary : state.status.tint)
                            .frame(width: 7, height: 7)
                        Text(state.title)
                            .font(.headline)
                            .foregroundStyle(Color(uiColor: .label))
                            .lineLimit(1)
                        Spacer(minLength: 6)
                        LiveActivityTimeText(state: state, isStale: isStale)
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 6) {
                        if !state.project.isEmpty {
                            Text(state.project)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        StatusBadge(status: state.status, isStale: isStale)
                    }

                    if state.hasCounts {
                        ActivityCounts(state: state)
                            .font(.caption2)
                    }
                }
                .padding(.horizontal, 2)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: "Happy Coding")
                            .font(.subheadline.weight(.semibold))
                        Text("Open the app to view this session.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Working rows show a live elapsed timer; waiting/active rows show the
/// compact web-style relative time.
private struct LiveActivityTimeText: View {
    let state: LiveActivityContentState
    let isStale: Bool

    var body: some View {
        if isStale {
            Image(systemName: "pause.fill")
                .font(.caption2)
        } else if state.status == .working {
            let start = Date(timeIntervalSince1970: Double(state.startedAt) / 1000)
            Text(timerInterval: min(start, Date())...Date.distantFuture, countsDown: false)
        } else {
            Text(WidgetRelativeTime.text(updatedAt: state.updatedAt))
        }
    }
}

private struct StatusBadge: View {
    let status: LiveActivityContentState.Status
    let isStale: Bool

    var body: some View {
        Label(
            isStale ? String(localized: "Paused") : status.label,
            systemImage: isStale ? "pause.circle" : status.symbol
        )
        .font(.caption2.weight(.semibold))
        .foregroundStyle(isStale ? Color.secondary : status.tint)
        .lineLimit(1)
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

private extension LiveActivityContentState {
    var hasCounts: Bool {
        pendingCount > 0 || todoTotal > 0 || backgroundTaskCount > 0
    }
}

private extension LiveActivityContentState.Status {
    var tint: Color {
        switch self {
        case .working: return .blue
        case .needsApproval: return .orange
        case .needsInput: return .purple
        case .needsAttention: return .red
        case .idle: return .teal
        case .done: return .green
        case .error: return .red
        }
    }

    var symbol: String {
        switch self {
        case .working: return "gearshape.2.fill"
        case .needsApproval: return "hand.raised.fill"
        case .needsInput: return "bubble.left.fill"
        case .needsAttention: return "exclamationmark.bubble.fill"
        case .idle: return "pause.circle.fill"
        case .done: return "checkmark.circle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    var label: String {
        switch self {
        case .working: return String(localized: "Working")
        case .needsApproval: return String(localized: "Needs approval")
        case .needsInput: return String(localized: "Needs input")
        case .needsAttention: return String(localized: "Needs attention")
        case .idle: return String(localized: "Active")
        case .done: return String(localized: "Done")
        case .error: return String(localized: "Error")
        }
    }
}
