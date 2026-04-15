import { onboardingChecklist } from "../checklist.js";
import type {
  CoverageItem,
  ExtractionReview,
  OnboardingAnalysis,
  OnboardingSessionRecord,
  SupervisorPrompt,
} from "../models.js";

export interface ReasoningProvider {
  readonly mode: "mock" | "hosted" | "openai-compatible";
  analyzeSession(session: OnboardingSessionRecord, turns: Array<{ speaker: string; text: string }>): Promise<{
    analysis: OnboardingAnalysis;
    review: ExtractionReview;
  }>;
}

export class HeuristicReasoningProvider implements ReasoningProvider {
  readonly mode = "mock" as const;

  async analyzeSession(session: OnboardingSessionRecord, turns: Array<{ speaker: string; text: string }>): Promise<{
    analysis: OnboardingAnalysis;
    review: ExtractionReview;
  }> {
    const participantTurns = turns.filter((turn) => turn.speaker === "participant");
    const combinedText = participantTurns.map((turn) => turn.text.toLowerCase()).join(" ");
    const coverage: CoverageItem[] = onboardingChecklist.map((item) => {
      const matchingTurns = participantTurns.filter((turn) =>
        item.keywords.some((keyword) => turn.text.toLowerCase().includes(keyword)),
      );
      return {
        id: item.id,
        section: item.section,
        title: item.title,
        prompt: item.prompt,
        status: matchingTurns.length ? (matchingTurns.length > 1 ? "covered" : "needs_follow_up") : "pending",
        evidence: matchingTurns.slice(-2).map((turn) => turn.text),
      };
    });

    const uncovered = coverage.filter((item) => item.status !== "covered");
    const recommendedQuestions: SupervisorPrompt[] = uncovered.slice(0, 3).map((item) => ({
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
        : Number((coverage.filter((item) => item.status === "covered").length / coverage.length).toFixed(2));

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

    const review: ExtractionReview = {
      businessSummary:
        participantTurns[0]?.text ??
        session.review.businessSummary ??
        `${session.staffName} onboarding interview is in progress.`,
      staffProfile: {
        ...session.review.staffProfile,
        staffName: session.review.staffProfile.staffName || session.staffName,
      },
      communicationProfile: {
        tone:
          detectFirstMatch(combinedText, [
            ["friendly", "Warm and friendly"],
            ["direct", "Direct and efficient"],
            ["professional", "Professional and calm"],
            ["chatty", "Conversational and reassuring"],
          ]) ?? session.review.communicationProfile.tone,
        salesStyle:
          detectFirstMatch(combinedText, [
            ["upsell", "Proactively upsell when useful"],
            ["consult", "Consultative and advice-led"],
            ["brief", "Keep it brief and practical"],
            ["explain", "Explain trade-offs before booking"],
          ]) ?? session.review.communicationProfile.salesStyle,
        riskTolerance:
          detectFirstMatch(combinedText, [
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

export class HttpReasoningProvider implements ReasoningProvider {
  readonly mode: "hosted" | "openai-compatible";

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      mode: "hosted" | "openai-compatible";
      fallback: HeuristicReasoningProvider;
    },
  ) {
    this.mode = config.mode;
  }

  async analyzeSession(session: OnboardingSessionRecord, turns: Array<{ speaker: string; text: string }>) {
    const response = await fetch(this.config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        session,
        turns,
        checklist: onboardingChecklist.map(({ keywords: _keywords, ...item }) => item),
      }),
    });
    if (!response.ok) {
      return this.config.fallback.analyzeSession(session, turns);
    }
    const payload = (await response.json()) as {
      analysis?: OnboardingAnalysis;
      review?: ExtractionReview;
    };
    if (!payload.analysis || !payload.review) {
      return this.config.fallback.analyzeSession(session, turns);
    }
    return {
      analysis: payload.analysis,
      review: payload.review,
    };
  }
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
