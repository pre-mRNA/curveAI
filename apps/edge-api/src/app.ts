import { cors } from "hono/cors";
import { Hono } from "hono";
import { z, type ZodTypeAny } from "zod";
import { AiTestStudioRuleError, AiTestStudioService, type AiTestStudioProviders } from "./ai-test-studio-service.js";
import { getConfig, type EdgeApiEnv } from "./env.js";
import { OnboardingRuleError, OnboardingService, type ServiceProviders } from "./onboarding-service.js";
import { MockMicrosoftCalendarAdapter } from "./providers/calendar.js";
import {
  HttpAiTestJudgeProvider,
  HttpAiTestRunnerProvider,
  MockAiTestJudgeProvider,
  MockAiTestRunnerProvider,
} from "./providers/ai-test-studio.js";
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

const defaultMemoryRepo = new InMemoryOnboardingRepository();
const defaultMemoryObjectStore = new InMemoryObjectStore();
type OnboardingSessionResult = { session: OnboardingSessionRecord } | { error: Response };

function jsonError(c: any, status: number, message: string, details?: Record<string, unknown>) {
  return c.json(
    {
      ok: false,
      error: {
        message,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}

function getAccessToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const [scheme, ...rest] = authorization.split(/\s+/);
    if (scheme && /^bearer$/i.test(scheme) && rest.length > 0) {
      return rest.join(" ").trim();
    }
  }
  return request.headers.get("x-admin-token") ?? request.headers.get("x-staff-session") ?? request.headers.get("x-onboarding-token") ?? undefined;
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
  return {
    ...safeStaff,
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

function toPublicUploadSummary(upload: {
  fileCount: number;
  status: string;
  expiresAt: string;
}) {
  return {
    fileCount: upload.fileCount,
    status: upload.status,
    expiresAt: upload.expiresAt,
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

function buildProviders(env: EdgeApiEnv): ServiceProviders {
  const heuristicReasoning = new HeuristicReasoningProvider();
  return {
    realtimeVoice:
      env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID
        ? new ElevenLabsRealtimeProvider({
            apiKey: env.ELEVENLABS_API_KEY,
            agentId: env.ELEVENLABS_AGENT_ID,
          })
        : new MockRealtimeVoiceProvider(),
    reasoning:
      env.REASONING_BASE_URL && env.REASONING_API_KEY
        ? new HttpReasoningProvider({
            baseUrl: env.REASONING_BASE_URL,
            apiKey: env.REASONING_API_KEY,
            mode: (env.REASONING_PROVIDER ?? "").toLowerCase() === "openai-compatible" ? "openai-compatible" : "hosted",
            fallback: heuristicReasoning,
          })
        : heuristicReasoning,
    calendar: new MockMicrosoftCalendarAdapter({
      tenantId: env.MICROSOFT_TENANT_ID,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
      graphBaseUrl: env.MICROSOFT_GRAPH_BASE_URL,
    }),
    voiceClone: new HeuristicVoiceCloneProvider(),
  };
}

function buildAiTestProviders(env: EdgeApiEnv): AiTestStudioProviders {
  const mockRunner = new MockAiTestRunnerProvider();
  const mockJudge = new MockAiTestJudgeProvider();
  const runnerMode = (env.AI_TEST_RUNNER_PROVIDER ?? "").trim().toLowerCase() === "openai-compatible" ? "openai-compatible" : "hosted";
  const judgeMode = (env.AI_TEST_JUDGE_PROVIDER ?? "").trim().toLowerCase() === "openai-compatible" ? "openai-compatible" : "hosted";

  return {
    runner:
      env.AI_TEST_RUNNER_BASE_URL && env.AI_TEST_RUNNER_API_KEY
        ? new HttpAiTestRunnerProvider({
            baseUrl: env.AI_TEST_RUNNER_BASE_URL,
            apiKey: env.AI_TEST_RUNNER_API_KEY,
            mode: runnerMode,
            fallback: mockRunner,
          })
        : mockRunner,
    judge:
      env.AI_TEST_JUDGE_BASE_URL && env.AI_TEST_JUDGE_API_KEY
        ? new HttpAiTestJudgeProvider({
            baseUrl: env.AI_TEST_JUDGE_BASE_URL,
            apiKey: env.AI_TEST_JUDGE_API_KEY,
            mode: judgeMode,
            fallback: mockJudge,
          })
        : mockJudge,
  };
}

export function createApp(options?: {
  env?: EdgeApiEnv;
  repo?: OnboardingRepository;
  objectStore?: ObjectStore;
  providers?: ServiceProviders;
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
  const aiTestProviders = options?.aiTestProviders ?? buildAiTestProviders(env);
  const onboardingService = new OnboardingService({
    repo,
    config,
    providers,
    objectStore,
    coordinatorNamespace: env.ONBOARDING_SESSIONS,
  });
  const aiTestStudioService = new AiTestStudioService({
    repo,
    providers: aiTestProviders,
  });

  const app = new Hono<AppBindings>();

  app.use("*", cors({
    origin: config.allowedOrigins.length === 1 ? config.allowedOrigins[0] : config.allowedOrigins,
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Token", "X-Staff-Session", "X-Onboarding-Token", "X-Curve-Signature", "X-Curve-Timestamp"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }
    if (c.req.path === "/health") {
      await next();
      return;
    }
    if (config.warnings.length > 0 && !isLocalRequest(c.req.url)) {
      return jsonError(
        c,
        503,
        "Worker configuration is incomplete",
        hasAdminAccess(c.req.raw) ? { issues: config.warnings } : undefined,
      );
    }
    await next();
  });

  app.onError((error, c) => {
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

  function hasAdminAccess(request: Request): boolean {
    const token = getAccessToken(request);
    return Boolean(token && config.adminToken && constantTimeEqual(token, config.adminToken));
  }

  async function requireAdmin(c: any) {
    const token = getAccessToken(c.req.raw);
    if (!token || !config.adminToken || !constantTimeEqual(token, config.adminToken)) {
      return jsonError(c, 401, "Admin authentication is required");
    }
    return undefined;
  }

  async function authenticateActor(c: any): Promise<AuthActor | undefined> {
    const token = getAccessToken(c.req.raw);
    if (!token) {
      return undefined;
    }
    if (config.adminToken && constantTimeEqual(token, config.adminToken)) {
      return { kind: "admin" };
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
    const token = getAccessToken(c.req.raw);
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
            ok: config.warnings.length === 0,
            ready: config.warnings.length === 0,
            runtime: "cloudflare-worker",
            realtimeVoice: providers.realtimeVoice.mode,
            reasoning: providers.reasoning.mode,
            calendar: providers.calendar.mode,
            warnings: config.warnings,
          }
        : {
            ok: config.warnings.length === 0,
            ready: config.warnings.length === 0,
            runtime: "cloudflare-worker",
          },
    ),
  );

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
    const verifiedStaff = await repo.getStaff(staff.id);
    return c.json({
      ok: true,
      staff: sanitizeStaff(verifiedStaff ?? staff),
      session: {
        token: sessionToken,
        expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
      },
    });
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
      staff: sanitizeStaff(staff),
    });
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

  app.post("/staff/calendar/connect", async (c) => {
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
      accountEmail: parsed.data.accountEmail,
      calendarId: parsed.data.calendarId,
      timezone: parsed.data.timezone,
      externalConnectionId: parsed.data.externalConnectionId,
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
      calendarConnection,
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
    const session = await onboardingService.startSession(parsed.data.inviteCode);
    if (!session) {
      return jsonError(c, 404, "Onboarding invite not found or expired");
    }
    return c.json(
      {
        ok: true,
        session: session.summary,
      },
      { status: 201 },
    );
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
    return c.json({
      ok: true,
      session: await onboardingService.provisionRealtimeVoice(session, parsed.data),
    });
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
    return c.json({
      ok: true,
      session: finalized.session,
      staff: finalized.staff,
    });
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
      upload: toPublicUploadSummary(completed),
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
      upload: toPublicUploadSummary(upload),
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

    const job = await repo.ensureJob({
      id: parsed.data.jobId ?? createId("job"),
      staffId: parsed.data.staffId,
      summary: parsed.data.notes ?? "Appointment created from voice tooling.",
      status: parsed.data.startAt ? "scheduled" : "new",
    });

    const appointment = await repo.upsertAppointment({
      id: createId("appointment"),
      jobId: job.id,
      staffId: parsed.data.staffId,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      status: parsed.data.startAt ? "booked" : "proposed",
      outlookEventId: parsed.data.outlookEventId,
      location: parsed.data.location,
      notes: parsed.data.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      job,
      appointment,
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

    const job = await repo.ensureJob({
      id: parsed.data.jobId ?? createId("job"),
      staffId: parsed.data.staffId,
      callerPhone: parsed.data.callerPhone,
      summary: parsed.data.notes ?? "Photo upload requested from voice tooling.",
      status: "new",
    });
    const expiresAt = new Date(Date.now() + (parsed.data.ttlHours ?? 24) * 60 * 60 * 1000).toISOString();
    const token = createId("upload");
    const uploadRequest = await repo.createUploadRequest({
      token,
      jobId: job.id,
      staffId: parsed.data.staffId,
      callerPhone: parsed.data.callerPhone,
      notes: parsed.data.notes,
      uploadLink: `${config.publicUploadAppUrl.replace(/\/$/, "")}/upload/${token}`,
      expiresAt,
    });

    return c.json({
      ok: true,
      job,
      uploadRequest,
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
