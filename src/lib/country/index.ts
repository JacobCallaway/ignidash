import type { AccountTypeConfig, CountryConfig } from './types';
import { usConfig } from './configs/us';
import { ukConfig } from './configs/uk';

export type { CountryConfig } from './types';

const registry: Record<string, CountryConfig> = {
  US: usConfig,
  GB: ukConfig,
};

export function getCountryConfig(code?: string | null): CountryConfig {
  return registry[code ?? 'US'] ?? registry['US'];
}

export function getAccountTypeConfig(config: CountryConfig, typeId: string): AccountTypeConfig | undefined {
  return config.accountTypes.find((t) => t.id === typeId);
}

/** Returns the annual contribution limit for an account type at a given age. Infinity = unlimited. */
export function getContributionLimit(config: AccountTypeConfig, age: number): number {
  const tiers = config.annualContributionLimits;
  if (!tiers || tiers.length === 0) return Infinity;
  for (const tier of tiers) {
    if (age >= tier.minAge) return tier.limit;
  }
  return tiers[tiers.length - 1].limit;
}

/** Returns the Section 415(c) total annual limit for an account type at a given age. Infinity = no such limit. */
export function getSection415cLimit(config: AccountTypeConfig, age: number): number {
  const tiers = config.section415cLimits;
  if (!tiers || tiers.length === 0) return Infinity;
  for (const tier of tiers) {
    if (age >= tier.minAge) return tier.limit;
  }
  return tiers[tiers.length - 1].limit;
}

/** Computes per-period payroll tax given a monthly income amount. */
export function computePayrollTax(monthlyIncome: number, config: NonNullable<CountryConfig['payrollTax']>): number {
  const annualIncome = monthlyIncome * 12;
  const lower = config.annualMinIncome ?? 0;
  const upper = config.annualMaxIncome;

  const taxableStandard = Math.max(0, Math.min(annualIncome, upper ?? annualIncome) - lower);
  const taxableHigher = upper !== undefined ? Math.max(0, annualIncome - upper) : 0;

  const annualTax = taxableStandard * config.employeeRate + taxableHigher * (config.higherRate ?? 0);
  return annualTax / 12;
}

/** Returns all account type IDs that share a contribution limit group with the given account type. */
export function getSharedLimitAccountIds(config: CountryConfig, accountTypeId: string): string[] {
  const acct = getAccountTypeConfig(config, accountTypeId);
  if (!acct?.sharedLimitGroup) return [accountTypeId];
  return config.accountTypes.filter((t) => t.sharedLimitGroup === acct.sharedLimitGroup).map((t) => t.id);
}

/** Returns the limit group key for an account type (used as a key for shared limit tracking). */
export function getLimitGroupKey(config: CountryConfig, accountTypeId: string): string {
  const acct = getAccountTypeConfig(config, accountTypeId);
  return acct?.sharedLimitGroup ?? accountTypeId;
}
