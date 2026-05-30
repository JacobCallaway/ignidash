/**
 * Income processing for the simulation engine
 *
 * Handles multiple income sources with varying frequencies, time frames,
 * growth rates, and tax treatments. All country-specific rules come from
 * CountryConfig (payroll tax rates, income type flags).
 */

import type { IncomeInputs, IncomeType } from '@/lib/schemas/inputs/income-form-schema';
import type { TimePoint } from '@/lib/schemas/inputs/income-expenses-shared-schemas';
import type { CountryConfig, IncomeTypeConfig, TaxBracket } from '@/lib/country/types';
import { computePayrollTax } from '@/lib/country';
import { usConfig } from '@/lib/country/configs/us';

import type { SimulationState } from './simulation-engine';

/** Processes all active incomes each month and aggregates annual totals */
export class IncomesProcessor {
  private monthlyData: IncomesData[] = [];

  constructor(
    private simulationState: SimulationState,
    private incomes: Incomes
  ) {}

  /**
   * Processes all active incomes for the current month
   * @returns Aggregated income data with per-income breakdowns
   */
  process(): IncomesData {
    const activeIncomes = this.incomes.getActiveIncomesByTimeFrame(this.simulationState);

    const processedIncomes = activeIncomes.map((income) => income.processMonthlyAmount(this.simulationState.time.year));

    const totals = processedIncomes.reduce(
      (acc, curr) => {
        acc.totalIncome += curr.income;
        acc.totalAmountWithheld += curr.amountWithheld;
        acc.totalFicaTax += curr.ficaTax;
        acc.totalIncomeAfterPayrollDeductions += curr.incomeAfterPayrollDeductions;
        acc.totalTaxFreeIncome += curr.taxFreeIncome;
        acc.totalSocialSecurityIncome += curr.socialSecurityIncome;
        if (curr.owner === 'spouse') {
          acc.spouseTotalIncome += curr.income;
          acc.spouseTotalSocialSecurityIncome += curr.socialSecurityIncome;
          acc.spouseTotalTaxFreeIncome += curr.taxFreeIncome;
        }
        return acc;
      },
      {
        totalIncome: 0,
        totalAmountWithheld: 0,
        totalFicaTax: 0,
        totalIncomeAfterPayrollDeductions: 0,
        totalTaxFreeIncome: 0,
        totalSocialSecurityIncome: 0,
        spouseTotalIncome: 0,
        spouseTotalSocialSecurityIncome: 0,
        spouseTotalTaxFreeIncome: 0,
      }
    );
    const perIncomeData = Object.fromEntries(processedIncomes.map((income) => [income.id, income]));

    const result = { ...totals, perIncomeData };

    this.monthlyData.push(result);
    return result;
  }

  resetMonthlyData(): void {
    this.monthlyData = [];
  }

  getAnnualData(): IncomesData {
    return this.monthlyData.reduce(
      (acc, curr) => {
        acc.totalIncome += curr.totalIncome;
        acc.totalAmountWithheld += curr.totalAmountWithheld;
        acc.totalFicaTax += curr.totalFicaTax;
        acc.totalIncomeAfterPayrollDeductions += curr.totalIncomeAfterPayrollDeductions;
        acc.totalTaxFreeIncome += curr.totalTaxFreeIncome;
        acc.totalSocialSecurityIncome += curr.totalSocialSecurityIncome;
        acc.spouseTotalIncome = (acc.spouseTotalIncome ?? 0) + (curr.spouseTotalIncome ?? 0);
        acc.spouseTotalSocialSecurityIncome = (acc.spouseTotalSocialSecurityIncome ?? 0) + (curr.spouseTotalSocialSecurityIncome ?? 0);
        acc.spouseTotalTaxFreeIncome = (acc.spouseTotalTaxFreeIncome ?? 0) + (curr.spouseTotalTaxFreeIncome ?? 0);

        for (const [incomeID, incomeData] of Object.entries(curr.perIncomeData)) {
          const existing = acc.perIncomeData[incomeID];
          acc.perIncomeData[incomeID] = {
            ...incomeData,
            income: (existing?.income ?? 0) + incomeData.income,
            amountWithheld: (existing?.amountWithheld ?? 0) + incomeData.amountWithheld,
            ficaTax: (existing?.ficaTax ?? 0) + incomeData.ficaTax,
            incomeAfterPayrollDeductions: (existing?.incomeAfterPayrollDeductions ?? 0) + incomeData.incomeAfterPayrollDeductions,
            taxFreeIncome: (existing?.taxFreeIncome ?? 0) + incomeData.taxFreeIncome,
            socialSecurityIncome: (existing?.socialSecurityIncome ?? 0) + incomeData.socialSecurityIncome,
          };
        }

        return acc;
      },
      {
        totalIncome: 0,
        totalAmountWithheld: 0,
        totalFicaTax: 0,
        totalIncomeAfterPayrollDeductions: 0,
        totalTaxFreeIncome: 0,
        totalSocialSecurityIncome: 0,
        spouseTotalIncome: 0,
        spouseTotalSocialSecurityIncome: 0,
        spouseTotalTaxFreeIncome: 0,
        perIncomeData: {},
      } satisfies IncomesData
    );
  }
}

