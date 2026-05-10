/**
 * Portfolio management and transaction processing
 *
 * Orchestrates contributions, withdrawals, RMDs, rebalancing, and tax settlement
 * across all investment accounts. Implements the contribution waterfall (priority-ordered
 * rules with IRS limits) and withdrawal ordering (tax-optimized account sequencing).
 */

import type { AccountInputs } from '@/lib/schemas/inputs/account-form-schema';
import type { GlidePathInputs } from '@/lib/schemas/inputs/glide-path-form-schema';
import type { CountryConfig } from '@/lib/country/types';
import { getAccountTypeConfig } from '@/lib/country';
import { usConfig } from '@/lib/country/configs/us';

import {
  type Account,
  SavingsAccount,
  TaxableBrokerageAccount,
  TaxDeferredAccount,
  TaxFreeAccount,
  InvestmentAccount,
  type AccountDataWithFlows,
} from './account';
import type { SimulationState, SimulationContext } from './simulation-engine';
import {
  type AssetReturnRates,
  type AssetReturnAmounts,
  type AssetAllocation,
  type AssetValues,
  type AssetYieldRates,
  type AssetYieldAmounts,
  type AssetFlows,
  type TaxCategory,
  zeroAssetAmounts,
  addAssetAmounts,
} from './asset';
import { ContributionRules } from './contribution-rules';
import type { IncomesData } from './incomes';
import type { ExpensesData } from './expenses';
import { Debts, type DebtsData } from './debts';
import type { PhysicalAssetsData } from './physical-assets';
import type { AccountDataWithReturns } from './returns';

type FlowsData = { total: AssetFlows; byAccount: Record<string, AssetFlows> };

type WithdrawalModifier = 'contributionsOnly';

interface WithdrawalOrderItem {
  accountTypeId: string;
  modifier?: WithdrawalModifier;
}

const DEFAULT_ASSET_ALLOCATION = { stocks: 0.6, bonds: 0.4, cash: 0 };

const zeroFlows = zeroAssetAmounts<AssetFlows>;
const addFlows = addAssetAmounts<AssetFlows>;

/** Manages monthly portfolio transactions including contributions, withdrawals, RMDs, taxes, and rebalancing */
export class PortfolioProcessor {
  private initialAssetAllocation: AssetAllocation | null;
  private extraSavingsAccount: SavingsAccount;
  private rmdSavingsAccount: SavingsAccount;
  private monthlyData: PortfolioData[] = [];
  private outstandingShortfall: number = 0;

  constructor(
    private simulationState: SimulationState,
    private simulationContext: SimulationContext,
    private contributionRules: ContributionRules,
    private countryConfig: CountryConfig = usConfig,
    private glidePath?: GlidePathInputs,
    private debts?: Debts
  ) {
    this.initialAssetAllocation = this.simulationState.portfolio.getWeightedAssetAllocation();
    this.extraSavingsAccount = this.createExtraSavingsAccount();
    this.rmdSavingsAccount = this.createRmdSavingsAccount();
  }

  private createExtraSavingsAccount(): SavingsAccount {
    return new SavingsAccount({ type: 'savings' as const, id: '54593a0d-7b4f-489d-a5bd-42500afba532', name: 'Extra Savings', balance: 0 });
  }

  private createRmdSavingsAccount(): SavingsAccount {
    return new SavingsAccount({ type: 'savings' as const, id: 'd7288042-1f83-4e50-9a6a-b1ef7a6191cc', name: 'RMD Savings', balance: 0 });
  }

  /**
   * Processes monthly contributions or withdrawals based on net cash flow
   * @param incomesData - Monthly income data
   * @param expensesData - Monthly expense data
   * @param debtsData - Monthly debt payment data
   * @param physicalAssetsData - Monthly physical asset data
   * @returns Portfolio data and any discretionary expense from surplus
   */
  processContributionsAndWithdrawals(
    incomesData: IncomesData,
    expensesData: ExpensesData,
    debtsData: DebtsData,
    physicalAssetsData: PhysicalAssetsData
  ): { portfolioData: PortfolioData; discretionaryExpense: number } {
    const debtAndLoanPayments = debtsData.totalPayment + physicalAssetsData.totalLoanPayment;

    const physicalAssetPurchaseOutlay = physicalAssetsData.totalPurchaseOutlay;
    const physicalAssetSaleProceeds = physicalAssetsData.totalSaleProceeds;

    const netCashFlow =
      incomesData.totalIncomeAfterPayrollDeductions +
      physicalAssetSaleProceeds -
      expensesData.totalExpenses -
      debtAndLoanPayments -
      physicalAssetPurchaseOutlay;

    const {
      total: contributions,
      byAccount: contributionsByAccount,
      discretionaryExpense,
      employerMatch,
      employerMatchByAccount,
      shortfallRepaid,
    } = this.processContributions(netCashFlow, incomesData, physicalAssetSaleProceeds);

    const {
      total: withdrawals,
      byAccount: withdrawalsByAccount,
      realizedGains: realizedGainsBeforeRebalance,
      realizedGainsByAccount: realizedGainsByAccountBeforeRebalance,
      earningsWithdrawn,
      earningsWithdrawnByAccount,
      shortfall,
    } = this.processWithdrawals(netCashFlow);

    const { realizedGainsFromRebalance, realizedGainsByAccountFromRebalance } = this.processRebalance();

    const realizedGains = realizedGainsBeforeRebalance + realizedGainsFromRebalance;
    const realizedGainsByAccount = { ...realizedGainsByAccountBeforeRebalance };
    for (const [k, v] of Object.entries(realizedGainsByAccountFromRebalance)) {
      realizedGainsByAccount[k] = (realizedGainsByAccount[k] ?? 0) + v;
    }

    const perAccountData: Record<string, AccountDataWithFlows> = this.buildPerAccountData(
      {},
      contributionsByAccount,
      employerMatchByAccount,
      withdrawalsByAccount,
      realizedGainsByAccount,
      earningsWithdrawnByAccount,
      {}
    );

    const portfolioData = this.buildPortfolioData(
      {
        withdrawals,
        contributions,
        employerMatch,
        realizedGains,
        earningsWithdrawn,
        rmds: 0,
        shortfall,
        shortfallRepaid,
      },
      perAccountData
    );

    this.monthlyData.push(portfolioData);
    return { portfolioData, discretionaryExpense };
  }

