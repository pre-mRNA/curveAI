import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import type { EdgeApiEnv } from "../src/env.js";
import { InMemoryOnboardingRepository } from "../src/storage/memory.js";
import { InMemoryObjectStore } from "../src/storage/artifacts.js";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-Onboarding-Token": token,
  };
}

test("worker onboarding flow reaches finalized state", async () => {
  const repo = new InMemoryOnboardingRepository();
  const objectStore = new InMemoryObjectStore();
  const app = createApp({
    env: {
      ADMIN_TOKEN: "admin-secret",
      PUBLIC_APP_URL: "https://curve-ai-staging.pages.dev",
      PUBLIC_API_URL: "https://curve-ai-api-staging.workers.dev",
      ALLOWED_ORIGIN: "https://curve-ai-staging.pages.dev",
    } satisfies EdgeApiEnv,
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
  const app = createApp({
    env: {
      PUBLIC_APP_URL: "https://curve-ai-staging.pages.dev",
      PUBLIC_API_URL: "https://curve-ai-api-staging.workers.dev",
      ALLOWED_ORIGIN: "https://curve-ai-staging.pages.dev",
    },
  });

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
    env: {
      ADMIN_TOKEN: "admin-secret",
    } satisfies EdgeApiEnv,
    repo,
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
