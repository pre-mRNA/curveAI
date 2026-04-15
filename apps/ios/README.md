# TradieAI iOS Staff App

This directory contains the native SwiftUI staff app for TradieAI.

## What is in the current build

- A step-based onboarding flow for:
  - invite + OTP verification
  - Outlook calendar connect
  - voice consent capture
  - job queue handoff
- A lightweight `OnboardingFlowStore` that drives the screens and can use either a live API client or a local mock client.
- A job board view that shows a tradie-friendly card summary with quote, photos, location, and next action.
- An XCTest target with onboarding progression coverage.

## App configuration

- The app defaults to the mock client when `TRADIE_API_BASE_URL` is not set.
- To point the app at a backend during local testing, set:

```text
TRADIE_API_BASE_URL=http://localhost:8787
```

- The live client currently targets the Cloudflare Worker-compatible routes for invite, OTP verification, calendar connect, voice consent, and jobs.
- The flow is intentionally backend-compatible but still easy to swap if the contract shifts.

## Build and test

From this directory:

```bash
xcodebuild -list -project TradieAI.xcodeproj
xcodebuild test -project TradieAI.xcodeproj -scheme TradieAI -destination 'platform=iOS Simulator,name=iPhone 15'
```

If the simulator runtime is not installed on the machine, Xcode may only expose the macOS host and the test run will fail before execution.

## Notes

- Keep all iOS work inside `apps/ios/**`.
- Do not store secrets in this directory.
- The app is still a thin MVP surface, so backend wiring should remain straightforward rather than over-abstracted.

## MVP checklist

- [x] Replace the tabbed placeholder with a step-based onboarding flow.
- [x] Add a view model/store layer for onboarding state and job selection.
- [x] Add a live/mock API client abstraction for invite, OTP, calendar, consent, and jobs.
- [x] Add an XCTest target with onboarding progression coverage.
- [ ] Wire the live Microsoft Graph calendar flow and persistent session storage.
- [ ] Add voice upload capture and real provider callbacks.
- [ ] Replace mock job data with backend-fed jobs and real action handlers.
