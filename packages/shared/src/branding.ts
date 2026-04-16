export type CurveSurfaceId = 'onboarding' | 'upload' | 'staff' | 'ops';

type CurveSurfaceTheme = {
  bgTop: string;
  bgBottom: string;
  glowLeft: string;
  glowRight: string;
  panel: string;
  panelStrong: string;
  text: string;
  muted: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  warm: string;
  good: string;
  warn: string;
  line: string;
  shadow: string;
  fontSans: string;
  fontDisplay: string;
};

export type CurveSurfaceBranding = {
  id: CurveSurfaceId;
  suiteName: string;
  suiteTagline: string;
  surfaceName: string;
  eyebrow: string;
  heroTitle: string;
  heroDescription: string;
  badgeLabel: string;
  badgeTitle: string;
  badgeDescription: string;
  documentTitle: string;
  documentDescription: string;
  theme: CurveSurfaceTheme;
};

const baseTheme = {
  bgTop: '#f4efe6',
  bgBottom: '#e4ddd2',
  panel: '#fffaf2',
  panelStrong: '#ffffff',
  text: '#182127',
  muted: '#58616b',
  accent: '#156b8a',
  accentStrong: '#0d5168',
  accentSoft: 'rgba(21, 107, 138, 0.12)',
  warm: '#be7345',
  good: '#167a5d',
  warn: '#a05f24',
  line: 'rgba(24, 33, 39, 0.12)',
  shadow: '0 18px 44px rgba(39, 35, 28, 0.12)',
  fontSans: "'Avenir Next', 'Manrope', 'Segoe UI', sans-serif",
  fontDisplay: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
} as const;

