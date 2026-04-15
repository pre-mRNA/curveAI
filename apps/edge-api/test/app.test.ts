import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { signHmacSha256 } from "../src/crypto.js";
import type { EdgeApiEnv } from "../src/env.js";
import { InMemoryOnboardingRepository } from "../src/storage/memory.js";
import { InMemoryObjectStore } from "../src/storage/artifacts.js";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-Onboarding-Token": token,
  };
}

function baseEnv(overrides: Partial<EdgeApiEnv> = {}): EdgeApiEnv {
  return {
    ADMIN_TOKEN: "admin-secret",
    AUTOMATION_SHARED_SECRET: "automation-secret",
    ASSET_SIGNING_SECRET: "asset-secret",
    PUBLIC_OPS_APP_URL: "https://curve-ai-ops.pages.dev",
    PUBLIC_ONBOARDING_APP_URL: "https://curve-ai-onboarding.pages.dev",
    PUBLIC_UPLOAD_APP_URL: "https://curve-ai-upload.pages.dev",
    PUBLIC_API_URL: "https://curve-ai-api-staging.workers.dev",
    ALLOWED_ORIGINS: "https://curve-ai-ops.pages.dev,https://curve-ai-onboarding.pages.dev,https://curve-ai-upload.pages.dev",
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

async function automationHeaders(secret: string, body: unknown): Promise<HeadersInit> {
  const timestamp = Date.now().toString();
  const payload = JSON.stringify(body);
  const signature = await signHmacSha256(secret, `${timestamp}.${payload}`);
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
  assert.equal(blockedMutation.status, 409);

  const duplicateFinalize = await app.request(`/onboarding/sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: authHeaders(participantToken),
  });
  assert.equal(duplicateFinalize.status, 409);
});

test("health reports worker runtime and provider modes", async () => {
  const app = createTestApp();

  const response = await app.request("/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    runtime: string;
    realtimeVoice: string;
    reasoning: string;
    calendar: string;
  };
  assert.equal(body.runtime, "cloudflare-worker");
  assert.equal(body.realtimeVoice, "mock");
  assert.equal(body.reasoning, "mock");
  assert.equal(body.calendar, "mock");
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

test("customer upload flow stays on Cloudflare routes and produces signed photo assets", async () => {
  const app = createTestApp();
  const photoLinkHeaders = await automationHeaders("automation-secret", {
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
  uploadForm.append("photos", new File(["binary-image"], "water-heater.jpg", { type: "image/jpeg" }));
  const uploadResponse = await app.request(`/uploads/${linkBody.uploadRequest.token}/photos`, {
    method: "POST",
    body: uploadForm,
  });
  assert.equal(uploadResponse.status, 200);
  const uploadBody = (await uploadResponse.json()) as {
    upload: { status: string; fileCount: number };
    photos: Array<{ id: string }>;
  };
  assert.equal(uploadBody.upload.status, "completed");
  assert.equal(uploadBody.upload.fileCount, 1);

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

  const signedPhotoUrl = dashboard.jobs[0]?.photos[0]?.url;
  assert.ok(signedPhotoUrl);
  const parsedPhotoUrl = new URL(signedPhotoUrl);
  assert.equal(parsedPhotoUrl.origin, "https://curve-ai-api-staging.workers.dev");
  const photoResponse = await app.request(`${parsedPhotoUrl.pathname}${parsedPhotoUrl.search}`);
  assert.equal(photoResponse.status, 200);
  assert.equal(photoResponse.headers.get("content-type"), "image/jpeg");
});

test("voice post-call writes call records into the Worker CRM store", async () => {
  const app = createTestApp();
  const headers = await automationHeaders("automation-secret", {
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
