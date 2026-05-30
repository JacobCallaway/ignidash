# Country-Support Branch — Change Summary

Summary of all changes in the `Country-Support` branch relative to `main`. Organised by layer. Keep updated as new changes land.

---

## 1. Country Config System (new)

### `src/lib/country/types.ts` — new file

Defines the `CountryConfig` interface and all supporting types. A `CountryConfig` is the single source of truth for every country-specific rule consumed by the simulation engine and UI:

- `AccountTypeConfig` — per-account-type: tax category (`cashSavings | taxable | taxFree | taxDeferred`), contribution limits (age-tiered), tapered allowance (e.g. UK SIPP), Section 415(c) limits, `taxFreeLumpSumPercent` (e.g. 25% for SIPP PCLS), employer match support, Mega Backdoor Roth support, early withdrawal penalty group reference, RMD flag.
- `IncomeTaxConfig` / `TaxBracket` — income tax brackets by filing status.
- `CapitalGainsTaxConfig` — CGT brackets and annual exemption.
- `PayrollTaxConfig` — employee rate, income band min/max, higher rate above cap (used for NI and FICA).
- `IncomeTypeConfig` — per-income-type flags: `hasWithholding`, `hasPayrollTax`, `isSocialSecurityLike`, `isTaxFree`, `supportsAutoWithholding`.
- `EarlyWithdrawalPenaltyGroup` — penalty rate, optional `earningsOnly` flag.
- `WithdrawalOrderItem` / `withdrawalOrder` — ordered lists of account type IDs for before and after `penaltyFreeAge`.
- `RmdConfig` — distribution table and `getStartAge(birthYear)` function.

### `src/lib/country/configs/us.ts` — new file

Full US config: 2026 IRS income tax brackets (single / MFJ / HoH), LTCG brackets, NIIT, Social Security provisional income thresholds, FICA payroll tax (7.65%), Section 121 primary residence exclusion, account types (401k, Roth 401k, 403b, Roth 403b, IRA, Roth IRA, HSA, brokerage), income types (wage, self-employment, Social Security, pension, exempt), early withdrawal penalty groups (10% for tax-deferred at <59½, 20% for HSA at <65), RMD table (73/75 based on birth year), withdrawal order (before and after 59½).

### `src/lib/country/configs/uk.ts` — new file

Full UK config: 2025/26 income tax brackets (personal allowance encoded as 0% bracket to £12,570, then 20%/40%/60% personal-allowance-withdrawal band/45%), CGT (£3,000 exemption, 20% simplified), National Insurance (8% on £12,570–£50,270, 2% above), account types (Savings, GIA, ISA with £20k annual limit, SIPP with £60k Annual Allowance and tapered allowance above £260k adjusted income), SIPP: 25% PCLS (`taxFreeLumpSumPercent: 0.25`), penalty-free age 57, 55% unauthorised payment charge, withdrawal order (savings→GIA→ISA before 57; savings→SIPP→GIA→ISA after 57), income types (employment, State Pension, exempt), no RMDs.

### `src/lib/country/index.ts` — new file

- `getCountryConfig(code)` — returns the `CountryConfig` for `'US'` or `'GB'`; throws on unknown code.
- `AVAILABLE_COUNTRIES` — `[{ code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' }]`.
- `getAccountTypeConfig(config, typeId)` — looks up a single `AccountTypeConfig` by ID.
- `computePayrollTax(income, config)` — applies payroll tax band logic (min income, standard rate, higher rate above cap).

---

## 2. Schema Layer

### `src/lib/schemas/inputs/account-form-schema.ts`

- Replaced the static US-only Zod union with `buildAccountFormSchema(config: CountryConfig)` — generates a discriminated union from `config.accountTypes` at runtime.
- `AccountInputs` is now a generic interface (`id`, `name`, `balance`, `type`, `percentBonds?`, `costBasis?`, `contributionBasis?`) consumed by the calc layer.
- Helper functions (`isRothAccount`, `isTraditionalAccount`, `isInvestmentAccount`, `accountTypeForDisplay`, `taxCategoryFromAccountType`) now accept an optional `CountryConfig` defaulting to US for backward compatibility.
- Static `accountFormSchema` export retained (defaults to US) for existing imports.

