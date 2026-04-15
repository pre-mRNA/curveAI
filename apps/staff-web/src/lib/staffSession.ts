import type { StaffProfile, StaffSession } from '../types';

export const STAFF_SESSION_STORAGE_KEY = 'curve-ai.staff-session';

export interface StoredStaffSession {
  token: string;
  expiresAt: string;
  staffId: string;
}

let memorySession: StoredStaffSession | null = null;

export function readStaffSession(): StoredStaffSession | null {
  return memorySession;
}

export function saveStaffSession(session: StaffSession, extras?: { staff?: StaffProfile }) {
  void extras;
  const nextValue: StoredStaffSession = {
    token: session.token,
    expiresAt: session.expiresAt,
    staffId: session.staffId,
  };
  memorySession = nextValue;
}

export function updateStoredStaffProfile(staff: StaffProfile) {
  void staff;
  const current = readStaffSession();
  if (!current) {
    return;
  }

  memorySession = current;
}

export function clearStaffSession() {
  memorySession = null;
}
