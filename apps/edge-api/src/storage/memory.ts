import {
  type DashboardPayload,
  type InterviewTurn,
  type InviteRecord,
  type OnboardingSessionRecord,
} from "../models.js";
import type {
  OnboardingRepository,
  PricingInterviewRecordInput,
  StaffProfileUpsertInput,
  VoiceConsentRecordInput,
} from "./repository.js";

export class InMemoryOnboardingRepository implements OnboardingRepository {
  private readonly invites = new Map<string, InviteRecord>();
  private readonly sessions = new Map<string, OnboardingSessionRecord>();
  private readonly turns = new Map<string, InterviewTurn[]>();

  async getDashboard(): Promise<DashboardPayload> {
    return {
      jobs: [],
      callbacks: [],
      experiments: [],
    };
  }

  async createInvite(invite: InviteRecord): Promise<void> {
    this.invites.set(invite.id, structuredClone(invite));
  }

  async saveInvite(invite: InviteRecord): Promise<void> {
    this.invites.set(invite.id, structuredClone(invite));
  }

  async getInviteByCode(code: string): Promise<InviteRecord | undefined> {
    for (const invite of this.invites.values()) {
      if (invite.code === code) {
        return structuredClone(invite);
      }
    }
    return undefined;
  }

  async getInviteById(id: string): Promise<InviteRecord | undefined> {
    const invite = this.invites.get(id);
    return invite ? structuredClone(invite) : undefined;
  }

  async saveSession(session: OnboardingSessionRecord): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async getSessionById(id: string): Promise<OnboardingSessionRecord | undefined> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  async getSessionByCalendarState(state: string): Promise<OnboardingSessionRecord | undefined> {
    for (const session of this.sessions.values()) {
      if (session.calendar?.authState === state) {
        return structuredClone(session);
      }
    }
    return undefined;
  }

  async appendTurn(sessionId: string, turn: InterviewTurn): Promise<void> {
    const turns = this.turns.get(sessionId) ?? [];
    turns.push(structuredClone(turn));
    this.turns.set(sessionId, turns);
  }

  async listTurns(sessionId: string): Promise<InterviewTurn[]> {
    return structuredClone(this.turns.get(sessionId) ?? []);
  }

  async upsertStaffProfile(_input: StaffProfileUpsertInput): Promise<void> {}

  async recordVoiceConsent(_input: VoiceConsentRecordInput): Promise<void> {}

  async savePricingInterview(_input: PricingInterviewRecordInput): Promise<void> {}
}
