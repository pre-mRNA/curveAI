export const ADMIN_TOKEN_STORAGE_KEY = 'curve-ai.admin-token';

let memoryToken = '';

export function readAdminToken(): string {
  return memoryToken;
}

export function saveAdminToken(token: string): void {
  memoryToken = token.trim();
}

export function clearAdminToken(): void {
  memoryToken = '';
}
