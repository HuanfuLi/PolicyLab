---
phase: 10-fix-simulation-realism
plan: 04
subsystem: banking-engine, enterprise-engine, simulation-runner
tags: [banking, enterprise, liquidity-injection, loan-products, wiring]
dependency_graph:
  requires: ["10-02", "10-03"]
  provides: ["differentiated-loan-products", "liquidity-injection", "enterprise-repo", "enterprise-wiring"]
  affects: ["simulationRunner", "bankingEngine", "enterpriseRepo"]
tech_stack:
  added: []
  patterns: ["deposit-based-payroll", "liquidity-injection-m0-adjustment"]
key_files:
  created:
    - server/src/db/repos/enterpriseRepo.ts
  modified:
    - server/src/mechanics/bankingEngine.ts
    - server/src/mechanics/__tests__/banking.test.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/orchestration/simulationState.ts
    - shared/src/types.ts
    - server/src/mechanics/__tests__/enterpriseEngine.test.ts
decisions:
  - "Enterprise deposit accounts use ent_ prefix to distinguish from citizen agents"
  - "asyncLogFlusher only supports INSERT, so per-iteration enterprise updates use direct DB writes"
  - "Enterprise production injected via AMM.injectGoodsReserve rather than executeSell"
  - "Liquidity injection adjusts SFC initialFiat baseline to prevent false drift warnings"
metrics:
  duration_seconds: 611
  completed: "2026-04-08T20:29:07Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 7
---

# Phase 10 Plan 04: Enterprise Banking + SimulationRunner Wiring Summary

Differentiated loan products (business vs personal) with configurable rate/term, central bank liquidity injection as lender-of-last-resort, enterpriseRepo for DB persistence, and enterprise engine fully wired into the simulation loop with deposit-based payroll.

## Tasks Completed

### Task 1: Differentiated loan products + liquidity injection in bankingEngine (TDD)
- **RED**: 8 failing tests for business loan rates/terms and liquidity injection thresholds
- **GREEN**: Extended `processLoanRequest` with optional `loanProductType` parameter; business loans get discounted rate and extended term; added `processLiquidityInjection` function
- **Commits**: c611f16 (test), 6016f36 (implementation)
- Business loan: rate = baseLoanInterestRate * (1 - businessLoanRateDiscount), term = defaultLoanTermIterations * businessLoanTermMultiplier
- Liquidity injection: fires when actual reserve ratio < threshold, capped at cap * totalDeposits, is M0 increase

### Task 2: Enterprise repo + wire enterprise engine into simulationRunner
- **Created** `server/src/db/repos/enterpriseRepo.ts` with `insertEnterprise`, `getEnterprises`, `updateEnterpriseInsolvencyAsync`, `deleteEnterprise`
- **Wired** enterprise engine into processIteration with full lifecycle:
  1. Enterprise bootstrap: loads blueprints from DB, creates deposit accounts with initial capital
  2. Wage processing: deposit-to-deposit bank transfers for payroll
  3. Insolvency check: tracks consecutive deficits, removes bankrupt enterprises
  4. Idle fallback: forces food production for agents inactive for threshold iterations
  5. Production: injects goods into AMM reserves via `injectGoodsReserve`
  6. Cost pass-through: tracks wage costs across iterations for price markup calculation
  7. Liquidity injection: central bank injects fiat when reserves critically low
  8. SFC audit adjustment: `sfcEntry.initialFiat += totalLiquidityInjected`
- **Commit**: 88209bb

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fix merge conflict marker in enterpriseEngine.test.ts**
- **Found during:** Task 2, compilation check
- **Issue:** Leftover `>>>>>>> worktree-agent-a14b9841` conflict marker at line 210
- **Fix:** Removed the conflict marker line
- **Files modified:** server/src/mechanics/__tests__/enterpriseEngine.test.ts

**2. [Rule 3 - Blocking] Fix duplicate EnterpriseSector/EnterpriseCommodity/EnterpriseBlueprint types**
- **Found during:** Task 1, initial file read
- **Issue:** Triple duplicate type definitions in shared/src/types.ts from wave 1 merge
- **Fix:** Removed duplicate blocks, kept single canonical definitions at line 574
- **Files modified:** shared/src/types.ts

**3. [Rule 2 - Missing functionality] asyncLogFlusher only supports INSERT, not UPDATE**
- **Found during:** Task 2, enterpriseRepo implementation
- **Issue:** asyncLogFlusher.enqueue only handles INSERT statements; enterprise insolvency updates need UPDATE
- **Fix:** Used direct DB `db.update()` calls instead of asyncLogFlusher for per-iteration enterprise updates (frequency is acceptable at once-per-enterprise-per-iteration)
- **Files modified:** server/src/db/repos/enterpriseRepo.ts

**4. [Rule 1 - Bug] AMM has no addFoodReserve method**
- **Found during:** Task 2, wiring enterprise production
- **Issue:** Plan referenced `addFoodReserve` which doesn't exist on AutomatedMarketMaker
- **Fix:** Used existing `injectGoodsReserve` method instead
- **Files modified:** server/src/orchestration/simulationRunner.ts

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Enterprise deposit IDs use `ent_` prefix | Distinguishes enterprise deposits from citizen deposits in the banking system |
| Direct DB writes for enterprise insolvency | asyncLogFlusher only supports INSERT; once-per-enterprise-per-iteration frequency is acceptable |
| Production via `injectGoodsReserve` not `executeSell` | Direct injection matches enterprise subsistence production model; sell would require fiat recipient |
| SFC baseline adjustment inline | Liquidity injection is M0 creation; must adjust baseline to prevent false SFC leak warnings |

## Verification

- 32 banking tests pass (including 8 new for loan products + liquidity injection)
- 16 enterprise engine tests pass
- 116 total mechanics tests pass
- simulationRunner imports and calls processEnterpriseWages, processEnterpriseInsolvency, processIdleFallback, processEnterpriseProduction, processEnterpriseCostPassThrough
- enterpriseRepo.ts contains asyncLogFlusher import and references
- SFC audit baseline adjusted for liquidity injections

## Known Stubs

None - all functionality is fully wired.

## Self-Check: PASSED
