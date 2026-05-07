/**
 * Contribution rules for investment account funding
 *
 * Enforces IRS contribution limits, employer match calculations, and Mega Backdoor
 * Roth (Section 415(c)) limits. Rules are ranked by priority and applied in order
 * during the portfolio contribution waterfall.
 */

import { type ContributionInputs, buildContributionHelpers } from '@/lib/schemas/inputs/contribution-form-schema';
import type { CountryConfig } from '@/lib/country/types';
import { usConfig } from '@/lib/country/configs/us';

import { Account } from './account';
import type { IncomesData } from './incomes';

type ContributionHelpers = ReturnType<typeof buildContributionHelpers>;

/** Aggregates contributions by account type across all rules for shared limit enforcement */
export class ContributionTracker {
  private employeeByType = new Map<string, number>();
  private employerByType = new Map<string, number>();
  private employeeByIncome = new Map<string, number>();

  recordContribution(accountType: string, employee: number, employer: number, incomeId: string | undefined): void {
    this.employeeByType.set(accountType, (this.employeeByType.get(accountType) ?? 0) + employee);
    this.employerByType.set(accountType, (this.employerByType.get(accountType) ?? 0) + employer);
    if (incomeId) this.employeeByIncome.set(incomeId, (this.employeeByIncome.get(incomeId) ?? 0) + employee);
  }

  getEmployeeByTypes(types: string[]): number {
    return types.reduce((sum, t) => sum + (this.employeeByType.get(t) ?? 0), 0);
  }

  getEmployerByTypes(types: string[]): number {
    return types.reduce((sum, t) => sum + (this.employerByType.get(t) ?? 0), 0);
  }

  getEmployeeByIncome(incomeId: string): number {
    return this.employeeByIncome.get(incomeId) ?? 0;
  }

  resetYTD(): void {
    this.employeeByType.clear();
    this.employerByType.clear();
    this.employeeByIncome.clear();
  }

  resetMonthly(): void {
    this.employeeByIncome.clear();
  }
}

/** A single contribution rule targeting a specific debt with extra payment logic */
export class DebtContributionRule {
  private ytdPayment = 0;

  constructor(private contributionInput: ContributionInputs) {}

  getDebtID(): string {
    return this.contributionInput.debtId!;
  }

  getRank(): number {
    return this.contributionInput.rank;
  }

  calculatePayment(remainingToContribute: number, debtBalance: number): number {
    const desired = this.calculateDesiredPayment(remainingToContribute);
    return Math.min(desired, remainingToContribute, debtBalance);
  }

  recordPayment(amount: number): void {
    this.ytdPayment += amount;
  }

  resetYTD(): void {
    this.ytdPayment = 0;
  }

  private calculateDesiredPayment(remainingToContribute: number): number {
    switch (this.contributionInput.contributionType) {
      case 'dollarAmount':
        return Math.max(0, this.contributionInput.dollarAmount - this.ytdPayment);
      case 'percentRemaining':
        return remainingToContribute * (this.contributionInput.percentRemaining / 100);
      case 'unlimited':
        return Infinity;
    }
  }
}

/** Collection of contribution rules with a base strategy (spend or save surplus) */
export class ContributionRules {
  private readonly contributionRules: ContributionRule[];
  private readonly debtContributionRules: DebtContributionRule[];
  private readonly tracker: ContributionTracker;

  constructor(
    rules: ContributionInputs[],
    private baseRule: { type: 'spend' | 'save' },
    countryConfig: CountryConfig = usConfig
  ) {
    this.tracker = new ContributionTracker();
    const helpers = buildContributionHelpers(countryConfig);
    const activeRules = rules.filter((rule) => !rule.disabled);
    this.contributionRules = activeRules
      .filter((rule) => rule.accountId && rule.accountId !== '')
      .map((rule) => new ContributionRule(rule, this.tracker, helpers));
    this.debtContributionRules = activeRules.filter((rule) => !!rule.debtId).map((rule) => new DebtContributionRule(rule));
  }

  getRules(): ContributionRule[] {
    return this.contributionRules;
  }

  getDebtRules(): DebtContributionRule[] {
    return this.debtContributionRules;
  }

  getBaseRuleType(): 'spend' | 'save' {
    return this.baseRule.type;
  }

  resetYTD(): void {
    this.tracker.resetYTD();
    for (const rule of this.contributionRules) {
      rule.resetYTD();
    }
    for (const rule of this.debtContributionRules) {
      rule.resetYTD();
    }
  }

  resetMonthly(): void {
    this.tracker.resetMonthly();
  }
}

/** A single contribution rule targeting a specific account with amount/limit logic */
export class ContributionRule {
  // Year-to-date employee contribution for this rule
  private ytdEmployeeContribution = 0;
  // Year-to-date employer match for this rule
  private ytdEmployerMatch = 0;

