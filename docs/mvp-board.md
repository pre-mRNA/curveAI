# MVP Board

## In Progress

- Provider adapters: replace mock ElevenLabs browser, Microsoft calendar, and Twilio behavior with live clients behind the existing onboarding and voice routes.
- Portable orchestration: keep the onboarding control plane provider-neutral so reasoning and voice components can move to Australian self-hosted infrastructure later.
- Security hardening: deepen upload verification, retention controls, and privacy-safe logging on the Worker path.
- Staff/onboarding convergence: decide whether the staff Pages app should stay on the temporary `/staff/*` setup layer or hand off into the canonical onboarding-session flow.
- AI test studio depth: move from single-case runs into saved suites, async execution, richer rubrics, and Worker-native target harnesses.

## Next

- Add verified provider webhook handlers for live call events, SMS delivery, and Outlook booking state changes.
- Replace the temporary calendar mapping placeholder in staff-web with a real provider auth/connect flow.
- Add end-to-end smoke coverage for signed voice requests, onboarding interview turns, audio upload completion, SMS photo links, and staff job refresh.

## Poorly Developed Features

- AI test studio realism: the runner and judge still mainly score simulated text behavior instead of exercising real Worker routes, provider adapters, and side effects.
- Staff calendar setup: the staff app still uses a temporary form-based calendar mapping flow instead of a real provider auth/connect journey.
- Calendar adapter depth: Microsoft calendar still has a mock-success path when provider config is absent, so the feature is not yet production-grade.
- Realtime voice maturity: onboarding voice still depends on a mock browser-session provider path when live ElevenLabs config is incomplete.
- Voice tool depth: quote, callback, appointment, photo-link, and post-call routes exist, but they are still thin MVP workflows rather than fully integrated operational flows.
- Onboarding review UX: the review editor is still a flat set of generic text inputs instead of a stronger structured business-profile workflow.
- Staff/onboarding convergence: the separate `/staff/*` setup layer is still temporary and can drift away from the canonical onboarding-session flow if it is left in place.

## Done

- Added admin auth to internal API routes and signed HMAC verification to `/voice/*`.
- Made dashboard reads side-effect free and quarantined malformed CRM snapshots instead of crashing on boot.
- Strengthened staff onboarding with invite-code-bound OTP verification, lockout after repeated failures, and short-lived staff sessions.
- Added authenticated `/jobs` and `/staff/me` endpoints for the staff app.
- Added API coverage for auth boundaries, OTP/session lifecycle, snapshot recovery, upload prevalidation, and signed voice requests.
- Added web auth gating, honest failure states, upload validation tests, and session-scoped admin token storage.
- Added browser-first onboarding with shared contracts, secure invite sessions, consent-gated realtime voice provisioning, extraction review, Microsoft connect, and multipart voice sample upload.
- Added backend guardrails so onboarding cannot mint a realtime session without consent or finalize without a connected calendar and a real audio sample.
- Documented the Cloudflare-only deployment target, binding model, staging topology, and the migration away from Fly in the persistent project docs.
- Added a buildable Cloudflare Worker package with Hono routing, D1/R2/DO bindings, live/mock ElevenLabs browser-session issuance, onboarding route parity for the web flow, and Worker tests covering the finalized onboarding path.
- Split the Cloudflare browser surface into dedicated onboarding, ops, and upload Pages apps.
- Migrated Worker-side dashboard, job-card, signed-photo, upload, voice tool, and post-call routes so the main browser flows no longer depend on the Express reference API.
- Added D1 CRM tables and Worker coverage for Cloudflare-native photo upload and post-call persistence.
- Added Worker-side staff invite/session routes and staff-scoped job access for the browser-first staff surface.
- Added `apps/staff-web` as the phone-first staff surface for queue/setup testing.
- Added a Worker-backed AI test studio with persistent cases/runs, mock-or-HTTP runner/judge providers, and an ops console route that uses the real Worker endpoints.
- Closed the biggest mobile UX gaps in ops/staff by reviewing rendered screenshots and adjusting the phone ordering/layout instead of relying on desktop-only code review.
- Pruned the stale Express API and deferred iOS pilot from the active repo path so the maintained runtime is Pages + Worker only.

## Review Queue

- Move the API-side onboarding serializers onto shared schemas directly so the route payloads and shared contracts cannot drift at runtime.
- Revisit admin-token auth for the web console before production; session storage is better than local storage, but not a final control plane auth story.
- Revisit OTP issuance and transport once Twilio Verify is wired in; the current in-house flow is an MVP guardrail, not a final identity solution.
- Replace the still-simulated calendar mapping path in staff-web with a real connect flow so the setup checklist stops implying live provider auth when none has happened.
- Make AI test studio runs exercise real Worker service behavior instead of only the current abstract text runner so passing evals correlate with real route behavior.
