import type {
  CalendarConnectResponse,
  DashboardPayload,
  OnboardingConsentPayload,
  OnboardingFinalizeResponse,
  OnboardingNextQuestionResponse,
  OnboardingReview,
  OnboardingReviewUpdate,
  OnboardingSession,
  OnboardingSessionStartResponse,
  OnboardingTurnPayload,
  VoiceSampleUploadResponse,
} from '../types';
import type {
  ChecklistItem as BackendCoverageItem,
  ExtractionReview as BackendReview,
  InterviewSpeaker as BackendTurnSpeaker,
  OnboardingAnalysis as BackendAnalysis,
  OnboardingCalendarStartResponse as BackendCalendarStartResponse,
  OnboardingNextQuestionEnvelope as BackendNextQuestionEnvelope,
  OnboardingReviewEnvelope as BackendReviewEnvelope,
  OnboardingSessionEnvelope as BackendSessionEnvelope,
  OnboardingSessionStatus as BackendSessionStatus,
  OnboardingSessionSummary as BackendSessionSummary,
  SupervisorPrompt as BackendSupervisorPrompt,
} from '../../../../packages/shared/src/onboarding';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type AuthOptions = {
  adminToken?: string;
  bearerToken?: string;
};

function createHeaders(initHeaders?: HeadersInit, auth?: AuthOptions): Headers {
  const headers = new Headers(initHeaders ?? {});

  if (auth?.adminToken) {
    headers.set('Authorization', `Bearer ${auth.adminToken}`);
    headers.set('X-Admin-Token', auth.adminToken);
  } else if (auth?.bearerToken) {
    headers.set('Authorization', `Bearer ${auth.bearerToken}`);
    headers.set('X-Onboarding-Token', auth.bearerToken);
  }

  return headers;
}

async function requestJson<T>(path: string, init?: RequestInit, auth?: AuthOptions): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: createHeaders(init?.headers, auth),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new ApiError(response.status, errorText || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function mapStatus(status: BackendSessionStatus, session: BackendSessionSummary): OnboardingSession['status'] {
  switch (status) {
    case 'completed':
      return 'complete';
    case 'voice_sample':
      return session.voiceSample ? 'ready_to_finalize' : 'voice_ready';
    case 'calendar':
      return session.calendar?.status === 'connected' ? 'voice_ready' : 'calendar_ready';
    case 'review':
      return 'review_ready';
    case 'interviewing':
      return 'active';
    default:
      return 'pending';
  }
}

function mapStep(status: BackendSessionStatus, session: BackendSessionSummary): OnboardingSession['currentStep'] {
  switch (status) {
    case 'completed':
      return 'complete';
    case 'voice_sample':
      return session.voiceSample ? 'finalize' : 'voice_sample';
    case 'calendar':
      return session.calendar?.status === 'connected' ? 'voice_sample' : 'calendar';
    case 'review':
      return 'review';
    case 'interviewing':
      return 'interview';
    default:
      return session.consentAccepted ? 'interview' : 'consent';
  }
}

function mapTurnSpeaker(speaker: BackendTurnSpeaker): 'staff' | 'interviewer' | 'supervisor' {
  if (speaker === 'participant') {
    return 'staff';
  }
  if (speaker === 'agent') {
    return 'interviewer';
  }
  return 'supervisor';
}

function toConfidenceLabel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.84) {
    return 'high';
  }
  if (score >= 0.6) {
    return 'medium';
  }
  return 'low';
}

function mapSession(session: BackendSessionSummary): OnboardingSession {
  return {
    id: session.id,
    inviteCode: session.inviteCode,
    status: mapStatus(session.status, session),
    currentStep: mapStep(session.status, session),
    currentQuestion: session.nextQuestion?.question ?? '',
    transcript: session.turns.map((turn) => ({
      id: turn.id,
      speaker: mapTurnSpeaker(turn.speaker),
      text: turn.text,
      createdAt: turn.createdAt,
    })),
    summary: session.review.businessSummary,
    staffName: session.staffName,
    companyName: session.review.crmDiscovery.currentSystem === 'Unknown' ? '' : session.review.crmDiscovery.currentSystem,
    calendarConnected: session.calendar?.status === 'connected',
    voiceSampleUploaded: Boolean(session.voiceSample),
    updatedAt: session.updatedAt ?? new Date().toISOString(),
  };
}

