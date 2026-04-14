import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type CoverageStatus = "pending" | "covered" | "needs_follow_up";
export type OnboardingSessionStatus =
  | "pending"
  | "interviewing"
  | "review"
  | "calendar"
  | "voice_sample"
  | "completed";
export type InterviewSpeaker = "agent" | "participant" | "system";
export type OnboardingProviderMode = "mock" | "configured";

export interface OnboardingInviteRecord {
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

export interface CoverageItemRecord {
  id: string;
  section: string;
  title: string;
  prompt: string;
  status: CoverageStatus;
  evidence: string[];
}

export interface SupervisorPromptRecord {
  id: string;
  section: string;
  reason: string;
  question: string;
}

export interface OnboardingAnalysisRecord {
  coverage: CoverageItemRecord[];
  recommendedQuestions: SupervisorPromptRecord[];
  coverageScore: number;
  interviewerBrief: string;
}

export interface CommunicationProfileRecord {
  tone: string;
  salesStyle: string;
  riskTolerance: string;
  customerHandlingRules: string[];
}

export interface PricingProfileSummaryRecord {
  quotingStyle: string;
  calloutPolicy: string;
  afterHoursPolicy: string;
  approvalThreshold: string;
}

export interface BusinessPracticeProfileRecord {
  services: string[];
  serviceAreas: string[];
  operatingHours: string;
  exclusions: string[];
  escalationRules: string[];
}

export interface CRMDiscoveryProfileRecord {
  currentSystem: string;
  syncPreference: string;
  sourceOfTruth: string;
  notes: string[];
}

export interface ExtractionReviewRecord {
  businessSummary: string;
  communicationProfile: CommunicationProfileRecord;
  pricingProfile: PricingProfileSummaryRecord;
  businessPractices: BusinessPracticeProfileRecord;
  crmDiscovery: CRMDiscoveryProfileRecord;
  missingFields: string[];
}

export interface InterviewTurnRecord {
  id: string;
  speaker: InterviewSpeaker;
  text: string;
  questionId?: string;
  createdAt: string;
}

export interface RealtimeVoiceSessionRecord {
  provider: string;
  mode: OnboardingProviderMode;
  sessionToken: string;
  interviewerModel: string;
  supervisorModel: string;
  websocketUrl?: string;
  expiresAt: string;
}

export interface CalendarConnectionRecord {
  provider: string;
  mode: OnboardingProviderMode;
  status: "pending" | "connected";
  authUrl?: string;
  authState?: string;
  accountEmail?: string;
  calendarLabel?: string;
  connectedAt?: string;
}

export interface VoiceSampleAssessmentRecord {
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
  participantToken: string;
  status: OnboardingSessionStatus;
  consentAccepted: boolean;
  cloneConsentAccepted: boolean;
  createdAt: string;
  updatedAt: string;
  turns: InterviewTurnRecord[];
  analysis: OnboardingAnalysisRecord;
  review: ExtractionReviewRecord;
  voiceSession?: RealtimeVoiceSessionRecord;
  calendar?: CalendarConnectionRecord;
  voiceSample?: VoiceSampleAssessmentRecord;
}

interface OnboardingSnapshot {
  invites: OnboardingInviteRecord[];
  sessions: OnboardingSessionRecord[];
}

function createDefaultReview(fullName?: string): ExtractionReviewRecord {
  return {
    businessSummary: fullName ? `${fullName} onboarding has started.` : "Onboarding interview in progress.",
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

function createDefaultAnalysis(): OnboardingAnalysisRecord {
  return {
    coverage: [],
    recommendedQuestions: [],
    coverageScore: 0,
    interviewerBrief: "Start with business scope and service area before probing pricing.",
  };
}

export class OnboardingStore {
  private readonly invites = new Map<string, OnboardingInviteRecord>();
  private readonly sessions = new Map<string, OnboardingSessionRecord>();
  private stateFilePath?: string;
  private hydrated = false;
  private suspendPersistence = false;

  configurePersistence(stateFilePath: string): void {
    if (this.stateFilePath === stateFilePath && this.hydrated) {
      return;
    }

    this.stateFilePath = stateFilePath;
    this.loadState();
  }

  reset(options: { deleteStateFile?: boolean } = {}): void {
    this.invites.clear();
    this.sessions.clear();
    this.hydrated = false;

    if (options.deleteStateFile && this.stateFilePath) {
      fs.rmSync(this.stateFilePath, { force: true });
    }
  }

  getStats() {
    return {
      invites: this.invites.size,
      sessions: this.sessions.size,
    };
  }

  private loadState(): void {
    if (this.hydrated) {
      return;
    }

    this.hydrated = true;
    if (!this.stateFilePath || !fs.existsSync(this.stateFilePath)) {
      return;
    }

    const rawSnapshot = fs.readFileSync(this.stateFilePath, "utf8");
    if (!rawSnapshot.trim()) {
      return;
    }

    let snapshot: Partial<OnboardingSnapshot>;
    try {
      snapshot = JSON.parse(rawSnapshot) as Partial<OnboardingSnapshot>;
    } catch {
      return;
    }

    this.runWithoutPersistence(() => {
      this.invites.clear();
      this.sessions.clear();

      const invites = Array.isArray(snapshot.invites) ? snapshot.invites : [];
      const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];

      invites.forEach((invite) => this.invites.set(invite.id, invite));
      sessions.forEach((session) => this.sessions.set(session.id, session));
    });
  }

  private persistState(): void {
    if (!this.stateFilePath || this.suspendPersistence) {
      return;
    }

    fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
    const snapshot: OnboardingSnapshot = {
      invites: [...this.invites.values()],
      sessions: [...this.sessions.values()],
    };
    const tempPath = `${this.stateFilePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tempPath, this.stateFilePath);
  }

  private runWithoutPersistence<T>(callback: () => T): T {
    this.suspendPersistence = true;
    try {
      return callback();
    } finally {
      this.suspendPersistence = false;
    }
  }

  createInvite(input: {
    staffId: string;
    fullName: string;
    email?: string;
    phoneNumber?: string;
    role?: string;
    ttlHours?: number;
  }): OnboardingInviteRecord {
    const ttlHours = Math.min(Math.max(input.ttlHours ?? 72, 1), 24 * 14);
    const now = new Date();
    const record: OnboardingInviteRecord = {
      id: crypto.randomUUID(),
      code: crypto.randomBytes(16).toString("hex"),
      staffId: input.staffId,
      fullName: input.fullName,
      email: input.email,
      phoneNumber: input.phoneNumber,
      role: input.role,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
    };

    this.invites.set(record.id, record);
    this.persistState();
    return record;
  }

  getInviteByCode(code: string): OnboardingInviteRecord | undefined {
    const invite = [...this.invites.values()].find((record) => record.code === code);
    if (!invite) {
      return undefined;
    }

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      invite.status = "expired";
      this.invites.set(invite.id, invite);
      this.persistState();
      return undefined;
    }

    return invite;
  }

  startSession(inviteCode: string): OnboardingSessionRecord | undefined {
    const invite = this.getInviteByCode(inviteCode);
    if (!invite) {
      return undefined;
    }

    if (invite.sessionId) {
      const existing = this.sessions.get(invite.sessionId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const session: OnboardingSessionRecord = {
      id: crypto.randomUUID(),
      inviteId: invite.id,
      inviteCode: invite.code,
      staffId: invite.staffId,
      staffName: invite.fullName,
      participantToken: crypto.randomBytes(24).toString("hex"),
      status: "pending",
      consentAccepted: false,
      cloneConsentAccepted: false,
      createdAt: now,
      updatedAt: now,
      turns: [],
      analysis: createDefaultAnalysis(),
      review: createDefaultReview(invite.fullName),
    };

    invite.status = "started";
    invite.sessionId = session.id;
    this.invites.set(invite.id, invite);
    this.sessions.set(session.id, session);
    this.persistState();
    return session;
  }

  getSession(sessionId: string): OnboardingSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  authenticateSession(sessionId: string, token: string): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.participantToken !== token) {
      return undefined;
    }
    return session;
  }

  findSessionByCalendarState(state: string): OnboardingSessionRecord | undefined {
    return [...this.sessions.values()].find((session) => session.calendar?.authState === state);
  }

  saveSession(session: OnboardingSessionRecord): OnboardingSessionRecord {
    session.updatedAt = new Date().toISOString();
    this.sessions.set(session.id, session);
    this.persistState();
    return session;
  }

  setConsent(sessionId: string, consentAccepted: boolean, cloneConsentAccepted: boolean): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.consentAccepted = consentAccepted;
    session.cloneConsentAccepted = cloneConsentAccepted;
    if (session.status === "pending" && consentAccepted) {
      session.status = "interviewing";
    }
    return this.saveSession(session);
  }

  setVoiceSession(sessionId: string, voiceSession: RealtimeVoiceSessionRecord): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.voiceSession = voiceSession;
    if (session.status === "pending") {
      session.status = "interviewing";
    }
    return this.saveSession(session);
  }

  appendTurn(sessionId: string, turn: Omit<InterviewTurnRecord, "id" | "createdAt">): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.turns.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...turn,
    });
    session.status = "interviewing";
    return this.saveSession(session);
  }

  setAnalysis(sessionId: string, analysis: OnboardingAnalysisRecord): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.analysis = analysis;
    if (analysis.coverageScore >= 0.7 && session.status === "interviewing") {
      session.status = "review";
    }
    return this.saveSession(session);
  }

  updateReview(sessionId: string, review: ExtractionReviewRecord): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.review = review;
    session.status = session.calendar?.status === "connected" ? "voice_sample" : "review";
    return this.saveSession(session);
  }

  setCalendar(sessionId: string, calendar: CalendarConnectionRecord): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.calendar = calendar;
    session.status = calendar.status === "connected" ? "voice_sample" : "calendar";
    return this.saveSession(session);
  }

  setVoiceSample(sessionId: string, sample: VoiceSampleAssessmentRecord): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.voiceSample = sample;
    session.status = "voice_sample";
    return this.saveSession(session);
  }

  finalizeSession(sessionId: string): OnboardingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.status = "completed";
    this.saveSession(session);

    const invite = this.invites.get(session.inviteId);
    if (invite) {
      invite.status = "completed";
      this.invites.set(invite.id, invite);
      this.persistState();
    }

    return session;
  }
}

export const onboardingStore = new OnboardingStore();
