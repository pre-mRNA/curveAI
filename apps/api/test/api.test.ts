import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { afterEach, beforeEach } from "node:test";
import { onboardingSessionSummarySchema } from "../../../packages/shared/src/onboarding";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/config/env";
import { crmStore } from "../src/store/crm-store";
import { onboardingStore } from "../src/store/onboarding-store";

let server: Server | undefined;
let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "curve-api-test-"));
  crmStore.reset({ deleteStateFile: true });
  onboardingStore.reset({ deleteStateFile: true });
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = undefined;
  }

  crmStore.reset();
  onboardingStore.reset();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    nodeEnv: "test",
    port: 0,
    host: "127.0.0.1",
    publicBaseUrl: "http://127.0.0.1",
    publicAppUrl: "http://127.0.0.1:5173",
    allowedOrigins: ["http://127.0.0.1:5173"],
    uploadDir: path.join(tempRoot, "uploads"),
    stateFilePath: path.join(tempRoot, "data", "crm-store.json"),
    enableDemoData: false,
    adminToken: "curve-admin-test-token",
    automationSharedSecret: "curve-automation-test-secret",
    secretsFilePaths: [],
    ...overrides,
  };
}

async function startServer(env: AppEnv): Promise<string> {
  const app = createApp(env);
  server = app.listen(0, env.host);
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  return `http://${env.host}:${address.port}`;
}

async function getJson(baseUrl: string, requestPath: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    headers,
  });
  const body = await response.json();
  return { response, body };
}

async function postJson(
  baseUrl: string,
  requestPath: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  const json = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: json,
  });
  const body = await response.json();
  return { response, body };
}

async function postForm(
  baseUrl: string,
  requestPath: string,
  payload: FormData,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: "POST",
    headers,
    body: payload,
  });
  const body = await response.json();
  return { response, body };
}

function adminHeaders(token = "curve-admin-test-token"): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function staffSessionHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function onboardingHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-onboarding-token": token,
  };
}

function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const candidate = (body as { error?: unknown }).error;
    if (typeof candidate === "string") {
      return candidate;
    }
    if (candidate && typeof candidate === "object" && "message" in candidate) {
      const message = (candidate as { message?: unknown }).message;
      return typeof message === "string" ? message : "";
    }
  }

  return "";
}

function automationHeaders(
  payload: unknown,
  secret = "curve-automation-test-secret",
): Record<string, string> {
  const timestamp = String(Date.now());
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  return {
    "x-curve-timestamp": timestamp,
    "x-curve-signature": `sha256=${signature}`,
  };
}

test("admin auth protects dashboard and invite routes", async () => {
  const baseUrl = await startServer(makeEnv());

  const dashboardRejected = await getJson(baseUrl, "/dashboard");
  assert.equal(dashboardRejected.response.status, 401);

  const inviteRejected = await postJson(baseUrl, "/staff/invite", {
    fullName: "No Token",
  });
  assert.equal(inviteRejected.response.status, 401);

  const dashboardAccepted = await getJson(baseUrl, "/dashboard", adminHeaders());
  assert.equal(dashboardAccepted.response.status, 200);

  const inviteAccepted = await postJson(
    baseUrl,
    "/staff/invite",
    {
      fullName: "Admin Created",
    },
    {
      "x-admin-token": "curve-admin-test-token",
    },
  );
  assert.equal(inviteAccepted.response.status, 201);
});

