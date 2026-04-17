# Public UI Rebuild

## Goal

Replace the current stacked-card prototype feel with a cleaner, service-grade public experience that:

- feels trustworthy on first load
- keeps the main action above the fold on mobile
- avoids generic "AI demo" styling
- can map cleanly to SwiftUI later without redesigning the product from scratch

## Product Grammar

Every public screen should be built from the same small set of primitives:

1. `HeroBlock`
   - one sentence headline
   - one sentence support line
   - a small facts row

2. `ActionCard`
   - the main thing the user should do now
   - one form or one button group
   - one short support line, not a paragraph dump

3. `GuidePanel`
   - three short bullets or steps
   - only present if it reduces confusion

4. `TrustPanel`
   - who requested this
   - what happens next
   - why this is safe / private / job-specific

5. `ProgressRail`
   - only for multistep flows
   - current step, next step, and minimal status

These primitives should become the shared shape for:

- web onboarding
- web customer uploads
- later SwiftUI onboarding
- later SwiftUI field setup

## Anti-Patterns To Remove

- card soup
- repeated eyebrow + heading + paragraph blocks with no action
- decorative glass / blur as a substitute for hierarchy
- too many pills before the main CTA
- long grids that collapse into endless mobile stacks
- mixing support content with primary action content
- "AI-native" styling that lowers trust instead of increasing it

## Visual Direction

Use a grounded service aesthetic instead of a sci-fi dashboard aesthetic.

- background: warm paper / sand neutrals, not pale washed-out blue
- cards: solid surfaces with subtle shadows, not translucent glass
- accents: deep teal + muted copper
- headings: strong, high-contrast, compact
- spacing: fewer sections, more breathing room inside each section
- mobile: one strong column, one action area at a time

## Layout Rules

### Landing pages

- The first screen should explain the job in under 2 seconds.
- The primary action should appear before any long guide content.
- Support content should sit beside or below the action, never above it.

### Route pages

- The current step must be obvious immediately.
- The user should never need to scroll past metadata to find the action.
- Only one dense editing area per screen.

### Upload flow

- "Who asked", "what job", and "what photos help" should appear before the picker.
- The file picker should feel like one big tap target, not a default browser control inside a form.

## Portability To iOS

Do not anchor the design system to CSS-specific effects.

Portable design decisions:

- spacing scale
- typography scale
- card hierarchy
- action hierarchy
- status color roles
- screen-level primitives

Non-portable details to avoid relying on:

- blur-heavy glass
- fancy CSS-only gradients as structural meaning
- browser-specific controls as the main UI language

The SwiftUI version should be able to reproduce the same primitives:

- `HeroBlock` -> `VStack`
- `ActionCard` -> `SectionCard`
- `GuidePanel` -> `ChecklistSection`
- `TrustPanel` -> `InfoSection`
- `ProgressRail` -> `StepSummary`

## Implementation Order

1. Public landing pages
   - onboarding root
   - upload root

2. Public in-flow pages
   - onboarding steps
   - upload live token route

3. Staff mobile shell
   - auth
   - queue
   - job detail

4. Ops console cleanup
   - auth shell
   - queue density
   - test studio

## Acceptance Standard

A screen is not ready if:

- the main action is not obvious on mobile
- the page still feels like a stack of equal-weight cards
- trust context is missing
- screenshots look "pretty" but not practical
- the same screen would need to be redesigned from scratch for SwiftUI
