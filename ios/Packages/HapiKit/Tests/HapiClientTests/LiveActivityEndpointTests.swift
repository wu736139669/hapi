import Foundation
import HapiClient
import Testing

@Suite("Live Activity endpoints")
struct LiveActivityEndpointTests {
    private func bodyString(_ request: URLRequest?) -> String? {
        request?.httpBody.flatMap { String(data: $0, encoding: .utf8) }
    }

    private let token = String(repeating: "aa", count: 32)

    @Test func registersWithDeviceSessionAndPushKey() async throws {
        let harness = try makeHarness(jwt: freshJWT())
        await harness.performer.enqueue(json: #"{"ok":true,"remote":true}"#)

        let response = try await harness.client.registerLiveActivityToken(
            token: token,
            deviceId: "dev-1",
            sessionId: "sess-1",
            pushKey: "key"
        )

        #expect(response == LiveActivityRegistrationResponse(ok: true, remote: true))
        let request = await harness.performer.requests.first
        #expect(request?.url?.absoluteString == "\(testHubURLString)/api/live-activities/register")
        #expect(request?.httpMethod == "POST")
        #expect(
            bodyString(request)
                == "{\"deviceId\":\"dev-1\",\"pushKey\":\"key\",\"sessionId\":\"sess-1\",\"token\":\"\(token)\"}"
        )
    }

    @Test func unregistersByTokenOrDeviceSession() async throws {
        let harness = try makeHarness(jwt: freshJWT())
        await harness.performer.enqueue(json: "{}")
        await harness.performer.enqueue(json: "{}")

        try await harness.client.unregisterLiveActivityToken(token: token)
        try await harness.client.unregisterLiveActivityTokens(deviceId: "dev-1", sessionId: "sess-1")

        let requests = await harness.performer.requests
        #expect(requests.count == 2)
        #expect(requests[0].httpMethod == "DELETE")
        #expect(bodyString(requests[0]) == "{\"token\":\"\(token)\"}")
        #expect(bodyString(requests[1]) == #"{"deviceId":"dev-1","sessionId":"sess-1"}"#)
    }
}
