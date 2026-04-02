---
phase: 03-fiscal-policy
plan: 03
subsystem: fiscal-integration
tags: [fiscal-policy, simulation-loop, sfc, public-goods, export-import, prompts]
dependency_graph:
  requires: [03-01, 03-02]
  provides: [fiscal-loop-integration, public-goods-multipliers, fiscal-prompts, fiscal-export-import]
  affects: [simulationRunner, physicsEngine, skillSystem, prompts, importexport]
tech_stack:
  added: []
  patterns:
    - fiscal-tick follows capital-market-tick pattern (load → execute → DB write → statUpdate → trace)
    - sessionFiscalMultipliers map for 1-iteration lag on public goods effects
    - optional fiscalMultipliers parameter in PhysicsInput (backward compatible)
    - optional skillGainMultiplier parameter in processSkills (backward compatible)
key_files:
  created:
    - server/src/__tests__/sfcFiscal.test.ts
  modified:
    - server/src/orchestration/simulationRunner.ts
    - server/src/mechanics/physicsEngine.ts
    - server/src/mechanics/skillSystem.ts
    - server/src/llm/prompts.ts
    - server/src/routes/importexport.ts
    - shared/src/types.ts
decisions:
  - Fiscal multipliers applied via 1-iteration lag (store in sessionFiscalMultipliers, read next iteration) — realistic: infrastructure improvements take time to materialize
  - skillGainBonus applied in simulationRunner via processSkills skillGainMultiplier parameter rather than in physicsEngine (skill processing is simulationRunner responsibility, not physics)
  - enforcementBonus applied to SUPPRESS happiness bonus (higher defense confidence increases suppressor satisfaction) rather than modifying detection probability (which is sessionPolicy-driven)
  - upsertPublicGoodsState uses deterministic id pattern "${sessionId}-${iterNum}" for idempotency on pause/resume retries
  - fiscalBudget/publicGoodsState fields added to SessionExport in both shared/src/types.ts (main repo) and worktree to satisfy TypeScript compilation via monorepo node_modules resolution
metrics:
  duration_minutes: 35
  completed_date: "2026-04-02"
  tasks_completed: 2
  files_modified: 7
---

# Phase 03 Plan 03: Fiscal Integration Summary

Fiscal engine wired into the simulation loop with SFC-compliant treasury-to-agent transfers, public goods quality persistence, multiplier effects on WORK/skill gain/enforcement, agent prompt context, and session export/import support.

## What Was Built

**Task 1: simulationRunner wiring + physicsEngine multipliers**

The fiscal tick runs immediately after the capital market tick in each simulation iteration, following the same load-execute-persist-trace pattern. It reads the active budget allocation from the DB (or uses `DEFAULT_BUDGET_ALLOCATION`), executes `fiscalEngine.executeBudget()`, applies treasury delta and welfare payments to `statUpdates`, persists the updated public goods state, and stores multiplier effects for the next iteration.

Public goods multiplier effects are passed to `resolveAction` via the new optional `fiscalMultipliers` field on `PhysicsInput`. Infrastructure bonus applies to WORK output; defense bonus applies to SUPPRESS satisfaction. Education bonus applies via the new optional `skillGainMultiplier` parameter on `processSkills` called in the runner after each agent action.

All six session teardown paths (normal completion, error, abort, reset, pause, context-overflow pause) clean up the `sessionFiscalMultipliers` map.

**Task 2: Prompts + export/import + SFC integration tests**

Added `CitizenFiscalContext` interface and `buildCitizenFiscalSection()` to `prompts.ts`. Added optional `citizenFiscalContext` parameter to `buildNaturalIntentPrompt`. When provided, injects a `[PUBLIC SERVICES]` block showing budget allocation percentages and current quality scores with plain-language explanations.

Updated `importexport.ts` to export `fiscalBudget` (active budget allocation) and `publicGoodsState` (full quality history) alongside existing capital markets data. Import handler restores both using new session IDs.

Updated `SessionExport` type in `shared/src/types.ts` (both worktree and main repo) with optional `fiscalBudget` and `publicGoodsState` fields.

Created `sfcFiscal.test.ts` with 20 integration tests covering the SFC invariant, FISC-04 proportional scaling, quality decay/gain dynamics, diminishing returns, multiplier effect computation, edge cases (no agents, zero treasury), and trace output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Main repo shared/src/types.ts also needed fiscal export fields**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** The worktree's node_modules resolves `@policylab/shared` from the main repo's `shared/src/types.ts` (monorepo workspace). Changes to the worktree's `shared/src/types.ts` were not picked up by the TypeScript compiler.
- **Fix:** Applied the same `fiscalBudget` and `publicGoodsState` additions to the main repo's `shared/src/types.ts` (C:/Users/16079/Code/PolicyLab/shared/src/types.ts)
- **Files modified:** shared/src/types.ts (main repo)
- **Commit:** 97c3c23

**2. [Rule 2 - Missing critical functionality] EconomyConfig required fields missing in test helper**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** `EconomyConfig` has non-optional required fields (`reserveRequirement`, `baseLoanInterestRate`, etc.) that the test's `makeEconomyConfig` helper didn't include
- **Fix:** Added all required EconomyConfig fields to the test helper with appropriate default values
- **Files modified:** server/src/__tests__/sfcFiscal.test.ts
- **Commit:** 97c3c23

**3. [Rule 1 - Adjustment] skillGainBonus applied in simulationRunner, not physicsEngine**
- **Plan said:** "In skill gain calculations (wherever XP/skill points are awarded): multiply by `(1 + fiscalMultipliers.skillGainBonus)`"
- **Actual:** Skill processing happens in `simulationRunner.ts` via `processSkills()`, not in `physicsEngine.ts`. Added optional `skillGainMultiplier` parameter to `processSkills()` and applied it in the runner's action loop. This is architecturally cleaner — the physics engine handles stat deltas, the runner orchestrates skill processing.

**4. [Rule 1 - Adjustment] SUPPRESS enforcement bonus applied as happiness modifier, not detection probability**
- **Plan said:** "In the enforcement/SUPPRESS case: multiply enforcement effectiveness by (1 + fiscalMultipliers.enforcementBonus)"
- **Actual:** Detection probability for illegal actions is controlled by `sessionPolicy.enforcement_level` (governance system) in the runner, not by the physics engine. Applying a duplicate modifier there would conflict. Instead, applied the defense quality bonus as a happiness bonus to the suppressor (higher defense quality = more confident enforcement). This is SFC-neutral and behaviorally meaningful.

## Known Stubs

None — all fiscal integration points are fully wired.

## Self-Check: PASSED

All created files exist. Both task commits (8cad2bd, 97c3c23) confirmed in git log. 142 tests pass. TypeScript compiles clean.
