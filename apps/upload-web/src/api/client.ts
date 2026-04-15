const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function uploadPhotos(token: string, files: File[]): Promise<{ ok: true; uploaded: number }> {
  const formData = new FormData();
  files.forEach((file) => formData.append('photos', file));

  const response = await fetch(`${API_BASE_URL}/uploads/${encodeURIComponent(token)}/photos`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Upload failed: ${response.status}`);
  }

  return (await response.json()) as { ok: true; uploaded: number };
}