  constructor(
    private contributionInput: ContributionInputs,
    private tracker: ContributionTracker,
    private helpers: ContributionHelpers
  ) {}

  /**
   * Calculates the contribution and employer match for this rule
   * @param remainingToContribute - Remaining surplus available for contributions
   * @param account - Target investment account
   * @param age - Current age (for catch-up contribution eligibility)
   * @param incomesData - Income data for income-linked contribution limits
   * @returns Employee contribution and employer match amounts
   */
  calculateContribution(
    remainingToContribute: number,
    account: Account,
    age: number,
    incomesData: IncomesData | null
  ): { contributionAmount: number; employerMatchAmount: number } {
    const remainingToMaxBalance = this.contributionInput.maxBalance
      ? Math.max(0, this.contributionInput.maxBalance - account.getBalance())
      : Infinity;

    const maxContribution = Math.min(
      remainingToMaxBalance,
      remainingToContribute,
      this.calculateRemainingAccountTypeLimit(account, age),
      this.calculateIncomeLimit(incomesData)
    );

    const desiredContribution = this.calculateDesiredContribution(remainingToContribute);

    const contributionAmount = Math.min(desiredContribution, maxContribution);
    const employerMatchAmount = this.calculateEmployerMatch(contributionAmount, incomesData);

    return { contributionAmount, employerMatchAmount };
  }

  /** Records a committed contribution against per-rule YTD counters and the shared tracker */
  recordContribution(employee: number, employer: number, accountType: string): void {
    this.ytdEmployeeContribution += employee;
    this.ytdEmployerMatch += employer;
    this.tracker.recordContribution(accountType, employee, employer, this.contributionInput.incomeId);
  }

  resetYTD(): void {
    this.ytdEmployeeContribution = 0;
    this.ytdEmployerMatch = 0;
  }

  getAccountID(): string {
    return this.contributionInput.accountId;
  }

  getRank(): number {
    return this.contributionInput.rank;
  }

  private calculateIncomeLimit(incomesData: IncomesData | null): number {
    const incomeId = this.contributionInput.incomeId;
    if (!incomeId) return Infinity;
    return Math.max(0, (incomesData?.perIncomeData?.[incomeId]?.income ?? 0) - this.tracker.getEmployeeByIncome(incomeId));
  }

  private calculateEmployerMatch(contributionAmount: number, incomesData: IncomesData | null): number {
    // Percent-of-income match: employer contributes up to X% of the linked income per year
    if (this.contributionInput.employerMatchPercent !== undefined) {
      const incomeId = this.contributionInput.incomeId;
      const monthlyIncome = incomeId ? (incomesData?.perIncomeData?.[incomeId]?.income ?? 0) : (incomesData?.totalIncome ?? 0);
      const maxAnnualMatch = (this.contributionInput.employerMatchPercent / 100) * monthlyIncome * 12;
      const remainingToMax = Math.max(0, maxAnnualMatch - this.ytdEmployerMatch);
      return Math.min(contributionAmount, remainingToMax);
    }

    // Fixed dollar match: employer matches dollar-for-dollar up to the annual cap
    if (!this.contributionInput.employerMatch) return 0;
    const remainingToMaxEmployerMatch = Math.max(0, this.contributionInput.employerMatch - this.ytdEmployerMatch);
    return Math.min(contributionAmount, remainingToMaxEmployerMatch);
  }

  private calculateDesiredContribution(remainingToContribute: number): number {
    switch (this.contributionInput.contributionType) {
      case 'dollarAmount':
        return Math.max(0, this.contributionInput.dollarAmount - this.ytdEmployeeContribution);
      case 'percentRemaining':
        return remainingToContribute * (this.contributionInput.percentRemaining / 100);
      case 'unlimited':
        return Infinity;
    }
  }

  private calculateRemainingAccountTypeLimit(account: Account, age: number): number {
    const accountType = account.getAccountType();
    const sharedGroup = this.helpers.getSharedLimitAccounts(accountType);
    if (!sharedGroup.length) return Infinity;

    if (this.contributionInput.enableMegaBackdoorRoth && this.helpers.supportsMegaBackdoorRoth(accountType)) {
      const employeeContributionsSoFar = this.tracker.getEmployeeByTypes(sharedGroup);
      const employerMatchSoFar = this.tracker.getEmployerByTypes(sharedGroup);
      const totalContributionsSoFar = employeeContributionsSoFar + employerMatchSoFar;
      return Math.max(0, this.helpers.getAnnualSection415cLimit(accountType, age) - totalContributionsSoFar);
    }

    const limit = this.helpers.getAnnualContributionLimit(accountType, age);
    if (!Number.isFinite(limit)) return Infinity;

    const employeeContributionsSoFar = this.tracker.getEmployeeByTypes(sharedGroup);
    return Math.max(0, limit - employeeContributionsSoFar);
  }
}
