---
phase: 10-fix-simulation-realism
plan: GC2
subsystem: inflation-engine
tags: [cpi, inflation, bug-fix, basket-prices, simulation-runner]
dependency_graph:
  requires: [10-GC1]
  provides: [D-30, D-12]
  affects: [inflationEngine, simulationRunner, CPI-telemetry]
tech_stack:
  added: []
  patterns: [value-aware-guard, module-scope-constant, basket-price-fallback]
key_files:
  created: []
  modified:
    - server/src/orchestration/simulationRunner.ts
    - server/src/mechanics/__tests__/inflationEngine.test.ts
decisions:
  - "Use Object.values().some() to detect all-zero cpiBasePrices rather than key count"
  - "Module-scope NON_FOOD_COMMODITY_BASELINES constant (not reuse of function-scoped COMMODITY_BASELINES) to avoid scope issues"
  - "Non-food basket fallback uses realistic AMM commodity baseline prices (tools=12, luxury_goods=12, raw_materials=4)"
metrics:
  duration: "6 minutes"
  completed: "2026-04-09T04:24:31Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 10 Plan GC2: Fix CPI/Inflation Engine Frozen at 100 — Summary

**One-liner:** Two-bug CPI freeze fixed — value-aware `hasBasePrices` guard + NON_FOOD_COMMODITY_BASELINES fallback restore full basket price movement from iteration 1.

## What Was Built

Fixed two compounding bugs that kept CPI locked at exactly 100 across all simulation iterations.

**Bug A (simulationRunner.ts line 3697):** The `hasBasePrices` check used `Object.keys(...).length > 0`, which returned `true` even when all 4 basket prices were `0` (the default initial state). This caused the auto-init block to be skipped on every iteration, leaving `cpiBasePrices` at `{food: 0, tools: 0, luxury_goods: 0, raw_materials: 0}`. The inflation engine then applied the `basePrice === 0 → ratio = 1` guard for every item, yielding `CPI = 100` forever.

**Fix A:** Replaced with `Object.values(...).some(v => (v ?? 0) > 0)` — correctly detects all-zero maps as "uninitialized" and triggers the auto-init block on iteration 1.

**Bug B (simulationRunner.ts line 601-603):** `getInflationBasketPrices()` fell back to literal `1` for tools, luxury_goods, and raw_materials when those multi-AMM pools had no trading volume. These 3 items represent 60% of basket weight. Saving `{food: ~6, tools: 1, luxury_goods: 1, raw_materials: 1}` as base prices meant CPI would only respond to food price changes (40% weight) and would misrepresent the true price level.

**Fix B:** Added `NON_FOOD_COMMODITY_BASELINES` at module scope with realistic values matching the AMM commodity baselines (`tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0`). Used as final fallback in `getInflationBasketPrices()` instead of literal `1`.

**Result:** On iteration 1, `currentPrices` will be `{food: ~6.0, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0}`. These are saved as `cpiBasePrices`. From iteration 2 onward, CPI computes actual price ratios across the full basket, and `inflationRate`/`inflationExpectations` become non-zero when prices move.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix hasBasePrices + non-food baselines | 364586f | simulationRunner.ts |
| 2 | Add 4 CPI movement tests | 364586f | inflationEngine.test.ts |

## Verification

- TypeScript: zero errors introduced (pre-existing `edgeCases.test.ts` satiety errors are unrelated)
- Test suite: 284/284 tests pass (23 test files)
- grep confirms: `hasBasePrices` uses `.some(v => (v ?? 0) > 0)` pattern
- grep confirms: `NON_FOOD_COMMODITY_BASELINES` defined at line 114, used at lines 601-603

## New Tests Added

1. **CPI rises above 100 when food price increases** — food 6→7.5, basket weights explicit, expects CPI ≈ 110 and positive inflationRate
2. **CPI falls below 100 when food price decreases** — food 6→4.8, expects CPI < 100 and negative inflationRate
3. **Zero base price causes ratio=1** — documents existing guard behavior, all-zero basePrices → CPI ≈ 100
4. **Non-food basket contributes proportional to weight** — tools 12→15, expects CPI ≈ 106.25

## Deviations from Plan

None — plan executed exactly as written. Both fixes applied as specified, `NON_FOOD_COMMODITY_BASELINES` added at module scope (not reusing the function-scoped `COMMODITY_BASELINES` at line 1505 as noted in the plan).

## Known Stubs

None. All basket price fallbacks now use meaningful non-zero values; CPI will reflect real price movement from simulation iteration 1.

## Self-Check: PASSED

- `server/src/orchestration/simulationRunner.ts` — modified, committed at 364586f
- `server/src/mechanics/__tests__/inflationEngine.test.ts` — modified, committed at 364586f
- Commit 364586f exists: confirmed via `git rev-parse --short HEAD`
- All 284 server tests pass
