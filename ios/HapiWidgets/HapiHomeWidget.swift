import AppIntents
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
        .configurationDisplayName("HappyCoding")
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
        let snapshot = WidgetSnapshotStore.load() ?? .empty
        // WidgetKit widgets are snapshots, not live streams. The app and the
        // NSE reload immediately on changes; this five-minute fallback
        // catches reloads the system throttled. Running elapsed text ticks
        // live via the dynamic timer; status only changes on a reload.
        let entry = HapiWidgetEntry(date: now, snapshot: snapshot)
        // WidgetKit budgets timeline reloads. The app/silent-push path does the
        // real refresh; five minutes is the normal fallback and keeps a stale
        // snapshot from surviving a longer gap.
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(5 * 60))))
    }
}

private struct HapiWidgetView: View {
    let entry: HapiWidgetEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
            MediumWidget(snapshot: entry.snapshot, now: entry.date)
        case .systemLarge:
            LargeWidget(snapshot: entry.snapshot, now: entry.date)
        case .accessoryCircular:
            CircularAccessory(snapshot: entry.snapshot)
        case .accessoryRectangular:
            RectangularAccessory(snapshot: entry.snapshot)
        case .accessoryInline:
            InlineAccessory(snapshot: entry.snapshot)
        default:
            MediumWidget(snapshot: entry.snapshot, now: entry.date)
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
        VStack(alignment: .leading, spacing: 5) {
            WidgetHeader(snapshot: snapshot)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(snapshot.runningCount)")
                    .font(.system(size: 34, weight: .light, design: .rounded))
                    .monospacedDigit()
                Text("Working")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 5) {
                if snapshot.needsApprovalCount > 0 {
                    CountLine(color: .orange, image: "hand.raised.fill", count: snapshot.needsApprovalCount, label: "Needs approval")
                }
                if snapshot.needsInputCount > 0 {
                    CountLine(color: .purple, image: "bubble.left.fill", count: snapshot.needsInputCount, label: "Needs input")
                }
                if snapshot.idleCount > 0 {
                    CountLine(color: .teal, image: "pause.circle.fill", count: snapshot.idleCount, label: "Active")
                }
                if snapshot.needsApprovalCount == 0 && snapshot.needsInputCount == 0 && snapshot.idleCount == 0 {
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
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(snapshot: snapshot)
                .padding(.bottom, 4)
            if snapshot.sessions.isEmpty {
                EmptyWidgetState()
            } else {
                ForEach(snapshot.sessions.prefix(3)) { session in
                    SessionRow(session: session, hubUrl: snapshot.hubUrl, style: .compact, now: now)
                }
            }
            Spacer(minLength: 0)
            FooterLine(snapshot: snapshot)
        }
    }
}

