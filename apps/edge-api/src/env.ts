import {
  DEFAULT_OPENAI_AI_TEST_JUDGE_MODEL,
  DEFAULT_OPENAI_AI_TEST_RUNNER_MODEL,
  DEFAULT_OPENAI_REASONING_MODEL,
  OPENAI_RESPONSES_API_URL,
} from "./providers/openai-responses.js";

export interface EdgeApiEnv {
  DB?: D1Database;
  ARTIFACTS_BUCKET?: R2Bucket;
  ONBOARDING_SESSIONS?: DurableObjectNamespace;
  PUBLIC_OPS_APP_URL?: string;
  PUBLIC_STAFF_APP_URL?: string;
  PUBLIC_ONBOARDING_APP_URL?: string;
  PUBLIC_UPLOAD_APP_URL?: string;
  PUBLIC_API_URL?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  AUTOMATION_SHARED_SECRET?: string;
  ALLOW_INSECURE_TEST_OTP?: string;
  ELEVENLABS_API_KEY?: string;
  elevenlabs_api_key?: string;
  ELEVENLABS_AGENT_ID?: string;
  ELEVENLABS_BASE_URL?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_REDIRECT_URI?: string;
  MICROSOFT_AUTH_BASE_URL?: string;
  MICROSOFT_GRAPH_BASE_URL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  REASONING_PROVIDER?: string;
  REASONING_BASE_URL?: string;
  REASONING_API_KEY?: string;
  REASONING_MODEL?: string;
  AI_TEST_RUNNER_PROVIDER?: string;
  AI_TEST_RUNNER_BASE_URL?: string;
  AI_TEST_RUNNER_API_KEY?: string;
  AI_TEST_RUNNER_MODEL?: string;
  AI_TEST_JUDGE_PROVIDER?: string;
  AI_TEST_JUDGE_BASE_URL?: string;
  AI_TEST_JUDGE_API_KEY?: string;
  AI_TEST_JUDGE_MODEL?: string;
}