test("production invite response redacts OTP fields and skips demo seed", async () => {
  const baseUrl = await startServer(
    makeEnv({
      nodeEnv: "production",
      enableDemoData: false,
    }),
  );

  const health = await getJson(baseUrl, "/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.stats.staff, 0);
  assert.equal(health.body.stats.jobs, 0);

  const invite = await postJson(
    baseUrl,
    "/staff/invite",
    {
      fullName: "Production Reviewer",
    },
    adminHeaders(),
  );

  assert.equal(invite.response.status, 201);
  assert.match(invite.body.inviteCode, /^[a-f0-9-]{8,}$/);
  assert.equal(invite.body.otpCode, undefined);
  assert.equal("otpCode" in invite.body.staff, false);
  assert.equal("inviteToken" in invite.body.staff, false);
});

test("staff state persists across restart when a state file is configured", async () => {
  const env = makeEnv({
    nodeEnv: "development",
    enableDemoData: false,
  });

  const firstBaseUrl = await startServer(env);
  const invite = await postJson(
    firstBaseUrl,
    "/staff/invite",
    {
      fullName: "Persistent Tech",
      phoneNumber: "+61412345678",
    },
    adminHeaders(),
  );

  assert.equal(invite.response.status, 201);
  assert.match(invite.body.otpCode, /^\d{6}$/);

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  server = undefined;

  crmStore.reset();

  const secondBaseUrl = await startServer(env);
  const health = await getJson(secondBaseUrl, "/health");

  assert.equal(health.response.status, 200);
  assert.equal(health.body.stats.staff, 1);
});

test("upload route rejects non-image payloads", async () => {
  const baseUrl = await startServer(makeEnv());

  const invite = await postJson(
    baseUrl,
    "/staff/invite",
    {
      fullName: "Upload Reviewer",
      phoneNumber: "+61487654321",
    },
    adminHeaders(),
  );
  const staffId = invite.body.staff.id as string;

  const linkPayload = {
    staffId,
    jobId: "job_upload_test",
    callerPhone: "+61487654321",
  };
  const link = await postJson(
    baseUrl,
    "/voice/tools/send-photo-link",
    linkPayload,
    automationHeaders(linkPayload),
  );
  const token = link.body.uploadRequest.token as string;

  const formData = new FormData();
  formData.append("photos", new File(["plain text"], "not-an-image.txt", { type: "text/plain" }));

  const response = await fetch(`${baseUrl}/uploads/${token}/photos`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error.message, /Only image uploads are allowed/);
});

test("voice routes require a valid automation signature", async () => {
  const baseUrl = await startServer(makeEnv());
  const payload = {
    staffId: "staff_signed_quote",
    jobId: "job_signed_quote",
    callerPhone: "+61411112222",
  };

  const unsigned = await postJson(baseUrl, "/voice/tools/quote", payload);
  assert.equal(unsigned.response.status, 401);

  const signed = await postJson(
    baseUrl,
    "/voice/tools/quote",
    payload,
    automationHeaders(payload),
  );
  assert.equal(signed.response.status, 201);
});

test("dashboard reads do not persist preview quotes", async () => {
  const baseUrl = await startServer(makeEnv());
  const invite = await postJson(
    baseUrl,
    "/staff/invite",
    {
      fullName: "Read Only Reviewer",
      phoneNumber: "+61455550000",
    },
    adminHeaders(),
  );
  const staffId = invite.body.staff.id as string;
  const contextPayload = {
    staffId,
    jobId: "job_dashboard_preview",
    callerPhone: "+61455550000",
    issue: "Leaking tap",
  };

  const context = await postJson(
    baseUrl,
    "/voice/context",
    contextPayload,
    automationHeaders(contextPayload),
  );
  assert.equal(context.response.status, 200);
  assert.equal(crmStore.getJob("job_dashboard_preview")?.quote, undefined);

  const dashboard = await getJson(baseUrl, "/dashboard", adminHeaders());
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.jobs.some((job: { id: string }) => job.id === "job_dashboard_preview"));
  assert.equal(crmStore.getJob("job_dashboard_preview")?.quote, undefined);
});

test("OTP verification invalidates the code and issues a staff session", async () => {
  const baseUrl = await startServer(makeEnv());
  const invite = await postJson(
    baseUrl,
    "/staff/invite",
    {
      fullName: "Session Reviewer",
      phoneNumber: "+61477778888",
    },
    adminHeaders(),
  );

  const staffId = invite.body.staff.id as string;
  const otpCode = invite.body.otpCode as string;
  const inviteCode = invite.body.inviteCode as string;

  const firstVerification = await postJson(baseUrl, "/staff/verify-otp", {
    inviteToken: inviteCode,
    otpCode,
  });
  assert.equal(firstVerification.response.status, 200);
  assert.match(firstVerification.body.session.token, /^[a-f0-9]{48}$/);

  const secondVerification = await postJson(baseUrl, "/staff/verify-otp", {
    inviteToken: inviteCode,
    otpCode,
  });
  assert.equal(secondVerification.response.status, 404);

  const voiceConsent = await postJson(
    baseUrl,
    "/staff/voice-consent",
    {
      staffId,
      consent: true,
      signedBy: "Session Reviewer",
    },
    staffSessionHeaders(firstVerification.body.session.token),
  );
  assert.equal(voiceConsent.response.status, 200);

  const me = await getJson(
    baseUrl,
    "/staff/me",
    staffSessionHeaders(firstVerification.body.session.token),
  );
  assert.equal(me.response.status, 200);
  assert.equal(me.body.staff.id, staffId);

  const contextPayload = {
    staffId,
    jobId: "job_staff_queue",
    callerPhone: "+61477778888",
    issue: "Broken gate latch",
  };
  const context = await postJson(
    baseUrl,
    "/voice/context",
    contextPayload,
    automationHeaders(contextPayload),
  );
  assert.equal(context.response.status, 200);

  const jobs = await getJson(
    baseUrl,
    "/jobs",
    staffSessionHeaders(firstVerification.body.session.token),
  );
  assert.equal(jobs.response.status, 200);
  assert.ok(jobs.body.jobs.some((job: { id: string }) => job.id === "job_staff_queue"));
});

