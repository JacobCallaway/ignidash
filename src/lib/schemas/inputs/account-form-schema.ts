/**
 * Account type schema with country-configurable types and tax classification.
 *
 * AccountInputs is a generic interface used throughout the calc layer.
 * buildAccountFormSchema() returns a country-specific Zod schema for form validation.
 */

import { z } from 'zod';

import { currencyFieldAllowsZero, optionalCurrencyFieldAllowsZero, percentageField } from '@/lib/utils/zod-utils';
import type { CountryConfig } from '@/lib/country/types';

/** Generic account shape used by the simulation engine and data transformers. */
export interface AccountInputs {
  id: string;
  name: string;
  balance: number;
  type: string;
  syncedFinanceId?: string;
  percentBonds?: number;
  costBasis?: number;
  contributionBasis?: number;
}

export type TaxCategory = 'cashSavings' | 'taxable' | 'taxFree' | 'taxDeferred';

const baseShape = {
  id: z.string(),
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters'),
  balance: currencyFieldAllowsZero('Balance cannot be negative'),
  syncedFinanceId: z.string().optional(),
};

const investmentShape = {
  ...baseShape,
  percentBonds: percentageField(0, 100, 'Percentage of bonds'),
};

/** Builds a Zod discriminated union schema for accounts from the active country config. */
export function buildAccountFormSchema(config: CountryConfig): z.ZodType<AccountInputs, AccountInputs> {
  const members = config.accountTypes.map((acct) => {
    switch (acct.taxCategory) {
      case 'cashSavings':
        return z.object({ ...baseShape, type: z.literal(acct.id) });
      case 'taxable':
        return z.object({
          ...investmentShape,
          type: z.literal(acct.id),
          costBasis: acct.hasCostBasis ? optionalCurrencyFieldAllowsZero('Cost basis cannot be negative') : z.undefined(),
        });
      case 'taxFree':
        return z.object({
          ...investmentShape,
          type: z.literal(acct.id),
          contributionBasis: acct.hasContributionBasis
            ? optionalCurrencyFieldAllowsZero('Contribution basis cannot be negative')
            : z.undefined(),
        });
      case 'taxDeferred':
        return z.object({ ...investmentShape, type: z.literal(acct.id) });
    }
  });

  // z.discriminatedUnion requires at least 2 members; fall back to union if only 1 type
  if (members.length === 0) return z.never() as unknown as z.ZodType<AccountInputs, AccountInputs>;
  if (members.length === 1) return members[0] as unknown as z.ZodType<AccountInputs, AccountInputs>;

  return z.discriminatedUnion(
    'type',
    members as unknown as [ReturnType<typeof z.object>, ...ReturnType<typeof z.object>[]]
  ) as unknown as z.ZodType<AccountInputs, AccountInputs>;
}

// Keep the US-only static export so existing code that imports accountFormSchema without a
// country config still compiles. Replaced at form render time by buildAccountFormSchema(config).
import { usConfig } from '@/lib/country/configs/us';
export const accountFormSchema = buildAccountFormSchema(usConfig);

// ─── Helper functions (default to US config for backward compat) ─────────────

/** @deprecated Provide CountryConfig explicitly; defaults to US for backward compat */
export type RothAccountType = string;

export function isRothAccount(type: string, config: CountryConfig = usConfig): boolean {
  return config.accountTypes.find((t) => t.id === type)?.taxCategory === 'taxFree';
}

export function isTraditionalAccount(type: string, config: CountryConfig = usConfig): boolean {
  return config.accountTypes.find((t) => t.id === type)?.taxCategory === 'taxDeferred';
}

export function isInvestmentAccount(type: string, config: CountryConfig = usConfig): boolean {
  return config.accountTypes.find((t) => t.id === type)?.taxCategory !== 'cashSavings';
}

export function accountTypeForDisplay(type: string, config: CountryConfig = usConfig): string {
  return config.accountTypes.find((t) => t.id === type)?.label ?? type;
}

export function taxCategoryFromAccountType(type: string, config: CountryConfig = usConfig): TaxCategory {
  return config.accountTypes.find((t) => t.id === type)?.taxCategory ?? 'taxable';
}

export function taxCategoryFromAccountTypeForDisplay(type: string, config: CountryConfig = usConfig): string {
  const cat = taxCategoryFromAccountType(type, config);
  switch (cat) {
    case 'cashSavings':
      return 'Cash Savings';
    case 'taxable':
      return 'Taxable';
    case 'taxFree':
      return 'Tax-Free';
    case 'taxDeferred':
      return 'Tax-Deferred';
  }
}
