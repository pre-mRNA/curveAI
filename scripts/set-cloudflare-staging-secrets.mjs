#!/usr/bin/env node

import { defaultCloudflareNames, getRequiredEnv, getOptionalEnv, runWrangler } from "./cloudflare-utils.mjs";

const names = defaultCloudflareNames();

const workerSecrets = [
  "ADMIN_TOKEN",
  "AUTOMATION_SHARED_SECRET",
];

const optionalWorkerSecrets = [
  "ALLOW_INSECURE_TEST_OTP",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_AGENT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "REASONING_API_KEY",
  "AI_TEST_RUNNER_API_KEY",
  "AI_TEST_JUDGE_API_KEY",
];

const pagesSecrets = [
  "REVIEW_PASSCODE",
  "REVIEW_COOKIE_SECRET",
];

for (const name of workerSecrets) {
  putWorkerSecret(names.workerName, name, getRequiredEnv(name));
}

for (const name of optionalWorkerSecrets) {
  const value = getOptionalEnv(name);
  if (value) {
    putWorkerSecret(names.workerName, name, value);
  }
}

for (const projectName of Object.values(names.pagesProjects)) {
  for (const name of pagesSecrets) {
    putPagesSecret(projectName, name, getRequiredEnv(name));
  }
}

console.log("Cloudflare staging secrets synced.");

function putWorkerSecret(workerName, secretName, value) {
  runWrangler(["secret", "put", secretName, "--name", workerName], {
    input: value,
  });
}

function putPagesSecret(projectName, secretName, value) {
  runWrangler(["pages", "secret", "put", secretName, "--project-name", projectName], {
    input: value,
  });
}