test("OTP verification locks out after repeated failures", async () => {
  const baseUrl = await startServer(makeEnv());
  const invite = await postJson(
    baseUrl,
    "/staff/invite",
    {
      fullName: "Lockout Reviewer",
      phoneNumber: "+61470001111",
    },
    adminHeaders(),
  );
  const inviteCode = invite.body.inviteCode as string;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await postJson(baseUrl, "/staff/verify-otp", {
      inviteToken: inviteCode,
      otpCode: "000000",
    });
    assert.equal(failed.response.status, 404);
  }

  const lockedOut = await postJson(baseUrl, "/staff/verify-otp", {
    inviteToken: inviteCode,
    otpCode: invite.body.otpCode as string,
  });
  assert.equal(lockedOut.response.status, 404);
});

test("onboarding flow creates a portable interview session and finalizes a staff profile", async () => {
  const baseUrl = await startServer(makeEnv());

  const invite = await postJson(
    baseUrl,
    "/onboarding/invites",
    {
      fullName: "Onboarding Reviewer",
      phoneNumber: "+61499990000",
      email: "onboard@example.com",
      ttlHours: 48,
    },
    adminHeaders(),
  );
  assert.equal(invite.response.status, 201);
  assert.match(invite.body.invite.code, /^[a-f0-9]{32}$/);

  const start = await postJson(baseUrl, "/onboarding/sessions/start", {
    inviteCode: invite.body.invite.code,
  });
  assert.equal(start.response.status, 201);
  assert.equal(onboardingSessionSummarySchema.safeParse(start.body.session).success, true);
  const sessionId = start.body.session.id as string;
  const participantToken = start.body.session.participantToken as string;
  assert.equal(start.body.session.status, "pending");

  const voiceSession = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/token`,
    {
      consentAccepted: true,
      cloneConsentAccepted: true,
    },
    onboardingHeaders(participantToken),
  );
  assert.equal(voiceSession.response.status, 200);
  assert.equal(onboardingSessionSummarySchema.safeParse(voiceSession.body.session).success, true);
  assert.equal(voiceSession.body.session.status, "interviewing");
  assert.ok(voiceSession.body.session.voiceSession.sessionToken);

  const participantTurn = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/turns`,
    {
      speaker: "participant",
      text: "We do plumbing across the inner west and charge a callout fee. After hours jobs should usually become a callback unless it is an emergency. We use ServiceM8 today.",
    },
    onboardingHeaders(participantToken),
  );
  assert.equal(participantTurn.response.status, 201);
  assert.ok(participantTurn.body.session.analysis.coverage.length > 0);
  assert.ok(Array.isArray(participantTurn.body.session.review.missingFields));

  const review = await getJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/review`,
    onboardingHeaders(participantToken),
  );
  assert.equal(review.response.status, 200);
  assert.match(review.body.review.crmDiscovery.currentSystem, /ServiceM8|Unknown/);

  const reviewPatch = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/review`,
    {
      businessSummary: "Focused plumbing business covering Sydney inner west callouts.",
      businessPractices: {
        serviceAreas: ["Inner West", "Sydney"],
      },
    },
    onboardingHeaders(participantToken),
  );
  assert.equal(reviewPatch.response.status, 200);
  assert.equal(reviewPatch.body.session.review.businessSummary, "Focused plumbing business covering Sydney inner west callouts.");

  const calendarStart = await getJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/calendar/microsoft/start`,
    onboardingHeaders(participantToken),
  );
  assert.equal(calendarStart.response.status, 200);
  assert.ok(calendarStart.body.calendar.authUrl);

  const callbackUrl = new URL(calendarStart.body.calendar.authUrl as string);
  const callbackTarget = new URL(callbackUrl.pathname + callbackUrl.search, baseUrl);
  const calendarCallback = await fetch(callbackTarget.toString(), {
    redirect: "manual",
  });
  assert.equal(calendarCallback.status, 302);

  const voiceSampleForm = new FormData();
  voiceSampleForm.set("sampleLabel", "Quiet office introduction");
  voiceSampleForm.set("durationSeconds", "95");
  voiceSampleForm.set(
    "transcript",
    "Hi, this is Jordan from Sydney Metro Plumbing. We handle urgent leaks, blocked drains, and hot water faults across the inner west.",
  );
  voiceSampleForm.set("noiseLevel", "low");
  voiceSampleForm.set(
    "sample",
    new File([Buffer.from("RIFF....WEBM")], "voice-sample.webm", {
      type: "audio/webm",
    }),
  );

  const voiceSample = await postForm(
    baseUrl,
    `/onboarding/sessions/${sessionId}/voice-sample`,
    voiceSampleForm,
    onboardingHeaders(participantToken),
  );
  assert.equal(voiceSample.response.status, 200);
  assert.equal(onboardingSessionSummarySchema.safeParse(voiceSample.body.session).success, true);
  assert.equal(typeof voiceSample.body.session.voiceSample.recommendedForClone, "boolean");
  assert.equal(existsSync(voiceSample.body.session.voiceSample.storedPath as string), true);

  const finalized = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/finalize`,
    {},
    onboardingHeaders(participantToken),
  );
  assert.equal(finalized.response.status, 200);
  assert.equal(onboardingSessionSummarySchema.safeParse(finalized.body.session).success, true);
  assert.equal(finalized.body.session.status, "completed");
  assert.equal(finalized.body.staff.id, invite.body.staff.id);
});

