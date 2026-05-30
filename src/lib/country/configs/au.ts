import type { CountryConfig } from '../types';

export const auConfig: CountryConfig = {
  code: 'AU',
  name: 'Australia',
  incomeTaxLabel: 'Income Tax',
  currency: { code: 'AUD', symbol: '$', locale: 'en-AU' },

  filingStatuses: [{ id: 'individual', label: 'Individual' }],

  // Australia 2025-26 income tax (Stage 3 cuts in effect from 1 July 2024).
  // Medicare Levy (2%) folded into brackets for simplicity. Low-Income Tax Offset (LITO) not modelled (TODO).
  // Effective rates with Medicare Levy: 0% / 21% / 34.5% / 39% / 47%.
  incomeTax: {
    individual: {
      standardDeduction: 0,
      brackets: [
        { min: 0, max: 18200, rate: 0.0 }, // Tax-free threshold
        { min: 18200, max: 45000, rate: 0.21 }, // 19% + 2% Medicare Levy
        { min: 45000, max: 135000, rate: 0.345 }, // 32.5% + 2%
        { min: 135000, max: 190000, rate: 0.39 }, // 37% + 2%
        { min: 190000, max: Infinity, rate: 0.47 }, // 45% + 2%
      ],
    },
  },

  // Australian CGT applies a 50% discount to assets held >12 months; effective rate = 50% × marginal income tax rate.
  // This models the long-term CGT discount scenario (the common financial planning case).
  // Main residence exemption not modelled (TODO).
  capitalGainsTax: {
    individual: {
      annualExemption: 0,
      brackets: [
        { min: 0, max: 18200, rate: 0.0 },
        { min: 18200, max: 45000, rate: 0.105 }, // 21% × 50%
        { min: 45000, max: 135000, rate: 0.1725 }, // 34.5% × 50%
        { min: 135000, max: 190000, rate: 0.195 }, // 39% × 50%
        { min: 190000, max: Infinity, rate: 0.235 }, // 47% × 50%
      ],
    },
  },

  // No employee payroll levy beyond Medicare Levy (already folded into income tax brackets above).
  // The Super Guarantee (SG) is an employer obligation — modelled via employer match on the Super account.
  payrollTax: null,

  accountTypes: [
    {
      id: 'savings',
      label: 'Savings',
      taxCategory: 'cashSavings',
      hasPercentBonds: false,
      hasCostBasis: false,
      hasContributionBasis: false,
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
    },
    {
      id: 'shares',
      label: 'Shares',
      taxCategory: 'taxable',
      hasPercentBonds: true,
      hasCostBasis: true,
      hasContributionBasis: false,
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
    },
    {
      id: 'superConcessional',
      label: 'Super (Concessional)',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // 2025-26 concessional contributions cap: $30,000 (employee salary sacrifice + employer SG combined)
      annualContributionLimits: [{ minAge: 0, limit: 30000 }],
      // Withdrawals in retirement phase (post-60) are fully tax-free; modelled as 100% tax-free lump sum.
      // Within-fund tax (15% on contributions and earnings in accumulation phase) not modelled (TODO).
      taxFreeLumpSumPercent: 1.0,
      supportsEmployerMatch: true,
      supportsMegaBackdoor: false,
      hasRmd: true,
      penaltyFreeWithdrawalAge: 60,
      earlyWithdrawalPenaltyGroupId: 'preservationAge',
    },
    {
      id: 'superNonConcessional',
      label: 'Super (Non-Concessional)',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // 2025-26 non-concessional cap: $120,000 (after-tax contributions; 3-year bring-forward not modelled)
      annualContributionLimits: [{ minAge: 0, limit: 120000 }],
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 60,
      earlyWithdrawalPenaltyGroupId: 'preservationAge',
    },
  ],

  // Early access to Super before preservation age (60) is severely restricted by law.
  // The 30% rate is a rough approximation; actual tax treatment is complex and age-dependent (TODO).
  earlyWithdrawalPenaltyGroups: [{ id: 'preservationAge', rate: 0.3 }],

  incomeTypes: [
    {
      id: 'employment',
      label: 'Employment',
      hasWithholding: true,
      hasPayrollTax: false, // Medicare Levy is in income tax brackets; no separate employee payroll levy
      isSocialSecurityLike: false,
      supportsAutoWithholding: true,
    },
    {
      id: 'selfEmployment',
      label: 'Self-Employment',
      hasWithholding: false,
      hasPayrollTax: false,
      isSocialSecurityLike: false,
    },
    {
      id: 'agePension',
      label: 'Age Pension',
      hasWithholding: true,
      hasPayrollTax: false,
      isSocialSecurityLike: false, // Taxed as ordinary income; means-test not modelled
      allowedWithholdingRates: [0, 0.1, 0.15, 0.2],
    },
    {
      id: 'exempt',
      label: 'Exempt',
      hasWithholding: false,
      hasPayrollTax: false,
      isSocialSecurityLike: false,
      isTaxFree: true,
    },
  ],

  // Preservation age 60: Super unlocks, switch from pre-60 to post-60 withdrawal ordering
  penaltyFreeAge: 60,

  withdrawalOrder: {
    // Before 60: Super is locked (preservation age not yet reached)
    beforePenaltyFreeAge: [{ accountTypeId: 'savings' }, { accountTypeId: 'shares' }],
    // After 60: draw Super first (tax-free in retirement phase), then taxable shares
    afterPenaltyFreeAge: [
      { accountTypeId: 'savings' },
      { accountTypeId: 'superConcessional' },
      { accountTypeId: 'superNonConcessional' },
      { accountTypeId: 'shares' },
    ],
  },

  // Super account-based pension minimum annual payment factors (as divisors = 1/rate).
  // Applies when Super is in retirement phase (account-based pension).
  // Source: SISR Schedule 7 — minimum pension payment percentages.
  rmd: {
    table: {
      // Under 65: 4% (divisor 25)
      60: 25.0,
      61: 25.0,
      62: 25.0,
      63: 25.0,
      64: 25.0,
      // 65–74: 5% (divisor 20)
      65: 20.0,
      66: 20.0,
      67: 20.0,
      68: 20.0,
      69: 20.0,
      70: 20.0,
      71: 20.0,
      72: 20.0,
      73: 20.0,
      74: 20.0,
      // 75–79: 6% (divisor ~16.7)
      75: 16.7,
      76: 16.7,
      77: 16.7,
      78: 16.7,
      79: 16.7,
      // 80–84: 7% (divisor ~14.3)
      80: 14.3,
      81: 14.3,
      82: 14.3,
      83: 14.3,
      84: 14.3,
      // 85–89: 9% (divisor ~11.1)
      85: 11.1,
      86: 11.1,
      87: 11.1,
      88: 11.1,
      89: 11.1,
      // 90–94: 11% (divisor ~9.1)
      90: 9.1,
      91: 9.1,
      92: 9.1,
      93: 9.1,
      94: 9.1,
      // 95+: 14% (divisor ~7.1)
      95: 7.1,
    },
    getStartAge: () => 65,
  },

  aiPromptContext: `
## Australian Account Types
- Savings: Cash savings with no investment returns modelled.
- Shares: Taxable investment account — capital gains benefit from a 50% CGT discount for assets held >12 months.
- Super (Concessional): Employer and salary-sacrifice contributions up to $30,000/year (2025-26). Contributions reduce taxable income. Withdrawals after age 60 (in retirement phase) are fully tax-free. Accessible from preservation age (60). Employer Super Guarantee (SG) rate is 12% from July 2025.
- Super (Non-Concessional): After-tax contributions up to $120,000/year (2025-26). Tax-free growth and withdrawals from age 60.

## Australian Tax Rules (2025-26)
- Tax-free threshold: $18,200.
- Income tax brackets (including 2% Medicare Levy): 0% (up to $18,200), 21% ($18,201–$45,000), 34.5% ($45,001–$135,000), 39% ($135,001–$190,000), 47% (above $190,000).
- Capital gains: 50% CGT discount for assets held >12 months. Short-term gains taxed at full marginal rates.
- Low Income Tax Offset (LITO) and other offsets not modelled.
- Within-fund Super tax (15% on concessional contributions and investment earnings in accumulation phase) not modelled — actual Super balances grow slightly more slowly than modelled.

## Australian Retirement Strategies
- Preservation age is 60 for those born on or after 1 July 1964 — Super cannot be accessed before this.
- Super in retirement phase (account-based pension) is entirely tax-free for those aged 60+.
- Salary sacrifice into Super is highly tax-efficient — contributions taxed at 15% within the fund vs marginal income tax rate.
- Non-concessional contributions allow moving after-tax wealth into the Super environment for tax-free growth.
- Age Pension eligibility from 67 (means-tested; model does not include means test).
- Minimum annual drawdown from Super account-based pension applies from the year you start the pension.
`,
};
