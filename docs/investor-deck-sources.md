# Curve AI Investor Deck Sources

This file backs the claims used in [investor-deck.html](./investor-deck.html).

## Repo-backed product claims

These come from the current codebase and docs:

- [README.md](../README.md)
- [docs/mvp-board.md](./mvp-board.md)
- [docs/agent-log.md](./agent-log.md)
- [packages/shared/src/branding.ts](../packages/shared/src/branding.ts)
- [apps/edge-api/src/app.ts](../apps/edge-api/src/app.ts)
- [apps/edge-api/src/onboarding-service.ts](../apps/edge-api/src/onboarding-service.ts)
- [apps/web/src/onboarding/OnboardingPage.tsx](../apps/web/src/onboarding/OnboardingPage.tsx)
- [apps/upload-web/src/UploadPage.tsx](../apps/upload-web/src/UploadPage.tsx)
- [apps/staff-web/src/StaffShell.tsx](../apps/staff-web/src/StaffShell.tsx)
- [apps/ops-web/src/TestStudioPage.tsx](../apps/ops-web/src/TestStudioPage.tsx)

## External sources

1. ABS, *Counts of Australian Businesses, including Entries and Exits, July 2021 - June 2025*  
   https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2021-jun2025

2. CEDA, *Size matters: Why construction productivity is so weak* (2025)  
   https://www.ceda.com.au/publications/all-publications/research/economy/size-matters-why-construction-productivity-is-s

   Relevant deck use:
   - 410,602 construction firms in Australia
   - 98.5% have fewer than 20 employees
   - 91% are microbusinesses with fewer than five employees
   - digital and management capability weakness in small construction firms

3. Productivity Commission, *Housing construction productivity: Can we fix it?* (2025)  
   https://www.pc.gov.au/research/completed/housing-construction/housing-construction.pdf

   Relevant deck use:
   - 1.2 million homes over five years Housing Accord target
   - 176,000 homes built in 2023-24
   - $139 billion annual housing construction expenditure to June 2024
   - $83 billion of that on new housing
   - dwelling construction labour productivity down 12% over roughly 30 years
   - broader economy labour productivity up 49% over the same period
   - productivity and completion-time deterioration

4. ABS, *Total Value of Dwellings, June Quarter 2024*  
   https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/jun-quarter-2024

   Relevant deck use:
   - 11,211,000 residential dwellings in Australia in June 2024

5. Grand View Research, *Field Service Management Market Size & Share Report 2030*  
   https://www.grandviewresearch.com/industry-analysis/field-service-management-market

   Relevant deck use:
   - global FSM market size value of USD 4.91 billion in 2023
   - projected USD 11.78 billion by 2030
   - projected 13.3% CAGR

## Internal inference notes

These are clearly inference-based and should be treated as directional investor framing, not externally sourced facts.

### Australian wedge revenue ceiling

- Base firm count: 410,602 Australian construction firms
- Assumed ACV range: A$4,000 to A$12,000
- Implied annual software revenue pool:
  - low end: 410,602 x A$4,000 = about A$1.64 billion
  - high end: 410,602 x A$12,000 = about A$4.93 billion

Important:

- This is a directional ceiling for internal planning, not a sourced SAM or forecast.
- It assumes eventual full-category penetration across Australian construction firms, which is not the current go-to-market claim.
- The ACV range is not externally sourced in this deck. It is a placeholder planning range for investor framing and should be tightened later with live pricing or customer validation.

This excludes:

- adjacent home-service categories outside the construction count
- New Zealand
- UK
- North America
- higher-priced enterprise packages

## Screenshots used in deck

- [docs/assets/investor-deck/onboarding-landing.png](./assets/investor-deck/onboarding-landing.png)
- [docs/assets/investor-deck/onboarding-route.png](./assets/investor-deck/onboarding-route.png)
- [docs/assets/investor-deck/upload-landing.png](./assets/investor-deck/upload-landing.png)
- [docs/assets/investor-deck/upload-route.png](./assets/investor-deck/upload-route.png)
- [docs/assets/investor-deck/staff-field-desk.png](./assets/investor-deck/staff-field-desk.png)
- [docs/assets/investor-deck/ops-control-room.png](./assets/investor-deck/ops-control-room.png)
