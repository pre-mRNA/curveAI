import SwiftUI

struct OnboardingJourneyView: View {
    @ObservedObject var store: OnboardingFlowStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SectionHeader(
                    title: "Staff setup",
                    subtitle: "Complete invite, calendar, and voice setup, then land in the live job queue."
                )

                SurfaceCard(title: "Progress", subtitle: store.statusMessage) {
                    VStack(alignment: .leading, spacing: 14) {
                        ProgressView(value: store.progressValue)
                            .tint(.indigo)

                        StepRail(
                            steps: OnboardingStep.allCases,
                            currentStep: store.currentStep,
                            completedSteps: store.completedSteps
                        )
                    }
                }

                if let errorMessage = store.errorMessage {
                    SurfaceCard(title: "Action needed", subtitle: nil) {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                ForEach(OnboardingStep.allCases) { step in
                    OnboardingStageCard(step: step, store: store)
                }
            }
            .padding()
        }
        .background(
            LinearGradient(
                colors: [Color.indigo.opacity(0.10), Color.teal.opacity(0.08), Color.clear],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
        .navigationTitle("TradieAI")
        .navigationBarTitleDisplayMode(.large)
    }
}

private struct OnboardingStageCard: View {
    let step: OnboardingStep
    @ObservedObject var store: OnboardingFlowStore

    private var isCurrent: Bool {
        store.currentStep == step
    }

    private var isComplete: Bool {
        store.completedSteps.contains(step)
    }

    var body: some View {
        SurfaceCard(title: step.title, subtitle: step.subtitle) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label(
                        isComplete ? "Completed" : (isCurrent ? "In progress" : "Locked"),
                        systemImage: isComplete ? "checkmark.seal.fill" : (isCurrent ? "clock.arrow.circlepath" : "lock.fill")
                    )
                    .foregroundStyle(isComplete ? .green : (isCurrent ? .indigo : .secondary))
                    Spacer()
                }

                switch step {
                case .invite:
                    InviteStepContent(store: store, isCurrent: isCurrent, isComplete: isComplete)
                case .calendar:
                    CalendarStepContent(store: store, isCurrent: isCurrent, isComplete: isComplete)
                case .consent:
                    VoiceConsentStepContent(store: store, isCurrent: isCurrent, isComplete: isComplete)
                case .jobs:
                    JobsStepContent(store: store, isCurrent: isCurrent, isComplete: isComplete)
                }
            }
        }
    }
}

private struct InviteStepContent: View {
    @ObservedObject var store: OnboardingFlowStore
    let isCurrent: Bool
    let isComplete: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isCurrent {
                VStack(spacing: 12) {
                    TextField("Invite code", text: store.binding(\.inviteCode))
                        .textFieldStyle(.roundedBorder)
                    TextField("OTP code", text: store.binding(\.otpCode))
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                }

                Button {
                    Task { await store.advanceInvite() }
                } label: {
                    Text(store.isLoading ? "Verifying..." : "Verify invite")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isLoading)

                Text("Enter the invite code issued by ops and the 6-digit OTP to mint a staff session.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if isComplete, let session = store.session {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Invite code verified", systemImage: "message.fill")
                    Label("Session ready for \(session.displayName)", systemImage: "person.crop.circle.fill")
                }
                .foregroundStyle(.secondary)
            } else {
                Text("Complete invite verification to unlock the rest of onboarding.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct CalendarStepContent: View {
    @ObservedObject var store: OnboardingFlowStore
    let isCurrent: Bool
    let isComplete: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isCurrent {
                VStack(spacing: 12) {
                    TextField("Outlook email", text: store.binding(\.outlookEmail))
                        .textFieldStyle(.roundedBorder)
                    TextField("Calendar name", text: store.binding(\.calendarName))
                        .textFieldStyle(.roundedBorder)
                }

                Button {
                    Task { await store.connectCalendar() }
                } label: {
                    Text(store.isLoading ? "Connecting..." : "Connect Outlook")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isLoading || store.session == nil)

                Text("The live client is wired for Microsoft Graph-style calendar connection details and expects a staff session token.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if isComplete, let status = store.calendarStatus {
                VStack(alignment: .leading, spacing: 8) {
                    Label("\(status.provider) connected", systemImage: "checkmark.seal.fill")
                    Text("\(status.accountEmail) · \(status.calendarName)")
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Calendar connection comes after invite verification.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct VoiceConsentStepContent: View {
    @ObservedObject var store: OnboardingFlowStore
    let isCurrent: Bool
    let isComplete: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isCurrent {
                Toggle("I have permission to record and clone this voice", isOn: store.binding(\.consentAcknowledged))

                TextField("Voice sample label", text: store.binding(\.voiceSampleLabel))
                    .textFieldStyle(.roundedBorder)

                Button {
                    Task { await store.submitVoiceConsent() }
                } label: {
                    Text(store.isLoading ? "Saving consent..." : "Save consent and load jobs")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isLoading || store.session == nil || !store.draft.consentAcknowledged)

                Text("The production version should capture explicit legal consent and keep an auditable revocation path.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if isComplete, let receipt = store.consentReceipt {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Consent recorded", systemImage: "checkmark.seal.fill")
                    Text("\(receipt.sampleLabel) · \(receipt.recordedAt)")
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Voice consent unlocks the live call agent and sample upload path.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct JobsStepContent: View {
    @ObservedObject var store: OnboardingFlowStore
    let isCurrent: Bool
    let isComplete: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isCurrent || isComplete {
                JobBoardView(store: store)

                Button {
                    Task {
                        await store.reloadJobs()
                    }
                } label: {
                    Text(store.isLoading ? "Refreshing..." : "Refresh jobs")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(store.isLoading || store.session == nil)
            } else {
                Text("Jobs load after voice consent is captured.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    NavigationStack {
        OnboardingJourneyView(store: OnboardingFlowStore(client: MockTradieAPIClient()))
    }
}
