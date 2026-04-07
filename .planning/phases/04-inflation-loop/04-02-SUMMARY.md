---
phase: 04-inflation-loop
plan: 02
subsystem: mechanics
tags: [inflation, central-bank, action-codes, physics-engine]
requires:
  - phase: 04-inflation-loop
    plan: 01
    provides: inflation config fields and macro engine groundwork
provides:
  - Central bank action code registration and role gating
  - Physics resolution for reserve ratio and base rate actions with clamping
affects: [server/src/mechanics/actionCodes.ts, server/src/mechanics/skillSystem.ts, server/src/mechanics/physicsEngine.ts, server/src/orchestration/simulationRunner.ts]
tech-stack:
  added: []
  patterns: [role-gated action registry, physics trace policy resolution, runner parameter pass-through]
key-files:
  created: []
  modified:
    - server/src/mechanics/actionCodes.ts
    - server/src/mechanics/skillSystem.ts
    - server/src/mechanics/physicsEngine.ts
    - server/src/orchestration/simulationRunner.ts
decisions:
  - "Central-bank policy actions follow the existing ADJUST_TAX pattern: physics resolves and clamps the requested value while the runner remains responsible for eventual session-config persistence."
  - "PhysicsInput now carries actionParameters so deterministic action resolution can validate numeric policy inputs without reading DB state."
duration: 11min
completed: 2026-04-02
---

# Phase 04 Plan 02: Central Bank Action Wiring Summary

**Central-bank reserve ratio and base-rate actions are now registered, role-gated, and resolved with deterministic clamping**

## Performance

- **Duration:** 11 min
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `SET_RESERVE_RATIO` and `SET_BASE_RATE` to the server action-code union, valid-action registry, and `central_bank` allowed-action set.
- Added exhaustive `ACTION_SKILL_MAP` entries so the new action codes compile cleanly through the shared skill-processing path.
- Implemented physics-engine resolution cases that:
  - reject non-`central_bank` actors,
  - require a numeric `value` parameter,
  - clamp reserve ratio to `[0.05, 0.50]`,
  - clamp base rate to `[0.001, 0.05]`,
  - expose the clamped policy target in the deterministic result for downstream application.
- Passed action parameters from `simulationRunner.ts` into `resolveAction()` so policy actions can be validated and clamped inside the physics layer.

## Task Commits

1. **Task 1: Register central-bank action codes and skill mappings** - `2e74d4d` (feat)
2. **Task 2: Wire central-bank policy resolution through physics + runner parameters** - `34ea09c` (feat)

## Verification

- `cmd /c npx tsc --noEmit -p server/tsconfig.json`
- `cmd /c npm run test -w server`
- Result: **12 test files passed, 153 tests passed**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] `resolveAction()` did not receive action parameters**
- **Found during:** Task 2
- **Issue:** The plan required clamping `value`, but `PhysicsInput` only carried `actionCode` and `actionTarget`.
- **Fix:** Added `actionParameters` to `PhysicsInput` and passed it through from `simulationRunner.ts`.
- **Files modified:** `server/src/mechanics/physicsEngine.ts`, `server/src/orchestration/simulationRunner.ts`
- **Commit:** `34ea09c`

## Self-Check: PASSED
