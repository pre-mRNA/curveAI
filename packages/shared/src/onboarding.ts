import { z } from "zod";

export const coverageStatusSchema = z.enum(["pending", "covered", "needs_follow_up"]);
export const onboardingSessionStatusSchema = z.enum([
  "pending",
  "interviewing",
  "review",
  "calendar",
  "voice_sample",
  "completed",
]);
export const interviewSpeakerSchema = z.enum(["agent", "participant", "system"]);
export const onboardingProviderModeSchema = z.enum(["mock", "configured"]);

export const checklistItemSchema = z.object({
  id: z.string(),
  section: z.string(),
  title: z.string(),
  prompt: z.string(),
  status: coverageStatusSchema,
  evidence: z.array(z.string()).default([]),
});

export const onboardingChecklistPromptSchema = z.object({
  id: z.string(),
  section: z.string(),
  title: z.string(),
  prompt: z.string(),
});

export const interviewTurnSchema = z.object({
  id: z.string(),
  speaker: interviewSpeakerSchema,
  text: z.string(),
  questionId: z.string().optional(),
  createdAt: z.string(),
});

export const communicationProfileSchema = z.object({
  tone: z.string(),
  salesStyle: z.string(),
  riskTolerance: z.string(),
  customerHandlingRules: z.array(z.string()),
});

export const pricingProfileSummarySchema = z.object({
  quotingStyle: z.string(),
  calloutPolicy: z.string(),
  afterHoursPolicy: z.string(),
  approvalThreshold: z.string(),
});

export const businessPracticeProfileSchema = z.object({
  services: z.array(z.string()),
  serviceAreas: z.array(z.string()),
  operatingHours: z.string(),
  exclusions: z.array(z.string()),
  escalationRules: z.array(z.string()),
});

export const crmDiscoveryProfileSchema = z.object({
  currentSystem: z.string(),
  syncPreference: z.string(),
  sourceOfTruth: z.string(),
  notes: z.array(z.string()),
});

export const onboardingStaffProfileSchema = z.object({
  staffName: z.string(),
  companyName: z.string(),
  role: z.string(),
  calendarProvider: z.string(),
});

export const extractionReviewSchema = z.object({
  businessSummary: z.string(),
  staffProfile: onboardingStaffProfileSchema,
  communicationProfile: communicationProfileSchema,
  pricingProfile: pricingProfileSummarySchema,
  businessPractices: businessPracticeProfileSchema,
  crmDiscovery: crmDiscoveryProfileSchema,
  missingFields: z.array(z.string()),
});

export const supervisorPromptSchema = z.object({
  id: z.string(),
  question: z.string(),
  reason: z.string(),
  section: z.string(),
});

export const onboardingAnalysisSchema = z.object({
  coverage: z.array(checklistItemSchema),
  recommendedQuestions: z.array(supervisorPromptSchema),
  coverageScore: z.number().min(0).max(1),
  interviewerBrief: z.string(),
});

export const realtimeVoiceSessionSchema = z.object({
  provider: z.string(),
  mode: onboardingProviderModeSchema,
  sessionToken: z.string(),
  interviewerModel: z.string(),
  supervisorModel: z.string(),
  websocketUrl: z.string().optional(),
  expiresAt: z.string(),
});

export const calendarConnectionSummarySchema = z.object({
  provider: z.string(),
  mode: onboardingProviderModeSchema,
  status: z.enum(["pending", "connected"]),
  authUrl: z.string().optional(),
  authState: z.string().optional(),
  accountEmail: z.string().optional(),
  calendarLabel: z.string().optional(),
  connectedAt: z.string().optional(),
});

export const voiceSampleAssessmentSchema = z.object({
  sampleLabel: z.string(),
  recommendedForClone: z.boolean(),
  qualityScore: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  durationSeconds: z.number(),
  originalName: z.string().optional(),
  storedPath: z.string().optional(),
  mimeType: z.string().optional(),
  capturedAt: z.string(),
});

export const onboardingSessionSummarySchema = z.object({
  id: z.string(),
  inviteCode: z.string(),
  status: onboardingSessionStatusSchema,
  staffId: z.string(),
  staffName: z.string(),
  participantToken: z.string().optional(),
  expiresAt: z.string(),
  consentAccepted: z.boolean(),
  cloneConsentAccepted: z.boolean(),
  coverageScore: z.number().min(0).max(1),
  nextQuestion: supervisorPromptSchema.nullable(),
  review: extractionReviewSchema,
  analysis: onboardingAnalysisSchema,
  voiceSession: realtimeVoiceSessionSchema.optional(),
  calendar: calendarConnectionSummarySchema.optional(),
  voiceSample: voiceSampleAssessmentSchema.optional(),
  turns: z.array(interviewTurnSchema),
  updatedAt: z.string(),
});

export const onboardingSessionEnvelopeSchema = z.object({
  session: onboardingSessionSummarySchema,
  checklist: z.array(onboardingChecklistPromptSchema).optional(),
});

export const onboardingReviewEnvelopeSchema = z.object({
  review: extractionReviewSchema,
  analysis: onboardingAnalysisSchema,
  status: onboardingSessionStatusSchema,
});

export const onboardingNextQuestionEnvelopeSchema = z.object({
  nextQuestion: supervisorPromptSchema.nullable(),
  interviewerBrief: z.string(),
  coverageScore: z.number().min(0).max(1).optional(),
});

export const onboardingCalendarStartResponseSchema = z.object({
  calendar: calendarConnectionSummarySchema.optional(),
  session: onboardingSessionSummarySchema,
});

export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type OnboardingSessionStatus = z.infer<typeof onboardingSessionStatusSchema>;
export type InterviewSpeaker = z.infer<typeof interviewSpeakerSchema>;
export type OnboardingProviderMode = z.infer<typeof onboardingProviderModeSchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type OnboardingChecklistPrompt = z.infer<typeof onboardingChecklistPromptSchema>;
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;
export type CommunicationProfile = z.infer<typeof communicationProfileSchema>;
export type PricingProfileSummary = z.infer<typeof pricingProfileSummarySchema>;
export type BusinessPracticeProfile = z.infer<typeof businessPracticeProfileSchema>;
export type CRMDiscoveryProfile = z.infer<typeof crmDiscoveryProfileSchema>;
export type OnboardingStaffProfile = z.infer<typeof onboardingStaffProfileSchema>;
export type ExtractionReview = z.infer<typeof extractionReviewSchema>;
export type SupervisorPrompt = z.infer<typeof supervisorPromptSchema>;
export type OnboardingAnalysis = z.infer<typeof onboardingAnalysisSchema>;
export type RealtimeVoiceSession = z.infer<typeof realtimeVoiceSessionSchema>;
export type CalendarConnectionSummary = z.infer<typeof calendarConnectionSummarySchema>;
export type VoiceSampleAssessment = z.infer<typeof voiceSampleAssessmentSchema>;
export type OnboardingSessionSummary = z.infer<typeof onboardingSessionSummarySchema>;
export type OnboardingSessionEnvelope = z.infer<typeof onboardingSessionEnvelopeSchema>;
export type OnboardingReviewEnvelope = z.infer<typeof onboardingReviewEnvelopeSchema>;
export type OnboardingNextQuestionEnvelope = z.infer<typeof onboardingNextQuestionEnvelopeSchema>;
export type OnboardingCalendarStartResponse = z.infer<typeof onboardingCalendarStartResponseSchema>;
