# Cloudflare Deployment

## Recommendation

Deploy the web surfaces on separate `Cloudflare Pages` projects and the backend on a separate `Cloudflare Worker` API.
Do not treat this app as "static Pages only". The product needs server-side secrets, signed session issuance, OAuth callbacks, upload validation, and session/state coordination.

## Target Topology

- `Pages` hosts separate browser apps for onboarding, internal ops, and customer uploads.
- `Pages` also hosts a staff-facing browser app while the native mobile surface is deferred.
- The internal ops Pages app now also hosts the first Worker-backed AI test studio route.
- `Workers` hosts the API surface, including onboarding, health, uploads, provider glue, and admin-only routes.
- `D1` stores durable relational state for staff, invites, onboarding sessions, jobs, quotes, uploads, and provider metadata.
- `R2` stores photos, voice samples, and other artifacts.
- `Durable Objects` coordinate live onboarding sessions and any turn-order sensitive flow.
- `Cloudflare Access` is the preferred protection layer for staging review across the Pages apps and Worker API.
- A Pages Functions review-passcode gate is now included as a fallback when Zero Trust Access is not configured yet.
  It protects the Pages apps themselves, but it does not fully replace Access for the cross-origin Worker API.

## Canonical Bindings And Env Vars

Use these as the deployment contract for the Worker:

- `DB` - D1 binding for primary records
- `ARTIFACTS_BUCKET` - R2 binding for uploads and voice artifacts
- `ONBOARDING_SESSIONS` - Durable Object namespace for live interview coordination
- `PUBLIC_OPS_APP_URL` - internal ops Pages origin
- `PUBLIC_STAFF_APP_URL` - staff-facing Pages origin if deployed separately
- `PUBLIC_ONBOARDING_APP_URL` - public onboarding Pages origin
- `PUBLIC_UPLOAD_APP_URL` - public customer upload Pages origin
- `PUBLIC_API_URL` - Worker origin
- `ALLOWED_ORIGINS` - comma-separated CORS allowlist for the Pages origins
- `ADMIN_TOKEN` - admin auth for internal routes
- `AUTOMATION_SHARED_SECRET` - HMAC secret for automation and voice routes
- `ALLOW_INSECURE_TEST_OTP` - optional `true` only for isolated local development when the admin invite route should echo raw OTP codes before Twilio Verify exists
- `ELEVENLABS_API_KEY` - ElevenLabs provider key
- `ELEVENLABS_AGENT_ID` - ElevenLabs browser agent identifier
- `REASONING_PROVIDER` - `mock`, `hosted`, or `openai-compatible`
- `REASONING_BASE_URL` - base URL for the portable reasoning endpoint
- `REASONING_API_KEY` - API key for the reasoning provider

Microsoft and Twilio secrets stay optional in staging until those integrations are enabled.
When they are added later, keep them server-side only and wire them through the Worker, not the browser.

Use these as the deployment contract for each Pages app:

- `VITE_API_BASE_URL` - absolute Worker origin compiled into the app bundle
- `REVIEW_PASSCODE` - fallback Pages review-passcode gate
- `REVIEW_COOKIE_SECRET` - cookie-signing secret for the fallback Pages review-passcode gate

Keep `.wrangler/` state and `.dev.vars*` files local-only and gitignored. Miniflare D1/R2/DO state can contain staff records, uploads, and transcripts.

The Pages apps no longer rely on `/api` same-origin behavior in production.
Their build scripts will warn locally when `VITE_API_BASE_URL` is missing and should fail in Pages or strict builds.
Browser auth for onboarding and staff now relies on Worker-issued `HttpOnly` session cookies instead of browser-stored reusable bearer tokens.

Use this env var for migration and deploy scripts:

