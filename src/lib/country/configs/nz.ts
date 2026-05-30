import type { CountryConfig } from '../types';

export const nzConfig: CountryConfig = {
  code: 'NZ',
  name: 'New Zealand',
  incomeTaxLabel: 'Income Tax',
  currency: { code: 'NZD', symbol: '$', locale: 'en-NZ' },

  filingStatuses: [{ id: 'individual', label: 'Individual' }],

  // New Zealand 2024-25 income tax. No personal allowance — tax starts from the first dollar.
  incomeTax: {
    individual: {
      standardDeduction: 0,
      brackets: [
        { min: 0, max: 14000, rate: 0.105 },
        { min: 14000, max: 48000, rate: 0.175 },
        { min: 48000, max: 70000, rate: 0.3 },
        { min: 70000, max: 180000, rate: 0.33 },
        { min: 180000, max: Infinity, rate: 0.39 },
      ],
    },
  },

  // New Zealand has no general capital gains tax.
  // The bright-line property test (CGT on residential property sold within 2 years) is not modelled (TODO).
  // PIE (Portfolio Investment Entity) tax on fund returns not modelled within account (TODO).
  capitalGainsTax: {
    individual: {
      annualExemption: 0,
      brackets: [{ min: 0, max: Infinity, rate: 0.0 }],
    },
  },

  // ACC Earner Levy: 1.33% on wage/salary income up to $139,892 (2024-25).
  payrollTax: {
    label: 'ACC Levy',
    employeeRate: 0.0133,
    annualMaxIncome: 139892,
  },

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
      id: 'kiwiSaver',
      label: 'KiwiSaver',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // No annual dollar cap — KiwiSaver contributions are a % of gross pay (3%/4%/6%/8%/10%)
      // plus 3% employer contribution. PIE tax on earnings within fund not modelled (TODO).
      supportsEmployerMatch: true,
      supportsMegaBackdoor: false,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 65,
      earlyWithdrawalPenaltyGroupId: 'kiwiSaverEarlyAccess',
    },
  ],

  // KiwiSaver early access is prohibited by law except for specific hardship/first-home cases.
  // 40% is a rough approximation; the actual rules are non-financial (access is simply denied — TODO).
  earlyWithdrawalPenaltyGroups: [{ id: 'kiwiSaverEarlyAccess', rate: 0.4 }],

  incomeTypes: [
    {
      id: 'employment',
      label: 'Employment',
      hasWithholding: true,
      hasPayrollTax: true, // ACC Earner Levy
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
      id: 'nzSuper',
      label: 'NZ Super',
      hasWithholding: true,
      hasPayrollTax: false,
      isSocialSecurityLike: false, // Taxed as ordinary income; means-test does not apply in NZ
      allowedWithholdingRates: [0, 0.1, 0.15, 0.175, 0.3, 0.33, 0.39],
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

  // 65 is both KiwiSaver eligibility age and NZ Super eligibility age
  penaltyFreeAge: 65,

  withdrawalOrder: {
    // Before 65: KiwiSaver is locked
    beforePenaltyFreeAge: [{ accountTypeId: 'savings' }, { accountTypeId: 'shares' }],
    // After 65: KiwiSaver unlocks (tax-free) — draw first to preserve taxable shares
    afterPenaltyFreeAge: [{ accountTypeId: 'savings' }, { accountTypeId: 'kiwiSaver' }, { accountTypeId: 'shares' }],
  },

  // No mandatory minimum withdrawals for KiwiSaver
  rmd: undefined,

  aiPromptContext: `
## New Zealand Account Types
- Savings: Cash savings with no investment returns modelled.
- Shares: Taxable investment account. New Zealand has no general capital gains tax — gains are not taxed (with limited exceptions such as the bright-line property test, which is not modelled).
- KiwiSaver: Workplace retirement savings scheme. Employee contributes 3%, 4%, 6%, 8%, or 10% of gross pay; employer adds 3%. Growth is taxed at the member's Prescribed Investor Rate (PIR: 10.5%, 17.5%, or 28%) within the fund — not modelled here. Withdrawals from age 65 are tax-free. Also accessible for first home purchase (not modelled).

## New Zealand Tax Rules (2024-25)
- No personal allowance — income tax applies from the first dollar.
- Brackets: 10.5% (up to $14,000), 17.5% ($14,001–$48,000), 30% ($48,001–$70,000), 33% ($70,001–$180,000), 39% (above $180,000).
- No capital gains tax on most assets (shares, property held beyond bright-line period, etc.).
- ACC Earner Levy: 1.33% on wages/salaries up to $139,892 — covers personal accident compensation insurance.
- PIE tax on KiwiSaver earnings (at PIR rate) not modelled within the account.

## New Zealand Retirement Strategies
- KiwiSaver lock-in until 65 provides forced savings — maximise contributions early.
- NZ Super is universal (not means-tested) from age 65 — approximately $25,000–$28,000/year for a single person (2024-25), taxed as ordinary income.
- No capital gains tax means taxable share accounts are highly efficient for long-term wealth building.
- First-home withdrawal: KiwiSaver funds (less government contributions) can be withdrawn for a first home purchase after 3+ years of membership (not modelled).
- Employer 3% KiwiSaver contribution is effectively free money — at minimum, contribute enough to capture the full employer match.
`,
};
