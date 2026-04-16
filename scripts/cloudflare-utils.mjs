#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

export function getOptionalEnv(name, fallback = undefined) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function parseEnvFile(filePath) {
  const parsed = {};
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    parsed[key] =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'")))
        ? rawValue.slice(1, -1)
        : rawValue;
  }
  return parsed;
}

export async function cfApi(path, init = {}) {
  const token = getRequiredEnv("CLOUDFLARE_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const message =
      json?.errors?.map((error) => error?.message).filter(Boolean).join("; ") ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Cloudflare API ${path} failed: ${message}`);
  }
  return json;
}

export function runWrangler(args, options = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    env: process.env,
    cwd: options.cwd ?? process.cwd(),
    input: options.input,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
}

export function defaultCloudflareNames() {
  const workerName = getOptionalEnv("CLOUDFLARE_WORKER_NAME", "curve-ai-api-staging");
  const workersSubdomain = getOptionalEnv("CLOUDFLARE_WORKERS_SUBDOMAIN");
  return {
    accountId: getRequiredEnv("CLOUDFLARE_ACCOUNT_ID"),
    workerName,
    workersSubdomain,
    d1DatabaseName: getOptionalEnv("CLOUDFLARE_D1_DATABASE", "curve-ai-staging"),
    r2BucketName: getOptionalEnv("CLOUDFLARE_R2_BUCKET_NAME", "curve-ai-staging-artifacts"),
    pagesBranch: getOptionalEnv("CLOUDFLARE_PAGES_BRANCH", "main"),
    pagesProjects: {
      onboarding: getOptionalEnv("CLOUDFLARE_PAGES_ONBOARDING_PROJECT", "curve-ai-onboarding"),
      ops: getOptionalEnv("CLOUDFLARE_PAGES_OPS_PROJECT", "curve-ai-ops"),
      staff: getOptionalEnv("CLOUDFLARE_PAGES_STAFF_PROJECT", "curve-ai-staff"),
      upload: getOptionalEnv("CLOUDFLARE_PAGES_UPLOAD_PROJECT", "curve-ai-upload"),
    },
  };
}

export function defaultWorkerUrl({ workerName, workersSubdomain }) {
  if (!workersSubdomain) {
    return undefined;
  }
  return `https://${workerName}.${workersSubdomain}.workers.dev`;
}
