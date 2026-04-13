---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 04
subsystem: taxation/orchestration
tags: [typescript, fiscalEngine, simulationRunner, taxation, sfc, vitest]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: TaxPolicy shared type, EconomyConfig.taxPolicy optional field, sfcTaxation.test.ts scaffold
  - phase: 11
    plan: 03
    provides: escrow-aware fiscal loop (treasury now net-gain subject to new tax inflows without leaking through spending)
provides:
  - computeWithholding(income, kind, policy) helper with 4-kind dispatch (wage / amm_sell / vat / capital_gains)
  - Flat + piecewise-progressive tax rate calculation with per-rate clamp [0, 0.5]
  - Inline tax withholding at 5 hook sites in simulationRunner.ts — WORK income, enterprise wage solvent, enterprise wage bankruptcy partial-pay, order-book trade (VAT on buyer + amm_sell on seller, both P2P and SYSTEM_NPC-funded paths), capital-market positive-delta loop (SELL_SHARES + matured bond + dividend + coupon uniformly via capital_gains)
  - Phase 11 fiscalEngine.computeIncomeTax extended with optional TaxPolicy — legacy taxRate path preserved, Phase-11 callers get flat/progressive dispatch
  - Physics-trace [TAX] line at every withholding site for per-action SFC traceability
  - 13 new sfcTaxation assertions replacing 8 it.todo scaffolds + 3 new sfcCapitalMarkets assertions
