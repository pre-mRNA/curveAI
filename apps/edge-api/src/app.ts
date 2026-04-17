import { cors } from "hono/cors";
import { Hono } from "hono";
import { z, type ZodTypeAny } from "zod";
import { AiTestStudioRuleError, AiTestStudioService, type AiTestStudioProviders } from "./ai-test-studio-service.js";
import {
  getConfig,
  resolveAiTestProviderConfig,
  resolveElevenLabsApiKey,
  resolveReasoningConfig,
  type EdgeApiEnv,
} from "./env.js";
import { classifyRouteFamily, summarizeError, summarizeOrigin, summarizeRequestPath, writeLog } from "./logger.js";
import { OnboardingRuleError, OnboardingService, type ServiceProviders } from "./onboarding-service.js";
import {
  MockMicrosoftCalendarAdapter,
  createMockMicrosoftAccessToken,
  createMockMicrosoftAuthorizationCode,
  defaultMockMicrosoftIdentity,
  parseMockMicrosoftAccessToken,
  parseMockMicrosoftAuthorizationCode,
} from "./providers/calendar.js";
import {
  collectToolCalls,
  HttpAiTestJudgeProvider,
  HttpAiTestRunnerProvider,
  MockAiTestJudgeProvider,
  MockAiTestRunnerProvider,
  WorkerRouteAiTestRunnerProvider,
} from "./providers/ai-test-studio.js";
import { MockMessagingProvider, TwilioMessagingProvider, type MessagingProvider } from "./providers/messaging.js";
import { ElevenLabsRealtimeProvider, MockRealtimeVoiceProvider } from "./providers/realtime.js";
import { HeuristicReasoningProvider, HttpReasoningProvider } from "./providers/reasoning.js";
import { HeuristicVoiceCloneProvider } from "./providers/voice-clone.js";
import { R2ObjectStore, InMemoryObjectStore, type ObjectStore } from "./storage/artifacts.js";
import { D1OnboardingRepository } from "./storage/d1.js";
import { InMemoryOnboardingRepository } from "./storage/memory.js";
import type { OnboardingRepository } from "./storage/repository.js";
import type {
  CallbackTaskRecord,
  DashboardPayload,
  DashboardQuote,
  JobCardEnvelope,
  JobPhoto,
  JobRecord,
  OnboardingSessionRecord,
  QuoteRecord,
  StaffRecord,
} from "./models.js";
import {
  aiTestCaseCreateInputSchema,
  aiTestRunInputSchema,
  onboardingInviteInputSchema,
  onboardingReviewPatchSchema,
  onboardingStartInputSchema,
  onboardingTurnInputSchema,
  onboardingVoiceSampleInputSchema,
  onboardingVoiceTokenInputSchema,
  staffCalendarConnectInputSchema,
  staffCalendarDisconnectInputSchema,
  staffInviteInputSchema,
  staffOtpVerificationInputSchema,
  staffPricingInterviewInputSchema,
  staffVoiceConsentInputSchema,
  sendPhotoLinkInputSchema,
  voiceAppointmentInputSchema,
  voiceCallbackInputSchema,
  voiceContextInputSchema,
  voicePostCallInputSchema,
  voiceQuoteInputSchema,
} from "./validation.js";
import { constantTimeEqual, createId, createParticipantToken, isExpired, sha256Hex, signHmacSha256 } from "./crypto.js";

type AppBindings = { Bindings: EdgeApiEnv };
const STAFF_SESSION_COOKIE = "curve_staff_session";
const ONBOARDING_SESSION_COOKIE = "curve_onboarding_session";

const defaultMemoryRepo = new InMemoryOnboardingRepository();
const defaultMemoryObjectStore = new InMemoryObjectStore();
type OnboardingSessionResult = { session: OnboardingSessionRecord } | { error: Response };
interface AppProviders extends ServiceProviders {
  messaging: MessagingProvider;
}

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return {};
  }
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator >= 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] : [entry, ""];
      }),
  );
}

function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [scheme, ...rest] = authorization.split(/\s+/);
    if (scheme && /^bearer$/i.test(scheme) && rest.length > 0) {
      return rest.join(" ").trim();
    }
  }
  return undefined;
}

function getBasicAuth(request: Request): { username: string; password: string } | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return undefined;
  }
  const [scheme, credentials] = authorization.split(/\s+/, 2);
  if (!scheme || !/^basic$/i.test(scheme) || !credentials) {
    return undefined;
  }
  try {
    const decoded = atob(credentials);
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return undefined;
  }
}

function getAdminAccessToken(request: Request): string | undefined {
  return getBearerToken(request);
}

function sessionCookieNames(baseName: string): string[] {
  return [`__Host-${baseName}`, baseName];
}

function getStaffAccessToken(request: Request): string | undefined {
  const cookies = parseCookies(request);
  return (
    sessionCookieNames(STAFF_SESSION_COOKIE).map((name) => cookies[name]).find(Boolean) ??
    undefined
  );
}

function getOnboardingAccessToken(request: Request): string | undefined {
  const cookies = parseCookies(request);
  return (
    sessionCookieNames(ONBOARDING_SESSION_COOKIE).map((name) => cookies[name]).find(Boolean) ??
    undefined
  );
}

function cookieNameForRequest(baseName: string, requestUrl: string): string {
  return isLocalRequest(requestUrl) ? baseName : `__Host-${baseName}`;
}

function buildSessionCookie(name: string, value: string, maxAgeSeconds: number, requestUrl: string): string {
  const secure = !isLocalRequest(requestUrl);
  const sameSite = secure ? "None" : "Lax";
  return `${cookieNameForRequest(name, requestUrl)}=${value}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=${sameSite}; Max-Age=${maxAgeSeconds}`;
}

function buildExpiredCookies(name: string, requestUrl: string): string[] {
  const secure = !isLocalRequest(requestUrl);
  const sameSite = secure ? "None" : "Lax";
  return sessionCookieNames(name).map(
    (cookieName) =>
      `${cookieName}=; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=${sameSite}; Max-Age=0`,
  );
}

function requestOrigin(request: Request): string | undefined {
  return request.headers.get("origin") ?? undefined;
}

function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function hasCookieBackedBrowserSession(request: Request): boolean {
  return Boolean(getStaffAccessToken(request) || getOnboardingAccessToken(request));
}

