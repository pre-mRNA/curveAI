#!/usr/bin/env node

import { createHmac } from "node:crypto";

import { getRequiredEnv, getOptionalEnv } from "./cloudflare-utils.mjs";

const publicApiUrl = getOptionalEnv("PUBLIC_API_URL", "https://curve-ai-api-staging.aj-curve-ai.workers.dev");
const publicOnboardingUrl = getOptionalEnv("PUBLIC_ONBOARDING_APP_URL", "https://curve-ai-onboarding.pages.dev");
const publicUploadUrl = getOptionalEnv("PUBLIC_UPLOAD_APP_URL", "https://curve-ai-upload.pages.dev");
const publicStaffUrl = getOptionalEnv("PUBLIC_STAFF_APP_URL", "https://curve-ai-staff.pages.dev");
const publicOpsUrl = getOptionalEnv("PUBLIC_OPS_APP_URL", "https://curve-ai-ops.pages.dev");
const adminToken = getRequiredEnv("ADMIN_TOKEN");
const automationSharedSecret = getOptionalEnv("AUTOMATION_SHARED_SECRET");

const demoId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const onboardingInvite = await createOnboardingInvite();
const staffInvite = await createStaffInvite();
const uploadRequest = automationSharedSecret ? await createUploadLink() : null;

console.log(
  JSON.stringify(
    {
      ok: true,
      demoId,
      generatedAt: new Date().toISOString(),
      ops: {
        url: publicOpsUrl,
      },
      onboarding: {
        inviteCode: onboardingInvite.code,
        url: `${publicOnboardingUrl.replace(/\/$/, "")}/onboard/${onboardingInvite.code}`,
        fullName: onboardingInvite.fullName,
      },
      upload: uploadRequest
        ? {
            url: uploadRequest.uploadLink,
            token: uploadRequest.token,
            note: "Use this as the supporting customer-photo proof point in the walkthrough.",
          }
        : {
            url: null,
            note: "AUTOMATION_SHARED_SECRET is not set locally, so the upload-link scenario was skipped.",
          },
      staff: {
        url: publicStaffUrl,
        inviteCode: staffInvite.inviteCode,
        otpCode: staffInvite.otpCode ?? null,
        note: staffInvite.otpCode
          ? "Use the invite code and OTP to open the staff phone surface."
          : "The staff invite was created, but OTP echo is disabled in this environment. Complete the OTP through the configured delivery channel or temporarily enable insecure test OTP for staging-only review.",
      },
      walkthrough: [
        "1. Open the onboarding URL and complete the private setup flow.",
        "2. Show the upload URL as the customer-facing photo request path.",
        "3. Open the staff URL to explain the phone-first field surface.",
        "4. Use the ops URL for internal review or AI test studio context only if needed.",
      ],
    },
    null,
    2,
  ),
);

async function createOnboardingInvite() {
  const response = await fetch(`${publicApiUrl.replace(/\/$/, "")}/onboarding/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fullName: `Curve AI Demo ${demoId}`,
      phoneNumber: "+61411111113",
      role: "Owner",
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create onboarding invite: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  return {
    code: payload?.invite?.code,
    fullName: payload?.invite?.fullName,
  };
}

async function createStaffInvite() {
  const response = await fetch(`${publicApiUrl.replace(/\/$/, "")}/staff/invite`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fullName: `Curve AI Field ${demoId}`,
      phoneNumber: "+61411111114",
      role: "Owner",
      timezone: "Australia/Sydney",
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create staff invite: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  return {
    inviteCode: payload?.inviteCode,
    otpCode: payload?.otpCode,
  };
}

async function createUploadLink() {
  const path = "/voice/tools/send-photo-link";
  const rawBody = JSON.stringify({
    callerPhone: "+61411111115",
    notes: "Please send one wide photo of the work area and one close photo of the main issue.",
  });
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", automationSharedSecret)
    .update(`${timestamp}.POST.${path}.${rawBody}`)
    .digest("hex");

  const response = await fetch(`${publicApiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-curve-timestamp": timestamp,
      "x-curve-signature": `sha256=${signature}`,
    },
    body: rawBody,
  });
  if (!response.ok) {
    throw new Error(`Failed to create upload link: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  return {
    token: payload?.uploadRequest?.token,
    uploadLink: payload?.uploadRequest?.uploadLink,
  };
}
