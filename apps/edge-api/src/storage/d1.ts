import {
  type AiTestCaseRecord,
  type AiTestJudgeResultRecord,
  type AiTestPromptSnapshot,
  type AiTestRunRecord,
  type AiTestRunnerResultRecord,
  type AiTestSuccessCriterionRecord,
  type AppointmentRecord,
  type CalendarConnectionRecord,
  type CallbackTaskRecord,
  type CallRecord,
  type DashboardExperiment,
  type DashboardPayload,
  type InterviewTurn,
  type InviteRecord,
  type JobCardEnvelope,
  type JobLocation,
  type JobPhoto,
  type JobRecord,
  type OnboardingAnalysis,
  type OnboardingSessionRecord,
  type PricingInterviewRecord,
  type PricingProfileRecord,
  type QuoteRecord,
  type StaffRecord,
  type StaffSessionRecord,
  type StaffProfileSummary,
  type UploadRequestRecord,
  type VoiceSampleAssessment,
} from "../models.js";
import { createDefaultAnalysis, normalizeReview } from "../models.js";
import { sha256Hex } from "../crypto.js";
import type {
  AppointmentUpsertInput,
  StaffCalendarConnectionInput,
  StaffAuthStateInput,
  CallbackUpsertInput,
  CallUpsertInput,
  JobUpsertInput,
  OnboardingRepository,
  PricingInterviewRecordInput,
  QuoteUpsertInput,
  StaffInviteInput,
  StaffSessionInput,
  StaffProfileUpsertInput,
  UploadRequestInput,
  VoiceConsentRecordInput,
} from "./repository.js";

interface InviteRow {
  id: string;
  code: string;
  staff_id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  role: string | null;
  status: InviteRecord["status"];
  created_at: string;
  expires_at: string;
  session_id: string | null;
}

interface SessionRow {
  id: string;
  invite_id: string;
  invite_code: string;
  staff_id: string;
  staff_name: string;
  participant_token_hash: string;
  expires_at: string;
  status: OnboardingSessionRecord["status"];
  consent_accepted: number;
  clone_consent_accepted: number;
  created_at: string;
  updated_at: string;
  analysis_json: string;
  review_json: string;
  voice_session_json: string | null;
  calendar_json: string | null;
  voice_sample_json: string | null;
  finalized_at: string | null;
}

interface TurnRow {
  id: string;
  speaker: InterviewTurn["speaker"];
  text: string;
  question_id: string | null;
  created_at: string;
}

interface StaffProfileRow {
  staff_id: string;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  role: string | null;
  timezone: string | null;
  company_name: string | null;
  calendar_provider: string | null;
  created_at: string | null;
  updated_at: string;
}

