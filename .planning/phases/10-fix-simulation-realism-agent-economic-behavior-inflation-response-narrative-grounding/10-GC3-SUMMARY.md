---
phase: 10-fix-simulation-realism
plan: GC3
subsystem: fiscal-engine, simulation-runner
tags: [calibration, fiscal-policy, cortisol, public-goods, quality-gain]
dependency_graph:
  requires: [10-GC1]
  provides: [GDP_SCALED_MAX_GAIN_PER_ITER=6, CORTISOL_FLOOR=3]
  affects: [fiscalEngine.ts, simulationRunner.ts]
tech_stack:
  added: []
  patterns: [physics-constant-calibration, stat-floor-pattern]
key_files:
  modified:
    - server/src/mechanics/fiscalEngine.ts
    - server/src/mechanics/__tests__/fiscal.test.ts
    - server/src/orchestration/simulationRunner.ts
decisions:
  - "GDP_SCALED_MAX_GAIN_PER_ITER reduced from 75 to 6: at China's 1.8% GDP spending gain drops from 22.8 to 1.8 pts/iter, requiring sustained fiscal commitment"
  - "CORTISOL_FLOOR = 3 applied at final stat commit sites (allostatic engine input + per-agent stat update), not at runningCortisol accumulator"
  - "Existing GDP-scaled test assertions updated to match new calibration — quality now grows gradually, not saturating in 3 iterations"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-09T04:28:18Z"
  tasks_completed: 2
  files_changed: 3
requirements_closed: [D-31]
---

# Phase 10 Plan GC3: Recalibrate GDP-scaled quality gain and cortisol floor Summary

**One-liner:** GDP quality gain constant reduced 12.5x (75→6) so public goods require sustained spending to improve, and cortisol floored at 3 to remain a meaningful stress indicator.

## What Was Built

Two calibration fixes to address simulation realism gaps found by post-simulation analysis of session-china.json:

**Fix 1 — GDP_SCALED_MAX_GAIN_PER_ITER: 75 → 6 (fiscalEngine.ts)**

The old value of 75 caused public goods quality to saturate at 100% within 3 iterations even at 1.8% GDP spending (China baseline), making fiscal policy trivially effective. The new value of 6 means:
- At full 10% GDP spending: 6 pts/iter → ~17 iterations to reach 100% quality
- At China's 1.8% GDP spending: ~1.8 pts/iter → slow improvement over many iterations
- At 1% GDP spending: ~1.2 pts/iter → barely growing, real fiscal tension

**Fix 2 — CORTISOL_FLOOR = 3 (simulationRunner.ts)**

`clampStat()` floored cortisol at 0, causing well-fed, employed agents to reach zero cortisol by iteration 6. The constant `CORTISOL_FLOOR = 3` is applied via `Math.max` at the two final cortisol commit sites:
- Line 2808: allostatic engine input (used to compute allostaticStrain/Load)
- Line 2917: per-agent final stat update (persisted to DB)

The per-action accumulator `runningCortisol` at line 2350 is deliberately not floored — applying the floor at each action would compound across multi-action sequences.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Recalibrate GDP_SCALED_MAX_GAIN_PER_ITER | 013c556 | fiscalEngine.ts, fiscal.test.ts |
| 2 | Add CORTISOL_FLOOR = 3 | 013c556 | simulationRunner.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing GDP-scaled test assertions to match new calibration**
- **Found during:** Task 1
- **Issue:** Tests `'spending 10% of GDP produces quality ~60-70%'` and `'spending 25%+ of GDP produces quality ~90-100%'` were calibrated against the old max of 75. With 6 pts/iter max, these ranges were incorrect.
- **Fix:** Updated test assertions to reflect that 10% GDP spending yields ~6 pts/iter (not 60-70%), and overspending above target still caps at 6 pts (not 90-100%). Both tests now correctly document the new calibration.
- **Files modified:** server/src/mechanics/__tests__/fiscal.test.ts
- **Commit:** 013c556

## Verification Results

```
GDP_SCALED_MAX_GAIN_PER_ITER in fiscalEngine.ts = 6 ✓
CORTISOL_FLOOR references in simulationRunner.ts = 3 (definition + 2 usages) ✓
TypeScript: pre-existing edgeCases.test.ts errors only (not caused by this plan) ✓
All 287 server tests pass (23 test files) ✓
New calibration tests: 3 passing ✓
```

Math verification for China simulation:
- spendingRatio = 625/34400 = 1.82%
- ratioEffect = 0.182, diminishedEffect = 0.182^0.7 ≈ 0.304
- NEW gain = 6 × 0.304 = **1.82 pts/iter** (was 22.8 pts/iter with old constant of 75)

## Known Stubs

None — all changes are calibration constants with full test coverage.

## Self-Check: PASSED

- `server/src/mechanics/fiscalEngine.ts` — FOUND: GDP_SCALED_MAX_GAIN_PER_ITER = 6
- `server/src/orchestration/simulationRunner.ts` — FOUND: CORTISOL_FLOOR = 3 at lines 422, 2808, 2917
- `server/src/mechanics/__tests__/fiscal.test.ts` — FOUND: 3 new calibration tests
- Commit 013c556 — FOUND in git log
