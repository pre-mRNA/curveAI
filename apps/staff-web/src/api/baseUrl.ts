export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
      return 'http://127.0.0.1:8787';
    }
  }

  throw new Error('VITE_API_BASE_URL must be configured for this deployment.');
}
