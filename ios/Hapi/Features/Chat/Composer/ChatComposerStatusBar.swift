import HapiClient
import HapiUI
import SwiftUI

/// Quiet one-line status above the composer: connection/thinking state plus
/// the active model, effort and permission labels. Tapping any chip opens the
/// existing session config sheet; this is a readout, not a second settings UI.
struct ChatComposerStatusBar: View {
    let model: ChatModel
    let openSettings: () -> Void

    @Environment(\.hapiTheme) private var theme
    @Environment(\.hapiTypography) private var typography

    private var status: (label: String, color: Color) {
        ChatSessionStatus.label(
            active: model.header.active,
            thinking: model.header.thinking,
            reconnecting: model.isReconnecting
        )
    }

    private var config: SessionConfigState {
        model.interactor.config
    }

    private var modelLabel: String? {
        if let label = config.modelOptions?.first(where: { $0.value == config.model })?.label {
            return label
        }
        return config.model
    }

    private var effortLabel: String? {
        config.effortOptions?.first { $0.value == config.effort }?.label
    }

    private var permissionLabel: String? {
        config.permissionModes.first { $0.mode == config.permissionMode }?.label
    }

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Circle()
                    .fill(status.color)
                    .frame(width: 6, height: 6)
                Text(status.label)
                    .foregroundStyle(status.color)
            }
            .lineLimit(1)

            Spacer(minLength: 8)

            if let modelLabel {
                pill(modelLabel, icon: "cpu")
            }
            if let effortLabel {
                pill(effortLabel, icon: "speedometer")
            }
            if let permissionLabel {
                pill(permissionLabel, icon: "lock.shield")
            }
        }
        .font(typography.captionFont)
        .foregroundStyle(theme.textSecondary)
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .hapiReadingColumn()
        .accessibilityElement(children: .combine)
    }

    private func pill(_ label: String, icon: String) -> some View {
        Button(action: openSettings) {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 9, weight: .medium))
                Text(label)
                    .lineLimit(1)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(theme.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(theme.textSecondary)
        .accessibilityHint("Open session settings")
    }
}
