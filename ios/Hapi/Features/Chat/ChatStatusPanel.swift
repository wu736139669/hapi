import HapiProtocol
import HapiUI
import SwiftUI

/// Read-only session status derived from the current transcript and session
/// detail. This is the native counterpart of the web `SessionStatusPanel` +
/// `TeamPanel`: goal, todo tasks, running subagents, foreground commands, and
/// team state, folded into one collapsible card.
struct ChatStatusPanelData: Equatable {
    struct Goal: Equatable {
        var objective: String
        var status: String
        var timeUsedSeconds: Double
        var tokensUsed: Double
        var tokenBudget: Double?
    }

    struct Task: Identifiable, Equatable {
        var id: String
        var content: String
        var completed: Bool
    }

    struct Subagent: Identifiable, Equatable {
        var id: String
        var title: String
        var detail: String?
        var state: String
    }

    struct Terminal: Identifiable, Equatable {
        var id: String
        var command: String
        var cwd: String?
    }

    struct TeamMember: Identifiable, Equatable {
        var id: String
        var name: String
        var agentType: String?
        var status: String?
    }

    struct TeamTask: Identifiable, Equatable {
        var id: String
        var title: String
        var status: String?
        var owner: String?
    }

    struct TeamMessage: Identifiable, Equatable {
        var id: String
        var from: String
        var to: String
        var summary: String
    }

    struct Team: Equatable {
        var name: String
        var description: String?
        var members: [TeamMember]
        var tasks: [TeamTask]
        var messages: [TeamMessage]
    }

    var goal: Goal?
    var tasks: [Task]
    var subagents: [Subagent]
    var terminals: [Terminal]
    var team: Team?

    var isEmpty: Bool {
        goal == nil && tasks.isEmpty && subagents.isEmpty && terminals.isEmpty && team == nil
    }

    static func build(
        goal: JSONValue?,
        tasks: [TodoItem]?,
        blocks: [VisibleChatBlock],
        teamState: JSONValue?
    ) -> ChatStatusPanelData? {
        let data = ChatStatusPanelData(
            goal: parseGoal(goal),
            tasks: (tasks ?? []).map {
                Task(id: $0.id.isEmpty ? $0.content : $0.id,
                     content: $0.content,
                     completed: $0.status == .completed)
            },
            subagents: subagents(in: blocks),
            terminals: terminals(in: blocks),
            team: parseTeam(teamState)
        )
        return data.isEmpty ? nil : data
    }

    // MARK: - Goal

    private static func parseGoal(_ value: JSONValue?) -> Goal? {
        guard let object = value?.statusObject,
              let objective = object["objective"]?.statusString,
              !objective.isEmpty else { return nil }
        return Goal(
            objective: objective,
            status: object["status"]?.statusString ?? "",
            timeUsedSeconds: object["timeUsedSeconds"]?.statusNumber ?? 0,
            tokensUsed: object["tokensUsed"]?.statusNumber ?? 0,
            tokenBudget: object["tokenBudget"]?.statusNumber
        )
    }

    // MARK: - Tools

    private static func tools(in blocks: [VisibleChatBlock]) -> [ToolCallBlock] {
        var result: [ToolCallBlock] = []
        func collect(_ block: ChatBlock) {
            guard case .toolCall(let tool) = block else { return }
            result.append(tool)
            for child in tool.children { collect(child) }
        }
        for visible in blocks {
            switch visible {
            case .block(let block):
                collect(block)
            case .toolGroup(let group):
                for tool in group.tools { collect(.toolCall(tool)) }
            }
        }
        return result
    }

    private static func subagents(in blocks: [VisibleChatBlock]) -> [Subagent] {
        tools(in: blocks).compactMap { block in
            let name = block.tool.name.trimmingCharacters(in: .whitespaces).lowercased()
            guard name == "task" || name == "agent" || name == "codexagent"
                || name.hasPrefix("task:") || name.hasPrefix("agent:") else { return nil }
            guard block.tool.state != .completed else { return nil }
            let title = inputString(block.tool.input, ["description", "summary", "title", "prompt", "message"])
                ?? inputString(block.tool.input, ["subagent_type", "agent_type"])
                ?? block.tool.nativeTitle
                ?? String(localized: "Agent")
            let detail = block.children.last.flatMap { child -> String? in
                guard case .toolCall(let tool) = child else { return nil }
                return tool.tool.nativeTitle ?? tool.tool.name
            }
            let state: String
            switch block.tool.state {
            case .error: state = String(localized: "Error")
            case .pending: state = String(localized: "Waiting")
            default: state = String(localized: "Running")
            }
            return Subagent(id: block.id, title: title, detail: detail, state: state)
        }
    }

