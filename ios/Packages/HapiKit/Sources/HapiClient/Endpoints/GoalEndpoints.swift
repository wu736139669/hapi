import Foundation
import HapiProtocol

/// Goal control endpoints. The hub registers these as GET|POST — GET reads
/// the live goal, POST applies an action. Mirrors the web
/// `getCodexGoal`/`manageCodexGoal`/`getOpencodeGoal` client methods.
extension APIClient {
    public struct GoalResponse: Decodable, Sendable {
        public let goal: JSONValue?
    }

    public struct GoalRequest: Encodable, Sendable {
        public let action: String
        public let objective: String?
        public let tokenBudget: Int?

        public init(action: String, objective: String? = nil, tokenBudget: Int? = nil) {
            self.action = action
            self.objective = objective
            self.tokenBudget = tokenBudget
        }

        enum CodingKeys: String, CodingKey {
            case action, objective, tokenBudget
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(action, forKey: .action)
            // The wire schemas are strict: bare actions carry only `action`;
            // `update` carries `objective` (and tokenBudget for Codex only).
            if let objective { try container.encode(objective, forKey: .objective) }
            if let tokenBudget { try container.encode(tokenBudget, forKey: .tokenBudget) }
        }
    }

    private func goalPath(_ sessionId: String, flavor: String) -> String {
        let base = "/api/sessions/\(encodePathComponent(sessionId))"
        return flavor == "codex" ? "\(base)/codex/goal" : "\(base)/opencode/goal"
    }

    public func getGoal(sessionId: String, flavor: String) async throws -> GoalResponse {
        try await request(.get, goalPath(sessionId, flavor: flavor))
    }

    public func manageGoal(sessionId: String, flavor: String, payload: GoalRequest) async throws -> GoalResponse {
        try await request(.post, goalPath(sessionId, flavor: flavor), body: payload)
    }
}