private struct LargeWidget: View {
    let snapshot: WidgetSnapshot
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(snapshot: snapshot)
                .padding(.bottom, 3)
            if running.isEmpty && active.isEmpty {
                EmptyWidgetState()
            } else {
                sections(maxRows: 9)
            }
            Spacer(minLength: 0)
            if hasFooter {
                FooterLine(snapshot: snapshot)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var running: [WidgetSnapshot.Session] {
        snapshot.sessions.filter { $0.status == .working }
    }

    /// Active but not currently thinking: idle between turns, or waiting for
    /// a human. Mirrors the web “活跃会话” group.
    private var active: [WidgetSnapshot.Session] {
        snapshot.sessions.filter {
            switch $0.status {
            case .needsApproval, .needsInput, .needsAttention, .idle:
                return true
            case .working, .done, .error:
                return false
            }
        }
    }

    private var activeCount: Int {
        snapshot.idleCount
            + snapshot.needsApprovalCount
            + snapshot.needsInputCount
            + snapshot.needsAttentionCount
    }

    private var hasFooter: Bool {
        snapshot.sessions.contains { $0.backgroundTaskCount > 0 || $0.todoTotal > 0 }
    }

    private func sections(maxRows: Int) -> some View {
        let runningRows = Array(running.prefix(maxRows))
        let activeRows = Array(active.prefix(max(0, maxRows - runningRows.count)))
        return VStack(alignment: .leading, spacing: 0) {
            if !runningRows.isEmpty {
                SectionHeader(
                    title: "Working",
                    count: snapshot.runningCount,
                    color: .blue,
                    hidden: max(0, running.count - runningRows.count)
                )
                ForEach(runningRows) { session in
                    SessionRow(session: session, hubUrl: snapshot.hubUrl, style: .dense, now: now)
                }
            }
            if !activeRows.isEmpty {
                SectionHeader(
                    title: "Active",
                    count: activeCount,
                    color: .teal,
                    hidden: max(0, active.count - activeRows.count)
                )
                    .padding(.top, runningRows.isEmpty ? 0 : 2)
                ForEach(activeRows) { session in
                    SessionRow(session: session, hubUrl: snapshot.hubUrl, style: .dense, now: now)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SectionHeader: View {
    let title: LocalizedStringKey
    let count: Int
    let color: Color
    var hidden: Int = 0

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)
            Text(title)
                .font(.system(size: 9.5, weight: .bold))
            Text("(\(count))")
                .font(.system(size: 9.5, weight: .medium))
                .monospacedDigit()
            if hidden > 0 {
                Text(verbatim: "+\(hidden)")
                    .font(.system(size: 8.5, weight: .medium))
                    .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.secondary)
        .padding(.top, 4)
        .padding(.bottom, 1)
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
                Text(verbatim: "HappyCoding")
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
            Text(verbatim: "HappyCoding · \(snapshot.runningCount) working · \(snapshot.needsApprovalCount) approvals")
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
            Image("HappyCodingIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            Text(verbatim: "HappyCoding")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if snapshot.needsApprovalCount > 0 || snapshot.needsInputCount > 0 {
                Circle()
                    .fill(.orange)
                    .frame(width: 7, height: 7)
            }
            WidgetRefreshButton()
        }
    }
}

private struct SessionRow: View {
    enum Style {
        case compact
        case dense
    }

    enum SubtitleMode {
        case projectAndMessage
        case task
        case result
    }

    let session: WidgetSnapshot.Session
    let hubUrl: String
    let style: Style
    let now: Date
    var subtitleMode: SubtitleMode = .projectAndMessage

    var body: some View {
        if let url = SessionLink.url(sessionId: session.id, hubUrl: hubUrl.isEmpty ? nil : hubUrl) {
            // A Link label is shrink-wrapped by WidgetKit, which kept the
            // trailing status/time from reaching the right edge. Render the
            // full-width row and put a clear link on top instead.
            row
                .overlay {
                    Link(destination: url) {
                        Color.clear
                            .contentShape(Rectangle())
                    }
                }
        } else {
            row
        }
    }

    private var row: some View {
        HStack(alignment: .center, spacing: 6) {
            SessionRowLeading(
                status: session.status,
                flavor: session.flavor,
                size: style == .dense ? 15 : 14
            )
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    if session.isUnread == true {
                        Circle()
                            .fill(.blue)
                            .frame(width: 5, height: 5)
                            .accessibilityHidden(true)
                    }
                    Text(session.title)
                        .font(.system(size: style == .dense ? 12 : 11.5, weight: .semibold))
                        .foregroundStyle(Color(uiColor: .label))
                        .lineLimit(1)
                }
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 9))
                        .foregroundStyle(Color(uiColor: .secondaryLabel))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, style == .dense ? 2.5 : 3)
        .contentShape(Rectangle())
    }

