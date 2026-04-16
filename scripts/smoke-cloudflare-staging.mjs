#!/usr/bin/env node

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
const pagesUrls = Object.values(names.pagesProjects).map((project) => `https://${project}.pages.dev`);

await checkWorkerHealth(workerUrl);
for (const url of pagesUrls) {
  await checkPagesGate(url, reviewPasscode);
}

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
