import type { CSSProperties } from 'react';

import { getCurveBrandCssVariables, getCurveSurfaceBranding } from '../../../packages/shared/src/branding';

export const staffBrand = getCurveSurfaceBranding('staff');
export const staffBrandStyle = getCurveBrandCssVariables(staffBrand) as CSSProperties;