test("onboarding realtime voice session rejects missing consent", async () => {
  const baseUrl = await startServer(makeEnv());

  const invite = await postJson(
    baseUrl,
    "/onboarding/invites",
    {
      fullName: "Consent Gap",
      phoneNumber: "+61400000001",
    },
    adminHeaders(),
  );
  const start = await postJson(baseUrl, "/onboarding/sessions/start", {
    inviteCode: invite.body.invite.code,
  });
  const sessionId = start.body.session.id as string;
  const participantToken = start.body.session.participantToken as string;

  const voiceSession = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/token`,
    {
      consentAccepted: false,
      cloneConsentAccepted: false,
    },
    onboardingHeaders(participantToken),
  );

  assert.equal(voiceSession.response.status, 400);
  assert.match(readErrorMessage(voiceSession.body), /consent/i);
});

test("onboarding finalize blocks incomplete sessions and voice samples require a real file", async () => {
  const baseUrl = await startServer(makeEnv());

  const invite = await postJson(
    baseUrl,
    "/onboarding/invites",
    {
      fullName: "Finalize Guard",
      phoneNumber: "+61400000002",
    },
    adminHeaders(),
  );
  const start = await postJson(baseUrl, "/onboarding/sessions/start", {
    inviteCode: invite.body.invite.code,
  });
  const sessionId = start.body.session.id as string;
  const participantToken = start.body.session.participantToken as string;

  const voiceSession = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/token`,
    {
      consentAccepted: true,
      cloneConsentAccepted: true,
    },
    onboardingHeaders(participantToken),
  );
  assert.equal(voiceSession.response.status, 200);

  const earlyFinalize = await postJson(
    baseUrl,
    `/onboarding/sessions/${sessionId}/finalize`,
    {},
    onboardingHeaders(participantToken),
  );
  assert.equal(earlyFinalize.response.status, 409);
  assert.match(readErrorMessage(earlyFinalize.body), /calendar/i);

  const metadataOnlyForm = new FormData();
  metadataOnlyForm.set("sampleLabel", "Metadata only");
  metadataOnlyForm.set("durationSeconds", "35");
  metadataOnlyForm.set("noiseLevel", "low");
  const sampleWithoutFile = await postForm(
    baseUrl,
    `/onboarding/sessions/${sessionId}/voice-sample`,
    metadataOnlyForm,
    onboardingHeaders(participantToken),
  );
  assert.equal(sampleWithoutFile.response.status, 400);
  assert.match(readErrorMessage(sampleWithoutFile.body), /audio sample file/i);
});

test("malformed CRM snapshots are quarantined and ignored", async () => {
  const env = makeEnv();
  mkdirSync(path.dirname(env.stateFilePath), { recursive: true });
  writeFileSync(env.stateFilePath, "{not-json", "utf8");

  const baseUrl = await startServer(env);
  const health = await getJson(baseUrl, "/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.stats.staff, 0);

  const snapshotFiles = readdirSync(path.dirname(env.stateFilePath));
  assert.ok(snapshotFiles.some((name) => name.startsWith("crm-store.json.corrupt-")));
});

test("invalid upload tokens are rejected before files hit disk", async () => {
  const env = makeEnv();
  const baseUrl = await startServer(env);

  const formData = new FormData();
  formData.append("photos", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }));

  const response = await fetch(`${baseUrl}/uploads/missing-token/photos`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.match(body.error.message, /Upload token not found/);
  const uploadFiles = existsSync(env.uploadDir) ? readdirSync(env.uploadDir) : [];
  assert.equal(uploadFiles.length, 0);
});

test("quote route rejects incomplete payloads", async () => {
  const baseUrl = await startServer(makeEnv());
  const payload = {
    staffId: "staff_missing_fields",
  };

  const response = await postJson(
    baseUrl,
    "/voice/tools/quote",
    payload,
    automationHeaders(payload),
  );

  assert.equal(response.response.status, 400);
  assert.match(
    JSON.stringify(response.body.error.details.issues),
    /jobId|callerPhone/,
  );
});