function isAllowedBrowserOrigin(request: Request, allowedOrigins: string[]): boolean {
  const origin = requestOrigin(request);
  if (!origin) {
    if (isLocalRequest(request.url)) {
      return true;
    }
    return !hasCookieBackedBrowserSession(request);
  }
  if (isLocalRequest(request.url) && isLocalOrigin(origin)) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

function resolveCorsOrigin(origin: string | undefined, requestUrl: string, allowedOrigins: string[]): string | undefined {
  if (!origin) {
    return undefined;
  }
  if (allowedOrigins.includes(origin)) {
    return origin;
  }
  if (isLocalRequest(requestUrl) && isLocalOrigin(origin)) {
    return origin;
  }
  return undefined;
}

function parseValidation<TSchema extends ZodTypeAny>(schema: TSchema, input: unknown): { data?: z.output<TSchema>; issues?: Array<{ path: string; message: string }> } {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { data: parsed.data };
  }
  return {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

type AuthActor =
  | { kind: "admin" }
  | { kind: "staff"; staffId: string; expiresAt: string };

function createOtpCode(): string {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return String((bytes[0] % 900000) + 100000);
}

function sanitizeStaff(staff: StaffRecord | undefined) {
  if (!staff) {
    return undefined;
  }
  const {
    inviteTokenHash: _inviteTokenHash,
    otpCodeHash: _otpCodeHash,
    otpIssuedAt,
    otpFailedAttempts,
    otpVerifiedAt,
    authExpiresAt,
    ...safeStaff
  } = staff;
  const safeCalendarConnection = safeStaff.calendarConnection
    ? {
        ...safeStaff.calendarConnection,
        authState: undefined,
        accessToken: undefined,
        refreshToken: undefined,
      }
    : undefined;
  return {
    ...safeStaff,
    calendarConnection: safeCalendarConnection,
    otpIssuedAt,
    otpFailedAttempts,
    otpVerifiedAt,
    authExpiresAt,
  };
}

function derivePricingProfile(responses: Record<string, unknown>) {
  const numeric = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    baseCalloutFee: numeric(responses.baseCalloutFee, 180),
    minimumJobPrice: numeric(responses.minimumJobPrice, 160),
    hourlyRate: numeric(responses.hourlyRate, 145),
    rushMultiplier: numeric(responses.rushMultiplier, 1.35),
    complexityMultiplier: numeric(responses.complexityMultiplier, 1.2),
    confidenceFloor: numeric(responses.confidenceFloor, 0.68),
  };
}

function parseJsonBody(rawBody: string): unknown | undefined {
  if (!rawBody.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function isExpiredUploadRequest(upload: { expiresAt: string }): boolean {
  return new Date(upload.expiresAt).getTime() < Date.now();
}

function publicJobSummary(jobSummary?: string, issue?: string, requestNote?: string): string | undefined {
  const candidate = jobSummary?.trim() || issue?.trim();
  if (!candidate) {
    return undefined;
  }

  const normalizedCandidate = candidate.toLowerCase();
  const normalizedNote = requestNote?.trim().toLowerCase();
  if (
    normalizedCandidate === normalizedNote ||
    normalizedCandidate === "customer photo upload requested." ||
    normalizedCandidate === "photo upload requested from voice tooling."
  ) {
    return undefined;
  }

  return candidate;
}

function buildPhotoUploadSmsBody(input: {
  uploadLink: string;
  jobSummary?: string;
  requestNote?: string;
  requestedBy?: string;
}): string {
  const lines = ["Please upload photos for your job using this secure link:"];
  if (input.jobSummary) {
    lines.push(`Job: ${input.jobSummary}`);
  }
  if (input.requestNote) {
    lines.push(`What to show: ${input.requestNote}`);
  }
  if (input.requestedBy) {
    lines.push(`Requested by: ${input.requestedBy}`);
  }
  lines.push(input.uploadLink);
  return lines.join("\n");
}

async function toPublicUploadSummary(
  repo: OnboardingRepository,
  upload: {
    fileCount: number;
    status: string;
    expiresAt: string;
    jobId?: string;
    staffId?: string;
    notes?: string;
  },
) {
  const [staff, jobCard] = await Promise.all([
    upload.staffId ? repo.getStaff(upload.staffId) : Promise.resolve(undefined),
    upload.jobId ? repo.getJobCard(upload.jobId) : Promise.resolve(undefined),
  ]);

  return {
    fileCount: upload.fileCount,
    status: upload.status,
    expiresAt: upload.expiresAt,
    requestedBy: staff?.fullName,
    businessName: staff?.companyName,
    siteLabel: jobCard?.job.address ?? jobCard?.job.location?.label ?? jobCard?.job.location?.suburb,
    jobSummary: publicJobSummary(jobCard?.job.summary, jobCard?.job.issue, upload.notes),
    requestNote: upload.notes,
  };
}

function isLocalRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function requestAuthKind(request: Request): string {
  if (getAdminAccessToken(request)) {
    return "admin";
  }
  if (getStaffAccessToken(request)) {
    return "staff";
  }
  if (getOnboardingAccessToken(request)) {
    return "onboarding";
  }
  if (request.headers.get("x-curve-signature") || request.headers.get("x-curve-timestamp")) {
    return "automation";
  }
  return "anonymous";
}

type SupportedPhotoMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

function bytesMatch(source: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => source[index] === value);
}

function bytesToAscii(source: Uint8Array): string {
  return Array.from(source, (value) => String.fromCharCode(value)).join("");
}

async function detectSupportedPhotoMimeType(file: Pick<File, "slice">): Promise<SupportedPhotoMimeType | undefined> {
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (header.length < 12) {
    return undefined;
  }
  if (bytesMatch(header, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (bytesMatch(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytesToAscii(header.slice(0, 4)) === "RIFF" && bytesToAscii(header.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  if (bytesToAscii(header.slice(4, 8)) === "ftyp") {
    const brand = bytesToAscii(header.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) {
      return "image/heic";
    }
    if (["heif", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heif";
    }
  }
  return undefined;
}

async function getTrustedPhotoMimeType(file: Pick<File, "type" | "slice">): Promise<SupportedPhotoMimeType | undefined> {
  const detected = await detectSupportedPhotoMimeType(file);
  if (!detected) {
    return undefined;
  }
  if (!file.type) {
    return detected;
  }
  const normalizedType = file.type.toLowerCase();
  const allowedByDetected: Record<SupportedPhotoMimeType, Set<string>> = {
    "image/jpeg": new Set(["image/jpeg", "image/pjpeg"]),
    "image/png": new Set(["image/png"]),
    "image/webp": new Set(["image/webp"]),
    "image/heic": new Set(["image/heic", "image/heic-sequence", "application/octet-stream"]),
    "image/heif": new Set(["image/heif", "image/heif-sequence", "application/octet-stream"]),
  };
  return allowedByDetected[detected].has(normalizedType) ? detected : undefined;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toPhotoCaption(fileName: string): string {
  const base = fileName.split(".").slice(0, -1).join(".") || fileName;
  return base.replace(/[_-]+/g, " ").trim() || "Job photo";
}

function dashboardConfidence(confidence: number): "low" | "medium" | "high" {
  if (confidence >= 0.84) {
    return "high";
  }
  if (confidence >= 0.68) {
    return "medium";
  }
  return "low";
}

function dashboardStatus(status: JobRecord["status"]): DashboardPayload["jobs"][number]["status"] {
  if (status === "scheduled") {
    return "booked";
  }
  if (status === "callback") {
    return "needs_follow_up";
  }
  if (status === "closed") {
    return "completed";
  }
  return status;
}

function dashboardCallbackStatus(status: CallbackTaskRecord["status"]): DashboardPayload["callbacks"][number]["status"] {
  if (status === "done") {
    return "closed";
  }
  if (status === "open") {
    return "contacted";
  }
  return "queued";
}

function previewQuote(job: JobRecord): QuoteRecord {
  const basePrice = Math.max(120, Math.round((job.summary?.length ?? 80) * 2));
  return {
    id: `preview-${job.id}`,
    jobId: job.id,
    staffId: job.staffId,
    variant: "control" as const,
    amount: basePrice,
    currency: "AUD",
    basePrice,
    strategyAdjustment: 0,
    experimentAdjustment: 0,
    floorPrice: Math.max(90, basePrice - 60),
    ceilingPrice: basePrice + 120,
    confidence: 0.54,
    status: "draft" as const,
    rationale: ["Preview quote generated from current job context."],
    createdAt: job.updatedAt,
    updatedAt: job.updatedAt,
  };
}

async function mapDashboardPayload(jobs: JobRecord[], callbacks: CallbackTaskRecord[], experiments: DashboardPayload["experiments"]): Promise<DashboardPayload> {
  return {
    jobs: await Promise.all(
      jobs.map(async (job) => {
        const quote = job.quote ?? previewQuote(job);
        const callback = job.callbackTask
          ? {
              id: job.callbackTask.id,
              customerName: job.callerName ?? "Pending caller",
              phone: job.callbackTask.phoneNumber ?? job.callerPhone ?? "Unknown phone",
              reason: job.callbackTask.reason ?? "General follow-up",
              status: dashboardCallbackStatus(job.callbackTask.status),
              dueAt:
                job.callbackTask.dueAt == null
                  ? "TBD"
                  : new Date(job.callbackTask.dueAt).toLocaleString("en-AU", {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    }),
            }
          : null;

        return {
          id: job.id,
          customerName: job.callerName ?? "Unknown caller",
          suburb: job.location?.label ?? job.address ?? "Unknown suburb",
          summary: job.summary ?? job.issue ?? "Awaiting call summary",
          status: dashboardStatus(job.status),
          photos: await Promise.all(
            job.photos.map(async (photo) => ({
              id: photo.id,
              caption: photo.caption ?? photo.filename ?? "Job photo",
            })),
          ),
          quote: {
            basePrice: quote.basePrice,
            strategyAdjustment: quote.strategyAdjustment,
            experimentAdjustment: quote.experimentAdjustment,
            presentedPrice: quote.amount,
            confidence: dashboardConfidence(quote.confidence),
          },
          callback,
          updatedAt: new Date(job.updatedAt).toLocaleTimeString("en-AU", {
            hour: "numeric",
            minute: "2-digit",
          }),
        };
      }),
    ),
    callbacks: callbacks.map((callback) => ({
      id: callback.id,
      customerName: callback.jobId ? jobs.find((job) => job.id === callback.jobId)?.callerName ?? "Pending caller" : "Pending caller",
      phone: callback.phoneNumber ?? jobs.find((job) => job.id === callback.jobId)?.callerPhone ?? "Unknown phone",
      reason: callback.reason ?? "General follow-up",
      status: dashboardCallbackStatus(callback.status),
      dueAt:
        callback.dueAt == null
          ? "TBD"
          : new Date(callback.dueAt).toLocaleString("en-AU", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            }),
    })),
    experiments,
  };
}

async function signJobCardEnvelope(card: JobCardEnvelope): Promise<JobCardEnvelope> {
  const mapPhoto = async (photo: JobPhoto) => ({
    ...photo,
  });
  return {
    ...card,
    job: {
      ...card.job,
      photos: await Promise.all(card.job.photos.map(mapPhoto)),
    },
    photos: await Promise.all(card.photos.map(mapPhoto)),
  };
}

function buildProviders(env: EdgeApiEnv): AppProviders {
  const heuristicReasoning = new HeuristicReasoningProvider();
  const elevenLabsApiKey = resolveElevenLabsApiKey(env);
  const reasoning = resolveReasoningConfig(env);
  return {
    realtimeVoice:
      elevenLabsApiKey && env.ELEVENLABS_AGENT_ID
        ? new ElevenLabsRealtimeProvider({
            apiKey: elevenLabsApiKey,
            agentId: env.ELEVENLABS_AGENT_ID,
            baseUrl: env.ELEVENLABS_BASE_URL,
          })
        : new MockRealtimeVoiceProvider(),
    reasoning:
      reasoning.mode !== "mock" && reasoning.baseUrl && reasoning.apiKey
        ? new HttpReasoningProvider({
            baseUrl: reasoning.baseUrl,
            apiKey: reasoning.apiKey,
            model: reasoning.model,
            mode: reasoning.mode,
            fallback: heuristicReasoning,
          })
        : heuristicReasoning,
    calendar: new MockMicrosoftCalendarAdapter({
      tenantId: env.MICROSOFT_TENANT_ID,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
      authBaseUrl: env.MICROSOFT_AUTH_BASE_URL,
      graphBaseUrl: env.MICROSOFT_GRAPH_BASE_URL,
    }),
    voiceClone: new HeuristicVoiceCloneProvider(),
    messaging:
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
        ? new TwilioMessagingProvider({
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            fromNumber: env.TWILIO_FROM_NUMBER,
            baseUrl: env.TWILIO_BASE_URL,
          })
        : new MockMessagingProvider(),
  };
}

function buildAiTestProviders(
  env: EdgeApiEnv,
  options?: {
    runWorkerRouteCase?: (input: {
      testCase: Parameters<AiTestStudioProviders["runner"]["runCase"]>[0]["testCase"];
      operatorNotes?: string;
    }) => Promise<ReturnType<AiTestStudioProviders["runner"]["runCase"]> extends Promise<infer T> ? T : never>;
  },
): AiTestStudioProviders {
  const mockRunner = new MockAiTestRunnerProvider();
  const mockJudge = new MockAiTestJudgeProvider();
  const runner = resolveAiTestProviderConfig(env, "runner");
  const judge = resolveAiTestProviderConfig(env, "judge");
  const baseRunner =
    runner.mode !== "mock" && runner.baseUrl && runner.apiKey
      ? new HttpAiTestRunnerProvider({
          baseUrl: runner.baseUrl,
          apiKey: runner.apiKey,
          model: runner.model,
          mode: runner.mode,
          fallback: mockRunner,
        })
      : mockRunner;

  return {
    runner: options?.runWorkerRouteCase
      ? new WorkerRouteAiTestRunnerProvider({
          fallback: baseRunner,
          runWorkerRouteCase: options.runWorkerRouteCase,
        })
      : baseRunner,
    judge:
      judge.mode !== "mock" && judge.baseUrl && judge.apiKey
        ? new HttpAiTestJudgeProvider({
            baseUrl: judge.baseUrl,
            apiKey: judge.apiKey,
            model: judge.model,
            mode: judge.mode,
            fallback: mockJudge,
          })
        : mockJudge,
  };
}

async function createAutomationHeaders(secret: string, path: string, body: unknown) {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now().toString();
  const signature = await signHmacSha256(secret, `${timestamp}.POST.${path}.${rawBody}`);
  return {
    rawBody,
    headers: {
      "Content-Type": "application/json",
      "X-Curve-Timestamp": timestamp,
      "X-Curve-Signature": `sha256=${signature}`,
    } satisfies HeadersInit,
  };
}

async function runWorkerRouteAiTestCase(input: {
  env: EdgeApiEnv;
  testCase: { target: string; systemPrompt?: string; userPrompt: string; tags: string[] };
  operatorNotes?: string;
}) {
  const fallbackRunner = new MockAiTestRunnerProvider();
  const combinedPrompt = `${input.testCase.systemPrompt ?? ""}\n${input.testCase.userPrompt}\n${input.operatorNotes ?? ""}`;
  const toolCalls = collectToolCalls(combinedPrompt.toLowerCase());
  if (!toolCalls.length) {
    return {
      ...(await fallbackRunner.runCase({
        testCase: input.testCase as Parameters<MockAiTestRunnerProvider["runCase"]>[0]["testCase"],
        operatorNotes: input.operatorNotes,
      })),
      fallbackUsed: true,
      fallbackReason: "No worker-route tool path matched this prompt.",
    };
  }

  const repo = new InMemoryOnboardingRepository();
  const objectStore = new InMemoryObjectStore();
  const startedAt = Date.now();
  const now = new Date().toISOString();
  const staffId = createId("staff");
  const jobId = createId("job");
  const callerPhone = "+61412345678";

  await repo.upsertStaffProfile({
    staffId,
    fullName: "AI Harness Staff",
    email: "harness@curve.test",
    phoneNumber: callerPhone,
    role: "Field tech",
    timezone: "Australia/Sydney",
    companyName: "Curve AI Test",
    calendarProvider: "outlook",
    communication: undefined,
    pricing: undefined,
    business: undefined,
    crm: undefined,
    updatedAt: now,
  });
  await repo.saveStaffCalendarConnection({
    staffId,
    provider: "outlook",
    status: "connected",
    accountEmail: "harness@curve.test",
    calendarId: "primary",
    calendarLabel: "Primary",
    timezone: "Australia/Sydney",
    connectedAt: now,
    updatedAt: now,
  });

  const harnessApp = createApp({
    env: input.env,
    repo,
    objectStore,
    providers: {
      realtimeVoice: new MockRealtimeVoiceProvider(),
      reasoning: new HeuristicReasoningProvider(),
      calendar: new MockMicrosoftCalendarAdapter(),
      voiceClone: new HeuristicVoiceCloneProvider(),
      messaging: new MockMessagingProvider(),
    },
    aiTestProviders: {
      runner: fallbackRunner,
      judge: new MockAiTestJudgeProvider(),
    },
  });

  const observedEffects: string[] = [];
  const outputFragments: string[] = [];
  const issue =
    /photo|image|upload/i.test(combinedPrompt)
      ? "Customer needs to upload job photos."
      : /quote|price|pricing/i.test(combinedPrompt)
        ? "Customer wants a price estimate."
        : /appointment|book|schedule/i.test(combinedPrompt)
          ? "Customer wants a booked visit."
          : "Customer needs a follow-up.";

  const contextBody = {
    jobId,
    staffId,
    callerPhone,
    callerName: "Avery Customer",
    customerName: "Avery Customer",
    address: "12 Test Street, Sydney NSW",
    suburb: "Surry Hills",
    state: "NSW",
    postcode: "2010",
    issue,
    summary: issue,
  };
  const contextRequest = await createAutomationHeaders(input.env.AUTOMATION_SHARED_SECRET ?? "automation-secret", "/voice/context", contextBody);
  const contextResponse = await harnessApp.request("/voice/context", {
    method: "POST",
    headers: contextRequest.headers,
    body: contextRequest.rawBody,
  });
  if (!contextResponse.ok) {
    throw new Error(`Worker-route context bootstrap failed with ${contextResponse.status}`);
  }
  observedEffects.push(`Loaded context for job ${jobId}.`);

  for (const tool of toolCalls) {
    if (tool === "quote") {
      const body = {
        ...contextBody,
        hours: 2,
        materialsEstimate: 120,
        rush: /rush|urgent|emergency/i.test(combinedPrompt),
      };
      const request = await createAutomationHeaders(input.env.AUTOMATION_SHARED_SECRET ?? "automation-secret", "/voice/tools/quote", body);
      const response = await harnessApp.request("/voice/tools/quote", {
        method: "POST",
        headers: request.headers,
        body: request.rawBody,
      });
      if (!response.ok) {
        throw new Error(`Worker-route quote execution failed with ${response.status}`);
      }
      const payload = (await response.json()) as { quote?: { amount?: number; id?: string } };
      observedEffects.push(`Created quote ${payload.quote?.id ?? "unknown"} for job ${jobId}.`);
      outputFragments.push(`Quoted the job at ${payload.quote?.amount ?? "an unknown amount"} AUD.`);
      continue;
    }
    if (tool === "callback") {
      const body = {
        jobId,
        staffId,
        callerPhone,
        reason: "Customer requested a callback after hours.",
        notes: "AI test harness callback",
      };
      const request = await createAutomationHeaders(input.env.AUTOMATION_SHARED_SECRET ?? "automation-secret", "/voice/tools/callback", body);
      const response = await harnessApp.request("/voice/tools/callback", {
        method: "POST",
        headers: request.headers,
        body: request.rawBody,
      });
      if (!response.ok) {
        throw new Error(`Worker-route callback execution failed with ${response.status}`);
      }
      const payload = (await response.json()) as { callback?: { id?: string; dueAt?: string } };
      observedEffects.push(`Queued callback ${payload.callback?.id ?? "unknown"} for job ${jobId}.`);
      outputFragments.push(`Queued a callback for the customer.`);
      continue;
    }
    if (tool === "appointment") {
      const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const endAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const body = {
        jobId,
        staffId,
        callerPhone,
        startAt,
        endAt,
        timezone: "Australia/Sydney",
        location: "12 Test Street, Sydney NSW",
        notes: "AI test harness appointment",
      };
      const request = await createAutomationHeaders(input.env.AUTOMATION_SHARED_SECRET ?? "automation-secret", "/voice/tools/appointment", body);
      const response = await harnessApp.request("/voice/tools/appointment", {
        method: "POST",
        headers: request.headers,
        body: request.rawBody,
      });
      if (!response.ok) {
        throw new Error(`Worker-route appointment execution failed with ${response.status}`);
      }
      const payload = (await response.json()) as { appointment?: { status?: string; id?: string }; calendarSync?: { status?: string } };
      observedEffects.push(`Booked appointment ${payload.appointment?.id ?? "unknown"} with calendar status ${payload.calendarSync?.status ?? "unknown"}.`);
      outputFragments.push(`Booked the visit into the staff calendar.`);
      continue;
    }
    if (tool === "send-photo-link") {
      const body = {
        jobId,
        staffId,
        callerPhone,
        notes: "Please send clear photos of the problem area.",
      };
      const request = await createAutomationHeaders(input.env.AUTOMATION_SHARED_SECRET ?? "automation-secret", "/voice/tools/send-photo-link", body);
      const response = await harnessApp.request("/voice/tools/send-photo-link", {
        method: "POST",
        headers: request.headers,
        body: request.rawBody,
      });
      if (!response.ok) {
        throw new Error(`Worker-route photo-link execution failed with ${response.status}`);
      }
      const payload = (await response.json()) as { upload?: { uploadLink?: string }; delivery?: { status?: string } };
      observedEffects.push(`Issued upload link for job ${jobId} with delivery status ${payload.delivery?.status ?? "queued"}.`);
      outputFragments.push(`Sent the customer a secure photo upload link.`);
      continue;
    }
    if (tool === "end_call") {
      observedEffects.push("Ended the call after confirming the next step.");
      outputFragments.push("I can end the call cleanly once the next step is confirmed.");
    }
  }

  return {
    provider: "worker-route-harness",
    mode: "mock" as const,
    model: "worker-route-v1",
    outputText: outputFragments.join(" "),
    toolCalls,
    executionMode: "worker-route" as const,
    observedEffects,
    latencyMs: Math.max(1, Date.now() - startedAt),
    fallbackUsed: false,
    fallbackReason: undefined,
  };
}

export function createApp(options?: {
  env?: EdgeApiEnv;
  repo?: OnboardingRepository;
  objectStore?: ObjectStore;
  providers?: AppProviders;
  aiTestProviders?: AiTestStudioProviders;
}) {
  const env = options?.env ?? {};
  const config = getConfig(env);
  if (!options?.repo && !env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is required unless a test repository is injected.");
  }
  if (!options?.objectStore && !env.ARTIFACTS_BUCKET) {
    throw new Error("Cloudflare R2 binding `ARTIFACTS_BUCKET` is required unless a test object store is injected.");
  }
  const repo = options?.repo ?? (env.DB ? new D1OnboardingRepository(env.DB) : defaultMemoryRepo);
  const objectStore = options?.objectStore ?? (env.ARTIFACTS_BUCKET ? new R2ObjectStore(env.ARTIFACTS_BUCKET) : defaultMemoryObjectStore);
  const providers = options?.providers ?? buildProviders(env);
  const app = new Hono<AppBindings>();
  const aiTestProviders =
    options?.aiTestProviders ??
    buildAiTestProviders(env, {
      runWorkerRouteCase: (input) =>
        runWorkerRouteAiTestCase({
          env,
          testCase: input.testCase,
          operatorNotes: input.operatorNotes,
        }),
    });
  const onboardingService = new OnboardingService({
    repo,
    config,
    providers: {
      realtimeVoice: providers.realtimeVoice,
      reasoning: providers.reasoning,
      calendar: providers.calendar,
      voiceClone: providers.voiceClone,
    },
    objectStore,
    coordinatorNamespace: env.ONBOARDING_SESSIONS,
  });
  const aiTestStudioService = new AiTestStudioService({
    repo,
    providers: aiTestProviders,
  });

  type StaffSetupSummary = {
    status: "not_started" | "in_progress" | "completed";
    currentStep?: "consent" | "interview" | "review" | "calendar" | "voice_sample" | "finalize" | "complete";
    updatedAt?: string;
  };

  function currentStepFromSessionState(input: {
    status: OnboardingSessionRecord["status"];
    consentAccepted: boolean;
    calendar?: OnboardingSessionRecord["calendar"];
    voiceSample?: OnboardingSessionRecord["voiceSample"];
  }): StaffSetupSummary["currentStep"] {
    switch (input.status) {
      case "completed":
        return "complete";
      case "voice_sample":
        return input.voiceSample ? "finalize" : "voice_sample";
      case "calendar":
        return input.calendar?.status === "connected" ? "voice_sample" : "calendar";
      case "review":
        return "review";
      case "interviewing":
        return "interview";
      default:
        return input.consentAccepted ? "interview" : "consent";
    }
  }

  async function buildStaffSetupSummary(staff: StaffRecord): Promise<StaffSetupSummary> {
    const invite = await repo.getLatestInviteByStaffId(staff.id);
    const session = invite?.sessionId ? await repo.getSessionById(invite.sessionId) : undefined;
    if (session && !isExpired(session.expiresAt) && session.status !== "completed") {
      return {
        status: "in_progress",
        currentStep: currentStepFromSessionState(session),
        updatedAt: session.updatedAt,
      };
    }

    if (session?.status === "completed") {
      return {
        status: "completed",
        currentStep: "complete",
        updatedAt: session.updatedAt,
      };
    }

    const legacyReady =
      staff.voiceConsentStatus === "granted" &&
      staff.calendarConnection?.status === "connected" &&
      Boolean(staff.pricingProfile);
    if (legacyReady) {
      return {
        status: "completed",
        currentStep: "complete",
        updatedAt: staff.updatedAt,
      };
    }

    const hasLegacySetupSignals =
      staff.voiceConsentStatus === "granted" ||
      Boolean(staff.calendarConnection) ||
      Boolean(staff.pricingProfile) ||
      Boolean(invite);

    if (hasLegacySetupSignals) {
      return {
        status: "in_progress",
        currentStep: "review",
        updatedAt: session?.updatedAt ?? staff.updatedAt,
      };
    }

    return {
      status: "not_started",
      currentStep: "consent",
      updatedAt: staff.updatedAt,
    };
  }

  async function sanitizeStaffWithSetup(staff: StaffRecord | undefined) {
    const safeStaff = sanitizeStaff(staff);
    if (!safeStaff || !staff) {
      return undefined;
    }
    return {
      ...safeStaff,
      setup: await buildStaffSetupSummary(staff),
    };
  }

  function hasAdminAccess(request: Request): boolean {
    const token = getAdminAccessToken(request);
    return Boolean(token && config.adminToken && constantTimeEqual(token, config.adminToken));
  }

  function getRequestId(c: any): string | undefined {
    return (c as any).get("requestId") as string | undefined;
  }

  function getRequestStartedAt(c: any): number | undefined {
    return (c as any).get("requestStartedAt") as number | undefined;
  }

  function hasHandledError(c: any): boolean {
    return Boolean((c as any).get("requestHandledError"));
  }

  function attachResponseSafetyHeaders(response: Response, requestId: string | undefined) {
    if (requestId) {
      response.headers.set("x-request-id", requestId);
    }
    response.headers.set("x-content-type-options", "nosniff");
  }

  function jsonError(c: any, status: number, message: string, details?: Record<string, unknown>) {
    const requestId = getRequestId(c);
    const exposeDetails =
      Boolean(details) &&
      ((details && Array.isArray((details as { issues?: unknown[] }).issues)) ||
        isLocalRequest(c.req.url) ||
        hasAdminAccess(c.req.raw));

    const response = c.json(
      {
        ok: false,
        error: {
          message,
          ...(requestId ? { requestId } : {}),
          ...(exposeDetails && details ? { details } : {}),
        },
      },
      { status },
    );
    attachResponseSafetyHeaders(response, requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  const opsOrigins = [config.publicOpsAppUrl].filter(Boolean);
  const staffOrigins = [config.publicStaffAppUrl, config.publicOpsAppUrl].filter(
    (value): value is string => Boolean(value),
  );
  const onboardingOrigins = [config.publicOnboardingAppUrl, config.publicOpsAppUrl].filter(
    (value): value is string => Boolean(value),
  );
  const uploadOrigins = [config.publicUploadAppUrl, config.publicOpsAppUrl].filter(
    (value): value is string => Boolean(value),
  );

  app.use("*", cors({
    origin: (origin, c) => resolveCorsOrigin(origin, c.req.raw.url, config.allowedOrigins) ?? "",
    allowHeaders: ["Content-Type", "Authorization", "X-Curve-Signature", "X-Curve-Timestamp"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  }));

  app.use("*", async (c, next) => {
    const requestId = createId("req");
    const startedAt = Date.now();
    (c as any).set("requestId", requestId);
    (c as any).set("requestStartedAt", startedAt);

    await next();

    if (hasHandledError(c)) {
      return;
    }

    attachResponseSafetyHeaders(c.res, requestId);

    const status = c.res.status || 200;
    if (c.req.method === "OPTIONS" || (c.req.path === "/health" && status < 400)) {
      return;
    }

    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    writeLog(level, "request.completed", {
      requestId,
      method: c.req.method,
      path: summarizeRequestPath(c.req.path),
      routeFamily: classifyRouteFamily(c.req.path),
      status,
      durationMs: Date.now() - startedAt,
      origin: summarizeOrigin(requestOrigin(c.req.raw)),
      authKind: requestAuthKind(c.req.raw),
    });
  });

  const requireBrowserOrigin =
    (allowedOrigins: string[], message = "Request origin is not allowed for this route") =>
    async (c: any, next: () => Promise<void>) => {
      if (!isAllowedBrowserOrigin(c.req.raw, allowedOrigins)) {
        return jsonError(c, 403, message);
      }
      await next();
    };

  const requireMockProviderAccess = async (c: any, next: () => Promise<void>) => {
    if (!isLocalRequest(c.req.url) && !hasAdminAccess(c.req.raw)) {
      return jsonError(c, 404, "Not found");
    }
    await next();
  };

  const liveMicrosoftUnavailableMessage = "Microsoft calendar is not configured for this staging environment yet.";
  function microsoftCalendarRequiresLiveCredentials(requestUrl: string): boolean {
    return config.calendarMode !== "configured" && !isLocalRequest(requestUrl);
  }

  app.use("/dashboard", requireBrowserOrigin(opsOrigins));
  app.use("/ai-test-studio/*", requireBrowserOrigin(opsOrigins));
  app.use("/staff/*", requireBrowserOrigin(staffOrigins));
  app.use("/jobs", requireBrowserOrigin(staffOrigins));
  app.use("/jobs/*", requireBrowserOrigin(staffOrigins));
  app.use("/customers", requireBrowserOrigin(staffOrigins));
  app.use("/customers/*", requireBrowserOrigin(staffOrigins));
  app.use("/assets/*", requireBrowserOrigin(staffOrigins));
  app.use("/onboarding/*", requireBrowserOrigin(onboardingOrigins));
  app.use("/uploads/*", requireBrowserOrigin(uploadOrigins));
  app.use("/mock/providers/*", requireMockProviderAccess);

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }
    if (c.req.path === "/health") {
      await next();
      return;
    }
    if (config.blockingIssues.length > 0 && !isLocalRequest(c.req.url)) {
      return jsonError(
        c,
        503,
        "Worker configuration is incomplete",
        hasAdminAccess(c.req.raw) ? { issues: config.blockingIssues } : undefined,
      );
    }
    await next();
  });

  app.onError((error, c) => {
    (c as any).set("requestHandledError", true);
    const requestId = getRequestId(c);
    const startedAt = getRequestStartedAt(c);
    const status =
      error instanceof OnboardingRuleError || error instanceof AiTestStudioRuleError ? error.statusCode : 500;

    writeLog(status >= 500 ? "error" : "warn", "request.failed", {
      requestId,
      method: c.req.method,
      path: summarizeRequestPath(c.req.path),
      routeFamily: classifyRouteFamily(c.req.path),
      status,
      durationMs: typeof startedAt === "number" ? Date.now() - startedAt : undefined,
      origin: summarizeOrigin(requestOrigin(c.req.raw)),
      authKind: requestAuthKind(c.req.raw),
      error: summarizeError(error),
    });

    if (error instanceof OnboardingRuleError) {
      return jsonError(c, error.statusCode, error.message);
    }
    if (error instanceof AiTestStudioRuleError) {
      return jsonError(c, error.statusCode, error.message);
    }
    return jsonError(
      c,
      500,
      isLocalRequest(c.req.url) || hasAdminAccess(c.req.raw)
        ? error instanceof Error
          ? error.message
          : "Unexpected error"
        : "Unexpected error",
    );
  });

  async function requireAdmin(c: any) {
    const token = getAdminAccessToken(c.req.raw);
    if (!token || !config.adminToken || !constantTimeEqual(token, config.adminToken)) {
      return jsonError(c, 401, "Admin authentication is required");
    }
    return undefined;
  }

  async function authenticateActor(c: any): Promise<AuthActor | undefined> {
    const adminToken = getAdminAccessToken(c.req.raw);
    if (adminToken && config.adminToken && constantTimeEqual(adminToken, config.adminToken)) {
      return { kind: "admin" };
    }
    const token = getStaffAccessToken(c.req.raw);
    if (!token) {
      return undefined;
    }

    const tokenHash = await sha256Hex(token);
    const session = await repo.getStaffSession(tokenHash);
    if (!session || isExpired(session.expiresAt)) {
      return undefined;
    }
    return {
      kind: "staff",
      staffId: session.staffId,
      expiresAt: session.expiresAt,
    };
  }

  async function requireStaffAccess(c: any, staffId: string) {
    const actor = await authenticateActor(c);
    if (!actor) {
      return { actor, error: jsonError(c, 401, "Authentication is required") };
    }
    if (actor.kind === "admin") {
      return { actor };
    }
    if (actor.staffId !== staffId) {
      return { actor, error: jsonError(c, 403, "You do not have access to that staff profile") };
    }
    return { actor };
  }

  async function requireOnboardingSession(c: any): Promise<OnboardingSessionResult> {
    const sessionId = c.req.param("id");
    const token = getOnboardingAccessToken(c.req.raw);
    if (!sessionId) {
      return { error: jsonError(c, 400, "sessionId is required") };
    }
    if (!token) {
      return { error: jsonError(c, 401, "Onboarding session authentication is required") };
    }
    const session = await onboardingService.authenticateSession(sessionId, token);
    if (!session) {
      return { error: jsonError(c, 403, "Onboarding session token is invalid") };
    }
    return { session };
  }

  async function verifyAutomationRequest(c: any): Promise<
    | {
        rawBody: string;
        timestamp: string;
        timestampMs: number;
        signature: string;
        replayFingerprint: string;
      }
    | { error: Response }
  > {
    const secret = config.automationSharedSecret;
    if (!secret) {
      return { error: jsonError(c, 503, "Automation signature secret is not configured") };
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return { error: jsonError(c, 401, "Signed automation headers are required") };
    }
    const timestampMs = Number(timestamp);
    const now = Date.now();
    if (
      !Number.isFinite(timestampMs) ||
      timestampMs > now + 30 * 1000 ||
      now - timestampMs > 5 * 60 * 1000
    ) {
      return { error: jsonError(c, 401, "Automation signature timestamp is invalid or expired") };
    }
    const expected = await signHmacSha256(
      secret,
      `${timestamp}.${c.req.method.toUpperCase()}.${c.req.path}.${rawBody}`,
    );
    if (!constantTimeEqual(expected, signature)) {
      return { error: jsonError(c, 401, "Automation signature did not match") };
    }
    return {
      rawBody,
      timestamp,
      timestampMs,
      signature,
      replayFingerprint: await sha256Hex(`${timestamp}.${signature}`),
    };
  }

  async function enforceVoiceJobScope(c: any, jobId?: string, staffId?: string): Promise<Response | undefined> {
    if (!jobId) {
      return undefined;
    }
    const existing = await repo.getJobCard(jobId);
    if (!existing?.job.staffId) {
      return undefined;
    }
    if (!staffId) {
      return jsonError(c, 400, "staffId is required when updating an existing job");
    }
    if (existing.job.staffId !== staffId) {
      return jsonError(c, 403, "That job belongs to a different staff profile");
    }
    return undefined;
  }

  app.get("/health", (c) =>
    c.json(
      hasAdminAccess(c.req.raw) || isLocalRequest(c.req.url)
        ? {
            ok: config.blockingIssues.length === 0,
            ready: config.blockingIssues.length === 0,
            runtime: "cloudflare-worker",
            realtimeVoice: providers.realtimeVoice.mode,
            reasoning: providers.reasoning.mode,
            calendar: providers.calendar.mode,
            messaging: providers.messaging.mode,
            blockingIssues: config.blockingIssues,
            advisoryIssues: config.advisoryIssues,
          }
        : {
            ok: config.blockingIssues.length === 0,
            ready: config.blockingIssues.length === 0,
            runtime: "cloudflare-worker",
            messaging: providers.messaging.mode,
          },
    ),
  );

  app.get("/mock/providers/elevenlabs/v1/convai/conversation/get-signed-url", (c) => {
    const agentId = c.req.query("agent_id")?.trim() || "mock-agent";
    return c.json({
      signed_url: `wss://mock.elevenlabs.local/convai/${encodeURIComponent(agentId)}?session=${encodeURIComponent(createParticipantToken())}`,
      provider: "elevenlabs",
      mode: "mock",
    });
  });

  app.get("/mock/providers/microsoft/authorize", (c) => {
    const redirectUri = c.req.query("redirect_uri");
    const state = c.req.query("state");
    if (!redirectUri || !state) {
      return jsonError(c, 400, "redirect_uri and state are required");
    }
    let redirectOrigin: string;
    try {
      redirectOrigin = new URL(redirectUri).origin;
    } catch {
      return jsonError(c, 400, "redirect_uri is invalid");
    }
    const allowedRedirectOrigins = [config.publicApiUrl]
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return undefined;
        }
      })
      .filter((value): value is string => Boolean(value));
    if (!(isLocalRequest(c.req.url) && isLocalOrigin(redirectOrigin)) && !allowedRedirectOrigins.includes(redirectOrigin)) {
      return jsonError(c, 400, "redirect_uri is not allowed");
    }

    const identity = {
      ...defaultMockMicrosoftIdentity(c.req.query("staff_name") ?? "Curve AI Staff"),
      accountEmail: c.req.query("email")?.trim() || defaultMockMicrosoftIdentity(c.req.query("staff_name") ?? "Curve AI Staff").accountEmail,
      calendarId: c.req.query("calendar_id")?.trim() || defaultMockMicrosoftIdentity(c.req.query("staff_name") ?? "Curve AI Staff").calendarId,
      calendarLabel: c.req.query("calendar")?.trim() || defaultMockMicrosoftIdentity(c.req.query("staff_name") ?? "Curve AI Staff").calendarLabel,
    };
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("state", state);
    callbackUrl.searchParams.set("code", createMockMicrosoftAuthorizationCode(identity));
    callbackUrl.searchParams.set("email", identity.accountEmail);
    callbackUrl.searchParams.set("calendar", identity.calendarLabel);
    return c.redirect(callbackUrl.toString(), 302);
  });

  app.post("/mock/providers/microsoft/token", async (c) => {
    const form = await c.req.parseBody();
    const grantType = typeof form.grant_type === "string" ? form.grant_type : "authorization_code";
    const identity =
      grantType === "refresh_token"
        ? typeof form.refresh_token === "string"
          ? parseMockMicrosoftAccessToken(form.refresh_token)
          : undefined
        : typeof form.code === "string"
          ? parseMockMicrosoftAuthorizationCode(form.code)
          : undefined;
    if (!identity) {
      return jsonError(c, 400, "Mock Microsoft authorization code is invalid");
    }

    return c.json({
      token_type: "Bearer",
      access_token: createMockMicrosoftAccessToken(identity),
      refresh_token: createMockMicrosoftAccessToken(identity),
      expires_in: 3600,
    });
  });

  app.get("/mock/providers/microsoft/v1.0/me", (c) => {
    const accessToken = getBearerToken(c.req.raw);
    const identity = parseMockMicrosoftAccessToken(accessToken);
    if (!identity) {
      return jsonError(c, 401, "Mock Microsoft bearer token is required");
    }

    return c.json({
      mail: identity.accountEmail,
      userPrincipalName: identity.accountEmail,
      displayName: identity.displayName ?? identity.accountEmail.split("@")[0],
    });
  });

  app.get("/mock/providers/microsoft/v1.0/me/calendar", (c) => {
    const accessToken = getBearerToken(c.req.raw);
    const identity = parseMockMicrosoftAccessToken(accessToken);
    if (!identity) {
      return jsonError(c, 401, "Mock Microsoft bearer token is required");
    }

    return c.json({
      id: identity.calendarId ?? "primary",
      name: identity.calendarLabel,
    });
  });

  app.post("/mock/providers/microsoft/v1.0/me/events", async (c) => {
    return handleMockMicrosoftEventCreate(c);
  });

  app.post("/mock/providers/microsoft/v1.0/me/calendars/:calendarId/events", async (c) => {
    return handleMockMicrosoftEventCreate(c);
  });

  async function handleMockMicrosoftEventCreate(c: any) {
    const accessToken = getBearerToken(c.req.raw);
    const identity = parseMockMicrosoftAccessToken(accessToken);
    if (!identity) {
      return jsonError(c, 401, "Mock Microsoft bearer token is required");
    }

    const body = await c.req.json().catch(() => ({})) as {
      subject?: string;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
      location?: { displayName?: string };
      body?: { content?: string };
    };

    return c.json({
      id: `event_${createParticipantToken().slice(0, 12)}`,
      webLink: `https://mock.microsoft.local/calendar/${encodeURIComponent(identity.accountEmail)}`,
      subject: body.subject ?? "Curve AI appointment",
      start: body.start,
      end: body.end,
      location: body.location,
      body: body.body,
    });
  }

  app.post("/mock/providers/twilio/2010-04-01/Accounts/:accountSid/Messages.json", async (c) => {
    const auth = getBasicAuth(c.req.raw);
    const accountSid = c.req.param("accountSid");
    if (!auth || auth.username !== accountSid) {
      return jsonError(c, 401, "Mock Twilio basic auth is required");
    }

    const form = await c.req.parseBody();
    const to = typeof form.To === "string" ? form.To : undefined;
    const from = typeof form.From === "string" ? form.From : undefined;
    const body = typeof form.Body === "string" ? form.Body : undefined;
    if (!to || !from || !body) {
      return jsonError(c, 400, "Mock Twilio message requires To, From, and Body");
    }

    return c.json({
      sid: `SM${createParticipantToken().slice(0, 16)}`,
      status: "queued",
      to,
      from,
      body,
    });
  });

  app.get("/dashboard", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const [jobs, callbacks, experiments] = await Promise.all([
      repo.listJobs(),
      repo.listCallbacks(),
      repo.listExperiments(),
    ]);
    return c.json(await mapDashboardPayload(jobs, callbacks, experiments));
  });

  app.get("/ai-test-studio/cases", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    return c.json({
      ok: true,
      cases: await aiTestStudioService.listCases(),
    });
  });

  app.post("/ai-test-studio/cases", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(aiTestCaseCreateInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const testCase = await aiTestStudioService.createCase(parsed.data);
    return c.json(
      {
        ok: true,
        case: testCase,
      },
      { status: 201 },
    );
  });

  app.get("/ai-test-studio/cases/:caseId", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const caseId = c.req.param("caseId");
    if (!caseId) {
      return jsonError(c, 400, "caseId is required");
    }
    const testCase = await aiTestStudioService.getCase(caseId);
    if (!testCase) {
      return jsonError(c, 404, "AI test case not found", { caseId });
    }
    return c.json({
      ok: true,
      case: testCase,
    });
  });

  app.get("/ai-test-studio/runs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const caseId = c.req.query("caseId") ?? undefined;
    return c.json({
      ok: true,
      runs: await aiTestStudioService.listRuns(caseId),
    });
  });

  app.get("/ai-test-studio/runs/:runId", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const runId = c.req.param("runId");
    if (!runId) {
      return jsonError(c, 400, "runId is required");
    }
    const run = await aiTestStudioService.getRun(runId);
    if (!run) {
      return jsonError(c, 404, "AI test run not found", { runId });
    }
    return c.json({
      ok: true,
      run,
    });
  });

  app.post("/ai-test-studio/cases/:caseId/runs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const caseId = c.req.param("caseId");
    if (!caseId) {
      return jsonError(c, 400, "caseId is required");
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(aiTestRunInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const run = await aiTestStudioService.runCase(caseId, parsed.data);
    if (!run) {
      return jsonError(c, 404, "AI test case not found", { caseId });
    }
    return c.json(
      {
        ok: true,
        run,
      },
      { status: 201 },
    );
  });

  app.get("/jobs", async (c) => {
    const actor = await authenticateActor(c);
    if (!actor) {
      return jsonError(c, 401, "Authentication is required");
    }
    const staffId = c.req.query("staffId") ?? undefined;
    if (actor.kind !== "admin" && staffId && staffId !== actor.staffId) {
      return jsonError(c, 403, "You do not have access to that staff queue");
    }
    const effectiveStaffId = actor.kind === "admin" ? staffId : actor.staffId;
    const jobs = await repo.listJobs(effectiveStaffId);
    const dashboard = await mapDashboardPayload(jobs, [], []);
    return c.json({
      ok: true,
      jobs: dashboard.jobs,
    });
  });

  app.get("/jobs/:jobId/card", async (c) => {
    const actor = await authenticateActor(c);
    if (!actor) {
      return jsonError(c, 401, "Authentication is required");
    }
    const jobId = c.req.param("jobId");
    if (!jobId) {
      return jsonError(c, 400, "jobId is required");
    }
    const card = await repo.getJobCard(jobId);
    if (!card) {
      return jsonError(c, 404, "Job not found", { jobId });
    }
    if (actor.kind !== "admin" && card.job.staffId && card.job.staffId !== actor.staffId) {
      return jsonError(c, 403, "You do not have access to that job");
    }
    const signedCard = await signJobCardEnvelope(card);
    return c.json({
      ok: true,
      card: signedCard,
    });
  });

  app.get("/customers/:customerId", async (c) => {
    const actor = await authenticateActor(c);
    if (!actor) {
      return jsonError(c, 401, "Authentication is required");
    }
    const customerId = c.req.param("customerId");
    if (!customerId) {
      return jsonError(c, 400, "customerId is required");
    }
    const customer = await repo.getCustomerProfile(customerId);
    if (!customer) {
      return jsonError(c, 404, "Customer not found", { customerId });
    }
    if (actor.kind !== "admin" && !customer.knownStaffIds.includes(actor.staffId)) {
      return jsonError(c, 403, "You do not have access to that customer");
    }
    return c.json({
      ok: true,
      customer,
    });
  });

  app.post("/staff/invite", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(staffInviteInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }

    const now = new Date();
    const inviteToken = createParticipantToken();
    const otpCode = createOtpCode();
    const staff = await repo.saveStaffInvite({
      staffId: createId("staff"),
      fullName: parsed.data.fullName,
      phoneNumber: parsed.data.phoneNumber,
      email: parsed.data.email,
      role: parsed.data.role,
      timezone: parsed.data.timezone,
      inviteTokenHash: await sha256Hex(inviteToken),
      otpCodeHash: await sha256Hex(otpCode),
      otpIssuedAt: now.toISOString(),
      otpFailedAttempts: 0,
      authExpiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    return c.json(
      {
        ok: true,
        staff: sanitizeStaff(staff),
        inviteCode: inviteToken,
        ...(config.allowInsecureTestOtp
          ? {
              otpCode,
              note: "OTP is returned only when ALLOW_INSECURE_TEST_OTP is enabled for local/staging workflows.",
            }
          : {}),
      },
      { status: 201 },
    );
  });

  app.post("/staff/verify-otp", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(staffOtpVerificationInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }

    const inviteTokenHash = await sha256Hex(parsed.data.inviteToken);
    const staff = await repo.findStaffByInviteTokenHash(inviteTokenHash);
    if (!staff || (parsed.data.staffId && parsed.data.staffId !== staff.id) || !staff.otpCodeHash || !staff.otpIssuedAt) {
      return jsonError(c, 404, "Staff not found or OTP did not match");
    }

    if (staff.authExpiresAt && isExpired(staff.authExpiresAt)) {
      await repo.saveStaffAuthState({
        staffId: staff.id,
        inviteTokenHash: undefined,
        otpCodeHash: undefined,
        otpIssuedAt: undefined,
        otpFailedAttempts: 0,
        otpVerifiedAt: undefined,
        authExpiresAt: undefined,
        createdAt: staff.createdAt,
        updatedAt: new Date().toISOString(),
      });
      return jsonError(c, 404, "Staff not found or OTP did not match");
    }

    const failedAttempts = staff.otpFailedAttempts ?? 0;
    if (failedAttempts >= 5) {
      return jsonError(c, 404, "Staff not found or OTP did not match");
    }

    const otpHash = await sha256Hex(parsed.data.otpCode);
    if (!constantTimeEqual(otpHash, staff.otpCodeHash)) {
      const nextAttempts = failedAttempts + 1;
      await repo.saveStaffAuthState({
        staffId: staff.id,
        inviteTokenHash: nextAttempts >= 5 ? undefined : staff.inviteTokenHash,
        otpCodeHash: nextAttempts >= 5 ? undefined : staff.otpCodeHash,
        otpIssuedAt: nextAttempts >= 5 ? undefined : staff.otpIssuedAt,
        otpFailedAttempts: nextAttempts,
        otpVerifiedAt: undefined,
        authExpiresAt: nextAttempts >= 5 ? undefined : staff.authExpiresAt,
        createdAt: staff.createdAt,
        updatedAt: new Date().toISOString(),
      });
      return jsonError(c, 404, "Staff not found or OTP did not match");
    }

    const now = new Date();
    const sessionToken = createParticipantToken();
    await repo.saveStaffAuthState({
      staffId: staff.id,
      inviteTokenHash: undefined,
      otpCodeHash: undefined,
      otpIssuedAt: undefined,
      otpFailedAttempts: 0,
      otpVerifiedAt: now.toISOString(),
      authExpiresAt: undefined,
      createdAt: staff.createdAt,
      updatedAt: now.toISOString(),
    });
    await repo.createStaffSession({
      tokenHash: await sha256Hex(sessionToken),
      staffId: staff.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    });
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
    const verifiedStaff = await repo.getStaff(staff.id);
    const response = c.json({
      ok: true,
      staff: await sanitizeStaffWithSetup(verifiedStaff ?? staff),
      session: {
        expiresAt,
      },
    });
    response.headers.append(
      "set-cookie",
      buildSessionCookie(STAFF_SESSION_COOKIE, sessionToken, 72 * 60 * 60, c.req.url),
    );
    return response;
  });

  app.get("/staff/me", async (c) => {
    const actor = await authenticateActor(c);
    if (!actor) {
      return jsonError(c, 401, "Authentication is required");
    }
    if (actor.kind === "admin") {
      return jsonError(c, 400, "Admin tokens do not map to a single staff profile");
    }
    const staff = await repo.getStaff(actor.staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    return c.json({
      ok: true,
      staff: await sanitizeStaffWithSetup(staff),
    });
  });

  app.post("/staff/setup/launch", async (c) => {
    const actor = await authenticateActor(c);
    if (!actor) {
      return jsonError(c, 401, "Authentication is required");
    }
    if (actor.kind === "admin") {
      return jsonError(c, 400, "Admin tokens do not map to a single staff setup flow");
    }
    const staff = await repo.getStaff(actor.staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }

    const launched = await onboardingService.launchForStaff(staff);
    const maxAgeSeconds = Math.max(
      60,
      Math.floor((new Date(launched.summary.expiresAt).getTime() - Date.now()) / 1000),
    );
    const response = c.json({
      ok: true,
      launchUrl: launched.url,
      setup: {
        status: launched.summary.status === "completed" ? "completed" : "in_progress",
        currentStep: currentStepFromSessionState({
          status: launched.summary.status,
          consentAccepted: launched.summary.consentAccepted,
          calendar: launched.summary.calendar,
          voiceSample: launched.summary.voiceSample,
        }),
        updatedAt: launched.summary.updatedAt,
      },
    });
    response.headers.append(
      "set-cookie",
      buildSessionCookie(ONBOARDING_SESSION_COOKIE, launched.participantToken, maxAgeSeconds, c.req.url),
    );
    return response;
  });

  app.post("/staff/sign-out", async (c) => {
    const token = getStaffAccessToken(c.req.raw);
    if (token) {
      await repo.deleteStaffSession(await sha256Hex(token));
    }
    const response = c.json({
      ok: true,
      signedOut: true,
    });
    for (const cookie of buildExpiredCookies(STAFF_SESSION_COOKIE, c.req.url)) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  });

  app.post("/staff/voice-consent", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(staffVoiceConsentInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const access = await requireStaffAccess(c, parsed.data.staffId);
    if (access.error) {
      return access.error;
    }
    await repo.recordVoiceConsent(parsed.data);
    const staff = await repo.getStaff(parsed.data.staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    return c.json({
      ok: true,
      staff: sanitizeStaff(staff),
      signedBy: parsed.data.signedBy,
    });
  });

  app.post("/staff/pricing-interview", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(staffPricingInterviewInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const access = await requireStaffAccess(c, parsed.data.staffId);
    if (access.error) {
      return access.error;
    }
    const capturedAt = new Date().toISOString();
    await repo.savePricingInterview({
      staffId: parsed.data.staffId,
      responses: parsed.data.responses,
      capturedAt,
    });
    const staff = await repo.getStaff(parsed.data.staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    return c.json({
      ok: true,
      staff: sanitizeStaff(staff),
      pricingProfile: staff.pricingProfile ?? derivePricingProfile(parsed.data.responses),
    });
  });

  app.get("/staff/calendar/microsoft/start", async (c) => {
    const staffId = c.req.query("staffId");
    if (!staffId) {
      return jsonError(c, 400, "staffId is required");
    }
    const access = await requireStaffAccess(c, staffId);
    if (access.error) {
      return access.error;
    }
    const staff = await repo.getStaff(staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    if (microsoftCalendarRequiresLiveCredentials(c.req.url)) {
      const now = new Date().toISOString();
      await repo.saveStaffCalendarConnection({
        staffId,
        provider: "outlook",
        status: "error",
        accountEmail: staff.calendarConnection?.accountEmail,
        calendarId: staff.calendarConnection?.calendarId,
        calendarLabel: staff.calendarConnection?.calendarLabel,
        timezone: staff.calendarConnection?.timezone ?? staff.timezone,
        authState: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        tokenExpiresAt: undefined,
        lastError: liveMicrosoftUnavailableMessage,
        connectedAt: staff.calendarConnection?.connectedAt,
        updatedAt: now,
      });
      return jsonError(c, 503, liveMicrosoftUnavailableMessage);
    }
    const started = await providers.calendar.startAuth({
      staffName: staff.fullName,
      publicApiUrl: config.publicApiUrl,
      redirectUri: `${config.publicApiUrl.replace(/\/$/, "")}/staff/calendar/microsoft/callback`,
    });
    const now = new Date().toISOString();
    await repo.saveStaffCalendarConnection({
      staffId,
      provider: "outlook",
      status: started.status,
      accountEmail: staff.calendarConnection?.accountEmail,
      calendarId: staff.calendarConnection?.calendarId,
      calendarLabel: staff.calendarConnection?.calendarLabel,
      timezone: staff.calendarConnection?.timezone ?? staff.timezone,
      authState: started.authState,
      accessToken: undefined,
      refreshToken: undefined,
      tokenExpiresAt: undefined,
      lastError: undefined,
      connectedAt: staff.calendarConnection?.connectedAt,
      updatedAt: now,
    });
    if (!started.authUrl) {
      return jsonError(c, 500, "Microsoft calendar authorization is unavailable");
    }
    return c.redirect(started.authUrl, 302);
  });

  app.get("/staff/calendar/microsoft/callback", async (c) => {
    const state = c.req.query("state");
    if (!state) {
      return jsonError(c, 400, "state is required");
    }
    const staff = await repo.getStaffByCalendarAuthState(state);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    try {
      const completed = await providers.calendar.completeAuth({
        state,
        code: c.req.query("code"),
        accountEmail: c.req.query("email"),
        calendarLabel: c.req.query("calendar"),
        redirectUri: `${config.publicApiUrl.replace(/\/$/, "")}/staff/calendar/microsoft/callback`,
      });
      const now = new Date().toISOString();
      await repo.saveStaffCalendarConnection({
        staffId: staff.id,
        provider: "outlook",
        status: completed.summary.status,
        accountEmail: completed.summary.accountEmail,
        calendarId: completed.summary.calendarId,
        calendarLabel: completed.summary.calendarLabel,
        timezone: staff.calendarConnection?.timezone ?? staff.timezone,
        authState: undefined,
        accessToken: completed.credential?.accessToken,
        refreshToken: completed.credential?.refreshToken,
        tokenExpiresAt: completed.credential?.tokenExpiresAt,
        lastError: undefined,
        connectedAt: completed.summary.connectedAt ?? now,
        updatedAt: now,
      });
      const redirectUrl = new URL("/", config.publicStaffAppUrl);
      redirectUrl.searchParams.set("calendar", completed.summary.status);
      return c.redirect(redirectUrl.toString(), 302);
    } catch (error) {
      const now = new Date().toISOString();
      await repo.saveStaffCalendarConnection({
        staffId: staff.id,
        provider: "outlook",
        status: "error",
        accountEmail: staff.calendarConnection?.accountEmail,
        calendarId: staff.calendarConnection?.calendarId,
        calendarLabel: staff.calendarConnection?.calendarLabel,
        timezone: staff.calendarConnection?.timezone ?? staff.timezone,
        authState: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        tokenExpiresAt: undefined,
        lastError: error instanceof Error ? error.message : "Microsoft calendar connection failed",
        connectedAt: staff.calendarConnection?.connectedAt,
        updatedAt: now,
      });
      const redirectUrl = new URL("/", config.publicStaffAppUrl);
      redirectUrl.searchParams.set("calendar", "error");
      return c.redirect(redirectUrl.toString(), 302);
    }
  });

  app.get("/staff/calendar/status", async (c) => {
    const staffId = c.req.query("staffId");
    if (!staffId) {
      return jsonError(c, 400, "staffId is required");
    }
    const access = await requireStaffAccess(c, staffId);
    if (access.error) {
      return access.error;
    }
    const staff = await repo.getStaff(staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    return c.json({
      ok: true,
      calendarConnection: sanitizeStaff(staff)?.calendarConnection,
    });
  });

  app.post("/staff/calendar/disconnect", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(staffCalendarDisconnectInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const access = await requireStaffAccess(c, parsed.data.staffId);
    if (access.error) {
      return access.error;
    }
    await repo.deleteStaffCalendarConnection(parsed.data.staffId);
    const staff = await repo.getStaff(parsed.data.staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    return c.json({
      ok: true,
      staff: sanitizeStaff(staff),
      disconnected: true,
    });
  });

  app.post("/staff/calendar/connect", async (c) => {
    if (!isLocalRequest(c.req.url)) {
      return jsonError(c, 400, "Manual calendar connection is only available in local development");
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(staffCalendarConnectInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const access = await requireStaffAccess(c, parsed.data.staffId);
    if (access.error) {
      return access.error;
    }
    const now = new Date().toISOString();
    const calendarConnection = await repo.saveStaffCalendarConnection({
      staffId: parsed.data.staffId,
      provider: parsed.data.provider,
      status: "connected",
      accountEmail: parsed.data.accountEmail,
      calendarId: parsed.data.calendarId,
      calendarLabel: parsed.data.calendarLabel,
      timezone: parsed.data.timezone,
      authState: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      tokenExpiresAt: undefined,
      lastError: undefined,
      connectedAt: now,
      updatedAt: now,
    });
    const staff = await repo.getStaff(parsed.data.staffId);
    if (!staff) {
      return jsonError(c, 404, "Staff not found");
    }
    return c.json({
      ok: true,
      staff: sanitizeStaff(staff),
      calendarConnection: sanitizeStaff({ ...staff, calendarConnection })?.calendarConnection,
    });
  });

  app.post("/onboarding/invites", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(onboardingInviteInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const created = await onboardingService.createInvite(parsed.data);
    return c.json(
      {
        ok: true,
        invite: {
          id: created.invite.id,
          code: created.invite.code,
          fullName: created.invite.fullName,
          expiresAt: created.invite.expiresAt,
          url: created.url,
        },
        staff: created.staff,
      },
      { status: 201 },
    );
  });

  app.post("/onboarding/sessions/start", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(onboardingStartInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const started = await onboardingService.startSession(parsed.data.inviteCode);
    if (!started) {
      return jsonError(c, 404, "Onboarding invite not found or expired");
    }
    try {
      const authenticatedSession = await onboardingService.authenticateSession(started.summary.id, started.participantToken);
      if (!authenticatedSession) {
        throw new Error("Onboarding session could not be initialized");
      }
      const response = c.json(
        {
          ok: true,
          session: await onboardingService.provisionRealtimeVoice(authenticatedSession, {
            consentAccepted: parsed.data.consentAccepted,
            cloneConsentAccepted: parsed.data.cloneConsentAccepted,
          }),
        },
        { status: 201 },
      );
      const maxAgeSeconds = Math.max(
        0,
        Math.floor((new Date(authenticatedSession.expiresAt).getTime() - Date.now()) / 1000),
      );
      response.headers.append(
        "set-cookie",
        buildSessionCookie(ONBOARDING_SESSION_COOKIE, started.participantToken, maxAgeSeconds, c.req.url),
      );
      return response;
    } catch (error) {
      await onboardingService.rollbackSessionStart(parsed.data.inviteCode, started.summary.id);
      throw error;
    }
  });

  app.get("/onboarding/invites/:inviteCode/session", async (c) => {
    const inviteCode = c.req.param("inviteCode");
    if (!inviteCode) {
      return jsonError(c, 400, "inviteCode is required");
    }
    const token = getOnboardingAccessToken(c.req.raw);
    if (!token) {
      return jsonError(c, 401, "Onboarding session authentication is required");
    }
    const invite = await repo.getInviteByCode(inviteCode);
    if (!invite?.sessionId) {
      return jsonError(c, 404, "Onboarding session not found");
    }
    const session = await onboardingService.authenticateSession(invite.sessionId, token);
    if (!session) {
      return jsonError(c, 403, "Onboarding session token is invalid");
    }
    return c.json({
      ok: true,
      session: await onboardingService.getSessionSummary(session),
      checklist: onboardingService.getChecklist(),
    });
  });

  app.get("/onboarding/sessions/:id", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const session = result.session;
    return c.json({
      ok: true,
      session: await onboardingService.getSessionSummary(session),
      checklist: onboardingService.getChecklist(),
    });
  });

  app.post("/onboarding/sessions/:id/token", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const session = result.session;
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(onboardingVoiceTokenInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const token = getOnboardingAccessToken(c.req.raw);
    if (!token) {
      return jsonError(c, 401, "Onboarding session authentication is required");
    }
    const response = c.json({
      ok: true,
      session: await onboardingService.provisionRealtimeVoice(session, parsed.data),
    });
    const maxAgeSeconds = Math.max(
      0,
      Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    );
    response.headers.append(
      "set-cookie",
      buildSessionCookie(ONBOARDING_SESSION_COOKIE, token, maxAgeSeconds, c.req.url),
    );
    return response;
  });

  app.post("/onboarding/sessions/:id/turns", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const sessionRecord = result.session;
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(onboardingTurnInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const session = await onboardingService.appendTurn(sessionRecord, parsed.data);
    return c.json(
      {
        ok: true,
        session,
        nextQuestion: session.nextQuestion,
        interviewerBrief: session.analysis.interviewerBrief,
      },
      { status: 201 },
    );
  });

  app.post("/onboarding/sessions/:id/next-question", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const summary = await onboardingService.getSessionSummary(result.session);
    return c.json({
      ok: true,
      nextQuestion: summary.nextQuestion,
      interviewerBrief: summary.analysis.interviewerBrief,
      coverageScore: summary.coverageScore,
    });
  });

  app.get("/onboarding/sessions/:id/review", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const session = result.session;
    return c.json({
      ok: true,
      review: session.review,
      analysis: session.analysis,
      status: session.status,
    });
  });

  app.post("/onboarding/sessions/:id/review", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const session = result.session;
    const body = await c.req.json().catch(() => ({}));
    const parsed = parseValidation(onboardingReviewPatchSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    return c.json({
      ok: true,
      session: await onboardingService.updateReview(session, parsed.data),
    });
  });

  app.get("/onboarding/sessions/:id/calendar/microsoft/start", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    if (microsoftCalendarRequiresLiveCredentials(c.req.url)) {
      const session = await onboardingService.markCalendarUnavailable(result.session, liveMicrosoftUnavailableMessage);
      return c.json({
        ok: true,
        calendar: session.calendar,
        session,
      });
    }
    const session = await onboardingService.startCalendar(result.session);
    return c.json({
      ok: true,
      calendar: session.calendar,
      session,
    });
  });

  app.get("/onboarding/calendar/microsoft/callback", async (c) => {
    const state = c.req.query("state");
    if (!state) {
      return jsonError(c, 400, "state is required");
    }
    const summary = await onboardingService.completeCalendar(state, {
      code: c.req.query("code"),
      accountEmail: c.req.query("email"),
      calendarLabel: c.req.query("calendar"),
      redirectUri: `${config.publicApiUrl.replace(/\/$/, "")}/onboarding/calendar/microsoft/callback`,
    });
    if (!summary) {
      return jsonError(c, 404, "Onboarding session not found");
    }
    const redirectUrl = new URL(`/onboard/${summary.inviteCode}`, config.publicOnboardingAppUrl);
    redirectUrl.searchParams.set("session", summary.id);
    redirectUrl.searchParams.set("calendar", summary.calendar?.status ?? "connected");
    return c.redirect(redirectUrl.toString(), 302);
  });

  app.post("/onboarding/sessions/:id/voice-sample", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const session = result.session;
    const formData = await c.req.formData();
    const sample = formData.get("sample");
    if (!(sample instanceof File)) {
      return jsonError(c, 400, "An audio sample file is required");
    }
    const parsed = parseValidation(onboardingVoiceSampleInputSchema, {
      sampleLabel: String(formData.get("sampleLabel") ?? sample.name ?? "Voice sample"),
      durationSeconds: Number(formData.get("durationSeconds") ?? 0),
      transcript: formData.get("transcript") ? String(formData.get("transcript")) : undefined,
      noiseLevel: formData.get("noiseLevel") ? String(formData.get("noiseLevel")) : undefined,
    });
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    return c.json({
      ok: true,
      session: await onboardingService.assessVoiceSample(session, {
        ...parsed.data,
        file: {
          blob: sample,
          originalName: sample.name,
          mimeType: sample.type || undefined,
        },
      }),
    });
  });

  app.post("/onboarding/sessions/:id/finalize", async (c) => {
    const result = await requireOnboardingSession(c);
    if ("error" in result) {
      return result.error;
    }
    const finalized = await onboardingService.finalize(result.session);
    const response = c.json({
      ok: true,
      session: finalized.session,
      staff: finalized.staff,
    });
    for (const cookie of buildExpiredCookies(ONBOARDING_SESSION_COOKIE, c.req.url)) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  });

  const handleUploadPhotos = async (c: any) => {
    const token = c.req.param("token");
    const upload = await repo.getUploadRequest(token);
    if (!upload) {
      return jsonError(c, 404, "Upload request not found", { token });
    }
    if (isExpiredUploadRequest(upload)) {
      return jsonError(c, 410, "Upload request has expired", { token });
    }
    if (upload.status !== "pending") {
      return jsonError(c, 409, "This upload request has already been completed", { token });
    }

    const formData = await c.req.formData();
    const entries = [...formData.getAll("photos"), ...formData.getAll("files")];
    const files = entries.filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return jsonError(c, 400, "At least one image file is required");
    }
    if (files.length > 10) {
      return jsonError(c, 400, "No more than 10 photos can be uploaded at once");
    }

    const storedPhotos: JobPhoto[] = [];
    for (const file of files) {
      const trustedMimeType = await getTrustedPhotoMimeType(file);
      if (!trustedMimeType) {
        return jsonError(c, 400, "Only image uploads are allowed");
      }
      if (file.size > 15 * 1024 * 1024) {
        return jsonError(c, 400, "Each photo must be 15 MB or smaller");
      }
      const photoId = createId("photo");
      const objectKey = `uploads/photos/${upload.jobId}/${photoId}-${sanitizeFilename(file.name)}`;
      await objectStore.put(objectKey, file, {
        contentType: trustedMimeType,
      });
      const photo: JobPhoto = {
        id: photoId,
        jobId: upload.jobId,
        filename: file.name,
        objectKey,
        mimeType: trustedMimeType,
        caption: toPhotoCaption(file.name),
        uploadedAt: new Date().toISOString(),
      };
      storedPhotos.push(photo);
    }

    const completed = await repo.completeUploadRequest(token, storedPhotos);
    if (!completed) {
      await Promise.all(
        storedPhotos
          .map((photo) => photo.objectKey)
          .filter((objectKey): objectKey is string => Boolean(objectKey))
          .map((objectKey) => objectStore.delete(objectKey)),
      );
      const latest = await repo.getUploadRequest(token);
      if (!latest) {
        return jsonError(c, 404, "Upload request not found", { token });
      }
      if (isExpiredUploadRequest(latest) || latest.status === "expired") {
        return jsonError(c, 410, "Upload request has expired", { token });
      }
      return jsonError(c, 409, "This upload request has already been completed", { token });
    }

    return c.json({
      ok: true,
      uploaded: storedPhotos.length,
      upload: await toPublicUploadSummary(repo, completed),
    });
  };

  app.get("/uploads/:token", async (c) => {
    const token = c.req.param("token");
    const upload = await repo.getUploadRequest(token);
    if (!upload) {
      return jsonError(c, 404, "Upload request not found", { token });
    }
    if (isExpiredUploadRequest(upload) || upload.status === "expired") {
      return jsonError(c, 410, "Upload request has expired", { token });
    }
    return c.json({
      ok: true,
      upload: await toPublicUploadSummary(repo, upload),
    });
  });

  app.post("/uploads/:token", handleUploadPhotos);
  app.post("/uploads/:token/photos", handleUploadPhotos);

  app.post("/voice/context", async (c) => {
    const verified = await verifyAutomationRequest(c);
    if ("error" in verified) {
      return verified.error;
    }
    const body = parseJsonBody(verified.rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceContextInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const scopeError = await enforceVoiceJobScope(c, parsed.data.jobId, parsed.data.staffId);
    if (scopeError) {
      return scopeError;
    }
    const replayClaimed = await repo.claimAutomationReplay(
      verified.replayFingerprint,
      new Date(verified.timestampMs + 5 * 60 * 1000).toISOString(),
    );
    if (!replayClaimed) {
      return jsonError(c, 409, "Automation request was already processed");
    }

    const hasContext =
      Boolean(parsed.data.jobId) ||
      Boolean(parsed.data.staffId) ||
      Boolean(parsed.data.callerPhone) ||
      Boolean(parsed.data.callerName) ||
      Boolean(parsed.data.customerName) ||
      Boolean(parsed.data.address) ||
      Boolean(parsed.data.issue) ||
      Boolean(parsed.data.summary);

    let job: JobRecord | undefined;
    if (hasContext) {
      job = await repo.ensureJob({
        id: parsed.data.jobId ?? createId("job"),
        staffId: parsed.data.staffId,
        callerName: parsed.data.callerName ?? parsed.data.customerName,
        callerPhone: parsed.data.callerPhone,
        address: parsed.data.address,
        location: parsed.data.suburb
          ? {
              label: parsed.data.suburb,
              suburb: parsed.data.suburb,
              state: parsed.data.state,
              postcode: parsed.data.postcode,
            }
          : undefined,
        issue: parsed.data.issue,
        summary: parsed.data.summary ?? parsed.data.issue,
        status: "new",
      });
    }

    const tools = ["quote", "appointment", "callback", "send-photo-link", "end_call"];
    const response: Record<string, unknown> = {
      ok: true,
      tools,
    };
    if (job) {
      response.job = job;
      const card = await repo.getJobCard(job.id);
      if (card) {
        response.card = await signJobCardEnvelope(card);
      }
      if (job.callerId) {
        response.customer = await repo.getCustomerProfile(job.callerId);
      }
    }
    return c.json(response);
  });

  app.post("/voice/tools/quote", async (c) => {
    const verified = await verifyAutomationRequest(c);
    if ("error" in verified) {
      return verified.error;
    }
    const body = parseJsonBody(verified.rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceQuoteInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const scopeError = await enforceVoiceJobScope(c, parsed.data.jobId, parsed.data.staffId);
    if (scopeError) {
      return scopeError;
    }
    const replayClaimed = await repo.claimAutomationReplay(
      verified.replayFingerprint,
      new Date(verified.timestampMs + 5 * 60 * 1000).toISOString(),
    );
    if (!replayClaimed) {
      return jsonError(c, 409, "Automation request was already processed");
    }

    const job = await repo.ensureJob({
      id: parsed.data.jobId ?? createId("job"),
      staffId: parsed.data.staffId,
      callerName: parsed.data.callerName ?? parsed.data.customerName,
      callerPhone: parsed.data.callerPhone,
      address: parsed.data.address,
      location: parsed.data.suburb
        ? {
            label: parsed.data.suburb,
            suburb: parsed.data.suburb,
            state: parsed.data.state,
            postcode: parsed.data.postcode,
          }
        : undefined,
      issue: parsed.data.issue,
      summary: parsed.data.summary ?? parsed.data.issue,
      status: "new",
    });

    const basePrice = Math.round(180 + (parsed.data.hours ?? 1.5) * 120 + (parsed.data.materialsEstimate ?? 40));
    const strategyAdjustment = parsed.data.rush ? 45 : Math.round((parsed.data.complexity ?? 0) * 8);
    const experimentAdjustment = parsed.data.rush ? 35 : 0;
    const amount = basePrice + strategyAdjustment + experimentAdjustment;
    const quote = await repo.upsertQuote({
      id: createId("quote"),
      jobId: job.id,
      staffId: parsed.data.staffId,
      variant: parsed.data.rush ? "dynamic-high" : "control",
      amount,
      currency: "AUD",
      basePrice,
      strategyAdjustment,
      experimentAdjustment,
      floorPrice: Math.max(120, amount - 60),
      ceilingPrice: amount + 120,
      confidence: parsed.data.rush ? 0.76 : 0.86,
      status: "presented",
      rationale: [
        parsed.data.issue ? `Scoped around ${parsed.data.issue}.` : "Scoped around the current job request.",
        parsed.data.rush ? "Rush pricing applied." : "Standard pricing applied.",
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      job,
      quote,
    });
  });

  app.post("/voice/tools/callback", async (c) => {
    const verified = await verifyAutomationRequest(c);
    if ("error" in verified) {
      return verified.error;
    }
    const body = parseJsonBody(verified.rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceCallbackInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const scopeError = await enforceVoiceJobScope(c, parsed.data.jobId, parsed.data.staffId);
    if (scopeError) {
      return scopeError;
    }
    const replayClaimed = await repo.claimAutomationReplay(
      verified.replayFingerprint,
      new Date(verified.timestampMs + 5 * 60 * 1000).toISOString(),
    );
    if (!replayClaimed) {
      return jsonError(c, 409, "Automation request was already processed");
    }

    const job = await repo.ensureJob({
      id: parsed.data.jobId ?? createId("job"),
      staffId: parsed.data.staffId,
      callerPhone: parsed.data.callerPhone,
      summary: parsed.data.reason,
      status: "callback",
    });

    const callback = await repo.upsertCallback({
      id: createId("callback"),
      jobId: job.id,
      staffId: parsed.data.staffId,
      status: "queued",
      reason: parsed.data.reason,
      dueAt: parsed.data.dueAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      phoneNumber: parsed.data.callerPhone,
      notes: parsed.data.notes,
      createdAt: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      job,
      callback,
    });
  });

  app.post("/voice/tools/appointment", async (c) => {
    const verified = await verifyAutomationRequest(c);
    if ("error" in verified) {
      return verified.error;
    }
    const body = parseJsonBody(verified.rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceAppointmentInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const scopeError = await enforceVoiceJobScope(c, parsed.data.jobId, parsed.data.staffId);
    if (scopeError) {
      return scopeError;
    }
    const replayClaimed = await repo.claimAutomationReplay(
      verified.replayFingerprint,
      new Date(verified.timestampMs + 5 * 60 * 1000).toISOString(),
    );
    if (!replayClaimed) {
      return jsonError(c, 409, "Automation request was already processed");
    }

    const [staff, job] = await Promise.all([
      parsed.data.staffId ? repo.getStaff(parsed.data.staffId) : Promise.resolve(undefined),
      repo.ensureJob({
        id: parsed.data.jobId ?? createId("job"),
        staffId: parsed.data.staffId,
        callerPhone: parsed.data.callerPhone,
        summary: parsed.data.notes ?? "Appointment created from voice tooling.",
        status: parsed.data.startAt ? "scheduled" : "new",
      }),
    ]);

    let calendarSync:
      | {
          provider: string;
          mode: "mock" | "configured";
          status: "booked" | "skipped";
          eventId?: string;
          reason?: string;
          webLink?: string;
        }
      | undefined;

    let outlookEventId = parsed.data.outlookEventId;
    let appointmentStatus: "proposed" | "booked" = parsed.data.startAt ? "booked" : "proposed";
    if (parsed.data.startAt) {
      const calendarConnection = staff?.calendarConnection;
      if (
        providers.calendar.mode === "configured" &&
        (!calendarConnection || calendarConnection.status !== "connected" || !calendarConnection.accessToken)
      ) {
        appointmentStatus = "proposed";
        calendarSync = {
          provider: "microsoft-calendar",
          mode: providers.calendar.mode,
          status: "skipped",
          reason: "Staff calendar is not connected with a reusable server-side credential.",
        };
      } else {
        const event = await providers.calendar.createEvent({
          staffName: staff?.fullName ?? parsed.data.staffId ?? "Curve AI Staff",
          startAt: parsed.data.startAt,
          endAt: parsed.data.endAt,
          timezone:
            parsed.data.timezone ??
            staff?.calendarConnection?.timezone ??
            staff?.timezone ??
            "Australia/Sydney",
          location: parsed.data.location,
          notes: parsed.data.notes,
          subject: job.summary?.trim() || `Curve AI job ${job.id}`,
          accountEmail: calendarConnection?.accountEmail,
          calendarId: calendarConnection?.calendarId,
          calendarLabel: calendarConnection?.calendarLabel,
          accessToken: calendarConnection?.accessToken,
          refreshToken: calendarConnection?.refreshToken,
          tokenExpiresAt: calendarConnection?.tokenExpiresAt,
        });
        if (staff && event.credential?.accessToken) {
          await repo.saveStaffCalendarConnection({
            staffId: staff.id,
            provider: "outlook",
            status: "connected",
            accountEmail: calendarConnection?.accountEmail,
            calendarId: calendarConnection?.calendarId,
            calendarLabel: calendarConnection?.calendarLabel,
            timezone: calendarConnection?.timezone ?? staff.timezone,
            authState: undefined,
            accessToken: event.credential.accessToken,
            refreshToken: event.credential.refreshToken ?? calendarConnection?.refreshToken,
            tokenExpiresAt: event.credential.tokenExpiresAt,
            lastError: undefined,
            connectedAt: calendarConnection?.connectedAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        outlookEventId = event.eventId;
        calendarSync = {
          provider: event.provider,
          mode: event.mode,
          status: event.status,
          eventId: event.eventId,
          webLink: event.webLink,
        };
      }
    }

    const appointment = await repo.upsertAppointment({
      id: createId("appointment"),
      jobId: job.id,
      staffId: parsed.data.staffId,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      status: appointmentStatus,
      outlookEventId,
      location: parsed.data.location,
      notes: parsed.data.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      job,
      appointment,
      ...(calendarSync ? { calendarSync } : {}),
    });
  });

  app.post("/voice/tools/send-photo-link", async (c) => {
    const verified = await verifyAutomationRequest(c);
    if ("error" in verified) {
      return verified.error;
    }
    const body = parseJsonBody(verified.rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(sendPhotoLinkInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const scopeError = await enforceVoiceJobScope(c, parsed.data.jobId, parsed.data.staffId);
    if (scopeError) {
      return scopeError;
    }
    const replayClaimed = await repo.claimAutomationReplay(
      verified.replayFingerprint,
      new Date(verified.timestampMs + 5 * 60 * 1000).toISOString(),
    );
    if (!replayClaimed) {
      return jsonError(c, 409, "Automation request was already processed");
    }

    const [staff, job] = await Promise.all([
      parsed.data.staffId ? repo.getStaff(parsed.data.staffId) : Promise.resolve(undefined),
      repo.ensureJob({
        id: parsed.data.jobId ?? createId("job"),
        staffId: parsed.data.staffId,
        callerPhone: parsed.data.callerPhone,
        summary: parsed.data.jobId ? undefined : "Customer photo upload requested.",
        status: "new",
      }),
    ]);
    const expiresAt = new Date(Date.now() + (parsed.data.ttlHours ?? 24) * 60 * 60 * 1000).toISOString();
    const token = createId("upload");
    const uploadLink = `${config.publicUploadAppUrl.replace(/\/$/, "")}/upload/${token}`;
    const uploadRequest = await repo.createUploadRequest({
      token,
      jobId: job.id,
      staffId: parsed.data.staffId,
      callerPhone: parsed.data.callerPhone,
      notes: parsed.data.notes,
      uploadLink,
      expiresAt,
    });

    const staffId = parsed.data.staffId;
    const callerPhone = parsed.data.callerPhone;
    const uploadRequestId = uploadRequest.token;
    const deliveryBody = buildPhotoUploadSmsBody({
      uploadLink,
      jobSummary: publicJobSummary(job.summary, job.issue, parsed.data.notes),
      requestNote: parsed.data.notes,
      requestedBy: staff?.fullName,
    });
    const delivery =
      callerPhone && deliveryBody
        ? {
            provider: "twilio-sms",
            mode: providers.messaging.mode,
            messageId: `pending_${uploadRequestId}`,
            status: "queued",
            to: callerPhone,
          }
        : {
            provider: "twilio-sms",
            mode: providers.messaging.mode,
            status: "skipped",
            reason: "No caller phone number was provided for SMS delivery.",
          };

    if (callerPhone && deliveryBody) {
      const deliveryTask = providers.messaging
        .sendText({
          to: callerPhone,
          body: deliveryBody,
        })
        .catch((error) => {
          writeLog("warn", "voice.photo_link_sms_failed", {
            jobId: job.id,
            staffId,
            callerPhone,
            uploadRequestId,
            error: summarizeError(error),
          });
        });
      try {
        c.executionCtx.waitUntil(deliveryTask);
      } catch {
        void deliveryTask;
      }
    }

    return c.json({
      ok: true,
      job,
      uploadRequest,
      delivery,
    });
  });

  app.post("/voice/post-call", async (c) => {
    const verified = await verifyAutomationRequest(c);
    if ("error" in verified) {
      return verified.error;
    }
    const body = parseJsonBody(verified.rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voicePostCallInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
    }
    const scopeError = await enforceVoiceJobScope(c, parsed.data.jobId, parsed.data.staffId);
    if (scopeError) {
      return scopeError;
    }
    const replayClaimed = await repo.claimAutomationReplay(
      verified.replayFingerprint,
      new Date(verified.timestampMs + 5 * 60 * 1000).toISOString(),
    );
    if (!replayClaimed) {
      return jsonError(c, 409, "Automation request was already processed");
    }

    const job =
      parsed.data.jobId || parsed.data.staffId || parsed.data.callerPhone || parsed.data.summary
        ? await repo.ensureJob({
            id: parsed.data.jobId ?? createId("job"),
            staffId: parsed.data.staffId,
            callerPhone: parsed.data.callerPhone,
            summary: parsed.data.summary,
            status: parsed.data.status === "callback_requested" ? "callback" : "new",
          })
        : undefined;

    const call = await repo.recordCall({
      id: parsed.data.callId,
      jobId: job?.id ?? parsed.data.jobId,
      staffId: parsed.data.staffId,
      callerPhone: parsed.data.callerPhone,
      direction: parsed.data.direction,
      status: parsed.data.status,
      transcript: parsed.data.transcript,
      summary: parsed.data.summary,
      disposition: parsed.data.disposition,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return c.json(
      {
        ok: true,
        call,
        job,
      },
      { status: 201 },
    );
  });

  app.get("/assets/photos/:photoId", async (c) => {
    const actor = await authenticateActor(c);
    if (!actor) {
      return jsonError(c, 401, "Authentication is required");
    }
    const photoId = c.req.param("photoId");
    if (!photoId) {
      return jsonError(c, 400, "photoId is required");
    }
    const photo = await repo.getPhotoAsset(photoId);
    if (!photo) {
      return jsonError(c, 404, "Photo not found", { photoId });
    }
    if (actor.kind !== "admin") {
      const card = await repo.getJobCard(photo.jobId);
      if (!card?.job.staffId || card.job.staffId !== actor.staffId) {
        return jsonError(c, 403, "You do not have access to that photo");
      }
    }
    const object = await objectStore.get(photo.objectKey ?? photo.id);
    if (!object) {
      return jsonError(c, 404, "Stored photo object not found", { photoId });
    }
    return new Response(object.blob, {
      headers: {
        "Content-Type": object.contentType ?? photo.mimeType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return app;
}