  /**
   * Settles annual tax obligations by withdrawing (tax due) or contributing (refund)
   * @param annualPortfolioDataBeforeTaxes - Portfolio state before tax settlement
   * @param taxesData - Tax amounts due or refundable
   * @returns Updated portfolio data and any discretionary expense from refund
   */
  processTaxes(
    annualPortfolioDataBeforeTaxes: PortfolioData,
    taxesData: { totalTaxesDue: number; totalTaxesRefund: number }
  ): { portfolioData: PortfolioData; discretionaryExpense: number } {
    const perAccountDataBeforeTaxes = annualPortfolioDataBeforeTaxes.perAccountData;

    let withdrawals = { ...annualPortfolioDataBeforeTaxes.withdrawals };
    let contributions = { ...annualPortfolioDataBeforeTaxes.contributions };
    let employerMatch = annualPortfolioDataBeforeTaxes.employerMatch;
    let realizedGains = annualPortfolioDataBeforeTaxes.realizedGains;
    let earningsWithdrawn = annualPortfolioDataBeforeTaxes.earningsWithdrawn;
    let shortfall = annualPortfolioDataBeforeTaxes.shortfall;
    let shortfallRepaid = annualPortfolioDataBeforeTaxes.shortfallRepaid;

    const rmds = annualPortfolioDataBeforeTaxes.rmds;

    let contributionsByAccount: Record<string, AssetFlows> = {};
    let employerMatchByAccount: Record<string, number> = {};
    let withdrawalsByAccount: Record<string, AssetFlows> = {};
    let realizedGainsByAccount: Record<string, number> = {};
    let earningsWithdrawnByAccount: Record<string, number> = {};

    let discretionaryExpense = 0;
    if (taxesData.totalTaxesRefund > 0) {
      const res = this.processContributions(taxesData.totalTaxesRefund, null);
      contributions = addFlows(contributions, res.total);
      contributionsByAccount = res.byAccount;
      discretionaryExpense += res.discretionaryExpense;
      employerMatch += res.employerMatch;
      employerMatchByAccount = res.employerMatchByAccount;
      shortfallRepaid += res.shortfallRepaid;
    }

    if (taxesData.totalTaxesDue > 0) {
      const res = this.processWithdrawals(-taxesData.totalTaxesDue);
      withdrawals = addFlows(withdrawals, res.total);
      withdrawalsByAccount = res.byAccount;
      realizedGains += res.realizedGains;
      realizedGainsByAccount = res.realizedGainsByAccount;
      earningsWithdrawn += res.earningsWithdrawn;
      earningsWithdrawnByAccount = res.earningsWithdrawnByAccount;
      shortfall += res.shortfall;
    }

    const perAccountData: Record<string, AccountDataWithFlows> = this.buildPerAccountData(
      perAccountDataBeforeTaxes,
      contributionsByAccount,
      employerMatchByAccount,
      withdrawalsByAccount,
      realizedGainsByAccount,
      earningsWithdrawnByAccount,
      {}
    );

    const portfolioData = this.buildPortfolioData(
      {
        withdrawals,
        contributions,
        employerMatch,
        realizedGains,
        earningsWithdrawn,
        rmds,
        shortfall,
        shortfallRepaid,
      },
      perAccountData
    );

    return { portfolioData, discretionaryExpense };
  }

