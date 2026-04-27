---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: 01
subsystem: shared-types, simulation-state, db-schema, test-scaffolds
tags: [wave-0, scaffolding, types, db-migration, test-todos, labor-market]
dependency_graph:
  requires: []
  provides:
    - "shared/src/types.ts: EconomyConfig Phase 12 fields, EnterpriseBlueprint.capacity, TelemetryLog Phase 12 fields"
    - "server/src/orchestration/simulationState.ts: EnterpriseRecord.capacity/lastApplicants/lastVacancies, sessionReservationWages, sessionQuitLastIteration"
    - "server/src/db/schema.ts: enterprises.capacity, enterprises.last_applicants, enterprises.last_vacancies"
    - "server/src/db/migrate.ts: idempotent PRAGMA-guard ALTER TABLE for 3 enterprise columns"
    - "server/src/db/repos/enterpriseRepo.ts: capacity read/write with legacy-zero coercion"
    - "4 new test scaffold files with it.todo placeholders"
    - "2 extended test files with Phase 12 describe blocks"
  affects:
    - "server/src/orchestration/simulationRunner.ts (EnterpriseRecord construction patched)"
    - "server/src/orchestration/enterpriseActionDispatch.ts (EnterpriseRecord construction patched)"
tech_stack:
  added: []
  patterns:
    - "PRAGMA table_info guard for idempotent SQLite ALTER TABLE (established Phase 10)"
    - "sessionXXX Map pattern from simulationState.ts (following sessionPreviousWageCosts precedent)"
    - "Optional EconomyConfig field extension with DEFAULT_ECONOMY_CONFIG defaults"
    - "TelemetryLog optional-field extension (Phase 11 pattern)"
key_files:
  created:
    - "server/src/mechanics/__tests__/laborMarket.test.ts"
    - "server/src/data/__tests__/enterpriseGeneration.test.ts"
    - "server/src/orchestration/__tests__/matchingPass.test.ts"
    - "server/src/orchestration/__tests__/laborSmoke.test.ts"
  modified:
    - "shared/src/types.ts"
    - "server/src/orchestration/simulationState.ts"
    - "server/src/orchestration/simulationRunner.ts"
    - "server/src/orchestration/enterpriseActionDispatch.ts"
    - "server/src/db/schema.ts"
    - "server/src/db/migrate.ts"
    - "server/src/db/repos/enterpriseRepo.ts"
    - "server/src/mechanics/__tests__/sfcInvariant.test.ts"
    - "server/src/llm/__tests__/promptContent.test.ts"
decisions:
  - "capacity field is required (not optional) on EnterpriseRecord so the type system enforces presence at all construction sites; bootstrap defaults to max(employees+1, 20) when blueprint.capacity is absent"
  - "getEnterprises returns capacity in EnterpriseBlueprint so simulationRunner load path gets the persisted value; legacy-zero coercion adds console.warn for observability"
  - "sessionReservationWages and sessionQuitLastIteration use the Map<sessionId, Map/Set<agentId>> pattern matching sessionPreviousWageCosts — avoids any per-iteration DB reads"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-27"
  tasks: 4
  files_modified: 11
---

# Phase 12 Plan 01: Wave 0 Foundation — Shared Types, DB Schema, In-Memory State, Test Scaffolds Summary

Wave 0 foundation: additive scaffolding for 4 EconomyConfig tunables, EnterpriseBlueprint.capacity, 8 TelemetryLog labor-market fields, 3 enterprise DB columns with idempotent migration guard, 2 new session Maps with cleanup, and 4 vitest scaffold files with it.todo placeholders — zero behavioral change, all new fields optional or initialized with safe defaults.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extend shared types (EconomyConfig, EnterpriseBlueprint, TelemetryLog) | 7eddb7a | shared/src/types.ts |
| 2 | Extend simulationState (EnterpriseRecord + 2 Maps + cleanup) | 2563ae1 | simulationState.ts, simulationRunner.ts, enterpriseActionDispatch.ts |
| 3 | DB schema + migration + enterpriseRepo for 3 new columns | fbc9177 | schema.ts, migrate.ts, enterpriseRepo.ts |
| 4 | Create 4 test scaffolds + extend 2 existing test files | b5af36d | 6 test files |

## What Was Built

### Task 1 — Shared types extension

Added to `shared/src/types.ts` without reordering any existing fields:

