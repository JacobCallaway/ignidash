/**
 * Human-readable formatters for financial data display.
 *
 * Converts domain values (timeframes, growth rates, frequencies, key metrics)
 * into user-facing display strings for cards, lists, and summary panels.
 */

import { formatCompactCurrency, formatPercentage } from '@/lib/utils/number-formatters';
import type { TimePoint, Growth, Frequency } from '@/lib/schemas/inputs/income-expenses-shared-schemas';
import type { IncomeType } from '@/lib/schemas/inputs/income-form-schema';
import type { CountryConfig } from '@/lib/country/types';
import type { KeyMetrics } from '@/lib/types/key-metrics';

export const timeFrameForDisplay = (startTimePoint: TimePoint, endTimePoint?: TimePoint) => {
  function labelFromType(tp: TimePoint) {
    switch (tp.type) {
      case 'now':
        return 'Now';
      case 'atRetirement':
        return 'Retirement';
      case 'atLifeExpectancy':
        return 'Life Expectancy';
      case 'customDate': {
        const month = tp.month;
        const year = tp.year;
        if (month !== undefined && year !== undefined) {
          const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
          return formatter.format(new Date(year, month - 1));
        }
        return 'Custom Date';
      }
      case 'customAge': {
        if (tp.age !== undefined) return `Age ${tp.age}`;
        return 'Custom Age';
      }
    }
  }

  const startLabel = labelFromType(startTimePoint);
  const endLabel = endTimePoint ? labelFromType(endTimePoint) : undefined;

  return endLabel ? `${startLabel} → ${endLabel}` : startLabel;
};

export const physicalAssetTimeFrameForDisplay = (startTimePoint: TimePoint, endTimePoint?: TimePoint) => {
  function labelFromType(tp: TimePoint) {
    switch (tp.type) {
      case 'now':
        return 'Already Owned';
      case 'atRetirement':
        return 'Retirement';
      case 'atLifeExpectancy':
        return 'Never Sold';
      case 'customDate': {
        const month = tp.month;
        const year = tp.year;
        if (month !== undefined && year !== undefined) {
          const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
          return formatter.format(new Date(year, month - 1));
        }
        return 'Custom Date';
      }
      case 'customAge': {
        if (tp.age !== undefined) return `Age ${tp.age}`;
        return 'Custom Age';
      }
    }
  }

  const startLabel = labelFromType(startTimePoint);
  const endLabel = endTimePoint ? labelFromType(endTimePoint) : undefined;

  return endLabel ? `${startLabel} → ${endLabel}` : startLabel;
};

export const growthForDisplay = (growthRate: Growth['growthRate'], growthLimit: Growth['growthLimit']) => {
  if (growthRate === undefined) return 'No Growth';

  const rate = Number(growthRate).toFixed(1);
  if (growthLimit === undefined) return `Rate: ${rate}%, No Limit`;

  return `Rate: ${rate}%, Limit: ${formatCompactCurrency(growthLimit, 0)}`;
};

export const frequencyForDisplay = (frequency: Frequency) => {
  switch (frequency) {
    case 'yearly':
      return '/ yr';
    case 'oneTime':
      return 'one-time';
    case 'quarterly':
      return 'quarterly';
    case 'monthly':
      return '/ mo';
    case 'biweekly':
      return 'biweekly';
    case 'weekly':
      return '/ wk';
  }
};

export const maxBalanceForDisplay = (maxBalance: number | undefined) => {
  if (maxBalance === undefined) return 'Never';
  return `At Balance of ${formatCompactCurrency(maxBalance, 0)}`;
};

const US_INCOME_TYPE_LABELS: Record<string, string> = {
  wage: 'Wage',
  exempt: 'Tax-Free',
  selfEmployment: 'Self-Employment',
  socialSecurity: 'Social Security',
  pension: 'Pension',
};

export const incomeTaxTreatmentForDisplay = (
  type: IncomeType,
  withholding: number | undefined,
  autoWithholding?: boolean,
  countryConfig?: CountryConfig
) => {
  const typeLabel = countryConfig?.incomeTypes.find((t) => t.id === type)?.label ?? US_INCOME_TYPE_LABELS[type] ?? type;

  if (autoWithholding) return `${typeLabel}, Auto`;
  if (withholding === undefined) return typeLabel;
  return `${typeLabel}, ${Number(withholding).toFixed(0)}% Withheld`;
};

export const keyMetricsForDisplay = (keyMetrics: KeyMetrics) => {
  const {
    success,
    retirementAge,
    yearsToRetirement,
    bankruptcyAge,
    yearsToBankruptcy,
    portfolioAtRetirement,
    lifetimeTaxesAndPenalties,
    finalPortfolio,
    progressToRetirement,
  } = keyMetrics;

  const formatters = {
    success: (v: number) =>
      keyMetrics.type === 'multi' ? formatPercentage(v) : v >= 0.99 ? 'Yes!' : v <= 0.01 ? 'No' : formatPercentage(v),
    retirementAge: (v: number | null) => (v !== null ? v.toFixed(0) : '∞'),
    yearsToRetirement: (v: number | null) => (v !== null ? v.toFixed(0) : '∞'),
    bankruptcyAge: (v: number | null) => (v !== null ? v.toFixed(0) : '∞'),
    yearsToBankruptcy: (v: number | null) => (v !== null ? v.toFixed(0) : '∞'),
    portfolioAtRetirement: (v: number | null) => (v !== null ? `${formatCompactCurrency(v, 2)}` : 'N/A'),
    lifetimeTaxesAndPenalties: (v: number) => `${formatCompactCurrency(v, 2)}`,
    finalPortfolio: (v: number) => `${formatCompactCurrency(v, 2)}`,
    progressToRetirement: (v: number | null) => (v !== null ? formatPercentage(v) : 'N/A'),
  };

  return {
    successForDisplay: formatters.success(success),
    retirementAgeForDisplay: formatters.retirementAge(retirementAge),
    yearsToRetirementForDisplay: formatters.yearsToRetirement(yearsToRetirement),
    bankruptcyAgeForDisplay: formatters.bankruptcyAge(bankruptcyAge),
    yearsToBankruptcyForDisplay: formatters.yearsToBankruptcy(yearsToBankruptcy),
    portfolioAtRetirementForDisplay: formatters.portfolioAtRetirement(portfolioAtRetirement),
    lifetimeTaxesAndPenaltiesForDisplay: formatters.lifetimeTaxesAndPenalties(lifetimeTaxesAndPenalties),
    finalPortfolioForDisplay: formatters.finalPortfolio(finalPortfolio),
    progressToRetirementForDisplay: formatters.progressToRetirement(progressToRetirement),
  };
};
