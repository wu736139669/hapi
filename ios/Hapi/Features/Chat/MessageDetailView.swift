import HapiProtocol
import HapiUI
import SwiftUI
import UIKit

private struct OpenMessageKey: EnvironmentKey {
    /// `(message id, full plain text)` — opens the selectable text sheet.
    static let defaultValue: ((String, String) -> Void)? = nil
}

extension EnvironmentValues {
    var openChatMessage: ((String, String) -> Void)? {
        get { self[OpenMessageKey.self] }
        set { self[OpenMessageKey.self] = newValue }
    }
}

private struct MessageSelection: Identifiable {
    let id: String
    let text: String
}

/// A screen owns the sheet, never a recycled bubble. Retain the original
/// text as a read-only snapshot even if the message window trims that row.
struct MessagePresentationHost: ViewModifier {
    let model: ChatModel
    let owner: String
    @State private var selection: MessageSelection?

    func body(content: Content) -> some View {
        content
            .environment(\.openChatMessage, { id, text in
                model.beginContentInspection()
                model.retainSurface("message:\(owner)")
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                selection = MessageSelection(id: id, text: text)
            })
            .sheet(item: $selection, onDismiss: {
                model.releaseSurface("message:\(owner)")
            }) { message in
                MessageDetailView(text: message.text).id(message.id)
            }
            .onChange(of: model.toolInspection.invalidation) {
                selection = nil
            }
    }
}

struct MessageDetailView: View {
    @State private var pager: MessageTextPager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.hapiPasteboard) private var pasteboard
    @Environment(\.hapiTypography) private var typography
    @Environment(\.hapiTheme) private var theme

    init(text: String) {
        _pager = State(initialValue: MessageTextPager(source: text))
    }

    var body: some View {
        NavigationStack {
            // UIKit owns selection here: SwiftUI `Text` only produced the
            // generic Copy/Share menu (no selection handles) inside a sheet.
            SelectableMessageText(
                text: pager.page.text,
                font: .systemFont(ofSize: typography.bodySize,
                                  weight: typography.boldText ? .semibold : .regular),
                textColor: UIColor(theme.textPrimary),
                accentColor: UIColor(theme.accent),
                lineSpacing: typography.bodyLineSpacing
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .hapiReadingColumn()
            .id(pager.number)
            .accessibilityIdentifier("message-detail-text")
            .navigationTitle("Full message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Copy full content", systemImage: "doc.on.doc") { pasteboard.copy(pager.source) }
                        .accessibilityIdentifier("message-copy-full")
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack {
                    Button { pager.previous() } label: {
                        Label("Previous part", systemImage: "chevron.left")
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(!pager.hasPrevious)
                    .accessibilityIdentifier("message-previous")
                    Spacer()
                    Text(String(format: String(localized: "Part %lld"), Int64(pager.number)))
                        .font(.footnote.monospacedDigit())
                    Spacer()
                    Button { pager.next() } label: {
                        Label("Next part", systemImage: "chevron.right")
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(!pager.hasNext)
                    .accessibilityIdentifier("message-next")
                }
                .hapiReadingColumn()
                .background(.bar)
            }
        }
        .hapiTypography()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// Read-only `UITextView` bridge: native text selection (word highlight,
/// draggable handles, cross-paragraph ranges, system Copy/Share menu).
/// SwiftUI `Text.textSelection` did not engage inside this sheet.
private struct SelectableMessageText: UIViewRepresentable {
    let text: String
    let font: UIFont
    let textColor: UIColor
    let accentColor: UIColor
    let lineSpacing: CGFloat

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = true
        view.alwaysBounceVertical = true
        view.backgroundColor = .clear
        view.dataDetectorTypes = []
        view.textContainerInset = UIEdgeInsets(top: 16, left: 0, bottom: 16, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.tintColor = accentColor
        view.adjustsFontForContentSizeCategory = false
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = lineSpacing
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: textColor,
            .paragraphStyle: paragraph,
        ]
        view.attributedText = NSAttributedString(string: text, attributes: attributes)
        view.tintColor = accentColor
    }
}