function mapReview(review: BackendReview, analysis: BackendAnalysis): OnboardingReview {
  return {
    summary: review.businessSummary,
    confidence: toConfidenceLabel(analysis.coverageScore),
    missingItems: review.missingFields,
    checklist: analysis.coverage.map((item) => ({
      label: item.title,
      status: item.status === 'covered' ? 'done' : item.status === 'needs_follow_up' ? 'partial' : 'missing',
      notes: item.evidence[0] ?? null,
    })),
    profile: {
      staffName: '',
      companyName: '',
      role: '',
      serviceArea: review.businessPractices.serviceAreas.join(', '),
      services: review.businessPractices.services.join(', '),
      hours: review.businessPractices.operatingHours,
      pricingPreference: review.pricingProfile.quotingStyle,
      communicationStyle: review.communicationProfile.tone,
      salesStyle: review.communicationProfile.salesStyle,
      riskTolerance: review.communicationProfile.riskTolerance,
      escalationRules: review.businessPractices.escalationRules.join('; '),
      exclusions: review.businessPractices.exclusions.join('; '),
      calendarProvider: 'Microsoft',
      crmProvider: review.crmDiscovery.currentSystem,
    },
  };
}

function splitTextList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export const apiClient = {
  async getDashboard(adminToken: string): Promise<DashboardPayload> {
    try {
      return await requestJson<DashboardPayload>('/dashboard', undefined, { adminToken });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        throw error;
      }

      throw new Error(error instanceof Error ? error.message : 'Dashboard request failed');
    }
  },

  async startOnboardingSession(
    inviteCode: string,
    consent: OnboardingConsentPayload,
  ): Promise<OnboardingSessionStartResponse> {
    const started = await requestJson<BackendSessionEnvelope>('/onboarding/sessions/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteCode,
      }),
    });

    const token = started.session.participantToken;
    const tokenResponse = await requestJson<BackendSessionEnvelope>(
      `/onboarding/sessions/${encodeURIComponent(started.session.id)}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          consentAccepted: consent.recordingConsent && consent.dataProcessingConsent,
          cloneConsentAccepted: consent.voiceCloneConsent,
        }),
      },
      {
        bearerToken: token,
      },
    );

    return {
      session: mapSession(tokenResponse.session),
      sessionToken: token,
    };
  },

  async getOnboardingSession(sessionId: string, sessionToken: string): Promise<OnboardingSession> {
    const response = await requestJson<BackendSessionEnvelope>(
      `/onboarding/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      {
        bearerToken: sessionToken,
      },
    );
    return mapSession(response.session);
  },

  async getOnboardingSessionToken(): Promise<never> {
    throw new Error('The onboarding session token is issued during session start.');
  },

  async submitOnboardingTurn(
    sessionId: string,
    sessionToken: string,
    turn: OnboardingTurnPayload,
  ): Promise<OnboardingSession> {
    const response = await requestJson<BackendSessionEnvelope>(
      `/onboarding/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          speaker: 'participant',
          text: turn.text,
        }),
      },
      {
        bearerToken: sessionToken,
      },
    );
    return mapSession(response.session);
  },

  async requestOnboardingNextQuestion(
    sessionId: string,
    sessionToken: string,
  ): Promise<OnboardingNextQuestionResponse> {
    const response = await requestJson<BackendNextQuestionEnvelope>(
      `/onboarding/sessions/${encodeURIComponent(sessionId)}/next-question`,
      {
        method: 'POST',
      },
      {
        bearerToken: sessionToken,
      },
    );
    return {
      question: response.nextQuestion?.question ?? '',
      focus: response.nextQuestion?.section ?? response.interviewerBrief,
    };
  },

  async getOnboardingReview(sessionId: string, sessionToken: string): Promise<OnboardingReview> {
    const response = await requestJson<BackendReviewEnvelope>(
      `/onboarding/sessions/${encodeURIComponent(sessionId)}/review`,
      undefined,
      {
        bearerToken: sessionToken,
      },
    );
    return mapReview(response.review, response.analysis);
  },

  async saveOnboardingReview(
    sessionId: string,
    sessionToken: string,
    review: OnboardingReviewUpdate,
  ): Promise<OnboardingReview> {
    const response = await requestJson<BackendSessionEnvelope>(`/onboarding/sessions/${encodeURIComponent(sessionId)}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessSummary: review.summary,
        communicationProfile: {
          tone: review.communicationStyle,
          salesStyle: review.salesStyle,
          riskTolerance: review.riskTolerance,
        },
        pricingProfile: {
          quotingStyle: review.pricingPreference,
        },
        businessPractices: {
          services: splitTextList(review.services),
          serviceAreas: splitTextList(review.serviceArea),
          operatingHours: review.hours,
          exclusions: splitTextList(review.exclusions),
          escalationRules: splitTextList(review.escalationRules),
        },
        crmDiscovery: {
          currentSystem: review.crmProvider,
        },
        missingFields: review.missingItems,
      }),
    }, {
      bearerToken: sessionToken,
    });
    return mapReview(response.session.review, response.session.analysis);
  },

  async startMicrosoftCalendarConnect(
    sessionId: string,
    sessionToken: string,
  ): Promise<CalendarConnectResponse> {
    const response = await requestJson<BackendCalendarStartResponse>(
      `/onboarding/sessions/${encodeURIComponent(sessionId)}/calendar/microsoft/start`,
      undefined,
      {
        bearerToken: sessionToken,
      },
    );
    return {
      authorizationUrl: response.calendar?.authUrl,
      connected: response.calendar?.status === 'connected',
      provider: 'microsoft',
      accountEmail: response.calendar?.accountEmail,
    };
  },

  async uploadOnboardingVoiceSample(
    sessionId: string,
    sessionToken: string,
    sample: {
      blob?: Blob;
      sampleLabel: string;
      durationSeconds: number;
      transcript?: string;
      noiseLevel?: 'low' | 'medium' | 'high';
    },
  ): Promise<VoiceSampleUploadResponse> {
    const formData = new FormData();
    if (sample.blob) {
      formData.append('sample', sample.blob, 'voice-sample.webm');
    }
    formData.append('sampleLabel', sample.sampleLabel);
    formData.append('durationSeconds', String(sample.durationSeconds));
    if (sample.transcript) {
      formData.append('transcript', sample.transcript);
    }
    if (sample.noiseLevel) {
      formData.append('noiseLevel', sample.noiseLevel);
    }

    const response = await requestJson<BackendSessionEnvelope>(`/onboarding/sessions/${encodeURIComponent(sessionId)}/voice-sample`, {
      method: 'POST',
      body: formData,
    }, {
      bearerToken: sessionToken,
    });
    return {
      uploaded: Boolean(response.session.voiceSample),
      recommendedForClone: response.session.voiceSample?.recommendedForClone,
      qualityScore: response.session.voiceSample?.qualityScore,
      reasons: response.session.voiceSample?.reasons,
    };
  },

  async finalizeOnboarding(sessionId: string, sessionToken: string): Promise<OnboardingFinalizeResponse> {
    const response = await requestJson<{ session: BackendSessionSummary; staff?: { id?: string } }>(
      `/onboarding/sessions/${encodeURIComponent(sessionId)}/finalize`,
      {
      method: 'POST',
      },
      {
        bearerToken: sessionToken,
      },
    );
    return {
      status: response.session.status === 'completed' ? 'complete' : 'pending',
      staffId: response.staff?.id,
      summary: response.session.review.businessSummary,
    };
  },

  async uploadPhotos(token: string, files: File[]): Promise<{ ok: true; uploaded: number }> {
    const formData = new FormData();
    files.forEach((file) => formData.append('photos', file));

    const response = await fetch(`${API_BASE_URL}/uploads/${encodeURIComponent(token)}/photos`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new ApiError(response.status, `Upload failed: ${response.status}`);
    }

    return (await response.json()) as { ok: true; uploaded: number };
  },
};
