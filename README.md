# Curve AI

Curve AI is a greenfield platform for tradie-focused voice agents, dynamic quoting, Outlook scheduling, SMS photo collection, and staff operations.

## Active Plan

The current working plan is persisted in [docs/agent-log.md](docs/agent-log.md).
Cloudflare deployment guidance for the onboarding app is in [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md).
The current deployment target is Cloudflare Pages for the split browser apps plus a Cloudflare Worker API, replacing the earlier Fly-hosted staging shape.

## Workspace

- `apps/api`: existing Express API scaffold for voice-control routes, lightweight CRM behavior, uploads, and local development reference
- `apps/edge-api`: Cloudflare Worker API for staging deployment, browser onboarding, staff session/auth routes, ops/dashboard routes, voice tools, signed photo delivery, D1/R2/DO bindings, and Worker-native provider adapters
- `apps/web`: public onboarding app
- `apps/ops-web`: internal ops dashboard plus Worker-backed AI test studio
- `apps/staff-web`: phone-first staff Pages app that currently replaces the native pilot for queue/setup testing
- `apps/upload-web`: public customer photo upload app
- `apps/ios`: deferred native SwiftUI staff app reference
- `packages/shared`: shared domain models, onboarding contracts, and pricing logic
- `docs/mvp-board.md`: local Kanban board for active MVP work

## Run

1. Put local secrets in the untracked `secrets` file or copy `secrets.local.env.example` to `secrets.local.env`.
2. Install workspace dependencies with `npm install`.
3. Start the Express reference API with `npm run dev:api` if you need the older local stack.
4. Start the Cloudflare Worker API with `npm run dev:edge-api` for the current deployment target.
5. Start the onboarding app with `npm run dev:web`, the ops dashboard with `npm run dev:ops-web`, the staff app with `npm run dev:staff-web`, or the upload app with `npm run dev:upload-web`.
6. Open the iOS app from `apps/ios/TradieAI.xcodeproj` only if you need the deferred native reference surface.
7. Run Express API tests with `npm run test:api`.
8. Run Worker API tests with `npm run test:edge-api`.
9. Run web tests with `npm run test:web`, `npm run test:ops-web`, and `npm run test:upload-web`.

## Auth Model

- Internal ops routes use an admin bearer token or `X-Admin-Token`.
- `/voice/*` automation routes require an HMAC signature using `AUTOMATION_SHARED_SECRET` over `timestamp.rawBody`.
- Browser onboarding uses an invite code to mint a session-specific onboarding token, then requires explicit recording and clone consent before issuing a realtime voice session.
- Browser onboarding cannot finalize until calendar connect and a real audio voice sample are both present.
- Staff Pages auth now runs through the Cloudflare Worker using invite + OTP, then mints a short-lived staff session token for browser queue/setup access.
- Customer photo uploads use opaque upload tokens, live on the dedicated upload Pages app, store artifacts in R2 through the Worker, and expose photos back to ops through signed Worker asset URLs.

## Onboarding

- `/onboard/:inviteCode` is the first real onboarding surface.
- The browser flow runs consent -> interview -> extraction review -> Microsoft calendar connect -> clean voice sample -> finalize.
- API reasoning, realtime voice, calendar, and clone behavior sit behind provider interfaces so the control plane can move toward self-hosted Australian infrastructure later without rewriting the product flow.
- Onboarding session bearer tokens now expire with the invite window, completed sessions are immutable, and configured Microsoft callbacks require a real auth code instead of trusting query-string identity data.
- The Cloudflare Worker now owns dashboard reads, job cards, upload token/photo flows, signed photo assets, and `voice/post-call` ingestion in addition to onboarding.
- The internal AI test studio now persists fixed cases and judged runs through the Cloudflare Worker instead of browser-only local state.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:edge-api`
- `npm run test:api`
- `npm run test -w @curve-ai/web`
- `npm run test -w @curve-ai/ops-web`
- `npm run test -w @curve-ai/staff-web`
- `xcodebuild -list -project apps/ios/TradieAI.xcodeproj`

## Security

- Local secrets are expected in an untracked `secrets` or `secrets.local.env` file.
- Do not commit provider keys, Twilio credentials, or Outlook OAuth secrets.
- Production secrets should be moved to managed secret stores.
- The ops dashboard now keeps the admin token in session storage instead of long-lived local storage.
