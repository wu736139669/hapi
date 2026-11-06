import HapiClient
import HapiProtocol
import HapiUI
import SwiftUI

/// The session list (A-M2a) — standalone screen: navigation and hub chrome
/// stay outside; taps surface through `onOpenSession`.
///
/// Inventory (mirrors the web sidebar semantics via the Android port):
/// - an active-filter summary, pull-to-refresh, empty/loading states;
///   home owns the filter menu and connection notice;
/// - pinned section first (the sort already puts globalPinned/pinned rows on
///   top; a header makes the boundary visible);
/// - per row: a two-line-tall flavor icon whose presence badge marks
///   connected sessions (pulsing while running); title with trailing
///   relative `updatedAt` (unread: semibold title + accent time, no dot so
///   the badge stays the only dot); a quiet second line has project left and an attention symbol right. No preview, task progress,
///   machine/path details or spinners. Disconnected rows are not dimmed;
/// - swipe actions: leading pin/mark-read, trailing archive or delete/reopen;
/// - long-press context menu → rename, pin (none/project/global), then
///   archive for active sessions or reopen/delete for inactive ones (web
///   `SessionActionMenu`), with optimistic store updates; failures land in
///   an alert.
struct SessionListView: View {
    @Environment(\.hapiTheme) private var theme
    @Environment(DisplayPrefs.self) private var displayPrefs
    @ScaledMetric(relativeTo: .body) private var baseTitleSize: CGFloat = 17
    @ScaledMetric(relativeTo: .footnote) private var baseDetailSize: CGFloat = 13
    @ScaledMetric(relativeTo: .footnote) private var baseHeaderSize: CGFloat = 13
    @ScaledMetric(relativeTo: .body) private var baseIconSize: CGFloat = 30
    @ScaledMetric(relativeTo: .footnote) private var baseStatusSlotSize: CGFloat = 16
    let model: SessionListModel
    var selection: Binding<String?>? = nil
    let onOpenSession: (String) -> Void

    @State private var renameTarget: SessionRowUI?
    @State private var renameText = ""
    @State private var deleteTarget: SessionRowUI?
    /// Grouped rows kept while a pushed chat covers the list.
    @State private var frozenSnapshot: SessionListSnapshot?
    /// Per-section overrides; nil means use the section's default. Kept
    /// in-memory like the web sidebar.
    @State private var collapseOverrides: [String: Bool] = [:]

    private var listScale: CGFloat { CGFloat(displayPrefs.listFontScale) }

    private var metrics: SessionListMetrics {
        let scale = listScale
        #if targetEnvironment(macCatalyst)
        let baseInset: CGFloat = 6
        #else
        let baseInset: CGFloat = 12
        #endif
        return SessionListMetrics(
            titleSize: baseTitleSize * scale,
            detailSize: baseDetailSize * scale,
            headerSize: baseHeaderSize * scale,
            iconSize: baseIconSize * scale,
            statusSlotSize: baseStatusSlotSize * scale,
            iconSpacing: 12 * scale,
            rowVerticalInset: baseInset * scale,
            bucketDotSize: max(5, 6 * scale),
            bucketLabelSize: baseHeaderSize * scale * 0.9
        )
    }

