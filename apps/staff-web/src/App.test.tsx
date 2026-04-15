import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });
}

describe('staff web app', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the staff auth screen by default', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /verify the staff session/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open staff console/i })).toBeInTheDocument();
  });

  it('verifies the OTP, stores the session, and loads the queue', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith('/staff/verify-otp')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({
          staff: {
            id: 'staff_1',
            fullName: 'Jordan Tradie',
            role: 'Owner',
            voiceConsentStatus: 'pending',
            timezone: 'Australia/Sydney',
          },
          session: {
            token: 'staff-session-token',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        });
      }

      if (url.endsWith('/jobs')) {
        return jsonResponse({
          jobs: [
            {
              id: 'job_1',
              customerName: 'Mia',
              suburb: 'Marrickville',
              summary: 'Blocked stormwater drain',
              status: 'needs_follow_up',
              photos: [],
              quote: {
                basePrice: 220,
                strategyAdjustment: 0,
                experimentAdjustment: 0,
                presentedPrice: 220,
                confidence: 'medium',
              },
              callback: null,
              updatedAt: '10:14 am',
            },
          ],
        });
      }

      if (url.endsWith('/jobs/job_1/card')) {
        return jsonResponse({
          card: {
            job: {
              id: 'job_1',
              callerName: 'Mia',
              callerPhone: '+61433333333',
              address: '14 Clarence Street',
              summary: 'Blocked stormwater drain',
              status: 'callback',
              photos: [],
              createdAt: '2026-04-16T00:00:00.000Z',
              updatedAt: '2026-04-16T00:00:00.000Z',
            },
            photos: [],
            quotes: [],
            calls: [],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/invite token/i), 'invite-token');
    await user.type(screen.getByLabelText(/^otp$/i), '123456');
    await user.click(screen.getByRole('button', { name: /open staff console/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /live jobs assigned to this staff session/i })).toBeInTheDocument();
    });
    expect(screen.getAllByText(/blocked stormwater drain/i)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalled();
  });
});
