# MVP Board

## In Progress

- Provider adapters: replace mock ElevenLabs browser, Microsoft calendar, and Twilio behavior with live clients behind the existing onboarding and voice routes.
- Portable orchestration: keep the onboarding control plane provider-neutral so reasoning and voice components can move to Australian self-hosted infrastructure later.
- Cloudflare deployment: remove or retire the Express reference API once the remaining niche routes and local-dev docs no longer point at it.
- Security hardening: add content sniffing for uploads and move from file-backed CRM persistence to a real database.
- Staff/onboarding convergence: decide whether the staff Pages app should stay on the temporary `/staff/*` setup layer or hand off into the canonical onboarding-session flow.
- AI test studio depth: move from single-case runs into saved suites, async execution, richer rubrics, and Worker-native target harnesses.

## Next

- Add verified provider webhook handlers for live call events, SMS delivery, and Outlook booking state changes.
- Replace the temporary calendar mapping placeholder in staff-web with a real provider auth/connect flow.
- Decide whether the deferred iOS app should return as a thin shell over the staff Pages contracts or stay dormant until after the browser MVP is tighter.
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
- Documented the Cloudflare-only deployment target, binding model, staging topology, and the migration away from Fly in the persistent project docs.
- Added a buildable Cloudflare Worker package with Hono routing, D1/R2/DO bindings, live/mock ElevenLabs browser-session issuance, onboarding route parity for the web flow, and Worker tests covering the finalized onboarding path.
- Split the Cloudflare browser surface into dedicated onboarding, ops, and upload Pages apps.
- Migrated Worker-side dashboard, job-card, signed-photo, upload, voice tool, and post-call routes so the main browser flows no longer depend on the Express reference API.
- Added D1 CRM tables and Worker coverage for Cloudflare-native photo upload and post-call persistence.
- Added Worker-side staff invite/session routes and staff-scoped job access so the iOS app no longer depends on the Express reference API for auth.
- Added `apps/staff-web` as the phone-first staff surface for queue/setup testing while the native pilot is deferred.
- Added a Worker-backed AI test studio with persistent cases/runs, mock-or-HTTP runner/judge providers, and an ops console route that uses the real Worker endpoints.
- Closed the biggest mobile UX gaps in ops/staff by reviewing rendered screenshots and adjusting the phone ordering/layout instead of relying on desktop-only code review.

## Review Queue

- Move the API-side onboarding serializers onto shared schemas directly so the route payloads and shared contracts cannot drift at runtime.
- Revisit admin-token auth for the web console before production; session storage is better than local storage, but not a final control plane auth story.
- Revisit OTP issuance and transport once Twilio Verify is wired in; the current in-house flow is an MVP guardrail, not a final identity solution.
- Decide whether the SwiftUI app should keep the legacy `/staff/*` OTP/session flow or switch to the newer onboarding-session model before removing the Express reference API.
- Replace the still-simulated calendar mapping path in staff-web with a real connect flow so the setup checklist stops implying live provider auth when none has happened.
- Make AI test studio runs exercise real Worker service behavior instead of only the current abstract text runner so passing evals correlate with real route behavior.
- Add a small set of Worker-backed contract tests around the iOS live client paths so API drift is caught before the SwiftUI app breaks.
