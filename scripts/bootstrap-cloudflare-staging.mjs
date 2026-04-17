#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  cfApi,
  defaultCloudflareNames,
  defaultWorkerUrl,
  runWrangler,
} from "./cloudflare-utils.mjs";

const names = defaultCloudflareNames();
const args = new Set(process.argv.slice(2));
const shouldWriteWrangler = args.has("--write-wrangler");

const workersSubdomain = await ensureWorkersSubdomain(names);
const d1Database = await ensureD1Database(names.accountId, names.d1DatabaseName);
const r2Bucket = await ensureR2Bucket(names.accountId, names.r2BucketName);
await ensurePagesProjects(names);

if (shouldWriteWrangler) {
  await writeWorkerConfig({
    databaseId: d1Database.uuid,
    workerUrl: defaultWorkerUrl({
      workerName: names.workerName,
      workersSubdomain,
    }),
  });
}

const workerUrl = defaultWorkerUrl({
  workerName: names.workerName,
  workersSubdomain,
});

console.log(JSON.stringify({
  ok: true,
  d1DatabaseId: d1Database.uuid,
  d1DatabaseName: d1Database.name,
  r2BucketName: r2Bucket.name,
  workersSubdomain,
  workerUrl,
  pagesProjects: names.pagesProjects,
}, null, 2));

console.log("\nExport these for deploys:");
console.log(`CLOUDFLARE_D1_DATABASE_ID=${d1Database.uuid}`);
console.log(`CLOUDFLARE_D1_DATABASE=${d1Database.name}`);
console.log(`CLOUDFLARE_R2_BUCKET_NAME=${r2Bucket.name}`);
if (workerUrl) {
  console.log(`VITE_API_BASE_URL=${workerUrl}`);
}

async function ensureWorkersSubdomain(config) {
  const existing = await cfApi(`/accounts/${config.accountId}/workers/subdomain`, {
    method: "GET",
  }).catch(() => undefined);
  const existingSubdomain = existing?.result?.subdomain?.trim();
  if (existingSubdomain) {
    return existingSubdomain;
  }

  if (!config.workersSubdomain) {
    throw new Error(
      "No Workers subdomain exists for this account. Set CLOUDFLARE_WORKERS_SUBDOMAIN and rerun bootstrap.",
    );
  }

  const created = await cfApi(`/accounts/${config.accountId}/workers/subdomain`, {
    method: "PUT",
    body: JSON.stringify({
      subdomain: config.workersSubdomain,
    }),
  });
  return created.result?.subdomain ?? config.workersSubdomain;
}

async function ensureD1Database(accountId, databaseName) {
  const listed = await cfApi(`/accounts/${accountId}/d1/database`, {
    method: "GET",
  });
  const existing = (listed.result ?? []).find((database) => database?.name === databaseName);
  if (existing) {
    return existing;
  }
  const created = await cfApi(`/accounts/${accountId}/d1/database`, {
    method: "POST",
    body: JSON.stringify({
      name: databaseName,
    }),
  });
  return created.result;
}

async function ensureR2Bucket(accountId, bucketName) {
  const listed = await cfApi(`/accounts/${accountId}/r2/buckets`, {
    method: "GET",
  });
  const buckets = listed.result?.buckets ?? [];
  const existing = buckets.find((bucket) => bucket?.name === bucketName);
  if (existing) {
    return existing;
  }
  const created = await cfApi(`/accounts/${accountId}/r2/buckets`, {
    method: "POST",
    body: JSON.stringify({
      name: bucketName,
    }),
  });
  return created.result;
}

async function ensurePagesProjects(config) {
  const listed = await cfApi(`/accounts/${config.accountId}/pages/projects`, {
    method: "GET",
  });
  const existingNames = new Set((listed.result ?? []).map((project) => project?.name).filter(Boolean));
  for (const name of Object.values(config.pagesProjects)) {
    if (existingNames.has(name)) {
      continue;
    }
    runWrangler(["pages", "project", "create", name, "--production-branch", config.pagesBranch]);
  }
}

async function writeWorkerConfig(input) {
  const wranglerPath = path.resolve("apps/edge-api/wrangler.jsonc");
  let config = readFileSync(wranglerPath, "utf8");
  config = config.replace(
    /"database_id":\s*"[^"]+"/,
    `"database_id": "${input.databaseId}"`,
  );
  if (input.workerUrl) {
    config = config.replace(
      /"PUBLIC_API_URL":\s*"[^"]+"/,
      `"PUBLIC_API_URL": "${input.workerUrl}"`,
    );
  }
  writeFileSync(wranglerPath, config, "utf8");
}
