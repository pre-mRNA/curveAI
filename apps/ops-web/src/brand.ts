import type { CSSProperties } from 'react';

import { getCurveBrandCssVariables, getCurveSurfaceBranding } from '../../../packages/shared/src/branding';

export const opsBrand = getCurveSurfaceBranding('ops');
export const opsBrandStyle = getCurveBrandCssVariables(opsBrand) as CSSProperties;
