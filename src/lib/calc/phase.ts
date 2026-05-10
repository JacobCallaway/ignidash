/**
 * Simulation phase identification (accumulation vs retirement)
 *
 * Determines the current phase based on the user's retirement strategy:
 * fixed age triggers at a specific age, SWR target triggers when portfolio
 * can sustain expenses at the safe withdrawal rate.
 */

import type { TimelineInputs } from '@/lib/schemas/inputs/timeline-form-schema';
import type { MarketAssumptionsInputs } from '@/lib/schemas/inputs/market-assumptions-form-schema';
import type { CountryConfig, TaxBracket } from '@/lib/country/types';
import type { ExpenseInputs } from '@/lib/schemas/inputs/expense-form-schema';
import type { IncomeInputs } from '@/lib/schemas/inputs/income-form-schema';
import type { GlidePathInputs } from '@/lib/schemas/inputs/glide-path-form-schema';
import type { TimePoint, Frequency } from '@/lib/schemas/inputs/income-expenses-shared-schemas';

import type { SimulationState } from './simulation-engine';
import type { PhysicalAssets } from './physical-assets';

export type PhaseName = 'accumulation' | 'retirement';

/** Current simulation phase data */
export interface PhaseData {
  name: PhaseName;
}

/** Determines the current simulation phase based on retirement strategy */
export class PhaseIdentifier {
  constructor(
    private simulationState: SimulationState,
    private timeline: TimelineInputs,
    private marketAssumptions?: MarketAssumptionsInputs,
    private countryConfig?: CountryConfig,
    private physicalAssets?: PhysicalAssets,
    private expenseInputs?: ExpenseInputs[],
    private incomeInputs?: IncomeInputs[],
    private glidePath?: GlidePathInputs,
    private minRetirementAge?: number
  ) {}

  private isAfterTimePoint(tp: TimePoint, age: number, date: Date, phase: PhaseName): boolean {
    switch (tp.type) {
      case 'now':
        return true;
      case 'atRetirement':
        return phase === 'retirement';
      case 'atLifeExpectancy':
        return false;
      case 'customAge':
        return age >= tp.age!;
      case 'customDate':
        return date >= new Date(tp.year!, tp.month! - 1);
    }
  }

  private isBeforeTimePoint(tp: TimePoint, age: number, date: Date, phase: PhaseName): boolean {
    switch (tp.type) {
      case 'now':
        return false;
      case 'atRetirement':
        return phase !== 'retirement';
      case 'atLifeExpectancy':
        return true;
      case 'customAge':
        return age <= tp.age!;
      case 'customDate':
        return date <= new Date(tp.year!, tp.month! - 1);
    }
  }

  private isTimeframeActive(timeframe: { start: TimePoint; end?: TimePoint }, age: number, date: Date, phase: PhaseName): boolean {
    return (
      this.isAfterTimePoint(timeframe.start, age, date, phase) &&
      (timeframe.end === undefined || this.isBeforeTimePoint(timeframe.end, age, date, phase))
    );
  }

  private rawAnnualAmount(amount: number, frequency: Frequency): number {
    switch (frequency) {
      case 'yearly':
        return amount;
      case 'monthly':
        return amount * 12;
      case 'quarterly':
        return amount * 4;
      case 'biweekly':
        return amount * 26;
      case 'weekly':
        return amount * 52;
      case 'oneTime':
        return 0;
    }
  }

  private applyTaxBrackets(income: number, brackets: TaxBracket[]): number {
    let tax = 0;
    for (const bracket of brackets) {
      if (income <= bracket.min) break;
      const taxableInBracket = Math.min(income, bracket.max) - bracket.min;
      tax += taxableInBracket * bracket.rate;
    }
    return tax;
  }

  /**
   * Estimates the income tax owed on taxDeferred account withdrawals, given other taxable income
   * already present (e.g. state pension). Uses the marginal bracket method: tax on
   * (other + withdrawal taxable portion) minus tax on (other alone) isolates the incremental
   * tax cost so the feasibility loop can deduct it from the portfolio.
   */
  private estimateWithdrawalTax(taxDeferredWithdrawn: number, otherTaxableIncome: number): number {
    if (!this.countryConfig || taxDeferredWithdrawn <= 0) return 0;

    const taxDeferredTypes = this.countryConfig.accountTypes.filter((t) => t.taxCategory === 'taxDeferred');
    if (!taxDeferredTypes.length) return 0;

    const avgTaxableFraction = taxDeferredTypes.reduce((sum, t) => sum + (1 - (t.taxFreeLumpSumPercent ?? 0)), 0) / taxDeferredTypes.length;

    const taxableFromWithdrawal = taxDeferredWithdrawn * avgTaxableFraction;
    const brackets = Object.values(this.countryConfig.incomeTax)[0]?.brackets;
    if (!brackets) return 0;

    const taxOnTotal = this.applyTaxBrackets(otherTaxableIncome + taxableFromWithdrawal, brackets);
    const taxOnOther = this.applyTaxBrackets(otherTaxableIncome, brackets);
    return Math.max(0, taxOnTotal - taxOnOther);
  }

