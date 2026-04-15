# MVP Board

## In Progress

- Provider adapters: replace mock ElevenLabs browser, Microsoft calendar, and Twilio behavior with live clients behind the existing onboarding and voice routes.
- Portable orchestration: keep the onboarding control plane provider-neutral so reasoning and voice components can move to Australian self-hosted infrastructure later.
- Cloudflare deployment: serve the web UI from Pages, use Workers/Functions for secure edge routes, and keep the control plane portable rather than collapsing the backend into static hosting assumptions.
- Security hardening: add content sniffing for uploads and move from file-backed CRM persistence to a real database.

## Next

- Add verified provider webhook handlers for live call events, SMS delivery, and Outlook booking state changes.
- Wire the iOS app to real calendar OAuth and voice-sample upload flows instead of placeholder fields.
- Add end-to-end smoke coverage for signed voice requests, onboarding interview turns, audio upload completion, SMS photo links, and staff job refresh.

## Done

- Added admin auth to internal API routes and signed HMAC verification to `/voice/*`.
- Made dashboard reads side-effect free and quarantined malformed CRM snapshots instead of crashing on boot.
- Strengthened staff onboarding with invite-code-bound OTP verification, lockout after repeated failures, and short-lived staff sessions.
- Added authenticated `/jobs` and `/staff/me` endpoints for the staff app.
- Added API coverage for auth boundaries, OTP/session lifecycle, snapshot recovery, upload prevalidation, and signed voice requests.
- Added web auth gating, honest failure states, upload validation tests, and session-scoped admin token storage.
- Replaced the iOS tab scaffold with a step-based onboarding flow, a live/mock API client seam, and XCTest coverage for the onboarding state machine.
- Added browser-first onboarding with shared contracts, secure invite sessions, consent-gated realtime voice provisioning, extraction review, Microsoft connect, and multipart voice sample upload.
- Added backend guardrails so onboarding cannot mint a realtime session without consent or finalize without a connected calendar and a real audio sample.

## Review Queue

- Move the API-side onboarding serializers onto shared schemas directly so the route payloads and shared contracts cannot drift at runtime.
- Revisit admin-token auth for the web console before production; session storage is better than local storage, but not a final control plane auth story.
- Revisit OTP issuance and transport once Twilio Verify is wired in; the current in-house flow is an MVP guardrail, not a final identity solution.
