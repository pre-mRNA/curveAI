import type { AppEnv } from "../config/env";
import type { CalendarAdapter, ReasoningProvider, RealtimeVoiceProvider, VoiceCloneProvider } from "./providers";
import { crmStore } from "../store/crm-store";
import {
  type BusinessPracticeProfileRecord,
  type CRMDiscoveryProfileRecord,
  type CommunicationProfileRecord,
  onboardingStore,
  type ExtractionReviewRecord,
  type OnboardingSessionRecord,
  type PricingProfileSummaryRecord,
} from "../store/onboarding-store";

export interface ExtractionReviewPatch {
  businessSummary?: string;
  communicationProfile?: Partial<CommunicationProfileRecord>;
  pricingProfile?: Partial<PricingProfileSummaryRecord>;
  businessPractices?: Partial<BusinessPracticeProfileRecord>;
  crmDiscovery?: Partial<CRMDiscoveryProfileRecord>;
  missingFields?: string[];
}

export class OnboardingRuleError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "OnboardingRuleError";
  }
}

export class OnboardingService {
  constructor(
    private readonly env: AppEnv,
    private readonly providers: {
      calendar: CalendarAdapter;
      reasoning: ReasoningProvider;
      realtimeVoice: RealtimeVoiceProvider;
      voiceClone: VoiceCloneProvider;
    },
  ) {}

  createInvite(input: {
    fullName: string;
    phoneNumber?: string;
    email?: string;
    role?: string;
    ttlHours?: number;
  }) {
    const staff = crmStore.ensureStaff({
      id: cryptoRandomId(),
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      email: input.email,
      role: input.role,
    });

    const invite = onboardingStore.createInvite({
      staffId: staff.id,
      fullName: staff.fullName,
      phoneNumber: staff.phoneNumber,
      email: staff.email,
      role: staff.role,
      ttlHours: input.ttlHours,
    });

    return {
      invite,
      url: `${this.env.publicAppUrl.replace(/\/$/, "")}/onboard/${invite.code}`,
      staff,
    };
  }

  startSession(inviteCode: string) {
    const session = onboardingStore.startSession(inviteCode);
    if (!session) {
      return undefined;
    }

    return this.toSessionSummary(session);
  }

  getSessionSummary(session: OnboardingSessionRecord) {
    return this.toSessionSummary(session);
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

    if (session.status === "completed") {
      throw new OnboardingRuleError("Completed onboarding sessions cannot start a new realtime interview.");
    }

    onboardingStore.setConsent(session.id, input.consentAccepted, input.cloneConsentAccepted);
    const voiceSession = await this.providers.realtimeVoice.issueBrowserSession({
      sessionId: session.id,
      staffName: session.staffName,
      consentAccepted: input.consentAccepted,
    });
    const updated = onboardingStore.setVoiceSession(session.id, voiceSession);
    return updated ? this.toSessionSummary(updated) : undefined;
  }

  async appendTurn(
    session: OnboardingSessionRecord,
    input: {
      speaker: "agent" | "participant" | "system";
      text: string;
      questionId?: string;
    },
  ) {
    const updated = onboardingStore.appendTurn(session.id, input);
    if (!updated) {
      return undefined;
    }

    const derived = await this.providers.reasoning.analyzeSession(updated);
    const withAnalysis = onboardingStore.setAnalysis(updated.id, derived.analysis);
    const withReview = withAnalysis ? onboardingStore.updateReview(withAnalysis.id, derived.review) : undefined;
    return withReview ? this.toSessionSummary(withReview) : undefined;
  }

  updateReview(session: OnboardingSessionRecord, patch: ExtractionReviewPatch) {
    const merged: ExtractionReviewRecord = {
      ...session.review,
      ...patch,
      communicationProfile: {
        ...session.review.communicationProfile,
        ...patch.communicationProfile,
      },
      pricingProfile: {
        ...session.review.pricingProfile,
        ...patch.pricingProfile,
      },
      businessPractices: {
        ...session.review.businessPractices,
        ...patch.businessPractices,
      },
      crmDiscovery: {
        ...session.review.crmDiscovery,
        ...patch.crmDiscovery,
      },
      missingFields: patch.missingFields ?? session.review.missingFields,
    };
    const updated = onboardingStore.updateReview(session.id, merged);
    return updated ? this.toSessionSummary(updated) : undefined;
  }