  private processContributions(
    netCashFlow: number,
    incomesData: IncomesData | null,
    physicalAssetSaleProceeds = 0
  ): FlowsData & {
    discretionaryExpense: number;
    employerMatch: number;
    employerMatchByAccount: Record<string, number>;
    shortfallRepaid: number;
  } {
    const byAccount: Record<string, AssetFlows> = {};
    const employerMatchByAccount: Record<string, number> = {};
    if (!(netCashFlow > 0)) {
      return {
        total: zeroFlows(),
        byAccount,
        discretionaryExpense: 0,
        employerMatch: 0,
        employerMatchByAccount,
        shortfallRepaid: 0,
      };
    }

    const shortfallRepaid = Math.min(netCashFlow, this.outstandingShortfall);
    this.outstandingShortfall -= shortfallRepaid;

    const age = this.simulationState.time.age;

    this.contributionRules.resetMonthly();

    type AccountEntry = { kind: 'account'; rule: import('./contribution-rules').ContributionRule };
    type DebtEntry = { kind: 'debt'; rule: import('./contribution-rules').DebtContributionRule };
    const allAccountRules: AccountEntry[] = this.contributionRules.getRules().map((rule) => ({ kind: 'account' as const, rule }));
    const allDebtRules: DebtEntry[] = this.contributionRules.getDebtRules().map((rule) => ({ kind: 'debt' as const, rule }));

    // percentOfIncome rules model salary sacrifice: deducted from gross pay before the surplus waterfall,
    // so their amount is independent of rule rank order.
    const [salaryDeferralRules, surplusRules] = [
      allAccountRules.filter((e) => e.rule.isPercentOfIncomeType()),
      [...allAccountRules.filter((e) => !e.rule.isPercentOfIncomeType()), ...allDebtRules].sort(
        (a, b) => a.rule.getRank() - b.rule.getRank()
      ),
    ];

    let employerMatch = 0;
    let remainingToContribute = netCashFlow - shortfallRepaid;

    const applyAccountContribution = (rule: import('./contribution-rules').ContributionRule, surplusCap: number) => {
      const contributeToAccountID = rule.getAccountID();
      const contributeToAccount = this.simulationState.portfolio.getAccountById(contributeToAccountID);
      if (!contributeToAccount) {
        console.warn(`Contribution rule references non-existent account ID: ${contributeToAccountID}`);
        return;
      }

      const { contributionAmount, employerMatchAmount } = rule.calculateContribution(surplusCap, contributeToAccount, age, incomesData);
      if (contributionAmount <= 0 && employerMatchAmount <= 0) return;

      const contributionAllocation = this.getAllocationForContribution(contributionAmount + employerMatchAmount);
      const contributedAssets = contributeToAccount.applyContribution(contributionAmount, 'self', contributionAllocation);
      byAccount[contributeToAccountID] = addFlows(byAccount[contributeToAccountID] ?? zeroFlows(), contributedAssets);

      if (employerMatchAmount > 0) {
        const matchedAssets = contributeToAccount.applyContribution(employerMatchAmount, 'employer', contributionAllocation);
        byAccount[contributeToAccountID] = addFlows(byAccount[contributeToAccountID], matchedAssets);
      }

      employerMatchByAccount[contributeToAccountID] = (employerMatchByAccount[contributeToAccountID] ?? 0) + employerMatchAmount;
      employerMatch += employerMatchAmount;
      rule.recordContribution(contributionAmount, employerMatchAmount, contributeToAccount.getAccountType());
      remainingToContribute -= contributionAmount;
    };

    // First pass: salary deferral rules (percentOfIncome) — bypass the surplus cap
    for (const entry of salaryDeferralRules) {
      applyAccountContribution(entry.rule, Infinity);
    }

    // Second pass: surplus-based rules in rank order
    for (const entry of surplusRules) {
      if (remainingToContribute <= 0) break;

      if (entry.kind === 'account') {
        applyAccountContribution(entry.rule, remainingToContribute);
      } else {
        if (!this.debts) continue;
        const rule = entry.rule;
        const debt = this.debts.getDebtById(rule.getDebtID());
        if (!debt) {
          console.warn(`Debt contribution rule references non-existent debt ID: ${rule.getDebtID()}`);
          continue;
        }
        const paymentAmount = rule.calculatePayment(remainingToContribute, debt.getBalance());
        if (paymentAmount <= 0) continue;
        const actualPaid = debt.applyExtraPayment(paymentAmount);
        rule.recordPayment(actualPaid);
        remainingToContribute -= actualPaid;
      }
    }

    const saveToExtraSavings = (amount: number) => {
      const portfolioHasExtraSavingsAccount = this.simulationState.portfolio
        .getAccounts()
        .some((account) => account.getAccountID() === this.extraSavingsAccount.getAccountID());
      if (!portfolioHasExtraSavingsAccount) {
        this.simulationState.portfolio.addExtraSavingsAccount(this.extraSavingsAccount);
      }
      const contributionAllocation = this.getAllocationForContribution(amount);
      const extraContributed = this.extraSavingsAccount.applyContribution(amount, 'self', contributionAllocation);
      byAccount[this.extraSavingsAccount.getAccountID()] = addFlows(
        byAccount[this.extraSavingsAccount.getAccountID()] ?? zeroFlows(),
        extraContributed
      );
      remainingToContribute -= amount;
    };

    // Sale proceeds that survived the ranked waterfall are always saved — never discretionary spending.
    const saleProceedsRemaining = Math.min(physicalAssetSaleProceeds, remainingToContribute);
    if (saleProceedsRemaining > 0) {
      saveToExtraSavings(saleProceedsRemaining);
    }

    let discretionaryExpense = 0;
    if (remainingToContribute > 0) {
      const baseRule = this.contributionRules.getBaseRuleType();
      switch (baseRule) {
        case 'spend':
          discretionaryExpense = remainingToContribute;
          break;
        case 'save':
          saveToExtraSavings(remainingToContribute);
          break;
      }
    }

    const total = Object.values(byAccount).reduce((acc, curr) => addFlows(acc, curr), zeroFlows());

    return { total, byAccount, discretionaryExpense, employerMatch, employerMatchByAccount, shortfallRepaid };
  }

