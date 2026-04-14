export type JobStatus = 'new' | 'quoted' | 'booked' | 'needs_follow_up' | 'completed';

export type CallbackStatus = 'queued' | 'contacted' | 'closed';

export type PricingExperimentVariant = 'control' | 'dynamic-low' | 'dynamic-high';

export type OnboardingStep = 'consent' | 'interview' | 'review' | 'calendar' | 'voice_sample' | 'finalize' | 'complete';

export type OnboardingStatus =
  | 'invited'
  | 'pending'
  | 'active'
  | 'review_ready'
  | 'calendar_ready'
  | 'voice_ready'
  | 'ready_to_finalize'
  | 'complete'
  | 'blocked';

export interface OnboardingConsentPayload {
  recordingConsent: boolean;
  voiceCloneConsent: boolean;
  dataProcessingConsent: boolean;
}

export interface InterviewTurn {
  id: string;
  speaker: 'staff' | 'interviewer' | 'supervisor';
  text: string;
  createdAt: string;
}

export interface OnboardingSession {
  id: string;
  inviteCode: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  currentQuestion: string;
  transcript: InterviewTurn[];
  summary: string;
  staffName: string;
  companyName: string;
  calendarConnected: boolean;
  voiceSampleUploaded: boolean;
  updatedAt: string;
}

export interface OnboardingSessionStartResponse {
  session: OnboardingSession;
  sessionToken: string;
}

export interface OnboardingSessionTokenResponse {
  token: string;
  realtimeToken?: string;
  expiresAt?: string;
}

export interface OnboardingTurnPayload {
  text: string;
  transcriptFormat?: 'typed' | 'voice_transcript';
}

export interface OnboardingNextQuestionResponse {
  question: string;
  focus?: string;
}

export interface OnboardingReviewChecklistItem {
  label: string;
  status: 'done' | 'partial' | 'missing';
  notes?: string | null;
}

export interface OnboardingReviewProfile {
  staffName: string;
  companyName: string;
  role: string;
  serviceArea: string;
  services: string;
  hours: string;
  pricingPreference: string;
  communicationStyle: string;
  salesStyle: string;
  riskTolerance: string;
  escalationRules: string;
  exclusions: string;
  calendarProvider: string;
  crmProvider: string;
}

export interface OnboardingReview {
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  missingItems: string[];
  checklist: OnboardingReviewChecklistItem[];
  profile: Partial<OnboardingReviewProfile>;
}

export interface OnboardingReviewUpdate extends Partial<OnboardingReviewProfile> {
  summary?: string;
  confidence?: 'low' | 'medium' | 'high';
  missingItems?: string[];
}

export interface CalendarConnectResponse {
  authorizationUrl?: string;
  redirectUrl?: string;
  url?: string;
  connected?: boolean;
  provider?: 'microsoft';
  accountEmail?: string;
}

export interface VoiceSampleUploadResponse {
  uploaded: boolean;
  sampleId?: string;
  recommendedForClone?: boolean;
  qualityScore?: number;
  reasons?: string[];
}

export interface OnboardingFinalizeResponse {
  status: 'complete' | 'pending';
  staffId?: string;
  summary?: string;
}

export interface PhotoAsset {
  id: string;
  url: string;
  caption: string;
}

export interface CallbackTask {
  id: string;
  customerName: string;
  phone: string;
  reason: string;
  status: CallbackStatus;
  dueAt: string;
}

export interface QuoteState {
  basePrice: number;
  strategyAdjustment: number;
  experimentAdjustment: number;
  presentedPrice: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface JobSummary {
  id: string;
  customerName: string;
  suburb: string;
  summary: string;
  status: JobStatus;
  photos: PhotoAsset[];
  quote: QuoteState;
  callback?: CallbackTask | null;
  updatedAt: string;
}

export interface PricingExperiment {
  name: string;
  variant: PricingExperimentVariant;
  exposure: string;
  lift: string;
  sampleSize: number;
}

export interface DashboardPayload {
  jobs: JobSummary[];
  callbacks: CallbackTask[];
  experiments: PricingExperiment[];
}
