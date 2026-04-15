#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const databaseName = process.env.CLOUDFLARE_D1_DATABASE?.trim() || "curve-ai-staging";

if (mode !== "--local" && mode !== "--remote") {
  console.error("Usage: node scripts/run-d1-migrations.mjs --local|--remote");
  process.exit(1);
}

const result = spawnSync(
  "wrangler",
  ["d1", "migrations", "apply", databaseName, mode],
  {
    stdio: "inherit",
    shell: true,
  },
);

process.exit(result.status ?? 1);