  private processWithdrawals(netCashFlow: number): FlowsData & {
    realizedGains: number;
    realizedGainsByAccount: Record<string, number>;
    earningsWithdrawn: number;
    earningsWithdrawnByAccount: Record<string, number>;
    shortfall: number;
  } {
    const byAccount: Record<string, AssetFlows> = {};
    const realizedGainsByAccount: Record<string, number> = {};
    const earningsWithdrawnByAccount: Record<string, number> = {};
    if (!(netCashFlow < 0)) {
      return {
        total: zeroFlows(),
        byAccount,
        realizedGains: 0,
        realizedGainsByAccount,
        earningsWithdrawn: 0,
        earningsWithdrawnByAccount,
        shortfall: 0,
      };
    }

    let realizedGains = 0;
    let earningsWithdrawn = 0;

    const withdrawalOrder = this.getWithdrawalOrder();
    let remainingToWithdraw = Math.abs(netCashFlow);

    for (const { accountTypeId, modifier } of withdrawalOrder) {
      if (remainingToWithdraw <= 0) break;

      const accountsOfType = this.simulationState.portfolio.getAccounts().filter((account) => account.getAccountType() === accountTypeId);
      if (accountsOfType.length === 0) continue;

      for (const account of accountsOfType) {
        if (remainingToWithdraw <= 0) break;
        if (!(account.getBalance() > 0)) continue;

        let maxWithdrawable = account.getBalance();
        if (modifier === 'contributionsOnly' && account instanceof TaxFreeAccount) {
          maxWithdrawable = Math.min(maxWithdrawable, account.getContributionBasis());
        }

        const withdrawFromThisAccount = Math.min(remainingToWithdraw, maxWithdrawable);

        const withdrawalAllocation = this.getAllocationForWithdrawal(withdrawFromThisAccount);
        const {
          realizedGains: realizedGainsFromThisAccount,
          earningsWithdrawn: earningsWithdrawnFromThisAccount,
          ...withdrawnAssets
        } = account.applyWithdrawal(withdrawFromThisAccount, 'regular', withdrawalAllocation);

        realizedGainsByAccount[account.getAccountID()] =
          (realizedGainsByAccount[account.getAccountID()] ?? 0) + realizedGainsFromThisAccount;
        realizedGains += realizedGainsFromThisAccount;

        earningsWithdrawnByAccount[account.getAccountID()] =
          (earningsWithdrawnByAccount[account.getAccountID()] ?? 0) + earningsWithdrawnFromThisAccount;
        earningsWithdrawn += earningsWithdrawnFromThisAccount;

        byAccount[account.getAccountID()] = addFlows(byAccount[account.getAccountID()] ?? zeroFlows(), withdrawnAssets);
        remainingToWithdraw -= withdrawFromThisAccount;
      }
    }

    const total = Object.values(byAccount).reduce((acc, curr) => addFlows(acc, curr), zeroFlows());

    // Any remaining amount that couldn't be withdrawn is recorded as a shortfall
    const shortfall = remainingToWithdraw;
    this.outstandingShortfall += shortfall;

    return {
      total,
      byAccount,
      realizedGains,
      realizedGainsByAccount,
      earningsWithdrawn,
      earningsWithdrawnByAccount,
      shortfall,
    };
  }

  /**
   * Processes Required Minimum Distributions for accounts subject to RMDs
   *
   * Calculates RMD amount using the IRS Uniform Lifetime Table, withdraws from
   * each eligible account, and deposits proceeds into a dedicated RMD savings account.
   * @returns Portfolio data reflecting RMD withdrawals and deposits
   */
  processRequiredMinimumDistributions(): PortfolioData {
    const age = this.simulationState.time.age;
    if (age < this.simulationContext.rmdAge)
      throw new Error(`RMDs should not be processed for ages under ${this.simulationContext.rmdAge}`);

    const withdrawalsByAccount: Record<string, AssetFlows> = {};
    const rmdsByAccount: Record<string, number> = {};

    const realizedGainsByAccount: Record<string, number> = {};
    const earningsWithdrawnByAccount: Record<string, number> = {};

    let total = 0;
    let realizedGains = 0;
    let earningsWithdrawn = 0;

    const rmdTable = this.countryConfig.rmd?.table ?? {};
    const accountsWithRMDs = this.simulationState.portfolio.getAccounts().filter((account) => account.getHasRMDs());
    for (const account of accountsWithRMDs) {
      if (!(account.getBalance() > 0)) continue;

      const lookupAge = Math.min(Math.floor(age), 120);
      const factor = rmdTable[lookupAge];
      if (!factor) continue;
      const rmdAmount = account.getBalance() / factor;

      const withdrawalAllocation = this.getAllocationForWithdrawal(rmdAmount);
      const {
        realizedGains: realizedGainsFromThisAccount,
        earningsWithdrawn: earningsWithdrawnFromThisAccount,
        ...withdrawnAssets
      } = account.applyWithdrawal(rmdAmount, 'rmd', withdrawalAllocation);

      realizedGainsByAccount[account.getAccountID()] = realizedGainsFromThisAccount;
      realizedGains += realizedGainsFromThisAccount;

      earningsWithdrawnByAccount[account.getAccountID()] = earningsWithdrawnFromThisAccount;
      earningsWithdrawn += earningsWithdrawnFromThisAccount;

      withdrawalsByAccount[account.getAccountID()] = { ...withdrawnAssets };
      rmdsByAccount[account.getAccountID()] = rmdAmount;
      total += rmdAmount;
    }

    const withdrawals = Object.values(withdrawalsByAccount).reduce((acc, curr) => addFlows(acc, curr), zeroFlows());

    const portfolioHasRmdSavingsAccount = this.simulationState.portfolio
      .getAccounts()
      .some((account) => account.getAccountID() === this.rmdSavingsAccount.getAccountID());
    if (!portfolioHasRmdSavingsAccount && total > 0) {
      this.simulationState.portfolio.addRmdSavingsAccount(this.rmdSavingsAccount);
    }

    const contributionsByAccount: Record<string, AssetFlows> = {};

    const contributionAllocation = this.getAllocationForContribution(total);
    const contributedAssets = this.rmdSavingsAccount.applyContribution(total, 'self', contributionAllocation);
    contributionsByAccount[this.rmdSavingsAccount.getAccountID()] = { ...contributedAssets };

    const perAccountData: Record<string, AccountDataWithFlows> = this.buildPerAccountData(
      {},
      contributionsByAccount,
      {},
      withdrawalsByAccount,
      realizedGainsByAccount,
      earningsWithdrawnByAccount,
      rmdsByAccount
    );

    const portfolioData = this.buildPortfolioData(
      {
        withdrawals,
        employerMatch: 0,
        contributions: { ...contributedAssets },
        realizedGains,
        earningsWithdrawn,
        rmds: total,
        shortfall: 0,
        shortfallRepaid: 0,
      },
      perAccountData
    );

    this.monthlyData.push(portfolioData);
    return portfolioData;
  }

