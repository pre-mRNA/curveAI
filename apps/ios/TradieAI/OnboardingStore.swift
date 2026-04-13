import SwiftUI

@MainActor
final class OnboardingFlowStore: ObservableObject {
    @Published var draft: StaffOnboardingDraft
    @Published private(set) var currentStep: OnboardingStep
    @Published private(set) var completedSteps: Set<OnboardingStep>
    @Published private(set) var isLoading = false
    @Published private(set) var session: StaffSession?
    @Published private(set) var calendarStatus: CalendarConnectionStatus?
    @Published private(set) var consentReceipt: VoiceConsentReceipt?
    @Published private(set) var jobs: [TradieJob]
    @Published private(set) var selectedJobID: TradieJob.ID?
    @Published var statusMessage: String
    @Published var errorMessage: String?

    let client: TradieAPIClient

    init(
        client: TradieAPIClient,
        draft: StaffOnboardingDraft = .preview,
        jobs: [TradieJob] = TradieJob.sampleJobs
    ) {
        self.client = client
        self.draft = draft
        self.currentStep = .invite
        self.completedSteps = []
        self.jobs = jobs
        self.selectedJobID = jobs.first?.id
        self.statusMessage = "Verify the invite to start onboarding."
    }

    convenience init(client: TradieAPIClient) {
        self.init(client: client, draft: .preview, jobs: TradieJob.sampleJobs)
    }

    static func bootstrap() -> OnboardingFlowStore {
        if let baseURLString = ProcessInfo.processInfo.environment["TRADIE_API_BASE_URL"],
           let baseURL = URL(string: baseURLString) {
            let configuration = TradieAPIConfiguration(baseURL: baseURL)
            return OnboardingFlowStore(client: LiveTradieAPIClient(configuration: configuration))
        }

        return OnboardingFlowStore(client: MockTradieAPIClient())
    }

    var progressValue: Double {
        let totalSteps = Double(OnboardingStep.allCases.count)
        let currentIndex = Double(currentStep.rawValue + 1)
        return currentIndex / totalSteps
    }

    var selectedJob: TradieJob? {
        guard let selectedJobID else {
            return jobs.first
        }

        return jobs.first { $0.id == selectedJobID } ?? jobs.first
    }

    func binding<Value>(_ keyPath: WritableKeyPath<StaffOnboardingDraft, Value>) -> Binding<Value> {
        Binding(
            get: { self.draft[keyPath: keyPath] },
            set: { newValue in
                var draft = self.draft
                draft[keyPath: keyPath] = newValue
                self.draft = draft
            }
        )
    }

    func advanceInvite() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        errorMessage = nil

        do {
            let session = try await client.verifyOTP(
                OTPVerificationRequest(
                    inviteToken: draft.inviteCode,
                    otpCode: draft.otpCode
                )
            )

            self.session = session
            draft.staffName = session.displayName
            completedSteps.insert(.invite)
            currentStep = .calendar
            statusMessage = "Invite verified for \(session.displayName)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func connectCalendar() async {
        guard !isLoading, let session = session else { return }
        isLoading = true
        defer { isLoading = false }

        errorMessage = nil

        do {
            let result = try await client.connectCalendar(
                CalendarConnectRequest(
                    staffID: session.staffID,
                    outlookEmail: draft.outlookEmail,
                    calendarName: draft.calendarName
                ),
                token: session.accessToken
            )

            calendarStatus = result
            completedSteps.insert(.calendar)
            currentStep = .consent
            statusMessage = "\(result.calendarName) is connected."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func submitVoiceConsent() async {
        guard !isLoading, let session = session else { return }
        isLoading = true
        defer { isLoading = false }

        errorMessage = nil

        do {
            let receipt = try await client.submitVoiceConsent(
                VoiceConsentSubmission(
                    staffID: session.staffID,
                    consented: draft.consentAcknowledged,
                    sampleLabel: draft.voiceSampleLabel,
                    signedBy: session.displayName
                ),
                token: session.accessToken
            )

            consentReceipt = receipt
            completedSteps.insert(.consent)
            currentStep = .jobs
            statusMessage = "Voice consent captured. Jobs are ready."
            try await refreshJobs()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshJobs() async throws {
        guard let session = session else { return }
        let fetchedJobs = try await client.fetchJobs(token: session.accessToken)

        jobs = fetchedJobs
        let selectedExists = selectedJobID.flatMap { selectedID in
            fetchedJobs.contains(where: { $0.id == selectedID })
        } ?? false
        if !selectedExists {
            selectedJobID = fetchedJobs.first?.id
        }
        completedSteps.insert(.jobs)
    }

    func reloadJobs() async {
        do {
            try await refreshJobs()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectJob(_ job: TradieJob) {
        selectedJobID = job.id
    }
}

enum TradieAppBootstrap {
    static func makeStore() -> OnboardingFlowStore {
        OnboardingFlowStore.bootstrap()
    }
}
