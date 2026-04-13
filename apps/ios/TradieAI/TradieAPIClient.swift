import Foundation

protocol TradieAPIClient {
    func verifyOTP(_ request: OTPVerificationRequest) async throws -> StaffSession
    func connectCalendar(_ request: CalendarConnectRequest, token: String) async throws -> CalendarConnectionStatus
    func submitVoiceConsent(_ request: VoiceConsentSubmission, token: String) async throws -> VoiceConsentReceipt
    func fetchJobs(token: String) async throws -> [TradieJob]
}

struct TradieAPIConfiguration {
    var baseURL: URL
    var verifyOTPPath: String = "/staff/verify-otp"
    var calendarConnectPath: String = "/staff/calendar/connect"
    var voiceConsentPath: String = "/staff/voice-consent"
    var jobsPath: String = "/jobs"
}

extension TradieAPIConfiguration {
    static var liveDefault: TradieAPIConfiguration {
        TradieAPIConfiguration(baseURL: URL(string: "http://localhost:3000")!)
    }
}

struct LiveTradieAPIClient: TradieAPIClient {
    let configuration: TradieAPIConfiguration
    let session: URLSession

    init(configuration: TradieAPIConfiguration = .liveDefault, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func verifyOTP(_ request: OTPVerificationRequest) async throws -> StaffSession {
        let response: OTPVerificationEnvelope = try await send(request, path: configuration.verifyOTPPath)
        return StaffSession(
            staffID: response.staff.id,
            displayName: response.staff.fullName,
            accessToken: response.session.token,
            expiresAt: response.session.expiresAt
        )
    }

    func connectCalendar(_ request: CalendarConnectRequest, token: String) async throws -> CalendarConnectionStatus {
        let payload = BackendCalendarConnectRequest(
            staffId: request.staffID,
            accountEmail: request.outlookEmail,
            calendarId: request.calendarName,
            timezone: TimeZone.current.identifier,
            externalConnectionId: nil
        )
        let response: CalendarConnectEnvelope = try await send(payload, path: configuration.calendarConnectPath, token: token)
        return CalendarConnectionStatus(
            connected: true,
            provider: response.calendarConnection.provider.capitalized,
            calendarName: response.calendarConnection.calendarId ?? request.calendarName,
            accountEmail: response.calendarConnection.accountEmail ?? request.outlookEmail
        )
    }

    func submitVoiceConsent(_ request: VoiceConsentSubmission, token: String) async throws -> VoiceConsentReceipt {
        let payload = BackendVoiceConsentRequest(
            staffId: request.staffID,
            consent: request.consented,
            signedBy: request.signedBy,
            capturedAt: ISO8601DateFormatter().string(from: Date())
        )
        let response: VoiceConsentEnvelope = try await send(payload, path: configuration.voiceConsentPath, token: token)
        return VoiceConsentReceipt(
            consented: response.staff.voiceConsentStatus == "granted",
            sampleLabel: request.sampleLabel,
            recordedAt: response.staff.voiceConsentAt ?? payload.capturedAt
        )
    }

    func fetchJobs(token: String) async throws -> [TradieJob] {
        let response: JobsEnvelope = try await sendEmpty(path: configuration.jobsPath, token: token)
        return response.jobs
    }

    private func send<Response: Decodable, Body: Encodable>(_ body: Body, path: String, token: String? = nil) async throws -> Response {
        let url = makeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try decoder.decode(Response.self, from: data)
    }

    private func sendEmpty<Response: Decodable>(path: String, token: String? = nil) async throws -> Response {
        let url = makeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try decoder.decode(Response.self, from: data)
    }

    private func validate(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.statusCode(httpResponse.statusCode)
        }
    }

    private func makeURL(path: String) -> URL {
        path
            .split(separator: "/")
            .reduce(configuration.baseURL) { partial, component in
                partial.appendingPathComponent(String(component))
            }
    }

    private var encoder: JSONEncoder {
        JSONEncoder()
    }

    private var decoder: JSONDecoder {
        JSONDecoder()
    }
}

struct MockTradieAPIClient: TradieAPIClient {
    var session: StaffSession = .init(staffID: "staff-001", displayName: "Jordan", accessToken: "mock-token", expiresAt: nil)
    var calendarStatus: CalendarConnectionStatus = .init(connected: true, provider: "Microsoft", calendarName: "Jordan - TradieAI", accountEmail: "jordan@tradieco.com")
    var voiceConsent: VoiceConsentReceipt = .init(consented: true, sampleLabel: "Quiet office sample", recordedAt: "2026-04-14T00:00:00Z")
    var jobs: [TradieJob] = TradieJob.sampleJobs

    func verifyOTP(_ request: OTPVerificationRequest) async throws -> StaffSession {
        session
    }

    func connectCalendar(_ request: CalendarConnectRequest, token: String) async throws -> CalendarConnectionStatus {
        calendarStatus
    }

    func submitVoiceConsent(_ request: VoiceConsentSubmission, token: String) async throws -> VoiceConsentReceipt {
        voiceConsent
    }

    func fetchJobs(token: String) async throws -> [TradieJob] {
        jobs
    }
}

private struct OTPVerificationEnvelope: Decodable {
    let staff: BackendStaff
    let session: BackendSession
}

private struct CalendarConnectEnvelope: Decodable {
    let calendarConnection: BackendCalendarConnection
}

private struct VoiceConsentEnvelope: Decodable {
    let staff: BackendStaff
}

private struct JobsEnvelope: Decodable {
    let jobs: [TradieJob]
}

private struct BackendStaff: Decodable {
    let id: String
    let fullName: String
    let voiceConsentStatus: String?
    let voiceConsentAt: String?
}

private struct BackendSession: Decodable {
    let token: String
    let expiresAt: String?
}

private struct BackendCalendarConnection: Decodable {
    let provider: String
    let accountEmail: String?
    let calendarId: String?
}

private struct BackendCalendarConnectRequest: Encodable {
    let staffId: String
    let accountEmail: String
    let calendarId: String
    let timezone: String
    let externalConnectionId: String?
    let provider: String = "outlook"
}

private struct BackendVoiceConsentRequest: Encodable {
    let staffId: String
    let consent: Bool
    let signedBy: String
    let capturedAt: String
}

enum APIError: Error, LocalizedError {
    case invalidResponse
    case statusCode(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server returned an invalid response."
        case .statusCode(let code):
            return "The server returned HTTP \(code)."
        }
    }
}
