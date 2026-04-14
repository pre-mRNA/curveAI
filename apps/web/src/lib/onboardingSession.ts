export const ONBOARDING_SESSION_STORAGE_KEY = 'curve-ai.onboarding-session';

export interface StoredOnboardingSession {
  inviteCode: string;
  sessionId: string;
  sessionToken: string;
}

let memorySession: StoredOnboardingSession | null = null;

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function readOnboardingSession(): StoredOnboardingSession | null {
  if (!hasWindow()) {
    return memorySession;
  }

  const raw = window.sessionStorage.getItem(ONBOARDING_SESSION_STORAGE_KEY);
  if (!raw) {
    return memorySession;
  }

  try {
    return JSON.parse(raw) as StoredOnboardingSession;
  } catch {
    return memorySession;
  }
}

export function saveOnboardingSession(session: StoredOnboardingSession): void {
  memorySession = session;

  if (!hasWindow()) {
    return;
  }

  window.sessionStorage.setItem(ONBOARDING_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearOnboardingSession(): void {
  memorySession = null;

  if (!hasWindow()) {
    return;
  }

  window.sessionStorage.removeItem(ONBOARDING_SESSION_STORAGE_KEY);
}