- `CLOUDFLARE_D1_DATABASE` - target D1 database name for `npm run migrate:d1:*` and `npm run deploy` in `apps/edge-api`
- `CLOUDFLARE_D1_DATABASE_ID` - actual D1 database id used by the env-driven Worker deploy script

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
- Keep the three public app URLs and the API URL explicit.
- For reliable browser sessions, prefer same-site custom domains such as `ops.<your-domain>`, `staff.<your-domain>`, `onboard.<your-domain>`, `upload.<your-domain>`, and `api.<your-domain>` rather than mixing `pages.dev` and `workers.dev` review hosts. Cross-site hostnames can trigger third-party cookie blocking in some browsers.
- If Access is not configured yet, set `REVIEW_PASSCODE` and `REVIEW_COOKIE_SECRET` on each Pages project to enable the fallback review gate.
- That fallback gate is host-local per Pages project. Reviewers will unlock each Pages host separately, and the Worker API still needs Access or equivalent account-side protection for a fully private staging environment.
- The fallback gate now fails closed on non-local hosts if either `REVIEW_PASSCODE` or `REVIEW_COOKIE_SECRET` is missing, so an accidentally unprotected Pages deploy will return `503` instead of serving the app publicly.
- Worker route families are now origin-fenced by app surface:
  - `/dashboard` and `/ai-test-studio/*` only accept the ops origin
  - `/staff/*`, `/jobs*`, and `/assets/*` only accept the staff or ops origin
  - `/onboarding/*` only accept the onboarding or ops origin
  - `/uploads/*` only accept the upload or ops origin

## Local Development

- The repo now includes a dedicated Worker app at `apps/edge-api`.
- Use `npm run dev:edge-api` for the Cloudflare-targeted API, `npm run dev:web` for onboarding, `npm run dev:ops-web` for the internal dashboard, and `npm run dev:upload-web` for the customer upload flow.
- Use `npm run dev:staff-web` for the staff-facing browser app.
- For local Pages builds, set `VITE_API_BASE_URL=http://127.0.0.1:8787`.
- For local D1 migrations, `CLOUDFLARE_D1_DATABASE` defaults to `curve-ai-staging`, but it can be overridden before running the migration or deploy scripts.
- For Worker deploys, the checked-in `apps/edge-api/wrangler.jsonc` stays template-like and `npm run deploy:edge-api` renders a temporary config from `CLOUDFLARE_D1_DATABASE_ID` before calling `wrangler deploy`.
- `cloudflare.staging.env.example` captures the minimal repo-side env contract for Pages + Worker staging deploys.
- That example includes the Worker deploy-time secrets (`ADMIN_TOKEN`, `AUTOMATION_SHARED_SECRET`) but the Pages review-gate secrets still have to be provisioned on each Pages project runtime.
- Keep the Express app only as a local reference while the remaining non-onboarding routes are migrated.
- Mirror the Cloudflare env names locally so production and dev use the same vocabulary.
- Use lowercase aliases only as temporary compatibility shims if an existing secret file already contains them.
- The repo now includes `wrangler.jsonc` files for each Pages app plus `npm run deploy:pages:onboarding`, `deploy:pages:ops`, `deploy:pages:staff`, `deploy:pages:upload`, and `deploy:cloudflare:staging`.

## Notes

- Static Pages alone is not enough for this product.
- The deployment target is Cloudflare-only, and the repo now includes Worker implementations for health, dashboard auth, browser onboarding, Microsoft callback handling, upload token/photo flows, authenticated photo assets, and the current voice tool endpoints including post-call ingestion.
- Automation signatures are route-bound now: callers sign `timestamp.method.path.rawBody`, not just `timestamp.rawBody`.
- The staff browser app currently replaces the native iOS surface for live queue testing; it should be treated as a first-class Pages deployment in CORS and environment setup.
- The AI test studio now depends on the same Worker origin and admin token flow as the ops dashboard, so it should be treated as part of the protected internal Pages surface rather than a separate local-only tool.
- `/health` now reports worker readiness warnings when required public URLs or signing secrets are missing, and non-local requests fail fast when the worker is misconfigured.
- The Express app remains a local reference, but the Cloudflare route surface is now the primary staging path for onboarding, ops, and customer uploads.
- Keep core business logic portable so the worker runtime can be swapped or self-hosted later if needed.
