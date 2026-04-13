# MVP Board

## In Progress

- Provider adapters: replace scaffolded Twilio, ElevenLabs, and Microsoft Graph behavior with live clients behind the existing API routes.
- Shared contracts: unify `packages/shared` with the API and iOS/web DTOs so the repo stops carrying parallel vocabularies.
- Security hardening: add content sniffing for uploads and move from file-backed CRM persistence to a real database.

## Next

- Add verified provider webhook handlers for live call events, SMS delivery, and Outlook booking state changes.
- Wire the iOS app to real calendar OAuth and voice-sample upload flows instead of placeholder fields.
- Add end-to-end smoke coverage for signed voice requests, SMS photo links, upload completion, and staff job refresh.

## Done

- Added admin auth to internal API routes and signed HMAC verification to `/voice/*`.
- Made dashboard reads side-effect free and quarantined malformed CRM snapshots instead of crashing on boot.
- Strengthened staff onboarding with invite-code-bound OTP verification, lockout after repeated failures, and short-lived staff sessions.
- Added authenticated `/jobs` and `/staff/me` endpoints for the staff app.
- Added API coverage for auth boundaries, OTP/session lifecycle, snapshot recovery, upload prevalidation, and signed voice requests.
- Added web auth gating, honest failure states, upload validation tests, and session-scoped admin token storage.
- Replaced the iOS tab scaffold with a step-based onboarding flow, a live/mock API client seam, and XCTest coverage for the onboarding state machine.

## Review Queue

- Check whether the new `/jobs` payload should move into `packages/shared` before provider integration expands it further.
- Revisit admin-token auth for the web console before production; session storage is better than local storage, but not a final control plane auth story.
- Revisit OTP issuance and transport once Twilio Verify is wired in; the current in-house flow is an MVP guardrail, not a final identity solution.
