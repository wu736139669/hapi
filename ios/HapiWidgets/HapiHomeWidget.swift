import HapiProtocol
import SwiftUI
import UIKit
import WidgetKit

/// Home-screen and lock-screen status widgets. Same data contract as the
/// Live Activity, but snapshot-driven: the app writes the App Group file and
/// reloads timelines; the widget never holds credentials or talks to the hub.
struct HapiHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: WidgetSnapshotStore.widgetKind,
            provider: HapiWidgetProvider()
        ) { entry in
            HapiWidgetView(entry: entry)
        }
        .configurationDisplayName("HAPI")
        .description("Running sessions and requests that need you.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .systemLarge,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline
        ])
    }
}

struct HapiWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct HapiWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> HapiWidgetEntry {
        HapiWidgetEntry(date: Date(), snapshot: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (HapiWidgetEntry) -> Void) {
        completion(HapiWidgetEntry(date: Date(), snapshot: WidgetSnapshotStore.load() ?? .empty))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HapiWidgetEntry>) -> Void) {
        let now = Date()
        let entry = HapiWidgetEntry(date: now, snapshot: WidgetSnapshotStore.load() ?? .empty)
        // Pushes reload the timeline immediately; this is only the fallback.
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(15 * 60))))
    }
}

private struct HapiWidgetView: View {
    let entry: HapiWidgetEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(topSessionURL)
            .containerBackground(for: .widget) {
                if isAccessory {
                    AccessoryWidgetBackground()
                } else {
                    HapiWidgetBackground()
                }
            }
    }

    /// Accessories have no room for row-level links; open the most relevant
    /// session when the whole widget is tapped. Medium/large rows override
    /// this with their own `Link`.
    private var topSessionURL: URL? {
        guard let top = entry.snapshot.sessions.first else { return nil }
        return SessionLink.url(
            sessionId: top.id,
            hubUrl: entry.snapshot.hubUrl.isEmpty ? nil : entry.snapshot.hubUrl
        )
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .systemSmall:
            SmallWidget(snapshot: entry.snapshot)
        case .systemMedium:
            MediumWidget(snapshot: entry.snapshot)
        case .systemLarge:
            LargeWidget(snapshot: entry.snapshot)
        case .accessoryCircular:
            CircularAccessory(snapshot: entry.snapshot)
        case .accessoryRectangular:
            RectangularAccessory(snapshot: entry.snapshot)
        case .accessoryInline:
            InlineAccessory(snapshot: entry.snapshot)
        default:
            MediumWidget(snapshot: entry.snapshot)
        }
    }

    private var isAccessory: Bool {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: return true
        default: return false
        }
    }
}

private struct HapiWidgetBackground: View {
    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
            LinearGradient(
                colors: [
                    Color.blue.opacity(0.10),
                    Color.purple.opacity(0.05),
                    .clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

// MARK: - Home screen

private struct SmallWidget: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            WidgetHeader(snapshot: snapshot)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(snapshot.runningCount)")
                    .font(.system(size: 38, weight: .light, design: .rounded))
                    .monospacedDigit()
                Text("Working")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 5) {
                if snapshot.needsApprovalCount > 0 {
                    CountLine(color: .orange, image: "hand.raised.fill", count: snapshot.needsApprovalCount, label: "Needs approval")
                }
                if snapshot.needsInputCount > 0 {
                    CountLine(color: .purple, image: "bubble.left.fill", count: snapshot.needsInputCount, label: "Needs input")
                }
                if snapshot.needsApprovalCount == 0 && snapshot.needsInputCount == 0 {
                    if let top = snapshot.sessions.first {
                        CountLine(color: top.status.color, image: top.status.symbol, count: nil, label: top.title)
                    } else {
                        Text("No running sessions")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct MediumWidget: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(snapshot: snapshot)
                .padding(.bottom, 7)
            if snapshot.sessions.isEmpty {
                EmptyWidgetState()
            } else {
                ForEach(snapshot.sessions.prefix(3)) { session in
                    SessionRow(session: session, hubUrl: snapshot.hubUrl, compact: true)
                }
            }
            Spacer(minLength: 0)
            FooterLine(snapshot: snapshot)
        }
    }
}

private struct LargeWidget: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(snapshot: snapshot)
                .padding(.bottom, 7)
            if snapshot.sessions.isEmpty {
                EmptyWidgetState()
            } else {
                ForEach(snapshot.sessions.prefix(7)) { session in
                    SessionRow(session: session, hubUrl: snapshot.hubUrl, compact: false)
                }
            }
            Spacer(minLength: 0)
            FooterLine(snapshot: snapshot)
        }
    }
}

// MARK: - Accessories

