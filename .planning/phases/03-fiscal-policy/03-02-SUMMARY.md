---
phase: 03-fiscal-policy
plan: "02"
subsystem: economics
tags: [fiscal-policy, public-goods, diminishing-returns, sfc, tdd, vitest]

# Dependency graph
requires:
  - phase: 03-fiscal-policy/03-01
    provides: BudgetAllocation and PublicGoodsState types in shared/src/types.ts, EconomyConfig fiscal fields, fiscalRepo CRUD, economyConfigUtils defaults

provides:
  - fiscalEngine.ts: executeBudget function (pure deterministic, returns FiscalDelta)
  - fiscalEngine.ts: updatePublicGoodsQuality function (diminishing returns + decay)
  - fiscalEngine.ts: getMultiplierEffects function (quality scores → simulation stat bonuses)
  - FiscalDelta interface with SFC-compliant treasury-to-agent accounting
  - MultiplierEffects interface (productivityBonus, skillGainBonus, enforcementBonus, welfarePerAgent)
  - 18 unit tests covering all edge cases

affects:
  - 03-fiscal-policy/03-03 (simulationRunner integration wires FiscalDelta into the iteration loop)
  - 04-inflation-loop (fiscal multipliers affect agent wealth flows which CPI tracks)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure engine pattern: fiscalEngine.ts has zero DB/LLM imports, returns delta struct for batch application"
    - "TDD red-green: tests written first, implementation passes all tests in one pass"
    - "SFC fiscal model: ALL spending distributed to agents (no money destruction); quality scores are side effects"

key-files:
  created:
    - server/src/mechanics/fiscalEngine.ts
    - server/src/mechanics/__tests__/fiscal.test.ts
  modified: []

key-decisions:
  - "All budget categories (infra/education/defense/welfare) distribute fiat to agents equally — treasury spending is never destroyed, maintaining SFC invariant"
  - "Quality score gain formula: (spendAmount ^ 0.7) * 0.264 scale factor — calibrated to yield ~2-3 quality points from 25 fiat (10% of 1000 treasury, 25% allocation)"
  - "Quality decay applies to all categories per iteration; spending overrides decay for the given category"
  - "Empty agent list edge case: treasury still decrements (government overhead), no payments sent"

patterns-established:
  - "Pure fiscal engine: zero DB imports, receives all data as params, returns FiscalDelta"
  - "Quality score scale factor constant (QUALITY_GAIN_SCALE_FACTOR=0.264) calibrated for realistic gameplay with default EconomyConfig values"

requirements-completed: [FISC-02, FISC-03]

# Metrics
duration: 12min
completed: 2026-04-01
---

# Phase 03 Plan 02: Fiscal Engine Summary

**Pure deterministic fiscal engine with SFC-compliant treasury-to-agent spending, diminishing-returns public goods quality, and stat multiplier effects — 18 unit tests all passing**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-01T23:33:00Z
- **Completed:** 2026-04-01T23:34:50Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Implemented `executeBudget` — allocates treasury spending across infrastructure/education/defense/welfare, distributes all fiat to alive agents (SFC-compliant), updates public goods quality scores with diminishing returns and linear decay, computes multiplier effects from updated quality
- Implemented `updatePublicGoodsQuality` — pure function applying spending-based gain (power law with exponent 0.7 and scale factor 0.264) or decay, clamped to [0, 100]
- Implemented `getMultiplierEffects` — maps quality scores to productivityBonus, skillGainBonus, enforcementBonus, welfarePerAgent via EconomyConfig multipliers
- 18 tests covering: zero treasury, normal budget, SFC invariant, proportional scaling (FISC-04), treasury cannot go negative, quality gain/decay, clamping, diminishing returns, multiplier derivation, trace generation, empty agent list

## Task Commits

1. **Task 1: Fiscal engine — budget execution and public goods quality** - `955311e` (feat)

**Plan metadata:** (pending — docs commit below)

## Files Created/Modified

- `server/src/mechanics/fiscalEngine.ts` — Pure fiscal engine: executeBudget, updatePublicGoodsQuality, getMultiplierEffects; FiscalDelta and MultiplierEffects interfaces
- `server/src/mechanics/__tests__/fiscal.test.ts` — 18 unit tests for fiscal engine covering all acceptance criteria

## Decisions Made

- SFC design: ALL four budget categories (infra/education/defense/welfare) distribute fiat equally to alive agents. Quality scores are side effects of spending, not stores of value. This ensures `treasuryDelta + Σ(agentPayments) = 0` in all non-empty-agent cases.
- Scale factor 0.264 chosen so that 25 fiat spending (default: 10% of 1000 treasury, 25% allocation) yields approximately 2.5 quality points gain. This calibration makes fiscal policy meaningful but not dominant.
- Empty agent list: treasury is still decremented (government overhead), payments map is empty. Handles edge case of society extinction without crashing.

## Deviations from Plan

None — plan executed exactly as written. The SFC revised design was already specified inline in the plan's action block.

## Issues Encountered

None — tests turned green on first implementation pass.

## Next Phase Readiness

- `fiscalEngine.ts` exports are ready for Plan 03-03 (simulationRunner integration)
- Plan 03-03 must: read active budget from fiscalRepo, call `executeBudget`, apply `agentPayments` to agent wealth deltas, persist `updatedPublicGoods` via fiscalRepo, inject `multiplierEffects` into physics engine stat calculations
- No blockers

---
*Phase: 03-fiscal-policy*
*Completed: 2026-04-01*
