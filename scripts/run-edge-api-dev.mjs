#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const edgeApiDir = resolve(repoRoot, "apps/edge-api");
const devVarsPath = resolve(edgeApiDir, ".dev.vars");
const secretsPath = resolve(repoRoot, "secrets");
const OPENAI_REASONING_MANAGED_KEYS = [
  "REASONING_BASE_URL",
  "REASONING_API_KEY",
  "REASONING_MODEL",
];
const OPENAI_AI_TEST_RUNNER_MANAGED_KEYS = [
  "AI_TEST_RUNNER_BASE_URL",
  "AI_TEST_RUNNER_API_KEY",
  "AI_TEST_RUNNER_MODEL",
];
const OPENAI_AI_TEST_JUDGE_MANAGED_KEYS = [
  "AI_TEST_JUDGE_BASE_URL",
  "AI_TEST_JUDGE_API_KEY",
  "AI_TEST_JUDGE_MODEL",
];

const existingVars = parseEnvFile(devVarsPath);
const secretsVars = parseEnvFile(secretsPath);
const mergedVars = { ...existingVars };
const enabledKeys = [];
const elevenLabsApiKey = firstNonEmpty(
  secretsVars.ELEVENLABS_API_KEY,
  secretsVars.elevenlabs_api_key,
);
const openAiApiKey = firstNonEmpty(
  secretsVars.OPENAI_API_KEY,
  secretsVars.openai_api_key,
  process.env.OPENAI_API_KEY,
);

if (elevenLabsApiKey) {
  mergedVars.ELEVENLABS_API_KEY = elevenLabsApiKey;
  enabledKeys.push("ELEVENLABS_API_KEY");
} else if (mergedVars.ELEVENLABS_API_KEY) {
  delete mergedVars.ELEVENLABS_API_KEY;
}

if (openAiApiKey) {
  if (!mergedVars.REASONING_PROVIDER || ["heuristic", "mock"].includes(mergedVars.REASONING_PROVIDER)) {
    mergedVars.REASONING_PROVIDER = "openai-compatible";
    enabledKeys.push("REASONING_PROVIDER");
  }
  if (mergedVars.REASONING_PROVIDER === "openai-compatible") {
    if (!mergedVars.REASONING_BASE_URL) {
      mergedVars.REASONING_BASE_URL = "https://api.openai.com/v1/responses";
      enabledKeys.push("REASONING_BASE_URL");
    }
    mergedVars.REASONING_API_KEY = openAiApiKey;
    enabledKeys.push("REASONING_API_KEY");
    if (!mergedVars.REASONING_MODEL) {
      mergedVars.REASONING_MODEL = "gpt-4.1-mini";
      enabledKeys.push("REASONING_MODEL");
    }
  }

  if (!mergedVars.AI_TEST_RUNNER_PROVIDER || ["heuristic", "mock"].includes(mergedVars.AI_TEST_RUNNER_PROVIDER)) {
    mergedVars.AI_TEST_RUNNER_PROVIDER = "openai-compatible";
    enabledKeys.push("AI_TEST_RUNNER_PROVIDER");
  }
  if (mergedVars.AI_TEST_RUNNER_PROVIDER === "openai-compatible") {
    if (!mergedVars.AI_TEST_RUNNER_BASE_URL) {
      mergedVars.AI_TEST_RUNNER_BASE_URL = "https://api.openai.com/v1/responses";
      enabledKeys.push("AI_TEST_RUNNER_BASE_URL");
    }
    mergedVars.AI_TEST_RUNNER_API_KEY = openAiApiKey;
    enabledKeys.push("AI_TEST_RUNNER_API_KEY");
    if (!mergedVars.AI_TEST_RUNNER_MODEL) {
      mergedVars.AI_TEST_RUNNER_MODEL = "gpt-4.1-mini";
      enabledKeys.push("AI_TEST_RUNNER_MODEL");
    }
  }

  if (!mergedVars.AI_TEST_JUDGE_PROVIDER || ["heuristic", "mock"].includes(mergedVars.AI_TEST_JUDGE_PROVIDER)) {
    mergedVars.AI_TEST_JUDGE_PROVIDER = "openai-compatible";
    enabledKeys.push("AI_TEST_JUDGE_PROVIDER");
  }
  if (mergedVars.AI_TEST_JUDGE_PROVIDER === "openai-compatible") {
    if (!mergedVars.AI_TEST_JUDGE_BASE_URL) {
      mergedVars.AI_TEST_JUDGE_BASE_URL = "https://api.openai.com/v1/responses";
      enabledKeys.push("AI_TEST_JUDGE_BASE_URL");
    }
    mergedVars.AI_TEST_JUDGE_API_KEY = openAiApiKey;
    enabledKeys.push("AI_TEST_JUDGE_API_KEY");
    if (!mergedVars.AI_TEST_JUDGE_MODEL) {
      mergedVars.AI_TEST_JUDGE_MODEL = "gpt-4.1-mini";
      enabledKeys.push("AI_TEST_JUDGE_MODEL");
    }
  }
} else {
  if (mergedVars.REASONING_PROVIDER === "openai-compatible") {
    mergedVars.REASONING_PROVIDER = "mock";
  }
  for (const key of OPENAI_REASONING_MANAGED_KEYS) {
    delete mergedVars[key];
  }

  if (mergedVars.AI_TEST_RUNNER_PROVIDER === "openai-compatible") {
    mergedVars.AI_TEST_RUNNER_PROVIDER = "mock";
  }
  for (const key of OPENAI_AI_TEST_RUNNER_MANAGED_KEYS) {
    delete mergedVars[key];
  }

  if (mergedVars.AI_TEST_JUDGE_PROVIDER === "openai-compatible") {
    mergedVars.AI_TEST_JUDGE_PROVIDER = "mock";
  }
  for (const key of OPENAI_AI_TEST_JUDGE_MANAGED_KEYS) {
    delete mergedVars[key];
  }
}

if (renderEnvFile(existingVars) !== renderEnvFile(mergedVars)) {
  writeFileSync(devVarsPath, renderEnvFile(mergedVars));
}

if (enabledKeys.length > 0) {
  console.log(`Updated apps/edge-api/.dev.vars with local secret aliases: ${[...new Set(enabledKeys)].join(", ")}`);
}

if (process.argv.includes("--sync-only")) {
  process.exit(0);
}

const result = spawnSync("wrangler", ["dev"], {
  cwd: edgeApiDir,
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function renderEnvFile(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
