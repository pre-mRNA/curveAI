import crypto from "node:crypto";
import { onboardingChecklist } from "./checklist";
import type {
  CalendarConnectionRecord,
  CoverageItemRecord,
  ExtractionReviewRecord,
  OnboardingAnalysisRecord,
  OnboardingProviderMode,
  OnboardingSessionRecord,
  RealtimeVoiceSessionRecord,
  SupervisorPromptRecord,
  VoiceSampleAssessmentRecord,
} from "../store/onboarding-store";

export interface RealtimeVoiceProvider {
  issueBrowserSession(input: {
    sessionId: string;
    staffName: string;
    consentAccepted: boolean;
  }): Promise<RealtimeVoiceSessionRecord>;
}

export interface ReasoningProvider {
  analyzeSession(session: OnboardingSessionRecord): Promise<{
    analysis: OnboardingAnalysisRecord;
    review: ExtractionReviewRecord;
  }>;
}

export interface VoiceCloneProvider {
  assessSample(input: {
    sampleLabel: string;
    durationSeconds: number;
    transcript?: string;
    noiseLevel?: "low" | "medium" | "high";
  }): Promise<VoiceSampleAssessmentRecord>;
}

export interface CalendarAdapter {
  startAuth(input: {
    sessionId: string;
    inviteCode: string;
    staffName: string;
    publicBaseUrl: string;
    publicAppUrl: string;
  }): Promise<CalendarConnectionRecord>;
  completeAuth(input: {
    state: string;
    code?: string;
    accountEmail?: string;
    calendarLabel?: string;
  }): Promise<CalendarConnectionRecord>;
}

export class MockRealtimeVoiceProvider implements RealtimeVoiceProvider {
  constructor(
    private readonly config: {
      provider?: string;
      mode?: OnboardingProviderMode;
      websocketUrl?: string;
    } = {},
  ) {}