    var body: some View {
        // Rows own their minute-tick age labels; the list itself only
        // changes with the data.
        Group {
            sessionList
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let summary = model.filterSummary {
                SessionFilterSummary(summary: summary, onClear: model.clearFilters)
            }
        }
        .onChange(of: model.machineFilterIds, initial: true) { _, _ in
            model.reconcileFilters()
        }
        .onChange(of: model.selectedSessionId, initial: true) { _, sessionId in
            expandSelectedSection(sessionId)
        }
        .task {
            // Explicit fetch on entry: the snapshot may be stale and a
            // `resume: ok` handshake deliberately skips the REST resync.
            if selection != nil {
                await model.refreshOnFirstAppearance()
            } else {
                await model.refresh()
            }
        }
        .refreshable {
            await model.refresh()
        }
        .alert(
            "Action failed",
            isPresented: Binding(
                get: { model.actionError != nil },
                set: { presented in
                    if !presented {
                        model.actionError = nil
                    }
                }
            )
        ) {
            Button("OK") {
                model.actionError = nil
            }
        } message: {
            Text(model.actionError ?? "")
        }
        .alert(
            "Rename Session",
            isPresented: Binding(
                get: { renameTarget != nil },
                set: { if !$0 { renameTarget = nil } }
            ),
            presenting: renameTarget
        ) { row in
            TextField("Session name", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                // An untouched title must not freeze an agent-generated one.
                if name != row.title {
                    model.renameSession(sessionId: row.id, name: name)
                }
            }
            .disabled(!SessionNameRules.isValid(renameText))
        }
        .alert(
            "Delete Session",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            presenting: deleteTarget
        ) { row in
            Button("Delete", role: .destructive) {
                model.deleteSession(sessionId: row.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text(SessionNameRules.deleteMessage(title: row.title))
        }
    }

    // MARK: - List

    /// Covered by a pushed chat, the list keeps its last grouped snapshot: on
    /// a large hub every streaming session would otherwise rebuild and diff
    /// thousands of rows nobody sees (~80 ms main-thread stalls while
    /// scrolling the chat). A side-by-side split never disappears and stays
    /// live; returning refreshes once.
    private var sessionList: some View {
        let snapshot = frozenSnapshot ?? model.snapshot
        return KeyedContent(key: ListRenderKey(
            snapshot: snapshot,
            selectable: selection != nil,
            theme: theme,
            filters: model.filters,
            metrics: metrics
        )) {
            list(snapshot)
        }
        .equatable()
        .onAppear { frozenSnapshot = nil }
        .onDisappear { frozenSnapshot = model.snapshot }
    }

    private func list(_ snapshot: SessionListSnapshot) -> some View {
        List(selection: selection) {
            if snapshot.searching {
                Section {
                    ForEach(snapshot.rows) { row in
                        equatableRow(row, detail: .projectMachine)
                    }
                }
                .listSectionSeparator(.hidden, edges: .top)
            } else {
                ForEach(snapshot.sections) { section in
                    sectionView(section)
                }
            }
        }
        .modifier(PlatformSessionListStyle())
        .environment(\.defaultMinListHeaderHeight, 0)
        // An explicit filter change starts at the top. SSE/count/name changes
        // keep this identity (and the reading position), as does chat return.
        .id(model.filters)
        .accessibilityIdentifier("home.sessions")
        .overlay {
            if snapshot.rows.isEmpty {
                emptyState
                    .allowsHitTesting(false) // keep the pull-to-refresh gesture
            }
        }
    }

    @ViewBuilder
    private func sectionView(_ section: SessionListSectionUI) -> some View {
        let collapsed = isCollapsed(section)
        Section {
            if !collapsed {
                if section.kind == .inProgress || section.kind == .active {
                    ForEach(section.buckets) { bucket in
                        BucketHeader(
                            bucket: bucket.bucket,
                            count: bucket.rows.count,
                            metrics: metrics
                        )
                        ForEach(bucket.rows) { row in
                            equatableRow(row, detail: .projectMachine)
                        }
                    }
                } else {
                    ForEach(section.rows) { row in
                        equatableRow(
                            row,
                            detail: section.kind == .directory ? .worktree : .projectMachine
                        )
                    }
                }
            }
        } header: {
            sectionHeader(section, collapsed: collapsed)
        }
        .listSectionSeparator(.hidden, edges: .top)
    }

    /// The List evaluates every row's content (offscreen ones included) on
    /// each list change, so one streaming session cost O(all rows) per
    /// update. Rows compare only what they draw and skip unchanged content.
    private func equatableRow(_ row: SessionRowUI, detail: SessionRowDetail) -> some View {
        KeyedContent(key: RowRenderKey(
            row: row,
            detail: detail,
            metrics: metrics,
            selectable: selection != nil,
            theme: theme
        )) {
            rowCell(row, detail: detail)
        }
        .equatable()
    }

    private func rowCell(_ row: SessionRowUI, detail: SessionRowDetail) -> some View {
        Group {
            if selection != nil {
                NavigationLink(value: row.id) {
                    rowLabel(row, detail: detail)
                }
                .tag(row.id)
            } else {
                Button {
                    onOpenSession(row.id)
                } label: {
                    rowLabel(row, detail: detail)
                }
                .buttonStyle(.plain)
            }
        }
        .listRowInsets(EdgeInsets(
            top: metrics.rowVerticalInset,
            leading: 16,
            bottom: metrics.rowVerticalInset,
            trailing: 16
        ))
        // Default separator color reads heavy against these rows; the theme
        // divider is the WeChat-style faint hairline.
        .listRowSeparatorTint(theme.divider)
        .swipeActions(edge: .leading) {
            leadingSwipeActions(row)
        }
        .swipeActions(edge: .trailing) {
            trailingSwipeActions(row)
        }
        .contextMenu {
            contextMenuActions(row)
        }
    }

    /// Filters force groups open, matching the web sidebar. Users can still
    /// collapse them after the filter is cleared; while filtering, the
    /// headers are disabled so a tap cannot appear to do nothing.
    private func isCollapsed(_ section: SessionListSectionUI) -> Bool {
        if model.hasActiveFilters { return false }
        return collapseOverrides[section.id] ?? section.defaultCollapsed
    }

    private func toggle(_ section: SessionListSectionUI) {
        withAnimation(.easeInOut(duration: 0.2)) {
            collapseOverrides[section.id] = !isCollapsed(section)
        }
    }

    private func expandSelectedSection(_ sessionId: String?) {
        guard let sessionId,
              let section = model.sections.first(where: { $0.contains(sessionId) }),
              isCollapsed(section) else { return }
        collapseOverrides[section.id] = false
    }

    private func sectionHeader(_ section: SessionListSectionUI, collapsed: Bool) -> some View {
        Button {
            toggle(section)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: metrics.headerSize * 0.75, weight: .semibold))
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                    .frame(width: 10)
                sectionIcon(section)
                sectionTitle(section)
                    .font(.system(size: metrics.headerSize, weight: .semibold))
                    .lineLimit(1)
                Text("(\(section.totalCount))")
                    .font(.system(size: metrics.headerSize, weight: .regular))
                    .monospacedDigit()
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.textSecondary)
            .textCase(nil)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.hasActiveFilters)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .accessibilityLabel(Text(sectionAccessibilityLabel(section)))
    }

    @ViewBuilder
    private func sectionTitle(_ section: SessionListSectionUI) -> some View {
        switch section.kind {
        case .personalPinned:
            Text("My sessions")
        case .globalPinned:
            Text("Pinned")
        case .inProgress:
            Text("In progress")
        case .active:
            Text("Active sessions")
        case .directory:
            Text(verbatim: directoryTitle(section))
        }
    }

    private func directoryTitle(_ section: SessionListSectionUI) -> String {
        let base: String
        if let name = section.directoryName, name != "Other" {
            base = name
        } else {
            base = String(localized: "Other")
        }
        guard model.showsMachineFilter,
              model.activeMachineFilter == nil,
              let machine = section.machineLabel else { return base }
        return "\(base) · \(machine)"
    }

    private func sectionAccessibilityLabel(_ section: SessionListSectionUI) -> String {
        let title: String = switch section.kind {
        case .personalPinned: String(localized: "My sessions")
        case .globalPinned: String(localized: "Pinned")
        case .inProgress: String(localized: "In progress")
        case .active: String(localized: "Active sessions")
        case .directory: directoryTitle(section)
        }
        return "\(title), \(section.totalCount)"
    }

    @ViewBuilder
    private func sectionIcon(_ section: SessionListSectionUI) -> some View {
        switch section.kind {
        case .personalPinned:
            Image(systemName: "person.crop.circle")
                .font(.system(size: metrics.headerSize))
        case .globalPinned:
            Image(systemName: "pin.fill")
                .font(.system(size: metrics.headerSize))
        case .inProgress:
            Image(systemName: "circle.fill")
                .font(.system(size: metrics.bucketDotSize))
                .foregroundStyle(theme.success)
        case .active:
            Image(systemName: "circle.fill")
                .font(.system(size: metrics.bucketDotSize))
                .foregroundStyle(theme.textSecondary)
        case .directory:
            Image(systemName: "folder")
                .font(.system(size: metrics.headerSize))
        }
    }

    /// Leading swipe: the quick toggles (pin, read), as in Mail.
    @ViewBuilder
    private func leadingSwipeActions(_ row: SessionRowUI) -> some View {
        let isPinned = row.summary.pinned == true || row.summary.globalPinned == true
        Button {
            model.setPinMode(sessionId: row.id, mode: isPinned ? .none : .project)
        } label: {
            Label(isPinned ? "Unpin" : "Pin to Project",
                  systemImage: isPinned ? "pin.slash.fill" : "pin.fill")
        }
        .tint(.orange)
        if row.unread {
            Button {
                model.markRead(sessionId: row.id)
            } label: {
                Label("Mark as Read", systemImage: "envelope.open.fill")
            }
            .tint(theme.accent)
        }
    }

    /// Trailing swipe mirrors the context menu's lifecycle actions: the hub
    /// archives live sessions only; inactive ones are deleted or reopened.
    @ViewBuilder
    private func trailingSwipeActions(_ row: SessionRowUI) -> some View {
        if row.summary.active {
            Button {
                model.archiveSession(sessionId: row.id)
            } label: {
                Label("Archive", systemImage: "archivebox.fill")
            }
            .tint(.indigo)
        } else {
            // Not role: .destructive — that removes the row before the
            // confirmation alert has a chance to cancel.
            Button {
                deleteTarget = row
            } label: {
                Label("Delete…", systemImage: "trash.fill")
            }
            .tint(.red)
            Button {
                model.reopenSession(sessionId: row.id) { sessionId in
                    onOpenSession(sessionId)
                }
            } label: {
                Label("Reopen", systemImage: "arrow.clockwise")
            }
            .tint(.gray)
        }
    }

    private func rowLabel(_ row: SessionRowUI, detail: SessionRowDetail) -> some View {
        SessionRowView(row: row, metrics: metrics, detail: detail)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
    }

    @ViewBuilder
    private func contextMenuActions(_ row: SessionRowUI) -> some View {
        let summary = row.summary
        if model.isPersonallyPinned(row.id) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    model.togglePersonalPin(sessionId: row.id)
                }
            } label: {
                Label("Remove from my sessions", systemImage: "person.crop.circle.badge.minus")
            }
        } else {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    model.togglePersonalPin(sessionId: row.id)
                }
            } label: {
                Label("Mark as my session", systemImage: "person.crop.circle.badge.plus")
            }
        }
        Button {
            renameText = row.title
            renameTarget = row
        } label: {
            Label("Rename…", systemImage: "pencil")
        }
        if summary.pinned == true || summary.globalPinned == true {
            Button {
                model.setPinMode(sessionId: row.id, mode: .none)
            } label: {
                Label("Unpin", systemImage: "pin.slash")
            }
        }
        if summary.pinned != true {
            Button {
                model.setPinMode(sessionId: row.id, mode: .project)
            } label: {
                Label("Pin to Project", systemImage: "pin")
            }
        }
        if summary.globalPinned != true {
            Button {
                model.setPinMode(sessionId: row.id, mode: .global)
            } label: {
                Label("Pin Globally", systemImage: "pin.circle")
            }
        }
        // The hub archives live sessions only (409 for an inactive one);
        // inactive history is reopened or deleted instead.
        if summary.active {
            Button(role: .destructive) {
                model.archiveSession(sessionId: row.id)
            } label: {
                Label("Archive", systemImage: "archivebox")
            }
        } else {
            Button {
                model.reopenSession(sessionId: row.id) { sessionId in
                    onOpenSession(sessionId)
                }
            } label: {
                Label("Reopen", systemImage: "arrow.clockwise")
            }
            Button(role: .destructive) {
                deleteTarget = row
            } label: {
                Label("Delete…", systemImage: "trash")
            }
        }
    }

    // MARK: - Chrome

    @ViewBuilder
    private var emptyState: some View {
        if !model.hasLoaded && !model.isOffline {
            ContentUnavailableView {
                Label("Loading sessions…", systemImage: "arrow.triangle.2.circlepath")
            } description: {
                Text("Fetching the session list from the hub.")
            }
        } else if model.isOffline {
            ContentUnavailableView {
                Label("Hub unreachable", systemImage: "wifi.slash")
            } description: {
                Text("Pull to retry once you are back online.")
            }
        } else if model.isSearching {
            ContentUnavailableView.search(text: model.searchQuery)
        } else if model.hasActiveFilters {
            ContentUnavailableView {
                Label("No matching sessions", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("Clear the filters to see every session.")
            }
        } else {
            ContentUnavailableView {
                Label("No sessions yet", systemImage: "tray")
            } description: {
                Text("Start an agent with the hapi CLI and it will appear here.")
            }
        }
    }
}

