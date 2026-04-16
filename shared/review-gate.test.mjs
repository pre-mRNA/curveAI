import assert from "node:assert/strict";
import test from "node:test";

import { onRequest, reviewGateInternals } from "./review-gate.mjs";

function createContext({ url, method = "GET", headers = {}, env = {}, body, nextResponse } = {}) {
  let nextCalls = 0;
  const request = new Request(url, { method, headers, body });

  return {
    context: {
      env,
      request,
      next: async () => {
        nextCalls += 1;
        return nextResponse ?? new Response("next", { status: 200 });
      },
    },
    getNextCalls: () => nextCalls,
  };
}

test("fails closed on non-local hosts when review protection is not configured", async () => {
  const { context, getNextCalls } = createContext({
    url: "https://curve-ai-onboarding.pages.dev/",
  });

  const response = await onRequest(context);

  assert.equal(response.status, 503);
  assert.equal(getNextCalls(), 0);
  assert.match(await response.text(), /not configured/i);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
});

test("allows localhost through when review protection is not configured", async () => {
  const nextResponse = new Response("local ok", { status: 200 });
  const { context, getNextCalls } = createContext({
    url: "http://localhost:4173/",
    nextResponse,
  });

  const response = await onRequest(context);

  assert.equal(response.status, 200);
  assert.equal(getNextCalls(), 1);
  assert.equal(await response.text(), "local ok");
});

test("renders the gate page for protected document requests", async () => {
  const { context } = createContext({
    url: "https://curve-ai-ops.pages.dev/dashboard?tab=jobs",
    env: {
      REVIEW_PASSCODE: "letmein",
      REVIEW_COOKIE_SECRET: "signing-secret",
    },
  });

  const response = await onRequest(context);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Content-Security-Policy"), reviewGateInternals.HTML_GATE_CSP);
  const html = await response.text();
  assert.match(html, /Protected staging build/);
  assert.match(html, /dashboard\?tab=jobs/);
});

test("blocks asset paths with a plain 401 instead of rendering HTML", async () => {
  const { context } = createContext({
    url: "https://curve-ai-upload.pages.dev/assets/main.js",
    env: {
      REVIEW_PASSCODE: "letmein",
      REVIEW_COOKIE_SECRET: "signing-secret",
    },
  });

  const response = await onRequest(context);

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Review access required");
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain\b/i);
});

test("accepts the correct passcode, sanitizes redirects, and issues a signed cookie", async () => {
  const formData = new FormData();
  formData.set("passcode", "letmein");
  formData.set("redirect", "//evil.example/steal");

  const { context } = createContext({
    url: "https://curve-ai-staff.pages.dev/__review-access",
    method: "POST",
    body: formData,
    env: {
      REVIEW_PASSCODE: "letmein",
      REVIEW_COOKIE_SECRET: "signing-secret",
    },
  });

  const response = await onRequest(context);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /^curve_review_gate=\d+\.[0-9a-f]+;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test("allows requests with a valid signed review cookie", async () => {
  const expiresAt = `${Date.now() + 60_000}`;
  const signature = await reviewGateInternals.signPayload("signing-secret", expiresAt);
  const nextResponse = new Response("unlocked", { status: 200, headers: { "content-type": "text/plain" } });
  const { context, getNextCalls } = createContext({
    url: "https://curve-ai-onboarding.pages.dev/",
    headers: {
      Cookie: `${reviewGateInternals.COOKIE_NAME}=${expiresAt}.${signature}`,
    },
    env: {
      REVIEW_PASSCODE: "letmein",
      REVIEW_COOKIE_SECRET: "signing-secret",
    },
    nextResponse,
  });

  const response = await onRequest(context);

  assert.equal(response.status, 200);
  assert.equal(getNextCalls(), 1);
  assert.equal(await response.text(), "unlocked");
  assert.equal(response.headers.get("Referrer-Policy"), "same-origin");
});

test("logout clears the review gate cookie", async () => {
  const { context } = createContext({
    url: "https://curve-ai-ops.pages.dev/__review-logout",
    env: {
      REVIEW_PASSCODE: "letmein",
      REVIEW_COOKIE_SECRET: "signing-secret",
    },
  });

  const response = await onRequest(context);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