  /**
   * Computes the annual net withdrawal and asset sale proceeds for a given simulation year.
   * Also returns annualOtherTaxableIncome — the income that reduces withdrawals but is still
   * taxable (e.g. state pension), needed to estimate tax on taxDeferred withdrawals.
   *
   * When raw inputs are provided, active items are determined generically from their time frames
   * evaluated at (ageThisYear, dateThisYear, phase='retirement') — so all event types fire naturally.
   * Historical amounts are used for currently-active expenses (accurate, includes growth);
   * raw input amounts are used for items not yet in the historical record.
   *
   * Falls back to historical totals when raw inputs are not provided, preserving backward
   * compatibility with code paths that don't supply inputs to PhaseIdentifier.
   */
  private computeAnnualCashflow(
    ageThisYear: number,
    dateThisYear: Date,
    soldAssetIds: Set<string>
  ): { annualNetWithdrawal: number; annualSaleProceeds: number; annualOtherTaxableIncome: number } {
    const phase: PhaseName = 'retirement';
    const lastExpensesData = this.simulationState.annualData.expenses.at(-1);
    const lastDebtsData = this.simulationState.annualData.debts.at(-1);
    const lastPhysicalAssetsData = this.simulationState.annualData.physicalAssets.at(-1);

    // Annual expenses
    let annualExpenses: number;
    if (this.expenseInputs !== undefined) {
      annualExpenses = 0;
      for (const exp of this.expenseInputs) {
        if (exp.disabled) continue;
        if (!this.isTimeframeActive(exp.timeframe, ageThisYear, dateThisYear, phase)) continue;
        // Historical amount is accurate (includes real growth applied during simulation);
        // fall back to raw input amount for expenses not yet in the historical record
        annualExpenses += lastExpensesData?.perExpenseData[exp.id]?.expense ?? this.rawAnnualAmount(exp.amount, exp.frequency);
      }
    } else {
      annualExpenses = lastExpensesData?.totalExpenses ?? 0;
    }

    // Unsecured debt payments — historical total is a good approximation (conservative: debts
    // will pay off over time, so later years may overestimate, which is acceptable for a
    // feasibility check)
    const annualDebtPayments = lastDebtsData?.totalPayment ?? 0;

    // Physical asset loan payments and sale proceeds
    let annualAssetLoanPayments: number;
    let annualSaleProceeds = 0;
    if (this.physicalAssets !== undefined) {
      annualAssetLoanPayments = 0;
      // Mock state for time-point evaluation; only time.date, time.age, and phase are checked
      const mockState: SimulationState = {
        time: { date: dateThisYear, age: ageThisYear, year: dateThisYear.getFullYear(), month: 1 },
        phase: { name: phase },
        portfolio: this.simulationState.portfolio,
        annualData: this.simulationState.annualData,
      };
      for (const asset of this.physicalAssets.getOwnedAssets()) {
        if (soldAssetIds.has(asset.getId())) continue;
        if (asset.shouldSellThisPeriod(mockState)) {
          annualSaleProceeds += asset.getEquity();
          soldAssetIds.add(asset.getId());
        } else {
          // Historical loan payment (annual) is more accurate than the current rate due to
          // real-rate deflation; fall back to the live instance's current rate
          annualAssetLoanPayments += lastPhysicalAssetsData?.perAssetData[asset.getId()]?.loanPayment ?? asset.getMonthlyLoanPayment() * 12;
        }
      }
    } else {
      annualAssetLoanPayments = lastPhysicalAssetsData?.totalLoanPayment ?? 0;
    }

    // Annual income that reduces the withdrawal need (e.g. state pension, rental income).
    // Returned separately as annualOtherTaxableIncome so the feasibility loop can stack it
    // with taxDeferred withdrawals when estimating income tax.
    let annualIncome = 0;
    if (this.incomeInputs !== undefined) {
      for (const inc of this.incomeInputs) {
        if (inc.disabled) continue;
        if (!this.isTimeframeActive(inc.timeframe, ageThisYear, dateThisYear, phase)) continue;
        annualIncome += this.rawAnnualAmount(inc.amount, inc.frequency);
      }
    }

    const annualNetWithdrawal = Math.max(0, annualExpenses + annualDebtPayments + annualAssetLoanPayments - annualIncome);
    return { annualNetWithdrawal, annualSaleProceeds, annualOtherTaxableIncome: annualIncome };
  }

