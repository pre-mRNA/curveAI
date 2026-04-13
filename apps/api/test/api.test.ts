import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test, { afterEach, beforeEach } from "node:test";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/config/env";
import { crmStore } from "../src/store/crm-store";

let server: Server | undefined;
let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "curve-api-test-"));
  crmStore.reset({ deleteStateFile: true });
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
