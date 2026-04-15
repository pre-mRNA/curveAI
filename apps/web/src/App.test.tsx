import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
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

describe('onboarding app routing', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
      const method = init?.method ?? 'GET';
      if (url.pathname.endsWith('/onboarding/invites/invite-123/session') && method === 'GET') {
        return jsonResponse({ error: 'No resumable session' }, 401);
      }
      return jsonResponse({ error: `Unhandled request: ${method} ${url.pathname}` }, 404);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the onboarding landing page at the root route', () => {
    renderRoute('/');

    expect(screen.getByRole('heading', { name: /structured voice onboarding for tradies/i })).toBeInTheDocument();
    expect(screen.getAllByText(/invite-gated/i)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /open onboarding/i })).toBeInTheDocument();
  });

  it('keeps the invite route available for the onboarding flow', async () => {
    renderRoute('/onboard/invite-123');

    expect(await screen.findByRole('heading', { name: /structured voice onboarding for tradies/i })).toBeInTheDocument();
    expect(screen.getByText('invite-123', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /begin interview/i })).toBeInTheDocument();
  });

  it('lets the landing page recover a session from an invite code', async () => {
    const user = userEvent.setup();
    renderRoute('/');

    await user.type(screen.getByLabelText(/invite code/i), 'invite-123');
    await user.click(screen.getByRole('button', { name: /open onboarding/i }));

    expect(await screen.findByText('invite-123', { selector: 'code' })).toBeInTheDocument();
  });
});
