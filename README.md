# Curve AI

Curve AI is a greenfield platform for tradie-focused voice agents, dynamic quoting, Outlook scheduling, SMS photo collection, and staff operations.

## Active Plan

The current working plan is persisted in [docs/agent-log.md](docs/agent-log.md).
Cloudflare deployment guidance for the onboarding app is in [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md).

## Workspace

- `apps/api`: voice-control API, lightweight CRM backend, uploads, browser onboarding endpoints, and portable provider adapters
- `apps/web`: internal ops console, browser staff onboarding, and customer photo upload flow
- `apps/ios`: native SwiftUI staff app
- `packages/shared`: shared domain models, onboarding contracts, and pricing logic
- `docs/mvp-board.md`: local Kanban board for active MVP work

## Run

1. Put local secrets in the untracked `secrets` file or copy `secrets.local.env.example` to `secrets.local.env`.
2. Install workspace dependencies with `npm install`.
3. Start the API with `npm run dev:api`.
4. Start the web console with `npm run dev:web`.
5. Open the iOS app from `apps/ios/TradieAI.xcodeproj`.
6. Run backend tests with `npm run test:api`.
7. Run web tests with `npm run test -w @curve-ai/web`.

## Auth Model

- Internal ops routes use an admin bearer token or `X-Admin-Token`.
- `/voice/*` automation routes require an HMAC signature using `AUTOMATION_SHARED_SECRET` over `timestamp.rawBody`.
- Browser onboarding uses an invite code to mint a session-specific onboarding token, then requires explicit recording and clone consent before issuing a realtime voice session.
- Browser onboarding cannot finalize until calendar connect and a real audio voice sample are both present.
- Staff app auth still uses invite + OTP, then mints a short-lived staff session token for iOS requests.
- Customer photo uploads use opaque upload tokens and are rejected before file writes if the token is missing or expired.

## Onboarding

- `/onboard/:inviteCode` is the first real onboarding surface.
- The browser flow runs consent -> interview -> extraction review -> Microsoft calendar connect -> clean voice sample -> finalize.
- API reasoning, realtime voice, calendar, and clone behavior sit behind provider interfaces so the control plane can move toward self-hosted Australian infrastructure later without rewriting the product flow.
- Onboarding session bearer tokens now expire with the invite window, completed sessions are immutable, and configured Microsoft callbacks require a real auth code instead of trusting query-string identity data.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:api`
- `npm run test -w @curve-ai/web`
- `xcodebuild -list -project apps/ios/TradieAI.xcodeproj`

## Security

- Local secrets are expected in an untracked `secrets` or `secrets.local.env` file.
- Do not commit provider keys, Twilio credentials, or Outlook OAuth secrets.
- Production secrets should be moved to managed secret stores.
- The web console now keeps the admin token in session storage instead of long-lived local storage.
