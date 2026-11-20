import HapiClient
import HapiProtocol
import SwiftUI

/// Attach to the gear, not the chat root: UIKit needs the actual toolbar
/// anchor to position an iPad popover. One presenter survives size adaptation.
struct SessionConfigButton<Content: View>: View {
    @Binding var isPresented: Bool
    @ViewBuilder let content: () -> Content
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var prefersPopover: Bool {
        horizontalSizeClass == .regular && verticalSizeClass != .compact
    }

    var body: some View {
        Button {
            isPresented = true
        } label: {
            Image(systemName: "gearshape")
        }
        .accessibilityLabel("Session settings")
        .accessibilityIdentifier("session-config-open")
        .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
            content()
                // Preferred, not fixed: the system can constrain a small window.
                // Read the host's traits; popover content has its own traits.
                .frame(
                    idealWidth: prefersPopover ? 400 : nil,
                    maxWidth: prefersPopover ? 400 : nil,
                    idealHeight: prefersPopover ? popoverHeight : nil,
                    maxHeight: prefersPopover ? popoverHeight : nil
                )
                .presentationCompactAdaptation(.sheet)
        }
    }

    private var popoverHeight: CGFloat { dynamicTypeSize.isAccessibilitySize ? 600 : 480 }
}

/// Single-page, catalog-driven menus. Selecting applies immediately; Done
/// only dismisses. Presentation height is UI state, not configuration state.
struct SessionConfigView: View {
    @State private var model: SessionConfigModel
    @State private var detent: PresentationDetent = .medium
    let notice: String?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(interactor: ChatInteractor, notice: String? = nil) {
        self.init(model: SessionConfigModel(interactor: interactor), notice: notice)
    }

    init(model: SessionConfigModel, notice: String? = nil) {
        _model = State(initialValue: model)
        self.notice = notice
    }

    var body: some View {
        NavigationStack {
            settingsForm
                .navigationTitle("Session Settings")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { doneButton }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { feedback }
        .presentationDetents(
            dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large],
            selection: Binding(
                get: { dynamicTypeSize.isAccessibilitySize ? .large : detent },
                set: { detent = $0 }
            )
        )
        .onAppear { model.loadModels() }
    }

    private var settingsForm: some View {
        Form {
            if !model.config.active {
                statusNotice("Session is offline — changes apply after it resumes or may be rejected.")
            } else if model.config.controlledByUser {
                statusNotice("Session is controlled from the terminal — config changes will be rejected.")
            }

            if model.showsModel || model.showsEffort {
                Section {
                    if model.showsModel { modelRow }
                    if model.showsEffort { effortMenu }
                }
                .disabled(model.isApplying)
            }
            if !model.config.permissionModes.isEmpty || model.showsCollaborationMode {
                Section {
                    if !model.config.permissionModes.isEmpty { permissionMenu }
                    if model.showsCollaborationMode { collaborationMenu }
                } footer: {
                    if !model.config.permissionModes.isEmpty {
                        Text("Permission modes control how the agent requests approval. Behavior varies by agent.")
                    }
                }
                .disabled(model.isApplying)
            }
            if !model.hasSettings {
                statusNotice("No settings available for this session.")
            }
        }
    }

    private var permissionMenu: some View {
        SessionConfigMenu(
            title: "Permission mode", value: Text(verbatim: model.permission.label), tone: model.permission.tone
        ) {
            Picker("Permission mode", selection: Binding(
                get: { model.permission }, set: { model.selectPermission($0) }
            )) {
                if !model.config.permissionModes.contains(where: { $0.mode == model.permission }) {
                    permissionOption(PermissionModeOption(mode: model.permission)).disabled(true)
                }
                ForEach(model.config.permissionModes, id: \.mode) { option in
                    permissionOption(option)
                }
            }
            .pickerStyle(.inline)
        }
        .accessibilityIdentifier("session-config-permission")
    }

