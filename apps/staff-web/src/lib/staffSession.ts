import type { StaffProfile, StaffSession } from '../types';

export const STAFF_SESSION_STORAGE_KEY = 'curve-ai.staff-session';

export interface StoredStaffSession {
  token: string;
  expiresAt: string;
  staffId: string;
  staff?: StaffProfile;
}

let memorySession: StoredStaffSession | null = null;

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function readStaffSession(): StoredStaffSession | null {
  if (!hasWindow()) {
    return memorySession;
  }

  const raw = window.sessionStorage.getItem(STAFF_SESSION_STORAGE_KEY);
  if (!raw) {
    return memorySession;
  }

  try {
    const parsed = JSON.parse(raw) as StoredStaffSession;
    memorySession = parsed;
    return parsed;
  } catch {
    window.sessionStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
    memorySession = null;
    return null;
  }
}

export function saveStaffSession(session: StaffSession, extras?: { staff?: StaffProfile }) {
  const nextValue: StoredStaffSession = {
    token: session.token,
    expiresAt: session.expiresAt,
    staffId: session.staffId,
    staff: extras?.staff,
  };
  memorySession = nextValue;

  if (!hasWindow()) {
    return;
  }

  window.sessionStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(nextValue));
}

export function updateStoredStaffProfile(staff: StaffProfile) {
  const current = readStaffSession();
  if (!current) {
    return;
  }

  const nextValue = {
    ...current,
    staff,
  };
  memorySession = nextValue;

  if (!hasWindow()) {
    return;
  }

  window.sessionStorage.setItem(STAFF_SESSION_STORAGE_KEY, JSON.stringify(nextValue));
}

export function clearStaffSession() {
  memorySession = null;
  if (!hasWindow()) {
    return;
  }
  window.sessionStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
}