  private buildPerAccountData(
    baseAccountData: Record<string, AccountDataWithFlows>,
    contributionsByAccount: Record<string, AssetFlows>,
    employerMatchByAccount: Record<string, number>,
    withdrawalsByAccount: Record<string, AssetFlows>,
    realizedGainsByAccount: Record<string, number>,
    earningsWithdrawnByAccount: Record<string, number>,
    rmdsByAccount: Record<string, number>
  ): Record<string, AccountDataWithFlows> {
    const addToBaseNumber = (accountID: string, field: keyof AccountDataWithFlows, value: number) => {
      return ((baseAccountData[accountID]?.[field] as number) ?? 0) + value;
    };

    const addToBaseFlows = (accountID: string, field: keyof AccountDataWithFlows, value: AssetFlows) => {
      const base = (baseAccountData[accountID]?.[field] as AssetFlows) ?? zeroFlows();
      return addFlows(base, value);
    };

    return Object.fromEntries(
      this.simulationState.portfolio.getAccounts().map((account) => {
        const accountID = account.getAccountID();
        const accountData = account.getAccountData();

        return [
          accountID,
          {
            ...accountData,
            contributions: addToBaseFlows(accountID, 'contributions', contributionsByAccount[accountID] ?? zeroFlows()),
            employerMatch: addToBaseNumber(accountID, 'employerMatch', employerMatchByAccount[accountID] ?? 0),
            withdrawals: addToBaseFlows(accountID, 'withdrawals', withdrawalsByAccount[accountID] ?? zeroFlows()),
            realizedGains: addToBaseNumber(accountID, 'realizedGains', realizedGainsByAccount[accountID] ?? 0),
            earningsWithdrawn: addToBaseNumber(accountID, 'earningsWithdrawn', earningsWithdrawnByAccount[accountID] ?? 0),
            rmds: addToBaseNumber(accountID, 'rmds', rmdsByAccount[accountID] ?? 0),
          },
        ];
      })
    );
  }

  private buildPortfolioData(
    forPeriodData: {
      withdrawals: AssetFlows;
      contributions: AssetFlows;
      employerMatch: number;
      realizedGains: number;
      earningsWithdrawn: number;
      rmds: number;
      shortfall: number;
      shortfallRepaid: number;
    },
    perAccountData: Record<string, AccountDataWithFlows>
  ): PortfolioData {
    return {
      totalValue: this.simulationState.portfolio.getTotalValue(),
      cumulativeWithdrawals: this.simulationState.portfolio.getCumulativeWithdrawals(),
      cumulativeContributions: this.simulationState.portfolio.getCumulativeContributions(),
      cumulativeEmployerMatch: this.simulationState.portfolio.getCumulativeEmployerMatch(),
      cumulativeRealizedGains: this.simulationState.portfolio.getCumulativeRealizedGains(),
      cumulativeEarningsWithdrawn: this.simulationState.portfolio.getCumulativeEarningsWithdrawn(),
      cumulativeRmds: this.simulationState.portfolio.getCumulativeRmds(),
      outstandingShortfall: this.outstandingShortfall,
      ...forPeriodData,
      perAccountData,
      assetAllocation: this.simulationState.portfolio.getWeightedAssetAllocation(),
    };
  }

  /** Returns the tax-optimized withdrawal order based on age and country config. */
  private getWithdrawalOrder(): Array<WithdrawalOrderItem> {
    const age = this.simulationState.time.age;
    const { penaltyFreeAge, withdrawalOrder } = this.countryConfig;

    if (age < penaltyFreeAge) {
      return withdrawalOrder.beforePenaltyFreeAge;
    } else {
      return withdrawalOrder.afterPenaltyFreeAge;
    }
  }

  resetMonthlyData(): void {
    this.monthlyData = [];
    this.contributionRules.resetYTD();
  }