affects: [11-05, 11-06, 11-07, 11-08, 11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Orchestration-helper pattern for tax dispatch: pure function in orchestration/helpers/taxWithholding.ts — no runner, no DB, no session state — so it can be reused unit-tested without mounting the full simulation loop"
    - "Kind-based dispatch keeps the helper type-exhaustive (TaxKind = 'wage' | 'amm_sell' | 'vat' | 'capital_gains'); VAT and capital_gains always flat even under progressive policy — only income-style events walk the bracket ladder"
    - "Grep-verifiable [TAX] trace prefix at every withholding site enables forensic audit from the physics trace log (parallels Plan 11-03 [FISCAL] convention)"
    - "Runner hook-site split: Task 2a wage family (WORK + enterprise wage solvent + bankruptcy partial-pay) and Task 2b AMM/capital family (order-book trade VAT + amm_sell + unified positive-delta cmkt loop for capital_gains) — matches the per-task cognitive-load split prescribed by WARNING 5"

key-files:
  created:
    - server/src/orchestration/helpers/taxWithholding.ts
  modified:
    - server/src/mechanics/fiscalEngine.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/__tests__/sfcTaxation.test.ts
    - server/src/__tests__/sfcCapitalMarkets.test.ts

key-decisions:
  - "Helper lives in orchestration/helpers/ (not mechanics/) because the dispatch reads TaxPolicy from orchestration-owned economyConfig and is invoked inline at runner tick sites — same layer as sfcAudit + structuralPressures"
  - "computeIncomeTax extended via optional `taxPolicy` field on TaxInput rather than a true TypeScript overload — avoids ambiguous overload resolution against the existing TaxInput object param and preserves every Phase-10 caller unchanged. When taxPolicy is present, delegates per-agent to computeWithholding('wage', policy); absent, uses taxRate flat path"
  - "VAT is buyer-side only: buyer pays (base + vat), seller receives full base. Seller still owes amm_sell tax separately on the base proceeds, so a single P2P trade now collects BOTH taxes — mirrors real retail sales-tax + income-tax layering"
  - "SYSTEM_NPC-funded trades (liquidity backstop for raw_materials) are VAT-exempt but the seller still owes amm_sell on the fundedCost — SYSTEM_NPC is not a citizen consumer so no sales tax is appropriate, but the fiat outflow is still taxable income for the citizen seller"
  - "WORK withholding uses `grossPaid` (the actually-transferred amount) not `originalWealthDelta` (the nominal wage). When treasury is empty, grossPaid=0 and no tax is withheld — prevents the runner from over-withholding against a wage that never materialized"
  - "Capital-gains tax applies uniformly to every positive cmktDelta.wealthDeltas entry (SELL_SHARES, matured bond, dividend, coupon income) — BLOCKER-3 unified loop replaces the ambiguous option-a shareSaleProceeds block that was never spec'd. Grep verifies 0 occurrences of shareSaleProceeds"
  - "Hook-site integration tests model the runner's arithmetic with computeWithholding + a mutable fake treasury/wealth rather than mounting runSimulation — keeps tests deterministic and fast while proving the SFC invariant at each site"

patterns-established:
  - "Per-rate clamp [0, 0.5] applied inside the helper rather than at policy ingestion — keeps the contract for TaxPolicy permissive (callers can store whatever) but guarantees the runtime effect stays sane"
  - "Helper signature accepts `policy: TaxPolicy | undefined` explicitly so every call site can pass `iterEconomyConfig.taxPolicy` directly (which is an optional field) without local `?? FLAT_DEFAULT` boilerplate"
  - "Runner tax hooks all follow the same 3-line shape: compute tax → mutate wealthDelta → credit treasury + emit [TAX] trace (inside a single `if (tax > 0)` guard so zero-rate sessions emit zero tax lines)"

decisions-addressed: [D-12, D-14]

# Metrics
duration: 6min
completed: 2026-04-13
---

# Phase 11 Plan 04: Tax Withholding Wiring Summary

**Wired tax withholding at 5 tax-bearing event sites (WORK wage, enterprise wage solvent + bankruptcy partial, order-book trade VAT on buyer, order-book trade amm_sell on seller, unified capital-gains on positive cmkt deltas) via a new computeWithholding helper with flat + piecewise-progressive dispatch — closing Phase 10's loose end where `computeIncomeTax` existed but was never called by the runner.**

## Performance

- **Duration:** 6 min (first commit 16:09:33Z → last commit 16:13:47Z)
- **Started:** 2026-04-13T20:07:50Z
- **Completed:** 2026-04-13T20:14:06Z
- **Tasks:** 3 (Task 1, Task 2a, Task 2b)
- **Files modified:** 5 (1 new helper + 2 production edits + 2 test edits)

## Accomplishments

- **New helper `server/src/orchestration/helpers/taxWithholding.ts`** with `computeWithholding(income, kind, policy)`. Four `TaxKind` values dispatch to the correct rate: `'wage'` and `'amm_sell'` use `policy.rates.income` (piecewise-progressive when `policy.kind === 'progressive'`); `'vat'` uses `policy.rates.vat`; `'capital_gains'` uses `policy.rates.capitalGains`. Undefined policy (legacy session) returns 0. Per-rate clamp `[0, 0.5]` prevents confiscatory rates. Progressive-mode walks the `brackets` array piecewise with the top income rate applied to any portion above the final bracket cap.
- **`computeIncomeTax` extended** — the existing Phase-10 `TaxInput`-object signature kept intact. Added optional `taxPolicy` field; when present, per-agent computation delegates to `computeWithholding('wage', policy)`. Legacy callers passing only `taxRate` are unchanged. Closes the D-32 gap where Phase 10's income-tax function was wired but never reached Phase-11 progressive brackets.
- **5 tax hook sites wired in `simulationRunner.ts`:**
  - WORK income (~1278): after treasury-funded wage debit, withhold tax from `grossPaid` (the actually-transferred amount, not the nominal `originalWealthDelta`). Prevents over-withholding when treasury caps the wage.
  - Enterprise wage solvent (~1453): between owner debit and employee credit. Owner debits gross; employee nets (gross − tax); treasury credits tax.
  - Enterprise wage bankruptcy partial-pay (~1497): tax withheld on `partialPay` (the actually-paid amount after pro-rata liquidation).
  - Order-book trade — buyer leg (~1420): VAT added on top — buyer pays (base + vat); seller still receives full base.
  - Order-book trade — seller leg (~1437 + SYSTEM_NPC branch ~1427): income-rate tax withheld from proceeds at sell-time.
  - CMKT positive-delta loop (~2319): capital-gains tax applied to every positive `cmktDelta.wealthDeltas` entry (SELL_SHARES, matured bond, dividend, coupon income uniformly). Negative deltas (share purchases, corp-bond issuance cost) flow through untaxed.
- **`[TAX]` physics-trace line emitted at every withholding site** so the Central Agent's post-hoc narrative sees exactly how much was withheld per-action. Parallels the [FISCAL] convention established by Plan 11-03.
- **Grep-verifiable wiring:** `computeWithholding` × 8, `'wage'` × 3, `'amm_sell'` × 3, `'vat'` × 1, `'capital_gains'` × 1, `[TAX]` × 7 trace lines, `shareSaleProceeds` × 0 (BLOCKER-3 verified clean).
- **Tests:** 15 computeWithholding unit tests (flat/progressive dispatch, 4 kinds, edge cases) + 6 wage-family hook-site integration tests + 7 AMM/capital hook-site integration tests in sfcTaxation.test.ts; 3 new sfcCapitalMarkets assertions for the runner's capital-gains application loop. Total 28 assertions in sfcTaxation (up from 8 it.todo) + 9 in sfcCapitalMarkets (up from 6).

## Task Commits

Each task committed atomically:

1. **Task 1: feat(11-04): add computeWithholding helper with flat/progressive dispatch** — `b4f6fd6`
2. **Task 2a: feat(11-04): wire withholding at wage settlement hooks (WORK + enterprise wage)** — `11255a8`
3. **Task 2b: feat(11-04): wire withholding at AMM/capital hooks (AMM sell + VAT + capital gains)** — `3362055`

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update).

