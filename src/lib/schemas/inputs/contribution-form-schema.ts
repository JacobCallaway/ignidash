/**
 * Contribution strategies and country-configurable limit helpers.
 *
 * The core schema shape (dollarAmount / percentRemaining / unlimited) is country-agnostic.
 * buildContributionHelpers() returns limit/feature functions driven by the active country config.
 */

import { z } from 'zod';
import {
  currencyFieldForbidsZero,
  optionalCurrencyFieldForbidsZero,
  optionalPercentageField,
  percentageField,
} from '@/lib/utils/zod-utils';

import type { CountryConfig } from '@/lib/country/types';
import { getContributionLimit, getSection415cLimit, getSharedLimitAccountIds, getLimitGroupKey } from '@/lib/country';
import { usConfig } from '@/lib/country/configs/us';

export const baseContributionSchema = z.object({
  type: z.enum(['spend', 'save']),
});

export type BaseContributionInputs = z.infer<typeof baseContributionSchema>;

const sharedContributionSchema = z.object({
  id: z.string(),
  accountId: z.string().default(''),
  debtId: z.string().optional(),
  rank: z.number().int().min(0),
  maxBalance: optionalCurrencyFieldForbidsZero('Max balance must be greater than zero'),
  incomeId: z.string().optional(),
  disabled: z.boolean().optional(),
  employerMatch: optionalCurrencyFieldForbidsZero('Employer match must be greater than zero'),
  employerMatchPercent: optionalPercentageField(0, 100, 'Employer match percentage'),
  enableMegaBackdoorRoth: z.boolean().optional(),
});

export const contributionFormSchema = z
  .discriminatedUnion('contributionType', [
    z.object({
      ...sharedContributionSchema.shape,
      contributionType: z.literal('dollarAmount'),
      dollarAmount: currencyFieldForbidsZero('Dollar amount must be greater than zero'),
    }),

    z.object({
      ...sharedContributionSchema.shape,
      contributionType: z.literal('percentRemaining'),
      percentRemaining: percentageField(0, 100, 'Percentage of remaining funds'),
    }),

    z.object({
      ...sharedContributionSchema.shape,
      contributionType: z.literal('unlimited'),
    }),
  ])
  .refine((data) => data.accountId !== '' || !!data.debtId, {
    message: 'Account or debt must be selected',
    path: ['accountId'],
  });

export type ContributionInputs = z.infer<typeof contributionFormSchema>;

/** Returns country-specific contribution limit helper functions. */
export function buildContributionHelpers(config: CountryConfig) {
  return {
    getSharedLimitAccounts: (accountTypeId: string): string[] => getSharedLimitAccountIds(config, accountTypeId),
    getLimitGroupKey: (accountTypeId: string): string => getLimitGroupKey(config, accountTypeId),
    getAnnualContributionLimit: (accountTypeId: string, age: number): number => {
      const acct = config.accountTypes.find((t) => t.id === accountTypeId);
      if (!acct) return Infinity;
      return getContributionLimit(acct, age);
    },
    getAnnualSection415cLimit: (accountTypeId: string, age: number): number => {
      const acct = config.accountTypes.find((t) => t.id === accountTypeId);
      if (!acct) return Infinity;
      return getSection415cLimit(acct, age);
    },
    supportsMaxBalance: (accountTypeId: string): boolean => {
      return config.accountTypes.find((t) => t.id === accountTypeId)?.taxCategory === 'cashSavings';
    },
    supportsIncomeAllocation: (accountTypeId: string): boolean => {
      return config.accountTypes.find((t) => t.id === accountTypeId)?.taxCategory !== 'cashSavings';
    },
    supportsEmployerMatch: (accountTypeId: string): boolean => {
      return config.accountTypes.find((t) => t.id === accountTypeId)?.supportsEmployerMatch ?? false;
    },
    supportsMegaBackdoorRoth: (accountTypeId: string): boolean => {
      return config.accountTypes.find((t) => t.id === accountTypeId)?.supportsMegaBackdoor ?? false;
    },
  };
}

// ─── Backward-compat US helpers (used by contribution-rules.ts and UI code) ──

const _usHelpers = buildContributionHelpers(usConfig);

/** @deprecated Use buildContributionHelpers(config).getSharedLimitAccounts instead */
export const sharedLimitAccounts: Record<string, string[]> = Object.fromEntries(
  usConfig.accountTypes.map((t) => [t.id, _usHelpers.getSharedLimitAccounts(t.id)])
);

/** @deprecated Use buildContributionHelpers(config).getLimitGroupKey instead */
export const getAccountTypeLimitKey = (accountType: string): string => _usHelpers.getLimitGroupKey(accountType);

/** @deprecated Use buildContributionHelpers(config).getAnnualContributionLimit instead */
export const getAnnualContributionLimit = (limitKey: string, age: number): number => {
  // limitKey is a shared group id (e.g. '401kCombined') — find an account with that group
  const acct = usConfig.accountTypes.find((t) => (t.sharedLimitGroup ?? t.id) === limitKey);
  if (!acct) return Infinity;
  return getContributionLimit(acct, age);
};

/** @deprecated Use buildContributionHelpers(config).getAnnualSection415cLimit instead */
export const getAnnualSection415cLimit = (age: number): number => {
  const acct = usConfig.accountTypes.find((t) => t.id === '401k');
  if (!acct) return Infinity;
  return getSection415cLimit(acct, age);
};

/** @deprecated Use buildContributionHelpers(config).supportsMaxBalance instead */
export const supportsMaxBalance = (type: string): boolean => _usHelpers.supportsMaxBalance(type);

/** @deprecated Use buildContributionHelpers(config).supportsIncomeAllocation instead */
export const supportsIncomeAllocation = (type: string): boolean => _usHelpers.supportsIncomeAllocation(type);

/** @deprecated Use buildContributionHelpers(config).supportsEmployerMatch instead */
export const supportsEmployerMatch = (type: string): boolean => _usHelpers.supportsEmployerMatch(type);

/** @deprecated Use buildContributionHelpers(config).supportsMegaBackdoorRoth instead */
export const supportsMegaBackdoorRoth = (type: string): boolean => _usHelpers.supportsMegaBackdoorRoth(type);
