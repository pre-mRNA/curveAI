export type LogLevel = "info" | "warn" | "error";

type LogValue = string | number | boolean | null | undefined | LogValue[] | Record<string, unknown>;

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(token|secret|authorization|cookie|signature|api[_-]?key|password)/i;

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, `Bearer ${REDACTED}`)
    .replace(/sk_[A-Za-z0-9]+/g, `sk_${REDACTED}`)
    .replace(/(__Host-)?curve_(staff|onboarding)_session=[^;\s]+/gi, `${REDACTED}`)
    .replace(/x-curve-signature\s*[:=]\s*sha256=[A-Fa-f0-9]+/gi, `x-curve-signature=${REDACTED}`);
}

function sanitizeValue(value: LogValue, parentKey?: string): LogValue {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return parentKey && SENSITIVE_KEY_PATTERN.test(parentKey) ? REDACTED : sanitizeString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeValue(entry))
      .filter((entry) => entry !== undefined);
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, sanitizeValue(entry as LogValue, key)])
      .filter(([, entry]) => entry !== undefined),
  );
}

export function summarizeOrigin(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }
  try {
    return new URL(origin).origin;
  } catch {
    return sanitizeString(origin);
  }
}

export function summarizeRequestPath(path: string): string {
  const normalized = path || "/";
  return normalized
    .replace(/^\/onboarding\/invites\/[^/]+\/session$/, "/onboarding/invites/[code]/session")
    .replace(/^\/onboarding\/sessions\/[^/]+(?=\/|$)/, "/onboarding/sessions/[id]")
    .replace(/^\/uploads\/[^/]+(?=\/|$)/, "/uploads/[token]")
    .replace(/^\/jobs\/[^/]+\/card$/, "/jobs/[id]/card")
    .replace(/^\/customers\/[^/]+$/, "/customers/[id]")
    .replace(/^\/assets\/photos\/[^/]+$/, "/assets/photos/[id]");
}

export function classifyRouteFamily(path: string): string {
  if (path === "/health") {
    return "health";
  }
  if (path.startsWith("/voice/")) {
    return "voice";
  }
  if (path.startsWith("/onboarding/")) {
    return "onboarding";
  }
  if (path.startsWith("/uploads/")) {
    return "upload";
  }
  if (path.startsWith("/staff/")) {
    return "staff";
  }
  if (path.startsWith("/dashboard") || path.startsWith("/ai-test-studio/")) {
    return "ops";
  }
  if (path.startsWith("/jobs")) {
    return "jobs";
  }
  if (path.startsWith("/customers/")) {
    return "customers";
  }
  if (path.startsWith("/assets/")) {
    return "assets";
  }
  return "other";
}

export function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message),
    };
  }
  return {
    message: sanitizeString(String(error)),
  };
}

export function writeLog(level: LogLevel, event: string, fields: Record<string, unknown>) {
  const record = sanitizeValue({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  }) as Record<string, unknown>;

  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}
