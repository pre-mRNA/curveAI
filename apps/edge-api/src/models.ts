export type CoverageStatus = "pending" | "covered" | "needs_follow_up";
export type OnboardingSessionStatus =
  | "pending"
  | "interviewing"
  | "review"
  | "calendar"
  | "voice_sample"
  | "completed";
export type InterviewSpeaker = "agent" | "participant" | "system";
export type ProviderMode = "mock" | "configured";

export interface InviteRecord {
  id: string;
  code: string;
  staffId: string;
  fullName: string;
  email?: string;
  phoneNumber?: string;
  role?: string;
  status: "pending" | "started" | "completed" | "expired";
  createdAt: string;
  expiresAt: string;
  sessionId?: string;
}

export interface CoverageItem {
  id: string;
  section: string;
  title: string;
  prompt: string;
  status: CoverageStatus;
  evidence: string[];
}

export interface SupervisorPrompt {
  id: string;
  section: string;
  reason: string;
  question: string;
}

export interface OnboardingAnalysis {
  coverage: CoverageItem[];
  recommendedQuestions: SupervisorPrompt[];
  coverageScore: number;
  interviewerBrief: string;
}

export interface CommunicationProfile {
  tone: string;
  salesStyle: string;
  riskTolerance: string;
  customerHandlingRules: string[];
}

export interface PricingProfileSummary {
  quotingStyle: string;
  calloutPolicy: string;
  afterHoursPolicy: string;
  approvalThreshold: string;
}

export interface BusinessPracticeProfile {
  services: string[];
  serviceAreas: string[];
  operatingHours: string;
  exclusions: string[];
  escalationRules: string[];
}

export interface CRMDiscoveryProfile {
  currentSystem: string;
  syncPreference: string;
  sourceOfTruth: string;
  notes: string[];
}

export interface StaffProfile {
  staffName: string;
  companyName: string;
  role: string;
  calendarProvider: string;
}

export interface ExtractionReview {
  businessSummary: string;
  staffProfile: StaffProfile;
  communicationProfile: CommunicationProfile;
  pricingProfile: PricingProfileSummary;
  businessPractices: BusinessPracticeProfile;
  crmDiscovery: CRMDiscoveryProfile;
  missingFields: string[];
}

export interface InterviewTurn {
  id: string;
  speaker: InterviewSpeaker;
  text: string;
  questionId?: string;
  createdAt: string;
}

export interface RealtimeVoiceSession {
  provider: string;
  mode: ProviderMode;
  sessionToken: string;
  interviewerModel: string;
  supervisorModel: string;
  websocketUrl?: string;
  expiresAt: string;
}

export interface CalendarConnectionSummary {
  provider: string;
  mode: ProviderMode;
  status: "pending" | "connected";
  authUrl?: string;
  authState?: string;
  accountEmail?: string;
  calendarLabel?: string;
  connectedAt?: string;
}

export interface VoiceSampleAssessment {
  sampleLabel: string;
  recommendedForClone: boolean;
  qualityScore: number;
  reasons: string[];
  durationSeconds: number;
  originalName?: string;
  storedPath?: string;
  mimeType?: string;
  capturedAt: string;
}

export interface OnboardingSessionRecord {
  id: string;
  inviteId: string;
  inviteCode: string;
  staffId: string;
  staffName: string;
  participantTokenHash: string;
  expiresAt: string;
  status: OnboardingSessionStatus;
  consentAccepted: boolean;
  cloneConsentAccepted: boolean;
  createdAt: string;
  updatedAt: string;
  analysis: OnboardingAnalysis;
  review: ExtractionReview;
  voiceSession?: RealtimeVoiceSession;
  calendar?: CalendarConnectionSummary;
  voiceSample?: VoiceSampleAssessment;
  finalizedAt?: string;
}

export interface OnboardingSessionSummary {
  id: string;
  inviteCode: string;
  status: OnboardingSessionStatus;
  staffId: string;
  staffName: string;
  participantToken: string;
  expiresAt: string;
  consentAccepted: boolean;
  cloneConsentAccepted: boolean;
  coverageScore: number;
  nextQuestion: SupervisorPrompt | null;
  review: ExtractionReview;
  analysis: OnboardingAnalysis;
  voiceSession?: RealtimeVoiceSession;
  calendar?: CalendarConnectionSummary;
  voiceSample?: VoiceSampleAssessment;
  turns: InterviewTurn[];
  updatedAt: string;
}

export interface OnboardingChecklistPrompt {
  id: string;
  section: string;
  title: string;
  prompt: string;
}

export interface DashboardPayload {
  jobs: unknown[];
  callbacks: unknown[];
  experiments: unknown[];
}

export function createDefaultReview(fullName?: string, role?: string): ExtractionReview {
  return {
    businessSummary: fullName ? `${fullName} onboarding has started.` : "Onboarding interview in progress.",
    staffProfile: {
      staffName: fullName ?? "",
      companyName: "",
      role: role ?? "",
      calendarProvider: "Microsoft",
    },
    communicationProfile: {
      tone: "Professional and calm",
      salesStyle: "Consultative",
      riskTolerance: "Escalate uncertain quotes",
      customerHandlingRules: ["Confirm scope before presenting a firm quote."],
    },
    pricingProfile: {
      quotingStyle: "Quote after qualification",
      calloutPolicy: "Callout fee not confirmed yet",
      afterHoursPolicy: "After-hours policy not confirmed yet",
      approvalThreshold: "Escalate larger jobs for approval",
    },
    businessPractices: {
      services: [],
      serviceAreas: [],
      operatingHours: "Working hours not confirmed yet",
      exclusions: [],
      escalationRules: [],
    },
    crmDiscovery: {
      currentSystem: "Unknown",
      syncPreference: "Undecided",
      sourceOfTruth: "Undecided",
      notes: [],
    },
    missingFields: [],
  };
}

export function createDefaultAnalysis(): OnboardingAnalysis {
  return {
    coverage: [],
    recommendedQuestions: [],
    coverageScore: 0,
    interviewerBrief: "Start with business scope and service area before probing pricing.",
  };
}

export function normalizeReview(review: Partial<ExtractionReview> | undefined, fullName?: string, role?: string): ExtractionReview {
  const defaults = createDefaultReview(fullName, role);
  return {
    ...defaults,
    ...review,
    staffProfile: {
      ...defaults.staffProfile,
      ...(review?.staffProfile ?? {}),
    },
    communicationProfile: {
      ...defaults.communicationProfile,
      ...(review?.communicationProfile ?? {}),
    },
    pricingProfile: {
      ...defaults.pricingProfile,
      ...(review?.pricingProfile ?? {}),
    },
    businessPractices: {
      ...defaults.businessPractices,
      ...(review?.businessPractices ?? {}),
    },
    crmDiscovery: {
      ...defaults.crmDiscovery,
      ...(review?.crmDiscovery ?? {}),
    },
    missingFields: Array.isArray(review?.missingFields) ? review.missingFields : defaults.missingFields,
  };
}
