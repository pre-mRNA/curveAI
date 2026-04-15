function localFallbackApiBaseUrl(): string | undefined {
  const location = globalThis.location;
  if (!location) {
    return undefined;
  }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8787';
  }
  return undefined;
}

export function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const fallback = localFallbackApiBaseUrl();
  if (fallback) {
    return fallback;
  }

  throw new Error('VITE_API_BASE_URL must be configured for this deployment.');
}
