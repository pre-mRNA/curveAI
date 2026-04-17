# Curve AI

Curve AI is a greenfield platform for tradie-focused voice agents, dynamic quoting, Outlook scheduling, SMS photo collection, and staff operations.

## Active Plan

The current working backlog is tracked in [docs/mvp-board.md](docs/mvp-board.md).
The execution history is persisted in [docs/agent-log.md](docs/agent-log.md).
Cloudflare deployment guidance for the split Pages + Worker stack is in [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md).
The current deployment target is Cloudflare Pages for the split browser apps plus a Cloudflare Worker API, replacing the earlier Fly-hosted staging shape.

## Workspace

- `apps/edge-api`: Cloudflare Worker API for staging deployment, browser onboarding, staff session/auth routes, ops/dashboard routes, voice tools, authenticated photo delivery, D1/R2/DO bindings, and Worker-native provider adapters
- `apps/web`: public onboarding app
- `apps/ops-web`: internal ops dashboard plus Worker-backed AI test studio
- `apps/staff-web`: phone-first staff Pages app for queue and setup workflows
- `apps/upload-web`: public customer photo upload app
- `packages/shared`: shared onboarding contracts, AI test studio schemas, branding tokens, and shared browser-facing types
- `docs/mvp-board.md`: local Kanban board for active MVP work

## Run

1. Put local secrets in the untracked `secrets` file or copy `secrets.local.env.example` to `secrets.local.env`.
   For Cloudflare staging deploys, copy `cloudflare.staging.env.example` into your shell or CI secret manager and fill in the real values first.
   `npm run dev:edge-api` now auto-bridges provider keys from the repo-local `secrets` file first, then falls back to shell env for `OPENAI_API_KEY`, into the untracked Worker dev vars when the explicit Cloudflare names are still missing. Those auto-managed local entries are also cleaned back to `mock` mode if the source secret disappears, so stale paid-provider config does not linger silently.
   For local integration testing without real provider accounts, the Worker now serves mock provider routes under `/mock/providers/*`. You can point `ELEVENLABS_BASE_URL`, `MICROSOFT_AUTH_BASE_URL`, `MICROSOFT_GRAPH_BASE_URL`, and `TWILIO_BASE_URL` at `http://127.0.0.1:8787/mock/providers/...` to exercise configured-mode realtime, calendar, appointment-booking, and SMS flows against local mocks instead of live providers.
2. Install workspace dependencies with `npm install`.
3. Start the Cloudflare Worker API with `npm run dev:edge-api`.
4. Start the onboarding app with `npm run dev:web`, the ops dashboard with `npm run dev:ops-web`, the staff app with `npm run dev:staff-web`, or the upload app with `npm run dev:upload-web`.
5. Run Worker API tests with `npm run test:edge-api`.
6. Run web tests with `npm run test:web`, `npm run test:ops-web`, `npm run test:staff-web`, and `npm run test:upload-web`.
7. Run the shared Pages review-gate tests with `npm run test:pages-gate`.
8. For Cloudflare staging deploys, set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`, `CLOUDFLARE_D1_DATABASE`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_R2_BUCKET_NAME`, and `VITE_API_BASE_URL`. Prefer Cloudflare Access for the Pages apps plus the Worker API. The per-Pages `REVIEW_PASSCODE` + `REVIEW_COOKIE_SECRET` gate is only a fallback for the Pages hosts themselves.
9. Use `npm run bootstrap:cloudflare:staging` to provision the D1 database, R2 bucket, workers.dev subdomain, and Pages projects idempotently. Pass `--write-wrangler` if you want the script to update the checked-in Worker staging config with the discovered D1 ID and worker URL.
10. Use `npm run secrets:cloudflare:staging` to push Worker and Pages review-gate secrets from your shell env to Cloudflare.
11. Use `npm run deploy:cloudflare:staging` to deploy the Worker and all four Pages apps, then `npm run smoke:cloudflare:staging` to verify the live Worker health and Pages review gates.

## Auth Model

- Internal ops routes use an admin bearer token.
- `/voice/*` automation routes require an HMAC signature using `AUTOMATION_SHARED_SECRET` over `timestamp.method.path.rawBody`.
- Browser onboarding uses an invite code to mint a session-specific onboarding token, then requires explicit recording and clone consent before issuing a realtime voice session.
- Browser onboarding cannot finalize until calendar connect and a real audio voice sample are both present.
- Staff Pages auth now runs through the Cloudflare Worker using invite + OTP, then issues an `HttpOnly` browser session cookie for queue/setup access instead of exposing reusable staff bearer tokens to the browser.
- Customer photo uploads use opaque upload tokens, live on the dedicated upload Pages app, hash those tokens before they hit D1, store artifacts in R2 through the Worker, and expose photos back to ops through authenticated Worker asset routes instead of bearer URLs.

## Onboarding

- `/onboard/:inviteCode` is the first real onboarding surface.
- The browser flow runs consent -> interview -> extraction review -> Microsoft calendar connect -> clean voice sample -> finalize.
- API reasoning, realtime voice, calendar, and clone behavior sit behind provider interfaces so the control plane can move toward self-hosted Australian infrastructure later without rewriting the product flow.
- Onboarding session bearer tokens now expire with the invite window, completed sessions are immutable, and configured Microsoft callbacks require a real auth code instead of trusting query-string identity data.
- The Cloudflare Worker now owns dashboard reads, job cards, upload token/photo flows, authenticated photo assets, and `voice/post-call` ingestion in addition to onboarding.
- Voice appointment booking now attempts a provider-backed Microsoft calendar event write when a staff calendar connection includes an external provider token, and `send-photo-link` now attempts a provider-backed SMS delivery instead of only creating a local upload request.
- The internal AI test studio now persists fixed cases and judged runs through the Cloudflare Worker instead of browser-only local state.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:edge-api`
- `npm run test:pages-gate`
- `npm run test:web`
- `npm run test:ops-web`
- `npm run test:staff-web`
- `npm run test:upload-web`
- `npm run smoke:cloudflare:staging`

## Security

- Local secrets are expected in an untracked `secrets` or `secrets.local.env` file.
- Do not commit provider keys, Twilio credentials, or Outlook OAuth secrets.
- Production secrets should be moved to managed secret stores.
- The ops dashboard keeps the admin token in memory only, and the onboarding/staff apps now rely on Worker-issued `HttpOnly` cookies instead of browser-visible reusable session tokens.
- The Pages fallback review gate now fails closed on non-local hosts when `REVIEW_PASSCODE` or `REVIEW_COOKIE_SECRET` is missing.
- Worker readiness now distinguishes blocking platform issues from advisory provider issues: non-local traffic only fails closed on blocking config gaps, while partial ElevenLabs/OpenAI/Microsoft setup is surfaced through `/health` for admin and local callers.