  async issueBrowserSession(input: {
    sessionId: string;
    staffName: string;
    consentAccepted: boolean;
  }): Promise<RealtimeVoiceSessionRecord> {
    return {
      provider: this.config.provider ?? "elevenlabs-browser",
      mode: this.config.mode ?? "mock",
      sessionToken: crypto.randomBytes(24).toString("hex"),
      interviewerModel: "realtime-lite",
      supervisorModel: "frontier-reasoning",
      websocketUrl:
        this.config.websocketUrl ??
        `wss://mock.voice.local/session/${encodeURIComponent(input.sessionId)}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }
}

export class MockReasoningProvider implements ReasoningProvider {
  async analyzeSession(session: OnboardingSessionRecord): Promise<{
    analysis: OnboardingAnalysisRecord;
    review: ExtractionReviewRecord;
  }> {
    const participantTurns = session.turns.filter((turn) => turn.speaker === "participant");
    const combinedText = participantTurns.map((turn) => turn.text.toLowerCase()).join(" ");
    const coverage: CoverageItemRecord[] = onboardingChecklist.map((item) => {
      const matchingTurns = participantTurns.filter((turn) =>
        item.keywords.some((keyword) => turn.text.toLowerCase().includes(keyword)),
      );
      return {
        id: item.id,
        section: item.section,
        title: item.title,
        prompt: item.prompt,
        status: matchingTurns.length
          ? matchingTurns.length > 1
            ? "covered"
            : "needs_follow_up"
          : "pending",
        evidence: matchingTurns.slice(-2).map((turn) => turn.text),
      };
    });

    const uncovered = coverage.filter((item) => item.status !== "covered");
    const recommendedQuestions: SupervisorPromptRecord[] = uncovered.slice(0, 3).map((item) => ({
      id: item.id,
      section: item.section,
      reason:
        item.status === "needs_follow_up"
          ? "The topic was mentioned briefly but still needs a tighter operating rule."
          : "The checklist still needs an answer for this area.",
      question: item.prompt,
    }));

    const coverageScore =
      coverage.length === 0
        ? 0
        : Number(
            (
              coverage.filter((item) => item.status === "covered").length / coverage.length
            ).toFixed(2),
          );

    const services = collectMatches(participantTurns, [
      "plumbing",
      "electrical",
      "aircon",
      "hvac",
      "drain",
      "hot water",
      "gas",
      "solar",
      "maintenance",
    ]);
    const serviceAreas = collectMatches(participantTurns, [
      "sydney",
      "inner west",
      "eastern suburbs",
      "north shore",
      "west",
      "metro",
      "newcastle",
      "wollongong",
      "parramatta",
    ]);
    const exclusions = collectMatches(participantTurns, [
      "commercial",
      "roof",
      "blocked drain",
      "after hours",
      "emergency only",
      "strata",
    ]);

    const review: ExtractionReviewRecord = {
      businessSummary:
        participantTurns[0]?.text ??
        session.review.businessSummary ??
        `${session.staffName} onboarding interview is in progress.`,
      staffProfile: {
        ...session.review.staffProfile,
        staffName: session.review.staffProfile.staffName || session.staffName,
      },
      communicationProfile: {
        tone: detectFirstMatch(combinedText, [
          ["friendly", "Warm and friendly"],
          ["direct", "Direct and efficient"],
          ["professional", "Professional and calm"],
          ["chatty", "Conversational and reassuring"],
        ]) ?? session.review.communicationProfile.tone,
        salesStyle: detectFirstMatch(combinedText, [
          ["upsell", "Proactively upsell when useful"],
          ["consult", "Consultative and advice-led"],
          ["brief", "Keep it brief and practical"],
          ["explain", "Explain trade-offs before booking"],
        ]) ?? session.review.communicationProfile.salesStyle,
        riskTolerance: detectFirstMatch(combinedText, [
          ["callback", "Escalate uncertain quotes to callback"],
          ["book", "Book directly when confidence is high"],
          ["approve", "Require approval above threshold"],
        ]) ?? session.review.communicationProfile.riskTolerance,
        customerHandlingRules:
          collectSentenceRules(participantTurns, ["always", "never", "prefer", "must"]).length > 0
            ? collectSentenceRules(participantTurns, ["always", "never", "prefer", "must"])
            : session.review.communicationProfile.customerHandlingRules,
      },
      pricingProfile: {
        quotingStyle:
          detectFirstMatch(combinedText, [
            ["fixed", "Prefer fixed-price quoting when scope is clear"],
            ["hourly", "Use hourly quoting when diagnosis is uncertain"],
            ["photos", "Request photos before finalising uncertain quotes"],
          ]) ?? session.review.pricingProfile.quotingStyle,
        calloutPolicy:
          detectFirstMatch(combinedText, [
            ["callout", "Uses a callout fee"],
            ["free quote", "Avoids charging for simple quoting"],
            ["minimum", "Uses a minimum job price"],
          ]) ?? session.review.pricingProfile.calloutPolicy,
        afterHoursPolicy:
          detectFirstMatch(combinedText, [
            ["after hours", "After-hours premium applies"],
            ["weekend", "Weekend pricing differs from weekday pricing"],
            ["emergency", "Emergency work uses separate pricing"],
          ]) ?? session.review.pricingProfile.afterHoursPolicy,
        approvalThreshold:
          detectFirstMatch(combinedText, [
            ["approval", "Escalate larger jobs for approval"],
            ["over", "Approval threshold is mentioned in the interview"],
            ["deposit", "Collect a deposit before booking larger work"],
          ]) ?? session.review.pricingProfile.approvalThreshold,
      },
      businessPractices: {
        services: services.length > 0 ? services : session.review.businessPractices.services,
        serviceAreas: serviceAreas.length > 0 ? serviceAreas : session.review.businessPractices.serviceAreas,
        operatingHours:
          detectFirstMatch(combinedText, [
            ["24/7", "Works 24/7 or always-on emergency coverage"],
            ["weekend", "Handles weekday and weekend work"],
            ["after hours", "After-hours availability is enabled"],
            ["9 to 5", "Standard business hours mentioned"],
          ]) ?? session.review.businessPractices.operatingHours,
        exclusions: exclusions.length > 0 ? exclusions : session.review.businessPractices.exclusions,
        escalationRules:
          collectSentenceRules(participantTurns, ["callback", "escalate", "approval", "book"]).length > 0
            ? collectSentenceRules(participantTurns, ["callback", "escalate", "approval", "book"])
            : session.review.businessPractices.escalationRules,
      },
      crmDiscovery: {
        currentSystem:
          detectFirstMatch(combinedText, [
            ["servicem8", "ServiceM8"],
            ["simpro", "simPRO"],
            ["fergus", "Fergus"],
            ["jobber", "Jobber"],
            ["spreadsheet", "Spreadsheet"],
          ]) ?? session.review.crmDiscovery.currentSystem,
        syncPreference:
          detectFirstMatch(combinedText, [
            ["sync", "Wants system sync"],
            ["manual", "Manual sync is acceptable"],
            ["import", "Prefers import/export workflows first"],
          ]) ?? session.review.crmDiscovery.syncPreference,
        sourceOfTruth:
          detectFirstMatch(combinedText, [
            ["crm", "CRM is the source of truth"],
            ["calendar", "Calendar is the operational source of truth"],
            ["phone", "Phone-first workflow with manual updates"],
          ]) ?? session.review.crmDiscovery.sourceOfTruth,
        notes:
          collectSentenceRules(participantTurns, ["crm", "system", "software", "workflow"]).length > 0
            ? collectSentenceRules(participantTurns, ["crm", "system", "software", "workflow"])
            : session.review.crmDiscovery.notes,
      },
      missingFields: uncovered.map((item) => item.title),
    };

    return {
      analysis: {
        coverage,
        recommendedQuestions,
        coverageScore,
        interviewerBrief:
          recommendedQuestions.length > 0
            ? `Ask the next question about ${recommendedQuestions[0]?.section} and keep it brief.`
            : "The checklist is sufficiently covered. Move to review and confirmation.",
      },
      review,
    };
  }
}

export class MockVoiceCloneProvider implements VoiceCloneProvider {
  async assessSample(input: {
    sampleLabel: string;
    durationSeconds: number;
    transcript?: string;
    noiseLevel?: "low" | "medium" | "high";
  }): Promise<VoiceSampleAssessmentRecord> {
    const transcriptLength = input.transcript?.trim().length ?? 0;
    const durationScore = Math.min(Math.max(input.durationSeconds / 90, 0.2), 1);
    const noisePenalty =
      input.noiseLevel === "high" ? 0.35 : input.noiseLevel === "medium" ? 0.18 : 0.05;
    const transcriptBonus = transcriptLength > 80 ? 0.08 : 0;
    const qualityScore = Number(Math.max(0.15, Math.min(0.98, durationScore - noisePenalty + transcriptBonus)).toFixed(2));

    return {
      sampleLabel: input.sampleLabel,
      recommendedForClone: qualityScore >= 0.62,
      qualityScore,
      reasons:
        qualityScore >= 0.62
          ? ["The sample length and clarity are sufficient for a first cloning pass."]
          : [
              "Record a longer sample in a quieter environment.",
              "Use a headset or phone mic close to the speaker and avoid interruptions.",
            ],
      durationSeconds: input.durationSeconds,
      capturedAt: new Date().toISOString(),
    };
  }
}

export class MockMicrosoftCalendarAdapter implements CalendarAdapter {
  constructor(
    private readonly config: {
      clientId?: string;
      tenantId?: string;
      clientSecret?: string;
      redirectUri?: string;
      graphBaseUrl?: string;
    } = {},
  ) {}

  private isConfigured(): boolean {
    return Boolean(
      this.config.clientId &&
        this.config.tenantId &&
        this.config.clientSecret &&
        this.config.redirectUri,
    );
  }

  async startAuth(input: {
    sessionId: string;
    inviteCode: string;
    staffName: string;
    publicBaseUrl: string;
    publicAppUrl: string;
  }): Promise<CalendarConnectionRecord> {
    const state = crypto.randomBytes(18).toString("hex");
    const callbackUrl =
      this.config.redirectUri ??
      `${input.publicBaseUrl.replace(/\/$/, "")}/onboarding/calendar/microsoft/callback`;
    const authUrl =
      this.isConfigured()
        ? `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId ?? "common")}/oauth2/v2.0/authorize?client_id=${encodeURIComponent(this.config.clientId ?? "")}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent("openid profile email offline_access User.Read Calendars.ReadWrite")}&state=${encodeURIComponent(state)}`
        : `${callbackUrl}?state=${encodeURIComponent(state)}&code=mock-code&email=${encodeURIComponent(`${slugify(input.staffName)}@example.com`)}&calendar=${encodeURIComponent(`${input.staffName} Calendar`)}&invite=${encodeURIComponent(input.inviteCode)}`;

    return {
      provider: "microsoft",
      mode: this.isConfigured() ? "configured" : "mock",
      status: "pending",
      authUrl,
      authState: state,
    };
  }

  async completeAuth(input: {
    state: string;
    code?: string;
    accountEmail?: string;
    calendarLabel?: string;
  }): Promise<CalendarConnectionRecord> {
    if (this.isConfigured()) {
      if (!input.code) {
        throw new Error("Microsoft authorization code is required.");
      }

      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId ?? "common")}/oauth2/v2.0/token`;
      const tokenBody = new URLSearchParams({
        client_id: this.config.clientId ?? "",
        client_secret: this.config.clientSecret ?? "",
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri ?? "",
      });

      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
      });
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => "");
        throw new Error(`Microsoft token exchange failed${errorText ? `: ${errorText}` : "."}`);
      }

      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenPayload.access_token) {
        throw new Error("Microsoft token exchange returned no access token.");
      }

      const graphBaseUrl = this.config.graphBaseUrl ?? "https://graph.microsoft.com";
      const graphHeaders = {
        authorization: `Bearer ${tokenPayload.access_token}`,
      };

      const profileResponse = await fetch(`${graphBaseUrl}/v1.0/me?$select=mail,userPrincipalName,displayName`, {
        headers: graphHeaders,
      });
      if (!profileResponse.ok) {
        const errorText = await profileResponse.text().catch(() => "");
        throw new Error(`Microsoft profile lookup failed${errorText ? `: ${errorText}` : "."}`);
      }

      const profile = (await profileResponse.json()) as {
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      };

      let calendarLabel = "Primary";
      const calendarResponse = await fetch(`${graphBaseUrl}/v1.0/me/calendar?$select=name`, {
        headers: graphHeaders,
      });
      if (calendarResponse.ok) {
        const calendar = (await calendarResponse.json()) as { name?: string };
        if (calendar.name) {
          calendarLabel = calendar.name;
        }
      }

      return {
        provider: "microsoft",
        mode: "configured",
        status: "connected",
        accountEmail: profile.mail ?? profile.userPrincipalName ?? input.accountEmail,
        calendarLabel,
        connectedAt: new Date().toISOString(),
      };
    }

    return {
      provider: "microsoft",
      mode: "mock",
      status: "connected",
      authState: input.state,
      accountEmail: input.accountEmail ?? "connected@example.com",
      calendarLabel: input.calendarLabel ?? "Primary",
      connectedAt: new Date().toISOString(),
    };
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function collectMatches(turns: Array<{ text: string }>, keywords: string[]): string[] {
  const matches = new Set<string>();
  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());

  for (const turn of turns) {
    const text = turn.text.toLowerCase();
    loweredKeywords.forEach((keyword, index) => {
      if (text.includes(keyword)) {
        matches.add(keywords[index] ?? keyword);
      }
    });
  }

  return [...matches];
}

function detectFirstMatch(text: string, candidates: Array<[string, string]>): string | undefined {
  for (const [needle, result] of candidates) {
    if (text.includes(needle)) {
      return result;
    }
  }
  return undefined;
}

function collectSentenceRules(turns: Array<{ text: string }>, markers: string[]): string[] {
  const rules: string[] = [];

  for (const turn of turns) {
    const sentences = turn.text.split(/[.!?]/).map((value) => value.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const lowered = sentence.toLowerCase();
      if (markers.some((marker) => lowered.includes(marker))) {
        rules.push(sentence);
      }
    }
  }

  return [...new Set(rules)].slice(0, 4);
}
