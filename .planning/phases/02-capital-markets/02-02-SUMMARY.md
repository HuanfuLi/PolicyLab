---
phase: 02-capital-markets
plan: "02"
subsystem: capital-markets
tags: [equity, bonds, capital-markets, sfc, tdd, drizzle, sqlite]

# Dependency graph
requires:
  - phase: 02-01
    provides: "EquityPosition, BondHolding types; equityPositions, bondHoldings schema tables; capital market ActionCodes"
  - phase: 01-02
    provides: "BankingDelta return pattern, bankingRepo CRUD pattern for mirroring"
provides:
  - "Pure capital market engine: processSharePurchase, processShareSale, distributeDividends, processGovBondPurchase, processCorpBondIssuance, processCoupons, processMaturities, processIteration"
  - "DB CRUD for equity_positions and bond_holdings tables"
  - "20 unit tests covering all CMKT-01 through CMKT-05 requirements"
affects: [02-03, 03-fiscal-policy, simulation-runner, sfc-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CapitalMarketDelta: delta-return pattern (no DB mutations in engine)"
    - "TDD RED/GREEN cycle: tests committed before implementation"
    - "SFC comment convention: // SFC: buyer -X, seller +X, net=0 in each function"
    - "onConflictDoUpdate for upserts in drizzle repo"

key-files:
  created:
    - server/src/mechanics/capitalMarketEngine.ts
    - server/src/db/repos/capitalMarketRepo.ts
    - server/src/mechanics/__tests__/capitalMarket.test.ts
  modified: []

key-decisions:
  - "processCorpBondIssuance wealth transfer goes to enterpriseTreasuryDeltas (not wealthDeltas) — caller must apply to enterprise owner's wealth"
  - "IPO share price fixed at 10 fiat when totalSharesOutstanding === 0 — avoids division by zero, sensible default for v1"
  - "distributeProRata enforces integer-safe pro-rata distribution — dividend totalDividend = Math.floor(wealth * ratio) then distributed integer"
  - "capitalMarketEngine.ts has zero DB imports — pure engine, repo is separate layer (same separation as bankingEngine/bankingRepo)"

patterns-established:
  - "Capital market operations: pure function returns CapitalMarketDelta, caller (simulationRunner) applies via repo in batch"
  - "Share price formula: enterpriseOwner.wealth / totalSharesOutstanding (or 10 for IPO)"

requirements-completed: [CMKT-01, CMKT-02, CMKT-03, CMKT-04, CMKT-05]

# Metrics
duration: 5min
completed: 2026-04-02
---

# Phase 02 Plan 02: Capital Markets Engine Summary

**SFC-neutral capital market engine implementing 5 instrument types (equity, dividends, gov/corp bonds, coupons, maturities) with per-iteration CapitalMarketDelta return pattern and full DB CRUD**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-02T00:23:58Z
- **Completed:** 2026-04-02T00:28:49Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- Pure deterministic engine (765 lines) implementing all 8 capital market operations with SFC-neutral wealth transfers and 19 SFC-annotated comment blocks
- 20 unit tests covering CMKT-01 through CMKT-05 — all passing after TDD GREEN cycle
- DB repository (223 lines) with full CRUD for equity_positions and bond_holdings tables, following bankingRepo pattern exactly
- Full monorepo build passes; engine has zero DB imports; repo has zero engine logic

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD RED — capitalMarket.test.ts** - `80e717c` (test)
2. **Task 1: TDD GREEN — capitalMarketEngine.ts** - `96d6c09` (feat)
3. **Task 2: capitalMarketRepo.ts** - `c8dfe6a` (feat)

## Files Created/Modified

- `server/src/mechanics/capitalMarketEngine.ts` — Pure engine: 8 functions (processSharePurchase, processShareSale, distributeDividends, processGovBondPurchase, processCorpBondIssuance, processCoupons, processMaturities, processIteration) with CapitalMarketDelta return type
- `server/src/db/repos/capitalMarketRepo.ts` — CRUD: getEquityPositionsBySession, getEquityPosition, upsertEquityPosition, deleteEquityPositionsBySession, getBondHoldingsBySession, getActiveBondHoldingsBySession, upsertBondHolding, deleteBondHolding, deleteBondHoldingsBySession, getTotalActiveBondFaceValue
- `server/src/mechanics/__tests__/capitalMarket.test.ts` — 20 unit tests, all green

## Decisions Made

- `processCorpBondIssuance` deposits wealth to `enterpriseTreasuryDeltas` rather than `wealthDeltas` — caller (simulationRunner, Plan 03) must route this to the enterprise owner agent's wealth. This matches the pattern from bankingEngine where bank reserves are tracked separately.
- IPO share price is fixed at 10 fiat when `totalSharesOutstanding === 0` to avoid division-by-zero and provide a sensible initial capitalization.
- Dividend total uses `Math.floor(ownerWealth * ratio)` before passing to `distributeProRata` — ensures integer input as required by the utility function.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-03 (simulationRunner integration) can import `processIteration` from `capitalMarketEngine.ts` and apply results via `capitalMarketRepo.ts` without modifying either file.
- `CapitalMarketDelta.enterpriseTreasuryDeltas` must be routed to enterprise owner agent wealth — Plan 03 must handle this mapping.
- Bond holdings with matured status are scheduled for deletion via `deleteBondHoldingIds`; Plan 03 must call `deleteBondHolding` for each id in the list.

---
*Phase: 02-capital-markets*
*Completed: 2026-04-02*
