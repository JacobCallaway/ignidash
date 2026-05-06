export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface IncomeTaxConfig {
  standardDeduction: number;
  brackets: TaxBracket[];
}

export interface CapitalGainsTaxConfig {
  annualExemption: number;
  brackets: TaxBracket[];
}

export interface FilingStatusConfig {
  id: string;
  label: string;
}

/** Age-tiered contribution limit — sorted highest minAge first */
export interface ContributionLimitTier {
  minAge: number;
  maxAge?: number;
  limit: number;
}

export interface AccountTypeConfig {
  id: string;
  label: string;
  taxCategory: 'cashSavings' | 'taxable' | 'taxFree' | 'taxDeferred';
  hasPercentBonds: boolean;
  hasCostBasis: boolean;
  hasContributionBasis: boolean;
  /** Annual contribution limits by age tier (sorted highest minAge first). Absent = unlimited. */
  annualContributionLimits?: ContributionLimitTier[];
  /** Accounts sharing a combined limit with this account */
  sharedLimitGroup?: string;
  /** Total annual limit across all contributions (self + employer) by age tier */
  section415cLimits?: ContributionLimitTier[];
  /** Percent of withdrawal that is tax-free (e.g. 0.25 for UK SIPP) */
  taxFreeLumpSumPercent?: number;
  supportsEmployerMatch: boolean;
  supportsMegaBackdoor: boolean;
  hasRmd: boolean;
  /** Age at which penalty-free withdrawal starts. Undefined = any age is penalty-free. */
  penaltyFreeWithdrawalAge?: number;
  /** References EarlyWithdrawalPenaltyGroup.id. Undefined = no penalty. */
  earlyWithdrawalPenaltyGroupId?: string;
}

export interface EarlyWithdrawalPenaltyGroup {
  id: string;
  rate: number;
  /** If true, penalty applies only to earnings portion (e.g. Roth accounts) */
  earningsOnly?: boolean;
}

export interface IncomeTypeConfig {
  id: string;
  label: string;
  hasWithholding: boolean;
  hasPayrollTax: boolean;
  isSocialSecurityLike: boolean;
  /** If true, income is excluded from all taxable income calculations */
  isTaxFree?: boolean;
  /** If set, withholding must be one of these values */
  allowedWithholdingRates?: number[];
  /** If true, this income type supports automatic withholding computed from tax brackets each year */
  supportsAutoWithholding?: boolean;
}

export interface PayrollTaxConfig {
  label: string;
  employeeRate: number;
  /** Annual income at which payroll tax starts (monthly = this / 12) */
  annualMinIncome?: number;
  /** Annual income cap for the standard rate */
  annualMaxIncome?: number;
  /** Rate applied above annualMaxIncome */
  higherRate?: number;
}

export interface RmdConfig {
  table: Record<number, number>;
  getStartAge: (birthYear: number) => number;
}

export interface WithdrawalOrderItem {
  accountTypeId: string;
  modifier?: 'contributionsOnly';
}

export interface CountryConfig {
  code: string;
  name: string;
  currency: {
    code: string;
    symbol: string;
    locale: string;
  };
  filingStatuses: FilingStatusConfig[];
  incomeTax: Record<string, IncomeTaxConfig>;
  capitalGainsTax: Record<string, CapitalGainsTaxConfig>;
  niit?: {
    rate: number;
    thresholds: Record<string, number>;
  };
  socialSecurityTax?: {
    thresholds: Record<string, Array<{ min: number; max: number; taxablePercentage: number }>>;
  };
  primaryResidenceExclusion?: Record<string, number>;
  payrollTax: PayrollTaxConfig | null;
  accountTypes: AccountTypeConfig[];
  earlyWithdrawalPenaltyGroups: EarlyWithdrawalPenaltyGroup[];
  incomeTypes: IncomeTypeConfig[];
  /** Age at which the withdrawal order switches from before to after */
  penaltyFreeAge: number;
  withdrawalOrder: {
    beforePenaltyFreeAge: WithdrawalOrderItem[];
    afterPenaltyFreeAge: WithdrawalOrderItem[];
  };
  rmd?: RmdConfig;
  aiPromptContext: string;
}
