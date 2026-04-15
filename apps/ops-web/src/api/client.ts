import type { DashboardPayload } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function createHeaders(initHeaders?: HeadersInit, adminToken?: string): Headers {
  const headers = new Headers(initHeaders ?? {});
  if (adminToken) {
    headers.set('Authorization', `Bearer ${adminToken}`);
    headers.set('X-Admin-Token', adminToken);
  }
  return headers;
}

async function requestJson<T>(path: string, adminToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: createHeaders(init?.headers, adminToken),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new ApiError(response.status, errorText || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  async getDashboard(adminToken: string): Promise<DashboardPayload> {
    try {
      return await requestJson<DashboardPayload>('/dashboard', adminToken);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        throw error;
      }

      throw new Error(error instanceof Error ? error.message : 'Dashboard request failed');
    }
  },
};