// MARK: - Row

/// Re-renders `content` only when `key` changes. List and row content
/// capture only stable references (the model, state setters, the open
/// callback), so an equal key can keep the previous content.
private struct KeyedContent<Key: Equatable, Content: View>: View, Equatable {
    let key: Key
    @ViewBuilder let content: () -> Content

    var body: some View { content() }

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.key == rhs.key }
}

struct SessionListMetrics: Equatable {
    let titleSize: CGFloat
    let detailSize: CGFloat
    let headerSize: CGFloat
    let iconSize: CGFloat
    let statusSlotSize: CGFloat
    let iconSpacing: CGFloat
    let rowVerticalInset: CGFloat
    let bucketDotSize: CGFloat
    let bucketLabelSize: CGFloat
}

enum SessionRowDetail: Equatable {
    case projectMachine
    case worktree
}

private struct RowRenderKey: Equatable {
    let row: SessionRowUI
    let detail: SessionRowDetail
    let metrics: SessionListMetrics
    let selectable: Bool
    let theme: HapiTheme
}

private struct ListRenderKey: Equatable {
    let snapshot: SessionListSnapshot
    let selectable: Bool
    let theme: HapiTheme
    let filters: SessionListFilters
    let metrics: SessionListMetrics
}

private struct BucketHeader: View {
    let bucket: SessionListBucket
    let count: Int
    let metrics: SessionListMetrics
    @Environment(\.hapiTheme) private var theme

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "circle.fill")
                .font(.system(size: metrics.bucketDotSize))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: metrics.bucketLabelSize, weight: .semibold))
            Text("(\(count))")
                .font(.system(size: metrics.bucketLabelSize, weight: .regular))
                .monospacedDigit()
            Spacer(minLength: 0)
        }
        .foregroundStyle(theme.textSecondary)
        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .selectionDisabled()
    }

    private var label: LocalizedStringKey {
        switch bucket {
        case .working: return "Running"
        case .pending: return "Pending"
        case .active: return "Active"
        case .idle: return "Idle"
        }
    }

    private var color: Color {
        switch bucket {
        case .working: return theme.success
        case .pending: return theme.warning
        case .active, .idle: return theme.textSecondary
        }
    }
}