### `src/lib/schemas/inputs/contribution-form-schema.ts`

- Added `percentOfIncome` contribution type (models salary deferral / salary sacrifice).
- Added `debtId` field — a contribution rule can target a debt instead of an account.
- Added `employerMatchPercent` (percent-of-income employer match, distinct from fixed-dollar `employerMatch`).
- Added `incomeId` — links a contribution rule to a specific income source for income-based limits and percent-of-income calculations.
- `buildContributionHelpers(config: CountryConfig)` replaces hard-coded US limit logic — returns `getSharedLimitAccounts`, `getAnnualContributionLimit`, `getAnnualSection415cLimit`, `supportsMegaBackdoor`, all driven by `CountryConfig`.

### `src/lib/schemas/inputs/income-form-schema.ts`

- `incomeType` is now a plain `string` (was a US-specific enum); UI populates options from `countryConfig.incomeTypes`.
- Added `autoWithholding: boolean` to income tax settings — enables automatic withholding rate computation from tax brackets each year.

### `src/lib/schemas/inputs/debt-form-schema.ts`

- Added `paymentType: 'fixed' | 'minimumPayment'` — minimum payment pays only accrued interest (balance never grows), fixed payment amortises principal.

### `src/lib/schemas/inputs/timeline-form-schema.ts`

- Added `earliestPossible` retirement strategy — no parameters; the simulation determines the soonest feasible retirement date.

### `src/lib/schemas/inputs/tax-settings-form-schema.ts`

- `filingStatus` is now a plain `string` (was a US-specific enum); valid values come from `countryConfig.filingStatuses`.

### `src/lib/schemas/inputs/simulator-schema.ts`

- Added `country: string` field (default `'US'`).

### `src/lib/schemas/plan-metadata-schema.ts`

- Added `country` to plan metadata.

### `src/lib/schemas/finances/asset-form-schema.ts`

- Added `country` field to physical assets — allows assets from different countries (e.g. UK property in a US plan).

---

## 3. Simulation Engine — Calc Layer

### `src/lib/calc/taxes.ts`

- Tax engine now fully driven by `CountryConfig` instead of hard-coded US rules.
- Income tax brackets, CGT brackets, payroll tax, NIIT, SS taxation thresholds, standard deduction, and primary residence exclusion all read from `countryConfig`.
- `taxFreeLumpSumPercent` on `AccountTypeConfig` controls what fraction of taxDeferred withdrawals is tax-free (e.g. 25% for UK SIPP PCLS, 0% for US 401k).
- Early withdrawal penalty groups read from `countryConfig.earlyWithdrawalPenaltyGroups`.
- Employee contributions to `taxDeferred` accounts are deducted as an above-the-line adjustment from ordinary taxable income (`taxDeductibleContributions`).

### `src/lib/calc/incomes.ts`

- `Incomes` and `Income` now receive `CountryConfig`; income type behavior (`hasWithholding`, `hasPayrollTax`, `isTaxFree`, `isSocialSecurityLike`) read from `countryConfig.incomeTypes`.
- Added `updateAutoWithholdingRates(simulationState, filingStatus, countryConfig)` — called at the start of each simulation year; computes the effective annual income tax rate from expected total income and sets it as the withholding rate on all `autoWithholding` incomes, smoothing tax payments monthly rather than as a year-end lump sum.
- `Income.getExpectedAnnualAmount()` — non-mutating read for withholding rate calculation.

### `src/lib/calc/contribution-rules.ts`

- `ContributionRules` now receives `CountryConfig` and uses `buildContributionHelpers(config)` for limit enforcement.
- Added `DebtContributionRule` class — models extra payments toward a specific debt, with the same rank/amount-type interface as account rules (`dollarAmount`, `percentRemaining`, `unlimited`).
- Added `percentOfIncome` contribution type — computes target from a percentage of the linked income's monthly gross; applied before the surplus waterfall (salary sacrifice semantics).
- Added `employerMatchPercent` — percent-of-income employer match computed from gross monthly income, independent of employee contribution amount.
- `ContributionTracker` extended with `employerByType` and `employeeByIncome` maps for shared limit enforcement across income-linked rules.

