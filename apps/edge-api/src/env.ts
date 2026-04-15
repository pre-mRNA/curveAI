export interface EdgeApiEnv {
  DB?: D1Database;
  ARTIFACTS_BUCKET?: R2Bucket;
  ONBOARDING_SESSIONS?: DurableObjectNamespace;
  PUBLIC_APP_URL?: string;
  PUBLIC_API_URL?: string;
  ALLOWED_ORIGIN?: string;
  ADMIN_TOKEN?: string;
  AUTOMATION_SHARED_SECRET?: string;
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
}

export interface AppConfig {
  publicAppUrl: string;
  publicApiUrl: string;
  allowedOrigin: string;
  adminToken?: string;
  automationSharedSecret?: string;
  realtimeVoiceMode: "mock" | "configured";
  reasoningMode: "mock" | "hosted" | "openai-compatible";
  calendarMode: "mock" | "configured";
}

export function getConfig(env: EdgeApiEnv): AppConfig {
  const publicAppUrl = env.PUBLIC_APP_URL ?? "http://localhost:5173";
  const publicApiUrl = env.PUBLIC_API_URL ?? "http://localhost:8787";
  const reasoningProvider = (env.REASONING_PROVIDER ?? "").trim().toLowerCase();
  return {
    publicAppUrl,
    publicApiUrl,
    allowedOrigin: env.ALLOWED_ORIGIN ?? publicAppUrl,
    adminToken: env.ADMIN_TOKEN,
    automationSharedSecret: env.AUTOMATION_SHARED_SECRET,
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
  };
}
