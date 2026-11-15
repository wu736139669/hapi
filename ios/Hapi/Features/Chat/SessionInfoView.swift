import HapiClient
import HapiUI
import SwiftUI
import UIKit

/// Full session metadata behind the deliberately compact nav subtitle:
/// the subtitle only has room for project + machine on a phone.
struct SessionInfoView: View {
    let header: ChatHeaderUI
    let sessionId: String
    let status: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    row("Status", value: status)
                    if let path = header.projectPath {
                        row("Project", value: path, copyable: true)
                    } else if let project = header.project {
                        row("Project", value: project)
                    }
                    if let machine = header.machine {
                        row("Machine", value: machine)
                    }
                    if let worktree = header.worktree {
                        row("Worktree", value: worktree)
                    }
                }
                Section {
                    if let model = header.model {
                        row("Model", value: model)
                    }
                    if let effort = header.effort {
                        row("Effort", value: effort)
                    }
                    row("Session ID", value: sessionId, copyable: true)
                }
            }
            .navigationTitle(header.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ label: LocalizedStringKey, value: String, copyable: Bool = false) -> some View {
        LabeledContent {
            HStack(spacing: 8) {
                Text(verbatim: value)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                if copyable {
                    Button {
                        UIPasteboard.general.string = value
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Copy")
                }
            }
        } label: {
            Text(label)
        }
    }
}
