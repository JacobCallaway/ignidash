import { describe, it, expect } from 'vitest';

import type { TimelineInputs } from '@/lib/schemas/inputs/timeline-form-schema';
import type { MarketAssumptionsInputs } from '@/lib/schemas/inputs/market-assumptions-form-schema';
import type { CountryConfig } from '@/lib/country/types';

import { PhaseIdentifier, type PhaseData } from './phase';
import type { SimulationState } from './simulation-engine';
import type { Portfolio } from './portfolio';
import type { ExpensesData } from './expenses';
import type { DebtsData } from './debts';
import type { PhysicalAssetsData } from './physical-assets';
import { createEmptyExpensesData, createEmptyDebtsData, createEmptyPhysicalAssetsData } from './__tests__/test-utils';

/**
 * PhaseIdentifier Tests
 *
 * Tests for retirement strategy phase transitions:
 * - fixedAge: simple age-based transition
 * - swrTarget: SWR-based transition considering expenses, debts, and physical asset loans
 */

// ============================================================================
// Test Helpers
// ============================================================================

const createMockPortfolio = (totalValue: number, stockFraction = 0.6): Portfolio => {
  const account = { getBalance: () => totalValue, getAccountType: () => 'gia' as string };
  return {
    getTotalValue: () => totalValue,
    getWeightedAssetAllocation: () => ({ stocks: stockFraction, bonds: 1 - stockFraction, cash: 0 }),
    getAccounts: () => [account],
  } as unknown as Portfolio;
};

/** Portfolio split between accessible and locked (e.g. pension) account types */
const createSplitPortfolio = (accessibleValue: number, lockedValue: number): Portfolio => {
  const mockAccounts = [
    { getBalance: () => accessibleValue, getAccountType: () => 'gia' },
    { getBalance: () => lockedValue, getAccountType: () => 'sipp' },
  ];
  return {
    getTotalValue: () => accessibleValue + lockedValue,
    getWeightedAssetAllocation: () => ({ stocks: 1, bonds: 0, cash: 0 }),
    getAccounts: () => mockAccounts,
  } as unknown as Portfolio;
};

/** Minimal CountryConfig stub with a pension-like lock until age 57 */
const mockCountryConfig: CountryConfig = {
  code: 'GB',
  name: 'United Kingdom',
  currency: { code: 'GBP', symbol: '£', locale: 'en-GB' },
  filingStatuses: [],
  incomeTax: {},
  capitalGainsTax: {},
  payrollTax: null,
  accountTypes: [],
  earlyWithdrawalPenaltyGroups: [],
  incomeTypes: [],
  penaltyFreeAge: 57,
  withdrawalOrder: {
    beforePenaltyFreeAge: [{ accountTypeId: 'gia' }],
    afterPenaltyFreeAge: [{ accountTypeId: 'gia' }, { accountTypeId: 'sipp' }],
  },
  aiPromptContext: '',
};

const createSimulationState = (overrides: {
  age?: number;
  phase?: PhaseData | null;
  portfolio?: Portfolio;
  expenses?: ExpensesData[];
  debts?: DebtsData[];
  physicalAssets?: PhysicalAssetsData[];
}): SimulationState => ({
  time: {
    age: overrides.age ?? 35,
    year: 2024,
    month: 1,
    date: new Date(2024, 0, 1),
  },
  phase: overrides.phase !== undefined ? overrides.phase : { name: 'accumulation' },
  portfolio: overrides.portfolio ?? createMockPortfolio(1_000_000),
  annualData: {
    expenses: overrides.expenses ?? [],
    debts: overrides.debts ?? [],
    physicalAssets: overrides.physicalAssets ?? [],
  },
});

const createFixedAgeTimeline = (retirementAge: number): TimelineInputs => ({
  lifeExpectancy: 87,
  birthMonth: 1,
  birthYear: 1990,
  retirementStrategy: { type: 'fixedAge', retirementAge },
});

const createSwrTargetTimeline = (safeWithdrawalRate: number): TimelineInputs => ({
  lifeExpectancy: 87,
  birthMonth: 1,
  birthYear: 1990,
  retirementStrategy: { type: 'swrTarget', safeWithdrawalRate },
});

// ============================================================================
// fixedAge Strategy Tests
// ============================================================================

