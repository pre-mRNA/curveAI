import SwiftUI

enum OnboardingStep: Int, CaseIterable, Codable, Identifiable {
    case invite
    case calendar
    case consent
    case jobs

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .invite:
            return "Invite"
        case .calendar:
            return "Calendar"
        case .consent:
            return "Voice"
        case .jobs:
            return "Jobs"
        }
    }

    var subtitle: String {
        switch self {
        case .invite:
            return "Verify the staff member."
        case .calendar:
            return "Connect Outlook."
        case .consent:
            return "Record voice consent."
        case .jobs:
            return "Review the live queue."
        }
    }

    var symbolName: String {
        switch self {
        case .invite:
            return "person.badge.key"
        case .calendar:
            return "calendar.badge.plus"
        case .consent:
            return "waveform.circle"
        case .jobs:
            return "note.text"
        }
    }
}

struct StaffOnboardingDraft: Codable, Equatable {
    var staffName: String
    var phoneNumber: String
    var inviteCode: String
    var otpCode: String
    var outlookEmail: String
    var calendarName: String
    var consentAcknowledged: Bool
    var voiceSampleLabel: String

    static let preview = StaffOnboardingDraft(
        staffName: "Jordan",
        phoneNumber: "+61 4 1234 5678",
        inviteCode: "TRD-2048",
        otpCode: "846219",
        outlookEmail: "jordan@tradieco.com",
        calendarName: "Jordan - TradieAI",
        consentAcknowledged: false,
        voiceSampleLabel: "Quiet office sample"
    )
}

struct OTPVerificationRequest: Codable, Equatable {
    let inviteToken: String
    let otpCode: String
}

struct StaffSession: Codable, Equatable {
    let staffID: String
    let displayName: String
    let accessToken: String
    let expiresAt: String?
}

struct CalendarConnectRequest: Codable, Equatable {
    let staffID: String
    let outlookEmail: String
    let calendarName: String
}

struct CalendarConnectionStatus: Codable, Equatable {
    let connected: Bool
    let provider: String
    let calendarName: String
    let accountEmail: String
}

struct VoiceConsentSubmission: Codable, Equatable {
    let staffID: String
    let consented: Bool
    let sampleLabel: String
    let signedBy: String
}

struct VoiceConsentReceipt: Codable, Equatable {
    let consented: Bool
    let sampleLabel: String
    let recordedAt: String
}

struct TradiePhoto: Codable, Equatable, Identifiable {
    let id: String
    let caption: String
    let tint: String
}

struct TradieJob: Codable, Equatable, Identifiable {
    let id: String
    let customerName: String
    let customerInitials: String
    let phoneNumber: String
    let addressLine: String
    let suburb: String
    let proposedQuote: String
    let quoteConfidence: String
    let nextAction: String
    let notes: String
    let photos: [TradiePhoto]
    let locationSummary: String

    static let sampleJobs: [TradieJob] = [
        TradieJob(
            id: "job-101",
            customerName: "Mia Thompson",
            customerInitials: "MT",
            phoneNumber: "+61 412 555 019",
            addressLine: "14 Clarence Street",
            suburb: "Marrickville NSW",
            proposedQuote: "$680",
            quoteConfidence: "High confidence",
            nextAction: "Send upload link and confirm onsite time",
            notes: "Leaking laundry tap, likely washer replacement with minor fitting adjustment.",
            photos: [
                TradiePhoto(id: "photo-1", caption: "Leak under sink", tint: "indigo"),
                TradiePhoto(id: "photo-2", caption: "Valve close-up", tint: "cyan"),
                TradiePhoto(id: "photo-3", caption: "Location shot", tint: "teal")
            ],
            locationSummary: "8 min drive"
        ),
        TradieJob(
            id: "job-102",
            customerName: "Alex Rivera",
            customerInitials: "AR",
            phoneNumber: "+61 409 123 456",
            addressLine: "22 King Lane",
            suburb: "Newtown NSW",
            proposedQuote: "$420",
            quoteConfidence: "Medium confidence",
            nextAction: "Review photos before final quote",
            notes: "Blocked bathroom drain with intermittent overflow from shower grate.",
            photos: [
                TradiePhoto(id: "photo-4", caption: "Drain grate", tint: "orange"),
                TradiePhoto(id: "photo-5", caption: "Bathroom floor", tint: "pink")
            ],
            locationSummary: "14 min drive"
        )
    ]
}

struct SurfaceCard<Content: View>: View {
    let title: String
    let subtitle: String?
    let content: Content

    init(title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.thinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(.white.opacity(0.18))
        )
        .shadow(color: .black.opacity(0.08), radius: 18, x: 0, y: 10)
    }
}

struct MetricPill: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.indigo.opacity(0.08))
        )
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.largeTitle.bold())
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

struct StepRail: View {
    let steps: [OnboardingStep]
    let currentStep: OnboardingStep
    let completedSteps: Set<OnboardingStep>

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(steps) { step in
                VStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(step == currentStep ? Color.indigo.opacity(0.18) : Color.black.opacity(0.05))
                            .frame(width: 54, height: 54)

                        Image(systemName: completedSteps.contains(step) ? "checkmark" : step.symbolName)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(step == currentStep ? .indigo : .secondary)
                    }

                    Text(step.title)
                        .font(.caption.weight(.semibold))
                    Text(step.subtitle)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .frame(width: 74)
                }
            }
        }
    }
}
