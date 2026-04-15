export interface EdgeApiEnv {
  DB?: D1Database;
  ARTIFACTS_BUCKET?: R2Bucket;
  ONBOARDING_SESSIONS?: DurableObjectNamespace;
  PUBLIC_APP_URL?: string;
  PUBLIC_OPS_APP_URL?: string;
  PUBLIC_ONBOARDING_APP_URL?: string;
  PUBLIC_UPLOAD_APP_URL?: string;
  PUBLIC_API_URL?: string;
  ALLOWED_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  AUTOMATION_SHARED_SECRET?: string;
  ASSET_SIGNING_SECRET?: string;
  ALLOW_INSECURE_TEST_OTP?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_REDIRECT_URI?: string;
  MICROSOFT_GRAPH_BASE_URL?: string;
  REASONING_PROVIDER?: string;
  REASONING_BASE_URL?: string;
  REASONING_API_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

export interface AppConfig {
  publicAppUrl: string;
  publicOpsAppUrl: string;
  publicOnboardingAppUrl: string;
  publicUploadAppUrl: string;
  publicApiUrl: string;
  allowedOrigins: string[];
  adminToken?: string;
  automationSharedSecret?: string;
  photoAccessSecret?: string;
  allowInsecureTestOtp: boolean;
  realtimeVoiceMode: "mock" | "configured";
  reasoningMode: "mock" | "hosted" | "openai-compatible";
  calendarMode: "mock" | "configured";
  r2S3: {
    accountId?: string;
    bucketName?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

function toList(value: string | undefined, fallback: string[]): string[] {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function getConfig(env: EdgeApiEnv): AppConfig {
  const publicAppUrl = env.PUBLIC_APP_URL ?? env.PUBLIC_ONBOARDING_APP_URL ?? "http://localhost:5173";
  const publicApiUrl = env.PUBLIC_API_URL ?? "http://localhost:8787";
  const publicOpsAppUrl = env.PUBLIC_OPS_APP_URL ?? publicAppUrl;
  const publicOnboardingAppUrl = env.PUBLIC_ONBOARDING_APP_URL ?? publicAppUrl;
  const publicUploadAppUrl = env.PUBLIC_UPLOAD_APP_URL ?? publicAppUrl;
  const reasoningProvider = (env.REASONING_PROVIDER ?? "").trim().toLowerCase();
  const allowedOrigins = toList(
    env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN,
    [publicOpsAppUrl, publicOnboardingAppUrl, publicUploadAppUrl],
  );
  const localApi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicApiUrl);
  return {
    publicAppUrl,
    publicOpsAppUrl,
    publicOnboardingAppUrl,
    publicUploadAppUrl,
    publicApiUrl,
    allowedOrigins,
    adminToken: env.ADMIN_TOKEN,
    automationSharedSecret: env.AUTOMATION_SHARED_SECRET,
    photoAccessSecret: env.ASSET_SIGNING_SECRET ?? env.AUTOMATION_SHARED_SECRET ?? env.ADMIN_TOKEN,
    allowInsecureTestOtp: env.ALLOW_INSECURE_TEST_OTP === "true" || localApi,
    realtimeVoiceMode: env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID ? "configured" : "mock",
    reasoningMode:
      env.REASONING_BASE_URL && env.REASONING_API_KEY
        ? reasoningProvider === "openai-compatible"
          ? "openai-compatible"
          : "hosted"
        : "mock",
    calendarMode:
      env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_REDIRECT_URI
        ? "configured"
        : "mock",
    r2S3: {
      accountId: env.R2_ACCOUNT_ID,
      bucketName: env.R2_BUCKET_NAME,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  };
}
