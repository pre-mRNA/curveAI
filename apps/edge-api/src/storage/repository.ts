import type {
  DashboardPayload,
  InterviewTurn,
  InviteRecord,
  OnboardingSessionRecord,
} from "../models.js";

export interface StaffProfileUpsertInput {
  staffId: string;
  fullName: string;
  role?: string;
  companyName?: string;
  calendarProvider?: string;
  communication: unknown;
  pricing: unknown;
  business: unknown;
  crm: unknown;
  updatedAt: string;
}

export interface VoiceConsentRecordInput {
  staffId: string;
  consent: boolean;
  signedBy?: string;
  capturedAt: string;
}

export interface PricingInterviewRecordInput {
  staffId: string;
  responses: Record<string, unknown>;
  capturedAt: string;
}

export interface OnboardingRepository {
  getDashboard(): Promise<DashboardPayload>;
  createInvite(invite: InviteRecord): Promise<void>;
  saveInvite(invite: InviteRecord): Promise<void>;
  getInviteByCode(code: string): Promise<InviteRecord | undefined>;
  getInviteById(id: string): Promise<InviteRecord | undefined>;
  saveSession(session: OnboardingSessionRecord): Promise<void>;
  getSessionById(id: string): Promise<OnboardingSessionRecord | undefined>;
  getSessionByCalendarState(state: string): Promise<OnboardingSessionRecord | undefined>;
  appendTurn(sessionId: string, turn: InterviewTurn): Promise<void>;
  listTurns(sessionId: string): Promise<InterviewTurn[]>;
  upsertStaffProfile(input: StaffProfileUpsertInput): Promise<void>;
  recordVoiceConsent(input: VoiceConsentRecordInput): Promise<void>;
  savePricingInterview(input: PricingInterviewRecordInput): Promise<void>;
}
