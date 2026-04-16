#!/usr/bin/env node

import { createHmac } from "node:crypto";

import { defaultCloudflareNames, defaultWorkerUrl, getOptionalEnv } from "./cloudflare-utils.mjs";

const names = defaultCloudflareNames();
const workerUrl =
  getOptionalEnv("PUBLIC_API_URL") ??
  defaultWorkerUrl({
    workerName: names.workerName,
    workersSubdomain: names.workersSubdomain,
  });

if (!workerUrl) {
  throw new Error("PUBLIC_API_URL or CLOUDFLARE_WORKERS_SUBDOMAIN must be set for smoke checks.");
}

const reviewPasscode = getOptionalEnv("REVIEW_PASSCODE");
const automationSharedSecret = getOptionalEnv("AUTOMATION_SHARED_SECRET");
const pagesUrls = Object.values(names.pagesProjects).map((project) => `https://${project}.pages.dev`);

await checkWorkerHealth(workerUrl);
for (const url of pagesUrls) {
  await checkPagesGate(url, reviewPasscode);
}
await checkVoicePhotoLink(workerUrl, names.pagesProjects.upload, automationSharedSecret, reviewPasscode);

console.log("Cloudflare staging smoke checks passed.");

async function checkWorkerHealth(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
  if (!response.ok) {
    throw new Error(`Worker health returned ${response.status}`);
  }
  const body = await response.json();
  if (!body?.ok || body?.runtime !== "cloudflare-worker") {
    throw new Error("Worker health response did not match expected runtime.");
  }
}

async function checkPagesGate(baseUrl, passcode) {
  const gateResponse = await fetch(baseUrl, {
    redirect: "manual",
  });
  const gateBody = await gateResponse.text();
  if (gateResponse.status !== 401 || !/passcode/i.test(gateBody)) {
    throw new Error(`Expected review gate on ${baseUrl}, received ${gateResponse.status}`);
  }
  if (!passcode) {
    return;
  }

  const unlockBody = new URLSearchParams({
    passcode,
    redirect: "/",
  });
  const unlockResponse = await fetch(`${baseUrl}/__review-access`, {
    method: "POST",
    body: unlockBody,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
  });
  const setCookie = unlockResponse.headers.get("set-cookie");
  if (unlockResponse.status !== 303 || !setCookie) {
    throw new Error(`Expected successful review unlock for ${baseUrl}`);
  }

  const cookie = setCookie.split(";", 1)[0];
  const unlockedResponse = await fetch(baseUrl, {
    headers: {
      Cookie: cookie,
    },
  });
  const unlockedBody = await unlockedResponse.text();
  if (!unlockedResponse.ok || /passcode/i.test(unlockedBody)) {
    throw new Error(`Unlocked review session did not reach app HTML for ${baseUrl}`);
  }
}

async function checkVoicePhotoLink(workerUrl, uploadProjectName, secret, reviewPasscode) {
  if (!secret) {
    console.log("Skipping voice photo-link smoke check because AUTOMATION_SHARED_SECRET is not set.");
    return;
  }

  const path = "/voice/tools/send-photo-link";
  const rawBody = JSON.stringify({
    callerPhone: "+61411111111",
    notes: "Please send a wide shot of the work area and a close-up of the main issue.",
  });
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.POST.${path}.${rawBody}`)
    .digest("hex");

  const response = await fetch(`${workerUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-curve-timestamp": timestamp,
      "x-curve-signature": `sha256=${signature}`,
    },
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Voice photo-link smoke check returned ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const uploadLink = payload?.uploadRequest?.uploadLink;
  if (typeof uploadLink !== "string" || !uploadLink.includes(`https://${uploadProjectName}.pages.dev/upload/`)) {
    throw new Error("Voice photo-link smoke check did not return a valid upload link.");
  }

  if (!reviewPasscode) {
    return;
  }

  const uploadUrl = new URL(uploadLink);
  const unlockBody = new URLSearchParams({
    passcode: reviewPasscode,
    redirect: uploadUrl.pathname,
  });
  const unlockResponse = await fetch(`${uploadUrl.origin}/__review-access`, {
    method: "POST",
    body: unlockBody,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
  });
  const setCookie = unlockResponse.headers.get("set-cookie");
  if (unlockResponse.status !== 303 || !setCookie) {
    throw new Error(`Expected successful review unlock for ${uploadLink}`);
  }

  const cookie = setCookie.split(";", 1)[0];
  const uploadResponse = await fetch(uploadLink, {
    headers: {
      Cookie: cookie,
    },
  });
  const uploadBody = await uploadResponse.text();
  if (!uploadResponse.ok || /passcode/i.test(uploadBody) || !/upload|photo|job/i.test(uploadBody)) {
    throw new Error(`Unlocked upload route did not render app HTML for ${uploadLink}`);
  }
}