    private func permissionOption(_ option: PermissionModeOption) -> some View {
        Group {
            if option.tone == .danger {
                Label {
                    Text(verbatim: option.label) + Text(verbatim: " · ") + Text("High risk")
                } icon: {
                    Image(systemName: "exclamationmark.triangle")
                }
            } else {
                Text(verbatim: option.label)
            }
        }
        .tag(option.mode)
        .accessibilityIdentifier("session-config-permission-\(option.mode.rawValue)")
    }

    private var collaborationMenu: some View {
        SessionConfigMenu(
            title: "Collaboration Mode", value: Text(LocalizedStringKey(model.collaborationMode.label))
        ) {
            Picker("Collaboration Mode", selection: Binding(
                get: { model.collaborationMode }, set: { model.selectCollaborationMode($0) }
            )) {
                ForEach(CodexCollaborationMode.allCases, id: \.self) { mode in
                    Text(LocalizedStringKey(mode.label)).tag(mode)
                }
            }
            .pickerStyle(.inline)
        }
        .disabled(!model.config.canChangeCollaborationMode)
        .accessibilityIdentifier("session-config-collaboration")
    }

    private var effortMenu: some View {
        SessionConfigMenu(
            title: "Effort",
            value: Text(verbatim: model.effortOptions.first { $0.value == model.currentEffort }?.label ?? "Default")
        ) {
            Picker("Effort", selection: Binding(
                get: { model.currentEffort }, set: { model.selectEffort($0) }
            )) {
                ForEach(model.effortOptions, id: \.value) { option in
                    Text(verbatim: option.label)
                        .tag(option.value)
                        .disabled(!model.canSelectEffort(option.value))
                }
            }
            .pickerStyle(.inline)
        }
        .accessibilityIdentifier("session-config-effort")
    }

    private var modelRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            // A Menu/Picker with hundreds of OpenCode models re-laid out its
            // whole inline Picker on every config update (lag + scroll reset).
            // A pushed List is lazy and keeps its scroll position.
            NavigationLink {
                SessionModelPicker(
                    options: model.config.modelOptions ?? [],
                    unlisted: model.unlistedModelOption,
                    selected: model.currentModel
                ) { value in
                    model.selectModel(value)
                }
            } label: {
                SessionConfigSummaryRow(title: "Model", value: Text(verbatim: model.modelLabel))
            }
            .disabled(model.config.modelOptionsLoading || model.modelLoadFailed || model.config.modelOptions?.isEmpty != false)
            .accessibilityIdentifier("session-config-model")

