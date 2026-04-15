import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('dashboard auth', () => {
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
    await user.click(screen.getByRole('button', { name: /load dashboard/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(headers.get('authorization')).toBe('Bearer bad-token');
    expect(headers.get('x-admin-token')).toBe('bad-token');
    expect(authState.clearAdminToken).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/admin token rejected/i)).toBeInTheDocument();
  });

  it('renders the operational queue after a successful load', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        jobs: [
          {
            id: 'job_1',
            customerName: 'Sam Taylor',
            suburb: 'Marrickville',
            summary: 'Inspect the ceiling leak and quote the roof repair.',
            status: 'quoted',
            photos: [{ id: 'photo_1', url: '/photo-1.jpg', caption: 'Water damage in the lounge' }],
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
      }),
    );
    const user = userEvent.setup();

    renderRoute('/');

    await user.type(screen.getByLabelText(/admin token/i), 'good-token');
    await user.click(screen.getByRole('button', { name: /load dashboard/i }));

    expect(await screen.findByRole('heading', { name: /job summaries/i })).toBeInTheDocument();
    expect(screen.getByText(/inspect the ceiling leak and quote the roof repair/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /current quote state/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /follow-up queue/i })).toBeInTheDocument();
    expect(screen.getByText(/quote anchor test/i)).toBeInTheDocument();
  });
});
