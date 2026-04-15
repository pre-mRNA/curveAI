# Onboarding Web App

Public onboarding Pages app for Curve AI.

## Routes

- `/` landing page with invite recovery
- `/onboard/:inviteCode` secure browser onboarding flow

## Local Run

1. Install dependencies at the repo root:

```bash
npm install
```

2. Point the app at the Worker dev server:

```bash
export VITE_API_BASE_URL="http://127.0.0.1:8787"
```

3. Start the onboarding app:

```bash
npm run dev -w @curve-ai/web
```

4. Build it:

```bash
npm run build -w @curve-ai/web
```

5. Run tests:

```bash
npm run test -w @curve-ai/web
```

## Deployment Notes

- This app is deployed as its own Cloudflare Pages project.
- `VITE_API_BASE_URL` must be set at build time in Pages.
- The browser onboarding flow talks directly to the Cloudflare Worker API and does not rely on `/api` same-origin proxying.