            if model.config.modelOptionsLoading {
                ProgressView("Loading models…")
                    .accessibilityIdentifier("session-config-model-loading")
            } else if model.modelLoadFailed {
                Text("Failed to load models")
                    .foregroundStyle(.secondary)
                Button("Retry") { model.loadModels() }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("session-config-model-retry")
            } else if model.config.modelOptions?.isEmpty != false {
                Text("Model list unavailable for this session.")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("session-config-model-unavailable")
            }
        }
    }

    @ToolbarContentBuilder
    private var doneButton: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }
                .accessibilityIdentifier("session-config-done")
        }
    }

    /// ChatModel owns the event callback. Mirroring its notice here keeps
    /// failures visible above the modal without stealing chat's event handler.
    @ViewBuilder
    private var feedback: some View {
        if model.isApplying || notice != nil {
            VStack(alignment: .leading, spacing: 8) {
                if model.isApplying {
                    ProgressView("Applying changes…")
                        .accessibilityIdentifier("session-config-applying")
                }
                if let notice {
                    Label {
                        Text(verbatim: LocalizedNoticeMapper.map(notice))
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "info.circle")
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("session-config-notice")
                }
            }
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.regularMaterial)
        }
    }

    private func statusNotice(_ text: LocalizedStringKey) -> some View {
        Section {
            Label(text, systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

/// Menu labels share adaptive summaries, including VoiceOver's current value.
/// A Picker inside Menu supplies native selection checkmarks without a push.
private struct SessionConfigMenu<Content: View>: View {
    let title: LocalizedStringKey
    let value: Text
    var tone: PermissionModeTone = .neutral
    @ViewBuilder let content: () -> Content

    var body: some View {
        Menu(content: content) {
            HStack(spacing: 8) {
                SessionConfigSummaryRow(title: title, value: value, tone: tone)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(tone == .danger ? value + Text(verbatim: ", ") + Text("High risk") : value)
    }
}

private struct SessionConfigSummaryRow: View {
    let title: LocalizedStringKey
    let value: Text
    var tone: PermissionModeTone = .neutral
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                stackedSummary
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) {
                        Text(title).fixedSize()
                        Spacer(minLength: 0)
                        currentValue.fixedSize()
                    }
                    stackedSummary
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(
            tone == .danger
                ? value + Text(verbatim: ", ") + Text("High risk")
                : value
        )
    }

    private var stackedSummary: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
            currentValue
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var currentValue: some View {
        VStack(alignment: .leading, spacing: 2) {
            value
                .foregroundStyle(tone == .neutral || tone == .info ? .secondary : tone.color)
            if tone == .danger {
                SessionConfigRiskLabel()
            }
        }
    }
}

/// Explicit layout avoids Form's automatic Label style treating this subtitle
/// as a separate list-row label (which can clip or stretch its warning text).
private struct SessionConfigRiskLabel: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle")
                .accessibilityHidden(true)
            Text("High risk")
        }
        .font(.caption)
        .foregroundStyle(.red)
    }
}

private extension PermissionModeTone {
    var color: Color {
        switch self {
        case .danger: .red
        case .warning: .orange
        case .neutral, .info: .primary
        }
    }
}

/// Searchable, lazy model list for the session config sheet. OpenCode can
/// report hundreds of provider-qualified models; a Menu was both janky and
/// scroll-resetting under config updates.
private struct SessionModelPicker: View {
    let unlisted: CatalogOption?
    let selected: String?
    let onSelect: (String?) -> Void

    /// Snapshot on push: config updates (SSE keep-alives, sibling patches)
    /// must not rebuild the list while the user is scrolling.
    @State private var options: [CatalogOption]
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    init(
        options: [CatalogOption],
        unlisted: CatalogOption?,
        selected: String?,
        onSelect: @escaping (String?) -> Void
    ) {
        self.unlisted = unlisted
        self.selected = selected
        self.onSelect = onSelect
        _options = State(initialValue: options)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filtered: [CatalogOption] {
        guard !trimmedQuery.isEmpty else { return options }
        return options.filter {
            $0.label.localizedCaseInsensitiveContains(trimmedQuery)
                || ($0.value?.localizedCaseInsensitiveContains(trimmedQuery) ?? false)
        }
    }

    private var visibleUnlisted: CatalogOption? {
        guard let unlisted, trimmedQuery.isEmpty
                || unlisted.label.localizedCaseInsensitiveContains(trimmedQuery)
                || (unlisted.value?.localizedCaseInsensitiveContains(trimmedQuery) ?? false)
        else { return nil }
        return unlisted
    }

    var body: some View {
        List {
            if let unlisted = visibleUnlisted {
                row(unlisted, enabled: false)
                    .accessibilityIdentifier("session-config-model-unlisted")
            }
            ForEach(filtered, id: \.self) { option in
                row(option, enabled: true)
                    .accessibilityIdentifier("session-config-model-\(option.value ?? "default")")
            }
        }
        .searchable(text: $query, prompt: "Search models")
        .navigationTitle("Model")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ option: CatalogOption, enabled: Bool) -> some View {
        Button {
            onSelect(option.value)
            dismiss()
        } label: {
            HStack(spacing: 10) {
                Text(verbatim: option.label)
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                if option.value == selected {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}