export interface IncomesData {
  totalIncome: number;
  totalAmountWithheld: number;
  totalFicaTax: number;
  totalIncomeAfterPayrollDeductions: number;
  totalTaxFreeIncome: number;
  totalSocialSecurityIncome: number;
  /** Spouse-attributed totals — undefined/0 when no spouse income exists */
  spouseTotalIncome?: number;
  spouseTotalSocialSecurityIncome?: number;
  spouseTotalTaxFreeIncome?: number;
  perIncomeData: Record<string, IncomeData>;
}

/** Collection of income sources that filters by active time frame */
export class Incomes {
  private readonly incomes: Income[];

  constructor(data: IncomeInputs[], countryConfig: CountryConfig = usConfig) {
    this.incomes = data.filter((income) => !income.disabled).map((income) => new Income(income, countryConfig));
  }

  getActiveIncomesByTimeFrame(simulationState: SimulationState): Income[] {
    return this.incomes.filter((income) => income.getIsActiveByTimeFrame(simulationState));
  }

  /**
   * Recomputes automatic withholding rates for the current year.
   * Called at the start of each simulation year so tax is withheld monthly rather than settled as a lump sum.
   * Rate is derived from the expected total annual income and the country's income tax brackets.
   */
  updateAutoWithholdingRates(simulationState: SimulationState, filingStatus: string, countryConfig: CountryConfig): void {
    const activeIncomes = this.getActiveIncomesByTimeFrame(simulationState);
    const autoIncomes = activeIncomes.filter((inc) => inc.isAutoWithholding());
    if (autoIncomes.length === 0) return;

    const incomeTaxConfig = countryConfig.incomeTax[filingStatus];
    const brackets: TaxBracket[] = incomeTaxConfig?.brackets ?? [];
    const standardDeduction = incomeTaxConfig?.standardDeduction ?? 0;

    const computeEffectiveRate = (ownerIncomes: Income[]): number => {
      const total = ownerIncomes.reduce((sum, inc) => sum + inc.getExpectedAnnualAmount(), 0);
      if (total === 0) return 0;
      const hasSpouse = simulationState.spouseAge !== undefined;
      const perOwnerDeduction = hasSpouse ? standardDeduction / 2 : standardDeduction;
      const taxableIncome = Math.max(0, total - perOwnerDeduction);
      let expectedTax = 0;
      for (const bracket of brackets) {
        if (taxableIncome <= bracket.min) break;
        expectedTax += (Math.min(taxableIncome, bracket.max) - bracket.min) * bracket.rate;
      }
      return (expectedTax / total) * 100;
    };

    const primaryIncomes = activeIncomes.filter((inc) => inc.getOwner() === 'primary');
    const spouseIncomes = activeIncomes.filter((inc) => inc.getOwner() === 'spouse');
    const primaryRate = computeEffectiveRate(primaryIncomes);
    const spouseRate = computeEffectiveRate(spouseIncomes);

    for (const income of autoIncomes) {
      income.setAutoWithholdingRate(income.getOwner() === 'spouse' ? spouseRate : primaryRate);
    }
  }
}