struct SessionRowView: View {
    @Environment(\.hapiTheme) private var theme

    let row: SessionRowUI
    let metrics: SessionListMetrics
    let detail: SessionRowDetail

    var body: some View {
        HStack(alignment: .center, spacing: metrics.iconSpacing) {
            agentIcon
            VStack(alignment: .leading, spacing: 3) {
                titleLine
                detailLine
            }
        }
        // Separators start under the text column, as in Mail and Messages.
        .alignmentGuide(.listRowSeparatorLeading) { _ in metrics.iconSize + metrics.iconSpacing }
        .accessibilityElement(children: .combine)
        .accessibilityValue(row.unread ? Text("Unread") : Text(verbatim: ""))
        .accessibilityIdentifier("home.session.\(row.id)")
    }

    /// The agent owns the leading column; a presence badge marks connected
    /// sessions (pulsing while the agent works) instead of dimming the rest.
    private var agentIcon: some View {
        AgentFlavorIconView(flavor: row.flavor, size: metrics.iconSize * 0.8)
            .frame(width: metrics.iconSize, height: metrics.iconSize)
            .overlay(alignment: .bottomTrailing) {
                if row.summary.active {
                    presenceBadge
                }
            }
    }

    private var presenceBadge: some View {
        let isRunning = row.status == .running
        return Image(systemName: "circle.fill")
            .font(.system(size: metrics.iconSize * 0.3))
            .foregroundStyle(theme.success)
            .symbolEffect(.pulse, options: .repeating, isActive: isRunning)
            .padding(2)
            .background(Circle().fill(theme.background))
            .offset(x: 2, y: 2)
            .accessibilityLabel(isRunning ? Text("Running") : Text("Connected"))
    }

