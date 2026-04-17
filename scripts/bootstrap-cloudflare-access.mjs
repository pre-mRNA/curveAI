#!/usr/bin/env node

import { cfApi, defaultCloudflareNames, defaultWorkerUrl, getOptionalEnv } from "./cloudflare-utils.mjs";

const names = defaultCloudflareNames();
const sessionDuration = getOptionalEnv("CLOUDFLARE_ACCESS_SESSION_DURATION", "24h");
const allowedEmails = splitCsv("CLOUDFLARE_ACCESS_ALLOWED_EMAILS");
const allowedDomains = splitCsv("CLOUDFLARE_ACCESS_ALLOWED_EMAIL_DOMAINS");
const allowDomainPolicies = getOptionalEnv("CLOUDFLARE_ACCESS_ALLOW_DOMAIN_POLICIES", "false") === "true";

if (!allowedEmails.length && !allowedDomains.length) {
  throw new Error(
    "Set CLOUDFLARE_ACCESS_ALLOWED_EMAILS before bootstrapping Cloudflare Access.",
  );
}

if (allowedDomains.length && !allowDomainPolicies) {
  throw new Error(
    "Cloudflare Access domain allowlists are disabled by default. Set CLOUDFLARE_ACCESS_ALLOW_DOMAIN_POLICIES=true only if you intentionally want broader review access.",
  );
}

const workerUrl =
  getOptionalEnv("PUBLIC_API_URL") ??
  defaultWorkerUrl({
    workerName: names.workerName,
    workersSubdomain: names.workersSubdomain,
  });

if (!workerUrl) {
  throw new Error("PUBLIC_API_URL or CLOUDFLARE_WORKERS_SUBDOMAIN must be set to bootstrap Access for the Worker API.");
}

const targets = [
  {
    key: "onboarding",
    name: "Curve AI Staging - Onboarding",
    hostname: `${names.pagesProjects.onboarding}.pages.dev`,
  },
  {
    key: "ops",
    name: "Curve AI Staging - Ops",
    hostname: `${names.pagesProjects.ops}.pages.dev`,
  },
  {
    key: "staff",
    name: "Curve AI Staging - Staff",
    hostname: `${names.pagesProjects.staff}.pages.dev`,
  },
  {
    key: "upload",
    name: "Curve AI Staging - Upload",
    hostname: `${names.pagesProjects.upload}.pages.dev`,
  },
  {
    key: "api",
    name: "Curve AI Staging - API",
    hostname: new URL(workerUrl).host,
  },
];

const listed = await cfApi(`/accounts/${names.accountId}/access/apps`, {
  method: "GET",
}).catch((error) => {
  throw new Error(
    `Cloudflare Access bootstrap failed before listing apps. Ensure the API token has Access: Apps and Policies Write. ${error.message}`,
  );
});

const existingApps = listed.result ?? [];
const results = [];

for (const target of targets) {
  const domain = `${target.hostname}/*`;
  const payload = {
    name: target.name,
    type: "self_hosted",
    domain,
    session_duration: sessionDuration,
    app_launcher_visible: false,
    allow_authenticate_via_warp: false,
    policies: [
      {
        name: `${target.name} reviewers`,
        decision: "allow",
        precedence: 1,
        session_duration: sessionDuration,
        include: [
          ...allowedEmails.map((email) => ({
            email: { email },
          })),
          ...(allowDomainPolicies
            ? allowedDomains.map((domainName) => ({
                email_domain: { domain: domainName },
              }))
            : []),
        ],
        exclude: [],
        require: [],
      },
    ],
  };

  const existing = existingApps.find((app) => app?.domain === domain || app?.name === target.name);
  const response = existing
    ? await cfApi(`/accounts/${names.accountId}/access/apps/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      })
    : await cfApi(`/accounts/${names.accountId}/access/apps`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

  results.push({
    key: target.key,
    name: target.name,
    domain,
    id: response.result?.id ?? existing?.id ?? null,
    updated: Boolean(existing),
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sessionDuration,
      allowedEmails,
      allowedDomains,
      allowDomainPolicies,
      targets: results,
    },
    null,
    2,
  ),
);

function splitCsv(name) {
  return (getOptionalEnv(name, "") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
