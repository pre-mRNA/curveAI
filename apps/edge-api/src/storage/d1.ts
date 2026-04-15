import type {
  CalendarConnectionSummary,
  DashboardPayload,
  ExtractionReview,
  InterviewTurn,
  InviteRecord,
  OnboardingAnalysis,
  OnboardingSessionRecord,
  RealtimeVoiceSession,
  VoiceSampleAssessment,
} from "../models.js";
import { createDefaultAnalysis, normalizeReview } from "../models.js";
import type {
  OnboardingRepository,
  PricingInterviewRecordInput,
  StaffProfileUpsertInput,
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

function parseJson<T>(value: string | null | undefined): T | undefined;
function parseJson<T>(value: string | null | undefined, fallback: T): T;
function parseJson<T>(value: string | null | undefined, fallback?: T): T | undefined {
  if (!value) {
    return fallback;
  }
  return JSON.parse(value) as T;
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
    analysis: parseJson<OnboardingAnalysis>(row.analysis_json, createDefaultAnalysis()),
    review: parseJson<ExtractionReview>(row.review_json, normalizeReview(undefined)),
    voiceSession: parseJson<RealtimeVoiceSession>(row.voice_session_json),
    calendar: parseJson<CalendarConnectionSummary>(row.calendar_json),
    voiceSample: parseJson<VoiceSampleAssessment>(row.voice_sample_json),
    finalizedAt: row.finalized_at ?? undefined,
  };
}

export class D1OnboardingRepository implements OnboardingRepository {
  constructor(private readonly db: D1Database) {}

  async getDashboard(): Promise<DashboardPayload> {
    return {
      jobs: [],
      callbacks: [],
      experiments: [],
    };
  }

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
      const calendar = parseJson<CalendarConnectionSummary>(row.calendar_json);
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
    await this.db
      .prepare(
        `INSERT INTO onboarding_staff_profiles (
          staff_id, full_name, role, company_name, calendar_provider, communication_json, pricing_json, business_json, crm_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id) DO UPDATE SET
          full_name = excluded.full_name,
          role = excluded.role,
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
        input.role ?? null,
        input.companyName ?? null,
        input.calendarProvider ?? null,
        JSON.stringify(input.communication),
        JSON.stringify(input.pricing),
        JSON.stringify(input.business),
        JSON.stringify(input.crm),
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
}