## Files Created/Modified

### Production

- `server/src/orchestration/helpers/taxWithholding.ts` (NEW) — `computeWithholding(income, kind, policy)` helper with `TaxKind = 'wage' | 'amm_sell' | 'vat' | 'capital_gains'` dispatch, piecewise-progressive bracket walking for income kinds, per-rate clamp `[0, 0.5]`, undefined-policy safety return 0.
- `server/src/mechanics/fiscalEngine.ts` — Imports `computeWithholding`; `TaxInput` gains optional `taxPolicy: TaxPolicy`; `computeIncomeTax` delegates to helper when policy provided, falls back to `taxRate` flat path otherwise. Trace label updated to distinguish `flat/progressive taxPolicy` from `N.N% rate`.
- `server/src/orchestration/simulationRunner.ts` — Imports `computeWithholding` from helpers. Wires 5 hook sites: WORK income, enterprise wage solvent, enterprise wage bankruptcy partial-pay, order-book trade buy-side VAT + seller income tax (both P2P and SYSTEM_NPC-funded paths), unified capital-gains in the positive-cmkt-delta loop. `[TAX]` trace line emitted at each site (× 7 total occurrences, one per withholding call site). `shareSaleProceeds` block stays absent (BLOCKER-3 ✓).

### Tests

- `server/src/__tests__/sfcTaxation.test.ts` — 28 assertions: 15 unit (flat/progressive dispatch, 4 kinds, edge cases including undefined policy, rate clamp [0, 0.5], negative-rate clamp to 0, zero-income, progressive over-bracket, no-brackets fallback); 6 wage-family hook-site integration tests modeling the exact runner arithmetic (WORK solvent, WORK empty-treasury, enterprise solvent, enterprise bankruptcy partial-pay, legacy no-policy, progressive wage); 7 AMM/capital-family hook-site tests (AMM sell, VAT-only buy, full VAT + sell-tax chain, SELL_SHARES, matured bond, negative-delta-untaxed, legacy no-policy). SFC invariant (wealthDelta sum + treasury delta = fiat source) asserted at each site.
- `server/src/__tests__/sfcCapitalMarkets.test.ts` — 3 new assertions modeling the runner's unified positive-cmkt-delta loop: mixed SELL_SHARES + matured-bond + share-purchase entries; SELL_SHARES capitalGains rate dispatch; matured bond withholding. SFC perimeter invariant verified (wealthChange + treasuryChange = totalCmktIn).

## Decisions Made

