# GC5: Post-Simulation Review Fixes — Summary

**Status:** Implementation complete, pending final compilation verification after dopamine removal.

## What was done

### Task 1: Wire `totalEconomyFiat` into fiscal tick ✓
- **File:** `simulationRunner.ts`
- Computed `fiscalTotalEconomyFiat = statUpdates.reduce(wealth) + treasuryBalance` before `executeBudget()` call
- Passed as `totalEconomyFiat` parameter, activating the GDP-scaled public goods quality formula (GC3)
- **Impact:** Infrastructure/education quality now grows at ~1.8 pts/iter at China's 1.8% GDP spending ratio instead of saturating in 3 iterations

### Task 2: Restrict bank agent actions ✓
- **File:** `actionCodes.ts`
- Replaced `BANK_ACTIONS = [...BASE_ACTIONS, ...]` with dedicated institutional action set:
  - Bank: ISSUE_LOAN, SET_INTEREST_RATE, POST_BUY_ORDER, POST_SELL_ORDER, DEPOSIT, WITHDRAW, BUY_BOND, NONE
  - Central bank: all bank actions + SET_RESERVE_RATIO, SET_BASE_RATE
- Removed citizen survival actions (REST, WORK, STEAL, HELP, APPLY_FOR_JOB, etc.) from bank agents

### Task 3: Bank institutional prompt ✓
- **File:** `agent-intent.ts`
- Added `isInstitutional` detection for `agent.type === 'bank'` or role 'bank'/'central_bank'
- Institutional agents get a mandate-based persona:
  - "You are NOT a person" disclaimer
  - Mandate: price stability, liquidity management, reserve prudence
  - Only shows institutional-relevant context (reserves, operations, inflation, central bank)
  - Requires institutional narrative voice ("The Central Bank adjusted..." not "I felt...")
- Citizen agents unchanged (conditional branch)

### Task 4: Remove dopamine system ✓
- **Files:** ~30 files across shared/, server/, web/
- Made `dopamine` optional in `AgentStats` for backward DB compatibility
- Removed all dopamine delta calculations from `physicsEngine.ts`
- Removed `dopamineDecay` from physics config
- Removed dopamine from allostatic engine, telemetry, prompts, statistics UI
- Removed Dopamine StatCard, TelemetryPanel references, PhysicsLaboratory chart
- Updated tests for new signatures

### Task 5: Enrich comparison prompt ✓
- **Files:** `comparison.ts`, `compare.ts`
- Added `configDiffs` parameter with explicit instruction: "Your analysis MUST attribute outcome differences to these changes"
- Added per-iteration time-series data (iter, wealth, health, happiness, gini, cpi, m1) as compact table
- Added wealth distribution summary (bottom 25% avg, median, top 25% avg) for inequality grounding
- Updated compare route to gather iteration rows, telemetry, and agent wealth quartiles
- System prompt now includes CRITICAL RULES for data-grounded analysis

### Task 6: Expand telemetry digest window ✓
- **Files:** `narrativeValidation.ts`, `simulationRunner.ts`, `narrativeValidation.test.ts`
- Changed `buildTelemetryDigest()` from `(current, previous)` to `(current, recentHistory[])` signature
- Builds compact multi-iteration trend table showing last 4-5 iterations
- Wired digest into resolution prompt call in simulationRunner.ts (was previously unconnected)
- Updated 4 test cases for new array signature

## Verification
- TypeScript compilation: pending final check after dopamine removal agent completes
- Test execution: pending
- All changes are backward compatible (dopamine made optional, not removed from schema)
