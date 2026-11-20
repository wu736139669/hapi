import SwiftUI

/// Fenced code block: rounded container with a header (language chip, wrap
/// toggle, copy button) and a monospaced body. Long blocks collapse by height
/// and offer a show-all control; line numbers are shown in the default
/// no-wrap mode and hidden when wrapping is enabled.
///
/// Highlighting runs off the main thread through the injected
/// `SyntaxHighlighting` engine and is applied when ready; until then (or when
/// the engine declines) the code renders as plain text.
public struct CodeBlockView: View {
    public let language: String?
    public let code: String
    /// Long blocks collapse to a height cap in the transcript; tool inspectors
    /// render the complete content instead (they already provide their own
    /// scroll and paging).
    public let collapsible: Bool

    @Environment(\.hapiTheme) private var theme
    @Environment(\.hapiTypography) private var typography
    @Environment(\.hapiCodeFontSize) private var codeFontSize
    @Environment(\.hapiSyntaxHighlighter) private var highlighter
    @Environment(\.hapiPasteboard) private var pasteboard

    @State private var highlighted: AttributedString?
    @State private var showCopied = false
    @State private var wrapLines = false
    @State private var expanded = false

    public init(language: String?, code: String, collapsible: Bool = true) {
        self.language = language
        self.code = code
        self.collapsible = collapsible
    }

    private var displayLanguage: String {
        guard let language, !language.isEmpty else { return "text" }
        return language.lowercased()
    }

    /// Recompute highlighting when content or palette changes.
    private var highlightID: String {
        "\(displayLanguage)|\(theme.isDark ? "d" : "l")|\(code.count)|\(code.hashValue)"
    }

    private var lineCount: Int {
        max(1, code.split(separator: "\n", omittingEmptySubsequences: false).count)
    }

    private var isCollapsible: Bool { collapsible && lineCount > 18 }

    private var isCollapsed: Bool { isCollapsible && !expanded && !wrapLines }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            codeBody
            if isCollapsible && !wrapLines {
                Button {
                    expanded.toggle()
                } label: {
                    Text(expanded ? "Collapse" : "Show all lines")
                        .font(typography.captionFont)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.link)
                .background(theme.codeHeaderBackground)
            }
        }
        .background(theme.codeBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task(id: highlightID) {
            highlighted = await highlighter.highlightAsync(
                code,
                language: language,
                dark: theme.isDark
            )
        }
    }

    @ViewBuilder
    private var codeBody: some View {
        if wrapLines {
            Text(highlighted ?? AttributedString(code))
                .font(typography.codeFont(size: codeFontSize))
                .lineSpacing(typography.codeLineSpacing)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 0) {
                    Text((1...lineCount).map(String.init).joined(separator: "\n"))
                        .font(typography.codeFont(size: codeFontSize))
                        .lineSpacing(typography.codeLineSpacing)
                        .foregroundStyle(theme.textHint)
                        .multilineTextAlignment(.trailing)
                        .padding(.leading, 8)
                        .padding(.trailing, 7)
                        .padding(.vertical, 12)
                    Rectangle()
                        .fill(theme.divider)
                        .frame(width: 1)
                    Text(highlighted ?? AttributedString(code))
                        .font(typography.codeFont(size: codeFontSize))
                        .lineSpacing(typography.codeLineSpacing)
                        .foregroundStyle(theme.textPrimary)
                        .textSelection(.enabled)
                        .padding(12)
                }
            }
            .frame(maxHeight: isCollapsed ? 250 : nil, alignment: .top)
            .clipped()
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(displayLanguage)
                .font(typography.captionMonoFont)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
            Button {
                wrapLines.toggle()
            } label: {
                Image(systemName: wrapLines ? "text.alignleft" : "arrow.left.and.right")
                    .font(typography.captionFont)
                    .frame(minWidth: 40, minHeight: 44)
                    .foregroundStyle(wrapLines ? theme.link : theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(wrapLines ? "Disable line wrap" : "Wrap lines"))
            Button {
                // Explicit MainActor hop: keeps the @MainActor pasteboard
                // call valid regardless of the SDK's Button-action isolation.
                let pasteboard = pasteboard
                let code = code
                Task { @MainActor in
                    pasteboard.copy(code)
                    showCopied = true
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    showCopied = false
                }
            } label: {
                Image(systemName: showCopied ? "checkmark" : "doc.on.doc")
                    .font(typography.captionFont)
                    .frame(minWidth: 44, minHeight: 44)
                    .foregroundStyle(showCopied ? theme.success : theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(showCopied ? "Copied" : "Copy code"))
        }
        .padding(.horizontal, 12)
        .background(theme.codeHeaderBackground)
    }
}