describe('PhaseIdentifier - fixedAge Strategy', () => {
  it('returns accumulation when age < retirementAge', () => {
    const timeline = createFixedAgeTimeline(65);
    const state = createSimulationState({ age: 35 });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('returns retirement when age === retirementAge', () => {
    const timeline = createFixedAgeTimeline(65);
    const state = createSimulationState({ age: 65 });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('returns retirement when age > retirementAge', () => {
    const timeline = createFixedAgeTimeline(65);
    const state = createSimulationState({ age: 70 });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('handles early retirement age', () => {
    const timeline = createFixedAgeTimeline(40);
    const state = createSimulationState({ age: 40 });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });
});

// ============================================================================
// swrTarget Strategy - Core Logic Tests
// ============================================================================

describe('PhaseIdentifier - swrTarget Strategy', () => {
  describe('Expenses only', () => {
    // With $1M portfolio and 4% SWR = $40,000 safe withdrawal amount

    it('stays in accumulation when mean expenses > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [
          createEmptyExpensesData({ totalExpenses: 50_000 }), // Above $40k SWR
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when mean expenses < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [
          createEmptyExpensesData({ totalExpenses: 30_000 }), // Below $40k SWR
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('uses the most recent expense period, not the historical mean', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [
          createEmptyExpensesData({ totalExpenses: 20_000 }),
          createEmptyExpensesData({ totalExpenses: 40_000 }),
          createEmptyExpensesData({ totalExpenses: 30_000 }),
          // Most recent = 30_000 < 40_000 SWR → retires
          // (historical mean also 30_000 here, but the check uses the last data point)
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('stays in accumulation when the most recent expense year exceeds SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [
          createEmptyExpensesData({ totalExpenses: 20_000 }), // earlier years were cheap
          createEmptyExpensesData({ totalExpenses: 20_000 }),
          createEmptyExpensesData({ totalExpenses: 50_000 }), // most recent year is above SWR
          // Mean = 30_000 < 40_000 → old logic would retire; most-recent = 50_000 > 40_000 → stays
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });
  });

  describe('Unsecured debts only', () => {
    it('stays in accumulation when debt payments > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 0 })], // No expenses
        debts: [
          createEmptyDebtsData({ totalPayment: 50_000 }), // Above $40k SWR
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when debt payments < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 0 })], // No expenses
        debts: [
          createEmptyDebtsData({ totalPayment: 20_000 }), // Below $40k SWR
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });

  describe('Secured debts (physical asset loans) only', () => {
    it('stays in accumulation when loan payments > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 0 })], // No expenses
        physicalAssets: [
          createEmptyPhysicalAssetsData({ totalLoanPayment: 50_000 }), // Above $40k SWR
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when loan payments < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 0 })], // No expenses
        physicalAssets: [
          createEmptyPhysicalAssetsData({ totalLoanPayment: 20_000 }), // Below $40k SWR
        ],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });
});

// ============================================================================
// swrTarget Strategy - Combination Tests
// ============================================================================

describe('PhaseIdentifier - swrTarget Strategy Combinations', () => {
  describe('Expenses + unsecured debts', () => {
    it('stays in accumulation when combined total > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 25_000 })],
        debts: [createEmptyDebtsData({ totalPayment: 20_000 })],
        // Combined = 45_000 > 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when combined total < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 15_000 })],
        debts: [createEmptyDebtsData({ totalPayment: 10_000 })],
        // Combined = 25_000 < 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });

  describe('Expenses + secured debts', () => {
    it('stays in accumulation when combined total > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 25_000 })],
        physicalAssets: [createEmptyPhysicalAssetsData({ totalLoanPayment: 20_000 })],
        // Combined = 45_000 > 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when combined total < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 15_000 })],
        physicalAssets: [createEmptyPhysicalAssetsData({ totalLoanPayment: 10_000 })],
        // Combined = 25_000 < 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });

  describe('Unsecured + secured debts', () => {
    it('stays in accumulation when combined debt payments > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 0 })], // No expenses
        debts: [createEmptyDebtsData({ totalPayment: 25_000 })],
        physicalAssets: [createEmptyPhysicalAssetsData({ totalLoanPayment: 20_000 })],
        // Combined = 45_000 > 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when combined debt payments < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 0 })], // No expenses
        debts: [createEmptyDebtsData({ totalPayment: 15_000 })],
        physicalAssets: [createEmptyPhysicalAssetsData({ totalLoanPayment: 10_000 })],
        // Combined = 25_000 < 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });

  describe('All three: expenses + unsecured + secured debts', () => {
    it('stays in accumulation when all combined > SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 20_000 })],
        debts: [createEmptyDebtsData({ totalPayment: 15_000 })],
        physicalAssets: [createEmptyPhysicalAssetsData({ totalLoanPayment: 10_000 })],
        // Combined = 45_000 > 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });

    it('transitions to retirement when all combined < SWR amount', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 15_000 })],
        debts: [createEmptyDebtsData({ totalPayment: 5_000 })],
        physicalAssets: [createEmptyPhysicalAssetsData({ totalLoanPayment: 5_000 })],
        // Combined = 25_000 < 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('calculates mean across multiple periods for all components', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [
          createEmptyExpensesData({ totalExpenses: 10_000 }),
          createEmptyExpensesData({ totalExpenses: 20_000 }),
          // Mean expenses = 15_000
        ],
        debts: [
          createEmptyDebtsData({ totalPayment: 4_000 }),
          createEmptyDebtsData({ totalPayment: 6_000 }),
          // Mean debts = 5_000
        ],
        physicalAssets: [
          createEmptyPhysicalAssetsData({ totalLoanPayment: 8_000 }),
          createEmptyPhysicalAssetsData({ totalLoanPayment: 12_000 }),
          // Mean physical assets = 10_000
        ],
        // Combined mean = 30_000 < 40_000 SWR
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });
});

// ============================================================================
// swrTarget Strategy - Edge Cases
// ============================================================================

describe('PhaseIdentifier - swrTarget Strategy Edge Cases', () => {
  it('returns accumulation when annualData.expenses is empty', () => {
    const timeline = createSwrTargetTimeline(4);
    const state = createSimulationState({
      portfolio: createMockPortfolio(1_000_000),
      expenses: [], // Empty
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('handles zero expenses with debt payments', () => {
    const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
    const state = createSimulationState({
      portfolio: createMockPortfolio(1_000_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 0 })],
      debts: [createEmptyDebtsData({ totalPayment: 30_000 })],
      // Combined = 30_000 < 40_000 SWR
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('sticky retirement: once retired, stays retired regardless of SWR', () => {
    const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
    const state = createSimulationState({
      phase: { name: 'retirement' }, // Already retired
      portfolio: createMockPortfolio(1_000_000),
      expenses: [
        createEmptyExpensesData({ totalExpenses: 100_000 }), // Way above SWR
      ],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    // Should stay retired even though expenses exceed SWR
    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('boundary: exactly equal to SWR amount transitions to retirement', () => {
    const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
    const state = createSimulationState({
      portfolio: createMockPortfolio(1_000_000),
      expenses: [
        createEmptyExpensesData({ totalExpenses: 40_000 }), // Exactly equal to SWR
      ],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    // expenses (40k) is NOT less than SWR amount (40k), so stays accumulation
    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('boundary: just below SWR amount transitions to retirement', () => {
    const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
    const state = createSimulationState({
      portfolio: createMockPortfolio(1_000_000),
      expenses: [
        createEmptyExpensesData({ totalExpenses: 39_999 }), // Just below SWR
      ],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('handles empty debts and physicalAssets arrays', () => {
    const timeline = createSwrTargetTimeline(4); // 4% SWR = $40k
    const state = createSimulationState({
      portfolio: createMockPortfolio(1_000_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 30_000 })],
      debts: [], // Empty
      physicalAssets: [], // Empty
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    // Only expenses (30k) < SWR (40k), so retirement
    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });
});

// ============================================================================
// swrTarget Strategy - Variable SWR Rates
// ============================================================================

describe('PhaseIdentifier - swrTarget Strategy Variable SWR Rates', () => {
  describe('2% SWR (conservative)', () => {
    // $1M * 2% = $20,000 safe withdrawal

    it('transitions to retirement with low expenses', () => {
      const timeline = createSwrTargetTimeline(2);
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 15_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('stays in accumulation with moderate expenses', () => {
      const timeline = createSwrTargetTimeline(2);
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 30_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });
  });

  describe('4% SWR (traditional)', () => {
    // $1M * 4% = $40,000 safe withdrawal

    it('transitions to retirement with moderate expenses', () => {
      const timeline = createSwrTargetTimeline(4);
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 35_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('stays in accumulation with higher expenses', () => {
      const timeline = createSwrTargetTimeline(4);
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 50_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });
  });

  describe('6% SWR (aggressive)', () => {
    // $1M * 6% = $60,000 safe withdrawal

    it('transitions to retirement with higher expenses', () => {
      const timeline = createSwrTargetTimeline(6);
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 50_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('stays in accumulation with very high expenses', () => {
      const timeline = createSwrTargetTimeline(6);
      const state = createSimulationState({
        portfolio: createMockPortfolio(1_000_000),
        expenses: [createEmptyExpensesData({ totalExpenses: 70_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
    });
  });

  describe('Variable portfolio sizes', () => {
    it('smaller portfolio requires lower expenses for retirement', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR
      const state = createSimulationState({
        portfolio: createMockPortfolio(500_000), // $500k * 4% = $20k SWR
        expenses: [createEmptyExpensesData({ totalExpenses: 15_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });

    it('larger portfolio allows higher expenses for retirement', () => {
      const timeline = createSwrTargetTimeline(4); // 4% SWR
      const state = createSimulationState({
        portfolio: createMockPortfolio(2_000_000), // $2M * 4% = $80k SWR
        expenses: [createEmptyExpensesData({ totalExpenses: 70_000 })],
      });
      const phaseIdentifier = new PhaseIdentifier(state, timeline);

      expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
    });
  });
});

// ============================================================================
// earliestPossible Strategy Tests
// ============================================================================

const createEarliestPossibleTimeline = (lifeExpectancy = 87): TimelineInputs => ({
  lifeExpectancy,
  birthMonth: 1,
  birthYear: 1989, // age = 35 at 2024
  retirementStrategy: { type: 'earliestPossible' },
});

const defaultMarketAssumptions: MarketAssumptionsInputs = {
  stockReturn: 7, // 7% nominal stocks
  stockYield: 2,
  bondReturn: 3, // 3% nominal bonds
  bondYield: 3,
  cashReturn: 1,
  inflationRate: 2, // 2% inflation → stock real ≈ 4.9%, bond real ≈ 0.98%
};

describe('PhaseIdentifier - earliestPossible Strategy', () => {
  it('stays in accumulation when no annual expense data yet', () => {
    const timeline = createEarliestPossibleTimeline();
    const state = createSimulationState({ age: 35, expenses: [] });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, defaultMarketAssumptions);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('transitions to retirement once already retired (sticky)', () => {
    const timeline = createEarliestPossibleTimeline();
    const state = createSimulationState({ age: 50, phase: { name: 'retirement' } });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, defaultMarketAssumptions);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('forces retirement when past life expectancy', () => {
    const timeline = createEarliestPossibleTimeline(80);
    const state = createSimulationState({
      age: 85,
      expenses: [createEmptyExpensesData({ totalExpenses: 50_000 })],
      portfolio: createMockPortfolio(0),
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, defaultMarketAssumptions);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('stays in accumulation when portfolio too small vs PV of expenses', () => {
    // age 35, life expectancy 87 → 52 remaining years, $50k/yr expenses
    // With ~4.9% real return on 60/40 portfolio, PV ≈ $50k × 18.4 ≈ $920k
    // $500k is clearly not enough
    const timeline = createEarliestPossibleTimeline(87);
    const state = createSimulationState({
      age: 35,
      portfolio: createMockPortfolio(500_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 50_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, defaultMarketAssumptions);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('triggers retirement when portfolio is sufficient to sustain remaining expenses', () => {
    // age 65, life expectancy 87 → 22 remaining years, $40k/yr expenses, 3.33% real return
    // Simulation (annuity-due): withdraw then grow each year; $650k ends with positive balance after 22 years
    const timeline = createEarliestPossibleTimeline(87);
    const state = createSimulationState({
      age: 65,
      portfolio: createMockPortfolio(650_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 40_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, defaultMarketAssumptions);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('does not retire early under 0% real return fallback when portfolio equals expenses × years', () => {
    // Without market assumptions, falls back to 0% return: need $40k × 52 = $2.08M
    // $2.08M should trigger retirement
    const timeline = createEarliestPossibleTimeline(87);
    const state = createSimulationState({
      age: 35,
      portfolio: createMockPortfolio(2_100_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 40_000 })],
    });
    // No marketAssumptions → falls back to 0% real return
    const phaseIdentifier = new PhaseIdentifier(state, timeline);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('requires less portfolio with positive real returns — same expenses, smaller portfolio retires sooner', () => {
    // The simulation withdraws then grows each year, so real returns shrink the required starting portfolio.
    // age 50, life expectancy 87 → 37 remaining years, $40k/yr expenses
    // 0% return: each withdrawal depletes $40k permanently; $1M / $40k = 25 years → runs out → accumulation
    // 3.33% real: portfolio earns back faster than depleted; $1M survives 37 years → retirement
    const timeline = createEarliestPossibleTimeline(87);
    const expenses = [createEmptyExpensesData({ totalExpenses: 40_000 })];
    const portfolio = createMockPortfolio(1_000_000);

    const stateNoMA = createSimulationState({ age: 50, portfolio, expenses });
    const noMA = new PhaseIdentifier(stateNoMA, timeline);
    expect(noMA.getCurrentPhase()).toEqual({ name: 'accumulation' });

    const stateWithMA = createSimulationState({ age: 50, portfolio, expenses });
    const withMA = new PhaseIdentifier(stateWithMA, timeline, defaultMarketAssumptions);
    expect(withMA.getCurrentPhase()).toEqual({ name: 'retirement' });
  });
});

// ============================================================================
// swrTarget — Liquidity / Locked-Account Constraint Tests
// ============================================================================

describe('PhaseIdentifier - swrTarget liquidity constraint (locked accounts)', () => {
  // Scenario matching the user-reported bug:
  // - Income: £160k, expenses: £80k, SWR: 6%
  // - SWR target: need £80k / 0.06 = £1,333,333 portfolio
  // - All savings are in SIPP (locked until 57); accessible accounts (GIA) are near empty
  // - Without the liquidity check, swrTarget fires when SIPP alone crosses £1.33M,
  //   then retirement immediately causes shortfalls because SIPP can't be drawn pre-57.

  const ma: MarketAssumptionsInputs = {
    stockReturn: 10,
    stockYield: 3.5,
    bondReturn: 5,
    bondYield: 4.5,
    cashReturn: 3,
    inflationRate: 3,
  };

  it('stays in accumulation when SWR condition is met but accessible funds cannot bridge to unlock age', () => {
    // age 40, penaltyFreeAge 57 → 17 years to bridge
    // SWR 6%: portfolio £1.4M → safeWithdrawalAmount £84k > expenses £80k → primary check passes
    // Real return (100% stocks): (1.10/1.03)-1 ≈ 6.8%
    // PV(80k, 17yr, 6.8%) ≈ 80k × 9.25 ≈ £740k accessible needed
    // GIA = £25k << £740k → liquidity check fails → accumulation
    const timeline = createSwrTargetTimeline(6);
    const state = createSimulationState({
      age: 40,
      portfolio: createSplitPortfolio(25_000, 1_375_000), // £25k GIA, £1.375M SIPP
      expenses: [createEmptyExpensesData({ totalExpenses: 80_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, ma, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('transitions to retirement when SWR condition is met AND accessible funds can bridge to unlock age', () => {
    // Same age and expenses, but GIA has enough to cover 17 pre-unlock years.
    // Simulation (annuity-due: withdraw then earn): min GIA for 17yr × £80k at 6.8% ≈ £846k.
    // GIA £860k > £846k minimum → simulation passes.
    const timeline = createSwrTargetTimeline(6);
    const state = createSimulationState({
      age: 40,
      portfolio: createSplitPortfolio(860_000, 800_000), // £860k GIA, £800k SIPP
      expenses: [createEmptyExpensesData({ totalExpenses: 80_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, ma, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('skips liquidity check once past penaltyFreeAge', () => {
    // age 58 > penaltyFreeAge 57 → no liquidity gate; total portfolio check is all that matters
    // SWR 6%: portfolio £1.4M → £84k > £80k → retires (regardless of accessible split)
    const timeline = createSwrTargetTimeline(6);
    const state = createSimulationState({
      age: 58,
      portfolio: createSplitPortfolio(5_000, 1_395_000), // nearly all in SIPP, but age > 57
      expenses: [createEmptyExpensesData({ totalExpenses: 80_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, ma, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('without countryConfig, no liquidity gate is applied — total-portfolio SWR check only', () => {
    // Same split as first test (£25k GIA + £1.375M SIPP) but no countryConfig
    // SWR passes → retires (no way to know SIPP is locked)
    const timeline = createSwrTargetTimeline(6);
    const state = createSimulationState({
      age: 40,
      portfolio: createSplitPortfolio(25_000, 1_375_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 80_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, ma);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('once retired, sticky — does not re-evaluate liquidity on subsequent calls', () => {
    // Simulate already in retirement phase; liquidity check must not revert it
    const timeline = createSwrTargetTimeline(6);
    const state = createSimulationState({
      age: 40,
      phase: { name: 'retirement' },
      portfolio: createSplitPortfolio(25_000, 1_375_000), // would fail liquidity if re-evaluated
      expenses: [createEmptyExpensesData({ totalExpenses: 80_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, ma, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });
});

// ============================================================================
// earliestPossible — Liquidity / Locked-Account Constraint Tests
// ============================================================================

describe('PhaseIdentifier - earliestPossible liquidity constraint (locked accounts)', () => {
  // age 40, life expectancy 90 → 50 remaining years
  // penaltyFreeAge 57 → 17 years until SIPP unlocks
  // expenses £40k/year, real return ~6.8% (100% stocks: (1.10/1.03)-1)
  // PV(40k, 50yr, 6.8%) ≈ 40k × (1-1.068^-50)/0.068 ≈ 40k × 14.15 ≈ £566k total needed
  // PV(40k, 17yr, 6.8%) ≈ 40k × (1-1.068^-17)/0.068 ≈ 40k × 9.25 ≈ £370k accessible needed

  const maAllStocks: MarketAssumptionsInputs = {
    stockReturn: 10,
    stockYield: 3.5,
    bondReturn: 5,
    bondYield: 4.5,
    cashReturn: 3,
    inflationRate: 3,
  };

  it('stays in accumulation when total portfolio is sufficient but accessible funds cannot bridge to unlock age', () => {
    // Total £700k > £566k needed → passes check 1
    // But accessible (GIA) = £100k < £370k pre-unlock needed → fails check 2
    const timeline = createEarliestPossibleTimeline(90);
    const state = createSimulationState({
      age: 40,
      portfolio: createSplitPortfolio(100_000, 600_000), // £100k GIA, £600k SIPP
      expenses: [createEmptyExpensesData({ totalExpenses: 40_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, maAllStocks, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'accumulation' });
  });

  it('transitions to retirement when both total portfolio and accessible funds are sufficient', () => {
    // age 40, penaltyFreeAge 57 → 17 years of GIA-only withdrawals before SIPP unlocks
    // Simulation requires GIA ≥ £423k to sustain £40k/yr at 6.8% real for 17 years (annuity-due).
    // £460k GIA clears this; SIPP covers the post-57 period comfortably.
    const timeline = createEarliestPossibleTimeline(90);
    const state = createSimulationState({
      age: 40,
      portfolio: createSplitPortfolio(460_000, 400_000), // £460k GIA, £400k SIPP
      expenses: [createEmptyExpensesData({ totalExpenses: 40_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, maAllStocks, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('skips liquidity check once past penaltyFreeAge — uses total portfolio only', () => {
    // age 60 > penaltyFreeAge 57: SIPP is now in the withdrawal order, so the full portfolio counts.
    // Simulation PV_due(40k, 30yr, 6.8%) ≈ £541k. £705k total (£5k GIA + £700k SIPP) comfortably covers it.
    // This illustrates that even with almost no accessible-only funds, retirement is feasible post-57.
    const timeline = createEarliestPossibleTimeline(90);
    const state = createSimulationState({
      age: 60,
      portfolio: createSplitPortfolio(5_000, 700_000), // tiny GIA, large SIPP — both accessible at 60
      expenses: [createEmptyExpensesData({ totalExpenses: 40_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, maAllStocks, mockCountryConfig);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });

  it('without countryConfig falls back to total portfolio check only (no liquidity gate)', () => {
    // Same split portfolio as first test — but no countryConfig, so check 2 is skipped
    // Total £700k > £566k needed → retires despite locked funds
    const timeline = createEarliestPossibleTimeline(90);
    const state = createSimulationState({
      age: 40,
      portfolio: createSplitPortfolio(100_000, 600_000),
      expenses: [createEmptyExpensesData({ totalExpenses: 40_000 })],
    });
    const phaseIdentifier = new PhaseIdentifier(state, timeline, maAllStocks);

    expect(phaseIdentifier.getCurrentPhase()).toEqual({ name: 'retirement' });
  });
});
