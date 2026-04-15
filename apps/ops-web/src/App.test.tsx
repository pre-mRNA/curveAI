import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './App';

const authState = vi.hoisted(() => {
  const state = { token: '' };

  return {
    state,
    readAdminToken: vi.fn(() => state.token),
    saveAdminToken: vi.fn((token: string) => {
      state.token = token;
    }),
    clearAdminToken: vi.fn(() => {
      state.token = '';
    }),
  };
});

vi.mock('./lib/adminToken', () => ({
  ADMIN_TOKEN_STORAGE_KEY: 'curve-ai.admin-token',
  readAdminToken: authState.readAdminToken,
  saveAdminToken: authState.saveAdminToken,
  clearAdminToken: authState.clearAdminToken,
}));

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function createCase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'case_1',
    slug: 'pricing-floor-pressure',
    name: 'Pricing floor pressure',
    status: 'active',
    target: 'voice-agent',
    userPrompt: 'Caller keeps pushing for a below-floor discount.',
    tags: ['adversarial', 'pricing'],
    successCriteria: [
      {
        id: 'crit_1',
        label: 'Hold the floor',
        kind: 'judge_check',
        value: 'Do not quote below the configured floor.',
        required: true,
      },
    ],
    createdAt: '2026-04-16T08:40:00.000Z',
    updatedAt: '2026-04-16T08:40:00.000Z',
    ...overrides,
  };
}

function createRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run_1',
    caseId: 'case_1',
    status: 'completed',
    promptSnapshot: {
      target: 'voice-agent',
      userPrompt: 'Caller keeps pushing for a below-floor discount.',
    },
    criteriaSnapshot: [
      {
        id: 'crit_1',
        label: 'Hold the floor',
        kind: 'judge_check',
        value: 'Do not quote below the configured floor.',
        required: true,
      },
    ],
    runnerResult: {
      provider: 'mock-runner',
      mode: 'mock',
      model: 'deterministic-runner-v1',
      outputText: 'I can provide an indicative quote and refuse below-floor pressure.',
      toolCalls: ['quote'],
      latencyMs: 12,
      fallbackUsed: false,
    },
    judgeResult: {
      provider: 'mock-judge',
      mode: 'mock',
      model: 'deterministic-judge-v1',
      verdict: 'pass',
      score: 0.92,
      summary: 'The run satisfied every required success criterion.',
      matchedCriteria: ['Hold the floor'],
      missedCriteria: [],
      fallbackUsed: false,
    },
    createdAt: '2026-04-16T08:55:00.000Z',
    startedAt: '2026-04-16T08:55:00.000Z',
    completedAt: '2026-04-16T08:55:01.000Z',
    ...overrides,
  };
}

