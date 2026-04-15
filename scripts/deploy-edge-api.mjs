#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const appDir = path.join(repoRoot, "apps", "edge-api");
const sourceConfigPath = path.join(appDir, "wrangler.jsonc");
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
const workerName = process.env.CLOUDFLARE_WORKER_NAME?.trim();
const artifactsBucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim();

if (!databaseId) {
  console.error("CLOUDFLARE_D1_DATABASE_ID must be set before deploying the edge Worker.");
  process.exit(1);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "curve-ai-edge-deploy-"));
const renderedConfigPath = path.join(tempDir, "wrangler.rendered.jsonc");

try {
  let config = readFileSync(sourceConfigPath, "utf8");
  config = config.replace("replace-in-cloudflare-dashboard", databaseId);
  if (workerName) {
    config = config.replace('"name": "curve-ai-api-staging"', `"name": "${workerName}"`);
  }
  if (artifactsBucketName) {
    config = config.replace('"bucket_name": "curve-ai-staging-artifacts"', `"bucket_name": "${artifactsBucketName}"`);
  }
  writeFileSync(renderedConfigPath, config, "utf8");

  const migrateResult = spawnSync("npm", ["run", "migrate:d1:remote", "-w", "@curve-ai/edge-api"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if ((migrateResult.status ?? 1) !== 0) {
    process.exit(migrateResult.status ?? 1);
  }

  const deployResult = spawnSync("npx", ["wrangler", "deploy", "--config", renderedConfigPath], {
    cwd: appDir,
    stdio: "inherit",
    shell: true,
  });
  process.exit(deployResult.status ?? 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
