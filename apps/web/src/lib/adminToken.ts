export const ADMIN_TOKEN_STORAGE_KEY = 'curve-ai.admin-token';

let memoryToken = '';

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function readAdminToken(): string {
  if (!hasWindow()) {
    return memoryToken;
  }

  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? memoryToken;
}

export function saveAdminToken(token: string): void {
  const trimmed = token.trim();
  memoryToken = trimmed;
  if (!hasWindow()) {
    return;
  }

  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
}

export function clearAdminToken(): void {
  memoryToken = '';
  if (!hasWindow()) {
    return;
  }

  window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}
