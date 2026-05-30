# Simulation Engine

## Overview

The simulation engine models a person's financial life from today to their life expectancy, one month at a time. Each month it processes income, expenses, debt payments, physical asset transactions, and investment returns. At the end of every 12th month it settles taxes, re-evaluates the retirement phase, and records a `SimulationDataPoint` for the charts and metrics.

Three simulation modes share the same monthly loop:

| Mode                | Class                                   | Returns source                                      |
| ------------------- | --------------------------------------- | --------------------------------------------------- |
| Fixed returns       | `FinancialSimulationEngine`             | Constant rates from market assumptions              |
| Monte Carlo         | `MonteCarloSimulationEngine`            | Log-normal random draws, one set per simulation run |
| Historical backtest | `LcgHistoricalBacktestSimulationEngine` | Actual market returns, LCG-sampled start year       |

Monte Carlo and historical backtest run the base loop N times (default 500 runs) and aggregate results through the merge worker.

---

## Initialization

Before the loop starts, `runSimulation()` builds all the stateful objects that will be mutated during simulation.

### Simulation context (immutable)

Derived from the user's timeline inputs and frozen for the entire run:

- **`startAge`** — precise age calculated from birth month/year to today
- **`endAge`** — life expectancy
- **`yearsToSimulate`** — `Math.ceil(endAge - startAge)`
- **`startDate` / `endDate`** — wall-clock dates
- **`retirementStrategy`** — the active strategy object (fixedAge / swrTarget / earliestPossible)
- **`rmdAge`** — country-specific RMD start age (US: derived from birth year; UK: `Infinity`)

### Simulation state (mutable)

Mutated every month:

- **`time`** — current date, fractional age, zero-based month counter, and zero-based year counter
- **`portfolio`** — live account balances (stocks, bonds, cash per account)
- **`phase`** — current retirement phase (`accumulation` or `retirement`)
- **`annualData`** — rolling arrays of annual expenses, debts, and physical asset data used by the phase identifier

### Initial data point (year 0)

Before the loop begins, a year-0 `SimulationDataPoint` is pushed to the results array. It contains starting account balances, starting debt balances, starting physical asset values, and zeroed flows. This is the snapshot that represents "right now" before any simulation time has elapsed.

### Phase seed

Immediately after constructing the `PhaseIdentifier`, `getCurrentPhase()` is called once to seed `simulationState.phase`. This prevents the first year from defaulting to `null`.

---

## The Monthly Loop

The loop runs while `simulationState.time.date < simulationContext.endDate`. Each iteration represents one calendar month.

```
while (date < endDate) {
  1. Increment time
  2. [Year start] Process RMDs
  3. [Year start] Update withholding rates
  4. Process returns (inflation + investment)
  5. Process incomes
  6. Process expenses
  7. Process physical assets
  8. Process debts
  9. Process portfolio: contributions or withdrawals + rebalance
  10. [If surplus] Record discretionary expense
  11. [Month 12] Annual settlement
}
```

### Step 1 — Increment time

`month` is incremented by 1. Date, age, and year are recomputed from `startDate + monthsElapsed`:

- `date` — first day of the new month
- `age` — `startAge + monthsElapsed / 12` (fractional, e.g. 35.25)
- `year` — `monthsElapsed / 12` (also fractional, used for income growth calculations)

### Step 2 — RMDs (first month of each year only, when age ≥ rmdAge)

`month % 12 === 1` triggers Required Minimum Distribution processing. For each account flagged `hasRmd = true`:

1. Look up the IRS Uniform Lifetime Table factor for `floor(age)` (clamped at 120)
2. Compute `rmdAmount = accountBalance / factor`
3. Withdraw that amount from the account (proportional to the target asset allocation)
4. Deposit the proceeds into a synthetic `RMD Savings` account created on the first RMD year

RMDs are processed before other transactions so they don't interact with the contribution/withdrawal logic.

### Step 3 — Auto withholding update (first month of each year only)