  /**
   * Simulates retirement year-by-year to life expectancy using generic per-year cash flow
   * computation. All income, expense, asset, and debt events are evaluated at each year's
   * mock state (phase='retirement' from year 0), so time-based triggers fire naturally
   * without special-casing any specific event type.
   *
   * Withdrawals from taxDeferred accounts (e.g. SIPP) generate estimated income tax that is
   * also deducted from the portfolio, preventing the check from being overly optimistic when
   * most savings are in tax-advantaged accounts.
   */
  private simulateRetirementFeasibility(currentAge: number, realAnnualReturn: number): boolean {
    const balanceByType = new Map<string, number>();
    for (const account of this.simulationState.portfolio.getAccounts()) {
      const t = account.getAccountType();
      balanceByType.set(t, (balanceByType.get(t) ?? 0) + account.getBalance());
    }

    const taxDeferredTypeIds = this.countryConfig
      ? new Set(this.countryConfig.accountTypes.filter((t) => t.taxCategory === 'taxDeferred').map((t) => t.id))
      : new Set<string>();

    const allTypeIds = [...balanceByType.keys()];
    const currentDate = this.simulationState.time.date;
    const soldAssetIds = new Set<string>();
    const yearsRemaining = Math.ceil(this.timeline.lifeExpectancy - currentAge);

    for (let i = 0; i < yearsRemaining; i++) {
      const ageThisYear = currentAge + i;
      const dateThisYear = new Date(currentDate.getFullYear() + i, currentDate.getMonth());

      const { annualNetWithdrawal, annualSaleProceeds, annualOtherTaxableIncome } = this.computeAnnualCashflow(
        ageThisYear,
        dateThisYear,
        soldAssetIds
      );

      // Inject sale proceeds into the most liquid accessible account type
      if (annualSaleProceeds > 0) {
        const accessibleOrder = this.countryConfig
          ? this.countryConfig.withdrawalOrder.beforePenaltyFreeAge.map((e) => e.accountTypeId)
          : allTypeIds;
        const boostTarget = accessibleOrder.find((id) => balanceByType.has(id)) ?? accessibleOrder[0];
        if (boostTarget !== undefined) {
          balanceByType.set(boostTarget, (balanceByType.get(boostTarget) ?? 0) + annualSaleProceeds);
        }
      }

      if (annualNetWithdrawal > 0) {
        const withdrawalOrder = this.countryConfig
          ? (ageThisYear < this.countryConfig.penaltyFreeAge
              ? this.countryConfig.withdrawalOrder.beforePenaltyFreeAge
              : this.countryConfig.withdrawalOrder.afterPenaltyFreeAge
            ).map((e) => e.accountTypeId)
          : allTypeIds;

        let remaining = annualNetWithdrawal;
        let taxDeferredWithdrawn = 0;
        for (const typeId of withdrawalOrder) {
          const balance = balanceByType.get(typeId) ?? 0;
          if (balance <= 0) continue;
          const withdrawn = Math.min(balance, remaining);
          balanceByType.set(typeId, balance - withdrawn);
          remaining -= withdrawn;
          if (taxDeferredTypeIds.has(typeId)) taxDeferredWithdrawn += withdrawn;
          if (remaining <= 0) break;
        }

        if (remaining > 0.1) return false; // Shortfall — retirement isn't feasible yet

        // Deduct estimated income tax on taxDeferred withdrawals from the portfolio.
        // otherTaxableIncome (e.g. state pension) shifts SIPP withdrawals into higher brackets.
        if (taxDeferredWithdrawn > 0) {
          const estimatedTax = this.estimateWithdrawalTax(taxDeferredWithdrawn, annualOtherTaxableIncome);
          if (estimatedTax > 0) {
            let taxRemaining = estimatedTax;
            for (const typeId of withdrawalOrder) {
              const balance = balanceByType.get(typeId) ?? 0;
              if (balance <= 0) continue;
              const paid = Math.min(balance, taxRemaining);
              balanceByType.set(typeId, balance - paid);
              taxRemaining -= paid;
              if (taxRemaining <= 0) break;
            }
            // Fall back to any remaining account types not in the primary withdrawal order
            if (taxRemaining > 0.1) {
              for (const [typeId, balance] of balanceByType) {
                if (balance <= 0) continue;
                const paid = Math.min(balance, taxRemaining);
                balanceByType.set(typeId, balance - paid);
                taxRemaining -= paid;
                if (taxRemaining <= 0) break;
              }
            }
            if (taxRemaining > 0.1) return false; // Can't cover tax bill — infeasible
          }
        }
      }

      // Grow all balances by the blended real return
      for (const [typeId, balance] of balanceByType) {
        balanceByType.set(typeId, balance * (1 + realAnnualReturn));
      }
    }

    return true;
  }