### `src/lib/calc/portfolio.ts`

- `Portfolio` and `PortfolioProcessor` now receive `CountryConfig`.
- Withdrawal ordering respects `countryConfig.withdrawalOrder.beforePenaltyFreeAge` / `afterPenaltyFreeAge`, switching at `countryConfig.penaltyFreeAge`.
- RMD logic reads from `countryConfig.rmd`.
- Physical asset sale proceeds are injected into the savings account (most liquid, always accessible) rather than following general withdrawal order.
- `percentOfIncome` contribution rules (salary sacrifice) are processed before the surplus waterfall and before the rank-ordered rules.
- Debt contribution rules are now processed in rank order alongside account rules, paying extra amounts toward debts from surplus cash flow.

### `src/lib/calc/debts.ts`

- Added `paymentType: 'fixed' | 'minimumPayment'` — `minimumPayment` pays only accrued interest each month (prevents balance growth; useful for interest-only arrangements or income-contingent repayment modelling).
- `applyExtraPayment(amount)` — accepts extra payments from contribution rules (debt contribution rules in the waterfall).
- `getDebtById(id)` added to `Debts` collection.

### `src/lib/calc/phase.ts` — substantially rewritten

Complete rewrite of `PhaseIdentifier`. Changes:

**Constructor** now accepts 9 parameters (all beyond `timeline` are optional for backward compatibility):
`simulationState, timeline, marketAssumptions?, countryConfig?, physicalAssets?, expenseInputs?, incomeInputs?, glidePath?, minRetirementAge?`

**`earliestPossible` strategy** (new):

- Calls `simulateRetirementFeasibility()` each year; triggers retirement at the first age where the portfolio can sustain withdrawals to life expectancy.
- Respects `minRetirementAge` when set by the engine's retry loop.

**Generic `computeAnnualCashflow(ageThisYear, dateThisYear, soldAssetIds)`** (new):

- Evaluates all expense, income, and physical asset time frames at a mock `phase='retirement'` state for each simulation year, so all time-point types (`now`, `atRetirement`, `customAge`, `customDate`, `atLifeExpectancy`) fire naturally without special-casing.
- Returns `{ annualNetWithdrawal, annualSaleProceeds, annualOtherTaxableIncome }`.
- Falls back to historical totals from `simulationState.annualData` when raw inputs are not provided (backward compatibility).

**`simulateRetirementFeasibility(currentAge, realAnnualReturn)`** (redesigned):

