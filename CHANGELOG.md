# Changelog

All changes relative to [schelskedevco/ignidash](https://github.com/schelskedevco/ignidash) `main`.

---

## Multi-Country Support

The largest change on this branch — a full country abstraction layer that makes the simulation engine, tax calculations, contribution limits, and UI configurable per country.

**Architecture**

- New `src/lib/country/` module: `CountryConfig` type (`types.ts`), country registry (`index.ts`), and per-country configs
- `CountryConfig` defines income types, account types (with tax treatment), account contribution limits, and tax brackets for a given country
- `useCountryConfig` hook (`src/hooks/use-country-config.ts`) provides the active country config to UI components
- Plan metadata now carries a `countryCode` field

**US Config** (`src/lib/country/configs/us.ts`)

- Codified 2026 IRS contribution limits: 401k / 403b / 457b base + catch-up (50+) + SECURE 2.0 super catch-up (60–63), IRA base + catch-up, HSA, mega-backdoor Roth (415c)
- Income types: Wage, Tax-Free, Self-Employment, Social Security, Pension — each with withholding and auto-withholding flags
- Account types: Traditional 401k/403b/457b, Roth 401k, Traditional IRA, Roth IRA, HSA, Taxable Brokerage, Savings/Cash — each with pre/post-tax treatment

**UK Config** (`src/lib/country/configs/uk.ts`)

- Income types: Employment, Self-Employment, Pension, Tax-Free
- Account types: SIPP, ISS, General Investment Account, Current/Savings Account — with appropriate tax treatment
- 2025/26 tax brackets: Basic (20%), Higher (40%), Additional (45%) with personal allowance taper

**Simulation engine & taxes**

- `taxes.ts` refactored to accept `CountryConfig`; tax bracket lookup, FICA, and capital gains logic now driven by config
- Contribution rules now enforce country-specific annual limits per account type
- `simulation-engine.ts` passes country config through to all sub-modules

**Convex validators & data transformers**

- `accounts_validator.ts`, `incomes_validator.ts`, `tax_settings_validator.ts`, `plan_data_fields.ts` updated for country-aware fields
- `data-transformers.ts` updated to round-trip country config fields through Convex

**UI**

- Income, account, contribution rule, and tax-settings dialogs now render options from the active `CountryConfig` rather than hardcoded US lists
- `sys_prompt_utils.ts` generates country-aware AI system prompts (US and UK branches)

**Documentation**

- `docs/country-support-branch.md` — architecture guide for the country abstraction
- `docs/simulation-engine.md` — simulation engine internals reference

---

## Spousal / Couples Support

- Added `spouse` as an owner option on income sources; incomes can now be assigned to `primary` or `spouse`
- Timeline drawer extended with spouse fields: birth month/year, life expectancy
- Simulation engine tracks per-owner income, FICA, and tax filing status
- Contribution rules track per-owner annual limits (spouse has independent 401k/IRA headroom)
- `taxes.ts` applies Married Filing Jointly brackets and Social Security combined provisional income when a spouse is present
- Data transformers, Convex validators, and Zod schemas updated throughout

---

## Income Improvements

- **Auto-withholding** — income types that support it (e.g., Wage) can set withholding automatically; toggled via `autoWithholding` flag on the income and matched by `CountryConfig.incomeTypes[].supportsAutoWithholding`
- **Pension employer match (%)** — contribution rules now support a `percentageOfIncome` employer match for pension-type accounts in addition to the existing fixed-dollar match
- **Fix** — Convex queries now correctly pick up non-US account tax types when loading plan data

---

## Contribution Rule Improvements

- Contribution limit groups (shared 401k elective deferral cap, IRA cap, 415c total annual additions cap) enforced via `CountryConfig` limits rather than hardcoded values
- Mega-backdoor Roth (Section 415c after-tax) contributions supported as a rule type
- `contribution-rules.ts` test suite significantly expanded (584 tests) covering shared limits, catch-up ages, 415c interactions, employer match, and edge cases

---

## Debt Improvements

- **Minimum payment field** — debts now carry a `minimumPayment` amount that is deducted from cash flow before discretionary contributions
- **Fix** — debt contribution calculation corrected to properly apply payments against principal

---

## Simulation Engine Improvements

- **Better retirement triggers** — retirement phase detection now uses a dedicated `phase.ts` module; earliest-retirement detection is more robust
- **Earliest retirement option** — users can set an earliest permissible retirement age; the engine will not trigger retirement before this age even if the portfolio target is met
- **Asset sales add to savings** — proceeds from physical asset sales (e.g., property) are now correctly routed into the savings/cash account rather than being discarded
- **Simulation data extractor** — refactored for clarity; per-year data points now include more granular income breakdown fields

---

## UI Improvements

- **Simulation settings moved to middle column** — settings previously in the results column header are now in the numbers column header for better layout balance
- **Better localization** — currency and number formatting consolidated; `formatCurrencyPlaceholder`, `formatCompactCurrency`, and `frequencyForDisplay` helpers refined; locale-aware month/year formatting in time-point labels

---

## Growth Limit Now Per-Frequency

Previously the growth limit on incomes and expenses was always compared against the **annual** total regardless of the selected payment frequency. This was unintuitive — a monthly $1,000 income with a "$12,000 limit" was correct but a "$1,500 limit" was not.

- The limit field now represents the **per-frequency** amount, matching the `amount` field
- The simulation engine multiplies the stored limit by `timesToApplyPerYear` before clamping `annualAmount`
- The UI labels the field as "Limit / mo", "Limit / yr", etc. based on the selected frequency
- The growth summary badge (e.g., "Rate: 3%, Limit: $5k / mo") also includes the frequency unit
- Zod cross-field refinements (`growthLimit > amount`) remain correct since both values are now in the same per-frequency unit
- Existing tests updated to use per-frequency limit values

---

## Expense Item Limit

- Maximum expenses per plan raised from **10 → 20**
