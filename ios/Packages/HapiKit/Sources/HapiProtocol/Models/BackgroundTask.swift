import Foundation

/// One entry of Claude Code's `system/background_tasks_changed` snapshot.
/// Hub `SessionSchema.backgroundTasks`; the count alone drives badges, the
/// descriptions back the composer chip's task list.
public struct BackgroundTask: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var type: String
    public var description: String

    public init(id: String, type: String, description: String) {
        self.id = id
        self.type = type
        self.description = description
    }
}