private struct CircularAccessory: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        ZStack {
            Circle()
                .stroke(.tertiary, lineWidth: 5)
            Circle()
                .trim(from: 0, to: ringProgress)
                .stroke(.primary, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text("\(snapshot.runningCount)")
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                Text("working")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var ringProgress: CGFloat {
        guard snapshot.runningCount > 0 else { return 0 }
        return min(1, CGFloat(snapshot.runningCount) / 5)
    }
}

private struct RectangularAccessory: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: "waveform")
                    .font(.caption2)
                Text("HAPI")
                    .font(.caption2.weight(.bold))
                Spacer(minLength: 0)
                if snapshot.needsApprovalCount > 0 {
                    Image(systemName: "hand.raised.fill")
                        .font(.caption2)
                    Text("\(snapshot.needsApprovalCount)")
                        .font(.caption2.weight(.bold))
                }
            }
            if let top = snapshot.sessions.first {
                Text(top.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(top.status.accessoryLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text("No running sessions")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct InlineAccessory: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        Label {
            Text("HAPI · \(snapshot.runningCount) working · \(snapshot.needsApprovalCount) approvals")
        } icon: {
            Image(systemName: "waveform")
        }
    }
}

// MARK: - Shared pieces

private struct WidgetHeader: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        HStack(spacing: 5) {
            HapiMark()
                .frame(width: 15, height: 15)
            Text("HAPI")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if snapshot.needsApprovalCount > 0 || snapshot.needsInputCount > 0 {
                Circle()
                    .fill(.orange)
                    .frame(width: 6, height: 6)
            }
        }
    }
}

private struct HapiMark: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 4.5, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [Color.blue, Color.purple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                Image(systemName: "waveform")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.white)
            }
    }
}

private struct SessionRow: View {
    let session: WidgetSnapshot.Session
    let hubUrl: String
    let compact: Bool

    var body: some View {
        if let url = SessionLink.url(sessionId: session.id, hubUrl: hubUrl.isEmpty ? nil : hubUrl) {
            Link(destination: url) { row }
        } else {
            row
        }
    }

    private var row: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(session.status.color)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(session.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                if compact {
                    Text(session.project.isEmpty ? session.status.shortLabel : session.project)
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            trailing
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var trailing: some View {
        switch session.status {
        case .working:
            if let startedAt = session.startedAt {
                ElapsedText(startedAt: startedAt)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                StatusBadge(status: session.status)
            }
        case .done:
            Text(Date(timeIntervalSince1970: Double(session.updatedAt) / 1000), style: .relative)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        default:
            StatusBadge(status: session.status)
        }
    }
}

private struct StatusBadge: View {
    let status: LiveActivityContentState.Status

    var body: some View {
        Label(status.shortLabel, systemImage: status.symbol)
            .font(.system(size: 8, weight: .semibold))
            .labelStyle(.titleAndIcon)
            .foregroundStyle(status.color)
            .lineLimit(1)
    }
}

private struct CountLine: View {
    let color: Color
    let image: String
    let count: Int?
    let label: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: image)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 11)
            if let count {
                Text("\(count)")
                    .font(.system(size: 10, weight: .bold))
                    .monospacedDigit()
            }
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

private struct FooterLine: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        HStack(spacing: 8) {
            let background = snapshot.sessions.reduce(0) { $0 + $1.backgroundTaskCount }
            if background > 0 {
                Label("\(background)", systemImage: "gearshape.2.fill")
            }
            if let top = snapshot.sessions.first(where: { $0.todoTotal > 0 }) {
                ProgressView(
                    value: Double(top.todoCompleted),
                    total: Double(max(top.todoTotal, 1))
                )
                .frame(width: 42)
                Text("\(top.todoCompleted)/\(top.todoTotal)")
                    .monospacedDigit()
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        .padding(.top, 5)
    }
}

private struct EmptyWidgetState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("No running sessions")
                .font(.caption.weight(.semibold))
            Text("Open HAPI to start one.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct ElapsedText: View {
    let startedAt: Int

    var body: some View {
        let start = Date(timeIntervalSince1970: Double(startedAt) / 1000)
        Text(timerInterval: min(start, Date())...Date.distantFuture, countsDown: false)
    }
}

private extension LiveActivityContentState.Status {
    var color: Color {
        switch self {
        case .working: return .blue
        case .needsApproval: return .orange
        case .needsInput: return .purple
        case .needsAttention: return .red
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
        case .done: return "checkmark.circle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    var shortLabel: String {
        switch self {
        case .working: return String(localized: "Working")
        case .needsApproval: return String(localized: "Needs approval")
        case .needsInput: return String(localized: "Needs input")
        case .needsAttention: return String(localized: "Needs attention")
        case .done: return String(localized: "Done")
        case .error: return String(localized: "Error")
        }
    }

    var accessoryLabel: String {
        switch self {
        case .working: return String(localized: "Working")
        case .needsApproval: return String(localized: "Needs approval")
        case .needsInput: return String(localized: "Needs input")
        case .needsAttention: return String(localized: "Needs attention")
        case .done: return String(localized: "Done")
        case .error: return String(localized: "Error")
        }
    }
}
