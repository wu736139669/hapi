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
                sessionId: context.attributes.sessionId,
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
            let detailText = Self.detailText(
                for: context.attributes.sessionId,
                status: state?.status
            )
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(alignment: .center, spacing: 7) {
                        Image("HappyCodingIcon")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 22, height: 22)
                            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: state?.title ?? "HappyCoding")
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
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                StatusBadge(status: state.status, isStale: context.isStale)
                                if state.hasCounts {
                                    ActivityCounts(state: state)
                                        .font(.caption2)
                                }
                                Spacer(minLength: 0)
                            }
                            if let detailText {
                                Text(verbatim: detailText)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    } else {
                        Text("Open the app to view this session.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                ZStack(alignment: .bottomTrailing) {
                    Image("HappyCodingIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 18, height: 18)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Circle()
                        .fill(color)
                        .frame(width: 6, height: 6)
                        .overlay(Circle().stroke(.black, lineWidth: 1))
                        .offset(x: 1, y: 1)
                }
            } compactTrailing: {
                if let state {
                    HStack(spacing: 3) {
                        Circle()
                            .fill(color)
                            .frame(width: 5, height: 5)
                        LiveActivityTimeText(state: state, isStale: context.isStale)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Image(systemName: "waveform")
                        .font(.caption2)
                }
            } minimal: {
                Image("HappyCodingIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 16, height: 16)
                    .clipShape(Circle())
            }
        }
    }

    private static func detailText(
        for sessionId: String,
        status: LiveActivityContentState.Status?
    ) -> String? {
        guard let session = WidgetSnapshotStore.load()?.sessions.first(where: { $0.id == sessionId }) else {
            return nil
        }
        let raw = status == .done ? session.lastResult : session.lastMessage
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
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
    let sessionId: String
    let state: LiveActivityContentState?
    let isStale: Bool

    private var snapshotSession: WidgetSnapshot.Session? {
        WidgetSnapshotStore.load()?.sessions.first { $0.id == sessionId }
    }

    private var detailText: String? {
        guard let session = snapshotSession else { return nil }
        let raw = state?.status == .done ? session.lastResult : session.lastMessage
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var body: some View {
        Group {
            if let state {
                HStack(alignment: .center, spacing: 12) {
                    Image("HappyCodingIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 4) {
                        Text(state.title)
                            .font(.headline)
                            .foregroundStyle(Color(uiColor: .label))
                            .lineLimit(1)
                        if !state.project.isEmpty {
                            Text(state.project)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if let detailText {
                            Text(verbatim: detailText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if state.hasCounts {
                            ActivityCounts(state: state)
                                .font(.caption2)
                        }
                    }

                    Spacer(minLength: 12)

                    VStack(alignment: .trailing, spacing: 8) {
                        LiveActivityTimeText(state: state, isStale: isStale)
                            .font(.caption.monospacedDigit().weight(.medium))
                            .foregroundStyle(.secondary)
                        LiveStatusChip(status: state.status, isStale: isStale)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 8) {
                    Image("HappyCodingIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: "HappyCoding")
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

/// Small colored status capsule shared by the lock-screen card and the
/// Dynamic Island bottom region. A spinner replaces the old gear glyph for
/// working sessions; the label remains explicit.
private struct LiveStatusChip: View {
    let status: LiveActivityContentState.Status
    let isStale: Bool

    private var label: String {
        isStale ? String(localized: "Paused") : status.label
    }

    private var tint: Color {
        isStale ? .secondary : status.tint
    }

    var body: some View {
        HStack(spacing: 4) {
            if isStale {
                Image(systemName: "pause.fill")
            } else if status == .working {
                ProgressView()
                    .controlSize(.mini)
                    .tint(tint)
                    .frame(width: 10, height: 10)
                    .fixedSize()
            } else {
                Image(systemName: status.symbol)
            }
            Text(label)
                .lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(tint)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(tint.opacity(0.13), in: Capsule())
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
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .frame(width: 56, alignment: .trailing)
        } else {
            Text(WidgetRelativeTime.text(updatedAt: state.updatedAt))
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .frame(width: 56, alignment: .trailing)
        }
    }
}

private struct StatusBadge: View {
    let status: LiveActivityContentState.Status
    let isStale: Bool

    var body: some View {
        LiveStatusChip(status: status, isStale: isStale)
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