    /// Project and the last human prompt on one line, so the large widget
    /// can show roughly twice as many sessions as the old three-line row.
    private var subtitle: String {
        if subtitleMode == .task {
            if let task = session.lastMessage, !task.isEmpty { return task }
            return session.project.isEmpty ? session.status.shortLabel : session.project
        }
        if subtitleMode == .result {
            if let result = session.lastResult, !result.isEmpty { return result }
            if let message = session.lastMessage, !message.isEmpty { return message }
            return session.project.isEmpty ? session.status.shortLabel : session.project
        }
        switch style {
        case .compact:
            return session.project.isEmpty ? session.status.shortLabel : session.project
        case .dense:
            var parts: [String] = []
            if !session.project.isEmpty { parts.append(session.project) }
            if let message = session.lastMessage, !message.isEmpty { parts.append(message) }
            return parts.isEmpty ? session.status.shortLabel : parts.joined(separator: " · ")
        }
    }

    /// Status and time are both pinned to the trailing edge so every row
    /// scans the same way. The leading brand icon carries the status color;
    /// actionable states also show a text label.
    private var trailing: some View {
        HStack(spacing: 4) {
            // The section already says Working/Active, so the old status
            // icon repeated it; only actionable states keep a text label.
            if showsStatusText {
                Text(session.status.shortLabel)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(session.status.color)
                    .lineLimit(1)
            }
            if session.status == .working, let startedAt = session.startedAt {
                // Slot width and glyph alignment live inside ElapsedText:
                // WidgetKit draws dynamic text at the slot's leading edge
                // unless the text itself is trailing-aligned.
                ElapsedText(startedAt: startedAt, size: style == .dense ? 10 : 9.5)
                    .foregroundStyle(unreadTimeColor)
            } else {
                RelativeTimeText(updatedAt: session.updatedAt, now: now)
                    .font(.system(size: style == .dense ? 9.5 : 9, weight: .medium))
                    .foregroundStyle(unreadTimeColor)
            }
        }
        .layoutPriority(1)
    }

    private var unreadTimeColor: Color {
        session.isUnread == true ? .blue : Color(uiColor: .secondaryLabel)
    }

    private var showsStatusText: Bool {
        switch session.status {
        case .needsApproval, .needsInput, .needsAttention, .done, .error:
            return true
        case .working, .idle:
            return false
        }
    }
}

/// Agent brand icon with the session status as a corner dot. Flavors without a
/// bundled logo keep the plain status dot so the row still scans by color.
private struct SessionRowLeading: View {
    let status: LiveActivityContentState.Status
    let flavor: String?
    let size: CGFloat