    private var titleLine: some View {
        HStack(spacing: 8) {
            Text(verbatim: row.title)
                .font(.system(size: metrics.titleSize, weight: row.unread ? .semibold : .regular))
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 4)
            // Unread is a semibold title plus an accent timestamp, not a
            // dot: the presence badge is the row's only dot.
            // Minute ticks redraw only this label, not the list.
            TimelineView(.periodic(from: .now, by: 60)) { context in
                Text(verbatim: formatRelativeAge(now: context.date, thenEpochMs: row.summary.updatedAt))
            }
            .font(.system(size: metrics.detailSize, weight: row.unread ? .semibold : .regular))
            .foregroundStyle(row.unread ? theme.accent : theme.textSecondary)
            .monospacedDigit()
            .fixedSize()
        }
    }

    /// Project/machine in pinned and bucket sections; worktree name inside a
    /// folder group. Routine activity lives on the icon badge.
    private var detailLine: some View {
        HStack(alignment: .center, spacing: 0) {
            // Keep the same text line height when metadata is missing,
            // so the row height does not jump.
            Text(verbatim: detailText ?? " ")
                .lineLimit(1)
                .accessibilityHidden(detailText == nil)
            Spacer(minLength: 12)
            if let status = row.status, let symbol = status.symbolName {
                Image(systemName: symbol)
                    .symbolVariant(.none)
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(attentionColor)
                    // One slot keeps every attention symbol aligned.
                    .frame(width: metrics.statusSlotSize, height: metrics.statusSlotSize)
                    .fixedSize()
                    .layoutPriority(1)
                    .accessibilityLabel(statusAccessibilityText(status))
            }
        }
        .font(.system(size: metrics.detailSize))
        .foregroundStyle(theme.textSecondary)
    }

    private var detailText: String? {
        switch detail {
        case .projectMachine:
            let text = [row.project, row.machine]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " · ")
            return text.isEmpty ? nil : text
        case .worktree:
            return row.worktree
        }
    }

    // Darker amber keeps thin strokes visible on white without a filled
    // symbol, background badge or animation competing with the session title.
    private var attentionColor: Color {
        theme.isDark ? theme.warning : Color(hex: 0x9A6700)
    }

    /// Keep the exact request count available to VoiceOver without adding
    /// another visible number or badge to every waiting conversation.
    private func statusAccessibilityText(_ status: SessionRowStatus) -> Text {
        let title = Text(LocalizedStringKey(status.titleKey))
        if let count = status.count, count > 1 {
            return Text("\(title) · \(count) requests")
        }
        return title
    }
}

// MARK: - Rename / delete copy (shared by the list and the chat menu)

enum SessionNameRules {
    /// Hub `PATCH /sessions/:id` accepts 1–255 characters.
    static func isValid(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.utf16.count <= 255
    }

    static func deleteMessage(title: String) -> String {
        String(format: String(localized: "Delete “%@”? This can't be undone."), title)
    }
}

// MARK: - Recent-directory chip (used by NewSessionView)

struct FilterChip: View {
    let label: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.footnote)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    selected
                        ? AnyShapeStyle(.tint.opacity(0.18))
                        : AnyShapeStyle(Color.secondary.opacity(0.12)),
                    in: Capsule()
                )
                .foregroundStyle(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Mac windows get the native sidebar list (vibrant background, rounded
/// accent selection, hover); touch layouts keep the plain list.
private struct PlatformSessionListStyle: ViewModifier {
    func body(content: Content) -> some View {
        #if targetEnvironment(macCatalyst)
        content.listStyle(.sidebar)
        #else
        content.listStyle(.plain)
        #endif
    }
}
