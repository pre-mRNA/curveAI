export interface StoredOnboardingSession {
  inviteCode: string;
  sessionId: string;
  sessionToken: string;
}

let memorySession: StoredOnboardingSession | null = null;

export function readOnboardingSession(): StoredOnboardingSession | null {
  return memorySession;
}

export function saveOnboardingSession(session: StoredOnboardingSession): void {
  memorySession = session;
}

export function clearOnboardingSession(): void {
  memorySession = null;
}
