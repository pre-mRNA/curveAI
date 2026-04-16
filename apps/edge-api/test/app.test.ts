import assert from "node:assert/strict";
import test from "node:test";
import {
  aiTestCaseResponseSchema,
  aiTestRunListResponseSchema,
  aiTestRunResponseSchema,
} from "../../../packages/shared/src/ai-test-studio";
import { createApp } from "../src/app.js";
import { signHmacSha256 } from "../src/crypto.js";
import { getConfig, type EdgeApiEnv } from "../src/env.js";
import {
  HttpAiTestJudgeProvider,
  HttpAiTestRunnerProvider,
  MockAiTestJudgeProvider,
  MockAiTestRunnerProvider,
} from "../src/providers/ai-test-studio.js";
import {
  createMockMicrosoftAccessToken,
  defaultMockMicrosoftIdentity,
  MockMicrosoftCalendarAdapter,
} from "../src/providers/calendar.js";
import { MockMessagingProvider } from "../src/providers/messaging.js";
import { MockRealtimeVoiceProvider } from "../src/providers/realtime.js";
import { HeuristicReasoningProvider, HttpReasoningProvider } from "../src/providers/reasoning.js";
import { HeuristicVoiceCloneProvider } from "../src/providers/voice-clone.js";
import { AiTestStudioService } from "../src/ai-test-studio-service.js";
import { OnboardingService } from "../src/onboarding-service.js";
import { InMemoryOnboardingRepository } from "../src/storage/memory.js";
import { InMemoryObjectStore } from "../src/storage/artifacts.js";

function adminHeaders(): HeadersInit {
  return {
    Authorization: "Bearer admin-secret",
    "Content-Type": "application/json",
  };
}

function baseEnv(overrides: Partial<EdgeApiEnv> = {}): EdgeApiEnv {
  return {
    ADMIN_TOKEN: "admin-secret",
    AUTOMATION_SHARED_SECRET: "automation-secret",
    ALLOW_INSECURE_TEST_OTP: "true",
    PUBLIC_OPS_APP_URL: "https://curve-ai-ops.pages.dev",
    PUBLIC_STAFF_APP_URL: "https://curve-ai-staff.pages.dev",
    PUBLIC_ONBOARDING_APP_URL: "https://curve-ai-onboarding.pages.dev",
    PUBLIC_UPLOAD_APP_URL: "https://curve-ai-upload.pages.dev",
    PUBLIC_API_URL: "https://curve-ai-api-staging.workers.dev",
    ALLOWED_ORIGINS:
      "https://curve-ai-ops.pages.dev,https://curve-ai-staff.pages.dev,https://curve-ai-onboarding.pages.dev,https://curve-ai-upload.pages.dev",
    ...overrides,
  };
}

function createTestApp(overrides: Partial<EdgeApiEnv> = {}) {
  return createApp({
    env: baseEnv(overrides),
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });
}

async function createStaffSession(app: ReturnType<typeof createApp>, input: {
  fullName: string;
  email?: string;
  phoneNumber?: string;
  role?: string;
  timezone?: string;
}) {
  const inviteResponse = await app.request("/staff/invite", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as {
    staff: { id: string };
    inviteCode: string;
    otpCode: string;
  };

  const verifyResponse = await app.request("/staff/verify-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      staffId: inviteBody.staff.id,
      inviteToken: inviteBody.inviteCode,
      otpCode: inviteBody.otpCode,
    }),
  });
  assert.equal(verifyResponse.status, 200);
  const sessionCookie = verifyResponse.headers.get("set-cookie");
  const verifyBody = (await verifyResponse.json()) as {
    staff: { id: string };
    session: { expiresAt: string };
  };

  return {
    staffId: verifyBody.staff.id,
    sessionCookie: sessionCookie ?? "",
  };
}

async function automationHeaders(secret: string, path: string, body: unknown, method = "POST"): Promise<HeadersInit> {
  return automationHeadersForRawBody(secret, path, JSON.stringify(body), method);
}

async function automationHeadersForRawBody(secret: string, path: string, rawBody: string, method = "POST"): Promise<HeadersInit> {
  const timestamp = Date.now().toString();
  const signature = await signHmacSha256(secret, `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`);
  return {
    "Content-Type": "application/json",
    "X-Curve-Timestamp": timestamp,
    "X-Curve-Signature": `sha256=${signature}`,
  };
}

async function withMockProviderFetch<T>(app: ReturnType<typeof createApp>, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/mock/providers/")) {
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
      return app.request(`${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body,
      });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("worker onboarding flow reaches finalized state", async () => {
  const repo = new InMemoryOnboardingRepository();
  const objectStore = new InMemoryObjectStore();
  const app = createApp({
    env: baseEnv(),
    repo,
    objectStore,
  });

  const inviteResponse = await app.request("/onboarding/invites", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: "Jordan S",
      role: "Owner",
      email: "jordan@example.com",
    }),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as {
    invite: { code: string };
  };

  const startResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
      consentAccepted: true,
      cloneConsentAccepted: true,
    }),
  });
  assert.equal(startResponse.status, 201);
  const onboardingCookie = startResponse.headers.get("set-cookie");
  assert.match(onboardingCookie ?? "", /curve_onboarding_session=/);
  const startBody = (await startResponse.json()) as {
    session: { id: string; nextQuestion?: { question?: string } | null };
  };
  const sessionId = startBody.session.id;
  assert.equal("participantToken" in startBody.session, false);
  assert.equal(
    startBody.session.nextQuestion?.question,
    "What kinds of jobs do you want the agent to talk about and qualify?",
  );

  const duplicateStartResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
      consentAccepted: true,
      cloneConsentAccepted: true,
    }),
  });
  assert.equal(duplicateStartResponse.status, 409);

  const resumedResponse = await app.request(`/onboarding/invites/${inviteBody.invite.code}/session`, {
    headers: {
      Cookie: onboardingCookie ?? "",
    },
  });
  assert.equal(resumedResponse.status, 200);

  const nextQuestionResponse = await app.request(`/onboarding/sessions/${sessionId}/next-question`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
    },
  });
  assert.equal(nextQuestionResponse.status, 200);
  const nextQuestionBody = (await nextQuestionResponse.json()) as {
    nextQuestion?: { question?: string } | null;
  };
  assert.equal(
    nextQuestionBody.nextQuestion?.question,
    "What kinds of jobs do you want the agent to talk about and qualify?",
  );

  const turnResponse = await app.request(`/onboarding/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      speaker: "participant",
      text: "I run plumbing and hot water jobs across Sydney and the inner west. We do emergency and after hours work, use fixed quotes when scope is clear, prefer a friendly but direct tone, escalate large jobs for approval, and use ServiceM8 plus Outlook calendar booking.",
    }),
  });
  assert.equal(turnResponse.status, 201);

  const reviewSaveResponse = await app.request(`/onboarding/sessions/${sessionId}/review`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessSummary: "Jordan Plumbing handles metro plumbing and emergency jobs.",
      staffProfile: {
        staffName: "Jordan S",
        companyName: "Jordan Plumbing",
        role: "Owner",
        calendarProvider: "Microsoft",
      },
    }),
  });
  assert.equal(reviewSaveResponse.status, 200);

  const calendarResponse = await app.request(`/onboarding/sessions/${sessionId}/calendar/microsoft/start`, {
    method: "GET",
    headers: {
      Cookie: onboardingCookie ?? "",
    },
  });
  assert.equal(calendarResponse.status, 200);
  const calendarBody = (await calendarResponse.json()) as {
    calendar: { authUrl?: string; authState?: string };
  };
  assert.ok(calendarBody.calendar.authUrl);
  assert.ok(calendarBody.calendar.authState);
  assert.match(calendarBody.calendar.authUrl ?? "", /\/mock\/providers\/microsoft\/authorize/);

  const mockAuthorizeUrl = new URL(calendarBody.calendar.authUrl ?? "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft/authorize");
  const authorizeResponse = await app.request(`${mockAuthorizeUrl.pathname}${mockAuthorizeUrl.search}`);
  assert.equal(authorizeResponse.status, 302);
  const callbackLocation = authorizeResponse.headers.get("location");
  assert.ok(callbackLocation);
  const callbackUrl = new URL(callbackLocation ?? "https://curve-ai-api-staging.workers.dev/onboarding/calendar/microsoft/callback");
  const callbackResponse = await app.request(`${callbackUrl.pathname}${callbackUrl.search}`);
  assert.equal(callbackResponse.status, 302);

  const formData = new FormData();
  formData.set("sampleLabel", "Quiet office sample");
  formData.set("durationSeconds", "92");
  formData.set("transcript", "This is a longer clean sample for cloning and onboarding quality assessment.");
  formData.set("noiseLevel", "low");
  formData.set("sample", new File(["voice-data"], "voice-sample.webm", { type: "audio/webm" }));
  const voiceSampleResponse = await app.request(`/onboarding/sessions/${sessionId}/voice-sample`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
    },
    body: formData,
  });
  assert.equal(voiceSampleResponse.status, 200);

  const finalizeResponse = await app.request(`/onboarding/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
    },
  });
  assert.equal(finalizeResponse.status, 200);
  assert.match(finalizeResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
  const finalizeBody = (await finalizeResponse.json()) as {
    session: { status: string };
    staff: { id: string };
  };
  assert.equal(finalizeBody.session.status, "completed");
  assert.ok(finalizeBody.staff.id);

  const staleSessionRead = await app.request(`/onboarding/sessions/${sessionId}`, {
    headers: {
      Cookie: onboardingCookie ?? "",
    },
  });
  assert.equal(staleSessionRead.status, 403);

  const blockedMutation = await app.request(`/onboarding/sessions/${sessionId}/review`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessSummary: "Should not persist",
    }),
  });
  assert.equal(blockedMutation.status, 403);

  const duplicateFinalize = await app.request(`/onboarding/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie ?? "",
    },
  });
  assert.equal(duplicateFinalize.status, 403);
});

