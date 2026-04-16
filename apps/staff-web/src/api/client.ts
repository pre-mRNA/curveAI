import type { JobCard, JobSummary, PricingProfile, StaffProfile } from '../types';
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

function createHeaders(initHeaders?: HeadersInit): Headers {
  return new Headers(initHeaders ?? {});
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: createHeaders(init?.headers),
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

export async function fetchProtectedAsset(photoId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/assets/photos/${encodeURIComponent(photoId)}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Protected asset request failed: ${response.status}`);
  }

  return response.blob();
}

export async function verifyStaffOtp(input: {
  inviteToken: string;
  otpCode: string;
}): Promise<StaffProfile> {
  const payload = await requestJson<{
    staff: StaffProfile;
    session: { expiresAt: string };
  }>('/staff/verify-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return payload.staff;
}

export async function getStaffProfile(): Promise<StaffProfile> {
  const payload = await requestJson<{ staff: StaffProfile }>('/staff/me');
  return payload.staff;
}

export async function getStaffJobs(signal?: AbortSignal): Promise<JobSummary[]> {
  const payload = await requestJson<{ jobs: JobSummary[] }>('/jobs', { signal });
  return payload.jobs;
}

export async function getJobCard(jobId: string, signal?: AbortSignal): Promise<JobCard> {
  const payload = await requestJson<{ card: JobCard }>(`/jobs/${encodeURIComponent(jobId)}/card`, { signal });
  return payload.card;
}

export async function saveVoiceConsent(input: {
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
  });

  return payload.staff;
}

export async function savePricingInterview(
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
  });

  return payload;
}

export function buildCalendarConnectUrl(staffId: string): string {
  return `${API_BASE_URL}/staff/calendar/microsoft/start?staffId=${encodeURIComponent(staffId)}`;
}

export async function disconnectCalendar(staffId: string): Promise<StaffProfile> {
  const payload = await requestJson<{ staff: StaffProfile }>('/staff/calendar/disconnect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      staffId,
    }),
  });

  return payload.staff;
}

export async function signOutStaff(): Promise<void> {
  await requestJson<{ ok: true }>('/staff/sign-out', {
    method: 'POST',
  });
}
