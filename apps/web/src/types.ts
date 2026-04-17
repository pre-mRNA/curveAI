export type OnboardingStep = 'consent' | 'interview' | 'review' | 'calendar' | 'voice_sample' | 'finalize' | 'complete';

export type OnboardingStatus =
  | 'pending'
  | 'active'
  | 'review_ready'
  | 'calendar_ready'
  | 'voice_ready'
  | 'ready_to_finalize'
  | 'complete';

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
  calendarStatus?: 'pending' | 'connected' | 'error';
  calendarMode?: 'mock' | 'configured';
  calendarError?: string;
  voiceSampleUploaded: boolean;
  updatedAt: string;
}

export interface OnboardingSessionStartResponse {
  session: OnboardingSession;
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

export interface OnboardingReviewSaveResponse {
  review: OnboardingReview;
  session: OnboardingSession;
}

export interface CalendarConnectResponse {
  authorizationUrl?: string;
  connected?: boolean;
  provider?: 'microsoft';
  accountEmail?: string;
  status?: 'pending' | 'connected' | 'error';
  mode?: 'mock' | 'configured';
  message?: string;
  session?: OnboardingSession;
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
