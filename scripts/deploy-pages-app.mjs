#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const [appDir, workspaceName, projectName] = process.argv.slice(2);
const branch = process.env.CLOUDFLARE_PAGES_BRANCH?.trim();

if (!appDir || !workspaceName || !projectName) {
  console.error("Usage: node scripts/deploy-pages-app.mjs <app-dir> <workspace-name> <project-name>");
  process.exit(1);
}

if (!process.env.VITE_API_BASE_URL?.trim()) {
  console.error("VITE_API_BASE_URL must be set before deploying a Pages app.");
  process.exit(1);
}

const buildResult = spawnSync("npm", ["run", "build", "-w", workspaceName], {
  stdio: "inherit",
  shell: true,
});

if ((buildResult.status ?? 1) !== 0) {
  process.exit(buildResult.status ?? 1);
}

const deployArgs = ["wrangler", "pages", "deploy", "dist", "--project-name", projectName];
if (branch) {
  deployArgs.push("--branch", branch);
}

const deployResult = spawnSync("npx", deployArgs, {
  cwd: appDir,
  stdio: "inherit",
  shell: true,
});

process.exit(deployResult.status ?? 1);