  getAnnualData(): PortfolioData {
    const lastMonthData = this.monthlyData[this.monthlyData.length - 1];

    return {
      ...lastMonthData,
      ...this.monthlyData.reduce(
        (acc, curr) => {
          acc.contributions = addFlows(acc.contributions, curr.contributions);
          acc.employerMatch += curr.employerMatch;
          acc.withdrawals = addFlows(acc.withdrawals, curr.withdrawals);
          acc.realizedGains += curr.realizedGains;
          acc.earningsWithdrawn += curr.earningsWithdrawn;
          acc.rmds += curr.rmds;
          acc.shortfall += curr.shortfall;
          acc.shortfallRepaid += curr.shortfallRepaid;

          for (const [accountID, accountData] of Object.entries(curr.perAccountData)) {
            const existing = acc.perAccountData[accountID];
            acc.perAccountData[accountID] = {
              ...accountData,
              contributions: addFlows(existing?.contributions ?? zeroFlows(), accountData.contributions),
              employerMatch: (existing?.employerMatch ?? 0) + accountData.employerMatch,
              withdrawals: addFlows(existing?.withdrawals ?? zeroFlows(), accountData.withdrawals),
              realizedGains: (existing?.realizedGains ?? 0) + accountData.realizedGains,
              earningsWithdrawn: (existing?.earningsWithdrawn ?? 0) + accountData.earningsWithdrawn,
              rmds: (existing?.rmds ?? 0) + accountData.rmds,
            };
          }

          return acc;
        },
        {
          contributions: zeroFlows(),
          employerMatch: 0,
          withdrawals: zeroFlows(),
          realizedGains: 0,
          earningsWithdrawn: 0,
          rmds: 0,
          shortfall: 0,
          shortfallRepaid: 0,
          perAccountData: {} as Record<string, AccountDataWithFlows>,
        } satisfies PortfolioFlowData
      ),
    };
  }

  /** Rebalances portfolio toward glide path target allocation if enabled */
  private processRebalance(): {
    rebalanceOccurred: boolean;
    realizedGainsFromRebalance: number;
    realizedGainsByAccountFromRebalance: Record<string, number>;
  } {
    const realizedGainsByAccountFromRebalance: Record<string, number> = {};
    if (!this.glidePath?.enabled) return { rebalanceOccurred: false, realizedGainsFromRebalance: 0, realizedGainsByAccountFromRebalance };

    const totalValue = this.simulationState.portfolio.getTotalValue();
    if (totalValue <= 0) return { rebalanceOccurred: false, realizedGainsFromRebalance: 0, realizedGainsByAccountFromRebalance };

    const { stocks: currentStocksValue, bonds: currentBondsValue } = this.simulationState.portfolio.getCurrentAssetValues();
    const targetAllocation = this.getTargetAssetAllocation();

    const stocksExcess = currentStocksValue - totalValue * targetAllocation.stocks;
    const bondsExcess = currentBondsValue - totalValue * targetAllocation.bonds;

    const rebalanceOrder: Array<AccountInputs['type']> = [
      '401k',
      '403b',
      'ira',
      'hsa',
      'roth401k',
      'roth403b',
      'rothIra',
      'taxableBrokerage',
    ];

    let remainingStocksExcess = stocksExcess;
    let remainingBondsExcess = bondsExcess;
    let realizedGainsFromRebalance = 0;

    for (const accountType of rebalanceOrder) {
      if (Math.abs(remainingStocksExcess) < 1 && Math.abs(remainingBondsExcess) < 1) break;

      const accountsOfType = this.simulationState.portfolio.getAccounts().filter((account) => account.getAccountType() === accountType);
      if (accountsOfType.length === 0) continue;

      for (const account of accountsOfType) {
        if (Math.abs(remainingStocksExcess) < 1 && Math.abs(remainingBondsExcess) < 1) break;
        if (account.getBalance() <= 0) continue;
        if (!(account instanceof InvestmentAccount)) continue;

        const rebalance = account.applyRebalance(remainingStocksExcess, remainingBondsExcess);

        remainingStocksExcess -= rebalance.stocksSold;
        remainingBondsExcess -= rebalance.bondsSold;

        realizedGainsByAccountFromRebalance[account.getAccountID()] = rebalance.realizedGains;
        realizedGainsFromRebalance += rebalance.realizedGains;
      }
    }

    return { rebalanceOccurred: true, realizedGainsFromRebalance, realizedGainsByAccountFromRebalance };
  }

  /**
   * Calculates the current target asset allocation based on glide path progress
   *
   * Linearly interpolates between the initial allocation and the target allocation
   * based on time elapsed toward the glide path end point.
   */
  private getTargetAssetAllocation(): AssetAllocation {
    if (!this.initialAssetAllocation) console.warn('No initial asset allocation available; using default 60/40');

    const startAllocation = this.initialAssetAllocation ?? DEFAULT_ASSET_ALLOCATION;
    if (!this.glidePath?.enabled) return startAllocation;

    const targetAllocation: AssetAllocation = {
      stocks: 1 - this.glidePath.targetBondAllocation / 100,
      bonds: this.glidePath.targetBondAllocation / 100,
      cash: 0,
    };

    let progress: number;

    switch (this.glidePath.endTimePoint.type) {
      case 'customAge': {
        const startAge = this.simulationContext.startAge;
        const endAge = this.glidePath.endTimePoint.age!;
        const currentAge = this.simulationState.time.age;

        const totalSpan = endAge - startAge;
        if (totalSpan <= 0) return targetAllocation;

        progress = (currentAge - startAge) / totalSpan;
        break;
      }
      case 'customDate': {
        const startDate = this.simulationContext.startDate;
        const endDate = new Date(this.glidePath.endTimePoint.year!, this.glidePath.endTimePoint.month! - 1, 1);
        const currentDate = this.simulationState.time.date;

        const totalSpan = endDate.getTime() - startDate.getTime();
        if (totalSpan <= 0) return targetAllocation;

        progress = (currentDate.getTime() - startDate.getTime()) / totalSpan;
        break;
      }
    }

    progress = Math.max(0, Math.min(1, progress));

    return {
      stocks: startAllocation.stocks + (targetAllocation.stocks - startAllocation.stocks) * progress,
      bonds: startAllocation.bonds + (targetAllocation.bonds - startAllocation.bonds) * progress,
      cash: startAllocation.cash + (targetAllocation.cash - startAllocation.cash) * progress,
    };
  }

