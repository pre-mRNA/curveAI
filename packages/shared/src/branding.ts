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
  bgTop: '#f8f3ec',
  bgBottom: '#ece4d8',
  panel: 'rgba(255, 255, 255, 0.84)',
  panelStrong: '#ffffff',
  text: '#182129',
  muted: '#5f6a73',
  accent: '#1d667d',
  accentStrong: '#144f62',
  accentSoft: 'rgba(29, 102, 125, 0.12)',
  warm: '#bb6844',
  good: '#17694c',
  warn: '#8c4d1c',
  line: 'rgba(24, 33, 41, 0.12)',
  shadow: '0 24px 60px rgba(24, 33, 41, 0.12)',
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
      heroTitle: 'Get your voice agent ready in one guided session.',
      heroDescription:
        'Secure setup for voice, pricing, working rules, and calendar handoff without a long onboarding thread.',
      badgeLabel: 'Guided setup',
      badgeTitle: 'Voice, rules, and calendar',
      badgeDescription: 'One focused session to capture how this tradie actually works before calls go live.',
      documentTitle: 'Curve AI | Guided Setup',
      documentDescription: 'Secure onboarding for staff voice, pricing, business rules, and calendar setup.',
      theme: {
        ...baseTheme,
        glowLeft: 'rgba(29, 102, 125, 0.16)',
        glowRight: 'rgba(187, 104, 68, 0.14)',
      },
    },
    upload: {
      id: 'upload',
      suiteName: 'Curve AI',
      suiteTagline: 'Voice operations for tradies',
      surfaceName: 'Photo Request',
      eyebrow: 'Curve AI Photos',
      heroTitle: 'Send your job photos to the tradie.',
      heroDescription: 'Fast, phone-first photo handoff from a secure SMS link into the live job card.',
      badgeLabel: 'Secure request',
      badgeTitle: 'Job photos only',
      badgeDescription: 'Wide shots, close-ups, and labels go straight to the active job without an app install.',
      documentTitle: 'Curve AI | Photo Request',
      documentDescription: 'Dedicated customer photo upload flow for live Curve AI job cards.',
      theme: {
        ...baseTheme,
        bgTop: '#fbf8f2',
        bgBottom: '#efe8de',
        glowLeft: 'rgba(37, 110, 135, 0.16)',
        glowRight: 'rgba(194, 120, 76, 0.14)',
        accent: '#256e87',
        accentStrong: '#164e62',
        accentSoft: 'rgba(37, 110, 135, 0.12)',
        warm: '#c2784c',
      },
    },
    staff: {
      id: 'staff',
      suiteName: 'Curve AI',
      suiteTagline: 'Voice operations for tradies',
      surfaceName: 'Field Desk',
      eyebrow: 'Curve AI Field Desk',
      heroTitle: 'Queue, setup, and test flows from a phone-sized control surface.',
      heroDescription:
        'The temporary field app for live jobs, setup completion, and agent testing while the native client is still deferred.',
      badgeLabel: 'Field ready',
      badgeTitle: 'Queue, setup, and tests',
      badgeDescription: 'Built for active staff sessions, quick follow-up, and phone-width review of the live day.',
      documentTitle: 'Curve AI | Field Desk',
      documentDescription: 'Phone-first staff surface for queue, setup, and live job review.',
      theme: {
        ...baseTheme,
        bgTop: '#f7f1e8',
        bgBottom: '#e7ddd0',
        glowLeft: 'rgba(27, 97, 116, 0.17)',
        glowRight: 'rgba(186, 112, 71, 0.13)',
        accent: '#1b6174',
        accentStrong: '#0f4958',
        accentSoft: 'rgba(27, 97, 116, 0.12)',
        warm: '#ba7047',
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
        bgTop: '#f8f4ed',
        bgBottom: '#ebe2d7',
        glowLeft: 'rgba(18, 86, 107, 0.16)',
        glowRight: 'rgba(182, 96, 67, 0.13)',
        accent: '#12566b',
        accentStrong: '#0b4051',
        accentSoft: 'rgba(18, 86, 107, 0.12)',
        warm: '#b66043',
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
