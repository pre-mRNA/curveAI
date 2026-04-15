# Agent Log

## Active Build Plan

### Platform Summary

- Build a greenfield platform with four surfaces: ElevenLabs-based voice onboarding and phone agents, a Cloudflare Pages web app plus Worker API, a native SwiftUI staff iOS app, and an internal web ops console.
- Each staff member gets a dedicated ElevenLabs agent, personal cloned voice, calendar connection, pricing profile, and experiment assignments.
- Core v1 actions: answer calls broadly with guardrails, give indicative or guardrailed dynamic quotes, book calendar appointments, text secure photo-upload links, create callback tasks, summarize jobs for tradies, and end calls cleanly with ElevenLabs `end_call`.

### Implementation Summary

- Backend: Cloudflare Worker API with D1 state, R2 artifacts, Durable Objects for live onboarding coordination, and worker-friendly service boundaries.
- Voice: ElevenLabs per-staff agents with webhook-driven context, quote tools, booking tools, photo-link tools, callback tools, and post-call ingestion.
- Staff onboarding: browser-first invite flow, voice-clone consent, structured interview extraction, Outlook connect, clean voice sample upload, and staff-specific routing data.
- Pricing: base pricebook plus personalized staff pricing profiles, experiment bands, floors, ceilings, audit trails, and accepted-price tracking.
- Surfaces: internal web ops console, customer upload page, and native SwiftUI staff app with card-style job summaries.

### Defaults Chosen

- Launch region: Australia
- Inbound routing: per-staff number or provider-managed routing depending on deployment phase
- Staff app auth: invite + OTP
- Calendar model: per-staff calendars behind a provider adapter
- Upload mode: SMS signed link
- Escalation default: callback-first, with transfer-to-human behind a feature flag
- Data retention: transcripts and audio retained with explicit consent controls

## Progress Log

- Bootstrapped root workspace, shared contracts, and persistent plan docs.
- API, web, and iOS scaffolds are being built in parallel by delegated workers.
- Integrated the worker outputs into a single npm-workspaces repo with shared run scripts and a local secrets example.
- Added a buildable Express API scaffold with seeded dashboard data, dynamic-price variants, staff onboarding routes, photo-link generation, upload aliases, and job-card retrieval.
- Added a buildable Vite web console with card-style job summaries, pricing experiment views, and a public upload page that posts multipart photos to the API.
- Added a valid SwiftUI/Xcode iOS scaffold for invite + OTP onboarding, Outlook connection, voice-consent capture, and tradie job cards.
- Verified `npm run typecheck`, `npm run build`, `GET /health`, `GET /dashboard`, `xcodebuild -list`, and the upload flow from generated link to updated dashboard state.
- Upgraded the web toolchain to Vite 8 so `npm audit` is clean across the workspace.
- Hardened the API with request validation, persisted CRM snapshots, and a Node test suite covering production redaction, restart persistence, upload rejection, and request-shape validation.
- Added admin auth for internal routes, HMAC signing for `/voice/*`, staff session issuance, `/staff/me`, and a staff-authenticated `/jobs` queue for the iOS app.
- Made OTP verification invite-code-bound, time-limited, and lockable after repeated failures instead of leaving a public infinite-guess path.
- Switched the web console admin token from local storage to session storage and aligned the upload UI with the backend image allowlist.
- Aligned the iOS live client with the real API contract so invite-code verification, calendar connect, consent submission, and job fetches target existing backend routes.
- Added a persistent local Kanban board in `docs/mvp-board.md` to track MVP progress and review debt between sessions.
- Added portable onboarding contracts in `packages/shared`, a separate onboarding store, mock provider interfaces for realtime voice/reasoning/calendar/clone flows, and browser-first onboarding routes in the API.
- Added the browser onboarding webapp at `/onboard/:inviteCode` with consent, structured interview capture, extraction review, Microsoft calendar connect, voice sample upload, and finalize steps.
- Fixed the first deep review findings on onboarding: realtime voice sessions now require consent server-side, finalize is blocked until calendar + voice sample are present, and voice sample uploads require an actual audio file instead of metadata-only requests.
- Extended the API suite to cover the new onboarding happy path, consent rejection, finalize guardrails, multipart audio uploads, and contract validation against `packages/shared`.
- Fixed a follow-up browser regression where recorded voice samples were being scored as five-second clips regardless of actual duration, and added a web test that exercises recording -> upload -> finalize progression.
- Pulled the onboarding session/review envelope types into `packages/shared` and switched the web client to consume those shared contracts instead of redeclaring backend DTOs locally.
- Fixed the next review round on onboarding state integrity: onboarding session tokens now expire, completed sessions reject further mutation, configured Microsoft callbacks require a real auth code, and review identity fields now persist instead of disappearing on save.
- Added a persistent Cloudflare deployment note recommending `Pages + Worker API` for the web surface while keeping the orchestration core portable and removing Fly from the target topology.
- Added `apps/edge-api`, a buildable Cloudflare Worker API with Hono, D1-backed repository scaffolding, R2 artifact storage, Durable Object session coordination, provider adapters, and tests for the browser onboarding happy path.
