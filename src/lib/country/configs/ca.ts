import type { CountryConfig } from '../types';

export const caConfig: CountryConfig = {
  code: 'CA',
  name: 'Canada',
  incomeTaxLabel: 'Federal Income Tax',
  currency: { code: 'CAD', symbol: '$', locale: 'en-CA' },

  filingStatuses: [{ id: 'individual', label: 'Individual' }],

  // Canada 2025 federal income tax.
  // Basic Personal Amount ($16,129) modelled as a 0% bracket — same technique as UK Personal Allowance.
  // This slightly overstates the benefit for high earners (BPA phases down above ~$165k) but is a
  // reasonable simplification. Provincial income tax not modelled (TODO).
  incomeTax: {
    individual: {
      standardDeduction: 0,
      brackets: [
        { min: 0, max: 16129, rate: 0.0 },
        { min: 16129, max: 57375, rate: 0.15 },
        { min: 57375, max: 114750, rate: 0.205 },
        { min: 114750, max: 159190, rate: 0.26 },
        { min: 159190, max: 220000, rate: 0.29 },
        { min: 220000, max: Infinity, rate: 0.33 },
      ],
    },
  },

  // Capital gains taxed at 50% inclusion rate; effective rate = 50% × marginal federal rate.
  // No annual exemption. Lifetime Capital Gains Exemption (LCGE) for qualifying property not modelled (TODO).
  capitalGainsTax: {
    individual: {
      annualExemption: 0,
      brackets: [
        { min: 0, max: 16129, rate: 0.0 },
        { min: 16129, max: 57375, rate: 0.075 },
        { min: 57375, max: 114750, rate: 0.1025 },
        { min: 114750, max: 159190, rate: 0.13 },
        { min: 159190, max: 220000, rate: 0.145 },
        { min: 220000, max: Infinity, rate: 0.165 },
      ],
    },
  },

  // CPP employee contribution: 5.95% on earnings between $3,500 (YBE) and $71,300 (YMPE) for 2025.
  // CPP2 (4% on $71,301–$81,900) not modelled (TODO).
  payrollTax: {
    label: 'CPP',
    employeeRate: 0.0595,
    annualMinIncome: 3500,
    annualMaxIncome: 71300,
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
      id: 'nonRegistered',
      label: 'Non-Registered',
      taxCategory: 'taxable',
      hasPercentBonds: true,
      hasCostBasis: true,
      hasContributionBasis: false,
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
    },
    {
      id: 'tfsa',
      label: 'TFSA',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // $7,000 annual limit for 2025 (indexed; cumulative room carry-forward not modelled)
      annualContributionLimits: [{ minAge: 18, limit: 7000 }],
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
    },
    {
      id: 'rrsp',
      label: 'RRSP/RRIF',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // $32,490 annual limit for 2025 (18% of earned income, indexed; income-based formula not modelled)
      annualContributionLimits: [{ minAge: 0, limit: 32490 }],
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: true,
      // No early withdrawal penalty — withdrawals are simply taxed as ordinary income at the marginal rate
    },
  ],

  // No early withdrawal penalties in Canada (RRSP withdrawals are taxable income, not penalised)
  earlyWithdrawalPenaltyGroups: [],

  incomeTypes: [
    {
      id: 'employment',
      label: 'Employment',
      hasWithholding: true,
      hasPayrollTax: true,
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
      id: 'cpp',
      label: 'CPP',
      hasWithholding: true,
      hasPayrollTax: false,
      isSocialSecurityLike: false, // Taxed as ordinary income; no special SS-style inclusion formula
    },
    {
      id: 'oas',
      label: 'OAS',
      hasWithholding: true,
      hasPayrollTax: false,
      isSocialSecurityLike: false,
      // OAS clawback (15% repayment on net income above ~$93,454) not modelled (TODO)
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

  // 65 is OAS eligibility age; used as the switch point for withdrawal ordering
  penaltyFreeAge: 65,

  withdrawalOrder: {
    // Before 65: draw registered accounts (RRSP) to strategically fill lower brackets, then TFSA last
    beforePenaltyFreeAge: [
      { accountTypeId: 'savings' },
      { accountTypeId: 'nonRegistered' },
      { accountTypeId: 'rrsp' },
      { accountTypeId: 'tfsa' },
    ],
    // After 65 (OAS age): prioritise RRSP drawdown to manage OAS clawback risk, preserve TFSA
    afterPenaltyFreeAge: [
      { accountTypeId: 'savings' },
      { accountTypeId: 'rrsp' },
      { accountTypeId: 'nonRegistered' },
      { accountTypeId: 'tfsa' },
    ],
  },

  // RRIF minimum annual withdrawals (mandatory from age 71 when RRSP must be converted to RRIF).
  // Divisors = 1 / minimum withdrawal rate. Source: CRA RRIF minimum withdrawal table.
  rmd: {
    table: {
      71: 18.94, // 5.28%
      72: 18.52, // 5.40%
      73: 18.08, // 5.53%
      74: 17.64, // 5.67%
      75: 17.18, // 5.82%
      76: 16.72, // 5.98%
      77: 16.21, // 6.17%
      78: 15.72, // 6.36%
      79: 15.2, // 6.58%
      80: 14.66, // 6.82%
      81: 14.12, // 7.08%
      82: 13.55, // 7.38%
      83: 12.97, // 7.71%
      84: 12.38, // 8.08%
      85: 11.75, // 8.51%
      86: 11.12, // 8.99%
      87: 10.47, // 9.55%
      88: 9.79, // 10.21%
      89: 9.1, // 10.99%
      90: 8.39, // 11.92%
      91: 7.66, // 13.06%
      92: 6.9, // 14.49%
      93: 6.12, // 16.34%
      94: 5.32, // 18.79%
      95: 5.0, // 20.00%
    },
    getStartAge: () => 71,
  },

  aiPromptContext: `
## Canadian Account Types
- Savings: Cash savings account with no investment returns modelled.
- Non-Registered: Taxable investment account — capital gains taxed at 50% inclusion rate at the marginal federal rate.
- TFSA (Tax-Free Savings Account): Tax-free growth and withdrawals. $7,000 annual contribution limit (2025). Accessible at any age. Unused room carries forward.
- RRSP/RRIF (Registered Retirement Savings Plan / Registered Retirement Income Fund): Pre-tax contributions reduce taxable income. Mandatory conversion to RRIF by end of year you turn 71, with minimum annual withdrawals thereafter. Withdrawals taxed as ordinary income.

## Canadian Federal Tax Rules (2025)
- Basic Personal Amount: $16,129 — effectively a 0% bracket on the first $16,129 of income.
- Federal brackets: 15% (up to $57,375), 20.5% ($57,375–$114,750), 26% ($114,750–$159,190), 29% ($159,190–$220,000), 33% (above $220,000).
- Capital gains: 50% inclusion rate — only half of a capital gain is included in taxable income. No annual exemption for general investment gains.
- CPP: 5.95% employee contribution on earnings $3,500–$71,300 (2025). Employer matches 5.95%.
- Provincial income tax not modelled — effective total tax rates are meaningfully higher than federal-only (typically 5%–17% additional depending on province).

## Canadian Retirement Strategies
- TFSA vs RRSP: TFSA favoured when marginal tax rate at withdrawal is expected to be higher than at contribution; RRSP favoured when the opposite holds.
- RRSP to RRIF conversion at 71 triggers minimum annual withdrawals — draw down strategically before then to avoid OAS clawback (15% repayment on net income above ~$93,454).
- TFSA withdrawals create future contribution room (room restored the following calendar year).
- CPP can be deferred to age 70 for a 42% higher monthly benefit compared to starting at 65.
- OAS can also be deferred to age 70 for a 36% higher monthly benefit.
`,
};
