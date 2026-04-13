# Curve AI API Scaffold

This package is a self-contained Express + TypeScript backend scaffold for the greenfield Curve AI workspace. It is intentionally in-memory for CRM state, with local-disk photo uploads for now.

## Current Build Plan

- Build the core API surface under `apps/api/**` only.
- Load environment variables from the process environment and a local gitignored `secrets` file if present.
- Keep CRM state in memory for staff, jobs, quotes, appointments, callbacks, calls, and photo-upload requests.
- Use local disk uploads for caller photo submissions until shared storage and auth are added.
- Expose voice, staff onboarding, job-card, and upload endpoints needed by the phone-agent workflow.

## Environment

The service reads standard environment variables and also attempts to load a local dotenv-style file named `secrets` or `.env` from the package root or repo root if present.

Supported env vars:

- `PORT` - HTTP port, default `3000`
- `HOST` - bind host, default `0.0.0.0`
- `NODE_ENV` - runtime environment, default `development`
- `PUBLIC_BASE_URL` - public API base URL used for file URLs, default `http://localhost:${PORT}`
- `PUBLIC_APP_URL` - public web-app base URL used to generate caller upload links, default `http://localhost:5173`
- `UPLOAD_DIR` - local directory for photo uploads, default `apps/api/uploads`
- `STATE_FILE_PATH` - JSON snapshot file used to persist CRM state across restarts, default `apps/api/data/crm-store.json`
- `ENABLE_DEMO_DATA` - seed demo staff/jobs in non-production environments, default `true` outside production

## Scripts

- `npm run build`
- `npm run dev`
- `npm run start`
- `npm run test`
- `npm run typecheck`

## Endpoints

- `GET /health`
- `GET /dashboard`
- `POST /voice/context`
- `POST /voice/tools/quote`
- `POST /voice/tools/appointment`
- `POST /voice/tools/callback`
- `POST /voice/tools/send-photo-link`
- `POST /voice/post-call`
- `POST /staff/invite`
- `POST /staff/verify-otp`
- `POST /staff/voice-consent`
- `POST /staff/pricing-interview`
- `POST /staff/calendar/connect`
- `GET /jobs/:jobId/card`
- `POST /uploads/:token`
- `POST /uploads/:token/photos`

## Upload Flow

`POST /uploads/:token` and `POST /uploads/:token/photos` accept `multipart/form-data` with either a `files` or `photos` field containing up to 10 images. The route stores them on disk, serves them back from `/uploads/files/:filename`, and attaches them to the matching in-memory job record when a `jobId` exists on the upload request.
