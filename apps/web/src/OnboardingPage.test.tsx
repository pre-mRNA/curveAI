import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './App';

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function matchesApiPath(pathname: string, path: string) {
  return pathname === path || pathname === `/api${path}`;
}

function backendSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sess_1',
    inviteCode: 'invite-123',
    status: 'interviewing',
    staffId: 'staff_1',
    staffName: 'Jordan',
    expiresAt: '2026-04-17T10:00:00.000Z',
    consentAccepted: true,
    cloneConsentAccepted: true,
    coverageScore: 0.63,
    nextQuestion: {
      id: 'pricing',
      section: 'pricing',
      reason: 'Need clearer pricing rules.',
      question: 'What work do you want the agent to handle?',
    },
    review: {
      businessSummary: 'Jordan Plumbing onboarding is underway.',
      staffProfile: {
        staffName: 'Jordan',
        companyName: 'Jordan Plumbing',
        role: 'Owner',
        calendarProvider: 'Microsoft',
      },
      communicationProfile: {
        tone: 'Direct and calm',
        salesStyle: 'Consultative',
        riskTolerance: 'Escalate uncertain quotes',
        customerHandlingRules: ['Confirm scope before pricing.'],
      },
      pricingProfile: {
        quotingStyle: 'Fixed price with a callout minimum',
        calloutPolicy: 'Uses a callout fee',
        afterHoursPolicy: 'After-hours rules still need confirmation',
        approvalThreshold: 'Escalate larger jobs',
      },
      businessPractices: {
        services: ['Emergency plumbing'],
        serviceAreas: ['Inner West Sydney'],
        operatingHours: 'Weekdays with emergency coverage',
        exclusions: [],
        escalationRules: ['After-hours jobs need review.'],
      },
      crmDiscovery: {
        currentSystem: 'ServiceM8',
        syncPreference: 'Wants sync',
        sourceOfTruth: 'CRM is the source of truth',
        notes: [],
      },
      missingFields: ['after-hours escalation rule'],
    },
    analysis: {
      coverage: [
        {
          id: 'services',
          title: 'Business facts',
          status: 'covered',
          evidence: ['Emergency plumbing and daytime bookings.'],
        },
        {
          id: 'pricing',
          title: 'Pricing rules',
          status: 'needs_follow_up',
          evidence: ['Need clearer after-hours premium rule.'],
        },
      ],
      recommendedQuestions: [
        {
          id: 'pricing',
          section: 'pricing',
          reason: 'Need clearer pricing rules.',
          question: 'Do you prefer fixed price or callout pricing?',
        },
      ],
      coverageScore: 0.63,
      interviewerBrief: 'Ask about pricing next.',
    },
    calendar: {
      provider: 'microsoft',
      status: 'pending',
    },
    turns: [],
    updatedAt: '2026-04-14T10:00:00.000Z',
    ...overrides,
  };
}

