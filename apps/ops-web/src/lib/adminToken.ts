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
