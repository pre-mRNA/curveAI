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

export type JobStatus = "new" | "quoted" | "scheduled" | "callback" | "closed";
export type DashboardJobStatus = "new" | "quoted" | "booked" | "needs_follow_up" | "completed";
export type CallbackTaskStatus = "open" | "queued" | "done" | "cancelled";
export type DashboardCallbackStatus = "queued" | "contacted" | "closed";
export type QuoteStatus = "draft" | "presented" | "accepted" | "rejected";
export type AppointmentStatus = "proposed" | "booked" | "rescheduled" | "cancelled";
export type ExperimentVariant = "control" | "dynamic-low" | "dynamic-high";

export interface JobLocation {
  label?: string;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
}

export interface JobPhoto {
  id: string;
  jobId: string;
  filename: string;
  url?: string;
  caption?: string;
  mimeType?: string;
  objectKey?: string;
  uploadedAt: string;
}

export interface QuoteRecord {
  id: string;
  jobId: string;
  staffId?: string;
  amount: number;
  currency: string;
  variant: ExperimentVariant;
  basePrice: number;
  strategyAdjustment: number;
  experimentAdjustment: number;
  floorPrice: number;
  ceilingPrice: number;
  confidence: number;
  status: QuoteStatus;
  rationale: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentRecord {
  id: string;
  jobId: string;
  staffId?: string;
  status: AppointmentStatus;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  location?: string;
  notes?: string;
  outlookEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallbackTaskRecord {
  id: string;
  jobId?: string;
  staffId?: string;
  status: CallbackTaskStatus;
  reason?: string;
  dueAt?: string;
  phoneNumber?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallRecord {
  id: string;
  staffId?: string;
  callerPhone?: string;
  direction: "inbound" | "outbound";
  status: "received" | "in_progress" | "completed" | "callback_requested" | "transferred" | "abandoned";
  transcript?: string;
  summary?: string;
  disposition?: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  staffId?: string;
  callerId?: string;
  callerName?: string;
  callerPhone?: string;
  callerEmail?: string;
  address?: string;
  location?: JobLocation;
  issue?: string;
  summary?: string;
  status: JobStatus;
  quote?: QuoteRecord;
  appointment?: AppointmentRecord;
  callbackTask?: CallbackTaskRecord;
  photos: JobPhoto[];
  calls: CallRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface JobCardEnvelope {
  job: JobRecord;
  staff?: StaffProfileSummary;
  quotes: QuoteRecord[];
  photos: JobPhoto[];
  calls: CallRecord[];
}

export interface DashboardPhoto {
  id: string;
  url: string;
  caption: string;
}

export interface DashboardQuote {
  basePrice: number;
  strategyAdjustment: number;
  experimentAdjustment: number;
  presentedPrice: number;
  confidence: "low" | "medium" | "high";
}

export interface DashboardCallback {
  id: string;
  customerName: string;
  phone: string;
  reason: string;
  status: DashboardCallbackStatus;
  dueAt: string;
}

export interface DashboardJob {
  id: string;
  customerName: string;
  suburb: string;
  summary: string;
  status: DashboardJobStatus;
  photos: DashboardPhoto[];
  quote: DashboardQuote;
  callback?: DashboardCallback | null;
  updatedAt: string;
}

export interface DashboardExperiment {
  name: string;
  variant: ExperimentVariant;
  exposure: string;
  lift: string;
  sampleSize: number;
}

export interface DashboardPayload {
  jobs: DashboardJob[];
  callbacks: DashboardCallback[];
  experiments: DashboardExperiment[];
}

export interface StaffProfileSummary {
  id: string;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  timezone?: string;
  companyName?: string;
  calendarProvider?: string;
  outlookCalendarId?: string;
  voiceCloneId?: string;
  updatedAt?: string;
}

export interface UploadRequestRecord {
  token: string;
  jobId: string;
  staffId?: string;
  callerPhone?: string;
  notes?: string;
  uploadLink: string;
  status: "pending" | "completed" | "expired";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  fileCount: number;
  files: JobPhoto[];
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
