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
- Split the browser surface into three Cloudflare Pages apps: `apps/web` for onboarding, `apps/ops-web` for the internal dashboard, and `apps/upload-web` for customer photo uploads.
- Migrated the Cloudflare Worker beyond onboarding so it now serves dashboard/job-card reads, voice quote/callback/appointment/send-photo-link tools, signed photo asset URLs, customer photo uploads, and `voice/post-call` ingestion.
- Reworked the Worker runtime so production requests use real Cloudflare bindings instead of silently falling back to in-memory state, and updated the deployment contract/docs to use separate ops/onboarding/upload origins.
- Added the D1 CRM migration for jobs, quotes, appointments, callbacks, calls, upload requests, and photo assets, plus Worker tests covering the Cloudflare upload flow and post-call persistence.
- Migrated the remaining SwiftUI-facing staff session flow into the Worker: `/staff/invite`, `/staff/verify-otp`, `/staff/me`, `/staff/voice-consent`, `/staff/pricing-interview`, `/staff/calendar/connect`, and staff-scoped `/jobs` access.
- Added Worker-side D1 models for staff auth state, staff sessions, and calendar connections, plus coverage for OTP verification and staff-scoped job access.
- Tightened the new Worker staff invite route so raw OTPs are only exposed when `ALLOW_INSECURE_TEST_OTP=true` is explicitly enabled for non-production workflows.
- Ran a second multiagent review pass across deployment, Worker security, onboarding UX, upload UX, iOS contract drift, and cross-app design consistency before the next implementation batch.
- Hardened the Worker config path so non-local requests fail fast when public URLs or signing secrets are missing, `/health` reports readiness warnings, `X-Staff-Session` is allowed through CORS, and photo asset signing no longer falls back to unrelated secrets.
- Parameterized the D1 migration scripts via `CLOUDFLARE_D1_DATABASE` instead of hardcoding the staging database name.
- Closed an upload race in both D1 and in-memory repositories so expired or already-completed upload tokens cannot be finalized after object writes, and the Worker now cleans up staged objects if completion fails.
- Reworked the onboarding landing page into a real recovery surface with invite-code entry, clearer step cards, and denser mobile progress UI instead of the previous dead-end info page.
- Upgraded the public upload page so it fetches the upload token context, shows friendlier error copy, uses a more action-first layout on phones, and keeps the visual system aligned with the onboarding and ops apps.
- Updated Cloudflare deployment docs and the onboarding web README to document `VITE_API_BASE_URL`, `CLOUDFLARE_D1_DATABASE`, and the Worker readiness contract.
