import { onboardingChecklist } from "./checklist.js";
import { constantTimeEqual, createId, createInviteCode, createParticipantToken, isExpired, sha256Hex } from "./crypto.js";
import type { AppConfig } from "./env.js";
import type {
  CalendarConnectionSummary,
  ExtractionReview,
  InterviewTurn,
  InviteRecord,
  OnboardingChecklistPrompt,
  OnboardingSessionRecord,
  OnboardingSessionSummary,
  VoiceSampleAssessment,
} from "./models.js";
import { createDefaultAnalysis, normalizeReview } from "./models.js";
import type { CalendarAdapter } from "./providers/calendar.js";
import type { RealtimeVoiceProvider } from "./providers/realtime.js";
import type { ReasoningProvider } from "./providers/reasoning.js";
import type { VoiceCloneProvider } from "./providers/voice-clone.js";
import type { ObjectStore } from "./storage/artifacts.js";
import type { OnboardingRepository } from "./storage/repository.js";

export class OnboardingRuleError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "OnboardingRuleError";
  }
}

export interface ServiceProviders {
  realtimeVoice: RealtimeVoiceProvider;
  reasoning: ReasoningProvider;
  calendar: CalendarAdapter;
  voiceClone: VoiceCloneProvider;
}

export interface OnboardingServiceOptions {
  repo: OnboardingRepository;
  config: AppConfig;
  providers: ServiceProviders;
  objectStore: ObjectStore;
  coordinatorNamespace?: DurableObjectNamespace;
}

export interface ExtractionReviewPatch {
  businessSummary?: string;
  staffProfile?: Partial<ExtractionReview["staffProfile"]>;
  communicationProfile?: Partial<ExtractionReview["communicationProfile"]>;
  pricingProfile?: Partial<ExtractionReview["pricingProfile"]>;
  businessPractices?: Partial<ExtractionReview["businessPractices"]>;
  crmDiscovery?: Partial<ExtractionReview["crmDiscovery"]>;
  missingFields?: string[];
}

export class OnboardingService {
  constructor(private readonly options: OnboardingServiceOptions) {}

  getChecklist(): OnboardingChecklistPrompt[] {
    return onboardingChecklist.map(({ keywords: _keywords, ...item }) => item);
  }

  async createInvite(input: {
    fullName: string;
    phoneNumber?: string;
    email?: string;
    role?: string;
    ttlHours?: number;
  }) {
    const now = new Date();
    const invite: InviteRecord = {
      id: createId("invite"),
      code: createInviteCode(),
      staffId: createId("staff"),
      fullName: input.fullName,
      email: input.email,
      phoneNumber: input.phoneNumber,
      role: input.role,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (input.ttlHours ?? 72) * 60 * 60 * 1000).toISOString(),
    };
    await this.options.repo.createInvite(invite);

