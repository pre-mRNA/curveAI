import type {
  AiTestCaseRecord,
  AiTestRunRecord,
  AppointmentRecord,
  CalendarConnectionRecord,
  CallbackTaskRecord,
  CallRecord,
  DashboardPayload,
  DashboardExperiment,
  InterviewTurn,
  InviteRecord,
  JobCardEnvelope,
  JobPhoto,
  JobRecord,
  QuoteRecord,
  OnboardingSessionRecord,
  StaffRecord,
  StaffSessionRecord,
  StaffProfileSummary,
  UploadRequestRecord,
} from "../models.js";

export interface StaffProfileUpsertInput {
  staffId: string;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  companyName?: string;
  calendarProvider?: string;
  timezone?: string;
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

export interface JobUpsertInput extends Partial<JobRecord> {
  id: string;
}

export interface QuoteUpsertInput extends Partial<QuoteRecord> {
  jobId: string;
  amount: number;
  currency: string;
}

export interface AppointmentUpsertInput extends Partial<AppointmentRecord> {
  jobId: string;
}

export interface CallbackUpsertInput extends Partial<CallbackTaskRecord> {
  jobId?: string;
}

export interface CallUpsertInput extends Partial<CallRecord> {
  jobId?: string;
}

export interface UploadRequestInput {
  token?: string;
  jobId?: string;
  staffId?: string;
  callerPhone?: string;
  notes?: string;
  uploadLink: string;
  expiresAt: string;
}

export interface StaffInviteInput {
  staffId: string;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  timezone?: string;
  inviteTokenHash: string;
  otpCodeHash: string;
  otpIssuedAt: string;
  otpFailedAttempts: number;
  authExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffAuthStateInput {
  staffId: string;
  inviteTokenHash?: string;
  otpCodeHash?: string;
  otpIssuedAt?: string;
  otpFailedAttempts?: number;
  otpVerifiedAt?: string;
  authExpiresAt?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface StaffSessionInput extends StaffSessionRecord {}

export interface StaffCalendarConnectionInput extends CalendarConnectionRecord {
  staffId: string;
  updatedAt: string;
}

export interface OnboardingRepository {
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
  getStaff(staffId: string): Promise<StaffRecord | undefined>;
  findStaffByInviteTokenHash(inviteTokenHash: string): Promise<StaffRecord | undefined>;
  saveStaffInvite(input: StaffInviteInput): Promise<StaffRecord>;
  saveStaffAuthState(input: StaffAuthStateInput): Promise<StaffRecord | undefined>;
  createStaffSession(input: StaffSessionInput): Promise<void>;
  getStaffSession(tokenHash: string): Promise<StaffSessionRecord | undefined>;
  saveStaffCalendarConnection(input: StaffCalendarConnectionInput): Promise<CalendarConnectionRecord>;
  listJobs(staffId?: string): Promise<JobRecord[]>;
  getJobCard(jobId: string): Promise<JobCardEnvelope | undefined>;
  listCallbacks(staffId?: string): Promise<CallbackTaskRecord[]>;
  listExperiments(): Promise<DashboardExperiment[]>;
  ensureJob(input: JobUpsertInput): Promise<JobRecord>;
  upsertQuote(input: QuoteUpsertInput): Promise<QuoteRecord>;
  upsertAppointment(input: AppointmentUpsertInput): Promise<AppointmentRecord>;
  upsertCallback(input: CallbackUpsertInput): Promise<CallbackTaskRecord>;
  recordCall(input: CallUpsertInput): Promise<CallRecord>;
  createUploadRequest(input: UploadRequestInput): Promise<UploadRequestRecord>;
  getUploadRequest(token: string): Promise<UploadRequestRecord | undefined>;
  completeUploadRequest(token: string, photos: JobPhoto[]): Promise<UploadRequestRecord | undefined>;
  getPhotoAsset(photoId: string): Promise<JobPhoto | undefined>;
  listAiTestCases(): Promise<AiTestCaseRecord[]>;
  getAiTestCase(id: string): Promise<AiTestCaseRecord | undefined>;
  getAiTestCaseBySlug(slug: string): Promise<AiTestCaseRecord | undefined>;
  saveAiTestCase(testCase: AiTestCaseRecord): Promise<void>;
  listAiTestRuns(caseId?: string): Promise<AiTestRunRecord[]>;
  getAiTestRun(id: string): Promise<AiTestRunRecord | undefined>;
  saveAiTestRun(run: AiTestRunRecord): Promise<void>;
}