- **Helper in orchestration/helpers/, not mechanics/** — tax dispatch is driven by session-state `TaxPolicy` and invoked at runner tick sites; same layer as sfcAudit and structuralPressures helpers.
- **`TaxInput.taxPolicy` optional field instead of TypeScript overload** — avoids ambiguous overload resolution against the existing object-param signature; zero breakage for Phase-10 callers; Phase-11 callers add one field.
- **VAT is buyer-side only, additive** — buyer pays (base + vat); seller receives full base and owes separate income tax on sale. Mirrors how real retail sales tax + payroll/income tax layer without double-counting.
- **SYSTEM_NPC trades VAT-exempt** — the runner's liquidity backstop is not a taxable citizen consumer; seller still owes amm_sell tax on the fundedCost (the fiat outflow is still income).
- **WORK tax uses `grossPaid` not `originalWealthDelta`** — when treasury is insufficient, grossPaid=0 and no tax is withheld; prevents synthetic tax on wages that never materialized.
- **Unified capital-gains on positive cmkt deltas** — BLOCKER-3 fix. Every positive entry in `cmktDelta.wealthDeltas` (SELL_SHARES, matured bond, dividend, coupon income) gets the same `capital_gains` rate treatment; negatives (purchases, issuance) pass through. Symmetry is easier to reason about than per-action special cases, and matches the "positive-only fiat inflow" SFC principle.
- **Hook-site integration tests model runner arithmetic directly** — rather than mounting `runSimulation` (slow, requires DB, non-deterministic). Each test instantiates fake treasury + wealth, invokes `computeWithholding` with the exact policy/amount the runner would, and asserts the SFC invariant. Fast, deterministic, scoped to the contract this plan owns.

## Deviations from Plan

### Documentation adjustments (not behavior changes)

- **Task 1 action suggested `computeIncomeTax` overload via two function signatures** — e.g. `function computeIncomeTax(income: number, rate: number): number; function computeIncomeTax(income: number, policy: TaxPolicy): number`. The existing Phase-10 `computeIncomeTax` actually takes a `TaxInput` object (`{ agentIncomes, taxRate }`), not `(income, rate)`. Rewriting to a true two-signature overload would break every Phase-10 caller. Resolved by extending `TaxInput` with an optional `taxPolicy` field and branching inside the existing function. The grep acceptance (`grep -c "computeWithholding" server/src/mechanics/fiscalEngine.ts >= 1`) is satisfied by the helper import + delegation call.
- **Task 2b action referenced `AMM buy VAT` and `PRODUCE_AND_SELL AMM sell` at simulationRunner.ts lines 1377-1397** — the lines in the current codebase at those coordinates are the **order-book** non-food trade loop (P2P matching), not a direct AMM sell/buy. Semantically they serve the same role (commodity exchange with per-transaction fiat flow), and the hook shape matches verbatim (`buyerState.wealthDelta -= executionPrice × qty` / `sellerState.wealthDelta += executionPrice × qty`). I wired VAT + amm_sell into the order-book loop — the only citizen-to-citizen commodity trade path. The one other AMM direct sell site (~1711, "AMM Famine Reserve") is a SYSTEM injection (fiat flows from AMM → treasury, no agent participants), so no withholding is appropriate and none was added.
- **Task 1 unit test names** — plan specified 8 behavior bullets; delivered 15 assertions across 4 describe blocks (flat dispatch, progressive dispatch, edge cases, plus 13 additional integration scenarios later added under Task 2a/2b). Exceeds the plan's minimum bar.

### Auto-fixed Issues

None — all changes were in-scope for the 5 prescribed hook sites. No Rule 1/2/3 auto-fixes triggered.

## Issues Encountered

- **Pre-existing test failures unchanged.** `npm run test -w server` shows 5 failures in 2 files (`economyConfig.test.ts` × 4 default-rate mismatches + `banking.test.ts` × 1 canIssueLoan edge case). All documented in 11-01's `deferred-items.md` as base-branch failures before Phase 11 started. Zero impact on Phase-11-owned tests: 72 SFC tests all green (sfcTaxation 28, sfcCapitalMarkets 9, sfcFiscal 20, sfcBanking 6, sfcEscrow 9).
- **Pre-existing TypeScript errors unchanged.** `tsc --noEmit` reports the same 3 errors (`edgeCases.test.ts` × 2 `satiety` + `reflectionRunner.ts` × 1 `possibly undefined`). Diff vs base: flat.
- **No auth gates encountered.** Plan executed fully autonomously.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plans 11-05 through 11-10 unblocked.** The tax withholding wiring is stable and verifiable:

- **Plan 11-05+ (structural pressure tuning / additional SFC instrumentation)** — `sessionStateTreasury` now grows from both Plan-10 WORK-reversed flow AND Phase-11 tax inflows, so empirical calibration of fiscal policy can proceed with realistic revenue.
- **Plan 11-07 (SFC subsystem drift telemetry)** — the `[TAX]` trace lines are forensic audit points for per-subsystem drift attribution. Taxation is now a distinct bucket that sums net-zero across (wealthDelta sum + treasury delta).
- **Plan 11-08+ (governance toggle, law amendment)** — no direct intersection with taxation. Downstream plans can assume `iterEconomyConfig.taxPolicy` is always accessible via `getEconomyConfig(session.config)` at runtime.

**Empirical validation ready.** A United States bootstrap with flat 15%/10%/15% tax policy, run for 5 iterations, should now show treasury grow monotonically (revenue > 0 every iteration), whereas Plan 11-03 alone showed treasury only losing fiat to escrow + welfare. The combined effect of 11-03 (fiscal loop closure) + 11-04 (revenue collection) closes the full fiscal loop: revenue in → escrow out → quality up → multipliers fire → productivity up.

**Future extension point (deferred to Phase 12+):** Runtime amendment of taxShape via citizen legislative session (D-12 noted this as out-of-scope). The helper + hook-site wiring supports runtime `policy` substitution via config update without code changes — the extension work is purely in governance/UI.

**Blockers:** None.

## Known Stubs

None. All 5 hook sites wire real arithmetic:
- `computeWithholding` consumes real `iterEconomyConfig.taxPolicy` / `cmktEconomyConfig.taxPolicy` (same object, accessed at different scope depth in the runner).
- `sessionStateTreasury` mutation is immediate and reads/writes via the established Map accessor.
- `[TAX]` trace lines flow through the existing `appendTrace(sessionId, …)` path → physics trace log → Central Agent narrative context.
- `computeIncomeTax` delegation is active when `taxPolicy` present; no placeholder branch.

## Self-Check: PASSED

- `server/src/orchestration/helpers/taxWithholding.ts` exists — verified via `Glob`.
- `grep -c "export function computeWithholding" server/src/orchestration/helpers/taxWithholding.ts` returns 1 — verified.
- `grep -c "export type TaxKind" server/src/orchestration/helpers/taxWithholding.ts` returns 1 — verified.
- `grep -c "computeWithholding" server/src/orchestration/simulationRunner.ts` returns 8 (>= 5 required) — verified.
- `grep -c "'wage'" server/src/orchestration/simulationRunner.ts` returns 3 (>= 2 required) — verified.
- `grep -c "'amm_sell'" server/src/orchestration/simulationRunner.ts` returns 3 (>= 1 required) — verified.
- `grep -c "'vat'" server/src/orchestration/simulationRunner.ts` returns 1 — verified.
- `grep -c "'capital_gains'" server/src/orchestration/simulationRunner.ts` returns 1 — verified.
- `grep -c "shareSaleProceeds" server/src/orchestration/simulationRunner.ts` returns 0 (BLOCKER-3) — verified.
- `grep -c "\[TAX\]" server/src/orchestration/simulationRunner.ts` returns 7 (>= 5) — verified.
- Commits `b4f6fd6`, `11255a8`, `3362055` all present in `git log --oneline -5` — verified.
- All SFC tests green: sfcTaxation 28, sfcCapitalMarkets 9, sfcFiscal 20, sfcBanking 6, sfcEscrow 9 (72 total) — verified.
- `tsc --noEmit -p server/tsconfig.json` diff vs base: flat (same 3 pre-existing errors).
- `npm run test -w server` shows 396 passed / 5 failed (pre-existing) / 38 todo — +10 passed vs base; 0 new failures.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
