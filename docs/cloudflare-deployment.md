# Cloudflare Deployment

## Recommendation

Deploy the web surfaces on separate `Cloudflare Pages` projects and the backend on a separate `Cloudflare Worker` API.
Do not treat this app as "static Pages only". The product needs server-side secrets, signed session issuance, OAuth callbacks, upload validation, and session/state coordination.

## Target Topology

- `Pages` hosts separate browser apps for onboarding, internal ops, and customer uploads.
- `Workers` hosts the API surface, including onboarding, health, uploads, provider glue, and admin-only routes.
- `D1` stores durable relational state for staff, invites, onboarding sessions, jobs, quotes, uploads, and provider metadata.
- `R2` stores photos, voice samples, and other artifacts.
- `Durable Objects` coordinate live onboarding sessions and any turn-order sensitive flow.
- `Cloudflare Access` protects the internal ops Pages app in staging; the onboarding and customer upload apps stay public but token-gated.

## Canonical Bindings And Env Vars

Use these as the deployment contract for the Worker:

- `DB` - D1 binding for primary records
- `ARTIFACTS_BUCKET` - R2 binding for uploads and voice artifacts
- `ONBOARDING_SESSIONS` - Durable Object namespace for live interview coordination
- `PUBLIC_OPS_APP_URL` - internal ops Pages origin
- `PUBLIC_ONBOARDING_APP_URL` - public onboarding Pages origin
- `PUBLIC_UPLOAD_APP_URL` - public customer upload Pages origin
- `PUBLIC_API_URL` - Worker origin
- `ALLOWED_ORIGINS` - comma-separated CORS allowlist for the Pages origins
- `ADMIN_TOKEN` - admin auth for internal routes
- `AUTOMATION_SHARED_SECRET` - HMAC secret for automation and voice routes
- `ASSET_SIGNING_SECRET` - HMAC secret for signed photo asset URLs
- `ELEVENLABS_API_KEY` - ElevenLabs provider key
- `ELEVENLABS_AGENT_ID` - ElevenLabs browser agent identifier
- `REASONING_PROVIDER` - `mock`, `hosted`, or `openai-compatible`
- `REASONING_BASE_URL` - base URL for the portable reasoning endpoint
- `REASONING_API_KEY` - API key for the reasoning provider

Microsoft and Twilio secrets stay optional in staging until those integrations are enabled.
When they are added later, keep them server-side only and wire them through the Worker, not the browser.

## Why This Replaces Fly

The earlier staging shape used Fly for the API because the app was still an Express server with local persistence.
Cloudflare-native hosting removes that dependency:

- `Pages` replaces the static frontend hosting role.
- `Workers` replaces the Node API hosting role.
- `D1` replaces the file-backed state layer.
- `R2` replaces local upload storage.
- `Durable Objects` replace the need for a long-lived Node process for live onboarding coordination.

This is a real platform shift, not a config-only swap.
The implementation work is a Worker rewrite of the API boundary, but the deployment docs now treat Cloudflare as the target runtime and Fly as deprecated for this repo.

## Staging Shape

- Staging should be internal-only behind Cloudflare Access.
- Use dedicated Pages projects for onboarding, ops, and uploads, plus a separate Worker route for the API.
- Keep provider callbacks and signed upload endpoints reachable through the API origin, but still state-bound and token-checked.
- Keep the three public app URLs and the API URL explicit so the browser never depends on same-origin assumptions.

## Local Development

- The repo now includes a dedicated Worker app at `apps/edge-api`.
- Use `npm run dev:edge-api` for the Cloudflare-targeted API, `npm run dev:web` for onboarding, `npm run dev:ops-web` for the internal dashboard, and `npm run dev:upload-web` for the customer upload flow.
- Keep the Express app only as a local reference while the remaining non-onboarding routes are migrated.
- Mirror the Cloudflare env names locally so production and dev use the same vocabulary.
- Use lowercase aliases only as temporary compatibility shims if an existing secret file already contains them.

## Notes

- Static Pages alone is not enough for this product.
- The deployment target is Cloudflare-only, and the repo now includes Worker implementations for health, dashboard auth, browser onboarding, Microsoft callback handling, upload token/photo flows, signed photo assets, and the current voice tool endpoints including post-call ingestion.
- The Express app remains a local reference, but the Cloudflare route surface is now the primary staging path for onboarding, ops, and customer uploads.
- Keep core business logic portable so the worker runtime can be swapped or self-hosted later if needed.
