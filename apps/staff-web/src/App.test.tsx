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
    vi.restoreAllMocks();
  });

  it('renders the staff auth screen by default', async () => {
    let resolveProfileRequest: (response: Response) => void = () => {
      throw new Error('The staff profile request was not captured.');
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/staff/me')) {
        return await new Promise<Response>((resolve) => {
          resolveProfileRequest = resolve;
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);

    expect(screen.getByRole('heading', { name: /checking if you are already signed in/i })).toBeInTheDocument();
    resolveProfileRequest(jsonResponse({ error: { message: 'Authentication is required' } }, { status: 401 }));
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open jobs/i })).toBeInTheDocument();
  });

  it('shows a service error when staff bootstrap fails for a non-auth reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { message: 'Worker misconfigured' } }, { status: 500 }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByText(/could not reach your jobs right now\. try again in a moment\./i)).toBeInTheDocument();
  });

  it('verifies the 6 digit code and loads the queue with the worker-backed browser session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith('/staff/me')) {
        return jsonResponse({ error: { message: 'Authentication is required' } }, { status: 401 });
      }

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

    await screen.findByRole('heading', { name: /^sign in$/i });

    await user.type(screen.getByLabelText(/invite code/i), 'invite-token');
    await user.type(screen.getByLabelText(/6 digit code/i), '123456');
    await user.click(screen.getByRole('button', { name: /open jobs/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your jobs/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText(/blocked stormwater drain/i)).toHaveLength(2);
    });
    expect(screen.getByRole('link', { name: /call customer/i })).toHaveAttribute('href', 'tel:+61433333333');
    expect(screen.getByText(/current price/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('opens the canonical setup flow from the setup tab', async () => {
    const assignMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        assign: assignMock,
      },
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith('/staff/me')) {
        return jsonResponse({ error: { message: 'Authentication is required' } }, { status: 401 });
      }

      if (url.endsWith('/staff/verify-otp')) {
        return jsonResponse({
          staff: {
            id: 'staff_1',
            fullName: 'Jordan Tradie',
            role: 'Owner',
            voiceConsentStatus: 'pending',
            timezone: 'Australia/Sydney',
            setup: {
              status: 'in_progress',
              currentStep: 'review',
            },
          },
          session: {
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        });
      }

      if (url.endsWith('/jobs')) {
        return jsonResponse({ jobs: [] });
      }

      if (url.endsWith('/staff/setup/launch')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({
          ok: true,
          launchUrl: 'https://curve-ai-onboarding.pages.dev/onboard/invite_123',
          setup: {
            status: 'in_progress',
            currentStep: 'review',
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /^sign in$/i });

    await user.type(screen.getByLabelText(/invite code/i), 'invite-token');
    await user.type(screen.getByLabelText(/6 digit code/i), '123456');
    await user.click(screen.getByRole('button', { name: /open jobs/i }));

    await screen.findByRole('heading', { name: /your jobs/i });
    await user.click(screen.getByRole('button', { name: /setup/i }));

    expect(screen.getByText(/the private setup page is now the main place to finish how the assistant works/i)).toBeInTheDocument();
    expect(screen.getByText(/check details/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue setup/i }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('https://curve-ai-onboarding.pages.dev/onboard/invite_123');
    });
  });
});
