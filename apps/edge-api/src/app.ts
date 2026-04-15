import { cors } from "hono/cors";
import { Hono } from "hono";
import { z, type ZodTypeAny } from "zod";
import { getConfig, type EdgeApiEnv } from "./env.js";
import { OnboardingRuleError, OnboardingService, type ServiceProviders } from "./onboarding-service.js";
import { MockMicrosoftCalendarAdapter } from "./providers/calendar.js";
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
} from "./models.js";
import {
  onboardingInviteInputSchema,
  onboardingReviewPatchSchema,
  onboardingStartInputSchema,
  onboardingTurnInputSchema,
  onboardingVoiceSampleInputSchema,
  onboardingVoiceTokenInputSchema,
  sendPhotoLinkInputSchema,
  voiceAppointmentInputSchema,
  voiceCallbackInputSchema,
  voiceContextInputSchema,
  voicePostCallInputSchema,
  voiceQuoteInputSchema,
} from "./validation.js";
import { createId, signHmacSha256 } from "./crypto.js";

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

function getSignedAssetSecret(config: ReturnType<typeof getConfig>): string {
  if (!config.photoAccessSecret) {
    throw new Error("Photo access signing secret is not configured");
  }
  return config.photoAccessSecret;
}

function isSupportedPhotoFile(file: Pick<File, "name" | "type" | "size">): boolean {
  const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";
  if (file.type.startsWith("image/")) {
    return true;
  }
  return allowedExtensions.has(extension);
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

async function signPhotoUrl(publicApiUrl: string, secret: string, photoId: string, expiresAt: string): Promise<string> {
  const signature = await signHmacSha256(secret, `${photoId}.${expiresAt}`);
  const url = new URL(`/assets/photos/${encodeURIComponent(photoId)}`, publicApiUrl);
  url.searchParams.set("expires", expiresAt);
  url.searchParams.set("signature", signature);
  return url.toString();
}

async function mapDashboardPayload(
  jobs: JobRecord[],
  callbacks: CallbackTaskRecord[],
  publicApiUrl: string,
  secret: string,
  experiments: DashboardPayload["experiments"],
): Promise<DashboardPayload> {
  const photoUrlFor = async (photo: JobPhoto) => signPhotoUrl(publicApiUrl, secret, photo.id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString());
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
              url: await photoUrlFor(photo),
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

async function signJobCardEnvelope(
  card: JobCardEnvelope,
  publicApiUrl: string,
  secret: string,
): Promise<JobCardEnvelope> {
  const signPhoto = async (photo: JobPhoto) => ({
    ...photo,
    url: await signPhotoUrl(publicApiUrl, secret, photo.id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()),
  });
  return {
    ...card,
    job: {
      ...card.job,
      photos: await Promise.all(card.job.photos.map(signPhoto)),
    },
    photos: await Promise.all(card.photos.map(signPhoto)),
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

export function createApp(options?: {
  env?: EdgeApiEnv;
  repo?: OnboardingRepository;
  objectStore?: ObjectStore;
  providers?: ServiceProviders;
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
  const onboardingService = new OnboardingService({
    repo,
    config,
    providers,
    objectStore,
    coordinatorNamespace: env.ONBOARDING_SESSIONS,
  });

  const app = new Hono<AppBindings>();

  app.use("*", cors({
    origin: config.allowedOrigins.length === 1 ? config.allowedOrigins[0] : config.allowedOrigins,
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Token", "X-Onboarding-Token", "X-Curve-Signature", "X-Curve-Timestamp"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));

  app.onError((error, c) => {
    if (error instanceof OnboardingRuleError) {
      return jsonError(c, error.statusCode, error.message);
    }
    return jsonError(c, 500, error instanceof Error ? error.message : "Unexpected error");
  });

  async function requireAdmin(c: any) {
    const token = getAccessToken(c.req.raw);
    if (!token || !config.adminToken || token !== config.adminToken) {
      return jsonError(c, 401, "Admin authentication is required");
    }
    return undefined;
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

  app.get("/health", (c) =>
    c.json({
      ok: true,
      runtime: "cloudflare-worker",
      realtimeVoice: providers.realtimeVoice.mode,
      reasoning: providers.reasoning.mode,
      calendar: providers.calendar.mode,
    }),
  );

  app.get("/dashboard", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const secret = getSignedAssetSecret(config);
    const [jobs, callbacks, experiments] = await Promise.all([
      repo.listJobs(),
      repo.listCallbacks(),
      repo.listExperiments(),
    ]);
    return c.json(await mapDashboardPayload(jobs, callbacks, config.publicApiUrl, secret, experiments));
  });

  app.get("/jobs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const secret = getSignedAssetSecret(config);
    const staffId = c.req.query("staffId") ?? undefined;
    const jobs = await repo.listJobs(staffId);
    const dashboard = await mapDashboardPayload(jobs, [], config.publicApiUrl, secret, []);
    return c.json({
      ok: true,
      jobs: dashboard.jobs,
    });
  });

  app.get("/jobs/:jobId/card", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) {
      return authError;
    }
    const jobId = c.req.param("jobId");
    if (!jobId) {
      return jsonError(c, 400, "jobId is required");
    }
    const card = await repo.getJobCard(jobId);
    if (!card) {
      return jsonError(c, 404, "Job not found", { jobId });
    }
    const secret = getSignedAssetSecret(config);
    const signedCard = await signJobCardEnvelope(card, config.publicApiUrl, secret);
    return c.json({
      ok: true,
      card: signedCard,
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
    if (upload.status !== "pending") {
      return jsonError(c, 409, "This upload request has already been completed", { token });
    }
    if (new Date(upload.expiresAt).getTime() < Date.now()) {
      return jsonError(c, 410, "Upload request has expired", { token });
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
      if (!isSupportedPhotoFile(file)) {
        return jsonError(c, 400, "Only image uploads are allowed");
      }
      if (file.size > 15 * 1024 * 1024) {
        return jsonError(c, 400, "Each photo must be 15 MB or smaller");
      }
      const photoId = createId("photo");
      const objectKey = `uploads/photos/${upload.jobId}/${photoId}-${sanitizeFilename(file.name)}`;
      await objectStore.put(objectKey, file, {
        contentType: file.type || undefined,
      });
      const photo: JobPhoto = {
        id: photoId,
        jobId: upload.jobId,
        filename: file.name,
        objectKey,
        mimeType: file.type || undefined,
        caption: toPhotoCaption(file.name),
        uploadedAt: new Date().toISOString(),
      };
      storedPhotos.push(photo);
    }

    const completed = await repo.completeUploadRequest(token, storedPhotos);
    if (!completed) {
      return jsonError(c, 404, "Upload request not found", { token });
    }

    return c.json({
      ok: true,
      uploaded: storedPhotos.length,
      upload: completed,
      photos: storedPhotos,
    });
  };

  app.get("/uploads/:token", async (c) => {
    const token = c.req.param("token");
    const upload = await repo.getUploadRequest(token);
    if (!upload) {
      return jsonError(c, 404, "Upload request not found", { token });
    }
    if (upload.status === "expired") {
      return jsonError(c, 410, "Upload request has expired", { token });
    }
    return c.json({
      ok: true,
      upload,
    });
  });

  app.post("/uploads/:token", handleUploadPhotos);
  app.post("/uploads/:token/photos", handleUploadPhotos);

  app.post("/voice/context", async (c) => {
    const secret = config.automationSharedSecret;
    if (!secret) {
      return jsonError(c, 503, "Automation signature secret is not configured");
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return jsonError(c, 401, "Signed automation headers are required");
    }
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return jsonError(c, 401, "Automation signature timestamp is invalid or expired");
    }
    const expected = await signHmacSha256(secret, `${timestamp}.${rawBody}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Automation signature did not match");
    }

    const body = parseJsonBody(rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceContextInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
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
        response.card = await signJobCardEnvelope(card, config.publicApiUrl, getSignedAssetSecret(config));
      }
    }
    return c.json(response);
  });

  app.post("/voice/tools/quote", async (c) => {
    const secret = config.automationSharedSecret;
    if (!secret) {
      return jsonError(c, 503, "Automation signature secret is not configured");
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return jsonError(c, 401, "Signed automation headers are required");
    }
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return jsonError(c, 401, "Automation signature timestamp is invalid or expired");
    }
    const expected = await signHmacSha256(secret, `${timestamp}.${rawBody}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Automation signature did not match");
    }
    const body = parseJsonBody(rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceQuoteInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
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
    const secret = config.automationSharedSecret;
    if (!secret) {
      return jsonError(c, 503, "Automation signature secret is not configured");
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return jsonError(c, 401, "Signed automation headers are required");
    }
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return jsonError(c, 401, "Automation signature timestamp is invalid or expired");
    }
    const expected = await signHmacSha256(secret, `${timestamp}.${rawBody}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Automation signature did not match");
    }
    const body = parseJsonBody(rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceCallbackInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
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
    const secret = config.automationSharedSecret;
    if (!secret) {
      return jsonError(c, 503, "Automation signature secret is not configured");
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return jsonError(c, 401, "Signed automation headers are required");
    }
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return jsonError(c, 401, "Automation signature timestamp is invalid or expired");
    }
    const expected = await signHmacSha256(secret, `${timestamp}.${rawBody}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Automation signature did not match");
    }
    const body = parseJsonBody(rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(voiceAppointmentInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
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
    const secret = config.automationSharedSecret;
    if (!secret) {
      return jsonError(c, 503, "Automation signature secret is not configured");
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return jsonError(c, 401, "Signed automation headers are required");
    }
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return jsonError(c, 401, "Automation signature timestamp is invalid or expired");
    }
    const expected = await signHmacSha256(secret, `${timestamp}.${rawBody}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Automation signature did not match");
    }
    const body = parseJsonBody(rawBody);
    if (body === undefined) {
      return jsonError(c, 400, "Invalid JSON body");
    }
    const parsed = parseValidation(sendPhotoLinkInputSchema, body);
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
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
    const secret = config.automationSharedSecret;
    if (!secret) {
      return jsonError(c, 503, "Automation signature secret is not configured");
    }
    const timestamp = c.req.header("x-curve-timestamp");
    const signature = c.req.header("x-curve-signature")?.replace(/^sha256=/, "");
    const rawBody = await c.req.raw.text();
    if (!timestamp || !signature) {
      return jsonError(c, 401, "Signed automation headers are required");
    }
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return jsonError(c, 401, "Automation signature timestamp is invalid or expired");
    }
    const expected = await signHmacSha256(secret, `${timestamp}.${rawBody}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Automation signature did not match");
    }

    const parsed = parseValidation(voicePostCallInputSchema, rawBody ? JSON.parse(rawBody) : {});
    if (!parsed.data) {
      return jsonError(c, 400, "Invalid request payload", { issues: parsed.issues });
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
    const secret = getSignedAssetSecret(config);
    const photoId = c.req.param("photoId");
    const expires = c.req.query("expires");
    const signature = c.req.query("signature");
    if (!photoId || !expires || !signature) {
      return jsonError(c, 400, "Signed photo access parameters are required");
    }
    const expiresMs = Date.parse(expires);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      return jsonError(c, 410, "Signed photo URL has expired");
    }
    const expected = await signHmacSha256(secret, `${photoId}.${expires}`);
    if (expected !== signature) {
      return jsonError(c, 401, "Signed photo URL did not match");
    }
    const photo = await repo.getPhotoAsset(photoId);
    if (!photo) {
      return jsonError(c, 404, "Photo not found", { photoId });
    }
    const object = await objectStore.get(photo.objectKey ?? photo.id);
    if (!object) {
      return jsonError(c, 404, "Stored photo object not found", { photoId });
    }
    return new Response(object.blob, {
      headers: {
        "Content-Type": object.contentType ?? photo.mimeType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  });

  return app;
}