interface StaffAuthRow {
  staff_id: string;
  invite_token_hash: string | null;
  otp_code_hash: string | null;
  otp_issued_at: string | null;
  otp_failed_attempts: number;
  otp_verified_at: string | null;
  auth_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StaffSessionRow {
  token_hash: string;
  staff_id: string;
  created_at: string;
  expires_at: string;
}

interface StaffCalendarConnectionRow {
  staff_id: string;
  provider: "outlook";
  account_email: string | null;
  calendar_id: string | null;
  timezone: string | null;
  external_connection_id: string | null;
  connected_at: string;
  updated_at: string;
}

interface VoiceConsentRow {
  consent: number;
  captured_at: string;
}

interface PricingInterviewRow {
  responses_json: string;
  captured_at: string;
}

interface JobRow {
  id: string;
  staff_id: string | null;
  caller_id: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  address: string | null;
  location_json: string | null;
  issue: string | null;
  summary: string | null;
  status: JobRecord["status"];
  quote_json: string | null;
  appointment_json: string | null;
  callback_json: string | null;
  photos_json: string | null;
  calls_json: string | null;
  proposed_next_action: string | null;
  created_at: string;
  updated_at: string;
}

interface QuoteRow {
  id: string;
  job_id: string;
  staff_id: string | null;
  variant: QuoteRecord["variant"];
  base_price: number;
  strategy_adjustment: number;
  experiment_adjustment: number;
  presented_price: number;
  floor_price: number;
  ceiling_price: number;
  confidence: number;
  status: QuoteRecord["status"];
  rationale_json: string;
  created_at: string;
  updated_at: string;
}

interface AppointmentRow {
  id: string;
  job_id: string;
  staff_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: AppointmentRecord["status"];
  calendar_event_id: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CallbackRow {
  id: string;
  job_id: string | null;
  staff_id: string | null;
  status: CallbackTaskRecord["status"];
  reason: string | null;
  due_at: string | null;
  phone_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CallRow {
  id: string;
  job_id: string | null;
  staff_id: string | null;
  caller_phone: string | null;
  direction: CallRecord["direction"];
  status: CallRecord["status"];
  transcript: string | null;
  summary: string | null;
  disposition: string | null;
  created_at: string;
  updated_at: string;
}

interface PhotoRow {
  id: string;
  job_id: string;
  upload_token: string | null;
  filename: string;
  object_key: string;
  mime_type: string | null;
  caption: string | null;
  uploaded_at: string;
}

interface UploadRequestRow {
  token: string;
  job_id: string;
  staff_id: string | null;
  caller_phone: string | null;
  notes: string | null;
  upload_link: string;
  status: UploadRequestRecord["status"];
  created_at: string;
  expires_at: string;
  completed_at: string | null;
  file_count: number;
}

interface ExperimentRow {
  id: string;
  name: string;
  variant: DashboardExperiment["variant"];
  exposure: string;
  lift: string;
  sample_size: number;
}

interface AiTestCaseRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: AiTestCaseRecord["status"];
  target: AiTestCaseRecord["target"];
  system_prompt: string | null;
  user_prompt: string;
  tags_json: string;
  success_criteria_json: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
}

interface AiTestRunRow {
  id: string;
  case_id: string;
  status: AiTestRunRecord["status"];
  operator_notes: string | null;
  prompt_snapshot_json: string;
  criteria_snapshot_json: string;
  runner_result_json: string | null;
  judge_result_json: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string;
  completed_at: string | null;
}

const dashboardExperiments: DashboardExperiment[] = [
  {
    name: "After-hours urgency premium",
    variant: "dynamic-high",
    exposure: "34%",
    lift: "+9% revenue",
    sampleSize: 148,
  },
  {
    name: "Short-job close-out discount",
    variant: "control",
    exposure: "48%",
    lift: "Baseline",
    sampleSize: 214,
  },
  {
    name: "Customer-acquired photo uplift",
    variant: "dynamic-low",
    exposure: "18%",
    lift: "+5% conversion",
    sampleSize: 93,
  },
];

function derivePricingProfile(responses: Record<string, unknown>): PricingProfileRecord {
  const numeric = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    baseCalloutFee: numeric(responses.baseCalloutFee, 180),
    minimumJobPrice: numeric(responses.minimumJobPrice, 160),
    hourlyRate: numeric(responses.hourlyRate, 145),
    rushMultiplier: numeric(responses.rushMultiplier, 1.35),
    complexityMultiplier: numeric(responses.complexityMultiplier, 1.2),
    confidenceFloor: numeric(responses.confidenceFloor, 0.68),
  };
}

function parseJson<T>(value: string | null | undefined, fallback?: T): T | undefined {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toInvite(row: InviteRow): InviteRecord {
  return {
    id: row.id,
    code: row.code,
    staffId: row.staff_id,
    fullName: row.full_name,
    email: row.email ?? undefined,
    phoneNumber: row.phone_number ?? undefined,
    role: row.role ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sessionId: row.session_id ?? undefined,
  };
}

function toSession(row: SessionRow): OnboardingSessionRecord {
  return {
    id: row.id,
    inviteId: row.invite_id,
    inviteCode: row.invite_code,
    staffId: row.staff_id,
    staffName: row.staff_name,
    participantTokenHash: row.participant_token_hash,
    expiresAt: row.expires_at,
    status: row.status,
    consentAccepted: Boolean(row.consent_accepted),
    cloneConsentAccepted: Boolean(row.clone_consent_accepted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    analysis: parseJson<OnboardingAnalysis>(row.analysis_json, createDefaultAnalysis()) ?? createDefaultAnalysis(),
    review: parseJson(row.review_json, normalizeReview(undefined)) ?? normalizeReview(undefined),
    voiceSession: parseJson(row.voice_session_json),
    calendar: parseJson(row.calendar_json),
    voiceSample: parseJson<VoiceSampleAssessment>(row.voice_sample_json),
    finalizedAt: row.finalized_at ?? undefined,
  };
}

function toJobLocation(value: JobLocation | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.label ?? value.suburb ?? value.address;
}

function defaultJobSummary(job: JobRecord): string {
  return job.summary ?? job.issue ?? "Awaiting call summary";
}

function toDashboardConfidence(confidence: number): DashboardPayload["jobs"][number]["quote"]["confidence"] {
  if (confidence >= 0.84) {
    return "high";
  }
  if (confidence >= 0.68) {
    return "medium";
  }
  return "low";
}

function toDashboardStatus(status: JobRecord["status"]): DashboardPayload["jobs"][number]["status"] {
  if (status === "scheduled") {
    return "booked";
  }
  if (status === "callback") {
    return "needs_follow_up";
  }
  if (status === "closed") {
    return "completed";
  }
  return status;
}

function toDashboardJob(job: JobRecord, photoUrl: (photo: JobPhoto) => string): DashboardPayload["jobs"][number] {
  const quote = job.quote ?? previewQuote(job);
  const callback = job.callbackTask ? toDashboardCallback(job.callbackTask, job) : null;
  return {
    id: job.id,
    customerName: job.callerName ?? "Unknown caller",
    suburb: job.location?.label ?? job.address ?? "Unknown suburb",
    summary: defaultJobSummary(job),
    status: toDashboardStatus(job.status),
    photos: job.photos.map((photo) => ({
      id: photo.id,
      url: photoUrl(photo),
      caption: photo.caption ?? photo.filename ?? "Job photo",
    })),
    quote: {
      basePrice: quote.basePrice,
      strategyAdjustment: quote.strategyAdjustment,
      experimentAdjustment: quote.experimentAdjustment,
      presentedPrice: quote.amount,
      confidence: toDashboardConfidence(quote.confidence),
    },
    callback,
    updatedAt: new Date(job.updatedAt).toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

function toDashboardCallback(callback: CallbackTaskRecord, job?: JobRecord): DashboardPayload["callbacks"][number] {
  return {
    id: callback.id,
    customerName: job?.callerName ?? "Pending caller",
    phone: callback.phoneNumber ?? job?.callerPhone ?? "Unknown phone",
    reason: callback.reason ?? "General follow-up",
    status: callback.status === "done" ? "closed" : callback.status === "open" ? "contacted" : "queued",
    dueAt:
      callback.dueAt == null
        ? "TBD"
        : new Date(callback.dueAt).toLocaleString("en-AU", {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          }),
  };
}

function previewQuote(job: JobRecord): QuoteRecord {
  const basePrice = Math.max(120, Math.round((job.summary?.length ?? 80) * 2));
  return {
    id: `preview-${job.id}`,
    jobId: job.id,
    staffId: job.staffId,
    variant: "control",
    amount: basePrice,
    currency: "AUD",
    basePrice,
    strategyAdjustment: 0,
    experimentAdjustment: 0,
    floorPrice: Math.max(90, basePrice - 60),
    ceilingPrice: basePrice + 120,
    confidence: 0.54,
    status: "draft",
    rationale: ["Preview quote generated from current job context."],
    createdAt: job.updatedAt,
    updatedAt: job.updatedAt,
  };
}

function redactUploadLink(uploadLink: string): string {
  try {
    const url = new URL(uploadLink);
    url.pathname = url.pathname.replace(/\/upload\/[^/]+$/u, "/upload/[redacted]");
    return url.toString();
  } catch {
    return "[redacted upload link]";
  }
}

function rowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    staffId: row.staff_id ?? undefined,
    callerId: row.caller_id ?? undefined,
    callerName: row.caller_name ?? undefined,
    callerPhone: row.caller_phone ?? undefined,
    callerEmail: row.caller_email ?? undefined,
    address: row.address ?? undefined,
    location: parseJson<JobLocation>(row.location_json),
    issue: row.issue ?? undefined,
    summary: row.summary ?? undefined,
    status: row.status,
    quote: parseJson<QuoteRecord>(row.quote_json),
    appointment: parseJson<AppointmentRecord>(row.appointment_json),
    callbackTask: parseJson<CallbackTaskRecord>(row.callback_json),
    photos: parseJson<JobPhoto[]>(row.photos_json, []) ?? [],
    calls: parseJson<CallRecord[]>(row.calls_json, []) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPhoto(row: PhotoRow): JobPhoto {
  return {
    id: row.id,
    jobId: row.job_id,
    filename: row.filename,
    objectKey: row.object_key,
    mimeType: row.mime_type ?? undefined,
    caption: row.caption ?? undefined,
    uploadedAt: row.uploaded_at,
  };
}

function rowToCallback(row: CallbackRow): CallbackTaskRecord {
  return {
    id: row.id,
    jobId: row.job_id ?? undefined,
    staffId: row.staff_id ?? undefined,
    status: row.status,
    reason: row.reason ?? undefined,
    dueAt: row.due_at ?? undefined,
    phoneNumber: row.phone_number ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToQuote(row: QuoteRow): QuoteRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    staffId: row.staff_id ?? undefined,
    variant: row.variant,
    amount: row.presented_price,
    currency: "AUD",
    basePrice: row.base_price,
    strategyAdjustment: row.strategy_adjustment,
    experimentAdjustment: row.experiment_adjustment,
    floorPrice: row.floor_price,
    ceilingPrice: row.ceiling_price,
    confidence: row.confidence,
    status: row.status,
    rationale: parseJson<string[]>(row.rationale_json, []) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAppointment(row: AppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    staffId: row.staff_id ?? undefined,
    startAt: row.starts_at ?? undefined,
    endAt: row.ends_at ?? undefined,
    status: row.status,
    outlookEventId: row.calendar_event_id ?? undefined,
    location: row.location ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStaffSummary(row: StaffProfileRow): StaffProfileSummary {
  return {
    id: row.staff_id,
    fullName: row.full_name,
    phoneNumber: row.phone_number ?? undefined,
    email: row.email ?? undefined,
    role: row.role ?? undefined,
    timezone: row.timezone ?? undefined,
    companyName: row.company_name ?? undefined,
    calendarProvider: row.calendar_provider ?? undefined,
    updatedAt: row.updated_at,
  };
}

function rowToPricingInterview(row: PricingInterviewRow): PricingInterviewRecord {
  return {
    answeredAt: row.captured_at,
    responses: parseJson<Record<string, unknown>>(row.responses_json, {}) ?? {},
  };
}

function rowToAiTestCase(row: AiTestCaseRow): AiTestCaseRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    target: row.target,
    systemPrompt: row.system_prompt ?? undefined,
    userPrompt: row.user_prompt,
    tags: parseJson<string[]>(row.tags_json, []) ?? [],
    successCriteria: parseJson<AiTestSuccessCriterionRecord[]>(row.success_criteria_json, []) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at ?? undefined,
  };
}

function rowToAiTestRun(row: AiTestRunRow): AiTestRunRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    status: row.status,
    operatorNotes: row.operator_notes ?? undefined,
    promptSnapshot:
      parseJson<AiTestPromptSnapshot>(row.prompt_snapshot_json, {
        target: "generic-agent",
        userPrompt: "",
      }) ?? {
        target: "generic-agent",
        userPrompt: "",
      },
    criteriaSnapshot: parseJson<AiTestSuccessCriterionRecord[]>(row.criteria_snapshot_json, []) ?? [],
    runnerResult: parseJson<AiTestRunnerResultRecord>(row.runner_result_json),
    judgeResult: parseJson<AiTestJudgeResultRecord>(row.judge_result_json),
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function serializeLocation(location?: JobLocation): string | null {
  return location ? JSON.stringify(location) : null;
}

function serializeJson<T>(value: T | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export class D1OnboardingRepository implements OnboardingRepository {
  constructor(private readonly db: D1Database) {}

  async createInvite(invite: InviteRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO onboarding_invites (
          id, code, staff_id, full_name, email, phone_number, role, status, created_at, expires_at, session_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        invite.id,
        invite.code,
        invite.staffId,
        invite.fullName,
        invite.email ?? null,
        invite.phoneNumber ?? null,
        invite.role ?? null,
        invite.status,
        invite.createdAt,
        invite.expiresAt,
        invite.sessionId ?? null,
      )
      .run();
  }

  async saveInvite(invite: InviteRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE onboarding_invites
         SET code = ?, staff_id = ?, full_name = ?, email = ?, phone_number = ?, role = ?, status = ?, created_at = ?, expires_at = ?, session_id = ?
         WHERE id = ?`,
      )
      .bind(
        invite.code,
        invite.staffId,
        invite.fullName,
        invite.email ?? null,
        invite.phoneNumber ?? null,
        invite.role ?? null,
        invite.status,
        invite.createdAt,
        invite.expiresAt,
        invite.sessionId ?? null,
        invite.id,
      )
      .run();
  }

  async getInviteByCode(code: string): Promise<InviteRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM onboarding_invites WHERE code = ? LIMIT 1`)
      .bind(code)
      .first<InviteRow>();
    return row ? toInvite(row) : undefined;
  }

  async getInviteById(id: string): Promise<InviteRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM onboarding_invites WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<InviteRow>();
    return row ? toInvite(row) : undefined;
  }

  async saveSession(session: OnboardingSessionRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO onboarding_sessions (
          id, invite_id, invite_code, staff_id, staff_name, participant_token_hash, expires_at, status,
          consent_accepted, clone_consent_accepted, created_at, updated_at, analysis_json, review_json,
          voice_session_json, calendar_json, voice_sample_json, finalized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          invite_id = excluded.invite_id,
          invite_code = excluded.invite_code,
          staff_id = excluded.staff_id,
          staff_name = excluded.staff_name,
          participant_token_hash = excluded.participant_token_hash,
          expires_at = excluded.expires_at,
          status = excluded.status,
          consent_accepted = excluded.consent_accepted,
          clone_consent_accepted = excluded.clone_consent_accepted,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          analysis_json = excluded.analysis_json,
          review_json = excluded.review_json,
          voice_session_json = excluded.voice_session_json,
          calendar_json = excluded.calendar_json,
          voice_sample_json = excluded.voice_sample_json,
          finalized_at = excluded.finalized_at`,
      )
      .bind(
        session.id,
        session.inviteId,
        session.inviteCode,
        session.staffId,
        session.staffName,
        session.participantTokenHash,
        session.expiresAt,
        session.status,
        session.consentAccepted ? 1 : 0,
        session.cloneConsentAccepted ? 1 : 0,
        session.createdAt,
        session.updatedAt,
        JSON.stringify(session.analysis),
        JSON.stringify(session.review),
        session.voiceSession ? JSON.stringify(session.voiceSession) : null,
        session.calendar ? JSON.stringify(session.calendar) : null,
        session.voiceSample ? JSON.stringify(session.voiceSample) : null,
        session.finalizedAt ?? null,
      )
      .run();
  }

  async getSessionById(id: string): Promise<OnboardingSessionRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM onboarding_sessions WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<SessionRow>();
    return row ? toSession(row) : undefined;
  }

  async getSessionByCalendarState(state: string): Promise<OnboardingSessionRecord | undefined> {
    const rows = await this.db.prepare(`SELECT * FROM onboarding_sessions`).all<SessionRow>();
    const match = (rows.results ?? []).find((row) => {
      if (!row.calendar_json) {
        return false;
      }
      const calendar = parseJson<{ authState?: string }>(row.calendar_json);
      return calendar?.authState === state;
    });
    return match ? toSession(match) : undefined;
  }

  async appendTurn(sessionId: string, turn: InterviewTurn): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO onboarding_turns (id, session_id, speaker, text, question_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(turn.id, sessionId, turn.speaker, turn.text, turn.questionId ?? null, turn.createdAt)
      .run();
  }

  async listTurns(sessionId: string): Promise<InterviewTurn[]> {
    const rows = await this.db
      .prepare(`SELECT id, speaker, text, question_id, created_at FROM onboarding_turns WHERE session_id = ? ORDER BY created_at ASC`)
      .bind(sessionId)
      .all<TurnRow>();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      speaker: row.speaker,
      text: row.text,
      questionId: row.question_id ?? undefined,
      createdAt: row.created_at,
    }));
  }

  async upsertStaffProfile(input: StaffProfileUpsertInput): Promise<void> {
    const existing = await this.db
      .prepare(`SELECT created_at FROM onboarding_staff_profiles WHERE staff_id = ? LIMIT 1`)
      .bind(input.staffId)
      .first<{ created_at: string | null }>();
    await this.db
      .prepare(
        `INSERT INTO onboarding_staff_profiles (
          staff_id, full_name, phone_number, email, role, timezone, company_name, calendar_provider,
          communication_json, pricing_json, business_json, crm_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id) DO UPDATE SET
          full_name = excluded.full_name,
          phone_number = excluded.phone_number,
          email = excluded.email,
          role = excluded.role,
          timezone = excluded.timezone,
          company_name = excluded.company_name,
          calendar_provider = excluded.calendar_provider,
          communication_json = excluded.communication_json,
          pricing_json = excluded.pricing_json,
          business_json = excluded.business_json,
          crm_json = excluded.crm_json,
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.staffId,
        input.fullName,
        input.phoneNumber ?? null,
        input.email ?? null,
        input.role ?? null,
        input.timezone ?? null,
        input.companyName ?? null,
        input.calendarProvider ?? null,
        JSON.stringify(input.communication),
        JSON.stringify(input.pricing),
        JSON.stringify(input.business),
        JSON.stringify(input.crm),
        existing?.created_at ?? input.updatedAt,
        input.updatedAt,
      )
      .run();
  }

  async recordVoiceConsent(input: VoiceConsentRecordInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO staff_voice_consents (id, staff_id, consent, signed_by, captured_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(globalThis.crypto.randomUUID(), input.staffId, input.consent ? 1 : 0, input.signedBy ?? null, input.capturedAt)
      .run();
  }

  async savePricingInterview(input: PricingInterviewRecordInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pricing_interviews (id, staff_id, responses_json, captured_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(globalThis.crypto.randomUUID(), input.staffId, JSON.stringify(input.responses), input.capturedAt)
      .run();
  }

  async getStaff(staffId: string): Promise<StaffRecord | undefined> {
    return this.getStaffRecord(staffId);
  }

  async findStaffByInviteTokenHash(inviteTokenHash: string): Promise<StaffRecord | undefined> {
    const auth = await this.db
      .prepare(`SELECT * FROM staff_auth_state WHERE invite_token_hash = ? LIMIT 1`)
      .bind(inviteTokenHash)
      .first<StaffAuthRow>();
    if (!auth) {
      return undefined;
    }
    return this.getStaffRecord(auth.staff_id);
  }

  async saveStaffInvite(input: StaffInviteInput): Promise<StaffRecord> {
    await this.upsertStaffProfile({
      staffId: input.staffId,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      email: input.email,
      role: input.role,
      timezone: input.timezone,
      communication: {},
      pricing: {},
      business: {},
      crm: {},
      updatedAt: input.updatedAt,
    });

    await this.db
      .prepare(
        `INSERT INTO staff_auth_state (
          staff_id, invite_token_hash, otp_code_hash, otp_issued_at, otp_failed_attempts,
          otp_verified_at, auth_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id) DO UPDATE SET
          invite_token_hash = excluded.invite_token_hash,
          otp_code_hash = excluded.otp_code_hash,
          otp_issued_at = excluded.otp_issued_at,
          otp_failed_attempts = excluded.otp_failed_attempts,
          otp_verified_at = excluded.otp_verified_at,
          auth_expires_at = excluded.auth_expires_at,
          created_at = COALESCE(staff_auth_state.created_at, excluded.created_at),
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.staffId,
        input.inviteTokenHash,
        input.otpCodeHash,
        input.otpIssuedAt,
        input.otpFailedAttempts,
        null,
        input.authExpiresAt,
        input.createdAt,
        input.updatedAt,
      )
      .run();

    const staff = await this.getStaffRecord(input.staffId);
    if (!staff) {
      throw new Error(`Staff ${input.staffId} was not persisted`);
    }
    return staff;
  }

  async saveStaffAuthState(input: StaffAuthStateInput): Promise<StaffRecord | undefined> {
    const existing = await this.db
      .prepare(`SELECT * FROM staff_auth_state WHERE staff_id = ? LIMIT 1`)
      .bind(input.staffId)
      .first<StaffAuthRow>();
    if (!existing) {
      return undefined;
    }

    await this.db
      .prepare(
        `UPDATE staff_auth_state
         SET invite_token_hash = ?, otp_code_hash = ?, otp_issued_at = ?, otp_failed_attempts = ?,
             otp_verified_at = ?, auth_expires_at = ?, created_at = ?, updated_at = ?
         WHERE staff_id = ?`,
      )
      .bind(
        input.inviteTokenHash ?? null,
        input.otpCodeHash ?? null,
        input.otpIssuedAt ?? null,
        input.otpFailedAttempts ?? existing.otp_failed_attempts,
        input.otpVerifiedAt ?? null,
        input.authExpiresAt ?? null,
        input.createdAt ?? existing.created_at,
        input.updatedAt,
        input.staffId,
      )
      .run();

    return this.getStaffRecord(input.staffId);
  }

  async createStaffSession(input: StaffSessionInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO staff_sessions (token_hash, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(input.tokenHash, input.staffId, input.createdAt, input.expiresAt)
      .run();
  }

  async getStaffSession(tokenHash: string): Promise<StaffSessionRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM staff_sessions WHERE token_hash = ? LIMIT 1`)
      .bind(tokenHash)
      .first<StaffSessionRow>();
    return row
      ? {
          tokenHash: row.token_hash,
          staffId: row.staff_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }
      : undefined;
  }

  async saveStaffCalendarConnection(input: StaffCalendarConnectionInput): Promise<CalendarConnectionRecord> {
    await this.db
      .prepare(
        `INSERT INTO staff_calendar_connections (
          staff_id, provider, account_email, calendar_id, timezone, external_connection_id, connected_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id) DO UPDATE SET
          provider = excluded.provider,
          account_email = excluded.account_email,
          calendar_id = excluded.calendar_id,
          timezone = excluded.timezone,
          external_connection_id = excluded.external_connection_id,
          connected_at = excluded.connected_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.staffId,
        input.provider,
        input.accountEmail ?? null,
        input.calendarId ?? null,
        input.timezone ?? null,
        input.externalConnectionId ?? null,
        input.connectedAt,
        input.updatedAt,
      )
      .run();

    await this.db
      .prepare(
        `UPDATE onboarding_staff_profiles SET calendar_provider = ?, updated_at = ? WHERE staff_id = ?`,
      )
      .bind(input.provider, input.updatedAt, input.staffId)
      .run();

    return {
      provider: input.provider,
      accountEmail: input.accountEmail,
      calendarId: input.calendarId,
      timezone: input.timezone,
      externalConnectionId: input.externalConnectionId,
      connectedAt: input.connectedAt,
    };
  }

  async listJobs(staffId?: string): Promise<JobRecord[]> {
    const query = staffId
      ? this.db.prepare(`SELECT * FROM crm_jobs WHERE staff_id = ? ORDER BY updated_at DESC`).bind(staffId)
      : this.db.prepare(`SELECT * FROM crm_jobs ORDER BY updated_at DESC`);
    const rows = await query.all<JobRow>();
    return (rows.results ?? []).map(rowToJob);
  }

  async getJobCard(jobId: string): Promise<JobCardEnvelope | undefined> {
    const jobRow = await this.db
      .prepare(`SELECT * FROM crm_jobs WHERE id = ? LIMIT 1`)
      .bind(jobId)
      .first<JobRow>();
    if (!jobRow) {
      return undefined;
    }
    const job = rowToJob(jobRow);
    const staff = job.staffId ? await this.getStaffSummary(job.staffId) : undefined;
    const quotes = await this.listQuotes(job.id);
    const calls = job.calls;
    return {
      job,
      staff,
      quotes,
      photos: job.photos,
      calls,
    };
  }

  async listCallbacks(staffId?: string): Promise<CallbackTaskRecord[]> {
    const query = staffId
      ? this.db.prepare(`SELECT * FROM crm_callbacks WHERE staff_id = ? ORDER BY due_at DESC`).bind(staffId)
      : this.db.prepare(`SELECT * FROM crm_callbacks ORDER BY due_at DESC`);
    const rows = await query.all<CallbackRow>();
    return (rows.results ?? []).map(rowToCallback);
  }

  async listExperiments(): Promise<DashboardExperiment[]> {
    const rows = await this.db.prepare(`SELECT * FROM dashboard_experiments ORDER BY sample_size DESC`).all<ExperimentRow>();
    const experiments = (rows.results ?? []).map((row) => ({
      name: row.name,
      variant: row.variant,
      exposure: row.exposure,
      lift: row.lift,
      sampleSize: row.sample_size,
    }));
    return experiments.length > 0 ? experiments : dashboardExperiments;
  }

  async ensureJob(input: JobUpsertInput): Promise<JobRecord> {
    const existing = await this.db
      .prepare(`SELECT * FROM crm_jobs WHERE id = ? LIMIT 1`)
      .bind(input.id)
      .first<JobRow>();
    const now = new Date().toISOString();
    const record: JobRecord = {
      id: input.id,
      staffId: input.staffId ?? existing?.staff_id ?? undefined,
      callerId: input.callerId ?? existing?.caller_id ?? undefined,
      callerName: input.callerName ?? existing?.caller_name ?? undefined,
      callerPhone: input.callerPhone ?? existing?.caller_phone ?? undefined,
      callerEmail: input.callerEmail ?? existing?.caller_email ?? undefined,
      address: input.address ?? existing?.address ?? undefined,
      location: input.location ? { ...input.location } : parseJson<JobLocation>(existing?.location_json),
      issue: input.issue ?? existing?.issue ?? undefined,
      summary: input.summary ?? existing?.summary ?? undefined,
      status: input.status ?? existing?.status ?? "new",
      quote: input.quote ? { ...input.quote } : parseJson<QuoteRecord>(existing?.quote_json),
      appointment: input.appointment ? { ...input.appointment } : parseJson<AppointmentRecord>(existing?.appointment_json),
      callbackTask: input.callbackTask ? { ...input.callbackTask } : parseJson<CallbackTaskRecord>(existing?.callback_json),
      photos: input.photos ? [...input.photos] : parseJson<JobPhoto[]>(existing?.photos_json, []) ?? [],
      calls: input.calls ? [...input.calls] : parseJson<CallRecord[]>(existing?.calls_json, []) ?? [],
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    await this.db
      .prepare(
        `INSERT INTO crm_jobs (
          id, staff_id, caller_id, caller_name, caller_phone, caller_email, address, location_json, issue, summary,
          status, quote_json, appointment_json, callback_json, photos_json, calls_json, proposed_next_action,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          staff_id = excluded.staff_id,
          caller_id = excluded.caller_id,
          caller_name = excluded.caller_name,
          caller_phone = excluded.caller_phone,
          caller_email = excluded.caller_email,
          address = excluded.address,
          location_json = excluded.location_json,
          issue = excluded.issue,
          summary = excluded.summary,
          status = excluded.status,
          quote_json = excluded.quote_json,
          appointment_json = excluded.appointment_json,
          callback_json = excluded.callback_json,
          photos_json = excluded.photos_json,
          calls_json = excluded.calls_json,
          proposed_next_action = excluded.proposed_next_action,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        record.id,
        record.staffId ?? null,
        record.callerId ?? null,
        record.callerName ?? null,
        record.callerPhone ?? null,
        record.callerEmail ?? null,
        record.address ?? null,
        serializeLocation(record.location),
        record.issue ?? null,
        record.summary ?? null,
        record.status,
        serializeJson(record.quote),
        serializeJson(record.appointment),
        serializeJson(record.callbackTask),
        JSON.stringify(record.photos),
        JSON.stringify(record.calls),
        record.summary ?? record.issue ?? "Awaiting call summary",
        record.createdAt,
        record.updatedAt,
      )
      .run();

    return record;
  }

  async upsertQuote(input: QuoteUpsertInput): Promise<QuoteRecord> {
    const now = new Date().toISOString();
    const record: QuoteRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId,
      amount: input.amount,
      currency: input.currency,
      variant: input.variant ?? "control",
      basePrice: input.basePrice ?? input.amount,
      strategyAdjustment: input.strategyAdjustment ?? 0,
      experimentAdjustment: input.experimentAdjustment ?? 0,
      floorPrice: input.floorPrice ?? Math.max(90, input.amount - 60),
      ceilingPrice: input.ceilingPrice ?? input.amount + 120,
      confidence: input.confidence ?? 0.5,
      status: input.status ?? "draft",
      rationale: input.rationale ? [...input.rationale] : [],
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    await this.db
      .prepare(
        `INSERT INTO crm_quotes (
          id, job_id, staff_id, variant, base_price, strategy_adjustment, experiment_adjustment, presented_price,
          floor_price, ceiling_price, confidence, status, rationale_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          job_id = excluded.job_id,
          staff_id = excluded.staff_id,
          variant = excluded.variant,
          base_price = excluded.base_price,
          strategy_adjustment = excluded.strategy_adjustment,
          experiment_adjustment = excluded.experiment_adjustment,
          presented_price = excluded.presented_price,
          floor_price = excluded.floor_price,
          ceiling_price = excluded.ceiling_price,
          confidence = excluded.confidence,
          status = excluded.status,
          rationale_json = excluded.rationale_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        record.id,
        record.jobId,
        record.staffId ?? null,
        record.variant,
        record.basePrice,
        record.strategyAdjustment,
        record.experimentAdjustment,
        record.amount,
        record.floorPrice,
        record.ceilingPrice,
        record.confidence,
        record.status,
        JSON.stringify(record.rationale),
        record.createdAt,
        record.updatedAt,
      )
      .run();

    const job = await this.ensureJob({
      id: record.jobId,
      staffId: record.staffId,
      quote: record,
      status: "quoted",
    });
    await this.writeJob({ ...job, quote: record, status: "quoted", updatedAt: now });
    return record;
  }

  async upsertAppointment(input: AppointmentUpsertInput): Promise<AppointmentRecord> {
    const now = new Date().toISOString();
    const record: AppointmentRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId,
      status: input.status ?? "proposed",
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      location: input.location,
      notes: input.notes,
      outlookEventId: input.outlookEventId,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    await this.db
      .prepare(
        `INSERT INTO crm_appointments (
          id, job_id, staff_id, starts_at, ends_at, status, calendar_event_id, location, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          job_id = excluded.job_id,
          staff_id = excluded.staff_id,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          status = excluded.status,
          calendar_event_id = excluded.calendar_event_id,
          location = excluded.location,
          notes = excluded.notes,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        record.id,
        record.jobId,
        record.staffId ?? null,
        record.startAt ?? null,
        record.endAt ?? null,
        record.status,
        record.outlookEventId ?? null,
        record.location ?? null,
        record.notes ?? null,
        record.createdAt,
        record.updatedAt,
      )
      .run();

    const job = await this.ensureJob({
      id: record.jobId,
      staffId: record.staffId,
      appointment: record,
      status: record.status === "booked" ? "scheduled" : "new",
    });
    await this.writeJob({
      ...job,
      appointment: record,
      status: record.status === "booked" ? "scheduled" : job.status,
      updatedAt: now,
    });
    return record;
  }

  async upsertCallback(input: CallbackUpsertInput): Promise<CallbackTaskRecord> {
    const now = new Date().toISOString();
    const record: CallbackTaskRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId,
      status: input.status ?? "queued",
      reason: input.reason,
      dueAt: input.dueAt,
      phoneNumber: input.phoneNumber,
      notes: input.notes,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    await this.db
      .prepare(
        `INSERT INTO crm_callbacks (
          id, job_id, staff_id, status, reason, due_at, phone_number, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          job_id = excluded.job_id,
          staff_id = excluded.staff_id,
          status = excluded.status,
          reason = excluded.reason,
          due_at = excluded.due_at,
          phone_number = excluded.phone_number,
          notes = excluded.notes,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        record.id,
        record.jobId ?? null,
        record.staffId ?? null,
        record.status,
        record.reason ?? null,
        record.dueAt ?? null,
        record.phoneNumber ?? null,
        record.notes ?? null,
        record.createdAt,
        record.updatedAt,
      )
      .run();

    if (record.jobId) {
      const job = await this.ensureJob({
        id: record.jobId,
        staffId: record.staffId,
        callerPhone: record.phoneNumber,
        callbackTask: record,
        status: record.status === "done" ? "closed" : "callback",
      });
      await this.writeJob({
        ...job,
        callbackTask: record,
        status: record.status === "done" ? "closed" : "callback",
        updatedAt: now,
      });
    }

    return record;
  }

  async recordCall(input: CallUpsertInput): Promise<CallRecord> {
    const now = new Date().toISOString();
    const record: CallRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      staffId: input.staffId,
      callerPhone: input.callerPhone,
      direction: input.direction ?? "inbound",
      status: input.status ?? "received",
      transcript: input.transcript,
      summary: input.summary,
      disposition: input.disposition,
      jobId: input.jobId,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    await this.db
      .prepare(
        `INSERT INTO crm_calls (
          id, job_id, staff_id, caller_phone, direction, status, transcript, summary, disposition, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          job_id = excluded.job_id,
          staff_id = excluded.staff_id,
          caller_phone = excluded.caller_phone,
          direction = excluded.direction,
          status = excluded.status,
          transcript = excluded.transcript,
          summary = excluded.summary,
          disposition = excluded.disposition,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        record.id,
        record.jobId ?? null,
        record.staffId ?? null,
        record.callerPhone ?? null,
        record.direction,
        record.status,
        record.transcript ?? null,
        record.summary ?? null,
        record.disposition ?? null,
        record.createdAt,
        record.updatedAt,
      )
      .run();

    if (record.jobId) {
      const job = await this.ensureJob({
        id: record.jobId,
        staffId: record.staffId,
        callerPhone: record.callerPhone,
      });
      const calls = [...job.calls, record];
      await this.writeJob({
        ...job,
        calls,
        summary: record.summary ?? job.summary,
        status: record.status === "callback_requested" ? "callback" : record.status === "completed" ? "closed" : job.status,
        updatedAt: now,
      });
    }

    return record;
  }

  async createUploadRequest(input: UploadRequestInput): Promise<UploadRequestRecord> {
    const now = new Date().toISOString();
    const token = input.token ?? globalThis.crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(token);
    const jobId = input.jobId ?? `job_${token.slice(0, 8)}`;
    const job = await this.ensureJob({
      id: jobId,
      staffId: input.staffId,
      callerPhone: input.callerPhone,
      summary: input.notes ?? "Customer photo upload received.",
      status: "new",
    });
    const record: UploadRequestRecord = {
      token,
      jobId: job.id,
      staffId: input.staffId,
      callerPhone: input.callerPhone,
      notes: input.notes,
      uploadLink: input.uploadLink,
      status: "pending",
      createdAt: now,
      expiresAt: input.expiresAt,
      fileCount: 0,
      files: [],
    };
    await this.db
      .prepare(
        `INSERT INTO crm_upload_requests (
          token, job_id, staff_id, caller_phone, notes, upload_link, status, created_at, expires_at, completed_at, file_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET
          job_id = excluded.job_id,
          staff_id = excluded.staff_id,
          caller_phone = excluded.caller_phone,
          notes = excluded.notes,
          upload_link = excluded.upload_link,
          status = excluded.status,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          completed_at = excluded.completed_at,
          file_count = excluded.file_count`,
      )
      .bind(
        tokenHash,
        record.jobId,
        record.staffId ?? null,
        record.callerPhone ?? null,
        record.notes ?? null,
        redactUploadLink(record.uploadLink),
        record.status,
        record.createdAt,
        record.expiresAt,
        null,
        record.fileCount,
      )
      .run();
    await this.writeJob(job);
    return record;
  }

  async getUploadRequest(token: string): Promise<UploadRequestRecord | undefined> {
    const tokenHash = await sha256Hex(token);
    const row =
      (await this.db
        .prepare(`SELECT * FROM crm_upload_requests WHERE token = ? LIMIT 1`)
        .bind(tokenHash)
        .first<UploadRequestRow>()) ??
      (await this.db
        .prepare(`SELECT * FROM crm_upload_requests WHERE token = ? LIMIT 1`)
        .bind(token)
        .first<UploadRequestRow>());
    if (!row) {
      return undefined;
    }
    const files = await this.listPhotosByUploadToken(token);
    return {
      token,
      jobId: row.job_id,
      staffId: row.staff_id ?? undefined,
      callerPhone: row.caller_phone ?? undefined,
      notes: row.notes ?? undefined,
      uploadLink: row.upload_link,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at ?? undefined,
      fileCount: row.file_count,
      files,
    };
  }

  async completeUploadRequest(token: string, photos: JobPhoto[]): Promise<UploadRequestRecord | undefined> {
    const tokenHash = await sha256Hex(token);
    const row =
      (await this.db
        .prepare(`SELECT * FROM crm_upload_requests WHERE token = ? LIMIT 1`)
        .bind(tokenHash)
        .first<UploadRequestRow>()) ??
      (await this.db
        .prepare(`SELECT * FROM crm_upload_requests WHERE token = ? LIMIT 1`)
        .bind(token)
        .first<UploadRequestRow>());
    if (!row) {
      return undefined;
    }
    const now = new Date().toISOString();
    const request = await this.getUploadRequest(token);
    if (!request) {
      return undefined;
    }
    if (request.status !== "pending" || new Date(request.expiresAt).getTime() < Date.now()) {
      return undefined;
    }
    const nextFileCount = request.fileCount + photos.length;
    const updateResult = await this.db
      .prepare(
        `UPDATE crm_upload_requests
         SET status = ?, completed_at = ?, file_count = ?
         WHERE token = ? AND status = ? AND expires_at > ?`,
      )
      .bind("completed", now, nextFileCount, row.token, "pending", now)
      .run();
    if (!updateResult.success || (updateResult.meta?.changes ?? 0) === 0) {
      return undefined;
    }
    for (const photo of photos) {
      await this.db
        .prepare(
          `INSERT INTO crm_photo_assets (id, job_id, upload_token, filename, object_key, mime_type, caption, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          photo.id,
          photo.jobId,
          tokenHash,
          photo.filename,
          photo.objectKey ?? photo.id,
          photo.mimeType ?? null,
          photo.caption ?? null,
          photo.uploadedAt,
        )
        .run();
    }
    const updatedRequest: UploadRequestRecord = {
      ...request,
      status: "completed",
      completedAt: now,
      fileCount: nextFileCount,
      files: [...request.files, ...photos],
    };

    const job = await this.getJobById(request.jobId);
    if (job) {
      const nextPhotos = [...job.photos, ...photos];
      await this.writeJob({
        ...job,
        photos: nextPhotos,
        updatedAt: now,
      });
    }

    return updatedRequest;
  }

  async getPhotoAsset(photoId: string): Promise<JobPhoto | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM crm_photo_assets WHERE id = ? LIMIT 1`)
      .bind(photoId)
      .first<PhotoRow>();
    return row ? rowToPhoto(row) : undefined;
  }

  async claimAutomationReplay(fingerprint: string, expiresAt: string): Promise<boolean> {
    const now = new Date().toISOString();
    await this.db.prepare(`DELETE FROM automation_request_replays WHERE expires_at <= ?`).bind(now).run();
    const result = await this.db
      .prepare(`INSERT OR IGNORE INTO automation_request_replays (fingerprint, expires_at, created_at) VALUES (?, ?, ?)`)
      .bind(fingerprint, expiresAt, now)
      .run();
    return Boolean(result.meta.changes);
  }

  async listAiTestCases(): Promise<AiTestCaseRecord[]> {
    const rows = await this.db.prepare(`SELECT * FROM ai_test_cases ORDER BY updated_at DESC`).all<AiTestCaseRow>();
    return (rows.results ?? []).map(rowToAiTestCase);
  }

  async getAiTestCase(id: string): Promise<AiTestCaseRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM ai_test_cases WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<AiTestCaseRow>();
    return row ? rowToAiTestCase(row) : undefined;
  }

  async getAiTestCaseBySlug(slug: string): Promise<AiTestCaseRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM ai_test_cases WHERE slug = ? LIMIT 1`)
      .bind(slug)
      .first<AiTestCaseRow>();
    return row ? rowToAiTestCase(row) : undefined;
  }

  async saveAiTestCase(testCase: AiTestCaseRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ai_test_cases (
          id, slug, name, description, status, target, system_prompt, user_prompt, tags_json,
          success_criteria_json, created_at, updated_at, last_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          slug = excluded.slug,
          name = excluded.name,
          description = excluded.description,
          status = excluded.status,
          target = excluded.target,
          system_prompt = excluded.system_prompt,
          user_prompt = excluded.user_prompt,
          tags_json = excluded.tags_json,
          success_criteria_json = excluded.success_criteria_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_run_at = excluded.last_run_at`,
      )
      .bind(
        testCase.id,
        testCase.slug,
        testCase.name,
        testCase.description ?? null,
        testCase.status,
        testCase.target,
        testCase.systemPrompt ?? null,
        testCase.userPrompt,
        JSON.stringify(testCase.tags),
        JSON.stringify(testCase.successCriteria),
        testCase.createdAt,
        testCase.updatedAt,
        testCase.lastRunAt ?? null,
      )
      .run();
  }

  async listAiTestRuns(caseId?: string): Promise<AiTestRunRecord[]> {
    const query = caseId
      ? this.db.prepare(`SELECT * FROM ai_test_runs WHERE case_id = ? ORDER BY started_at DESC`).bind(caseId)
      : this.db.prepare(`SELECT * FROM ai_test_runs ORDER BY started_at DESC`);
    const rows = await query.all<AiTestRunRow>();
    return (rows.results ?? []).map(rowToAiTestRun);
  }

  async getAiTestRun(id: string): Promise<AiTestRunRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM ai_test_runs WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<AiTestRunRow>();
    return row ? rowToAiTestRun(row) : undefined;
  }

  async saveAiTestRun(run: AiTestRunRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ai_test_runs (
          id, case_id, status, operator_notes, prompt_snapshot_json, criteria_snapshot_json,
          runner_result_json, judge_result_json, error_message, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          case_id = excluded.case_id,
          status = excluded.status,
          operator_notes = excluded.operator_notes,
          prompt_snapshot_json = excluded.prompt_snapshot_json,
          criteria_snapshot_json = excluded.criteria_snapshot_json,
          runner_result_json = excluded.runner_result_json,
          judge_result_json = excluded.judge_result_json,
          error_message = excluded.error_message,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at`,
      )
      .bind(
        run.id,
        run.caseId,
        run.status,
        run.operatorNotes ?? null,
        JSON.stringify(run.promptSnapshot),
        JSON.stringify(run.criteriaSnapshot),
        run.runnerResult ? JSON.stringify(run.runnerResult) : null,
        run.judgeResult ? JSON.stringify(run.judgeResult) : null,
        run.errorMessage ?? null,
        run.createdAt,
        run.startedAt,
        run.completedAt ?? null,
      )
      .run();
  }

  private async listPhotosByUploadToken(token: string): Promise<JobPhoto[]> {
    const tokenHash = await sha256Hex(token);
    const rows = await this.db
      .prepare(`SELECT * FROM crm_photo_assets WHERE upload_token IN (?, ?) ORDER BY uploaded_at ASC`)
      .bind(tokenHash, token)
      .all<PhotoRow>();
    return (rows.results ?? []).map(rowToPhoto);
  }

  private async listQuotes(jobId: string): Promise<QuoteRecord[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM crm_quotes WHERE job_id = ? ORDER BY created_at ASC`)
      .bind(jobId)
      .all<QuoteRow>();
    return (rows.results ?? []).map(rowToQuote);
  }

  private async getJobById(jobId: string): Promise<JobRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM crm_jobs WHERE id = ? LIMIT 1`)
      .bind(jobId)
      .first<JobRow>();
    return row ? rowToJob(row) : undefined;
  }

  private async getStaffSummary(staffId: string): Promise<StaffProfileSummary | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM onboarding_staff_profiles WHERE staff_id = ? LIMIT 1`)
      .bind(staffId)
      .first<StaffProfileRow>();
    return row ? rowToStaffSummary(row) : undefined;
  }

  private async getStaffRecord(staffId: string): Promise<StaffRecord | undefined> {
    const profileRow = await this.db
      .prepare(`SELECT * FROM onboarding_staff_profiles WHERE staff_id = ? LIMIT 1`)
      .bind(staffId)
      .first<StaffProfileRow>();
    if (!profileRow) {
      return undefined;
    }

    const [authRow, consentRow, pricingRow, calendarRow] = await Promise.all([
      this.db.prepare(`SELECT * FROM staff_auth_state WHERE staff_id = ? LIMIT 1`).bind(staffId).first<StaffAuthRow>(),
      this.db
        .prepare(`SELECT consent, captured_at FROM staff_voice_consents WHERE staff_id = ? ORDER BY captured_at DESC LIMIT 1`)
        .bind(staffId)
        .first<VoiceConsentRow>(),
      this.db
        .prepare(`SELECT responses_json, captured_at FROM pricing_interviews WHERE staff_id = ? ORDER BY captured_at DESC LIMIT 1`)
        .bind(staffId)
        .first<PricingInterviewRow>(),
      this.db
        .prepare(`SELECT * FROM staff_calendar_connections WHERE staff_id = ? LIMIT 1`)
        .bind(staffId)
        .first<StaffCalendarConnectionRow>(),
    ]);

    const pricingInterview = pricingRow ? rowToPricingInterview(pricingRow) : undefined;
    const calendarConnection = calendarRow
      ? {
          provider: calendarRow.provider,
          accountEmail: calendarRow.account_email ?? undefined,
          calendarId: calendarRow.calendar_id ?? undefined,
          timezone: calendarRow.timezone ?? undefined,
          externalConnectionId: calendarRow.external_connection_id ?? undefined,
          connectedAt: calendarRow.connected_at,
        }
      : undefined;

    return {
      ...rowToStaffSummary(profileRow),
      inviteTokenHash: authRow?.invite_token_hash ?? undefined,
      otpCodeHash: authRow?.otp_code_hash ?? undefined,
      otpIssuedAt: authRow?.otp_issued_at ?? undefined,
      otpFailedAttempts: authRow?.otp_failed_attempts ?? 0,
      otpVerifiedAt: authRow?.otp_verified_at ?? undefined,
      authExpiresAt: authRow?.auth_expires_at ?? undefined,
      voiceConsentStatus: consentRow ? (consentRow.consent ? "granted" : "revoked") : "pending",
      voiceConsentAt: consentRow?.captured_at ?? undefined,
      pricingInterview,
      pricingProfile: pricingInterview ? derivePricingProfile(pricingInterview.responses) : undefined,
      calendarConnection,
      createdAt: authRow?.created_at ?? profileRow.created_at ?? profileRow.updated_at,
      updatedAt: profileRow.updated_at,
    };
  }

  private async writeJob(job: JobRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO crm_jobs (
          id, staff_id, caller_id, caller_name, caller_phone, caller_email, address, location_json, issue, summary,
          status, quote_json, appointment_json, callback_json, photos_json, calls_json, proposed_next_action,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          staff_id = excluded.staff_id,
          caller_id = excluded.caller_id,
          caller_name = excluded.caller_name,
          caller_phone = excluded.caller_phone,
          caller_email = excluded.caller_email,
          address = excluded.address,
          location_json = excluded.location_json,
          issue = excluded.issue,
          summary = excluded.summary,
          status = excluded.status,
          quote_json = excluded.quote_json,
          appointment_json = excluded.appointment_json,
          callback_json = excluded.callback_json,
          photos_json = excluded.photos_json,
          calls_json = excluded.calls_json,
          proposed_next_action = excluded.proposed_next_action,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        job.id,
        job.staffId ?? null,
        job.callerId ?? null,
        job.callerName ?? null,
        job.callerPhone ?? null,
        job.callerEmail ?? null,
        job.address ?? null,
        serializeLocation(job.location),
        job.issue ?? null,
        job.summary ?? null,
        job.status,
        serializeJson(job.quote),
        serializeJson(job.appointment),
        serializeJson(job.callbackTask),
        JSON.stringify(job.photos ?? []),
        JSON.stringify(job.calls ?? []),
        job.summary ?? job.issue ?? "Awaiting call summary",
        job.createdAt,
        job.updatedAt,
      )
      .run();
  }
}
