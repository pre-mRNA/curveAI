import type { JobCard, JobSummary, PricingProfile, StaffProfile, StaffSession } from '../types';
import { resolveApiBaseUrl } from './baseUrl';

const API_BASE_URL = resolveApiBaseUrl();

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function createHeaders(initHeaders?: HeadersInit, sessionToken?: string): Headers {
  const headers = new Headers(initHeaders ?? {});
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  return headers;
}

async function requestJson<T>(path: string, init?: RequestInit, sessionToken?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: createHeaders(init?.headers, sessionToken),
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

export async function fetchProtectedAsset(photoId: string, sessionToken: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/assets/photos/${encodeURIComponent(photoId)}`, {
    headers: createHeaders(undefined, sessionToken),
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Protected asset request failed: ${response.status}`);
  }

  return response.blob();
}

export async function verifyStaffOtp(input: {
  inviteToken: string;
  otpCode: string;
  staffId?: string;
}): Promise<{ staff: StaffProfile; session: StaffSession }> {
  const payload = await requestJson<{
    staff: StaffProfile;
    session: { token: string; expiresAt: string };
  }>('/staff/verify-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return {
    staff: payload.staff,
    session: {
      token: payload.session.token,
      expiresAt: payload.session.expiresAt,
      staffId: payload.staff.id,
    },
  };
}

export async function getStaffProfile(sessionToken: string): Promise<StaffProfile> {
  const payload = await requestJson<{ staff: StaffProfile }>('/staff/me', undefined, sessionToken);
  return payload.staff;
}

export async function getStaffJobs(sessionToken: string): Promise<JobSummary[]> {
  const payload = await requestJson<{ jobs: JobSummary[] }>('/jobs', undefined, sessionToken);
  return payload.jobs;
}

export async function getJobCard(sessionToken: string, jobId: string): Promise<JobCard> {
  const payload = await requestJson<{ card: JobCard }>(`/jobs/${encodeURIComponent(jobId)}/card`, undefined, sessionToken);
  return payload.card;
}

export async function saveVoiceConsent(sessionToken: string, input: {
  staffId: string;
  consent: boolean;
  signedBy?: string;
}): Promise<StaffProfile> {
  const payload = await requestJson<{ staff: StaffProfile }>('/staff/voice-consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      capturedAt: new Date().toISOString(),
    }),
  }, sessionToken);

  return payload.staff;
}

export async function savePricingInterview(
  sessionToken: string,
  input: {
    staffId: string;
    responses: PricingProfile;
  },
): Promise<{ staff: StaffProfile; pricingProfile: PricingProfile }> {
  const payload = await requestJson<{ staff: StaffProfile; pricingProfile: PricingProfile }>('/staff/pricing-interview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  }, sessionToken);

  return payload;
}

export async function connectCalendar(
  sessionToken: string,
  input: {
    staffId: string;
    accountEmail?: string;
    calendarId?: string;
    timezone?: string;
    externalConnectionId?: string;
  },
): Promise<StaffProfile> {
  const payload = await requestJson<{ staff: StaffProfile }>('/staff/calendar/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'outlook',
      ...input,
    }),
  }, sessionToken);

  return payload.staff;
}
