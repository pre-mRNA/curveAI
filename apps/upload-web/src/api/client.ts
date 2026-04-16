import { resolveApiBaseUrl } from './baseUrl';

const API_BASE_URL = resolveApiBaseUrl();

export type UploadRequestSummary = {
  fileCount: number;
  status: string;
  expiresAt: string;
  requestedBy?: string;
  businessName?: string;
  siteLabel?: string;
  jobSummary?: string;
  requestNote?: string;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: {
        message?: string;
      };
    };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function uploadPhotos(
  token: string,
  files: File[],
): Promise<{ ok: true; uploaded: number; upload: UploadRequestSummary }> {
  const formData = new FormData();
  files.forEach((file) => formData.append('photos', file));

  const response = await fetch(`${API_BASE_URL}/uploads/${encodeURIComponent(token)}/photos`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response, `Upload failed: ${response.status}`));
  }

  return (await response.json()) as { ok: true; uploaded: number; upload: UploadRequestSummary };
}

export async function getUploadRequest(token: string): Promise<UploadRequestSummary> {
  const response = await fetch(`${API_BASE_URL}/uploads/${encodeURIComponent(token)}`);

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response, `Upload request failed: ${response.status}`));
  }

  const body = (await response.json()) as {
    upload: UploadRequestSummary;
  };
  return body.upload;
}
