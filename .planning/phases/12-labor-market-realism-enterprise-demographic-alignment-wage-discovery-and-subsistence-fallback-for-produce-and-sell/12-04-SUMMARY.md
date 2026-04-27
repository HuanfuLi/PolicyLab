---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: 04
subsystem: enterprise-engine, simulation-runner, labor-market-tests
tags: [wage-discovery, labor-market, D-01, mrp-ceiling, profit-share, sfc-invariant, tdd]
dependency_graph:
  requires:
    - "12-01: EnterpriseRecord.capacity/lastApplicants/lastVacancies, EconomyConfig Phase 12 fields"
  provides:
    - "server/src/mechanics/enterpriseEngine.ts: processWageAdjustment() pure function"
    - "server/src/orchestration/simulationState.ts: sessionPreviousEnterpriseLedgers Map"
    - "server/src/orchestration/simulationRunner.ts: wage-adjustment wiring before buildEmploymentBoardEntries"
    - "8 real assertions in laborMarket.test.ts (L-05/L-06)"
    - "1 real SFC assertion in sfcInvariant.test.ts"
  affects:
    - "server/src/orchestration/simulationRunner.ts (wage-adjustment block in iteration preamble)"
    - "server/src/mechanics/__tests__/enterpriseEngine.test.ts (3 new processWageAdjustment tests)"
tech_stack:
  added: []
  patterns:
    - "Pure function returning delta trace (matches bankingEngine/capitalMarketEngine pattern)"
    - "sessionPreviousEnterpriseLedgers follows sessionPreviousWageCosts Map<sessionId, Map> pattern"
    - "TDD red-green-refactor per task (test failures confirmed before implementation)"
key_files:
  created: []
  modified:
    - "server/src/mechanics/enterpriseEngine.ts"
    - "server/src/orchestration/simulationState.ts"
    - "server/src/orchestration/simulationRunner.ts"
    - "server/src/mechanics/__tests__/laborMarket.test.ts"
    - "server/src/mechanics/__tests__/enterpriseEngine.test.ts"
    - "server/src/mechanics/__tests__/sfcInvariant.test.ts"
decisions:
  - "Linear nudge chosen (not sigmoid) per 12-CONTEXT.md §Discretion — monotonic, simpler, bounded ±50% per iteration"
  - "NUDGE_RATIO_CLAMP = 0.5 constant prevents pathological single-iteration wage halving/doubling"
  - "PRODUCTION_PER_WORKER = 10 const comments link to simulationRunner.ts:~1905 hardcoded value for internal consistency"
  - "MultiAMM pools use currentFoodReserve as goods reserve (AMM abstraction — all pools share same class)"
  - "Ledger snapshot (sessionPreviousEnterpriseLedgers) written BEFORE telemetry block so next-iter profit-share gets accurate P&L"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-27"
  tasks: 3
  files_modified: 6
---

# Phase 12 Plan 04: Hybrid Wage-Adjustment Engine (D-01) — processWageAdjustment + simulationRunner Wiring Summary

D-01 hybrid wage rule implemented as pure function in enterpriseEngine.ts: linear labor-market nudge (applicant surplus/shortage pressure), profit-share top-up (α × last-iteration P&L / workforce), MRP ceiling (spot price × 10 workers − input cost), and minimum-wage floor — wired into simulationRunner.ts before the employment board so agents see updated posted wages each iteration.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | processWageAdjustment pure function + sessionPreviousEnterpriseLedgers | 1d011e2 | enterpriseEngine.ts, simulationState.ts, enterpriseEngine.test.ts |
| 2 | Wire processWageAdjustment + end-of-iteration ledger persist | 2cbd293 | simulationRunner.ts |
| 3 | Real assertions in laborMarket.test.ts + sfcInvariant.test.ts | 5e06760 | laborMarket.test.ts, sfcInvariant.test.ts |

## What Was Built

### Task 1 — processWageAdjustment pure function

Added to `server/src/mechanics/enterpriseEngine.ts`:

- **`processWageAdjustment(input: WageAdjustmentInput): WageAdjustmentResult`** — pure function, no DB writes, no fiat movement.
- **`WageAdjustmentInput`** interface: `{ enterprises, config, ammSpotPrices, previousLedgers }`.
- **`WageAdjustmentResult`** interface: `{ trace: string[], wageChanges: Array<{enterpriseId, before, after, nudgeFactor, profitTopup, mrpClampApplied}> }`.
- Order (non-negotiable per D-01): linear nudge → profit-share → MRP ceiling → min floor.
- `NUDGE_RATIO_CLAMP = 0.5` constant prevents ±50%+ swings per iteration.
- MRP ceiling guarded: `spot > 0 && Number.isFinite(spot)` (12-RESEARCH §8 mitigation).
- `PRODUCTION_PER_WORKER = 10` constant matched to simulationRunner.ts hardcoded value.

Added to `server/src/orchestration/simulationState.ts`:

- **`sessionPreviousEnterpriseLedgers: Map<string, Map<string, EnterpriseLedger>>`** — per-session enterprise ledger snapshots from the previous iteration, read by `processWageAdjustment` for profit-share computation.
- Cleanup added to `cleanupSessionState`.

### Task 2 — simulationRunner wiring

Added to `server/src/orchestration/simulationRunner.ts`:

- Import `processWageAdjustment`, `WageAdjustmentInput` from `enterpriseEngine.js`.
- Import `sessionPreviousEnterpriseLedgers` from `simulationState.js`.
- Import `EnterpriseCommodity` from `@policylab/shared`.
- **Wage-adjustment block** inserted immediately BEFORE `buildEmploymentBoardEntries` at the per-iteration preamble:
  - Builds `ammSpotPrices: Map<EnterpriseCommodity, number>` from single AMM (food) and multi-commodity AMMs.
  - Reads `prevLedgers` from `sessionPreviousEnterpriseLedgers`.
  - Calls `processWageAdjustment`, appends `[WAGE]`-prefixed trace lines via `appendTrace`.
- **End-of-iteration snapshot**: `sessionPreviousEnterpriseLedgers.set(sessionId, new Map(enterpriseLedgerMap))` BEFORE telemetry is built.
- SFC invariant confirmed: wage-adjustment block touches only `ent.wage` (property), not any fiat accumulator.

### Task 3 — Test assertions

**`laborMarket.test.ts`** — 8 real `expect()` assertions replace `it.todo`:
- L-05: surplus nudge (clamped surplus_ratio=0.5 → wage decreases by k×0.5)
- L-05: shortage nudge (clamped shortage_ratio=0.5 → wage increases by k×0.5)
- L-05: profit-share top-up adds α × (P&L / workforce) when P&L > 0
- L-05: profit-share is zero when P&L ≤ 0
- L-05: minimum wage floor enforced
- L-06: MRP ceiling clamps wage above (spot × productionPerWorker − inputCost)
- L-06: MRP ceiling skipped when spot = 0 (zero-division guard)
- L-06: MRP ceiling skipped when spot = NaN (NaN-propagation guard)

**`sfcInvariant.test.ts`** — 1 real assertion replaces first Phase 12 todo:
- `processWageAdjustment` changes only `ent.wage` — all other enterprise fields remain identical to pre-call snapshot.

**`enterpriseEngine.test.ts`** — 3 new processWageAdjustment tests (from Task 1 TDD RED):
- Baseline (no applicants, no vacancies, no P&L) → wage unchanged except min floor
- Shortage → wage rises correctly
- Integration: all five steps compose correctly (shortage + profit-share + spot price)

## Deviations from Plan

None — plan executed exactly as written.

One minor adaptation in Task 2: the plan spec's `multiAmm` iteration used `Object.entries()` on a plain object, but the actual `sessionMultiAMMRegistry` returns `Map<MultiAMMItemType, AutomatedMarketMaker>`, so the iteration uses `for (const [item, pool] of multiAmm)` instead. The logic is equivalent.

## Verification Checks

- `npx tsc --noEmit -p server/tsconfig.json` — PASS (zero errors)
- `npx tsc --noEmit -p shared/tsconfig.json` — PASS (zero errors)
- `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts` — 8 pass, 6 todo (L-04/L-07/L-11 deferred to 12-05/12-07)
- `npx vitest run server/src/mechanics/__tests__/sfcInvariant.test.ts` — 19 pass, 2 todo
- `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts` — 19 pass
- `npm run test -w server` — 563 passed, 27 todos, 0 failures (no regression)
- SFC invariant: explicit test asserts processWageAdjustment is a pure property mutator (no fiat fields touched)

## Known Stubs

None. `processWageAdjustment` is fully operational:
- The nudge formula reads `lastApplicants` and `lastVacancies` which default to 0 until 12-05's matching pass populates them — this degrades gracefully (no nudge on iteration 1 or when matching pass hasn't run yet), consistent with L-11 requirement.
- `sessionPreviousEnterpriseLedgers` starts empty (new Map) — profit-share is zero on first iteration, which is correct (no prior period's P&L).

## Self-Check: PASSED

Files modified:
- server/src/mechanics/enterpriseEngine.ts — EXISTS
- server/src/orchestration/simulationState.ts — EXISTS
- server/src/orchestration/simulationRunner.ts — EXISTS
- server/src/mechanics/__tests__/laborMarket.test.ts — EXISTS
- server/src/mechanics/__tests__/enterpriseEngine.test.ts — EXISTS
- server/src/mechanics/__tests__/sfcInvariant.test.ts — EXISTS

Commits:
- 1d011e2 — Task 1 (processWageAdjustment + sessionPreviousEnterpriseLedgers)
- 2cbd293 — Task 2 (simulationRunner wiring)
- 5e06760 — Task 3 (test assertions)