export interface IncomeData {
  id: string;
  name: string;
  owner: 'primary' | 'spouse';
  income: number;
  amountWithheld: number;
  ficaTax: number;
  incomeAfterPayrollDeductions: number;
  taxFreeIncome: number;
  socialSecurityIncome: number;
}

/** A single income source with frequency, growth, time frame, and tax treatment */
export class Income {
  private hasOneTimeIncomeOccurred: boolean;
  private id: string;
  private name: string;
  private owner: 'primary' | 'spouse';
  private amount: number;
  private growthRate: number | undefined;
  private growthLimit: number | undefined;
  private timeFrameStart: TimePoint;
  private timeFrameEnd: TimePoint | undefined;
  private frequency: 'yearly' | 'oneTime' | 'quarterly' | 'monthly' | 'biweekly' | 'weekly';
  private lastYear: number = 0;
  private incomeType: IncomeType;
  private withholdingRate: number;
  private autoWithholding: boolean;
  private incomeTypeConfig: IncomeTypeConfig | undefined;
  private countryConfig: CountryConfig;

  constructor(data: IncomeInputs, countryConfig: CountryConfig = usConfig) {
    this.hasOneTimeIncomeOccurred = false;
    this.id = data.id;
    this.name = data.name;
    this.owner = data.owner ?? 'primary';
    this.amount = data.amount;
    this.growthRate = data.growth?.growthRate;
    this.growthLimit = data.growth?.growthLimit;
    this.timeFrameStart = data.timeframe.start;
    this.timeFrameEnd = data.timeframe.end;
    this.frequency = data.frequency;
    this.incomeType = data.taxes.incomeType;
    this.withholdingRate = data.taxes.withholding ?? 0;
    this.autoWithholding = data.taxes.autoWithholding ?? false;
    this.countryConfig = countryConfig;
    this.incomeTypeConfig = countryConfig.incomeTypes.find((t) => t.id === data.taxes.incomeType);
  }

  getOwner(): 'primary' | 'spouse' {
    return this.owner;
  }

  isAutoWithholding(): boolean {
    return this.autoWithholding && (this.incomeTypeConfig?.supportsAutoWithholding ?? false);
  }

  setAutoWithholdingRate(ratePercent: number): void {
    this.withholdingRate = ratePercent;
  }

  /** Returns this income's expected annual gross amount for the current simulation year, without mutating state. */
  getExpectedAnnualAmount(): number {
    const timesToApplyPerYear = this.getTimesToApplyPerYear();
    return this.amount * timesToApplyPerYear;
  }

  /**
   * Calculates this income's monthly amount with growth, withholding, and FICA
   * @param year - Current simulation year (fractional)
   * @returns Income data including gross, withholding, and FICA amounts
   */
  processMonthlyAmount(year: number): IncomeData {
    const rawAmount = this.amount;

    const timesToApplyPerYear = this.getTimesToApplyPerYear();
    const timesToApplyPerMonth = this.getTimesToApplyPerMonth();

    let annualAmount = rawAmount * timesToApplyPerYear;

    if (this.lastYear !== Math.floor(year)) {
      if (this.growthRate) {
        const realGrowthRate = this.growthRate / 100;
        annualAmount *= 1 + realGrowthRate;

        const growthLimit = this.growthLimit;
        if (growthLimit !== undefined && realGrowthRate > 0) {
          annualAmount = Math.min(annualAmount, growthLimit * timesToApplyPerYear);
        } else if (growthLimit !== undefined && realGrowthRate < 0) {
          annualAmount = Math.max(annualAmount, growthLimit * timesToApplyPerYear);
        }

        if (timesToApplyPerYear !== 0) this.amount = Math.max(annualAmount / timesToApplyPerYear, 0);
      }

      this.lastYear = Math.floor(year);
    }

    if (timesToApplyPerYear === 0) {
      return {
        id: this.id,
        name: this.name,
        owner: this.owner,
        income: 0,
        amountWithheld: 0,
        ficaTax: 0,
        incomeAfterPayrollDeductions: 0,
        taxFreeIncome: 0,
        socialSecurityIncome: 0,
      };
    }

    const income = Math.max((annualAmount / timesToApplyPerYear) * timesToApplyPerMonth, 0);

    let amountWithheld: number = 0;
    let ficaTax: number = 0;
    let taxFreeIncome: number = 0;
    let socialSecurityIncome: number = 0;
    const typeConfig = this.incomeTypeConfig;
    if (typeConfig?.isTaxFree) {
      taxFreeIncome = income;
    } else {
      if (typeConfig?.hasWithholding) amountWithheld = income * (this.withholdingRate / 100);
      if (typeConfig?.hasPayrollTax && this.countryConfig.payrollTax) {
        ficaTax = computePayrollTax(income, this.countryConfig.payrollTax);
      }
      if (typeConfig?.isSocialSecurityLike) socialSecurityIncome = income;
    }

    const incomeAfterPayrollDeductions = income - amountWithheld - ficaTax;

    if (this.frequency === 'oneTime') this.hasOneTimeIncomeOccurred = true;
    return {
      id: this.id,
      name: this.name,
      owner: this.owner,
      income,
      amountWithheld,
      ficaTax,
      incomeAfterPayrollDeductions,
      taxFreeIncome,
      socialSecurityIncome,
    };
  }

