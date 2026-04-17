# Curve AI Brand System

The suite now uses one shared branding model in `packages/shared/src/branding.ts`.

## Suite

- Name: `Curve AI`
- Tagline: `Voice operations for tradies`
- Core palette:
  - cool cyan and blue accents for a clearer AI control-surface identity
  - restrained copper as a secondary warmth signal for urgency and handoff
  - pale cloud backgrounds with grid overlays for a calm, technical operating feel
- Typography:
  - sans UI stack for controls and dense operational content
  - serif display stack for primary hero moments and surface identity

## Surfaces

- `onboarding`: `Curve AI Setup`
  - Guided setup for voice, pricing, rules, and calendar handoff
- `upload`: `Curve AI Photos`
  - Secure customer photo request and upload flow
- `staff`: `Curve AI Field Desk`
  - Phone-first queue, setup, and test surface for tradies
- `ops`: `Curve AI Control Room`
  - Internal queue, pricing, callback, and evaluation console

## Implementation Notes

- Shared branding data and CSS variables come from `packages/shared/src/branding.ts`.
- Each Pages app maps that branding model into local CSS custom properties through its `src/brand.ts`.
- Surface wrappers apply those variables at the shell level so every app keeps the same suite identity while allowing small per-surface accent shifts.
- The current suite theme intentionally uses light glass panels, fine grid lines, and cool accent glows so onboarding, upload, field, and ops all read as one AI system rather than four separate apps.
