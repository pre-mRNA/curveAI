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
import { resolveApiBaseUrl } from './baseUrl';
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

const API_BASE_URL = resolveApiBaseUrl();

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
  } else if (auth?.bearerToken) {
    headers.set('Authorization', `Bearer ${auth.bearerToken}`);
  }

  return headers;
}

async function requestJson<T>(path: string, init?: RequestInit, auth?: AuthOptions): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: createHeaders(init?.headers, auth),
  });

  const responseText = await response.text().catch(() => '');
  let parsedError: unknown = undefined;
  if (responseText) {
    try {
      parsedError = JSON.parse(responseText);
    } catch {
      parsedError = undefined;
    }
  }

  if (!response.ok) {
    const message =
      typeof parsedError === 'object' && parsedError !== null && 'error' in parsedError
        ? (parsedError as { error?: { message?: string } }).error?.message
        : undefined;
    throw new ApiError(response.status, message || responseText || `Request failed: ${response.status}`);
  }

  return (responseText ? JSON.parse(responseText) : null) as T;
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
    companyName: session.review.staffProfile.companyName,
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
      staffName: review.staffProfile.staffName,
      companyName: review.staffProfile.companyName,
      role: review.staffProfile.role,
      serviceArea: review.businessPractices.serviceAreas.join(', '),
      services: review.businessPractices.services.join(', '),
      hours: review.businessPractices.operatingHours,
      pricingPreference: review.pricingProfile.quotingStyle,
      communicationStyle: review.communicationProfile.tone,
      salesStyle: review.communicationProfile.salesStyle,
      riskTolerance: review.communicationProfile.riskTolerance,
      escalationRules: review.businessPractices.escalationRules.join('; '),
      exclusions: review.businessPractices.exclusions.join('; '),
      calendarProvider: review.staffProfile.calendarProvider,
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
        consentAccepted: consent.recordingConsent && consent.dataProcessingConsent,
        cloneConsentAccepted: consent.voiceCloneConsent,
      }),
    });

    return {
      session: mapSession(started.session),
    };
  },

  async resumeOnboardingSession(inviteCode: string): Promise<OnboardingSession | null> {
    try {
      const response = await requestJson<BackendSessionEnvelope>(
        `/onboarding/invites/${encodeURIComponent(inviteCode)}/session`,
      );
      return mapSession(response.session);
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        return null;
      }
      throw error;
    }
  },

  async getOnboardingSession(sessionId: string, sessionToken?: string): Promise<OnboardingSession> {
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

  async submitOnboardingTurn(sessionId: string, sessionToken: string | undefined, turn: OnboardingTurnPayload): Promise<OnboardingSession> {
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

  async requestOnboardingNextQuestion(sessionId: string, sessionToken?: string): Promise<OnboardingNextQuestionResponse> {
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

  async getOnboardingReview(sessionId: string, sessionToken?: string): Promise<OnboardingReview> {
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
    sessionToken: string | undefined,
    review: OnboardingReviewUpdate,
  ): Promise<OnboardingReview> {
    const response = await requestJson<BackendSessionEnvelope>(`/onboarding/sessions/${encodeURIComponent(sessionId)}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessSummary: review.summary,
        staffProfile: {
          staffName: review.staffName,
          companyName: review.companyName,
          role: review.role,
          calendarProvider: review.calendarProvider,
        },
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
    sessionToken?: string,
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
    sessionToken: string | undefined,
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

  async finalizeOnboarding(sessionId: string, sessionToken?: string): Promise<OnboardingFinalizeResponse> {
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
