import type { CSSProperties } from 'react';

import { getCurveBrandCssVariables, getCurveSurfaceBranding } from '../../../packages/shared/src/branding';

export const uploadBrand = getCurveSurfaceBranding('upload');
export const uploadBrandStyle = getCurveBrandCssVariables(uploadBrand) as CSSProperties;