test("onboarding start rolls invite state back when realtime provisioning fails", async () => {
  const repo = new InMemoryOnboardingRepository();
  const app = createApp({
    env: baseEnv(),
    repo,
    objectStore: new InMemoryObjectStore(),
    providers: {
      realtimeVoice: {
        mode: "configured",
        async issueBrowserSession() {
          throw new Error("Realtime provider unavailable");
        },
      },
      reasoning: new HeuristicReasoningProvider(),
      calendar: new MockMicrosoftCalendarAdapter(),
      voiceClone: new HeuristicVoiceCloneProvider(),
      messaging: new MockMessagingProvider(),
    },
  });

  const inviteResponse = await app.request("/onboarding/invites", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      fullName: "Rollback Test",
      email: "rollback@example.com",
    }),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as { invite: { code: string } };

  const firstStartResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
      consentAccepted: true,
      cloneConsentAccepted: true,
    }),
  });
  assert.equal(firstStartResponse.status, 500);

  const invite = await repo.getInviteByCode(inviteBody.invite.code);
  assert.equal(invite?.status, "pending");
  assert.equal(invite?.sessionId, undefined);

  const secondStartResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
      consentAccepted: true,
      cloneConsentAccepted: true,
    }),
  });
  assert.equal(secondStartResponse.status, 500);
});