  getIsActiveByTimeFrame(simulationState: SimulationState): boolean {
    const simTimeIsAfterIncomeStart = this.getIsSimTimeAfterIncomeStart(simulationState);
    const simTimeIsBeforeIncomeEnd = this.getIsSimTimeBeforeIncomeEnd(simulationState);

    return simTimeIsAfterIncomeStart && simTimeIsBeforeIncomeEnd;
  }

  private getIsSimTimeAfterIncomeStart(simulationState: SimulationState): boolean {
    const simDate = simulationState.time.date;
    const simAge = simulationState.time.age;

    const timeFrameStart = this.timeFrameStart;
    switch (timeFrameStart.type) {
      case 'customAge':
        return simAge >= timeFrameStart.age!;
      case 'customDate':
        const customDateYear = timeFrameStart.year!;
        const customDateMonth = timeFrameStart.month! - 1;

        const customStartDate = new Date(customDateYear, customDateMonth);

        return simDate >= customStartDate;
      case 'now':
        return true;
      case 'atRetirement':
        return simulationState.phase?.name === 'retirement';
      case 'atLifeExpectancy':
        return false;
    }
  }

  private getIsSimTimeBeforeIncomeEnd(simulationState: SimulationState): boolean {
    const simDate = simulationState.time.date;
    const simAge = simulationState.time.age;

    const timeFrameEnd = this.timeFrameEnd;
    if (!timeFrameEnd) return true; // If no end time frame is set, consider it active

    switch (timeFrameEnd.type) {
      case 'customAge':
        return simAge <= timeFrameEnd.age!;
      case 'customDate':
        const customDateYear = timeFrameEnd.year!;
        const customDateMonth = timeFrameEnd.month! - 1;

        const customEndDate = new Date(customDateYear, customDateMonth);

        return simDate <= customEndDate;
      case 'now':
        return false;
      case 'atRetirement':
        return simulationState.phase?.name !== 'retirement';
      case 'atLifeExpectancy':
        return true;
    }
  }

  private getTimesToApplyPerYear(): number {
    switch (this.frequency) {
      case 'yearly':
        return 1;
      case 'oneTime':
        if (this.hasOneTimeIncomeOccurred) return 0;
        return 1;
      case 'quarterly':
        return 4;
      case 'monthly':
        return 12;
      case 'biweekly':
        return 26;
      case 'weekly':
        return 52;
    }
  }

  private getTimesToApplyPerMonth(): number {
    switch (this.frequency) {
      case 'yearly':
        return 1 / 12;
      case 'oneTime':
        if (this.hasOneTimeIncomeOccurred) return 0;
        return 1;
      case 'quarterly':
        return 4 / 12;
      case 'monthly':
        return 1;
      case 'biweekly':
        return 26 / 12;
      case 'weekly':
        return 52 / 12;
    }
  }
}
