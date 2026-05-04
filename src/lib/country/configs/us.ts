import type { CountryConfig } from '../types';

export const usConfig: CountryConfig = {
  code: 'US',
  name: 'United States',
  currency: { code: 'USD', symbol: '$', locale: 'en-US' },

  filingStatuses: [
    { id: 'single', label: 'Single' },
    { id: 'marriedFilingJointly', label: 'Married Filing Jointly' },
    { id: 'headOfHousehold', label: 'Head of Household' },
  ],

  // Tax year 2026. Source: IRS 2026 inflation adjustments (including OBBBA amendments).
  incomeTax: {
    single: {
      standardDeduction: 16100,
      brackets: [
        { min: 0, max: 12400, rate: 0.1 },
        { min: 12400, max: 50400, rate: 0.12 },
        { min: 50400, max: 105700, rate: 0.22 },
        { min: 105700, max: 201775, rate: 0.24 },
        { min: 201775, max: 256225, rate: 0.32 },
        { min: 256225, max: 640600, rate: 0.35 },
        { min: 640600, max: Infinity, rate: 0.37 },
      ],
    },
    marriedFilingJointly: {
      standardDeduction: 32200,
      brackets: [
        { min: 0, max: 24800, rate: 0.1 },
        { min: 24800, max: 100800, rate: 0.12 },
        { min: 100800, max: 211400, rate: 0.22 },
        { min: 211400, max: 403550, rate: 0.24 },
        { min: 403550, max: 512450, rate: 0.32 },
        { min: 512450, max: 768700, rate: 0.35 },
        { min: 768700, max: Infinity, rate: 0.37 },
      ],
    },
    headOfHousehold: {
      standardDeduction: 24150,
      brackets: [
        { min: 0, max: 17700, rate: 0.1 },
        { min: 17700, max: 67450, rate: 0.12 },
        { min: 67450, max: 105700, rate: 0.22 },
        { min: 105700, max: 201775, rate: 0.24 },
        { min: 201775, max: 256200, rate: 0.32 },
        { min: 256200, max: 640600, rate: 0.35 },
        { min: 640600, max: Infinity, rate: 0.37 },
      ],
    },
  },

  // Tax year 2026. Source: IRS 2026 inflation adjustments.
  capitalGainsTax: {
    single: {
      annualExemption: 0,
      brackets: [
        { min: 0, max: 49450, rate: 0.0 },
        { min: 49450, max: 545500, rate: 0.15 },
        { min: 545500, max: Infinity, rate: 0.2 },
      ],
    },
    marriedFilingJointly: {
      annualExemption: 0,
      brackets: [
        { min: 0, max: 98900, rate: 0.0 },
        { min: 98900, max: 613700, rate: 0.15 },
        { min: 613700, max: Infinity, rate: 0.2 },
      ],
    },
    headOfHousehold: {
      annualExemption: 0,
      brackets: [
        { min: 0, max: 66200, rate: 0.0 },
        { min: 66200, max: 579600, rate: 0.15 },
        { min: 579600, max: Infinity, rate: 0.2 },
      ],
    },
  },

  // IRC §1411: 3.8% surtax on net investment income above the applicable threshold.
  niit: {
    rate: 0.038,
    thresholds: { single: 200000, marriedFilingJointly: 250000, headOfHousehold: 200000 },
  },

  // IRC §86: Taxation of Social Security benefits based on provisional income.
  socialSecurityTax: {
    thresholds: {
      single: [
        { min: 0, max: 25000, taxablePercentage: 0 },
        { min: 25000, max: 34000, taxablePercentage: 0.5 },
        { min: 34000, max: Infinity, taxablePercentage: 0.85 },
      ],
      marriedFilingJointly: [
        { min: 0, max: 32000, taxablePercentage: 0 },
        { min: 32000, max: 44000, taxablePercentage: 0.5 },
        { min: 44000, max: Infinity, taxablePercentage: 0.85 },
      ],
      headOfHousehold: [
        { min: 0, max: 25000, taxablePercentage: 0 },
        { min: 25000, max: 34000, taxablePercentage: 0.5 },
        { min: 34000, max: Infinity, taxablePercentage: 0.85 },
      ],
    },
  },

  // IRC §121: Primary residence capital gains exclusion.
  primaryResidenceExclusion: {
    single: 250000,
    marriedFilingJointly: 500000,
    headOfHousehold: 250000,
  },

  // FICA: 6.2% Social Security + 1.45% Medicare = 7.65%
  payrollTax: { label: 'FICA', employeeRate: 0.0765 },

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
      id: 'taxableBrokerage',
      label: 'Taxable Brokerage',
      taxCategory: 'taxable',
      hasPercentBonds: true,
      hasCostBasis: true,
      hasContributionBasis: false,
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
    },
    {
      id: '401k',
      label: '401(k)',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // 2026 limits: base $24,500 | 50+ $32,500 | 60-63 $35,750
      annualContributionLimits: [
        { minAge: 60, limit: 35750 },
        { minAge: 50, limit: 32500 },
        { minAge: 0, limit: 24500 },
      ],
      sharedLimitGroup: '401kCombined',
      section415cLimits: [
        { minAge: 60, limit: 83250 },
        { minAge: 50, limit: 80000 },
        { minAge: 0, limit: 72000 },
      ],
      supportsEmployerMatch: true,
      supportsMegaBackdoor: false,
      hasRmd: true,
      penaltyFreeWithdrawalAge: 59.5,
      earlyWithdrawalPenaltyGroupId: 'standard',
    },
    {
      id: 'roth401k',
      label: 'Roth 401(k)',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: true,
      annualContributionLimits: [
        { minAge: 60, limit: 35750 },
        { minAge: 50, limit: 32500 },
        { minAge: 0, limit: 24500 },
      ],
      sharedLimitGroup: '401kCombined',
      section415cLimits: [
        { minAge: 60, limit: 83250 },
        { minAge: 50, limit: 80000 },
        { minAge: 0, limit: 72000 },
      ],
      supportsEmployerMatch: true,
      supportsMegaBackdoor: true,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 59.5,
      earlyWithdrawalPenaltyGroupId: 'rothEarnings',
    },
    {
      id: '403b',
      label: '403(b)',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      annualContributionLimits: [
        { minAge: 60, limit: 35750 },
        { minAge: 50, limit: 32500 },
        { minAge: 0, limit: 24500 },
      ],
      sharedLimitGroup: '401kCombined',
      section415cLimits: [
        { minAge: 60, limit: 83250 },
        { minAge: 50, limit: 80000 },
        { minAge: 0, limit: 72000 },
      ],
      supportsEmployerMatch: true,
      supportsMegaBackdoor: false,
      hasRmd: true,
      penaltyFreeWithdrawalAge: 59.5,
      earlyWithdrawalPenaltyGroupId: 'standard',
    },
    {
      id: 'roth403b',
      label: 'Roth 403(b)',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: true,
      annualContributionLimits: [
        { minAge: 60, limit: 35750 },
        { minAge: 50, limit: 32500 },
        { minAge: 0, limit: 24500 },
      ],
      sharedLimitGroup: '401kCombined',
      section415cLimits: [
        { minAge: 60, limit: 83250 },
        { minAge: 50, limit: 80000 },
        { minAge: 0, limit: 72000 },
      ],
      supportsEmployerMatch: true,
      supportsMegaBackdoor: true,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 59.5,
      earlyWithdrawalPenaltyGroupId: 'rothEarnings',
    },
    {
      id: 'ira',
      label: 'IRA',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      annualContributionLimits: [
        { minAge: 50, limit: 8600 },
        { minAge: 0, limit: 7500 },
      ],
      sharedLimitGroup: 'iraCombined',
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: true,
      penaltyFreeWithdrawalAge: 59.5,
      earlyWithdrawalPenaltyGroupId: 'standard',
    },
    {
      id: 'rothIra',
      label: 'Roth IRA',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: true,
      annualContributionLimits: [
        { minAge: 50, limit: 8600 },
        { minAge: 0, limit: 7500 },
      ],
      sharedLimitGroup: 'iraCombined',
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 59.5,
      earlyWithdrawalPenaltyGroupId: 'rothEarnings',
    },
    {
      id: 'hsa',
      label: 'HSA',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      annualContributionLimits: [
        { minAge: 55, limit: 5400 },
        { minAge: 0, limit: 4400 },
      ],
      supportsEmployerMatch: true,
      supportsMegaBackdoor: false,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 65,
      earlyWithdrawalPenaltyGroupId: 'hsa',
    },
  ],

  earlyWithdrawalPenaltyGroups: [
    { id: 'standard', rate: 0.1 },
    { id: 'rothEarnings', rate: 0.1, earningsOnly: true },
    { id: 'hsa', rate: 0.2 },
  ],

  incomeTypes: [
    {
      id: 'wage',
      label: 'Wage',
      hasWithholding: true,
      hasPayrollTax: true,
      isSocialSecurityLike: false,
    },
    {
      id: 'socialSecurity',
      label: 'Social Security',
      hasWithholding: true,
      hasPayrollTax: false,
      isSocialSecurityLike: true,
      allowedWithholdingRates: [0, 7, 10, 12, 22],
    },
    {
      id: 'exempt',
      label: 'Exempt',
      hasWithholding: false,
      hasPayrollTax: false,
      isSocialSecurityLike: false,
      isTaxFree: true,
    },
    {
      id: 'selfEmployment',
      label: 'Self-Employment',
      hasWithholding: false,
      hasPayrollTax: false,
      isSocialSecurityLike: false,
    },
    {
      id: 'pension',
      label: 'Pension',
      hasWithholding: false,
      hasPayrollTax: false,
      isSocialSecurityLike: false,
    },
  ],

  penaltyFreeAge: 59.5,

  withdrawalOrder: {
    beforePenaltyFreeAge: [
      { accountTypeId: 'savings' },
      { accountTypeId: 'taxableBrokerage' },
      { accountTypeId: 'roth401k', modifier: 'contributionsOnly' },
      { accountTypeId: 'roth403b', modifier: 'contributionsOnly' },
      { accountTypeId: 'rothIra', modifier: 'contributionsOnly' },
      { accountTypeId: '401k' },
      { accountTypeId: '403b' },
      { accountTypeId: 'ira' },
      { accountTypeId: 'roth401k' },
      { accountTypeId: 'roth403b' },
      { accountTypeId: 'rothIra' },
      { accountTypeId: 'hsa' },
    ],
    afterPenaltyFreeAge: [
      { accountTypeId: 'savings' },
      { accountTypeId: '401k' },
      { accountTypeId: '403b' },
      { accountTypeId: 'ira' },
      { accountTypeId: 'taxableBrokerage' },
      { accountTypeId: 'roth401k' },
      { accountTypeId: 'roth403b' },
      { accountTypeId: 'rothIra' },
      { accountTypeId: 'hsa' },
    ],
  },

  // SECURE Act 2.0: RMD age 75 for those born 1960+, otherwise 73.
  rmd: {
    table: {
      72: 27.4,
      73: 26.5,
      74: 25.5,
      75: 24.6,
      76: 23.7,
      77: 22.9,
      78: 22.0,
      79: 21.1,
      80: 20.2,
      81: 19.4,
      82: 18.5,
      83: 17.7,
      84: 16.8,
      85: 16.0,
      86: 15.2,
      87: 14.4,
      88: 13.7,
      89: 12.9,
      90: 12.2,
      91: 11.5,
      92: 10.8,
      93: 10.1,
      94: 9.5,
      95: 8.9,
      96: 8.4,
      97: 7.8,
      98: 7.3,
      99: 6.8,
      100: 6.4,
      101: 6.0,
      102: 5.6,
      103: 5.2,
      104: 4.9,
      105: 4.6,
      106: 4.3,
      107: 4.1,
      108: 3.9,
      109: 3.7,
      110: 3.5,
      111: 3.4,
      112: 3.3,
      113: 3.1,
      114: 3.0,
      115: 2.9,
      116: 2.8,
      117: 2.7,
      118: 2.5,
      119: 2.3,
      120: 2.0,
    },
    getStartAge: (birthYear: number) => (birthYear >= 1960 ? 75 : 73),
  },

  aiPromptContext: `
## US-Specific Account Types
- 401(k) / 403(b): Tax-deferred employer-sponsored plans. Contributions reduce taxable income. RMDs required at age 73/75.
- Roth 401(k) / Roth 403(b): After-tax contributions, tax-free growth. Employer match available.
- IRA (Traditional): Individual Retirement Account, tax-deferred. RMDs required.
- Roth IRA: After-tax, tax-free growth and withdrawals. No RMDs.
- HSA: Health Savings Account — triple tax advantage (deductible, grows tax-free, tax-free for medical). Penalty-free non-medical at 65.
- Taxable Brokerage: Subject to capital gains tax on realized gains and dividends.

## US Tax Rules
- Standard deduction applies before bracket calculation.
- Long-term capital gains taxed at 0%, 15%, or 20% depending on income.
- Net Investment Income Tax (NIIT): 3.8% surtax on investment income above $200k (single) / $250k (MFJ).
- Social Security benefits are 0%, 50%, or up to 85% taxable based on provisional income.
- FICA: 7.65% payroll tax on wage income.
- Early withdrawal penalty: 10% for 401k/IRA before 59½; 20% for HSA before 65.

## US Retirement Strategies
- Tax diversification across taxable, tax-deferred, and tax-free accounts.
- Roth conversion ladder: converting tax-deferred to Roth during low-income years.
- Mega-backdoor Roth: after-tax 401k contributions up to Section 415(c) limit (~$72k).
- Rule of 55: penalty-free 401k distributions if you leave employer at age 55+.
- 0% capital gains zone: keeping income below LTCG threshold.
`,
};
