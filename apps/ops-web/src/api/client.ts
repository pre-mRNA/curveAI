import {
  aiTestCaseListResponseSchema,
  aiTestCaseResponseSchema,
  aiTestRunListResponseSchema,
  aiTestRunResponseSchema,
} from '../../../../packages/shared/src/ai-test-studio';
import type { AiTestCase, AiTestCaseCreateInput, AiTestRun, AiTestRunCreateInput, DashboardPayload } from '../types';
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

  async listAiTestCases(adminToken: string): Promise<AiTestCase[]> {
    const payload = await requestJson<unknown>('/ai-test-studio/cases', adminToken);
    return aiTestCaseListResponseSchema.parse(payload).cases;
  },

  async createAiTestCase(adminToken: string, input: AiTestCaseCreateInput): Promise<AiTestCase> {
    const payload = await requestJson<unknown>('/ai-test-studio/cases', adminToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    return aiTestCaseResponseSchema.parse(payload).case;
  },

  async listAiTestRuns(adminToken: string, caseId?: string): Promise<AiTestRun[]> {
    const suffix = caseId ? `?caseId=${encodeURIComponent(caseId)}` : '';
    const payload = await requestJson<unknown>(`/ai-test-studio/runs${suffix}`, adminToken);
    return aiTestRunListResponseSchema.parse(payload).runs;
  },

  async runAiTestCase(adminToken: string, caseId: string, input?: AiTestRunCreateInput): Promise<AiTestRun> {
    const payload = await requestJson<unknown>(`/ai-test-studio/cases/${encodeURIComponent(caseId)}/runs`, adminToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input ?? {}),
    });
    return aiTestRunResponseSchema.parse(payload).run;
  },
};
