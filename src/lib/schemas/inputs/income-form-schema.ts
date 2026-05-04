/**
 * Income type schema with tax treatment and withholding rules.
 *
 * IncomeType is now a plain string — valid values are determined by the active country config.
 * The Zod schema validates at form-submission time against country-specific income types.
 */

import { z } from 'zod';

import { currencyFieldForbidsZero, optionalPercentageField } from '@/lib/utils/zod-utils';
import type { CountryConfig } from '@/lib/country/types';
import { usConfig } from '@/lib/country/configs/us';

import { growthSchema, frequencyTimeframeSchema } from './income-expenses-shared-schemas';

export type IncomeType = string;

export const incomeTaxSchema = z.object({
  incomeType: z.string(),
  withholding: optionalPercentageField(0, 50, 'Withholding'),
});

export const incomeFormSchema = z
  .object({
    id: z.string(),
    name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters'),
    amount: currencyFieldForbidsZero('Income cannot be negative or zero'),
    growth: growthSchema.optional(),
    taxes: incomeTaxSchema,
    disabled: z.boolean().optional(),
  })
  .extend(frequencyTimeframeSchema.shape)
  .refine(
    (data) => {
      if (data.growth?.growthLimit === undefined || data.growth?.growthRate === undefined || data.growth.growthRate <= 0) {
        return true;
      }
      return data.growth.growthLimit > data.amount;
    },
    {
      message: 'Growth limit must be greater than Amount for positive growth',
      path: ['growth', 'growthLimit'],
    }
  )
  .refine(
    (data) => {
      if (data.growth?.growthLimit === undefined || data.growth?.growthRate === undefined || data.growth.growthRate >= 0) {
        return true;
      }
      return data.growth.growthLimit < data.amount;
    },
    {
      message: 'Growth limit must be less than Amount for negative growth',
      path: ['growth', 'growthLimit'],
    }
  );

export type IncomeInputs = z.infer<typeof incomeFormSchema>;

export function supportsWithholding(incomeType: string, config: CountryConfig = usConfig): boolean {
  return config.incomeTypes.find((t) => t.id === incomeType)?.hasWithholding ?? false;
}

export function defaultWithholding(incomeType: string, config: CountryConfig = usConfig): number | undefined {
  const typeConfig = config.incomeTypes.find((t) => t.id === incomeType);
  if (!typeConfig?.hasWithholding) return undefined;
  // Social Security and equivalents default to 0%; withholding income types default to 20%
  return typeConfig.isSocialSecurityLike ? 0 : 20;
}