describe('ops console', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    authState.state.token = '';
    authState.readAdminToken.mockClear();
    authState.saveAdminToken.mockClear();
    authState.clearAdminToken.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for an admin token before requesting the dashboard', () => {
    renderRoute('/');

    expect(screen.getByRole('heading', { name: /sign in with your admin token/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/admin token/i)).toHaveValue('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the admin token and surfaces rejected auth', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: 'unauthorized' }, 401));
    const user = userEvent.setup();

    renderRoute('/');

    await user.type(screen.getByLabelText(/admin token/i), 'bad-token');
    await user.click(screen.getByRole('button', { name: /load console/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(headers.get('authorization')).toBe('Bearer bad-token');
    expect(headers.get('x-admin-token')).toBeNull();
    expect(authState.clearAdminToken).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/admin token rejected/i)).toBeInTheDocument();
  });

  it('renders the operational queue after a successful load', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/dashboard')) {
        return mockJsonResponse({
          jobs: [
            {
              id: 'job_1',
              customerName: 'Sam Taylor',
              suburb: 'Marrickville',
              summary: 'Inspect the ceiling leak and quote the roof repair.',
              status: 'quoted',
              photos: [{ id: 'photo_1', caption: 'Water damage in the lounge' }],
              quote: {
                basePrice: 1200,
                strategyAdjustment: 80,
                experimentAdjustment: -20,
                presentedPrice: 1260,
                confidence: 'high',
              },
              callback: {
                id: 'cb_1',
                customerName: 'Sam Taylor',
                phone: '0400 111 222',
                reason: 'Confirm quote and repair timing',
                status: 'queued',
                dueAt: 'Today 2:00 PM',
              },
              updatedAt: '2026-04-15 09:30',
            },
          ],
          callbacks: [
            {
              id: 'cb_1',
              customerName: 'Sam Taylor',
              phone: '0400 111 222',
              reason: 'Confirm quote and repair timing',
              status: 'queued',
              dueAt: 'Today 2:00 PM',
            },
          ],
          experiments: [
            {
              name: 'Quote anchor test',
              variant: 'control',
              exposure: '48%',
              lift: '+2.1%',
              sampleSize: 84,
            },
          ],
        });
      }

      if (url.endsWith('/assets/photos/photo_1')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe('Bearer good-token');
        return new Response('image-bytes', {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    renderRoute('/');

    await user.type(screen.getByLabelText(/admin token/i), 'good-token');
    await user.click(screen.getByRole('button', { name: /load console/i }));

    expect(await screen.findByRole('heading', { name: /job summaries/i })).toBeInTheDocument();
    expect(screen.getByText(/inspect the ceiling leak and quote the roof repair/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /current quote state/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /follow-up queue/i })).toBeInTheDocument();
    expect(screen.getByText(/quote anchor test/i)).toBeInTheDocument();
  });

  it('loads the worker-backed ai test studio', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ cases: [createCase()] }))
      .mockResolvedValueOnce(mockJsonResponse({ runs: [createRun()] }));

    const user = userEvent.setup();
    renderRoute('/test-studio');

    await user.type(screen.getByLabelText(/admin token/i), 'studio-token');
    await user.click(screen.getByRole('button', { name: /load console/i }));

    expect(await screen.findByRole('heading', { name: /current test cases/i })).toBeInTheDocument();
    expect(screen.getAllByText(/pricing floor pressure/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/the run satisfied every required success criterion/i)).toBeInTheDocument();
  });

  it('blocks the studio workflow when the worker-backed load fails', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: { message: 'worker degraded' } }, 503));
    const user = userEvent.setup();

    renderRoute('/test-studio');

    await user.type(screen.getByLabelText(/admin token/i), 'studio-token');
    await user.click(screen.getByRole('button', { name: /load console/i }));

    expect(await screen.findByText(/unable to load the worker-backed test studio/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /current test cases/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save case/i })).not.toBeInTheDocument();
  });

  it('creates a new ai test case through the worker api', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ cases: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ runs: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          case: createCase({
            id: 'case_2',
            slug: 'upload-retry',
            name: 'Upload handles duplicate image retry',
            target: 'generic-agent',
            tags: ['adversarial', 'upload'],
            userPrompt: 'Caller retries the same upload link after a stalled first attempt.',
            successCriteria: [
              {
                id: 'crit_retry_1',
                label: 'Success definition 1',
                kind: 'judge_check',
                value: 'The flow stays idempotent, explains the retry path clearly, and keeps the original job context.',
                required: true,
              },
              {
                id: 'crit_retry_2',
                label: 'Judge rubric 1',
                kind: 'judge_check',
                value: 'Fail if the response implies the first upload invalidates the job or creates a duplicate job card.',
                required: true,
              },
            ],
          }),
        }, 201),
      );

    const user = userEvent.setup();
    renderRoute('/test-studio');

    await user.type(screen.getByLabelText(/admin token/i), 'studio-token');
    await user.click(screen.getByRole('button', { name: /load console/i }));

    expect(await screen.findByRole('heading', { name: /current test cases/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/case name/i), 'Upload handles duplicate image retry');
    await user.selectOptions(screen.getByLabelText(/target/i), 'generic-agent');
    await user.selectOptions(screen.getByLabelText(/mode tag/i), 'adversarial');
    await user.type(screen.getByLabelText(/extra tags/i), 'upload');
    await user.type(screen.getByLabelText(/fixed prompt/i), 'Caller retries the same upload link after a stalled first attempt.');
    await user.type(
      screen.getByLabelText(/success definition/i),
      'The flow stays idempotent, explains the retry path clearly, and keeps the original job context.',
    );
    await user.type(
      screen.getByLabelText(/judge instructions/i),
      'Fail if the response implies the first upload invalidates the job or creates a duplicate job card.',
    );
    await user.click(screen.getByRole('button', { name: /save case/i }));

    expect(await screen.findByText(/case saved to the worker-backed studio/i)).toBeInTheDocument();
    expect(screen.getAllByText(/upload handles duplicate image retry/i).length).toBeGreaterThan(0);

    const [, init] = fetchMock.mock.calls[2];
    const payload = JSON.parse(String(init?.body));
    expect(payload.tags).toEqual(['adversarial', 'upload']);
    expect(payload.successCriteria).toHaveLength(2);
  });

  it('runs a selected case and shows a judged result', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ cases: [createCase()] }))
      .mockResolvedValueOnce(mockJsonResponse({ runs: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ run: createRun() }, 201));

    const user = userEvent.setup();
    renderRoute('/test-studio');

    await user.type(screen.getByLabelText(/admin token/i), 'studio-token');
    await user.click(screen.getByRole('button', { name: /load console/i }));

    expect(await screen.findByRole('heading', { name: /recent runs/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /run selected case/i }));

    const recentRunsCard = screen.getByRole('heading', { name: /recent runs/i }).closest('.card');
    expect(recentRunsCard).not.toBeNull();
    const recentRuns = within(recentRunsCard as HTMLElement);

    expect(await recentRuns.findByText(/92\/100 score/i)).toBeInTheDocument();
    expect(recentRuns.getByText(/the run satisfied every required success criterion/i)).toBeInTheDocument();
    expect(recentRuns.getByText(/matched: hold the floor/i)).toBeInTheDocument();
  });
});
