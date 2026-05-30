import type { AccountTypeConfig, CountryConfig } from './types';
import { usConfig } from './configs/us';
import { ukConfig } from './configs/uk';
import { caConfig } from './configs/ca';
import { auConfig } from './configs/au';
import { nzConfig } from './configs/nz';

export type { CountryConfig } from './types';

const registry: Record<string, CountryConfig> = {
  US: usConfig,
  GB: ukConfig,
  CA: caConfig,
  AU: auConfig,
  NZ: nzConfig,
};

export const AVAILABLE_COUNTRIES: { code: string; name: string }[] = Object.values(registry).map((c) => ({
  code: c.code,
  name: c.name,
}));

export function getCountryConfig(code?: string | null): CountryConfig {
  return registry[code ?? 'US'] ?? registry['US'];
}

export function getAccountTypeConfig(config: CountryConfig, typeId: string): AccountTypeConfig | undefined {
  return config.accountTypes.find((t) => t.id === typeId);
}

/**
 * Returns the annual contribution limit for an account type at a given age.
 * If the account type has a taperedAllowance and annualIncome is provided,
 * the limit is reduced when income exceeds the threshold. Infinity = unlimited.
 */
export function getContributionLimit(config: AccountTypeConfig, age: number, annualIncome?: number): number {
  const tiers = config.annualContributionLimits;
  if (!tiers || tiers.length === 0) return Infinity;

  let limit = tiers[tiers.length - 1].limit;
  for (const tier of tiers) {
    if (age >= tier.minAge && (tier.maxAge === undefined || age <= tier.maxAge)) {
      limit = tier.limit;
      break;
    }
  }

  const taper = config.taperedAllowance;
  if (taper && annualIncome !== undefined && annualIncome > taper.thresholdIncome) {
    const reduction = Math.floor((annualIncome - taper.thresholdIncome) * taper.taperRate);
    limit = Math.max(taper.minAllowance, limit - reduction);
  }

  return limit;
}

/** Returns the Section 415(c) total annual limit for an account type at a given age. Infinity = no such limit. */
export function getSection415cLimit(config: AccountTypeConfig, age: number): number {
  const tiers = config.section415cLimits;
  if (!tiers || tiers.length === 0) return Infinity;
  for (const tier of tiers) {
    if (age >= tier.minAge && (tier.maxAge === undefined || age <= tier.maxAge)) return tier.limit;
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
