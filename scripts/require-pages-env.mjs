#!/usr/bin/env node

const variableName = process.argv[2];

if (!variableName) {
  console.error("Usage: node scripts/require-pages-env.mjs <ENV_VAR_NAME>");
  process.exit(1);
}

const value = process.env[variableName];
const required = process.env.CF_PAGES === "1" || process.env.REQUIRE_VITE_API_BASE_URL === "true";

if (value && value.trim().length > 0) {
  process.exit(0);
}

if (required) {
  console.error(`${variableName} must be set for Cloudflare Pages or strict production builds.`);
  process.exit(1);
}

console.warn(`${variableName} is not set. Falling back to localhost-friendly runtime behavior.`);