- Runs year-by-year from `currentAge` to `lifeExpectancy` using `computeAnnualCashflow`.
- Respects `countryConfig.withdrawalOrder` (before/after `penaltyFreeAge`), correctly modelling locked accounts (e.g. SIPP inaccessible before 57).
- **Tax overhead**: after each year's withdrawal from `taxDeferred` accounts, `estimateWithdrawalTax()` computes estimated income tax (stacking SIPP withdrawals on top of other taxable income like State Pension) using the marginal bracket method; this is deducted from the portfolio. Prevents the feasibility check from being overly optimistic when most savings are in pension accounts.
- Returns `false` immediately if any year has a shortfall (expense or tax can't be covered).

**`getBlendedRealReturn()`** (updated):

- Now takes the more conservative of the current portfolio allocation's return and the glide path terminal allocation's return when a glide path is configured. Prevents overestimating returns for plans where the portfolio will shift to a bond-heavy allocation before life expectancy.

**`swrTarget` strategy** (updated):

- `computeAnnualCashflow` at year 0 provides `annualSaleProceeds` (e.g. house sold at retirement), added to effective portfolio value for the SWR ratio check.
- When a country config is present, additionally runs `simulateRetirementFeasibility` to catch cases where the SWR ratio is satisfied but locked accounts make early retirement infeasible.

### `src/lib/calc/physical-assets.ts`

- Added `getMonthlyLoanPayment()` — non-mutating read for use in the feasibility simulation.
- Added `isScheduledToSellAtRetirement()` — checks `saleDate.type === 'atRetirement'` on owned assets.
- Added `getAssetsScheduledToSellAtRetirement()` on `PhysicalAssets` collection.

### `src/lib/calc/simulation-engine.ts`

**`runSimulation`** (updated):

- For `earliestPossible` plans, wraps `runSimulationCore` with a retry loop: if bankruptcy is detected during retirement before life expectancy, increments `minRetirementAge` by 1 year and reruns until solvent or `minRetirementAge` reaches life expectancy. Corrects for cases where the feasibility check is overly optimistic.
- `PhaseIdentifier` now receives `glidePath` and `minRetirementAge` as additional constructor arguments.

**`runSimulationCore(returnsProvider, timeline, minRetirementAge?)`** (new private method):

- Extracted from the former `runSimulation` body; accepts an optional `minRetirementAge` passed to `PhaseIdentifier`.

**`detectBankruptcyDuringRetirement(result)`** / **`getRetirementAgeFromResult(result)`** (new private methods):

- Used by the retry loop to identify whether a rerun is needed and at what floor to set the minimum retirement age.

---

## 4. Convex Backend

### `convex/plans.ts`

- `createPlan` mutation: accepts optional `country` and `filingStatus` arguments.
- New `updateCountry` mutation: updates `country` and `taxSettings.filingStatus` for a plan atomically.

### `convex/templates/basic.ts`, `convex/templates/early_retirement.ts`

- Templates now include `country: 'US'` field.

### `convex/validators/accounts_validator.ts`

- Account `type` is now `v.string()` (was a hard-coded enum of US account types).

### `convex/validators/contribution_rules_validator.ts`

- `type` field added (`v.string()`).
- `accountId` is now `v.optional(v.string())` — rules can target a debt instead.
- `debtId: v.optional(v.string())` added.
- `amount` union extended with `v.object({ type: v.literal('percentOfIncome'), percentOfIncome: v.number() })`.
- `employerMatchPercent: v.optional(v.number())` added.

### `convex/validators/incomes_validator.ts`

- `incomeType` is now `v.string()`.
- `autoWithholding: v.optional(v.boolean())` added.

### `convex/validators/debt_validator.ts`

- `paymentType: v.optional(v.union(v.literal('fixed'), v.literal('minimumPayment')))` added.
- `monthlyPayment: v.optional(v.number())` added (was required before; now optional since minimumPayment debts compute their own payment).

### `convex/validators/plan_data_fields.ts`

- `country` field added.

### `convex/validators/tax_settings_validator.ts`

- `filingStatus` is now `v.string()`.

### `convex/validators/timeline_validator.ts`

- `earliestPossible` strategy added to the retirement strategy discriminated union.

### `convex/validators/asset_validator.ts`

- `country` field added to physical asset validators.

### `convex/utils/sys_prompt_utils.ts`

- AI system prompt now includes country-specific context from a local `countryData` map (covering account types, tax rules, and retirement strategies for US and UK).
- Context is selected based on `plan.country`.

---

## 5. Utilities

### `src/lib/utils/data-transformers.ts`

- Transformers (Convex doc → Zod types and vice versa) updated for all new fields: `country`, `autoWithholding`, `paymentType`, `debtId`, `employerMatchPercent`, `percentOfIncome` contribution type.
- Plan transformer propagates `country`.

### `src/lib/utils/display-formatters.ts`

- `incomeTaxTreatmentForDisplay` now accepts an optional `CountryConfig` and resolves income type labels from `countryConfig.incomeTypes`; falls back to a US label map for backward compatibility.

### `src/lib/utils/number-formatters.ts`

- Currency formatting (`formatCurrency`, `formatCompactCurrency`, `getCurrencySymbol`, `formatCurrencyPlaceholder`) now reads the active currency symbol from context rather than hard-coding `$`. UK plans display `£`.

### `src/hooks/use-country-config.ts` — new file

- `useCountryConfig()` hook: reads `country` from the active plan's Convex data and returns the corresponding `CountryConfig`. Used by UI components to drive country-aware form schemas and display labels.

---

## 6. UI

### Plan creation dialog (`plan-dialog.tsx`)

- Country selector added to the new-plan form (US/GB).
- On submit, calls `createPlan` with the selected `country` and the country's default `filingStatus`.

### Account dialog (`account-dialog.tsx`)

- Account type options populated from `countryConfig.accountTypes` (grouped by tax category) rather than a hard-coded US list.
- Country selector added to physical assets (allows non-plan-country assets in net worth).
- Form schema built dynamically via `buildAccountFormSchema(countryConfig)`.
- Contribution basis, cost basis, and percent bonds fields shown/hidden based on `AccountTypeConfig` flags.

### Contribution rule dialog (`contribution-rule-dialog.tsx`)

- Supports debt targets (rule can point to a debt ID instead of an account ID).
- `percentOfIncome` contribution type added (shows income selector and percent field).
- `employerMatchPercent` field added (percent-of-income employer match).
- Account/debt type selector shows only applicable options from the active country config.

### Income dialog (`income-dialog.tsx`)

- Income type options populated from `countryConfig.incomeTypes`.
- Auto-withholding toggle added (computes withholding rate automatically from tax brackets; available for income types that `supportsAutoWithholding`).
- Withholding rate field hidden when auto-withholding is enabled.

### Debt dialog (`debt-dialog.tsx`)

- Payment type selector (`Fixed payment` / `Minimum payment`).
- Monthly payment field hidden when `minimumPayment` is selected.

### Tax settings drawer (`tax-settings-drawer.tsx`)

- Filing status options populated from `countryConfig.filingStatuses`.
- Country change section (calls `updateCountry` mutation, resetting filing status to the new country's default).

### Timeline drawer (`timeline-drawer.tsx`)

- `Earliest possible` retirement strategy option added alongside `Fixed age` and `SWR target`.

### Net worth section (`net-worth-section.tsx`)

- Physical assets from multiple countries displayed with appropriate currency symbols.

### Numbers column header (`numbers-column-header.tsx`)

- Currency symbol driven by `getCurrencySymbol()` (country-aware).

### Contribution order section (`contribution-order-section.tsx`)

- Debt rules displayed alongside account rules in the contribution order UI.

### Results sections / section selector

- Minor adjustments for new phase/retirement strategy display.

---

## 7. Tests

All new capabilities are covered:

- **`phase.test.ts`** — 51 tests covering `fixedAge`, `swrTarget`, and `earliestPossible` strategies; country-aware withdrawal ordering; SIPP penalty-free age lock; `computeAnnualCashflow` with `atRetirement` asset sales, income, and expense time frames; tax estimation on taxDeferred withdrawals; glide path return conservatism; `minRetirementAge` enforcement.
- **`contribution-rules.test.ts`** — 380+ tests covering UK/US limit differences, `percentOfIncome` and `debtId` rule types, `employerMatchPercent`, income-linked limits.
- **`incomes.test.ts`** — auto-withholding rate calculation, UK income types (NI, State Pension, exempt).
- **`simulation-data-extractor.test.ts`** — extended for UK account types and new contribution/withdrawal paths.
- **`taxes.test.ts`** — UK income tax brackets, NI, SIPP 25% PCLS, CGT exemption, no-NIIT/no-SS cases.
- **`portfolio.test.ts`** — withdrawal ordering before/after penalty-free age.
- All other test files updated to pass `countryConfig` where the new signatures require it.

---

## Known Gaps / TODOs (recorded in code)

- Stamp duty on UK property purchases not modelled.
- SIPP contributions should not reduce NI (salary sacrifice not distinguished from relief-at-source).
- Bed-and-ISA strategy (GIA→ISA transfer) not modelled.
- State Pension modelling based on NI contribution history not implemented.
- UK Private Residence Relief (equivalent to Section 121) not modelled — house sales may incorrectly trigger CGT.
- Feasibility check tax estimation is an approximation (marginal bracket method on a single blended withdrawal amount, ignoring iterative convergence and CGT).
