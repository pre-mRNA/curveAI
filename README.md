# Curve AI

Curve AI is a greenfield platform for tradie-focused voice agents, dynamic quoting, Outlook scheduling, SMS photo collection, and staff operations.

## Active Plan

The current working plan is persisted in [docs/agent-log.md](docs/agent-log.md).

## Workspace

- `apps/api`: voice-control API, lightweight CRM backend, uploads, and staff onboarding endpoints
- `apps/web`: internal ops console and customer photo upload flow
- `apps/ios`: native SwiftUI staff app
- `packages/shared`: shared domain models and pricing logic
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
- Staff onboarding uses invite code + OTP, then mints a short-lived staff session token for iOS requests.
- Customer photo uploads use opaque upload tokens and are rejected before file writes if the token is missing or expired.

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
