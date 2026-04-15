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
import type { OnboardingSessionRecord } from "./models.js";
import {
  onboardingInviteInputSchema,
  onboardingReviewPatchSchema,
  onboardingStartInputSchema,
  onboardingTurnInputSchema,
  onboardingVoiceSampleInputSchema,
  onboardingVoiceTokenInputSchema,
} from "./validation.js";
import { signHmacSha256 } from "./crypto.js";

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
    origin: config.allowedOrigin,
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
    return c.json(await repo.getDashboard());
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
    const redirectUrl = new URL(`/onboard/${summary.inviteCode}`, config.publicAppUrl);
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

  app.post("/uploads/:token", (c) => jsonError(c, 501, "Photo uploads are not migrated to the Worker yet."));
  app.post("/uploads/:token/photos", (c) => jsonError(c, 501, "Photo uploads are not migrated to the Worker yet."));

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
    return jsonError(c, 501, "Voice routes are not migrated to the Worker yet.");
  });

  return app;
}