test("onboarding finalize keeps the session mutable if downstream persistence fails", async () => {
  class FailingFinalizeRepo extends InMemoryOnboardingRepository {
    private upsertCalls = 0;

    override async upsertStaffProfile(
      input: Parameters<InMemoryOnboardingRepository["upsertStaffProfile"]>[0],
    ): Promise<void> {
      this.upsertCalls += 1;
      if (this.upsertCalls >= 2) {
        throw new Error("Profile write failed");
      }
      await super.upsertStaffProfile(input);
    }
  }

  const repo = new FailingFinalizeRepo();
  const app = createApp({
    env: baseEnv(),
    repo,
    objectStore: new InMemoryObjectStore(),
  });

  const inviteResponse = await app.request("/onboarding/invites", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      fullName: "Finalize Retry",
      role: "Owner",
      email: "finalize@example.com",
    }),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as { invite: { code: string } };

  const startResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
      consentAccepted: true,
      cloneConsentAccepted: true,
    }),
  });
  assert.equal(startResponse.status, 201);
  const onboardingCookie = startResponse.headers.get("set-cookie") ?? "";
  const startBody = (await startResponse.json()) as { session: { id: string } };
  const sessionId = startBody.session.id;

  const calendarResponse = await app.request(`/onboarding/sessions/${sessionId}/calendar/microsoft/start`, {
    headers: {
      Cookie: onboardingCookie,
    },
  });
  assert.equal(calendarResponse.status, 200);
  const calendarBody = (await calendarResponse.json()) as { calendar: { authState?: string } };
  assert.ok(calendarBody.calendar.authState);

  const callbackResponse = await app.request(
    `/onboarding/calendar/microsoft/callback?state=${encodeURIComponent(calendarBody.calendar.authState ?? "")}&email=finalize@example.com&calendar=Primary`,
  );
  assert.equal(callbackResponse.status, 302);

  const formData = new FormData();
  formData.set("sampleLabel", "Quiet office sample");
  formData.set("durationSeconds", "25");
  formData.set("sample", new File(["voice-data"], "voice-sample.webm", { type: "audio/webm" }));
  const voiceSampleResponse = await app.request(`/onboarding/sessions/${sessionId}/voice-sample`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie,
    },
    body: formData,
  });
  assert.equal(voiceSampleResponse.status, 200);

  const finalizeResponse = await app.request(`/onboarding/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: {
      Cookie: onboardingCookie,
    },
  });
  assert.equal(finalizeResponse.status, 500);

  const resumedResponse = await app.request(`/onboarding/sessions/${sessionId}`, {
    headers: {
      Cookie: onboardingCookie,
    },
  });
  assert.equal(resumedResponse.status, 200);
  const resumedBody = (await resumedResponse.json()) as { session: { status: string } };
  assert.notEqual(resumedBody.session.status, "completed");
});

test("configured mock provider endpoints exercise realtime and calendar integrations", async () => {
  const app = createApp({
    env: baseEnv({
      ELEVENLABS_API_KEY: "test-elevenlabs-key",
      ELEVENLABS_AGENT_ID: "agent_mock_123",
      ELEVENLABS_BASE_URL: "https://curve-ai-api-staging.workers.dev/mock/providers/elevenlabs",
      MICROSOFT_CLIENT_ID: "mock-client-id",
      MICROSOFT_CLIENT_SECRET: "mock-client-secret",
      MICROSOFT_REDIRECT_URI: "https://curve-ai-api-staging.workers.dev/onboarding/calendar/microsoft/callback",
      MICROSOFT_AUTH_BASE_URL: "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft",
      MICROSOFT_GRAPH_BASE_URL: "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft",
    }),
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });

  await withMockProviderFetch(app, async () => {
    const inviteResponse = await app.request("/onboarding/invites", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        fullName: "Jordan S",
        role: "Owner",
      }),
    });
    assert.equal(inviteResponse.status, 201);
    const inviteBody = (await inviteResponse.json()) as {
      invite: { code: string };
    };

    const startResponse = await app.request("/onboarding/sessions/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inviteCode: inviteBody.invite.code,
        consentAccepted: true,
        cloneConsentAccepted: true,
      }),
    });
    assert.equal(startResponse.status, 201);
    const onboardingCookie = startResponse.headers.get("set-cookie");
    const startBody = (await startResponse.json()) as {
      session: { id: string; voiceSession?: { mode: string; websocketUrl?: string } };
    };
    assert.equal(startBody.session.voiceSession?.mode, "configured");
    assert.match(startBody.session.voiceSession?.websocketUrl ?? "", /^wss:\/\/mock\.elevenlabs\.local\/convai\/agent_mock_123\?/);

    const calendarStartResponse = await app.request(`/onboarding/sessions/${startBody.session.id}/calendar/microsoft/start`, {
      headers: {
        Cookie: onboardingCookie ?? "",
      },
    });
    assert.equal(calendarStartResponse.status, 200);
    const calendarStartBody = (await calendarStartResponse.json()) as {
      calendar: { authUrl?: string };
    };
    assert.match(calendarStartBody.calendar.authUrl ?? "", /\/mock\/providers\/microsoft\/authorize/);

    const authorizeUrl = new URL(calendarStartBody.calendar.authUrl ?? "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft/authorize");
    const authorizeResponse = await app.request(`${authorizeUrl.pathname}${authorizeUrl.search}`);
    assert.equal(authorizeResponse.status, 302);
    const callbackLocation = authorizeResponse.headers.get("location");
    assert.ok(callbackLocation);

    const callbackUrl = new URL(callbackLocation ?? "https://curve-ai-api-staging.workers.dev/onboarding/calendar/microsoft/callback");
    const callbackResponse = await app.request(`${callbackUrl.pathname}${callbackUrl.search}`);
    assert.equal(callbackResponse.status, 302);

    const sessionResponse = await app.request(`/onboarding/sessions/${startBody.session.id}`, {
      headers: {
        Cookie: onboardingCookie ?? "",
      },
    });
    assert.equal(sessionResponse.status, 200);
    const sessionBody = (await sessionResponse.json()) as {
      session: {
        calendar?: { mode: string; status: string; accountEmail?: string; calendarLabel?: string };
      };
    };
    assert.equal(sessionBody.session.calendar?.mode, "configured");
    assert.equal(sessionBody.session.calendar?.status, "connected");
    assert.equal(sessionBody.session.calendar?.accountEmail, "jordan.s@example.com");
    assert.equal(sessionBody.session.calendar?.calendarLabel, "Jordan S Calendar");
  });
});

test("configured mock provider endpoints exercise appointment booking and photo-link SMS delivery", async () => {
  const app = createApp({
    env: baseEnv({
      MICROSOFT_CLIENT_ID: "mock-client-id",
      MICROSOFT_CLIENT_SECRET: "mock-client-secret",
      MICROSOFT_REDIRECT_URI: "https://curve-ai-api-staging.workers.dev/onboarding/calendar/microsoft/callback",
      MICROSOFT_AUTH_BASE_URL: "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft",
      MICROSOFT_GRAPH_BASE_URL: "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft",
      TWILIO_ACCOUNT_SID: "AC123456789",
      TWILIO_AUTH_TOKEN: "twilio-auth-token",
      TWILIO_FROM_NUMBER: "+61400000000",
      TWILIO_BASE_URL: "https://curve-ai-api-staging.workers.dev/mock/providers/twilio",
    }),
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });

  await withMockProviderFetch(app, async () => {
    const staff = await createStaffSession(app, {
      fullName: "Jordan Tradie",
      email: "jordan@example.com",
      phoneNumber: "+61422222222",
      role: "Owner",
      timezone: "Australia/Sydney",
    });

    const calendarStartResponse = await app.request(`/staff/calendar/microsoft/start?staffId=${staff.staffId}`, {
      headers: {
        Cookie: staff.sessionCookie,
      },
    });
    assert.equal(calendarStartResponse.status, 302);
    const authLocation = calendarStartResponse.headers.get("location");
    assert.match(authLocation ?? "", /\/mock\/providers\/microsoft\/authorize/);

    const authUrl = new URL(authLocation ?? "https://curve-ai-api-staging.workers.dev/mock/providers/microsoft/authorize");
    const authorizeResponse = await app.request(`${authUrl.pathname}${authUrl.search}`, {
      headers: {
        Cookie: staff.sessionCookie,
      },
    });
    assert.equal(authorizeResponse.status, 302);
    const callbackLocation = authorizeResponse.headers.get("location");
    assert.match(callbackLocation ?? "", /\/staff\/calendar\/microsoft\/callback/);

    const callbackUrl = new URL(callbackLocation ?? "https://curve-ai-api-staging.workers.dev/staff/calendar/microsoft/callback");
    const callbackResponse = await app.request(`${callbackUrl.pathname}${callbackUrl.search}`, {
      headers: {
        Cookie: staff.sessionCookie,
      },
    });
    assert.equal(callbackResponse.status, 302);

    const statusResponse = await app.request(`/staff/calendar/status?staffId=${staff.staffId}`, {
      headers: {
        Cookie: staff.sessionCookie,
      },
    });
    assert.equal(statusResponse.status, 200);
    const statusBody = (await statusResponse.json()) as {
      calendarConnection?: { status?: string; accountEmail?: string };
    };
    assert.equal(statusBody.calendarConnection?.status, "connected");
    assert.equal(statusBody.calendarConnection?.accountEmail, "jordan.tradie@example.com");

    const appointmentBody = {
      staffId: staff.staffId,
      callerPhone: "+61411111111",
      notes: "Customer asked for a site visit tomorrow morning.",
      startAt: "2026-04-17T09:00:00",
      endAt: "2026-04-17T10:00:00",
      timezone: "Australia/Sydney",
      location: "14 Clarence Street, Marrickville",
    };
    const appointmentResponse = await app.request("/voice/tools/appointment", {
      method: "POST",
      headers: await automationHeaders("automation-secret", "/voice/tools/appointment", appointmentBody),
      body: JSON.stringify(appointmentBody),
    });
    assert.equal(appointmentResponse.status, 200);
    const appointmentPayload = (await appointmentResponse.json()) as {
      appointment: { status: string; outlookEventId?: string };
      calendarSync?: { mode: string; status: string; eventId?: string };
    };
    assert.equal(appointmentPayload.appointment.status, "booked");
    assert.equal(appointmentPayload.calendarSync?.mode, "configured");
    assert.equal(appointmentPayload.calendarSync?.status, "booked");
    assert.ok(appointmentPayload.calendarSync?.eventId);
    assert.equal(appointmentPayload.appointment.outlookEventId, appointmentPayload.calendarSync?.eventId);

    const photoLinkBody = {
      staffId: staff.staffId,
      callerPhone: "+61411111111",
      notes: "Please send a wide shot of the meter box and a close-up of the fault.",
    };
    const photoLinkResponse = await app.request("/voice/tools/send-photo-link", {
      method: "POST",
      headers: await automationHeaders("automation-secret", "/voice/tools/send-photo-link", photoLinkBody),
      body: JSON.stringify(photoLinkBody),
    });
    assert.equal(photoLinkResponse.status, 200);
    const photoLinkPayload = (await photoLinkResponse.json()) as {
      uploadRequest: { uploadLink: string };
      delivery: { provider: string; mode: string; status: string; messageId?: string; to?: string };
    };
    assert.match(photoLinkPayload.uploadRequest.uploadLink, /^https:\/\/curve-ai-upload\.pages\.dev\/upload\//);
    assert.equal(photoLinkPayload.delivery.provider, "twilio-sms");
    assert.equal(photoLinkPayload.delivery.mode, "configured");
    assert.equal(photoLinkPayload.delivery.status, "queued");
    assert.ok(photoLinkPayload.delivery.messageId);
    assert.equal(photoLinkPayload.delivery.to, "+61411111111");
  });
});

test("health reports worker runtime and provider modes", async () => {
  const app = createTestApp();

  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id") ?? "", /^req_/);
  const body = (await response.json()) as {
    ok: boolean;
    ready: boolean;
    runtime: string;
    realtimeVoice: string;
    reasoning: string;
    calendar: string;
    messaging: string;
    blockingIssues: string[];
    advisoryIssues: string[];
  };
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.equal(body.runtime, "cloudflare-worker");
  assert.equal(body.realtimeVoice, "mock");
  assert.equal(body.reasoning, "mock");
  assert.equal(body.calendar, "mock");
  assert.equal(body.messaging, "mock");
  assert.deepEqual(body.blockingIssues, []);
  assert.deepEqual(body.advisoryIssues, []);
});

test("public health omits provider modes and warning details", async () => {
  const app = createTestApp();

  const response = await app.request("https://curve-ai-api-staging.workers.dev/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.equal(body.runtime, "cloudflare-worker");
  assert.equal("realtimeVoice" in body, false);
  assert.equal("reasoning" in body, false);
  assert.equal("calendar" in body, false);
  assert.equal("blockingIssues" in body, false);
  assert.equal("advisoryIssues" in body, false);
});

test("config resolves openai-compatible reasoning from OPENAI_API_KEY without duplicating REASONING_API_KEY", () => {
  const config = getConfig(
    baseEnv({
      OPENAI_API_KEY: "openai-secret",
      REASONING_PROVIDER: "openai-compatible",
    }),
  );

  assert.equal(config.reasoningMode, "openai-compatible");
});

test("health surfaces advisory provider issues without failing readiness", async () => {
  const app = createApp({
    env: baseEnv({
      ELEVENLABS_API_KEY: "elevenlabs-secret",
      REASONING_PROVIDER: "openai-compatible",
      MICROSOFT_CLIENT_ID: "client-only",
    }),
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });

  const response = await app.request("/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    ready: boolean;
    advisoryIssues: string[];
    blockingIssues: string[];
  };
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.deepEqual(body.blockingIssues, []);
  assert.ok(body.advisoryIssues.some((issue) => issue.includes("ELEVENLABS_AGENT_ID")));
  assert.ok(body.advisoryIssues.some((issue) => issue.includes("REASONING_PROVIDER")));
  assert.ok(body.advisoryIssues.some((issue) => issue.includes("Microsoft calendar credentials")));
});

test("worker responses include a request id and emit structured completion logs", async () => {
  const app = createTestApp();
  const originalInfo = console.info;
  const lines: string[] = [];
  console.info = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    const response = await app.request("/dashboard", {
      headers: {
        Authorization: "Bearer admin-secret",
      },
    });

    assert.equal(response.status, 200);
    const requestId = response.headers.get("x-request-id") ?? "";
    assert.match(requestId, /^req_/);

    const completionLog = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.event === "request.completed" && entry.path === "/dashboard");
    assert.ok(completionLog);
    assert.equal(completionLog?.requestId, requestId);
    assert.equal(completionLog?.status, 200);
    assert.equal(completionLog?.routeFamily, "ops");
    assert.equal(completionLog?.authKind, "admin");
  } finally {
    console.info = originalInfo;
  }
});

test("request logs redact bearer-like path segments", async () => {
  const app = createTestApp();
  const originalWarn = console.warn;
  const lines: string[] = [];
  console.warn = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    const response = await app.request("https://curve-ai-api-staging.workers.dev/uploads/upload_secret_token");
    assert.equal(response.status, 404);

    const completionLog = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.event === "request.completed" && entry.routeFamily === "upload");
    assert.ok(completionLog);
    assert.equal(completionLog?.path, "/uploads/[token]");
  } finally {
    console.warn = originalWarn;
  }
});

test("non-local requests fail fast when worker config is incomplete", async () => {
  const app = createApp({
    env: {
      ADMIN_TOKEN: "admin-secret",
    },
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });

  const response = await app.request("https://curve-ai-api-staging.workers.dev/dashboard", {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });

  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    error: {
      details?: {
        issues?: string[];
      };
    };
  };
  assert.ok(body.error.details?.issues?.some((issue) => issue.includes("PUBLIC_API_URL")));
});

test("public non-local requests do not receive detailed config warnings", async () => {
  const app = createApp({
    env: {
      ADMIN_TOKEN: "admin-secret",
    },
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });

  const response = await app.request("https://curve-ai-api-staging.workers.dev/dashboard");
  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    error: {
      details?: {
        issues?: string[];
      };
    };
  };
  assert.equal(body.error.details, undefined);
});

test("public upload errors stay correlation-friendly without leaking token details", async () => {
  const app = createTestApp();

  const response = await app.request("https://curve-ai-api-staging.workers.dev/uploads/upload_secret_token");
  assert.equal(response.status, 404);
  assert.match(response.headers.get("x-request-id") ?? "", /^req_/);

  const body = (await response.json()) as {
    error: {
      requestId?: string;
      details?: Record<string, unknown>;
    };
  };
  assert.equal(body.error.details, undefined);
  assert.equal(body.error.requestId, response.headers.get("x-request-id") ?? undefined);
});

test("cookie-authenticated staff routes reject non-local requests without an origin", async () => {
  const app = createTestApp();
  const staffSession = await createStaffSession(app, {
    fullName: "Jordan S",
    email: "jordan@example.com",
  });

  const response = await app.request("https://curve-ai-api-staging.workers.dev/staff/me", {
    headers: {
      Cookie: staffSession.sessionCookie,
    },
  });
  assert.equal(response.status, 403);
});

test("mock provider routes are not exposed on non-local requests", async () => {
  const app = createTestApp();

  const response = await app.request("https://curve-ai-api-staging.workers.dev/mock/providers/microsoft/authorize?redirect_uri=https://curve-ai-api-staging.workers.dev/onboarding/calendar/microsoft/callback&state=test");
  assert.equal(response.status, 404);
});

test("worker blocks realtime session issuance without both consents", async () => {
  const repo = new InMemoryOnboardingRepository();
  const app = createApp({
    env: baseEnv(),
    repo,
    objectStore: new InMemoryObjectStore(),
  });

  const inviteResponse = await app.request("/onboarding/invites", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: "Casey Tradie",
    }),
  });
  const inviteBody = (await inviteResponse.json()) as { invite: { code: string } };
  const startResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
      consentAccepted: true,
      cloneConsentAccepted: false,
    }),
  });
  assert.equal(startResponse.status, 400);
});

test("worker fails fast when Cloudflare bindings are missing", () => {
  assert.throws(() => createApp({ env: { ADMIN_TOKEN: "admin-secret" } }), /Cloudflare D1 binding `DB` is required/);
});

test("staff invite only returns raw OTPs when explicitly enabled", async () => {
  const app = createApp({
    env: baseEnv({ ALLOW_INSECURE_TEST_OTP: "false" }),
    repo: new InMemoryOnboardingRepository(),
    objectStore: new InMemoryObjectStore(),
  });

  const response = await app.request("/staff/invite", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: "Secure Staff",
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    otpCode?: string;
    note?: string;
  };
  assert.equal(body.otpCode, undefined);
  assert.equal(body.note, undefined);
});

test("customer upload flow stays on Cloudflare routes and produces protected photo assets", async () => {
  const app = createTestApp();
  const photoLinkHeaders = await automationHeaders("automation-secret", "/voice/tools/send-photo-link", {
    callerPhone: "+61400000000",
    notes: "Send photos of the unit and pressure valve.",
  });

  const linkResponse = await app.request("/voice/tools/send-photo-link", {
    method: "POST",
    headers: photoLinkHeaders,
    body: JSON.stringify({
      callerPhone: "+61400000000",
      notes: "Send photos of the unit and pressure valve.",
    }),
  });
  assert.equal(linkResponse.status, 200);
  const linkBody = (await linkResponse.json()) as {
    uploadRequest: { token: string; uploadLink: string; jobId: string };
  };
  assert.match(linkBody.uploadRequest.uploadLink, /^https:\/\/curve-ai-upload\.pages\.dev\/upload\//);

  const uploadForm = new FormData();
  uploadForm.append(
    "photos",
    new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])], "water-heater.jpg", {
      type: "image/jpeg",
    }),
  );
  const uploadResponse = await app.request(`/uploads/${linkBody.uploadRequest.token}/photos`, {
    method: "POST",
    body: uploadForm,
  });
  assert.equal(uploadResponse.status, 200);
  const uploadBody = (await uploadResponse.json()) as {
    upload: {
      status: string;
      fileCount: number;
      requestedBy?: string;
      businessName?: string;
      jobSummary?: string;
      requestNote?: string;
    };
  };
  assert.equal(uploadBody.upload.status, "completed");
  assert.equal(uploadBody.upload.fileCount, 1);
  assert.equal(uploadBody.upload.jobSummary, undefined);
  assert.equal(uploadBody.upload.requestNote, "Send photos of the unit and pressure valve.");

  const uploadStatusResponse = await app.request(`/uploads/${linkBody.uploadRequest.token}`);
  assert.equal(uploadStatusResponse.status, 200);
  const uploadStatusBody = (await uploadStatusResponse.json()) as {
    upload: Record<string, unknown>;
  };
  assert.equal(uploadStatusBody.upload.fileCount, 1);
  assert.equal(uploadStatusBody.upload.jobSummary, undefined);
  assert.equal(
    uploadStatusBody.upload.requestNote,
    "Send photos of the unit and pressure valve.",
  );
  assert.equal("jobId" in uploadStatusBody.upload, false);
  assert.equal("staffId" in uploadStatusBody.upload, false);
  assert.equal("callerPhone" in uploadStatusBody.upload, false);
  assert.equal("uploadLink" in uploadStatusBody.upload, false);

  const dashboardResponse = await app.request("/dashboard", {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = (await dashboardResponse.json()) as {
    jobs: Array<{ id: string; photos: Array<{ id: string; url: string }> }>;
  };
  assert.equal(dashboard.jobs.length, 1);
  assert.equal(dashboard.jobs[0]?.photos.length, 1);
  assert.equal("url" in (dashboard.jobs[0]?.photos[0] ?? {}), false);

  const photoId = dashboard.jobs[0]?.photos[0]?.id;
  assert.ok(photoId);

  const anonymousPhotoResponse = await app.request(`/assets/photos/${photoId}`);
  assert.equal(anonymousPhotoResponse.status, 401);

  const photoResponse = await app.request(`/assets/photos/${photoId}`, {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });
  assert.equal(photoResponse.status, 200);
  assert.equal(photoResponse.headers.get("content-type"), "image/jpeg");
  assert.equal(photoResponse.headers.get("x-content-type-options"), "nosniff");
});

test("customer profiles link repeat callers across jobs, calls, and uploads", async () => {
  const app = createTestApp();
  const staff = await createStaffSession(app, {
    fullName: "Jordan Tradie",
    email: "jordan@example.com",
    phoneNumber: "+61422222222",
    role: "Owner",
    timezone: "Australia/Sydney",
  });

  const firstContextBody = {
    staffId: staff.staffId,
    callerPhone: "0400 000 111",
    callerName: "Mia",
    address: "14 Clarence Street",
    suburb: "Marrickville",
    issue: "Blocked stormwater drain",
  };
  const firstContextResponse = await app.request("/voice/context", {
    method: "POST",
    headers: await automationHeaders("automation-secret", "/voice/context", firstContextBody),
    body: JSON.stringify(firstContextBody),
  });
  assert.equal(firstContextResponse.status, 200);
  const firstContext = (await firstContextResponse.json()) as {
    job: { id: string; callerId?: string };
    customer?: { id: string; totalJobs: number };
  };
  assert.ok(firstContext.job.id);
  assert.ok(firstContext.customer?.id);
  assert.equal(firstContext.customer?.totalJobs, 1);

  const secondContextBody = {
    staffId: staff.staffId,
    callerPhone: "+61400000111",
    callerName: "Mia T",
    address: "14 Clarence Street",
    suburb: "Marrickville",
    issue: "Leaking hot water unit",
  };
  const secondContextResponse = await app.request("/voice/context", {
    method: "POST",
    headers: await automationHeaders("automation-secret", "/voice/context", secondContextBody),
    body: JSON.stringify(secondContextBody),
  });
  assert.equal(secondContextResponse.status, 200);
  const secondContext = (await secondContextResponse.json()) as {
    job: { id: string };
    customer?: { id: string; totalJobs: number };
  };
  assert.equal(secondContext.customer?.id, firstContext.customer?.id);
  assert.equal(secondContext.customer?.totalJobs, 2);

  const postCallBody = {
    callId: "call_customer_history",
    jobId: secondContext.job.id,
    staffId: staff.staffId,
    callerPhone: "+61400000111",
    summary: "Caller wants a same-day inspection after sending photos.",
    status: "completed" as const,
    direction: "inbound" as const,
  };
  const postCallResponse = await app.request("/voice/post-call", {
    method: "POST",
    headers: await automationHeaders("automation-secret", "/voice/post-call", postCallBody),
    body: JSON.stringify(postCallBody),
  });
  assert.equal(postCallResponse.status, 201);

  const photoLinkBody = {
    jobId: firstContext.job.id,
    staffId: staff.staffId,
    callerPhone: "+61400000111",
    notes: "Send wider shots of the drain and close-ups of the outlet.",
  };
  const photoLinkResponse = await app.request("/voice/tools/send-photo-link", {
    method: "POST",
    headers: await automationHeaders("automation-secret", "/voice/tools/send-photo-link", photoLinkBody),
    body: JSON.stringify(photoLinkBody),
  });
  assert.equal(photoLinkResponse.status, 200);
  const photoLink = (await photoLinkResponse.json()) as {
    uploadRequest: { token: string };
  };

  const uploadForm = new FormData();
  uploadForm.append(
    "photos",
    new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])], "drain.jpg", {
      type: "image/jpeg",
    }),
  );
  const uploadResponse = await app.request(`/uploads/${photoLink.uploadRequest.token}/photos`, {
    method: "POST",
    body: uploadForm,
  });
  assert.equal(uploadResponse.status, 200);

  const firstCardResponse = await app.request(`/jobs/${firstContext.job.id}/card`, {
    headers: {
      Cookie: staff.sessionCookie,
    },
  });
  assert.equal(firstCardResponse.status, 200);
  const firstCard = (await firstCardResponse.json()) as {
    card: {
      customer?: {
        id: string;
        displayName?: string;
        totalJobs: number;
        totalCalls: number;
        totalUploads: number;
        totalPhotos: number;
        knownStaffIds: string[];
        recentJobs: Array<{ jobId: string }>;
      };
    };
  };
  assert.equal(firstCard.card.customer?.id, firstContext.customer?.id);
  assert.equal(firstCard.card.customer?.displayName, "Mia T");
  assert.equal(firstCard.card.customer?.totalJobs, 2);
  assert.equal(firstCard.card.customer?.totalCalls, 1);
  assert.equal(firstCard.card.customer?.totalUploads, 1);
  assert.equal(firstCard.card.customer?.totalPhotos, 1);
  assert.deepEqual(firstCard.card.customer?.knownStaffIds, [staff.staffId]);
  assert.equal(firstCard.card.customer?.recentJobs.length, 2);

  const customerResponse = await app.request(`/customers/${firstContext.customer?.id}`, {
    headers: {
      Cookie: staff.sessionCookie,
    },
  });
  assert.equal(customerResponse.status, 200);
  const customerBody = (await customerResponse.json()) as {
    customer: {
      id: string;
      totalJobs: number;
      totalCalls: number;
      totalUploads: number;
      totalPhotos: number;
      recentJobs: Array<{ jobId: string }>;
    };
  };
  assert.equal(customerBody.customer.id, firstContext.customer?.id);
  assert.equal(customerBody.customer.totalJobs, 2);
  assert.equal(customerBody.customer.totalCalls, 1);
  assert.equal(customerBody.customer.totalUploads, 1);
  assert.equal(customerBody.customer.totalPhotos, 1);
  assert.equal(customerBody.customer.recentJobs.length, 2);
});

test("protected photo assets only load for the assigned staff session or admin", async () => {
  const app = createTestApp();
  const owner = await createStaffSession(app, {
    fullName: "Owner Staff",
    email: "owner@example.com",
    phoneNumber: "+61410000001",
    role: "Lead tradie",
    timezone: "Australia/Sydney",
  });
  const other = await createStaffSession(app, {
    fullName: "Other Staff",
    email: "other@example.com",
    phoneNumber: "+61410000002",
    role: "Tradie",
    timezone: "Australia/Sydney",
  });

  const photoLinkHeaders = await automationHeaders("automation-secret", "/voice/tools/send-photo-link", {
    callerPhone: "+61400000000",
    staffId: owner.staffId,
    notes: "Send boiler photos.",
  });

  const linkResponse = await app.request("/voice/tools/send-photo-link", {
    method: "POST",
    headers: photoLinkHeaders,
    body: JSON.stringify({
      callerPhone: "+61400000000",
      staffId: owner.staffId,
      notes: "Send boiler photos.",
    }),
  });
  assert.equal(linkResponse.status, 200);
  const linkBody = (await linkResponse.json()) as {
    uploadRequest: { token: string };
  };

  const uploadForm = new FormData();
  uploadForm.append(
    "photos",
    new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])], "boiler.jpg", {
      type: "image/jpeg",
    }),
  );
  const uploadResponse = await app.request(`/uploads/${linkBody.uploadRequest.token}/photos`, {
    method: "POST",
    body: uploadForm,
  });
  assert.equal(uploadResponse.status, 200);

  const jobsResponse = await app.request("/jobs", {
    headers: {
      Cookie: owner.sessionCookie,
    },
  });
  assert.equal(jobsResponse.status, 200);
  const jobsBody = (await jobsResponse.json()) as {
    jobs: Array<{ id: string }>;
  };
  const jobId = jobsBody.jobs[0]?.id;
  assert.ok(jobId);

  const cardResponse = await app.request(`/jobs/${jobId}/card`, {
    headers: {
      Cookie: owner.sessionCookie,
    },
  });
  assert.equal(cardResponse.status, 200);
  const cardBody = (await cardResponse.json()) as {
    card: { photos: Array<{ id: string }> };
  };
  const photoId = cardBody.card.photos[0]?.id;
  assert.ok(photoId);

  const ownerPhotoResponse = await app.request(`/assets/photos/${photoId}`, {
    headers: {
      Cookie: owner.sessionCookie,
    },
  });
  assert.equal(ownerPhotoResponse.status, 200);

  const otherPhotoResponse = await app.request(`/assets/photos/${photoId}`, {
    headers: {
      Cookie: other.sessionCookie,
    },
  });
  assert.equal(otherPhotoResponse.status, 403);
});

test("voice post-call writes call records into the Worker CRM store", async () => {
  const app = createTestApp();
  const headers = await automationHeaders("automation-secret", "/voice/post-call", {
    callId: "call_123",
    staffId: "staff_123",
    callerPhone: "+61411111111",
    summary: "Customer requested an urgent callback.",
    status: "callback_requested",
    direction: "inbound",
  });

  const response = await app.request("/voice/post-call", {
    method: "POST",
    headers,
    body: JSON.stringify({
      callId: "call_123",
      staffId: "staff_123",
      callerPhone: "+61411111111",
      summary: "Customer requested an urgent callback.",
      status: "callback_requested",
      direction: "inbound",
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    call: { id: string; jobId?: string; status: string };
    job?: { id: string; status: string };
  };
  assert.equal(body.call.id, "call_123");
  assert.equal(body.call.status, "callback_requested");
  assert.ok(body.job?.id);

  const jobCardResponse = await app.request(`/jobs/${body.job?.id}/card`, {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });
  assert.equal(jobCardResponse.status, 200);
  const jobCard = (await jobCardResponse.json()) as {
    card: { calls: Array<{ id: string; status: string }> };
  };
  assert.equal(jobCard.card.calls.length, 1);
  assert.equal(jobCard.card.calls[0]?.id, "call_123");
});

test("voice post-call rejects replayed signed requests", async () => {
  const app = createTestApp();
  const body = {
    callId: "call_replay",
    staffId: "staff_123",
    callerPhone: "+61411111111",
    summary: "Customer requested an urgent callback.",
    status: "callback_requested",
    direction: "inbound",
  };
  const headers = await automationHeaders("automation-secret", "/voice/post-call", body);

  const firstResponse = await app.request("/voice/post-call", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(firstResponse.status, 201);

  const secondResponse = await app.request("/voice/post-call", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(secondResponse.status, 409);
});

test("voice context rejects replayed signed requests", async () => {
  const app = createTestApp();
  const body = {
    staffId: "staff_123",
    callerPhone: "+61433333333",
    callerName: "Mia",
    address: "14 Clarence Street",
    suburb: "Marrickville",
    issue: "Blocked stormwater drain",
  };
  const headers = await automationHeaders("automation-secret", "/voice/context", body);

  const firstResponse = await app.request("/voice/context", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(firstResponse.status, 200);

  const secondResponse = await app.request("/voice/context", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(secondResponse.status, 409);
});

test("voice signatures are bound to the route path", async () => {
  const app = createTestApp();
  const body = {
    staffId: "staff_123",
    callerPhone: "+61433333333",
    address: "14 Clarence Street",
    suburb: "Marrickville",
  };
  const headers = await automationHeaders("automation-secret", "/voice/context", body);

  const response = await app.request("/voice/tools/quote", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 401);
});

test("voice post-call rejects malformed JSON with a clean 400", async () => {
  const app = createTestApp();
  const rawBody = "{\"callId\":";
  const headers = await automationHeadersForRawBody("automation-secret", "/voice/post-call", rawBody);

  const response = await app.request("/voice/post-call", {
    method: "POST",
    headers,
    body: rawBody,
  });

  assert.equal(response.status, 400);
});

test("expired upload tokens are rejected on both read and write routes", async () => {
  const repo = new InMemoryOnboardingRepository();
  const expiredRequest = await repo.createUploadRequest({
    token: "expired-token",
    jobId: "job_expired",
    uploadLink: "https://curve-ai-upload.pages.dev/upload/expired-token",
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  await repo.completeUploadRequest(expiredRequest.token, []);
  const app = createApp({
    env: baseEnv(),
    repo,
    objectStore: new InMemoryObjectStore(),
  });

  const getResponse = await app.request(`/uploads/${expiredRequest.token}`);
  assert.equal(getResponse.status, 410);

  const postResponse = await app.request(`/uploads/${expiredRequest.token}/photos`, {
    method: "POST",
    body: new FormData(),
  });
  assert.equal(postResponse.status, 410);
});

test("upload routes reject disguised non-image payloads", async () => {
  const app = createTestApp();
  const photoLinkHeaders = await automationHeaders("automation-secret", "/voice/tools/send-photo-link", {
    callerPhone: "+61400000000",
    notes: "Upload site photos only.",
  });

  const linkResponse = await app.request("/voice/tools/send-photo-link", {
    method: "POST",
    headers: photoLinkHeaders,
    body: JSON.stringify({
      callerPhone: "+61400000000",
      notes: "Upload site photos only.",
    }),
  });
  assert.equal(linkResponse.status, 200);
  const linkBody = (await linkResponse.json()) as {
    uploadRequest: { token: string };
  };

  const uploadForm = new FormData();
  uploadForm.append("photos", new File(["<html>not an image</html>"], "evil.jpg", { type: "text/html" }));
  const uploadResponse = await app.request(`/uploads/${linkBody.uploadRequest.token}/photos`, {
    method: "POST",
    body: uploadForm,
  });

  assert.equal(uploadResponse.status, 400);
});

test("staff invite verification and staff-scoped job access work on the Worker", async () => {
  const app = createTestApp();

  const inviteResponse = await app.request("/staff/invite", {
    method: "POST",
    headers: {
      Authorization: "Bearer admin-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fullName: "Jordan Tradie",
      email: "jordan@example.com",
      phoneNumber: "+61422222222",
      role: "Owner",
      timezone: "Australia/Sydney",
    }),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as {
    staff: { id: string; fullName: string };
    inviteCode: string;
    otpCode: string;
  };
  assert.ok(inviteBody.inviteCode.length >= 16);
  assert.equal(inviteBody.staff.fullName, "Jordan Tradie");

  const verifyResponse = await app.request("/staff/verify-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      staffId: inviteBody.staff.id,
      inviteToken: inviteBody.inviteCode,
      otpCode: inviteBody.otpCode,
    }),
  });
  assert.equal(verifyResponse.status, 200);
  const staffCookie = verifyResponse.headers.get("set-cookie");
  assert.match(staffCookie ?? "", /curve_staff_session=/);
  const verifyBody = (await verifyResponse.json()) as {
    staff: { id: string; otpVerifiedAt?: string };
    session: { expiresAt: string };
  };
  assert.equal(verifyBody.staff.id, inviteBody.staff.id);
  assert.ok(verifyBody.staff.otpVerifiedAt);
  assert.equal("token" in verifyBody.session, false);

  const meResponse = await app.request("/staff/me", {
    headers: {
      Cookie: staffCookie ?? "",
    },
  });
  assert.equal(meResponse.status, 200);
  const meBody = (await meResponse.json()) as {
    staff: { id: string; voiceConsentStatus: string };
  };
  assert.equal(meBody.staff.id, inviteBody.staff.id);
  assert.equal(meBody.staff.voiceConsentStatus, "pending");

  const calendarResponse = await app.request("/staff/calendar/connect", {
    method: "POST",
    headers: {
      Cookie: staffCookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      staffId: inviteBody.staff.id,
      provider: "outlook",
      accountEmail: "jordan@example.com",
      calendarId: "Jordan - TradieAI",
      timezone: "Australia/Sydney",
    }),
  });
  assert.equal(calendarResponse.status, 200);
  const calendarBody = (await calendarResponse.json()) as {
    calendarConnection: { status?: string; authState?: string; accessToken?: string; refreshToken?: string };
  };
  assert.equal(calendarBody.calendarConnection.status, "connected");
  assert.equal(calendarBody.calendarConnection.authState, undefined);
  assert.equal(calendarBody.calendarConnection.accessToken, undefined);
  assert.equal(calendarBody.calendarConnection.refreshToken, undefined);

  const consentResponse = await app.request("/staff/voice-consent", {
    method: "POST",
    headers: {
      Cookie: staffCookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      staffId: inviteBody.staff.id,
      consent: true,
      signedBy: "Jordan Tradie",
      capturedAt: "2026-04-15T00:00:00.000Z",
    }),
  });
  assert.equal(consentResponse.status, 200);

  const pricingResponse = await app.request("/staff/pricing-interview", {
    method: "POST",
    headers: {
      Cookie: staffCookie ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      staffId: inviteBody.staff.id,
      responses: {
        baseCalloutFee: 220,
        hourlyRate: 165,
      },
    }),
  });
  assert.equal(pricingResponse.status, 200);

  const contextHeaders = await automationHeaders("automation-secret", "/voice/context", {
    staffId: inviteBody.staff.id,
    callerPhone: "+61433333333",
    callerName: "Mia",
    address: "14 Clarence Street",
    suburb: "Marrickville",
    issue: "Blocked stormwater drain",
  });
  const contextResponse = await app.request("/voice/context", {
    method: "POST",
    headers: contextHeaders,
    body: JSON.stringify({
      staffId: inviteBody.staff.id,
      callerPhone: "+61433333333",
      callerName: "Mia",
      address: "14 Clarence Street",
      suburb: "Marrickville",
      issue: "Blocked stormwater drain",
    }),
  });
  assert.equal(contextResponse.status, 200);
  const contextBody = (await contextResponse.json()) as {
    job: { id: string };
  };

  const jobsResponse = await app.request("/jobs", {
    headers: {
      Cookie: staffCookie ?? "",
    },
  });
  assert.equal(jobsResponse.status, 200);
  const jobsBody = (await jobsResponse.json()) as {
    jobs: Array<{ id: string }>;
  };
  assert.equal(jobsBody.jobs.length, 1);
  assert.equal(jobsBody.jobs[0]?.id, contextBody.job.id);

  const jobCardResponse = await app.request(`/jobs/${contextBody.job.id}/card`, {
    headers: {
      Cookie: staffCookie ?? "",
    },
  });
  assert.equal(jobCardResponse.status, 200);

  const forbiddenJobsResponse = await app.request(`/jobs?staffId=staff_other`, {
    headers: {
      Cookie: staffCookie ?? "",
    },
  });
  assert.equal(forbiddenJobsResponse.status, 403);

  const signOutResponse = await app.request("/staff/sign-out", {
    method: "POST",
    headers: {
      Cookie: staffCookie ?? "",
    },
  });
  assert.equal(signOutResponse.status, 200);
  assert.match(signOutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const revokedMeResponse = await app.request("/staff/me", {
    headers: {
      Cookie: staffCookie ?? "",
    },
  });
  assert.equal(revokedMeResponse.status, 401);
});

test("staff OTP verification rejects non-numeric codes", async () => {
  const app = createTestApp();

  const response = await app.request("/staff/verify-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteToken: "a".repeat(32),
      otpCode: "12ab",
    }),
  });

  assert.equal(response.status, 400);
});

test("staff session routes reject requests from the public onboarding origin", async () => {
  const app = createTestApp();
  const staff = await createStaffSession(app, {
    fullName: "Jordan Tradie",
    email: "jordan@example.com",
    phoneNumber: "+61422222222",
    role: "Owner",
    timezone: "Australia/Sydney",
  });

  const response = await app.request("/staff/me", {
    headers: {
      Cookie: staff.sessionCookie,
      Origin: "https://curve-ai-onboarding.pages.dev",
    },
  });

  assert.equal(response.status, 403);
});

test("local onboarding preview origins are allowed against the local worker", async () => {
  const app = createTestApp({
    PUBLIC_API_URL: "http://127.0.0.1:8790",
    PUBLIC_ONBOARDING_APP_URL: "http://127.0.0.1:4394",
    PUBLIC_STAFF_APP_URL: "http://127.0.0.1:4395",
    PUBLIC_OPS_APP_URL: "http://127.0.0.1:4396",
    PUBLIC_UPLOAD_APP_URL: "http://127.0.0.1:4397",
    ALLOWED_ORIGINS: "http://127.0.0.1:4394",
  });

  const inviteResponse = await app.request("/onboarding/invites", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      fullName: "Jordan Tradie",
      email: "jordan@example.com",
    }),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as {
    invite: { code: string };
  };

  const response = await app.request(`/onboarding/invites/${inviteBody.invite.code}/session`, {
    headers: {
      Origin: "http://127.0.0.1:4394",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4394");
});

test("hosted reasoning payload strips onboarding secrets before egress", async () => {
  const originalFetch = globalThis.fetch;
  const fallback = new HeuristicReasoningProvider();
  const expected = await fallback.analyzeSession(
    {
      id: "sess_1",
      inviteId: "invite_1",
      inviteCode: "invite-code-should-not-leak",
      staffId: "staff_1",
      staffName: "Jordan Tradie",
      participantTokenHash: "hashed-secret-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "interviewing",
      consentAccepted: true,
      cloneConsentAccepted: true,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      analysis: {
        coverage: [],
        recommendedQuestions: [],
        coverageScore: 0.5,
        interviewerBrief: "Keep probing pricing.",
      },
      review: {
        businessSummary: "Summary",
        staffProfile: {
          staffName: "Jordan Tradie",
          companyName: "Jordan Plumbing",
          role: "Owner",
          calendarProvider: "Microsoft",
        },
        communicationProfile: {
          tone: "Professional",
          salesStyle: "Consultative",
          riskTolerance: "Escalate uncertain quotes",
          customerHandlingRules: ["Confirm scope"],
        },
        pricingProfile: {
          quotingStyle: "Fixed when clear",
          calloutPolicy: "Callout fee applies",
          afterHoursPolicy: "After-hours surcharge",
          approvalThreshold: "Over $1,000",
        },
        businessPractices: {
          services: ["Plumbing"],
          serviceAreas: ["Sydney"],
          operatingHours: "24/7",
          exclusions: ["Commercial roofs"],
          escalationRules: ["Escalate gas leaks"],
        },
        crmDiscovery: {
          currentSystem: "ServiceM8",
          syncPreference: "Sync",
          sourceOfTruth: "CRM",
          notes: ["Manual import today"],
        },
        missingFields: [],
      },
      voiceSession: {
        provider: "elevenlabs-browser",
        mode: "configured",
        sessionToken: "voice-secret",
        interviewerModel: "live",
        supervisorModel: "deep",
        websocketUrl: "wss://secret-url",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      calendar: {
        provider: "microsoft",
        mode: "configured",
        status: "pending",
        authUrl: "https://login.example",
        authState: "secret-state",
      },
      voiceSample: {
        sampleLabel: "Voice sample",
        recommendedForClone: true,
        qualityScore: 0.92,
        reasons: ["clean"],
        durationSeconds: 32,
        originalName: "voice.webm",
        storedPath: "uploads/voice-samples/secret",
        mimeType: "audio/webm",
        capturedAt: "2026-04-16T00:00:00.000Z",
      },
    },
    [{ speaker: "participant", text: "We service Sydney." }],
  );

  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify(expected), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const provider = new HttpReasoningProvider({
      baseUrl: "https://reasoning.example.com/analyze",
      apiKey: "reasoning-secret",
      mode: "hosted",
      fallback,
    });
    await provider.analyzeSession(
      {
        id: "sess_1",
        inviteId: "invite_1",
        inviteCode: "invite-code-should-not-leak",
        staffId: "staff_1",
        staffName: "Jordan Tradie",
        participantTokenHash: "hashed-secret-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "interviewing",
        consentAccepted: true,
        cloneConsentAccepted: true,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        analysis: {
          coverage: [],
          recommendedQuestions: [],
          coverageScore: 0.5,
          interviewerBrief: "Keep probing pricing.",
        },
        review: {
          businessSummary: "Summary",
          staffProfile: {
            staffName: "Jordan Tradie",
            companyName: "Jordan Plumbing",
            role: "Owner",
            calendarProvider: "Microsoft",
          },
          communicationProfile: {
            tone: "Professional",
            salesStyle: "Consultative",
            riskTolerance: "Escalate uncertain quotes",
            customerHandlingRules: ["Confirm scope"],
          },
          pricingProfile: {
            quotingStyle: "Fixed when clear",
            calloutPolicy: "Callout fee applies",
            afterHoursPolicy: "After-hours surcharge",
            approvalThreshold: "Over $1,000",
          },
          businessPractices: {
            services: ["Plumbing"],
            serviceAreas: ["Sydney"],
            operatingHours: "24/7",
            exclusions: ["Commercial roofs"],
            escalationRules: ["Escalate gas leaks"],
          },
          crmDiscovery: {
            currentSystem: "ServiceM8",
            syncPreference: "Sync",
            sourceOfTruth: "CRM",
            notes: ["Manual import today"],
          },
          missingFields: [],
        },
        voiceSession: {
          provider: "elevenlabs-browser",
          mode: "configured",
          sessionToken: "voice-secret",
          interviewerModel: "live",
          supervisorModel: "deep",
          websocketUrl: "wss://secret-url",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        calendar: {
          provider: "microsoft",
          mode: "configured",
          status: "pending",
          authUrl: "https://login.example",
          authState: "secret-state",
        },
        voiceSample: {
          sampleLabel: "Voice sample",
          recommendedForClone: true,
          qualityScore: 0.92,
          reasons: ["clean"],
          durationSeconds: 32,
          originalName: "voice.webm",
          storedPath: "uploads/voice-samples/secret",
          mimeType: "audio/webm",
          capturedAt: "2026-04-16T00:00:00.000Z",
        },
      },
      [{ speaker: "participant", text: "We service Sydney." }],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(requestBody);
  const sanitizedSession = requestBody?.session as Record<string, unknown>;
  assert.equal("inviteCode" in sanitizedSession, false);
  assert.equal("participantTokenHash" in sanitizedSession, false);
  assert.equal("voiceSession" in sanitizedSession, false);
  assert.equal((sanitizedSession.calendar as Record<string, unknown>).authState, undefined);
  assert.equal((sanitizedSession.calendar as Record<string, unknown>).authUrl, undefined);
  assert.equal((sanitizedSession.voiceSample as Record<string, unknown>).storedPath, undefined);
});

test("openai-compatible reasoning uses the Responses API structured output contract", async () => {
  const fallback = new HeuristicReasoningProvider();
  let requestBody: Record<string, unknown> | undefined;
  const provider = new HttpReasoningProvider({
    baseUrl: "https://api.openai.com/v1/responses",
    apiKey: "openai-secret",
    model: "gpt-4.1-mini",
    mode: "openai-compatible",
    fallback,
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            analysis: {
              coverage: [],
              recommendedQuestions: [],
              coverageScore: 0.9,
              interviewerBrief: "Move to confirmation.",
            },
            review: {
              businessSummary: "Sydney plumbing and hot water specialist.",
              staffProfile: {
                staffName: "Jordan Tradie",
                companyName: "Jordan Plumbing",
                role: "Owner",
                calendarProvider: "Microsoft",
              },
              communicationProfile: {
                tone: "Direct and friendly",
                salesStyle: "Consultative",
                riskTolerance: "Escalate uncertain quotes",
                customerHandlingRules: ["Confirm scope before quoting."],
              },
              pricingProfile: {
                quotingStyle: "Fixed when clear",
                calloutPolicy: "Callout fee applies",
                afterHoursPolicy: "After-hours premium applies",
                approvalThreshold: "Over $1,000",
              },
              businessPractices: {
                services: ["Plumbing"],
                serviceAreas: ["Sydney"],
                operatingHours: "24/7 emergency coverage",
                exclusions: ["Commercial roofs"],
                escalationRules: ["Escalate gas leaks"],
              },
              crmDiscovery: {
                currentSystem: "ServiceM8",
                syncPreference: "Sync",
                sourceOfTruth: "CRM",
                notes: ["Calendar is Outlook"],
              },
              missingFields: [],
            },
          }),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch,
  });

  const result = await provider.analyzeSession(
    {
      id: "sess_oa",
      inviteId: "invite_1",
      inviteCode: "secret-invite-code",
      staffId: "staff_1",
      staffName: "Jordan Tradie",
      participantTokenHash: "hash",
      expiresAt: "2099-01-01T00:00:00.000Z",
      status: "interviewing",
      consentAccepted: true,
      cloneConsentAccepted: true,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      analysis: {
        coverage: [],
        recommendedQuestions: [],
        coverageScore: 0.5,
        interviewerBrief: "Keep probing pricing.",
      },
      review: {
        businessSummary: "Summary",
        staffProfile: {
          staffName: "Jordan Tradie",
          companyName: "Jordan Plumbing",
          role: "Owner",
          calendarProvider: "Microsoft",
        },
        communicationProfile: {
          tone: "Professional",
          salesStyle: "Consultative",
          riskTolerance: "Escalate uncertain quotes",
          customerHandlingRules: ["Confirm scope"],
        },
        pricingProfile: {
          quotingStyle: "Fixed when clear",
          calloutPolicy: "Callout fee applies",
          afterHoursPolicy: "After-hours surcharge",
          approvalThreshold: "Over $1,000",
        },
        businessPractices: {
          services: ["Plumbing"],
          serviceAreas: ["Sydney"],
          operatingHours: "24/7",
          exclusions: ["Commercial roofs"],
          escalationRules: ["Escalate gas leaks"],
        },
        crmDiscovery: {
          currentSystem: "ServiceM8",
          syncPreference: "Sync",
          sourceOfTruth: "CRM",
          notes: ["Manual import today"],
        },
        missingFields: [],
      },
    },
    [{ speaker: "participant", text: "We service Sydney plumbing and hot water jobs." }],
  );

  assert.equal(result.analysis.coverageScore, 0.9);
  assert.equal(result.review.staffProfile.companyName, "Jordan Plumbing");
  assert.equal(requestBody?.model, "gpt-4.1-mini");
  assert.equal((requestBody?.text as { format?: { type?: string } })?.format?.type, "json_schema");
});

test("ai test studio strips opaque runner raw payloads before judging and persistence", async () => {
  const repo = new InMemoryOnboardingRepository();
  let judgeRunnerRaw: Record<string, unknown> | undefined;
  const service = new AiTestStudioService({
    repo,
    providers: {
      runner: {
        mode: "hosted",
        async runCase() {
          return {
            provider: "runner",
            mode: "hosted",
            model: "runner-v1",
            outputText: "Safe output",
            toolCalls: [],
            latencyMs: 5,
            fallbackUsed: false,
            raw: {
              secretTrace: "do-not-persist",
            },
          };
        },
      },
      judge: {
        mode: "hosted",
        async judgeRun(input) {
          judgeRunnerRaw = input.runnerResult.raw as Record<string, unknown> | undefined;
          return {
            provider: "judge",
            mode: "hosted",
            model: "judge-v1",
            verdict: "pass",
            score: 1,
            summary: "All good",
            matchedCriteria: ["criterion"],
            missedCriteria: [],
            fallbackUsed: false,
          };
        },
      },
    },
  });

  const testCase = await service.createCase({
    name: "Privacy strip",
    status: "active",
    target: "generic-agent",
    userPrompt: "Answer safely.",
    tags: [],
    successCriteria: [
      {
        label: "Responds",
        kind: "response_contains",
        value: "Safe",
        required: true,
      },
    ],
  });

  const run = await service.runCase(testCase.id, {});
  assert.ok(run);
  assert.equal(judgeRunnerRaw, undefined);
  assert.equal(run?.runnerResult?.raw, undefined);
});

test("ai test studio routes require admin authentication", async () => {
  const app = createTestApp();

  const response = await app.request("/ai-test-studio/cases");
  assert.equal(response.status, 401);
});

test("ai test studio can persist cases and execute a passing mock run", async () => {
  const app = createTestApp();

  const createResponse = await app.request("/ai-test-studio/cases", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      name: "Photo upload and closeout",
      target: "voice-agent",
      userPrompt: "The caller wants a quote, may need to upload photos, and asks whether the agent can hang up cleanly.",
      tags: ["smoke", "voice"],
      successCriteria: [
        {
          label: "Mentions the secure photo flow",
          kind: "response_contains",
          value: "secure photo upload link",
          required: true,
        },
        {
          label: "Mentions clean call ending",
          kind: "response_contains",
          value: "end the call cleanly",
          required: true,
        },
        {
          label: "Avoids promising to ignore safety",
          kind: "response_avoids",
          value: "ignore safety",
          required: true,
        },
      ],
    }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as { case: unknown };
  const created = aiTestCaseResponseSchema.parse({ case: createBody.case });
  assert.equal(created.case.status, "active");

  const listResponse = await app.request("/ai-test-studio/cases", {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });
  assert.equal(listResponse.status, 200);
  const listBody = (await listResponse.json()) as { cases: Array<{ id: string }> };
  assert.equal(listBody.cases.length, 1);
  assert.equal(listBody.cases[0]?.id, created.case.id);

  const runResponse = await app.request(`/ai-test-studio/cases/${created.case.id}/runs`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      operatorNotes: "Smoke the first internal loop.",
    }),
  });
  assert.equal(runResponse.status, 201);
  const runBody = (await runResponse.json()) as { run: unknown };
  const run = aiTestRunResponseSchema.parse({ run: runBody.run });
  assert.equal(run.run.status, "completed");
  assert.equal(run.run.judgeResult?.verdict, "pass");
  assert.equal(run.run.runnerResult?.fallbackUsed, false);
  assert.equal(run.run.runnerResult?.executionMode, "worker-route");
  assert.ok(run.run.runnerResult?.toolCalls.includes("send-photo-link"));
  assert.ok(run.run.runnerResult?.toolCalls.includes("quote"));
  assert.ok(run.run.runnerResult?.toolCalls.includes("end_call"));
  assert.ok((run.run.runnerResult?.observedEffects?.length ?? 0) > 0);

  const getRunResponse = await app.request(`/ai-test-studio/runs/${run.run.id}`, {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });
  assert.equal(getRunResponse.status, 200);
  const getRunBody = (await getRunResponse.json()) as { run: unknown };
  const fetchedRun = aiTestRunResponseSchema.parse({ run: getRunBody.run });
  assert.equal(fetchedRun.run.id, run.run.id);

  const runsResponse = await app.request(`/ai-test-studio/runs?caseId=${created.case.id}`, {
    headers: {
      Authorization: "Bearer admin-secret",
    },
  });
  assert.equal(runsResponse.status, 200);
  const runsBody = (await runsResponse.json()) as { runs: unknown };
  const parsedRuns = aiTestRunListResponseSchema.parse({ runs: runsBody.runs });
  assert.equal(parsedRuns.runs.length, 1);
  assert.equal(parsedRuns.runs[0]?.id, run.run.id);
});

test("ai test studio falls back to mock providers when hosted providers fail", async () => {
  const repo = new InMemoryOnboardingRepository();
  const fetchImpl = async () => new Response(JSON.stringify({ ok: false }), { status: 502 });
  const app = createApp({
    env: baseEnv(),
    repo,
    objectStore: new InMemoryObjectStore(),
    aiTestProviders: {
      runner: new HttpAiTestRunnerProvider({
        baseUrl: "https://runner.example.com",
        apiKey: "runner-key",
        mode: "hosted",
        fallback: new MockAiTestRunnerProvider(),
        fetchImpl,
      }),
      judge: new HttpAiTestJudgeProvider({
        baseUrl: "https://judge.example.com",
        apiKey: "judge-key",
        mode: "hosted",
        fallback: new MockAiTestJudgeProvider(),
        fetchImpl,
      }),
    },
  });

  const createResponse = await app.request("/ai-test-studio/cases", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      name: "Fallback runner coverage",
      target: "generic-agent",
      userPrompt: "Describe the secure photo upload path for a caller.",
      successCriteria: [
        {
          label: "Mentions photo flow",
          kind: "response_contains",
          value: "secure photo upload link",
          required: true,
        },
      ],
    }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as { case: { id: string } };

  const runResponse = await app.request(`/ai-test-studio/cases/${createBody.case.id}/runs`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(runResponse.status, 201);
  const runBody = (await runResponse.json()) as { run: unknown };
  const run = aiTestRunResponseSchema.parse({ run: runBody.run });
  assert.equal(run.run.status, "completed");
  assert.equal(run.run.runnerResult?.fallbackUsed, true);
  assert.equal(run.run.judgeResult?.fallbackUsed, true);
});

test("openai-compatible ai test runner and judge use the Responses API structured output contract", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push(body);
    const schemaName = ((body.text as { format?: { name?: string } })?.format?.name ?? "") as string;
    const payload =
      schemaName === "curve_ai_test_runner"
        ? {
            output_text: JSON.stringify({
              outputText: "I can send a secure photo upload link and end the call cleanly.",
              toolCalls: ["send-photo-link", "end_call"],
            }),
          }
        : {
            output_text: JSON.stringify({
              verdict: "pass",
              score: 1,
              summary: "All required criteria were met.",
              matchedCriteria: ["Mentions photo flow", "Mentions clean ending"],
              missedCriteria: [],
            }),
          };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const runner = new HttpAiTestRunnerProvider({
    baseUrl: "https://api.openai.com/v1/responses",
    apiKey: "openai-secret",
    model: "gpt-4.1-mini",
    mode: "openai-compatible",
    fallback: new MockAiTestRunnerProvider(),
    fetchImpl,
  });
  const judge = new HttpAiTestJudgeProvider({
    baseUrl: "https://api.openai.com/v1/responses",
    apiKey: "openai-secret",
    model: "gpt-4.1-mini",
    mode: "openai-compatible",
    fallback: new MockAiTestJudgeProvider(),
    fetchImpl,
  });

  const testCase = {
    id: "case_1",
    slug: "photo-flow",
    name: "Photo flow",
    status: "active",
    target: "voice-agent",
    userPrompt: "The caller needs to upload photos and asks whether the call can end cleanly.",
    tags: [],
    successCriteria: [
      {
        id: "criterion_1",
        label: "Mentions photo flow",
        kind: "response_contains",
        value: "photo upload link",
        required: true,
      },
      {
        id: "criterion_2",
        label: "Mentions clean ending",
        kind: "response_contains",
        value: "end the call cleanly",
        required: true,
      },
    ],
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
  } as const;

  const runnerResult = await runner.runCase({
    testCase,
    operatorNotes: "Keep it brief.",
  });
  const judgeResult = await judge.judgeRun({
    testCase,
    run: {
      id: "run_1",
      caseId: testCase.id,
      status: "running",
      promptSnapshot: {
        target: testCase.target,
        userPrompt: testCase.userPrompt,
      },
      criteriaSnapshot: testCase.successCriteria,
      createdAt: "2026-04-16T00:00:00.000Z",
      startedAt: "2026-04-16T00:00:00.000Z",
    },
    runnerResult,
  });

  assert.equal(runnerResult.provider, "openai-responses");
  assert.deepEqual(runnerResult.toolCalls, ["send-photo-link", "end_call"]);
  assert.equal(judgeResult.provider, "openai-responses");
  assert.equal(judgeResult.verdict, "pass");
  assert.equal(requests.length, 2);
  assert.equal((requests[0]?.text as { format?: { type?: string } })?.format?.type, "json_schema");
  assert.equal((requests[1]?.text as { format?: { name?: string } })?.format?.name, "curve_ai_test_judge");
});