For income sources with `autoWithholding = true`, the engine recalculates the expected annual income for the coming year and looks up the corresponding marginal tax bracket. The withholding rate is set to that marginal rate so that monthly withholding tracks actual liability closely. This is done once per year because brackets only change at year boundaries.

### Step 4 — Returns processing

`ReturnsProcessor.process()` converts the **annual** return rates from the returns provider into **monthly** rates and applies them to every account in the portfolio.

The annual rates are fetched once per year (when `simulationState.time.year` changes) and cached for all 12 months. Fetching depends on the mode:

- **Fixed** — constant rates from `marketAssumptions` (stockReturn, bondReturn, cashReturn, inflationRate)
- **Stochastic** — new log-normal draw each year using the seeded RNG; bond and stock _yields_ are non-negative (log-normal); returns can be negative
- **Historical** — actual annual returns from the embedded CAPE dataset, cycled from the LCG-sampled start year; switches to a second dataset at the simulated retirement year

Monthly conversion: `monthlyRate = (1 + annualRate)^(1/12) - 1`

The portfolio applies these monthly rates account by account, computing separate return amounts for stocks, bonds, and cash. Yields (dividends, interest) are computed separately and tracked by tax category (taxable, tax-deferred, tax-free, cash savings) for use in annual tax calculation.

### Step 5 — Income processing

`IncomesProcessor.process()` filters to incomes whose timeframe is active in the current simulation state (checking `start` and `end` time points against current age, phase, and date), then calls `processMonthlyAmount()` on each.

For each active income:

1. **Growth** — the base amount is scaled by `(1 + annualGrowthRate)^year`
2. **Frequency adjustment** — yearly amounts are divided by 12; one-time amounts fire only in their start month
3. **Payroll tax (NI / FICA)** — computed from country config rates applied to gross income; split by employee/employer rate bands
4. **Withholding** — a fraction of gross income is set aside for estimated tax payments; the rate is either user-specified or the auto-calculated marginal rate from Step 3
5. **`incomeAfterPayrollDeductions`** — `grossIncome - payrollTax - withholding`; this is the number that flows into net cash flow

Social Security income is tracked separately for the Social Security benefit taxation calculation at year end.

### Step 6 — Expense processing

`ExpensesProcessor.process()` filters to active expenses and calls `processMonthlyAmount()` on each:

1. **Growth** — same `(1 + growthRate)^year` scaling as income
2. **Frequency** — yearly expenses are divided by 12
3. **Timeframe** — each expense has independent start/end time points (e.g. "from now until retirement", "from age 65 until life expectancy")

The result is `totalExpenses` for the month. No portfolio interaction yet — that happens in Step 9.

### Step 7 — Physical assets processing

`PhysicalAssetsProcessor.process(monthlyInflationRate)` handles owned real estate and other physical assets:

- **Appreciation** — market value grows by `monthlyInflationRate × appreciationMultiplier`
- **Loan payments** — mortgage/loan principal and interest are computed and split; unpaid interest accumulates if cash flow is insufficient
- **Purchases** — if the purchase date falls in this month, the asset is acquired, a loan is opened, and the down payment flows as a `purchaseOutlay`
- **Sales** — if the sale date falls, proceeds are calculated (market value minus loan balance minus selling costs), and any realized capital gain is tracked for tax

Purchase outlays and sale proceeds flow into net cash flow in Step 9.

### Step 8 — Debt processing

`DebtsProcessor.process(monthlyInflationRate)` computes the minimum monthly payment for each active debt:

- **Interest** — `balance × monthlyRate`
- **Minimum payment** — the larger of the required minimum and accrued interest (prevents negative amortization)
- **Payoff** — if the balance reaches zero, the debt is marked paid off and no longer appears in active debts

Debt payments flow into net cash flow in Step 9. Extra paydown from contribution rules is handled separately in the contribution waterfall.

### Step 9 — Portfolio: contributions or withdrawals

This is the central transaction step. `processContributionsAndWithdrawals()` computes **net cash flow** and then routes the surplus or deficit through the portfolio:

```
netCashFlow =
    incomeAfterPayrollDeductions
  + physicalAssetSaleProceeds
  - totalExpenses
  - debtPayments (minimum only)
  - loanPayments (physical assets)
  - physicalAssetPurchaseOutlay
```

#### If netCashFlow > 0 — Contribution waterfall

First, any outstanding shortfall from a previous month is repaid from the surplus. Then the remaining surplus flows through the **ranked contribution rules** in priority order.

**Shortfall repayment** occurs before any contributions:

```
shortfallRepaid = min(netCashFlow, outstandingShortfall)
remainingToContribute = netCashFlow - shortfallRepaid
```

Each rule is processed until `remainingToContribute` is exhausted:

1. **Account rules** (by rank):
   - Look up the target account
   - `calculateContribution()` computes how much to put in, respecting:
     - The rule type: dollar amount, % of remaining, or unlimited
     - Annual contribution limit for the account type (country-specific, age-tiered; e.g. SIPP £60k/yr; ISA £20k/yr)
     - Tapered allowance, if applicable (SIPP: limit reduced by 50p per £1 of income above £260k threshold, minimum £10k)
     - Max balance cap (e.g. Emergency Fund capped at £25k)
     - YTD contributions already recorded against this account type
   - **Employer match** — if the rule specifies a match percent, the employer match is added on top (does not reduce `remainingToContribute`; it's free money)
   - The contribution is split into stocks/bonds/cash using the **rebalancing allocation**: new money is directed toward the most underweight asset class relative to the target allocation
   - `remainingToContribute -= contributionAmount`

2. **Debt rules** (interleaved by rank):
   - Computes an extra payment beyond the minimum
   - Reduces the debt's principal directly
   - `remainingToContribute -= extraPayment`

3. **Base rule** — after all ranked rules are exhausted:
   - `spend` — any leftover is recorded as `discretionaryExpense` and added to expenses in Step 10
   - `save` — any leftover flows into a synthetic "Extra Savings" account (no contribution limit)

#### If netCashFlow < 0 — Withdrawal ordering

When expenses and debt payments exceed income, the portfolio must fund the deficit. Accounts are liquidated in the **country-configured withdrawal order**, which varies by age:

| Age  | UK withdrawal order        |
| ---- | -------------------------- |
| < 57 | Savings → GIA → ISA        |
| ≥ 57 | Savings → SIPP → GIA → ISA |

For each account type in order:

- All accounts of that type are drained in sequence
- The amount withdrawn is split across stocks/bonds/cash using the **rebalancing allocation**: the most overweight asset class is sold first
- **Realized gains** are tracked (withdrawal amount − cost basis for taxable accounts; total earnings withdrawn for tax-deferred accounts)
- If all accounts are exhausted and the deficit remains, the remainder is recorded as a **shortfall** and added to `outstandingShortfall`

#### Rebalance

After contributions or withdrawals, `processRebalance()` runs if a glide path is configured. It computes the current deviation from the target stock/bond split and executes offsetting trades within tax-advantaged accounts first (to minimize taxable events), then taxable accounts. Realized gains from rebalancing are tracked for tax.

### Step 10 — Discretionary expense (if applicable)

If the base rule is `spend` and there was a surplus after all contribution rules, `processDiscretionaryExpense()` adds that amount to the expenses processor's monthly data. This ensures it appears in the annual expenses total and feeds back into the phase identifier's mean-expense calculation.

---

## Year-End Settlement (month 12 of each year)

When `month % 12 === 0`, the simulation performs its annual reckoning.

### Collect annual data from processors

Each processor's `getAnnualData()` method sums its 12 monthly snapshots:

- **Portfolio** — sum of contributions, withdrawals, realized gains, employer match, shortfall, shortfall repaid across all 12 months; final month's balance, cumulative totals, and per-account flows
- **Incomes** — sum of gross income, withholding, payroll tax, net income per source
- **Returns** — sum of return amounts per asset class; final month's cumulative totals and annual return rates
- **Debts** — sum of payments, interest, principal paid per debt
- **Physical assets** — sum of appreciation, loan payments, purchase outlays, sale proceeds, realized gains per asset

Debts and physical asset annual data are pushed onto `simulationState.annualData` (used by the phase identifier in subsequent years).

### Tax settlement — iterative convergence

Tax settlement is a **feedback loop** because withdrawing money to pay taxes can itself generate taxable income, which increases the tax bill, requiring more withdrawals.

**First pass:**

1. `taxProcessor.process()` computes total taxes due from the year's income, realized gains, yields, Social Security income, and early withdrawal penalties (using current portfolio data)
2. `portfolioProcessor.processTaxes()` withdraws the tax amount from the portfolio (following the same withdrawal order as Step 9) or deposits a refund

**Convergence loop (up to 10 iterations):**

1. Re-run `taxProcessor.process()` with the updated portfolio data (which now reflects the tax withdrawal)
2. Compute `remainingTaxesDue = newTaxesDue − taxesPaidSoFar`
3. If `|remainingTaxesDue| < $1` → converged, stop
4. Otherwise withdraw the delta and repeat

This typically converges in 1–3 iterations. The $1 convergence threshold (`TAX_CONVERGENCE_THRESHOLD`) leaves a negligible residual in cash flow calculations.

**What the tax processor computes:**

- **Ordinary income tax** — applied to: gross employment/pension income, tax-deferred withdrawals (401k, IRA, SIPP earnings), Social Security benefits (up to 85% above thresholds), minus above-the-line adjustments (employee tax-deferred contributions) and the standard deduction. Country-specific bracket table.
- **Capital gains tax** — applied to realized gains from taxable account withdrawals and rebalancing; annual exemption applied first (UK: £3k; US: varies by bracket). Stacked above ordinary income for rate lookup.
- **NIIT (US only)** — 3.8% on net investment income above the filing-status threshold ($200k single / $250k married)
- **Social Security taxation (US only)** — provisional income determines what fraction of SS benefits (up to 85%) is added to ordinary income
- **Early withdrawal penalties** — triggered when withdrawing from a locked account before penalty-free age (e.g. SIPP before 57: 55% of the entire withdrawal; US 401k/IRA before 59.5: 10% of the withdrawal)
- **Payroll tax (NI/FICA)** — already deducted from income in Step 5; included in tax data for reporting but not re-computed here

**Tax refunds** — if withholding exceeded the tax liability, `portfolioProcessor.processTaxes()` applies the refund as a contribution. If the base rule is `spend`, the refund also generates a discretionary expense (Step 10).

### Phase re-evaluation

After taxes settle, `phaseIdentifier.getCurrentPhase()` re-evaluates the current retirement phase and updates `simulationState.phase`. This determines how the _next_ year runs — whether income is active, whether contributions or withdrawals occur.

**Phase strategies:**

- **Fixed age** — retires when `age >= retirementAge`. One-way: never reverts.
- **SWR target** — retires when `portfolioValue × safeWithdrawalRate > meanAnnualExpenses + meanAnnualDebtPayments`, AND accessible funds can bridge to pension unlock age (see below). Sticky once retired.
- **Earliest possible** — runs a forward simulation (see below) to check if retiring _right now_ would allow the portfolio to sustain expenses to life expectancy. Sticky once retired.

**Liquidity constraint (swrTarget and earliestPossible):**

For country configs with a pension lock age (e.g. UK SIPP locked until 57), triggering retirement when most assets are in a locked account would cause immediate shortfalls since withdrawals can only come from accessible accounts before that age. Both `swrTarget` and `earliestPossible` guard against this.

`swrTarget` uses a present-value check: accessible account balances must be ≥ PV of annual expenses for the years remaining until the unlock age.

`earliestPossible` uses a **year-by-year retirement simulation** (see below).

**Earliestpossible — retirement feasibility simulation:**

When `earliestPossible` is active, the phase identifier runs a simplified inner simulation each year to answer: "if I stopped working today, would my portfolio last to life expectancy?"

1. Snapshot current balances by account type from the live portfolio
2. For each year from `currentAge` to `lifeExpectancy`:
   a. Apply the country withdrawal order for _that year's age_ (automatically switches from pre-unlock to post-unlock order when `penaltyFreeAge` is crossed)
   b. Withdraw `meanAnnualExpenses + meanAnnualDebtPayments`
   c. If any withdrawal cannot be satisfied → **shortfall → not feasible → stay in accumulation**
   d. Grow all balances by the blended real annual return
3. If the loop completes without shortfall → **feasible → retire**

The blended real return is computed from the weighted asset allocation of the live portfolio and the market assumptions: `realReturn = (1 + blendedNominal) / (1 + inflationRate) − 1`.

### Record data point

The annual `SimulationDataPoint` is pushed to the results array with:

- Final portfolio value, cumulative totals, and per-account flows for the year
- Annual income, expense, debt, physical asset, tax, and returns summaries
- Current phase
- Wall-clock date and age at end of year

### Reset monthly data

All processors clear their monthly buffers so the next year starts clean. The portfolio processor also resets YTD contribution counters (so annual limits reset for the new calendar year). Outstanding shortfall is **not** reset — it carries forward until repaid.

---

## Data Extraction

The `SimulationResult` is a plain array of `SimulationDataPoint`s plus a context object. Three extractor classes transform this into UI-ready data:

| Extractor                 | Purpose                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `SimulationDataExtractor` | Returns data, tax breakdowns, milestone ages, cash flow, phase distribution          |
| `KeyMetricsExtractor`     | Success flag, retirement age, bankruptcy age, lifetime taxes, progress to retirement |
| `TableDataExtractor`      | Per-year table rows with portfolio value, income, expenses, taxes, phase             |
| `ChartDataExtractor`      | Time-series chart data: portfolio growth, income/expense waterfalls, phase bands     |

**Success** is defined as: retirement phase was reached AND the final portfolio value is > $0.10 AND no shortfall occurred in any year.

**Bankruptcy** is flagged when `portfolio.totalValue ≤ $0.10` in any year _after_ year 0. The year-0 check is skipped so plans that start with a $0 balance (e.g. all-accumulation UK plans) are not immediately marked bankrupt.

---

## Workers and Multi-Simulation

The main thread never runs the simulation directly. Two web worker pools handle all computation:

- **Simulation workers** (`simulation.worker.ts`) — each worker runs one full `runSimulation()` call. For Monte Carlo with 500 runs, work is distributed across the pool.
- **Merge worker** (`merge.worker.ts`) — receives all simulation results and aggregates them: computes percentile bands for charts, mean key metrics, success rate, bankruptcy statistics, and phase distribution per year.

Comlink is used for typed, promise-based worker communication. The worker API (`simulation-worker-api.ts`) manages the pool size and routes work.

---

## Returns Providers

All three providers implement `ReturnsProvider.getReturns(phase)` which returns annual rates for stocks, bonds, cash, inflation, and their yield counterparts.

### Fixed returns

Returns the rates directly from `marketAssumptions`. No randomness; the same rates apply every year regardless of phase.

### Stochastic (Monte Carlo)

Each year's stock and bond returns are independently sampled from a log-normal distribution parameterized from `marketAssumptions`. Bond and stock _yields_ (dividends, interest) are non-negative log-normal draws; _returns_ (price appreciation) can go negative. The RNG is a seeded LCG so results are deterministic and reproducible from the seed. Seeds are spaced by prime multiples across runs to avoid correlation.

### Historical backtest

Uses the embedded Shiller CAPE dataset (US equity and bond returns since 1871). An LCG picks a random start year; the simulation cycles through actual annual returns from that start year forward, wrapping around when it reaches the end of the dataset. At the simulated retirement year, the provider switches to a second dataset slice starting from a different LCG-seeded year, representing returns actually experienced in retirement separately from the accumulation period.
