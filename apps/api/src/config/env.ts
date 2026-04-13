import fs from "node:fs";
import path from "node:path";

export interface AppEnv {
  nodeEnv: string;
  port: number;
  host: string;
  publicBaseUrl: string;
  publicAppUrl: string;
  allowedOrigins: string[];
  uploadDir: string;
  stateFilePath: string;
  enableDemoData: boolean;
  adminToken?: string;
  automationSharedSecret?: string;
  secretsFilePaths: string[];
}

function parseDotenv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");

    result[key] = value;
  }

  return result;
}

function loadLocalSecrets(candidates: string[]): string[] {
  const loaded: string[] = [];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }

    const parsed = parseDotenv(fs.readFileSync(candidate, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    loaded.push(candidate);
  }

  return loaded;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function toList(value: string | undefined, fallback: string[]): string[] {
  if (value == null || value.trim().length === 0) {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function loadEnv(): AppEnv {
  const packageRoot = path.resolve(__dirname, "..", "..");
  const cwd = process.cwd();
  const candidateFiles = [
    path.resolve(cwd, "secrets"),
    path.resolve(cwd, "secrets.local.env"),
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "apps", "api", "secrets"),
    path.resolve(cwd, "apps", "api", "secrets.local.env"),
    path.resolve(cwd, "apps", "api", ".env"),
    path.resolve(packageRoot, "secrets"),
    path.resolve(packageRoot, "secrets.local.env"),
    path.resolve(packageRoot, ".env")
  ];

  const secretsFilePaths = loadLocalSecrets(candidateFiles);
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const port = toInt(process.env.PORT, 3000);
  const publicAppUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:5173";

  return {
    nodeEnv,
    port,
    host: process.env.HOST ?? "0.0.0.0",
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    publicAppUrl,
    allowedOrigins: toList(process.env.ALLOWED_ORIGINS, [publicAppUrl, "http://localhost:5173"]),
    uploadDir: process.env.UPLOAD_DIR ?? path.resolve(packageRoot, "uploads"),
    stateFilePath: process.env.STATE_FILE_PATH ?? path.resolve(packageRoot, "data", "crm-store.json"),
    enableDemoData: toBoolean(process.env.ENABLE_DEMO_DATA, nodeEnv !== "production"),
    adminToken: process.env.ADMIN_TOKEN ?? (nodeEnv === "production" ? undefined : "curve-admin-dev-token"),
    automationSharedSecret:
      process.env.AUTOMATION_SHARED_SECRET ?? (nodeEnv === "production" ? undefined : "curve-automation-dev-secret"),
    secretsFilePaths
  };
}

export function ensureUploadDir(uploadDir: string): void {
  fs.mkdirSync(uploadDir, { recursive: true });
}
