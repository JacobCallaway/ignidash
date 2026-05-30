import type { CountryConfig } from '../types';

export const ukConfig: CountryConfig = {
  code: 'GB',
  name: 'United Kingdom',
  incomeTaxLabel: 'Income Tax',
  currency: { code: 'GBP', symbol: '£', locale: 'en-GB' },

  filingStatuses: [{ id: 'individual', label: 'Individual' }],

  // UK 2025/26 Income Tax
  incomeTax: {
    individual: {
      standardDeduction: 0, // Personal Allowance is accounted for in first tax bracket
      brackets: [
        { min: 0, max: 12570, rate: 0.0 },
        { min: 12570, max: 50270, rate: 0.2 },
        { min: 50270, max: 100000, rate: 0.4 },
        { min: 100000, max: 125140, rate: 0.6 },
        { min: 125140, max: Infinity, rate: 0.45 },
      ],
    },
  },

  // UK Capital Gains Tax 2025/26: £3,000 annual exempt amount; 18% (basic) / 24% (higher) for property,
  // 10% (basic) / 20% (higher) for other assets. Simplified to standard asset rates here.
  capitalGainsTax: {
    individual: {
      annualExemption: 3000,
      brackets: [
        { min: 0, max: Infinity, rate: 0.2 }, // Higher rate assumed; simplification
      ],
    },
  },

  // No NIIT equivalent in UK
  // No Social Security taxation equivalent in UK

  // Section 121 (primary residence exclusion) not applicable in UK — Private Residence Relief
  // is modelled separately and generally provides full relief; not modelled here.

  // National Insurance (employee): 8% on £12,570–£50,270; 2% above £50,270
  payrollTax: {
    label: 'National Insurance',
    employeeRate: 0.08,
    annualMinIncome: 12570,
    annualMaxIncome: 50270,
    higherRate: 0.02,
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
      id: 'gia',
      label: 'GIA',
      taxCategory: 'taxable',
      hasPercentBonds: true,
      hasCostBasis: true,
      hasContributionBasis: false,
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
    },
    {
      id: 'isa',
      label: 'ISA',
      taxCategory: 'taxFree',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false, // No penalty for early withdrawal, no need to track basis
      annualContributionLimits: [{ minAge: 18, limit: 20000 }],
      supportsEmployerMatch: false,
      supportsMegaBackdoor: false,
      hasRmd: false,
      // ISA can be accessed at any age with no penalty
    },
    {
      id: 'sipp',
      label: 'SIPP',
      taxCategory: 'taxDeferred',
      hasPercentBonds: true,
      hasCostBasis: false,
      hasContributionBasis: false,
      // Annual Allowance £60,000; tapered for adjusted income above £260,000 (min £10,000)
      annualContributionLimits: [{ minAge: 0, limit: 60000 }],
      taperedAllowance: { thresholdIncome: 260000, minAllowance: 10000, taperRate: 0.5 },
      // 25% of each withdrawal is tax-free (Pension Commencement Lump Sum)
      taxFreeLumpSumPercent: 0.25,
      supportsEmployerMatch: true,
      supportsMegaBackdoor: false,
      hasRmd: false,
      penaltyFreeWithdrawalAge: 57,
      earlyWithdrawalPenaltyGroupId: 'unauthorisedPayment',
    },
  ],

  // Unauthorised payment charge: 55% (simplified from the actual 40% + 15% scheme sanction charge)
  earlyWithdrawalPenaltyGroups: [{ id: 'unauthorisedPayment', rate: 0.55 }],

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
      id: 'statePension',
      label: 'State Pension',
      hasWithholding: false,
      hasPayrollTax: false,
      isSocialSecurityLike: false, // Taxable as income, not subject to NI
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

  penaltyFreeAge: 57,

  withdrawalOrder: {
    // Before pension access age: savings → GIA → ISA (SIPP locked)
    beforePenaltyFreeAge: [{ accountTypeId: 'savings' }, { accountTypeId: 'gia' }, { accountTypeId: 'isa' }],
    // After pension access age: savings → SIPP → GIA → ISA
    afterPenaltyFreeAge: [{ accountTypeId: 'savings' }, { accountTypeId: 'sipp' }, { accountTypeId: 'gia' }, { accountTypeId: 'isa' }],
  },

  // No RMDs in UK
  rmd: undefined,

  //todo: add stamp duty tax for house purchases (could be modelled as a one-time capital gains tax triggered by physical asset purchase)
  //todo: ensure sipp contributions don't pay NI or income tax, and that sipp withdrawals do (except for 25% tax-free lump sum)
  //todo: support automatic tranferring of GIA assets into ISA (i.e. bed-and-ISA strategy)
  //todo: add state pension modelling (e.g. based on National Insurance contribution history, with options to defer for higher payments later)

  aiPromptContext: `
## UK-Specific Account Types
- Savings: Cash savings with no investment returns modelled.
- GIA (General Investment Account): Taxable account — capital gains subject to CGT above the £3,000 annual exempt amount.
- ISA (Individual Savings Account): Tax-free growth and withdrawals, £20,000 annual contribution limit. Accessible at any age.
- SIPP (Self-Invested Personal Pension): Tax relief on contributions. 25% of withdrawals tax-free (PCLS). Accessible from age 57. Annual Allowance £60,000.

## UK Tax Rules
- Personal Allowance: £12,570 (no tax on income below this).
- Income tax bands: 20% (basic, £12,571–£50,270), 40% (higher, £50,271–£125,140), 45% (additional, £125,140+).
- Capital Gains Tax: £3,000 annual exempt amount. 10%/20% for non-residential assets.
- National Insurance: Employee pays 8% on earnings £12,570–£50,270, then 2% above £50,270.
- No equivalent to NIIT, Social Security benefit taxation, or RMDs.
- SIPP contributions receive income tax relief at the marginal rate.

## UK Retirement Strategies
- ISA first: maximise ISA contributions (tax-free, no lock-in) before SIPP beyond employer match.
- Pension access age is 57 from 2028 onwards.
- Salary sacrifice into pension reduces income for NI as well as income tax.
- Bed-and-ISA: sell GIA holdings and rebuy in ISA to shelter future gains (uses CGT exemption).
- State Pension age is 67 for those born after April 1960.
`,
};
