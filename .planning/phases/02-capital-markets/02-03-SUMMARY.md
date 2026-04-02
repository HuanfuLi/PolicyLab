---
phase: 02-capital-markets
plan: 03
subsystem: capital-markets
tags: [simulation-loop, physics-engine, prompts, export-import, sfc, integration]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [capital-markets-simulation-integration, capital-markets-export-import, capital-markets-prompts]
  affects: [simulationRunner, physicsEngine, prompts, importexport]
tech_stack:
  added: []
  patterns:
    - "deferred action pattern for physics engine (wealthDelta=0, deferred to engine)"
    - "sqlite.transaction() batch writes for capital market tick (same as banking)"
    - "intent scan for capital market request accumulation (same as ADJUST_TAX/EMBEZZLE)"
    - "agentIdMap remapping for both ownerAgentId and enterpriseOwnerId/issuerId"
key_files:
  created:
    - server/src/__tests__/sfcCapitalMarkets.test.ts
  modified:
    - server/src/mechanics/physicsEngine.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/llm/prompts.ts
    - server/src/routes/importexport.ts
decisions:
  - "processIteration signature uses separate typed arrays (not generic pendingRequests) — matched actual implementation from Plan 02-02"
  - "corpBond coupon/maturity rates fall back to govBondCouponRate/govBondTermIterations — EconomyConfig has no separate corp bond fields"
  - "ISSUE_GOV_BOND in the intent loop adds a gov bond purchase for the issuer (treasury receives) — elite-role gate enforced by actionCodes.ts"
  - "enterpriseTreasuryDeltas routed to enterprise owner agent wealth in statUpdates — no separate enterprise treasury ledger needed"
  - "SFC audit unchanged: no bondEscrow parameter added to computeSystemFiatTotal (confirmed SFC-neutral per research)"
metrics:
  duration: 25
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_modified: 5
---

# Phase 02 Plan 03: Capital Markets Simulation Integration Summary

Capital markets engine fully wired into the simulation loop. Agents with BUY_SHARES, SELL_SHARES, BUY_BOND, or ISSUE_GOV_BOND intents are now processed by the capital market engine each iteration; dividends, bond coupons, and maturities execute automatically; all operations are SFC-neutral; sessions export/import full capital market state with agent ID remapping.

## What Was Built

### Task 1: Physics Engine Cases + simulationRunner Wiring

**physicsEngine.ts** — Added 4 case blocks following the existing banking deferred pattern:
- `BUY_SHARES`: wealthDelta=0, hap+1, dop+1; trace notes deferral to capitalMarketEngine
- `SELL_SHARES`: wealthDelta=0, hap-1, cor+1, dop-1; trace notes deferral
- `BUY_BOND`: wealthDelta=0, hap+1, cor-1, dop+1; trace notes deferral
- `ISSUE_GOV_BOND`: wealthDelta=0, cor-2, dop+1; trace notes deferral (elite only per actionCodes.ts)

**simulationRunner.ts** — Wired capital markets into the iteration loop:
1. Imports `capitalMarketEngine` and `capitalMarketRepo`
2. Capital market request accumulation: after all action resolutions, scans `intents` for capital market action codes and builds four typed arrays (`cmktPendingSharePurchases`, `cmktPendingShareSales`, `cmktPendingGovBondPurchases`, `cmktPendingCorpBondIssuances`)
3. Capital market tick: runs after banking tick when `capitalMarketsEnabled`, calls `capitalMarketEngine.processIteration()` with current agent wealth, applies DB writes in `sqlite.transaction()`, routes wealth/enterprise/treasury deltas to `statUpdates`
4. SFC audit unchanged — bond/equity transfers are perimeter-neutral (no escrow term added)

### Task 2: Prompts + Export/Import + SFC Tests

**prompts.ts** — Capital market context for agent prompts:
- `CitizenCapitalMarketContext` interface with `equityHoldings[]` and `bondHoldings[]`
- `buildCitizenCapitalMarketSection()` builder injected into `buildNaturalIntentPrompt` dynamic suffix
- 4 ACTION_SCHEMAS entries: BUY_SHARES, SELL_SHARES, BUY_BOND, ISSUE_GOV_BOND with descriptions and params
- New optional parameter `citizenCapitalMarketContext` on `buildNaturalIntentPrompt`

**importexport.ts** — Session export/import for capital market tables:
- Export: queries `capitalMarketRepo.getEquityPositionsBySession()` and `getBondHoldingsBySession()`, appended to export object
- Import: remaps `ownerAgentId` and `enterpriseOwnerId` via `agentIdMap`; corp bond `issuerId` also remapped; `'treasury'` issuerId passes through unchanged

**sfcCapitalMarkets.test.ts** — 6 SFC integration tests (all passing):
1. Share purchase SFC invariant — net wealth delta = 0
2. Dividend distribution SFC invariant — owner payout = shareholder gains
3. Gov bond lifecycle — purchase → coupon → maturity, invariant at each step
4. Corporate bond SFC — coupon/maturity from enterprise owner
5. Mixed iteration SFC — shares + coupons + maturity in single tick, net delta = 0
6. Export/import round-trip — equity and bond positions with correct ID remapping

## Test Results

```
Test Files: 9 passed (9)
     Tests: 104 passed (104)
```

All pre-existing tests continue to pass. 6 new SFC capital market tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] processIteration signature mismatch**
- **Found during:** Task 1
- **Issue:** Plan spec showed a simpler `pendingRequests: CapitalMarketRequest[]` parameter, but the actual Plan 02-02 implementation uses 4 separate typed arrays
- **Fix:** Matched the actual signature (`pendingSharePurchases`, `pendingShareSales`, `pendingGovBondPurchases`, `pendingCorpBondIssuances`)
- **Commit:** 7309bda

**2. [Rule 2 - Missing Functionality] EconomyConfig missing corpBond fields**
- **Found during:** Task 1
- **Issue:** `corpBondCouponRate` and `corpBondTermIterations` referenced in plan but absent from `EconomyConfig` type
- **Fix:** Used `govBondCouponRate` and `govBondTermIterations` as fallbacks (reasonable — the shared config does have these)
- **Commit:** 7309bda

## Commits

| Hash | Message | Files |
|------|---------|-------|
| 7309bda | feat(02-03): wire capital market engine into simulation loop | physicsEngine.ts, simulationRunner.ts |
| d98229e | feat(02-03): add capital market prompts, export/import, and SFC tests | prompts.ts, importexport.ts, sfcCapitalMarkets.test.ts |

## Self-Check: PASSED