  private getAllocationForContribution(contributionAmount: number): AssetAllocation {
    const targetAllocation = this.getTargetAssetAllocation();
    const { stocks: currStocksValue, bonds: currBondsValue, cash: currCashValue } = this.simulationState.portfolio.getCurrentAssetValues();
    const currTotalValue = this.simulationState.portfolio.getTotalValue();
    const newTotalValue = currTotalValue + contributionAmount;

    const targetStocksValue = newTotalValue * targetAllocation.stocks;
    const targetBondsValue = newTotalValue * targetAllocation.bonds;
    const targetCashValue = newTotalValue * targetAllocation.cash;

    const stocksNeeded = Math.max(0, targetStocksValue - currStocksValue);
    const bondsNeeded = Math.max(0, targetBondsValue - currBondsValue);
    const cashNeeded = Math.max(0, targetCashValue - currCashValue);
    const totalNeeded = stocksNeeded + bondsNeeded + cashNeeded;

    if (totalNeeded <= 0) return targetAllocation;

    return {
      stocks: stocksNeeded / totalNeeded,
      bonds: bondsNeeded / totalNeeded,
      cash: cashNeeded / totalNeeded,
    };
  }

  private getAllocationForWithdrawal(withdrawalAmount: number): AssetAllocation {
    const targetAllocation = this.getTargetAssetAllocation();
    const { stocks: currStocksValue, bonds: currBondsValue, cash: currCashValue } = this.simulationState.portfolio.getCurrentAssetValues();
    const currTotalValue = this.simulationState.portfolio.getTotalValue();
    const newTotalValue = Math.max(0, currTotalValue - withdrawalAmount);

    const targetStocksValue = newTotalValue * targetAllocation.stocks;
    const targetBondsValue = newTotalValue * targetAllocation.bonds;
    const targetCashValue = newTotalValue * targetAllocation.cash;

    const stocksExcess = Math.max(0, currStocksValue - targetStocksValue);
    const bondsExcess = Math.max(0, currBondsValue - targetBondsValue);
    const cashExcess = Math.max(0, currCashValue - targetCashValue);
    const totalExcess = stocksExcess + bondsExcess + cashExcess;

    if (totalExcess <= 0) return targetAllocation;

    return {
      stocks: stocksExcess / totalExcess,
      bonds: bondsExcess / totalExcess,
      cash: cashExcess / totalExcess,
    };
  }
}

/** Point-in-time snapshot fields — taken from last month's data, not summed */
interface PortfolioSnapshotData {
  totalValue: number;
  cumulativeWithdrawals: AssetFlows;
  cumulativeContributions: AssetFlows;
  cumulativeEmployerMatch: number;
  cumulativeRealizedGains: number;
  cumulativeEarningsWithdrawn: number;
  cumulativeRmds: number;
  outstandingShortfall: number;
  assetAllocation: AssetAllocation | null;
}

/** Flow fields — summed across months in getAnnualData */
interface PortfolioFlowData {
  withdrawals: AssetFlows;
  contributions: AssetFlows;
  employerMatch: number;
  realizedGains: number;
  earningsWithdrawn: number;
  rmds: number;
  shortfall: number;
  shortfallRepaid: number;
  perAccountData: Record<string, AccountDataWithFlows>;
}

export type PortfolioData = PortfolioSnapshotData & PortfolioFlowData;

/** Container for all investment accounts with aggregate operations */
export class Portfolio {
  private accounts: Account[];

  constructor(data: AccountInputs[], countryConfig: CountryConfig = usConfig) {
    this.accounts = data.map((accountData) => {
      const typeConfig = getAccountTypeConfig(countryConfig, accountData.type);
      const hasRmd = typeConfig?.hasRmd ?? false;
      switch (typeConfig?.taxCategory ?? 'cashSavings') {
        case 'cashSavings':
          return new SavingsAccount(accountData);
        case 'taxable':
          return new TaxableBrokerageAccount(accountData);
        case 'taxFree':
          return new TaxFreeAccount(accountData, hasRmd);
        case 'taxDeferred':
          return new TaxDeferredAccount(accountData, hasRmd);
        default:
          return new SavingsAccount(accountData);
      }
    });
  }

  addExtraSavingsAccount(extraSavingsAccount: SavingsAccount): void {
    this.accounts.push(extraSavingsAccount);
  }

  addRmdSavingsAccount(rmdSavingsAccount: SavingsAccount): void {
    this.accounts.push(rmdSavingsAccount);
  }

  getWeightedAssetAllocation(): AssetAllocation | null {
    const totalValue = this.getTotalValue();
    if (totalValue === 0) return null;

    const weightedAllocation = this.accounts.reduce((acc, account) => {
      const weight = account.getBalance() / totalValue;

      return {
        stocks: acc.stocks + (account.getAccountData().assetAllocation.stocks ?? 0) * weight,
        bonds: acc.bonds + (account.getAccountData().assetAllocation.bonds ?? 0) * weight,
        cash: acc.cash + (account.getAccountData().assetAllocation.cash ?? 0) * weight,
      };
    }, zeroAssetAmounts<AssetAllocation>());

    return weightedAllocation;
  }

