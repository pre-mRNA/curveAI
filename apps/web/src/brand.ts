import type { CSSProperties } from 'react';

import { getCurveBrandCssVariables, getCurveSurfaceBranding } from '../../../packages/shared/src/branding';

export const onboardingBrand = getCurveSurfaceBranding('onboarding');
export const onboardingBrandStyle = getCurveBrandCssVariables(onboardingBrand) as CSSProperties;
