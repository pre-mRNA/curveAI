# Cloudflare Deployment

## Recommendation

Use `Cloudflare Pages + Workers`, not static Pages alone.

Static Pages by themselves are not enough for this app because onboarding needs:

- server-held secrets for ElevenLabs and Microsoft
- signed/browser session issuance
- OAuth callback handling
- multipart audio upload handling
- token validation and invite/session gating

## Best Fit For This Repo

- `Pages` serves the React onboarding app and internal web UI.
- `Workers` or `Pages Functions` handle lightweight edge concerns:
  - invite/session bootstrap
  - ElevenLabs signed session issuance
  - Microsoft OAuth callback entrypoints
  - upload-token validation
- The core orchestration API should remain portable and self-hostable in Australia.

That means the practical shape is:

1. Cloudflare hosts the web surface.
2. Edge code handles low-latency request/auth glue.
3. The stateful control plane and provider orchestration can later move to Australian infrastructure without rewriting the frontend.

## Why Not Static-Only

Static-only hosting would force secrets, OAuth verification, and provider callbacks somewhere else anyway. Once that is true, the app is no longer really “static.” For this product, `static UI + worker-backed APIs` is the correct minimum Cloudflare shape.

## Relation To The Existing Example

The pattern in `/Users/ajsethi/long-read-splicing-modulation/experiments/cloudflare` is the right general model:

- build static assets for the frontend
- attach a Worker for protected API routes
- keep secrets and provider calls server-side

For Curve AI, the same pattern fits, but the long-term recommendation is stricter:

- keep Cloudflare as the browser and edge layer
- keep the orchestration core portable
- avoid baking core business logic too deeply into a Cloudflare-only runtime