    var body: some View {
        Group {
            if AgentFlavorIconView.assetName(forFlavor: flavor) != nil {
                ZStack(alignment: .bottomTrailing) {
                    AgentFlavorIconView(flavor: flavor, size: size)
                    Circle()
                        .fill(status.color)
                        .frame(width: 7, height: 7)
                        .overlay {
                            Circle().stroke(Color(uiColor: .systemBackground), lineWidth: 1.2)
                        }
                        .offset(x: 1.5, y: 1.5)
                }
            } else {
                Circle()
                    .fill(status.color)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(width: size, height: size)
    }
}

/// Compact relative time matching the web list: “刚刚”, “13分钟前”,
/// “1小时前”. Shared by the home widget and Live Activity surfaces.
enum WidgetRelativeTime {
    static func text(updatedAt: Int, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: Double(updatedAt) / 1000)
        guard now.timeIntervalSince(date) >= 60 else {
            return String(localized: "Just now")
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        formatter.dateTimeStyle = .named
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

private struct RelativeTimeText: View {
    let updatedAt: Int
    let now: Date

    var body: some View {
        Text(WidgetRelativeTime.text(updatedAt: updatedAt, now: now))
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
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 13)
            if let count {
                Text("\(count)")
                    .font(.system(size: 11, weight: .bold))
                    .monospacedDigit()
            }
            Text(label)
                .font(.system(size: 10))
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
        .padding(.top, 3)
    }
}

private struct EmptyWidgetState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("No running sessions")
                .font(.system(size: 10, weight: .semibold))
            Text("Open HAPI to start one.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// Live second-level elapsed label.
///
/// WidgetKit expands dynamic text to the proposed width but draws its line at
/// the text view's leading edge; `multilineTextAlignment` is what actually
/// pins the glyphs inside the slot. The fixed frame also keeps the dynamic
/// text renderable (without one the widget came back blank).
private struct ElapsedText: View {
    let startedAt: Int
    let size: CGFloat

    var body: some View {
        let start = Date(timeIntervalSince1970: Double(startedAt) / 1000)
        Text(min(start, Date()), style: .timer)
            .font(.system(size: size, weight: .medium).monospacedDigit())
            .multilineTextAlignment(.trailing)
            .frame(width: 52, alignment: .trailing)
    }
}

private extension LiveActivityContentState.Status {
    var color: Color {
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

    var shortLabel: String {
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

    var accessoryLabel: String {
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

// MARK: - Focused modes

/// Running-only component: the subtitle is the task you gave the agent.
struct HapiRunningWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshotStore.runningWidgetKind, provider: HapiWidgetProvider()) { entry in
            HapiModeWidgetView(entry: entry, mode: .running)
        }
        .configurationDisplayName("Running")
        .description("Running sessions and the task you gave them.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

/// Review component: unread results, with the last assistant output.
struct HapiReviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshotStore.reviewWidgetKind, provider: HapiWidgetProvider()) { entry in
            HapiModeWidgetView(entry: entry, mode: .review)
        }
        .configurationDisplayName("Review")
        .description("Unread results waiting for your review.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct HapiModeWidgetView: View {
    enum Mode {
        case running
        case review
    }

    let entry: HapiWidgetEntry
    let mode: Mode

    @Environment(\.widgetFamily) private var family

    private var rows: [WidgetSnapshot.Session] {
        switch mode {
        case .running:
            return entry.snapshot.sessions.filter { $0.status == .working }
        case .review:
            return entry.snapshot.sessions.filter { $0.isUnread == true && $0.status != .working }
        }
    }

    private var subtitleMode: SessionRow.SubtitleMode {
        mode == .running ? .task : .result
    }

    private var topURL: URL? {
        guard let top = rows.first else { return nil }
        return SessionLink.url(
            sessionId: top.id,
            hubUrl: entry.snapshot.hubUrl.isEmpty ? nil : entry.snapshot.hubUrl
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(snapshot: entry.snapshot)
            modeHeader
            if rows.isEmpty {
                if mode == .running {
                    Text("No running sessions")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                } else {
                    Text("No unread results")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                }
            } else {
                ForEach(rows.prefix(family == .systemLarge ? 9 : 3)) { session in
                    SessionRow(
                        session: session,
                        hubUrl: entry.snapshot.hubUrl,
                        style: .dense,
                        now: entry.date,
                        subtitleMode: subtitleMode
                    )
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(topURL)
        .containerBackground(for: .widget) {
            HapiWidgetBackground()
        }
    }

    private var modeTitle: LocalizedStringKey {
        switch mode {
        case .running: return "Working"
        case .review: return "Review"
        }
    }

    private var modeHeader: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(mode == .running ? Color.blue : Color.teal)
                .frame(width: 6, height: 6)
            Text(modeTitle)
                .font(.system(size: 9.5, weight: .bold))
            Text("(\(rows.count))")
                .font(.system(size: 9.5, weight: .medium))
                .monospacedDigit()
            Spacer(minLength: 0)
        }
        .foregroundStyle(.secondary)
        .padding(.top, 5)
        .padding(.bottom, 1)
    }
}

/// One-session detail card: the task, the latest assistant result and progress.
struct HapiFocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshotStore.focusWidgetKind, provider: HapiWidgetProvider()) { entry in
            HapiFocusWidgetView(entry: entry)
        }
        .configurationDisplayName("Session Detail")
        .description("Task and latest result for one session.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

/// In-card prev/next switcher. Writes the shared selection and asks WidgetKit
/// to redraw; widgets cannot scroll or page natively, so this exposes every
/// session in the snapshot without per-widget configuration.
struct HapiFocusSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Show session"

    @Parameter(title: "Session")
    var sessionId: String

    init() {}

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    func perform() async throws -> some IntentResult {
        FocusSelectionStore.setSelectedSessionId(sessionId)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshotStore.focusWidgetKind)
        return .result()
    }
}

/// Manual timeline reload for the small refresh control. Unlike background
/// reloads this is user-initiated, so WidgetKit generally honors it even when
/// the automatic budget is exhausted; it redraws the current App Group
/// snapshot (opening the app is still what fetches new hub data).
struct HapiRefreshWidgetIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh"

    func perform() async throws -> some IntentResult {
        WidgetRefreshFeedback.mark()
        for kind in WidgetSnapshotStore.homeWidgetKinds {
            WidgetCenter.shared.reloadTimelines(ofKind: kind)
        }
        return .result()
    }
}

private struct WidgetRefreshButton: View {
    private var recentRefresh: Date? {
        guard let last = WidgetRefreshFeedback.last(),
              Date().timeIntervalSince(last) < 600 else { return nil }
        return last
    }

    var body: some View {
        Button(intent: HapiRefreshWidgetIntent()) {
            HStack(spacing: 2) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 9.5, weight: .semibold))
                if let recentRefresh {
                    Text(recentRefresh, style: .time)
                        .font(.system(size: 8, weight: .medium))
                        .monospacedDigit()
                }
            }
            .frame(minWidth: 20, minHeight: 20)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Refresh")
    }
}

private struct HapiFocusWidgetView: View {
    let entry: HapiWidgetEntry

    @Environment(\.widgetFamily) private var family

    private var session: WidgetSnapshot.Session? {
        if let selected = FocusSelectionStore.selectedSessionId(),
           let match = entry.snapshot.sessions.first(where: { $0.id == selected }) {
            return match
        }
        return entry.snapshot.sessions.first { $0.isUnread == true && $0.status != .working }
            ?? entry.snapshot.sessions.first { $0.status == .working }
            ?? entry.snapshot.sessions.first { $0.isUnread == true }
            ?? entry.snapshot.sessions.first
    }

    var body: some View {
        Group {
            if let session {
                Group {
                    if family == .systemMedium {
                        mediumContent(session)
                    } else {
                        content(session)
                    }
                }
                .widgetURL(SessionLink.url(
                    sessionId: session.id,
                    hubUrl: entry.snapshot.hubUrl.isEmpty ? nil : entry.snapshot.hubUrl
                ))
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    WidgetHeader(snapshot: entry.snapshot)
                    Text("No running sessions")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
        }
        .containerBackground(for: .widget) {
            HapiWidgetBackground()
        }
    }

    private func content(_ session: WidgetSnapshot.Session) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(snapshot: entry.snapshot)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Circle()
                    .fill(session.status.color)
                    .frame(width: 7, height: 7)
                Text(session.title)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color(uiColor: .label))
                    .lineLimit(1)
                Spacer(minLength: 6)
                Text(verbatim: session.status.shortLabel)
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(session.status.color)
                if session.status == .working, let startedAt = session.startedAt {
                    ElapsedText(startedAt: startedAt, size: 12)
                        .foregroundStyle(.secondary)
                } else {
                    RelativeTimeText(updatedAt: session.updatedAt, now: entry.date)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 5)

            HStack(spacing: 6) {
                Text(session.project)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                focusSwitcher(for: session)
            }

            detailSection(
                title: "Task",
                text: session.lastMessage,
                placeholder: "No task yet"
            )

            detailSection(
                title: "Latest result",
                text: session.lastResult,
                placeholder: "No result yet",
                highlighted: true
            )

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                if session.pendingCount > 0 {
                    Label("\(session.pendingCount)", systemImage: "hand.raised.fill")
                        .foregroundStyle(.orange)
                }
                if session.todoTotal > 0 {
                    ProgressView(
                        value: Double(session.todoCompleted),
                        total: Double(max(session.todoTotal, 1))
                    )
                    .frame(width: 64)
                    Text("\(session.todoCompleted)/\(session.todoTotal)")
                        .monospacedDigit()
                }
                Spacer(minLength: 0)
                Text("Open chat")
                    .foregroundStyle(.blue)
                    .fontWeight(.semibold)
            }
            .font(.system(size: 9.5))
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func mediumContent(_ session: WidgetSnapshot.Session) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image("HappyCodingIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 16, height: 16)
                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                Text(session.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color(uiColor: .label))
                    .lineLimit(1)
                Spacer(minLength: 6)
                Text(verbatim: session.status.shortLabel)
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(session.status.color)
                if session.status == .working, let startedAt = session.startedAt {
                    ElapsedText(startedAt: startedAt, size: 10)
                        .foregroundStyle(.secondary)
                } else {
                    RelativeTimeText(updatedAt: session.updatedAt, now: entry.date)
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 1)

            HStack(spacing: 6) {
                mediumMetaLine(session)
                Spacer(minLength: 6)
                focusSwitcher(for: session)
                WidgetRefreshButton()
            }
            .padding(.top, 1)

            mediumResult(session)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func mediumMetaLine(_ session: WidgetSnapshot.Session) -> some View {
        let task = session.lastMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !session.project.isEmpty || !task.isEmpty {
            Group {
                if session.project.isEmpty {
                    Text(verbatim: task)
                } else if task.isEmpty {
                    Text(verbatim: session.project)
                        .fontWeight(.semibold)
                } else {
                    Text(verbatim: session.project)
                        .fontWeight(.semibold)
                    + Text(verbatim: " · ")
                    + Text(verbatim: task)
                }
            }
            .font(.system(size: 9.5))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
    }

    @ViewBuilder
    private func mediumResult(_ session: WidgetSnapshot.Session) -> some View {
        let value = session.lastResult?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        (value.isEmpty ? Text("No result yet") : Text(verbatim: value))
            .font(.system(size: 10.5))
            .foregroundStyle(value.isEmpty ? Color(uiColor: .secondaryLabel) : Color(uiColor: .label))
            .lineLimit(6)
            .padding(.vertical, 2)
            .padding(.horizontal, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 90, alignment: .topLeading)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.teal.opacity(0.08))
            }
            .padding(.top, 2)
    }

    @ViewBuilder
    private func focusSwitcher(for session: WidgetSnapshot.Session) -> some View {
        let sessions = entry.snapshot.sessions
        if sessions.count > 1 {
            let index = sessions.firstIndex { $0.id == session.id } ?? 0
            let previous = sessions[(index - 1 + sessions.count) % sessions.count]
            let next = sessions[(index + 1) % sessions.count]
            HStack(spacing: 5) {
                Button(intent: HapiFocusSessionIntent(sessionId: previous.id)) {
                    Image(systemName: "chevron.left")
                        .frame(width: 16, height: 14)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Text("\(index + 1)/\(sessions.count)")
                    .monospacedDigit()
                Button(intent: HapiFocusSessionIntent(sessionId: next.id)) {
                    Image(systemName: "chevron.right")
                        .frame(width: 16, height: 14)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background {
                Capsule()
                    .fill(Color.primary.opacity(0.06))
            }
        }
    }

    @ViewBuilder
    private func detailSection(
        title: LocalizedStringKey,
        text: String?,
        placeholder: LocalizedStringKey,
        highlighted: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.secondary)
            let value = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            (value.isEmpty ? Text(placeholder) : Text(verbatim: value))
                .font(.system(size: 12))
                .foregroundStyle(value.isEmpty ? Color(uiColor: .secondaryLabel) : Color(uiColor: .label))
                .lineLimit(3)
                .padding(.vertical, highlighted ? 7 : 0)
                .padding(.horizontal, highlighted ? 9 : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    if highlighted {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(Color.teal.opacity(0.08))
                    }
                }
        }
        .padding(.top, 12)
    }
}