export const CURVE_BRAND_MODEL = {
  suiteName: 'Curve AI',
  suiteTagline: 'Voice operations for tradies',
  surfaces: {
    onboarding: {
      id: 'onboarding',
      suiteName: 'Curve AI',
      suiteTagline: 'Voice operations for tradies',
      surfaceName: 'Guided Setup',
      eyebrow: 'Curve AI Setup',
      heroTitle: 'Set up your phone assistant in one go.',
      heroDescription: 'Answer a few questions, connect your calendar, and record your voice.',
      badgeLabel: 'Quick setup',
      badgeTitle: 'Voice, prices, and calendar',
      badgeDescription: 'A short setup so the assistant sounds right and handles jobs the right way.',
      documentTitle: 'Curve AI | Guided Setup',
      documentDescription: 'Secure onboarding for staff voice, pricing, business rules, and calendar setup.',
      theme: {
        ...baseTheme,
        bgTop: '#f6f1e8',
        bgBottom: '#e6ded1',
        panel: '#fffaf3',
        panelStrong: '#fffefd',
        glowLeft: 'rgba(21, 107, 138, 0.12)',
        glowRight: 'rgba(190, 115, 69, 0.08)',
        accent: '#146987',
        accentStrong: '#0d4e63',
        accentSoft: 'rgba(20, 105, 135, 0.12)',
        warm: '#bd7143',
      },
    },
    upload: {
      id: 'upload',
      suiteName: 'Curve AI',
      suiteTagline: 'Voice operations for tradies',
      surfaceName: 'Photo Request',
      eyebrow: 'Curve AI Photos',
      heroTitle: 'Send photos of the job.',
      heroDescription: 'Open the text message link, add your photos, and send them through.',
      badgeLabel: 'Photo link',
      badgeTitle: 'Photos only',
      badgeDescription: 'Take a few clear photos and send them straight to the job.',
      documentTitle: 'Curve AI | Photo Request',
      documentDescription: 'Dedicated customer photo upload flow for live Curve AI job cards.',
      theme: {
        ...baseTheme,
        bgTop: '#f7f2e9',
        bgBottom: '#e5ddcf',
        panel: '#fffaf3',
        panelStrong: '#fffefd',
        glowLeft: 'rgba(22, 112, 143, 0.12)',
        glowRight: 'rgba(203, 127, 78, 0.08)',
        accent: '#156f8f',
        accentStrong: '#0e586f',
        accentSoft: 'rgba(21, 111, 143, 0.12)',
        warm: '#c67c4d',
      },
    },
    staff: {
      id: 'staff',
      suiteName: 'Curve AI',
      suiteTagline: 'Voice operations for tradies',
      surfaceName: 'Field Desk',
      eyebrow: 'Curve AI Field Desk',
      heroTitle: 'Open jobs, finish setup, and test the assistant from your phone.',
      heroDescription: 'Use this page to check jobs, finish setup, and make sure the assistant is ready.',
      badgeLabel: 'Phone ready',
      badgeTitle: 'Jobs, setup, and tests',
      badgeDescription: 'Built for quick job checks and simple setup on a phone.',
      documentTitle: 'Curve AI | Field Desk',
      documentDescription: 'Phone-first staff surface for queue, setup, and live job review.',
      theme: {
        ...baseTheme,
        bgTop: '#edf4f6',
        bgBottom: '#dde7ea',
        glowLeft: 'rgba(20, 120, 158, 0.17)',
        glowRight: 'rgba(93, 201, 238, 0.12)',
        accent: '#14789e',
        accentStrong: '#0d5b77',
        accentSoft: 'rgba(20, 120, 158, 0.12)',
        warm: '#ce7744',
      },
    },
    ops: {
      id: 'ops',
      suiteName: 'Curve AI',
      suiteTagline: 'Voice operations for tradies',
      surfaceName: 'Control Room',
      eyebrow: 'Curve AI Control Room',
      heroTitle: 'Control calls, quotes, callbacks, and test loops in one live room.',
      heroDescription:
        'Internal operating surface for routing, pricing, callback pressure, and judged evaluation before prompts hit real callers.',
      badgeLabel: 'Private control',
      badgeTitle: 'Live control plane',
      badgeDescription: 'Queue telemetry, callbacks, and evaluation loops under one internal suite brand.',
      documentTitle: 'Curve AI | Control Room',
      documentDescription: 'Internal operations and AI evaluation console for Curve AI.',
      theme: {
        ...baseTheme,
        bgTop: '#edf3f6',
        bgBottom: '#dce5ea',
        glowLeft: 'rgba(18, 105, 140, 0.18)',
        glowRight: 'rgba(103, 206, 244, 0.12)',
        accent: '#12698c',
        accentStrong: '#0b4f6b',
        accentSoft: 'rgba(18, 105, 140, 0.12)',
        warm: '#d27240',
      },
    },
  } satisfies Record<CurveSurfaceId, CurveSurfaceBranding>,
} as const;

export function getCurveSurfaceBranding(surfaceId: CurveSurfaceId): CurveSurfaceBranding {
  return CURVE_BRAND_MODEL.surfaces[surfaceId];
}

export function getCurveBrandCssVariables(surface: CurveSurfaceBranding): Record<string, string> {
  return {
    '--bg-top': surface.theme.bgTop,
    '--bg-bottom': surface.theme.bgBottom,
    '--glow-left': surface.theme.glowLeft,
    '--glow-right': surface.theme.glowRight,
    '--panel': surface.theme.panel,
    '--panel-solid': surface.theme.panelStrong,
    '--panel-strong': surface.theme.panelStrong,
    '--text': surface.theme.text,
    '--muted': surface.theme.muted,
    '--accent': surface.theme.accent,
    '--accent-strong': surface.theme.accentStrong,
    '--accent-soft': surface.theme.accentSoft,
    '--accent-2': surface.theme.warm,
    '--copper': surface.theme.warm,
    '--good': surface.theme.good,
    '--warn': surface.theme.warn,
    '--line': surface.theme.line,
    '--shadow': surface.theme.shadow,
    '--font-sans': surface.theme.fontSans,
    '--font-display': surface.theme.fontDisplay,
  };
}