describe('onboarding route', () => {
  const fetchMock = vi.fn();
  let savedReviewPayload: Record<string, unknown> | null = null;

  beforeEach(() => {
    savedReviewPayload = null;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
      const method = init?.method ?? 'GET';

      if (matchesApiPath(url.pathname, '/onboarding/invites/invite-123/session') && method === 'GET') {
        return jsonResponse({ error: 'No resumable session' }, 401);
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/start') && method === 'POST') {
        return jsonResponse({
          session: backendSession(),
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1') && method === 'GET') {
        return jsonResponse({
          session: backendSession(),
          checklist: [],
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/turns') && method === 'POST') {
        return jsonResponse({
          session: backendSession({
            turns: [
              {
                id: 'turn_1',
                speaker: 'participant',
                text: 'Handle emergency plumbing, daytime bookings, and quote follow-ups.',
                createdAt: '2026-04-14T10:01:00.000Z',
              },
            ],
            nextQuestion: {
              id: 'pricing',
              section: 'pricing',
              reason: 'Need clearer pricing rules.',
              question: 'Do you prefer fixed price or callout pricing?',
            },
            review: {
              ...backendSession().review,
              businessSummary: 'Interview in progress.',
            },
            updatedAt: '2026-04-14T10:01:00.000Z',
          }),
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/next-question') && method === 'POST') {
        return jsonResponse({
          nextQuestion: {
            id: 'pricing',
            section: 'pricing',
            reason: 'Need clearer pricing rules.',
            question: 'Do you prefer fixed price or callout pricing?',
          },
          interviewerBrief: 'Ask about pricing rules next.',
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/review') && method === 'GET') {
        return jsonResponse({
          review: backendSession().review,
          analysis: backendSession().analysis,
          status: 'review',
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/review') && method === 'POST') {
        savedReviewPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          session: backendSession({
            status: 'calendar',
            review: {
              ...backendSession().review,
              staffProfile: {
                ...backendSession().review.staffProfile,
                ...((savedReviewPayload?.staffProfile as Record<string, unknown> | undefined) ?? {}),
              },
              missingFields: [],
            },
            analysis: {
              ...backendSession().analysis,
              coverage: backendSession().analysis.coverage.map((item: any) => ({
                ...item,
                status: 'covered',
              })),
              coverageScore: 0.92,
            },
          }),
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/calendar/microsoft/start') && method === 'GET') {
        return jsonResponse({
          calendar: {
            provider: 'microsoft',
            status: 'pending',
            authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?mock=1',
          },
          session: backendSession({
            status: 'calendar',
          }),
        });
      }

      return jsonResponse({ error: `Unhandled request: ${method} ${url.pathname}` }, 404);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('walks through invite consent, interview, review, and calendar connect', async () => {
    const user = userEvent.setup();

    renderRoute('/onboard/invite-123');

    expect(await screen.findByRole('heading', { name: /structured voice onboarding for tradies/i })).toBeInTheDocument();
    expect(screen.getByText('invite-123', { selector: 'code' })).toBeInTheDocument();

    await user.click(screen.getByLabelText(/i consent to recording/i));
    await user.click(screen.getByLabelText(/i consent to using a clean voice sample/i));
    await user.click(screen.getByLabelText(/i consent to using my onboarding responses/i));
    await user.click(screen.getByRole('button', { name: /begin interview/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /answer the structured interview/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/what work do you want the agent to handle/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/your response/i), 'Handle emergency plumbing, daytime bookings, and quote follow-ups.');
    await user.click(screen.getByRole('button', { name: /save response/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/onboarding\/sessions\/sess_1\/turns$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await user.click(screen.getByRole('button', { name: /open extraction review/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /review the extracted profile/i })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('ServiceM8')).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText(/staff name/i));
    await user.type(screen.getByLabelText(/staff name/i), 'Jordan S');
    await user.clear(screen.getByLabelText(/company name/i));
    await user.type(screen.getByLabelText(/company name/i), 'Jordan Plumbing Co');
    await user.clear(screen.getByLabelText(/^role$/i));
    await user.type(screen.getByLabelText(/^role$/i), 'Dispatcher');

    await user.click(screen.getByRole('button', { name: /save review and continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /connect the staff calendar/i })).toBeInTheDocument();
    });

    expect(savedReviewPayload).toMatchObject({
      staffProfile: {
        staffName: 'Jordan S',
        companyName: 'Jordan Plumbing Co',
        role: 'Dispatcher',
        calendarProvider: 'Microsoft',
      },
    });

    await user.click(screen.getByRole('button', { name: /connect microsoft calendar/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open microsoft connection link/i })).toHaveAttribute(
        'href',
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?mock=1',
      );
    });
  }, 10000);

  it('uploads a recorded voice sample with the real elapsed duration', async () => {
    const user = userEvent.setup();
    const stopTrack = vi.fn();
    const mediaStream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    let voiceSampleUploaded = false;
    let uploadedDuration = '';
    let uploadedFilename = '';
    let now = 1_000;

    class MockMediaRecorder {
      stream: MediaStream;
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(stream: MediaStream) {
        this.stream = stream;
      }

      start() {}

      stop() {
        this.ondataavailable?.({
          data: new Blob(['voice sample'], { type: 'audio/webm' }),
        });
        this.onstop?.();
      }
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder);
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mediaStream),
      },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:voice-sample'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
      const method = init?.method ?? 'GET';

      if (matchesApiPath(url.pathname, '/onboarding/invites/invite-123/session') && method === 'GET') {
        return jsonResponse({
          session: backendSession({
            status: 'voice_sample',
            calendar: {
              provider: 'microsoft',
              status: 'connected',
              accountEmail: 'jordan@example.com',
            },
            voiceSample: voiceSampleUploaded
              ? {
                  sampleLabel: 'Browser voice sample',
                  recommendedForClone: true,
                  qualityScore: 0.88,
                  reasons: ['Clear browser recording'],
                }
              : undefined,
            turns: [
              {
                id: 'turn_voice_1',
                speaker: 'participant',
                text: 'We handle emergency plumbing across the inner west.',
                createdAt: '2026-04-14T10:02:00.000Z',
              },
            ],
            updatedAt: '2026-04-14T10:02:00.000Z',
          }),
          checklist: [],
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1') && method === 'GET') {
        return jsonResponse({
          session: backendSession({
            status: 'voice_sample',
            calendar: {
              provider: 'microsoft',
              status: 'connected',
              accountEmail: 'jordan@example.com',
            },
            voiceSample: voiceSampleUploaded
              ? {
                  sampleLabel: 'Browser voice sample',
                  recommendedForClone: true,
                  qualityScore: 0.88,
                  reasons: ['Clear browser recording'],
                }
              : undefined,
            turns: [
              {
                id: 'turn_voice_1',
                speaker: 'participant',
                text: 'We handle emergency plumbing across the inner west.',
                createdAt: '2026-04-14T10:02:00.000Z',
              },
            ],
            updatedAt: '2026-04-14T10:02:00.000Z',
          }),
          checklist: [],
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/review') && method === 'GET') {
        return jsonResponse({
          review: backendSession().review,
          analysis: backendSession().analysis,
          status: 'voice_sample',
        });
      }

      if (matchesApiPath(url.pathname, '/onboarding/sessions/sess_1/voice-sample') && method === 'POST') {
        const formData = init?.body as FormData;
        uploadedDuration = String(formData.get('durationSeconds'));
        const sample = formData.get('sample');
        uploadedFilename = sample instanceof File ? sample.name : '';
        voiceSampleUploaded = true;

        return jsonResponse({
          session: backendSession({
            status: 'voice_sample',
            calendar: {
              provider: 'microsoft',
              status: 'connected',
              accountEmail: 'jordan@example.com',
            },
            voiceSample: {
              sampleLabel: 'Browser voice sample',
              recommendedForClone: true,
              qualityScore: 0.88,
              reasons: ['Clear browser recording'],
            },
            turns: [
              {
                id: 'turn_voice_1',
                speaker: 'participant',
                text: 'We handle emergency plumbing across the inner west.',
                createdAt: '2026-04-14T10:02:00.000Z',
              },
            ],
            updatedAt: '2026-04-14T10:03:00.000Z',
          }),
        });
      }

      return jsonResponse({ error: `Unhandled request: ${method} ${url.pathname}` }, 404);
    });

    renderRoute('/onboard/invite-123');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capture a clean sample for cloning/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /start recording/i }));
    now = 96_000;
    await user.click(screen.getByRole('button', { name: /stop recording/i }));

    await waitFor(() => {
      expect(screen.getByText(/sample captured/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /upload sample/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/onboarding\/sessions\/sess_1\/voice-sample$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(uploadedDuration).toBe('95');
    expect(uploadedFilename).toBe('voice-sample.webm');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /lock the onboarding profile/i })).toBeInTheDocument();
    });
  });
});