  /**
   * Computes the blended real annual return using the more conservative of the current
   * allocation and the glide path terminal allocation (when a glide path is configured).
   * This prevents the feasibility check from overestimating returns that will fall once
   * the portfolio shifts to its final bond-heavy allocation.
   */
  private getBlendedRealReturn(): number {
    if (!this.marketAssumptions) return 0;
    const ma = this.marketAssumptions;
    const alloc = this.simulationState.portfolio.getWeightedAssetAllocation();
    let stockWeight = alloc?.stocks ?? 0.6;
    let bondWeight = alloc?.bonds ?? 0.3;
    const cashWeight = alloc?.cash ?? 0.1;

    // Use terminal glide path allocation when it implies a lower (more conservative) return
    if (this.glidePath?.enabled) {
      const terminalBondWeight = this.glidePath.targetBondAllocation / 100;
      if (terminalBondWeight > bondWeight) {
        bondWeight = terminalBondWeight;
        stockWeight = Math.max(0, 1 - terminalBondWeight - cashWeight);
      }
    }

    const blendedNominal = stockWeight * (ma.stockReturn / 100) + bondWeight * (ma.bondReturn / 100) + cashWeight * (ma.cashReturn / 100);
    return (1 + blendedNominal) / (1 + ma.inflationRate / 100) - 1;
  }

  /**
   * Evaluates the current simulation phase
   * @returns Phase data indicating accumulation or retirement
   */
  getCurrentPhase(): PhaseData {
    switch (this.timeline.retirementStrategy.type) {
      case 'fixedAge':
        const age = this.simulationState.time.age;

        return { name: age < this.timeline.retirementStrategy.retirementAge ? 'accumulation' : 'retirement' };
      case 'swrTarget': {
        const currPhase = this.simulationState.phase;
        if (currPhase?.name === 'retirement') {
          return { ...currPhase };
        }

        if (this.simulationState.annualData.expenses.length === 0) {
          return { name: 'accumulation' };
        }

        const currentAge = this.simulationState.time.age;

        // Compute year-0 retirement cash flow to get the effective annual withdrawal and any
        // immediate asset sale proceeds — both are needed for the SWR ratio check.
        const soldIds = new Set<string>();
        const { annualNetWithdrawal, annualSaleProceeds } = this.computeAnnualCashflow(currentAge, this.simulationState.time.date, soldIds);

        const effectivePortfolioValue = this.simulationState.portfolio.getTotalValue() + annualSaleProceeds;
        const safeWithdrawalRate = this.timeline.retirementStrategy.safeWithdrawalRate / 100;
        const safeWithdrawalAmount = effectivePortfolioValue * safeWithdrawalRate;

        if (annualNetWithdrawal >= safeWithdrawalAmount) return { name: 'accumulation' };

        // When a country config is present (e.g. UK SIPP locked until 57), run a year-by-year
        // forward simulation with country-aware withdrawal ordering to verify the portfolio can
        // actually sustain withdrawals to life expectancy — the SWR formula alone cannot detect
        // when the target is met via locked accounts that are inaccessible before penaltyFreeAge.
        if (this.countryConfig && !this.simulateRetirementFeasibility(currentAge, this.getBlendedRealReturn())) {
          return { name: 'accumulation' };
        }

        return { name: 'retirement' };
      }
      case 'earliestPossible': {
        const currPhase = this.simulationState.phase;
        if (currPhase?.name === 'retirement') {
          return { ...currPhase };
        }

        if (this.simulationState.annualData.expenses.length === 0) {
          return { name: 'accumulation' };
        }

        const currentAge = this.simulationState.time.age;

        // Enforce minimum retirement age when the caller has determined that an earlier
        // retirement leads to insolvency and is retrying with a later start.
        if (this.minRetirementAge !== undefined && currentAge < this.minRetirementAge) {
          return { name: 'accumulation' };
        }

        if (this.timeline.lifeExpectancy - currentAge <= 0) {
          return { name: 'retirement' };
        }

        if (!this.simulateRetirementFeasibility(currentAge, this.getBlendedRealReturn())) {
          return { name: 'accumulation' };
        }

        return { name: 'retirement' };
      }
    }
  }
}