  async startCalendar(session: OnboardingSessionRecord) {
    const calendar = await this.providers.calendar.startAuth({
      sessionId: session.id,
      inviteCode: session.inviteCode,
      staffName: session.staffName,
      publicBaseUrl: this.env.publicBaseUrl,
      publicAppUrl: this.env.publicAppUrl,
    });
    const updated = onboardingStore.setCalendar(session.id, calendar);
    return updated ? this.toSessionSummary(updated) : undefined;
  }

  async completeCalendar(state: string, input: { code?: string; accountEmail?: string; calendarLabel?: string }) {
    const session = onboardingStore.findSessionByCalendarState(state);
    if (!session) {
      return undefined;
    }

    const calendar = await this.providers.calendar.completeAuth({
      state,
      code: input.code,
      accountEmail: input.accountEmail,
      calendarLabel: input.calendarLabel,
    });
    const updated = onboardingStore.setCalendar(session.id, calendar);
    if (!updated) {
      return undefined;
    }

    crmStore.connectCalendar({
      staffId: updated.staffId,
      provider: "outlook",
      accountEmail: calendar.accountEmail,
      calendarId: calendar.calendarLabel,
      timezone: "Australia/Sydney",
      externalConnectionId: state,
    });

    return this.toSessionSummary(updated);
  }

  async assessVoiceSample(
    session: OnboardingSessionRecord,
    input: {
      sampleLabel: string;
      durationSeconds: number;
      transcript?: string;
      noiseLevel?: "low" | "medium" | "high";
      file?: {
        originalName?: string;
        storedPath?: string;
        mimeType?: string;
      };
    },
  ) {
    if (!session.cloneConsentAccepted) {
      throw new OnboardingRuleError(
        "Voice clone consent is required before uploading a voice sample.",
        400,
      );
    }

    if (!input.file?.storedPath) {
      throw new OnboardingRuleError("An audio sample file is required before the voice sample can be assessed.", 400);
    }

    const assessment = await this.providers.voiceClone.assessSample(input);
    const enrichedAssessment = {
      ...assessment,
      originalName: input.file?.originalName,
      storedPath: input.file?.storedPath,
      mimeType: input.file?.mimeType,
    };
    const updated = onboardingStore.setVoiceSample(session.id, enrichedAssessment);
    return updated ? this.toSessionSummary(updated) : undefined;
  }

  finalize(session: OnboardingSessionRecord) {
    if (!session.consentAccepted || !session.cloneConsentAccepted) {
      throw new OnboardingRuleError("Consent must be captured before onboarding can be finalized.", 400);
    }

    if (session.calendar?.status !== "connected") {
      throw new OnboardingRuleError("Connect the staff calendar before finalizing onboarding.");
    }

    if (!session.voiceSample?.storedPath) {
      throw new OnboardingRuleError("Upload a voice sample before finalizing onboarding.");
    }

    const updated = onboardingStore.finalizeSession(session.id);
    if (!updated) {
      return undefined;
    }

    crmStore.ensureStaff({
      id: updated.staffId,
      fullName: updated.staffName,
    });

    crmStore.recordVoiceConsent({
      staffId: updated.staffId,
      consent: updated.cloneConsentAccepted,
      signedBy: updated.staffName,
      capturedAt: updated.voiceSample?.capturedAt ?? new Date().toISOString(),
    });

    crmStore.savePricingInterview({
      staffId: updated.staffId,
      responses: {
        summary: updated.review.businessSummary,
        services: updated.review.businessPractices.services,
        serviceAreas: updated.review.businessPractices.serviceAreas,
        quotingStyle: updated.review.pricingProfile.quotingStyle,
        salesStyle: updated.review.communicationProfile.salesStyle,
        crm: updated.review.crmDiscovery.currentSystem,
      },
    });

    return this.toSessionSummary(updated);
  }

  private toSessionSummary(session: OnboardingSessionRecord) {
    return {
      id: session.id,
      inviteCode: session.inviteCode,
      status: session.status,
      staffId: session.staffId,
      staffName: session.staffName,
      participantToken: session.participantToken,
      consentAccepted: session.consentAccepted,
      cloneConsentAccepted: session.cloneConsentAccepted,
      coverageScore: session.analysis.coverageScore,
      nextQuestion: session.analysis.recommendedQuestions[0] ?? null,
      review: session.review,
      analysis: session.analysis,
      voiceSession: session.voiceSession,
      calendar: session.calendar,
      voiceSample: session.voiceSample,
      turns: session.turns,
      updatedAt: session.updatedAt,
    };
  }
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