  getCurrentAssetValues(): AssetValues {
    return this.accounts.reduce(
      (acc, account) => ({
        stocks: acc.stocks + account.getBalance() * account.getAccountData().assetAllocation.stocks,
        bonds: acc.bonds + account.getBalance() * account.getAccountData().assetAllocation.bonds,
        cash: acc.cash + account.getBalance() * account.getAccountData().assetAllocation.cash,
      }),
      zeroAssetAmounts<AssetValues>()
    );
  }

  getAccounts(): Account[] {
    return this.accounts;
  }

  getTotalValue(): number {
    return this.accounts.reduce((acc, account) => acc + account.getBalance(), 0);
  }

  getCumulativeWithdrawals(): AssetFlows {
    return this.accounts.reduce((acc, account) => addFlows(acc, account.getCumulativeWithdrawals()), zeroFlows());
  }

  getCumulativeContributions(): AssetFlows {
    return this.accounts.reduce((acc, account) => addFlows(acc, account.getCumulativeContributions()), zeroFlows());
  }

  getCumulativeEmployerMatch(): number {
    return this.accounts.reduce((acc, account) => acc + account.getCumulativeEmployerMatch(), 0);
  }

  getCumulativeRealizedGains(): number {
    return this.accounts.reduce((acc, account) => acc + account.getCumulativeRealizedGains(), 0);
  }

  getCumulativeEarningsWithdrawn(): number {
    return this.accounts.reduce((acc, account) => acc + account.getCumulativeEarningsWithdrawn(), 0);
  }

  getCumulativeRmds(): number {
    return this.accounts.reduce((acc, account) => acc + account.getCumulativeRmds(), 0);
  }

  getCumulativeReturnAmounts(): AssetReturnAmounts {
    return this.accounts.reduce(
      (acc, curr) => addAssetAmounts(acc, curr.getCumulativeReturnAmounts()),
      zeroAssetAmounts<AssetReturnAmounts>()
    );
  }

  getAccountById(accountID: string): Account | undefined {
    return this.accounts.find((account) => account.getAccountID() === accountID);
  }

  /**
   * Applies return rates to all accounts and aggregates results
   * @param returnRates - Monthly return rates by asset class
   * @returns Total and per-account return amounts
   */
  applyReturns(returnRates: AssetReturnRates): {
    returnAmounts: AssetReturnAmounts;
    cumulativeReturnAmounts: AssetReturnAmounts;
    byAccount: Record<string, AccountDataWithReturns>;
  } {
    let returnAmounts = zeroAssetAmounts<AssetReturnAmounts>();
    let cumulativeReturnAmounts = zeroAssetAmounts<AssetReturnAmounts>();

    const byAccount: Record<string, AccountDataWithReturns> = {};

    this.accounts.forEach((account) => {
      const { returnAmounts: returnAmountsFromThisAccount, cumulativeReturnAmounts: cumulativeReturnAmountsFromThisAccount } =
        account.applyReturns(returnRates);

      returnAmounts = addAssetAmounts(returnAmounts, returnAmountsFromThisAccount);
      cumulativeReturnAmounts = addAssetAmounts(cumulativeReturnAmounts, cumulativeReturnAmountsFromThisAccount);

      byAccount[account.getAccountID()] = {
        name: account.getAccountName(),
        id: account.getAccountID(),
        type: account.getAccountType(),
        taxCategory: account.taxCategory,
        returnAmounts: returnAmountsFromThisAccount,
        cumulativeReturnAmounts: cumulativeReturnAmountsFromThisAccount,
      };
    });

    return { returnAmounts, cumulativeReturnAmounts, byAccount };
  }

  /**
   * Applies yield rates to all accounts and aggregates by tax category
   * @param yieldRates - Monthly yield rates by asset class
   * @returns Total and per-account yield amounts grouped by tax category
   */
  applyYields(yieldRates: AssetYieldRates): {
    yieldAmounts: Record<TaxCategory, AssetYieldAmounts>;
    cumulativeYieldAmounts: Record<TaxCategory, AssetYieldAmounts>;
  } {
    const yieldAmounts: Record<TaxCategory, AssetYieldAmounts> = {
      taxable: zeroAssetAmounts<AssetYieldAmounts>(),
      taxDeferred: zeroAssetAmounts<AssetYieldAmounts>(),
      taxFree: zeroAssetAmounts<AssetYieldAmounts>(),
      cashSavings: zeroAssetAmounts<AssetYieldAmounts>(),
    };
    const cumulativeYieldAmounts: Record<TaxCategory, AssetYieldAmounts> = {
      taxable: zeroAssetAmounts<AssetYieldAmounts>(),
      taxDeferred: zeroAssetAmounts<AssetYieldAmounts>(),
      taxFree: zeroAssetAmounts<AssetYieldAmounts>(),
      cashSavings: zeroAssetAmounts<AssetYieldAmounts>(),
    };

    this.accounts.forEach((account) => {
      const { yieldAmounts: yieldAmountsFromThisAccount, cumulativeYieldAmounts: cumulativeYieldAmountsFromThisAccount } =
        account.applyYields(yieldRates);

      const taxCategory = account.taxCategory;

      yieldAmounts[taxCategory] = addAssetAmounts(yieldAmounts[taxCategory], yieldAmountsFromThisAccount);
      cumulativeYieldAmounts[taxCategory] = addAssetAmounts(cumulativeYieldAmounts[taxCategory], cumulativeYieldAmountsFromThisAccount);
    });

    return { yieldAmounts, cumulativeYieldAmounts };
  }
}
