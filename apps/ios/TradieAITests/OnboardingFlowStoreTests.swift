import XCTest
@testable import TradieAI

@MainActor
final class OnboardingFlowStoreTests: XCTestCase {
    func testInviteAdvancesToCalendarAndStoresSession() async {
        let client = StubTradieAPIClient()
        let store = OnboardingFlowStore(client: client)
        store.draft.staffName = "Jordan"
        store.draft.phoneNumber = "+61 4 1234 5678"
        store.draft.inviteCode = "TRD-2048"
        store.draft.otpCode = "846219"

        await store.advanceInvite()

        XCTAssertEqual(store.currentStep, .calendar)
        XCTAssertEqual(store.completedSteps, [.invite])
        XCTAssertEqual(store.session?.staffID, "staff-001")
        XCTAssertEqual(store.statusMessage, "Invite verified for Jordan.")
        XCTAssertNil(store.errorMessage)
        XCTAssertEqual(client.verifyOTPCount, 1)
    }

    func testVoiceConsentAdvancesToJobsAndLoadsFeed() async {
        let client = StubTradieAPIClient()
        let store = OnboardingFlowStore(client: client)
        store.draft.otpCode = "846219"

        await store.advanceInvite()
        await store.connectCalendar()
        store.draft.consentAcknowledged = true
        store.draft.voiceSampleLabel = "Quiet office sample"
        await store.submitVoiceConsent()

        XCTAssertEqual(store.currentStep, .jobs)
        XCTAssertTrue(store.completedSteps.isSuperset(of: [.invite, .calendar, .consent, .jobs]))
        XCTAssertEqual(store.jobs.count, 2)
        XCTAssertEqual(store.selectedJob?.id, "job-101")
        XCTAssertEqual(client.fetchJobsCount, 1)
    }

    func testInviteFailureStopsProgression() async {
        let client = StubTradieAPIClient(sessionResult: .failure(TestError.networkDown))
        let store = OnboardingFlowStore(client: client)
        store.draft.otpCode = "000000"

        await store.advanceInvite()

        XCTAssertEqual(store.currentStep, .invite)
        XCTAssertNil(store.session)
        XCTAssertEqual(store.errorMessage, TestError.networkDown.localizedDescription)
        XCTAssertEqual(client.verifyOTPCount, 1)
    }
}

private final class StubTradieAPIClient: TradieAPIClient {
    var sessionResult: Result<StaffSession, Error>
    var calendarResult: Result<CalendarConnectionStatus, Error>
    var voiceConsentResult: Result<VoiceConsentReceipt, Error>
    var jobsResult: Result<[TradieJob], Error>

    private(set) var verifyOTPCount = 0
    private(set) var connectCalendarCount = 0
    private(set) var submitVoiceConsentCount = 0
    private(set) var fetchJobsCount = 0

    init(
        sessionResult: Result<StaffSession, Error> = .success(.init(
            staffID: "staff-001",
            displayName: "Jordan",
            accessToken: "mock-token",
            expiresAt: nil
        )),
        calendarResult: Result<CalendarConnectionStatus, Error> = .success(.init(
            connected: true,
            provider: "Microsoft",
            calendarName: "Jordan - TradieAI",
            accountEmail: "jordan@tradieco.com"
        )),
        voiceConsentResult: Result<VoiceConsentReceipt, Error> = .success(.init(
            consented: true,
            sampleLabel: "Quiet office sample",
            recordedAt: "2026-04-14T00:00:00Z"
        )),
        jobsResult: Result<[TradieJob], Error> = .success(TradieJob.sampleJobs)
    ) {
        self.sessionResult = sessionResult
        self.calendarResult = calendarResult
        self.voiceConsentResult = voiceConsentResult
        self.jobsResult = jobsResult
    }

    func verifyOTP(_ request: OTPVerificationRequest) async throws -> StaffSession {
        verifyOTPCount += 1
        return try sessionResult.get()
    }

    func connectCalendar(_ request: CalendarConnectRequest, token: String) async throws -> CalendarConnectionStatus {
        connectCalendarCount += 1
        return try calendarResult.get()
    }

    func submitVoiceConsent(_ request: VoiceConsentSubmission, token: String) async throws -> VoiceConsentReceipt {
        submitVoiceConsentCount += 1
        return try voiceConsentResult.get()
    }

    func fetchJobs(token: String) async throws -> [TradieJob] {
        fetchJobsCount += 1
        return try jobsResult.get()
    }
}

private enum TestError: Error, LocalizedError {
    case networkDown

    var errorDescription: String? {
        switch self {
        case .networkDown:
            return "The network is unavailable."
        }
    }
}
