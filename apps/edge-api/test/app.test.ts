import assert from "node:assert/strict";
import test from "node:test";
import {
  aiTestCaseResponseSchema,
  aiTestRunListResponseSchema,
  aiTestRunResponseSchema,
} from "../../../packages/shared/src/ai-test-studio";
import { createApp } from "../src/app.js";
import { signHmacSha256 } from "../src/crypto.js";
import type { EdgeApiEnv } from "../src/env.js";
import {
  HttpAiTestJudgeProvider,
  HttpAiTestRunnerProvider,
  MockAiTestJudgeProvider,
  MockAiTestRunnerProvider,
} from "../src/providers/ai-test-studio.js";
import { HeuristicReasoningProvider, HttpReasoningProvider } from "../src/providers/reasoning.js";
import { AiTestStudioService } from "../src/ai-test-studio-service.js";
import { InMemoryOnboardingRepository } from "../src/storage/memory.js";
import { InMemoryObjectStore } from "../src/storage/artifacts.js";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-Onboarding-Token": token,
  };
}

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
  const verifyBody = (await verifyResponse.json()) as {
    staff: { id: string };
    session: { token: string };
  };

  return {
    staffId: verifyBody.staff.id,
    sessionToken: verifyBody.session.token,
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
    }),
  });
  assert.equal(startResponse.status, 201);
  const startBody = (await startResponse.json()) as {
    session: { id: string; participantToken: string };
  };
  const sessionId = startBody.session.id;
  const participantToken = startBody.session.participantToken;
  assert.ok(participantToken.length >= 16);

  const duplicateStartResponse = await app.request("/onboarding/sessions/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteCode: inviteBody.invite.code,
    }),
  });
  assert.equal(duplicateStartResponse.status, 409);

  const realtimeResponse = await app.request(`/onboarding/sessions/${sessionId}/token`, {
    method: "POST",
    headers: {
      ...authHeaders(participantToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      consentAccepted: true,
      cloneConsentAccepted: true,
    }),
  });
  assert.equal(realtimeResponse.status, 200);

  const turnResponse = await app.request(`/onboarding/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: {
      ...authHeaders(participantToken),
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
      ...authHeaders(participantToken),
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
    headers: authHeaders(participantToken),
  });
  assert.equal(calendarResponse.status, 200);
  const calendarBody = (await calendarResponse.json()) as {
    calendar: { authUrl?: string; authState?: string };
  };
  assert.ok(calendarBody.calendar.authUrl);
  assert.ok(calendarBody.calendar.authState);

  const callbackResponse = await app.request(
    `/onboarding/calendar/microsoft/callback?state=${encodeURIComponent(calendarBody.calendar.authState ?? "")}&code=mock-code&email=jordan@example.com&calendar=Jordan%20Calendar`,
  );
  assert.equal(callbackResponse.status, 302);

  const formData = new FormData();
  formData.set("sampleLabel", "Quiet office sample");
  formData.set("durationSeconds", "92");
  formData.set("transcript", "This is a longer clean sample for cloning and onboarding quality assessment.");
  formData.set("noiseLevel", "low");
  formData.set("sample", new File(["voice-data"], "voice-sample.webm", { type: "audio/webm" }));
  const voiceSampleResponse = await app.request(`/onboarding/sessions/${sessionId}/voice-sample`, {
    method: "POST",
    headers: authHeaders(participantToken),
    body: formData,
  });
  assert.equal(voiceSampleResponse.status, 200);

  const finalizeResponse = await app.request(`/onboarding/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: authHeaders(participantToken),
  });
  assert.equal(finalizeResponse.status, 200);
  const finalizeBody = (await finalizeResponse.json()) as {
    session: { status: string };
    staff: { id: string };
  };
  assert.equal(finalizeBody.session.status, "completed");
  assert.ok(finalizeBody.staff.id);

  const staleSessionRead = await app.request(`/onboarding/sessions/${sessionId}`, {
    headers: authHeaders(participantToken),
  });
  assert.equal(staleSessionRead.status, 403);

  const blockedMutation = await app.request(`/onboarding/sessions/${sessionId}/review`, {
    method: "POST",
    headers: {
      ...authHeaders(participantToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessSummary: "Should not persist",
    }),
  });
  assert.equal(blockedMutation.status, 403);

  const duplicateFinalize = await app.request(`/onboarding/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: authHeaders(participantToken),
  });
  assert.equal(duplicateFinalize.status, 403);
});

test("health reports worker runtime and provider modes", async () => {
  const app = createTestApp();

  const response = await app.request("/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    ready: boolean;
    runtime: string;
    realtimeVoice: string;
    reasoning: string;
    calendar: string;
    warnings: string[];
  };
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.equal(body.runtime, "cloudflare-worker");
  assert.equal(body.realtimeVoice, "mock");
  assert.equal(body.reasoning, "mock");
  assert.equal(body.calendar, "mock");
  assert.deepEqual(body.warnings, []);
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
  assert.equal("warnings" in body, false);
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
    }),
  });
  const startBody = (await startResponse.json()) as { session: { id: string; participantToken: string } };

  const denied = await app.request(`/onboarding/sessions/${startBody.session.id}/token`, {
    method: "POST",
    headers: {
      ...authHeaders(startBody.session.participantToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      consentAccepted: true,
      cloneConsentAccepted: false,
    }),
  });
  assert.equal(denied.status, 400);
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
    upload: { status: string; fileCount: number; notes?: string };
  };
  assert.equal(uploadBody.upload.status, "completed");
  assert.equal(uploadBody.upload.fileCount, 1);
  assert.equal(uploadBody.upload.notes, undefined);

  const uploadStatusResponse = await app.request(`/uploads/${linkBody.uploadRequest.token}`);
  assert.equal(uploadStatusResponse.status, 200);
  const uploadStatusBody = (await uploadStatusResponse.json()) as {
    upload: Record<string, unknown>;
  };
  assert.equal(uploadStatusBody.upload.fileCount, 1);
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
      Authorization: `Bearer ${owner.sessionToken}`,
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
      Authorization: `Bearer ${owner.sessionToken}`,
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
      Authorization: `Bearer ${owner.sessionToken}`,
    },
  });
  assert.equal(ownerPhotoResponse.status, 200);

  const otherPhotoResponse = await app.request(`/assets/photos/${photoId}`, {
    headers: {
      Authorization: `Bearer ${other.sessionToken}`,
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
  const verifyBody = (await verifyResponse.json()) as {
    staff: { id: string; otpVerifiedAt?: string };
    session: { token: string };
  };
  assert.equal(verifyBody.staff.id, inviteBody.staff.id);
  assert.ok(verifyBody.staff.otpVerifiedAt);

  const meResponse = await app.request("/staff/me", {
    headers: {
      Authorization: `Bearer ${verifyBody.session.token}`,
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
      Authorization: `Bearer ${verifyBody.session.token}`,
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

  const consentResponse = await app.request("/staff/voice-consent", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${verifyBody.session.token}`,
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
      Authorization: `Bearer ${verifyBody.session.token}`,
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
      Authorization: `Bearer ${verifyBody.session.token}`,
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
      Authorization: `Bearer ${verifyBody.session.token}`,
    },
  });
  assert.equal(jobCardResponse.status, 200);

  const forbiddenJobsResponse = await app.request(`/jobs?staffId=staff_other`, {
    headers: {
      Authorization: `Bearer ${verifyBody.session.token}`,
    },
  });
  assert.equal(forbiddenJobsResponse.status, 403);
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
  assert.ok(run.run.runnerResult?.toolCalls.includes("send-photo-link"));
  assert.ok(run.run.runnerResult?.toolCalls.includes("quote"));
  assert.ok(run.run.runnerResult?.toolCalls.includes("end_call"));

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