    const url = new URL(`/onboard/${invite.code}`, this.options.config.publicOnboardingAppUrl);
    return {
      invite,
      url: url.toString(),
      staff: {
        id: invite.staffId,
        fullName: invite.fullName,
        role: invite.role,
        email: invite.email,
        phoneNumber: invite.phoneNumber,
      },
    };
  }

  async startSession(inviteCode: string): Promise<{ summary: OnboardingSessionSummary; participantToken: string } | undefined> {
    const invite = await this.options.repo.getInviteByCode(inviteCode);
    if (!invite || isExpired(invite.expiresAt) || invite.status === "completed") {
      return undefined;
    }

    const rawParticipantToken = createParticipantToken();
    const participantTokenHash = await sha256Hex(rawParticipantToken);
    const now = new Date().toISOString();
    let session = invite.sessionId ? await this.options.repo.getSessionById(invite.sessionId) : undefined;
    if (session && !isExpired(session.expiresAt) && session.status !== "completed") {
      throw new OnboardingRuleError(
        "This onboarding invite already has an active session. Resume it from the original browser tab or issue a new invite.",
        409,
      );
    }
    if (!session || isExpired(session.expiresAt) || session.status === "completed") {
      const starterPrompt = onboardingChecklist[0];
      session = {
        id: createId("sess"),
        inviteId: invite.id,
        inviteCode: invite.code,
        staffId: invite.staffId,
        staffName: invite.fullName,
        participantTokenHash,
        expiresAt: invite.expiresAt,
        status: "pending",
        consentAccepted: false,
        cloneConsentAccepted: false,
        createdAt: now,
        updatedAt: now,
        analysis: {
          ...createDefaultAnalysis(),
          recommendedQuestions: starterPrompt
            ? [
                {
                  id: starterPrompt.id,
                  section: starterPrompt.section,
                  reason: "Start by establishing the core work types the agent should qualify.",
                  question: starterPrompt.prompt,
                },
              ]
            : [],
        },
        review: normalizeReview(undefined, invite.fullName, invite.role),
      };
      invite.sessionId = session.id;
    }

    invite.status = "started";
    await Promise.all([this.options.repo.saveInvite(invite), this.options.repo.saveSession(session)]);
    const turns = await this.options.repo.listTurns(session.id);
    return {
      summary: this.toSessionSummary(session, turns, rawParticipantToken),
      participantToken: rawParticipantToken,
    };
  }

  async rollbackSessionStart(inviteCode: string, sessionId: string): Promise<void> {
    const invite = await this.options.repo.getInviteByCode(inviteCode);
    if (!invite || invite.sessionId !== sessionId) {
      return;
    }
    invite.sessionId = undefined;
    invite.status = "pending";
    await this.options.repo.saveInvite(invite);
  }

  async authenticateSession(sessionId: string, token: string): Promise<OnboardingSessionRecord | undefined> {
    const session = await this.options.repo.getSessionById(sessionId);
    if (!session || isExpired(session.expiresAt)) {
      return undefined;
    }
    const tokenHash = await sha256Hex(token);
    if (!constantTimeEqual(tokenHash, session.participantTokenHash)) {
      return undefined;
    }
    return session;
  }

  async getSessionSummary(session: OnboardingSessionRecord, participantToken?: string) {
    const turns = await this.options.repo.listTurns(session.id);
    return this.toSessionSummary(session, turns, participantToken);
  }

  private ensureMutable(session: OnboardingSessionRecord, action: string) {
    if (session.status === "completed") {
      throw new OnboardingRuleError(`Completed onboarding sessions cannot ${action}.`, 409);
    }
    if (isExpired(session.expiresAt)) {
      throw new OnboardingRuleError("This onboarding session has expired.", 410);
    }
  }

  async provisionRealtimeVoice(
    session: OnboardingSessionRecord,
    input: { consentAccepted: boolean; cloneConsentAccepted: boolean },
  ) {
    if (!input.consentAccepted || !input.cloneConsentAccepted) {
      throw new OnboardingRuleError(
        "Recording consent and voice clone consent are required before starting the realtime interview.",
        400,
      );
    }

    this.ensureMutable(session, "start a new realtime interview");
    const voiceSession = await this.options.providers.realtimeVoice.issueBrowserSession({
      sessionId: session.id,
    });
    session.consentAccepted = input.consentAccepted;
    session.cloneConsentAccepted = input.cloneConsentAccepted;
    session.voiceSession = voiceSession;
    session.status = "interviewing";
    session.updatedAt = new Date().toISOString();
    await this.options.repo.saveSession(session);
    await this.touchCoordinator(session.id, "voice-session", session.status);
    return this.getSessionSummary(session);
  }

  async appendTurn(
    session: OnboardingSessionRecord,
    input: { speaker: InterviewTurn["speaker"]; text: string; questionId?: string },
  ) {
    this.ensureMutable(session, "accept more interview turns");
    const turn: InterviewTurn = {
      id: createId("turn"),
      speaker: input.speaker,
      text: input.text,
      questionId: input.questionId,
      createdAt: new Date().toISOString(),
    };
    await this.options.repo.appendTurn(session.id, turn);
    const turns = await this.options.repo.listTurns(session.id);
    const { analysis, review } = await this.options.providers.reasoning.analyzeSession(session, turns);
    session.analysis = analysis;
    session.review = normalizeReview(review, session.staffName, session.review.staffProfile.role);
    session.updatedAt = new Date().toISOString();
    session.status = analysis.coverageScore >= 0.7 ? "review" : "interviewing";
    await this.options.repo.saveSession(session);
    await this.touchCoordinator(session.id, "append-turn", session.status);
    return this.toSessionSummary(session, turns, "");
  }

  async updateReview(session: OnboardingSessionRecord, patch: ExtractionReviewPatch) {
    this.ensureMutable(session, "change the extraction review");
    session.review = normalizeReview(
      {
        ...session.review,
        ...patch,
        staffProfile: {
          ...session.review.staffProfile,
          ...(patch.staffProfile ?? {}),
        },
        communicationProfile: {
          ...session.review.communicationProfile,
          ...(patch.communicationProfile ?? {}),
        },
        pricingProfile: {
          ...session.review.pricingProfile,
          ...(patch.pricingProfile ?? {}),
        },
        businessPractices: {
          ...session.review.businessPractices,
          ...(patch.businessPractices ?? {}),
        },
        crmDiscovery: {
          ...session.review.crmDiscovery,
          ...(patch.crmDiscovery ?? {}),
        },
      },
      session.staffName,
      session.review.staffProfile.role,
    );
    session.staffName = session.review.staffProfile.staffName.trim() || session.staffName;
    session.updatedAt = new Date().toISOString();
    session.status = session.calendar?.status === "connected" ? "voice_sample" : "review";
    await this.options.repo.saveSession(session);
    await this.touchCoordinator(session.id, "review", session.status);
    return this.getSessionSummary(session);
  }

  async startCalendar(session: OnboardingSessionRecord) {
    this.ensureMutable(session, "start calendar authorization");
    const calendar = await this.options.providers.calendar.startAuth({
      staffName: session.review.staffProfile.staffName.trim() || session.staffName,
      publicApiUrl: this.options.config.publicApiUrl,
      redirectUri: `${this.options.config.publicApiUrl.replace(/\/$/, "")}/onboarding/calendar/microsoft/callback`,
    });
    session.calendar = calendar;
    session.status = calendar.status === "connected" ? "voice_sample" : "calendar";
    session.updatedAt = new Date().toISOString();
    await this.options.repo.saveSession(session);
    await this.touchCoordinator(session.id, "calendar-start", session.status);
    return this.getSessionSummary(session);
  }

  async completeCalendar(
    state: string,
    input: { code?: string; accountEmail?: string; calendarLabel?: string; redirectUri?: string },
  ) {
    const session = await this.options.repo.getSessionByCalendarState(state);
    if (!session) {
      return undefined;
    }
    this.ensureMutable(session, "complete calendar authorization");
    if (!session.calendar?.authState || session.calendar.authState !== state) {
      throw new OnboardingRuleError("Microsoft calendar authorization state is invalid or has already been used.", 400);
    }
    if (this.options.providers.calendar.mode === "configured" && !input.code) {
      throw new OnboardingRuleError("Microsoft returned no authorization code.", 400);
    }

    const completed = await this.options.providers.calendar.completeAuth({
      state,
      code: input.code,
      accountEmail: input.accountEmail,
      calendarLabel: input.calendarLabel,
      redirectUri: input.redirectUri,
    });
    const updatedAt = new Date().toISOString();
    const invite = await this.options.repo.getInviteById(session.inviteId);
    await this.options.repo.upsertStaffProfile({
      staffId: session.staffId,
      fullName: session.review.staffProfile.staffName.trim() || session.staffName,
      phoneNumber: invite?.phoneNumber,
      email: invite?.email,
      role: session.review.staffProfile.role || invite?.role,
      companyName: session.review.staffProfile.companyName || undefined,
      calendarProvider: "outlook",
      communication: undefined,
      pricing: undefined,
      business: undefined,
      crm: undefined,
      updatedAt,
    });
    await this.options.repo.saveStaffCalendarConnection({
      staffId: session.staffId,
      provider: "outlook",
      status: completed.summary.status,
      accountEmail: completed.summary.accountEmail,
      calendarId: completed.summary.calendarId,
      calendarLabel: completed.summary.calendarLabel,
      timezone: undefined,
      authState: undefined,
      accessToken: completed.credential?.accessToken,
      refreshToken: completed.credential?.refreshToken,
      tokenExpiresAt: completed.credential?.tokenExpiresAt,
      lastError: undefined,
      connectedAt: completed.summary.connectedAt ?? updatedAt,
      updatedAt,
    });
    session.review.staffProfile.calendarProvider = "outlook";
    session.calendar = {
      ...completed.summary,
      authState: undefined,
      authUrl: undefined,
    };
    session.status = "voice_sample";
    session.updatedAt = updatedAt;
    await this.options.repo.saveSession(session);
    await this.touchCoordinator(session.id, "calendar-complete", session.status);
    return this.getSessionSummary(session);
  }

  async assessVoiceSample(
    session: OnboardingSessionRecord,
    input: {
      sampleLabel: string;
      durationSeconds: number;
      transcript?: string;
      noiseLevel?: "low" | "medium" | "high";
      file: {
        blob: Blob;
        originalName?: string;
        mimeType?: string;
      };
    },
  ) {
    this.ensureMutable(session, "replace the voice sample");
    if (!session.cloneConsentAccepted) {
      throw new OnboardingRuleError("Voice clone consent is required before uploading a voice sample.", 400);
    }

    const previousStoredPath = session.voiceSample?.storedPath;
    const key = `uploads/voice-samples/${session.id}/${Date.now()}-${sanitizeFilename(input.file.originalName ?? "voice-sample.webm")}`;
    const storedPath = await this.options.objectStore.put(key, input.file.blob, {
      contentType: input.file.mimeType,
    });

    const assessment = await this.options.providers.voiceClone.assessSample(input);
    const enrichedAssessment: VoiceSampleAssessment = {
      ...assessment,
      originalName: input.file.originalName,
      storedPath,
      mimeType: input.file.mimeType,
    };
    session.voiceSample = enrichedAssessment;
    session.status = "voice_sample";
    session.updatedAt = new Date().toISOString();
    if (previousStoredPath && previousStoredPath !== storedPath) {
      await this.options.objectStore.delete(previousStoredPath);
    }
    await this.options.repo.saveSession(session);
    await this.touchCoordinator(session.id, "voice-sample", session.status);
    return this.getSessionSummary(session);
  }

  async finalize(session: OnboardingSessionRecord) {
    this.ensureMutable(session, "finalize a completed onboarding profile");
    if (!session.consentAccepted || !session.cloneConsentAccepted) {
      throw new OnboardingRuleError("Consent must be captured before onboarding can be finalized.", 400);
    }
    if (session.calendar?.status !== "connected") {
      throw new OnboardingRuleError("Connect the staff calendar before finalizing onboarding.", 400);
    }
    if (!session.voiceSample?.storedPath) {
      throw new OnboardingRuleError("Upload a voice sample before finalizing onboarding.", 400);
    }

    const invite = await this.options.repo.getInviteById(session.inviteId);
    const finalizedAt = new Date().toISOString();
    const effectiveName = session.review.staffProfile.staffName.trim() || session.staffName;
    await Promise.all([
      this.options.repo.upsertStaffProfile({
        staffId: session.staffId,
        fullName: effectiveName,
        phoneNumber: invite?.phoneNumber,
        email: invite?.email,
        role: session.review.staffProfile.role || undefined,
        companyName: session.review.staffProfile.companyName || undefined,
        calendarProvider: session.review.staffProfile.calendarProvider || undefined,
        communication: session.review.communicationProfile,
        pricing: session.review.pricingProfile,
        business: session.review.businessPractices,
        crm: session.review.crmDiscovery,
        updatedAt: finalizedAt,
      }),
      this.options.repo.recordVoiceConsent({
        staffId: session.staffId,
        consent: session.cloneConsentAccepted,
        signedBy: effectiveName,
        capturedAt: session.voiceSample.capturedAt,
      }),
      this.options.repo.savePricingInterview({
        staffId: session.staffId,
        responses: {
          summary: session.review.businessSummary,
          services: session.review.businessPractices.services,
          serviceAreas: session.review.businessPractices.serviceAreas,
          quotingStyle: session.review.pricingProfile.quotingStyle,
          salesStyle: session.review.communicationProfile.salesStyle,
          crm: session.review.crmDiscovery.currentSystem,
        },
        capturedAt: finalizedAt,
      }),
    ]);

    session.status = "completed";
    session.finalizedAt = finalizedAt;
    session.updatedAt = finalizedAt;
    session.participantTokenHash = await sha256Hex(createParticipantToken());
    await this.options.repo.saveSession(session);

    if (invite) {
      invite.status = "completed";
      invite.sessionId = session.id;
      await this.options.repo.saveInvite(invite);
    }

    await this.touchCoordinator(session.id, "finalize", session.status);

    return {
      session: await this.getSessionSummary(session),
      staff: {
        id: session.staffId,
      },
    };
  }

  private toSessionSummary(
    session: OnboardingSessionRecord,
    turns: InterviewTurn[],
    participantToken?: string,
  ): OnboardingSessionSummary {
    return {
      id: session.id,
      inviteCode: session.inviteCode,
      status: session.status,
      staffId: session.staffId,
      staffName: session.review.staffProfile.staffName.trim() || session.staffName,
      participantToken,
      expiresAt: session.expiresAt,
      consentAccepted: session.consentAccepted,
      cloneConsentAccepted: session.cloneConsentAccepted,
      coverageScore: session.analysis.coverageScore,
      nextQuestion: session.analysis.recommendedQuestions[0] ?? null,
      review: session.review,
      analysis: session.analysis,
      voiceSession: session.voiceSession,
      calendar: session.calendar,
      voiceSample: session.voiceSample
        ? {
            ...session.voiceSample,
            storedPath: undefined,
          }
        : undefined,
      turns,
      updatedAt: session.updatedAt,
    };
  }

  private async touchCoordinator(sessionId: string, type: string, status: string): Promise<void> {
    const namespace = this.options.coordinatorNamespace;
    if (!namespace) {
      return;
    }
    const stub = namespace.get(namespace.idFromName(sessionId));
    await stub.fetch("https://internal/onboarding/touch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ type, status }),
    });
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