    private static func terminals(in blocks: [VisibleChatBlock]) -> [Terminal] {
        tools(in: blocks).compactMap { block in
            guard block.tool.state == .running else { return nil }
            let name = block.tool.name.lowercased()
            guard name == "bash" || name == "shell" || name == "command" else { return nil }
            guard let command = inputString(block.tool.input, ["command", "cmd"]) else {
                return Terminal(id: block.id, command: block.tool.nativeTitle ?? name, cwd: nil)
            }
            return Terminal(
                id: block.id,
                command: command,
                cwd: inputString(block.tool.input, ["cwd", "workdir", "path"])
            )
        }
    }

    private static func inputString(_ value: JSONValue?, _ keys: [String]) -> String? {
        guard let object = value?.statusObject else { return nil }
        for key in keys {
            if let string = object[key]?.statusString,
               !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return string
            }
        }
        return nil
    }

    // MARK: - Team

    private static func parseTeam(_ value: JSONValue?) -> Team? {
        guard let object = value?.statusObject,
              let name = object["teamName"]?.statusString,
              !name.isEmpty else { return nil }
        let members = (object["members"]?.statusArray ?? []).enumerated().compactMap { (index, item) -> TeamMember? in
            guard let member = item.statusObject, let memberName = member["name"]?.statusString else { return nil }
            return TeamMember(
                id: "\(index)-\(memberName)",
                name: memberName,
                agentType: member["agentType"]?.statusString,
                status: member["status"]?.statusString
            )
        }
        let tasks = (object["tasks"]?.statusArray ?? []).enumerated().compactMap { (index, item) -> TeamTask? in
            guard let task = item.statusObject, let title = task["title"]?.statusString else { return nil }
            return TeamTask(
                id: task["id"]?.statusString ?? "\(index)",
                title: title,
                status: task["status"]?.statusString,
                owner: task["owner"]?.statusString
            )
        }
        let messages = (object["messages"]?.statusArray ?? []).suffix(5).enumerated().compactMap { (index, item) -> TeamMessage? in
            guard let message = item.statusObject,
                  let from = message["from"]?.statusString,
                  let to = message["to"]?.statusString else { return nil }
            return TeamMessage(
                id: "\(index)-\(from)-\(to)",
                from: from,
                to: to,
                summary: message["summary"]?.statusString ?? ""
            )
        }
        return Team(
            name: name,
            description: object["description"]?.statusString,
            members: members,
            tasks: tasks,
            messages: messages
        )
    }
}

struct ChatStatusPanelView: View {
    let data: ChatStatusPanelData

    @State private var expanded = false
    @Environment(\.hapiTheme) private var theme
    @Environment(\.hapiTypography) private var typography

    private var completedTasks: Int { data.tasks.filter(\.completed).count }