- **EconomyConfig Phase 12 block**: `laborWageNudgeK` (0.03), `laborWageProfitShareAlpha` (0.15), `defaultPerWorkerInputCost` (2), `ammSubsistenceCalibrationFactor` (1.0) — all optional with defaults in `DEFAULT_ECONOMY_CONFIG`.
- **EnterpriseBlueprint.capacity**: optional `number` field so bootstrap can pass it without breaking any existing caller.
- **TelemetryLog Phase 12 block**: 8 optional fields — `avgPostedWage`, `unemploymentRate`, `reservationWageP50/P25/P75`, `vacanciesTotal`, `applicantsTotal`, `displacedThisIteration`.

### Task 2 — simulationState extension

- **EnterpriseRecord** gained 3 required fields: `capacity: number`, `lastApplicants: number`, `lastVacancies: number`.
- Two new exports: `sessionReservationWages: Map<string, Map<string, number>>` and `sessionQuitLastIteration: Map<string, Set<string>>`.
- `cleanupSessionState` extended to delete both new Maps.
- Two construction sites patched: `simulationRunner.ts` (load path) and `enterpriseActionDispatch.ts` (FOUND_ENTERPRISE action) now provide default values for the three new fields.

### Task 3 — DB + migration + repo

- `enterprises` table in `schema.ts` gains `capacity`, `last_applicants`, `last_vacancies` (all NOT NULL with safe defaults).
- `migrate.ts` adds PRAGMA `table_info(enterprises)` guard before each ALTER TABLE — running migrations twice is a no-op.
- `enterpriseRepo.insertEnterprise` writes all three fields; `getEnterprises` reads `capacity` with legacy-zero coercion and a `console.warn` for observability (12-RESEARCH §8 risk mitigation).

### Task 4 — Test scaffolds

4 new files created:
- `laborMarket.test.ts` — 13 todos covering L-04..L-07, L-11
- `enterpriseGeneration.test.ts` — 7 todos covering L-01..L-03, D-07
- `matchingPass.test.ts` — 9 todos covering L-09, L-10, D-03, D-16, SFC
- `laborSmoke.test.ts` — 5 todos for 10-iteration smoke test

2 existing files extended with appended Phase 12 describe blocks:
- `sfcInvariant.test.ts` — 3 todos for wage adjustment SFC invariants
- `promptContent.test.ts` — 3 todos for prompt wage interpolation

**Test results: 528 passed | 40 todos | 0 failures** (all pre-existing tests still green).

## Deviations from Plan

None — plan executed exactly as written.

The only non-plan decision was the exact implementation of the legacy-zero guard in `getEnterprises`: the plan said "coerce to max(employees.length, 20)" and the implementation uses `max(employees.length, 20)` with `console.warn` exactly as specified in 12-RESEARCH §8.

## Verification Checks

- `npx tsc --noEmit -p shared/tsconfig.json` — PASS (zero errors)
- `npx tsc --noEmit -p server/tsconfig.json` — PASS (zero errors)
- `npm run test -w server` — 528 passed, 40 todos, 0 failures
- `grep capacity|lastApplicants|lastVacancies simulationState.ts` — all 3 fields present on EnterpriseRecord
- `grep sessionReservationWages|sessionQuitLastIteration simulationState.ts` — both Maps exported and cleaned up
- `grep laborWageNudgeK|ammSubsistenceCalibrationFactor shared/src/types.ts` — EconomyConfig extended
- SFC invariant: N/A — this plan is declaration-only, no fiat paths touched

## Known Stubs

None. This plan is scaffold-only — no production behavior was introduced. All todos are tracked in the 6 test files for downstream plans (12-02 through 12-07) to implement.

## Self-Check: PASSED

Files created/modified:

- shared/src/types.ts — EXISTS
- server/src/orchestration/simulationState.ts — EXISTS
- server/src/orchestration/simulationRunner.ts — EXISTS
- server/src/orchestration/enterpriseActionDispatch.ts — EXISTS
- server/src/db/schema.ts — EXISTS
- server/src/db/migrate.ts — EXISTS
- server/src/db/repos/enterpriseRepo.ts — EXISTS
- server/src/mechanics/__tests__/laborMarket.test.ts — EXISTS
- server/src/data/__tests__/enterpriseGeneration.test.ts — EXISTS
- server/src/orchestration/__tests__/matchingPass.test.ts — EXISTS
- server/src/orchestration/__tests__/laborSmoke.test.ts — EXISTS
- server/src/mechanics/__tests__/sfcInvariant.test.ts — EXISTS
- server/src/llm/__tests__/promptContent.test.ts — EXISTS

Commits:
- 7eddb7a — Task 1 (shared types)
- 2563ae1 — Task 2 (simulationState)
- fbc9177 — Task 3 (DB schema/migration/repo)
- b5af36d — Task 4 (test scaffolds)
