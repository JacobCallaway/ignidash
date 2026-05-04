import { z } from 'zod';

import type { CountryConfig } from '@/lib/country/types';
import { usConfig } from '@/lib/country/configs/us';

export type FilingStatus = string;

export interface TaxSettingsInputs {
  filingStatus: string;
}

export function buildTaxSettingsFormSchema(config: CountryConfig) {
  const ids = config.filingStatuses.map((s) => s.id) as [string, ...string[]];
  return z.object({ filingStatus: z.enum(ids) });
}

// Static US schema kept for backward-compat with existing imports
export const taxSettingsFormSchema = buildTaxSettingsFormSchema(usConfig);
