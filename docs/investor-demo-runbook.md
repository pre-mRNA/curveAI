# Investor Demo Runbook

## Goal

Use one repeatable private-staging walkthrough instead of rebuilding demo data by hand.

## Required env

- `PUBLIC_API_URL`
- `PUBLIC_ONBOARDING_APP_URL`
- `PUBLIC_UPLOAD_APP_URL`
- `PUBLIC_STAFF_APP_URL`
- `PUBLIC_OPS_APP_URL`
- `ADMIN_TOKEN`
- `AUTOMATION_SHARED_SECRET` if you want the upload-link scenario seeded too

## Seed command

```bash
npm run seed:investor:demo
```

It prints JSON with:

- a fresh onboarding invite URL
- a fresh customer upload URL when automation signing is available
- a fresh staff invite code and, when insecure OTP echo is enabled, the matching OTP
- the staff and ops app URLs
- the recommended walkthrough order

## Recommended walkthrough

1. Open the onboarding invite URL and show the setup flow.
2. Explain that Microsoft calendar is either live or explicitly unavailable in this environment.
3. Open the customer upload URL and show the photo-request experience.
4. Open the staff app and explain the phone-first field surface.
5. Use ops only if you need to show internal visibility or AI test tooling.

## Review posture

- Prefer Cloudflare Access with specific reviewer emails.
- Keep the Pages passcode gate as the fallback until Access is verified on every host.
- Do not present mock-success provider states as live integrations.