export interface AppConfig {
  publicOpsAppUrl: string;
  publicStaffAppUrl?: string;
  publicOnboardingAppUrl: string;
  publicUploadAppUrl: string;
  publicApiUrl: string;
  allowedOrigins: string[];
  blockingIssues: string[];
  advisoryIssues: string[];
  adminToken?: string;
  automationSharedSecret?: string;
  allowInsecureTestOtp: boolean;
  realtimeVoiceMode: "mock" | "configured";
  reasoningMode: "mock" | "hosted" | "openai-compatible";
  calendarMode: "mock" | "configured";
  messagingMode: "mock" | "configured";
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

function isLocalUrl(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function resolveElevenLabsApiKey(env: EdgeApiEnv): string | undefined {
  return firstNonEmpty(env.ELEVENLABS_API_KEY, env.elevenlabs_api_key);
}

export function resolveReasoningConfig(env: EdgeApiEnv): {
  mode: "mock" | "hosted" | "openai-compatible";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
} {
  const provider = (env.REASONING_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "openai-compatible") {
    const apiKey = firstNonEmpty(env.REASONING_API_KEY, env.OPENAI_API_KEY);
    return {
      mode: apiKey ? "openai-compatible" : "mock",
      baseUrl: firstNonEmpty(env.REASONING_BASE_URL, OPENAI_RESPONSES_API_URL),
      apiKey,
      model: firstNonEmpty(env.REASONING_MODEL, DEFAULT_OPENAI_REASONING_MODEL),
    };
  }

  if (env.REASONING_BASE_URL && env.REASONING_API_KEY) {
    return {
      mode: "hosted",
      baseUrl: env.REASONING_BASE_URL.trim(),
      apiKey: env.REASONING_API_KEY.trim(),
      model: firstNonEmpty(env.REASONING_MODEL),
    };
  }

  return { mode: "mock" };
}

export function resolveAiTestProviderConfig(
  env: EdgeApiEnv,
  kind: "runner" | "judge",
): {
  mode: "mock" | "hosted" | "openai-compatible";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
} {
  const providerKey = kind === "runner" ? env.AI_TEST_RUNNER_PROVIDER : env.AI_TEST_JUDGE_PROVIDER;
  const baseUrlKey = kind === "runner" ? env.AI_TEST_RUNNER_BASE_URL : env.AI_TEST_JUDGE_BASE_URL;
  const apiKeyKey = kind === "runner" ? env.AI_TEST_RUNNER_API_KEY : env.AI_TEST_JUDGE_API_KEY;
  const modelKey = kind === "runner" ? env.AI_TEST_RUNNER_MODEL : env.AI_TEST_JUDGE_MODEL;
  const provider = (providerKey ?? "").trim().toLowerCase();

  if (provider === "openai-compatible") {
    const apiKey = firstNonEmpty(apiKeyKey, env.OPENAI_API_KEY);
    return {
      mode: apiKey ? "openai-compatible" : "mock",
      baseUrl: firstNonEmpty(baseUrlKey, OPENAI_RESPONSES_API_URL),
      apiKey,
      model: firstNonEmpty(
        modelKey,
        kind === "runner" ? DEFAULT_OPENAI_AI_TEST_RUNNER_MODEL : DEFAULT_OPENAI_AI_TEST_JUDGE_MODEL,
      ),
    };
  }

  if (baseUrlKey && apiKeyKey) {
    return {
      mode: "hosted",
      baseUrl: baseUrlKey.trim(),
      apiKey: apiKeyKey.trim(),
      model: firstNonEmpty(modelKey),
    };
  }

  return { mode: "mock" };
}

export function getConfig(env: EdgeApiEnv): AppConfig {
  const publicApiUrl = env.PUBLIC_API_URL ?? "http://localhost:8787";
  const publicOnboardingAppUrl = env.PUBLIC_ONBOARDING_APP_URL ?? "http://localhost:5173";
  const publicOpsAppUrl = env.PUBLIC_OPS_APP_URL ?? publicOnboardingAppUrl;
  const publicStaffAppUrl = env.PUBLIC_STAFF_APP_URL;
  const publicUploadAppUrl = env.PUBLIC_UPLOAD_APP_URL ?? publicOnboardingAppUrl;
  const reasoning = resolveReasoningConfig(env);
  const allowedOrigins = toList(
    env.ALLOWED_ORIGINS,
    [publicOpsAppUrl, publicStaffAppUrl, publicOnboardingAppUrl, publicUploadAppUrl].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const blockingIssues: string[] = [];
  const advisoryIssues: string[] = [];

  if (!env.PUBLIC_API_URL) {
    blockingIssues.push("PUBLIC_API_URL is not configured; the worker is using a localhost fallback.");
  }
  if (!env.PUBLIC_OPS_APP_URL) {
    blockingIssues.push("PUBLIC_OPS_APP_URL is not configured; the worker is using a fallback origin.");
  }
  if (!env.PUBLIC_STAFF_APP_URL) {
    advisoryIssues.push("PUBLIC_STAFF_APP_URL is not configured; the worker is not advertising a dedicated staff origin.");
  }
  if (!env.PUBLIC_ONBOARDING_APP_URL) {
    blockingIssues.push("PUBLIC_ONBOARDING_APP_URL is not configured; the worker is using a fallback origin.");
  }
  if (!env.PUBLIC_UPLOAD_APP_URL) {
    blockingIssues.push("PUBLIC_UPLOAD_APP_URL is not configured; the worker is using a fallback origin.");
  }
  if (!env.ADMIN_TOKEN) {
    blockingIssues.push("ADMIN_TOKEN is not configured.");
  }
  if (!env.AUTOMATION_SHARED_SECRET) {
    blockingIssues.push("AUTOMATION_SHARED_SECRET is not configured.");
  }
  if (
    !isLocalUrl(publicApiUrl) &&
    [publicOpsAppUrl, publicOnboardingAppUrl, publicUploadAppUrl].some((url) => isLocalUrl(url))
  ) {
    blockingIssues.push("One or more public app URLs are still pointing at localhost while the API is non-local.");
  }

  const elevenLabsApiKey = resolveElevenLabsApiKey(env);
  if (elevenLabsApiKey && !env.ELEVENLABS_AGENT_ID) {
    advisoryIssues.push("ELEVENLABS_API_KEY is present but ELEVENLABS_AGENT_ID is missing, so realtime voice stays in mock mode.");
  }
  if (!elevenLabsApiKey && env.ELEVENLABS_AGENT_ID) {
    advisoryIssues.push("ELEVENLABS_AGENT_ID is present but ELEVENLABS_API_KEY is missing, so realtime voice stays in mock mode.");
  }

  if ((env.REASONING_PROVIDER ?? "").trim().toLowerCase() === "openai-compatible" && !firstNonEmpty(env.REASONING_API_KEY, env.OPENAI_API_KEY)) {
    advisoryIssues.push("REASONING_PROVIDER is openai-compatible but no REASONING_API_KEY or OPENAI_API_KEY is configured.");
  } else if ((env.REASONING_PROVIDER ?? "").trim().toLowerCase() === "hosted" && (!env.REASONING_BASE_URL || !env.REASONING_API_KEY)) {
    advisoryIssues.push("REASONING_PROVIDER is hosted but REASONING_BASE_URL or REASONING_API_KEY is missing.");
  }

  const aiTestRunnerProvider = (env.AI_TEST_RUNNER_PROVIDER ?? "").trim().toLowerCase();
  if (aiTestRunnerProvider === "openai-compatible" && !firstNonEmpty(env.AI_TEST_RUNNER_API_KEY, env.OPENAI_API_KEY)) {
    advisoryIssues.push("AI_TEST_RUNNER_PROVIDER is openai-compatible but no AI_TEST_RUNNER_API_KEY or OPENAI_API_KEY is configured.");
  } else if (aiTestRunnerProvider === "hosted" && (!env.AI_TEST_RUNNER_BASE_URL || !env.AI_TEST_RUNNER_API_KEY)) {
    advisoryIssues.push("AI_TEST_RUNNER_PROVIDER is hosted but AI_TEST_RUNNER_BASE_URL or AI_TEST_RUNNER_API_KEY is missing.");
  }

  const aiTestJudgeProvider = (env.AI_TEST_JUDGE_PROVIDER ?? "").trim().toLowerCase();
  if (aiTestJudgeProvider === "openai-compatible" && !firstNonEmpty(env.AI_TEST_JUDGE_API_KEY, env.OPENAI_API_KEY)) {
    advisoryIssues.push("AI_TEST_JUDGE_PROVIDER is openai-compatible but no AI_TEST_JUDGE_API_KEY or OPENAI_API_KEY is configured.");
  } else if (aiTestJudgeProvider === "hosted" && (!env.AI_TEST_JUDGE_BASE_URL || !env.AI_TEST_JUDGE_API_KEY)) {
    advisoryIssues.push("AI_TEST_JUDGE_PROVIDER is hosted but AI_TEST_JUDGE_BASE_URL or AI_TEST_JUDGE_API_KEY is missing.");
  }

  const microsoftConfiguredCount = [
    env.MICROSOFT_CLIENT_ID,
    env.MICROSOFT_CLIENT_SECRET,
    env.MICROSOFT_REDIRECT_URI,
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;
  if (microsoftConfiguredCount > 0 && microsoftConfiguredCount < 3) {
    advisoryIssues.push("Microsoft calendar credentials are only partially configured, so calendar stays in mock mode.");
  }

  const twilioConfiguredCount = [
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_AUTH_TOKEN,
    env.TWILIO_FROM_NUMBER,
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;
  if (twilioConfiguredCount > 0 && twilioConfiguredCount < 3) {
    advisoryIssues.push("Twilio messaging credentials are only partially configured, so SMS delivery stays in mock mode.");
  }

  return {
    publicOpsAppUrl,
    publicStaffAppUrl,
    publicOnboardingAppUrl,
    publicUploadAppUrl,
    publicApiUrl,
    allowedOrigins,
    blockingIssues,
    advisoryIssues,
    adminToken: env.ADMIN_TOKEN,
    automationSharedSecret: env.AUTOMATION_SHARED_SECRET,
    allowInsecureTestOtp: env.ALLOW_INSECURE_TEST_OTP === "true",
    realtimeVoiceMode: elevenLabsApiKey && env.ELEVENLABS_AGENT_ID ? "configured" : "mock",
    reasoningMode: reasoning.mode,
    calendarMode:
      env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_REDIRECT_URI
        ? "configured"
        : "mock",
    messagingMode:
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER ? "configured" : "mock",
  };
}