    private var summary: String {
        var parts: [String] = []
        if !data.tasks.isEmpty { parts.append("\(completedTasks)/\(data.tasks.count)") }
        if !data.subagents.isEmpty { parts.append("\(data.subagents.count)") }
        if !data.terminals.isEmpty { parts.append("\(data.terminals.count)") }
        if let team = data.team { parts.append("\(team.name)") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 12, weight: .semibold))
                    Text("Session status")
                        .font(typography.captionFont.weight(.semibold))
                    if data.goal != nil {
                        Text("Goal")
                            .font(typography.captionFont)
                            .foregroundStyle(theme.textHint)
                    }
                    Spacer(minLength: 6)
                    if !summary.isEmpty {
                        Text(summary)
                            .font(typography.captionFont)
                            .foregroundStyle(theme.textHint)
                            .lineLimit(1)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .foregroundStyle(theme.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        if let goal = data.goal { goalSection(goal) }
                        if !data.tasks.isEmpty { taskSection }
                        if !data.subagents.isEmpty { subagentSection }
                        if !data.terminals.isEmpty { terminalSection }
                        if let team = data.team { teamSection(team) }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
                }
                .frame(maxHeight: 280)
            }
        }
        .background(theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 12)
    }

    private func goalSection(_ goal: ChatStatusPanelData.Goal) -> some View {
        section("Goal") {
            Text(verbatim: goal.objective)
                .font(typography.captionFont)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(3)
            HStack(spacing: 6) {
                Text(verbatim: goal.status)
                if goal.tokenBudget != nil {
                    Text(verbatim: "\(Int(goal.tokensUsed)) / \(Int(goal.tokenBudget ?? 0))")
                }
            }
            .font(typography.captionFont)
            .foregroundStyle(theme.textHint)
        }
    }

    private var taskSection: some View {
        section("Tasks", suffix: "\(completedTasks)/\(data.tasks.count)") {
            ForEach(data.tasks.prefix(12)) { task in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: task.completed ? "checkmark.square.fill" : "square")
                        .font(.system(size: 10))
                        .foregroundStyle(task.completed ? theme.success : theme.textHint)
                    Text(verbatim: task.content)
                        .font(typography.captionFont)
                        .foregroundStyle(task.completed ? theme.textHint : theme.textPrimary)
                        .strikethrough(task.completed)
                }
            }
        }
    }

    private var subagentSection: some View {
        section("Subagents") {
            ForEach(data.subagents) { agent in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Circle().fill(subagentColor(agent.state)).frame(width: 5, height: 5)
                        Text(verbatim: agent.title)
                            .font(typography.captionFont)
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text(verbatim: agent.state)
                            .font(typography.captionFont)
                            .foregroundStyle(subagentColor(agent.state))
                    }
                    if let detail = agent.detail {
                        Text(verbatim: detail)
                            .font(typography.captionFont)
                            .foregroundStyle(theme.textHint)
                            .lineLimit(1)
                            .padding(.leading, 10)
                    }
                }
            }
        }
    }

    private var terminalSection: some View {
        section("Terminals") {
            ForEach(data.terminals) { terminal in
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: terminal.command)
                        .font(typography.codeFont(size: 11))
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    if let cwd = terminal.cwd {
                        Text(verbatim: cwd)
                            .font(typography.captionFont)
                            .foregroundStyle(theme.textHint)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    private func teamSection(_ team: ChatStatusPanelData.Team) -> some View {
        section("Team", suffix: team.name) {
            if let description = team.description {
                Text(verbatim: description)
                    .font(typography.captionFont)
                    .foregroundStyle(theme.textHint)
            }
            if !team.members.isEmpty {
                Text(team.members.map(\.name).joined(separator: " · "))
                    .font(typography.captionFont)
                    .foregroundStyle(theme.textPrimary)
            }
            ForEach(team.tasks.prefix(8)) { task in
                HStack(spacing: 5) {
                    Circle().fill(teamTaskColor(task.status)).frame(width: 5, height: 5)
                    Text(verbatim: task.title)
                        .font(typography.captionFont)
                        .lineLimit(1)
                    if let owner = task.owner {
                        Text(verbatim: owner)
                            .font(typography.captionFont)
                            .foregroundStyle(theme.textHint)
                    }
                }
            }
            ForEach(team.messages) { message in
                Text(verbatim: "\(message.from) → \(message.to): \(message.summary)")
                    .font(typography.captionFont)
                    .foregroundStyle(theme.textHint)
                    .lineLimit(1)
            }
        }
    }

    private func section<Content: View>(
        _ title: LocalizedStringKey,
        suffix: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            (Text(title) + (suffix.map { Text(verbatim: " · \($0)") } ?? Text(verbatim: "")))
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(theme.textHint)
                .textCase(.uppercase)
            content()
        }
    }

    private func subagentColor(_ state: String) -> Color {
        if state == String(localized: "Error") { return theme.danger }
        if state == String(localized: "Waiting") { return theme.warning }
        return theme.success
    }

    private func teamTaskColor(_ status: String?) -> Color {
        switch status {
        case "completed": return theme.success
        case "in_progress": return theme.accent
        case "blocked": return theme.danger
        default: return theme.textHint
        }
    }
}


private extension JSONValue {
    var statusObject: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var statusArray: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var statusString: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var statusNumber: Double? {
        if case .number(let value) = self { return value }
        return nil
    }
}
