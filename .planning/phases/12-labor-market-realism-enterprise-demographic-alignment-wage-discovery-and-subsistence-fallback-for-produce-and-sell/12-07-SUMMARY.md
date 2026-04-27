---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: 07
subsystem: prompts, telemetry, db-schema, dashboard, labor-market
tags: [wave-3, closeout, prompts, telemetry, dashboard, D-16, D-17, D-19, D-20, D-21, sfc-invariant]
dependency_graph:
  requires:
    - "12-01: TelemetryLog Phase 12 fields, EnterpriseRecord.capacity/lastApplicants/lastVacancies"
    - "12-04: processWageAdjustment (ent.wage mutated in-place)"
    - "12-05: runApplyForJobMatching (matching pass + sessionReservationWages populated)"
    - "12-06: ammSubsistenceCalibrationFactor, PRODUCE_AND_SELL description rewritten"
  provides:
    - "server/src/llm/prompts/shared.ts: buildActionDictionary(overrides?) signature + buildEmploymentBoardSection(reservationWage?) + EmploymentBoardEntry.vacancies/workforce/capacity"
    - "server/src/llm/prompts/agent-intent.ts: D-17 wage override + D-19 reservation wage threading"
    - "server/src/orchestration/helpers/marketBoard.ts: buildEmploymentBoardEntries populates vacancies/workforce/capacity"
    - "server/src/db/schema.ts: macroSnapshots 8 new labor-market columns"
    - "server/src/db/migrate.ts: PRAGMA-guard ALTER TABLE for 8 new columns"
    - "server/src/db/repos/macroSnapshotRepo.ts: insertMacroSnapshot accepts 8 new fields"
    - "shared/src/types.ts: MacroSnapshot extended with 8 optional labor fields"
    - "server/src/orchestration/simulationRunner.ts: D-16 displacement counter + D-20 telemetry computation + reservationWage threading"
    - "web/src/components/EconomicDashboard.tsx: 4 new labor-market chart panels"
    - "server/src/orchestration/__tests__/laborSmoke.test.ts: 4 deterministic harness assertions replacing it.todo"
  affects:
    - "SSE iteration-complete events now include 8 labor-market telemetry fields"
    - "macroHistory in simulationStore surfacing new fields for dashboard rendering"
tech_stack:
  added: []
  patterns:
    - "buildActionDictionary(allowedActions?, overrides?) — D-17 per-agent wage interpolation at prompt build time"
    - "ActionSchema exported from shared.ts for typed override map"
    - "EmploymentBoardEntry.vacancies/workforce/capacity — augmented from EnterpriseRecord at board build time"
    - "PersonalStatusBoard.employerWage — threaded from enterprise registry via buildPersonalStatus"
    - "Deterministic TDD harness over processWageAdjustment + runApplyForJobMatching (no LLM/DB)"
    - "PRAGMA-guard ALTER TABLE migration (Phase 10/11 established pattern)"
key_files:
  created: []
  modified:
    - "server/src/llm/prompts/shared.ts"
    - "server/src/llm/prompts/agent-intent.ts"
    - "server/src/orchestration/helpers/marketBoard.ts"
    - "server/src/llm/__tests__/promptContent.test.ts"
    - "server/src/orchestration/simulationRunner.ts"
    - "server/src/db/schema.ts"
    - "server/src/db/migrate.ts"
    - "server/src/db/repos/macroSnapshotRepo.ts"
    - "shared/src/types.ts"
    - "web/src/components/EconomicDashboard.tsx"
    - "server/src/orchestration/__tests__/laborSmoke.test.ts"
decisions:
  - "D-17 wage interpolation passes employer's enterprise ID (not name) in WORK_AT_ENTERPRISE override — enterpriseId is available via PersonalStatusBoard.enterprise_id; name would require additional lookup"
  - "PersonalStatusBoard.employerWage added to carry enterprise wage into prompt builder without coupling agent-intent.ts to enterprise registry directly"
  - "insertMacroSnapshot uses inline IIFE lambdas for labor metrics to avoid ordering issues with the telemetry block (which runs after the snapshot insertion)"
  - "Deterministic harness passes 'as any' for EconomyConfig partial (required fields are not relevant to wage test behavior)"
  - "buildEmploymentBoardSection empty-state preserves reservation-wage line (renders even with no entries) — agents see their break-even even when no jobs are available"
  - "Task 4 (human-verify checkpoint) paused — browser visual verification requires live session"
metrics:
  duration: "~13 minutes"
  completed_date: "2026-04-27"
  tasks: 5
  files_modified: 11
---

# Phase 12 Plan 07: Final Wiring + Telemetry + Smoke Test Summary

Closeout plan: per-agent wage interpolation in action dictionary (D-17), augmented employment board with reservation wage and vacancy data (D-19), full 8-field labor-market telemetry persisted to macroSnapshots and emitted via SSE (D-20), 4 new EconomicDashboard chart panels (D-21), insolvency displacement counter (D-16), and a 20-iteration deterministic smoke test harness verifying convergence, SFC preservation, and displacement counting.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | buildActionDictionary override + D-17 wage interpolation + D-19 employment board | 627e2cc | shared.ts, agent-intent.ts, marketBoard.ts, promptContent.test.ts |
| 2 | Telemetry computation + macroSnapshots schema + SSE wiring + D-16 displacement counter | 0cb9cde | simulationRunner.ts, schema.ts, migrate.ts, macroSnapshotRepo.ts, types.ts |
| 3 | Frontend dashboard — 4 new chart surfaces (D-21) | 73fd9ab | EconomicDashboard.tsx |
| 4 | Live smoke test (checkpoint:human-verify) | — | Awaiting browser verification |
| 5 | Finalize laborSmoke.test.ts deterministic harness | a664614 | laborSmoke.test.ts |

## What Was Built

### Task 1 — D-17 Wage Interpolation + D-19 Employment Board

**`server/src/llm/prompts/shared.ts`:**
- `buildActionDictionary` gains optional 2nd parameter `overrides?: Partial<Record<ActionCode, ActionSchema>>`. The override replaces the static schema entry for any code, enabling per-agent dynamic descriptions.
- `ActionSchema` interface exported (was internal).
- `EmploymentBoardEntry` extended with `vacancies?: number; workforce?: number; capacity?: number`.
- `buildEmploymentBoardSection` gains optional `reservationWage?: number` parameter. When provided, prepends `"Your reservation wage (self-production break-even): X.X fiat"` at the top of the board. Each vacancy entry shows `workforce/capacity` and vacancies count.
- `PersonalStatusBoard` gains `employerWage?: number` field.

**`server/src/orchestration/helpers/marketBoard.ts`:**
- `buildEmploymentBoardEntries` now populates `vacancies`, `workforce`, `capacity` from `EnterpriseRecord`.
- `buildPersonalStatus` now reads `enterprise?.wage` from enterprise registry and populates `PersonalStatusBoard.employerWage`.

**`server/src/llm/prompts/agent-intent.ts`:**
- D-17: When `personalStatus.employed && employerWage` is set, builds `actionSchemaOverrides` with a personalized WORK_AT_ENTERPRISE description showing the actual posted wage.
- D-19: Passes `reservationWage` to `buildEmploymentBoardSection` (threaded from `sessionReservationWages` lookup with fallback).
- `buildNaturalIntentPrompt` gains `reservationWage?: number` as trailing optional parameter.

**simulationRunner.ts:** At the `buildNaturalIntentPrompt` call site, computes `reservationWageForAgent` from `sessionReservationWages` with fallback to `max(minimumWage × 0.5, 1)`.

**Tests:** `promptContent.test.ts` Phase 12 describe block — replaced 2 `it.todo` with real assertions. All 27 tests pass.

### Task 2 — D-16/D-20 Telemetry + DB Schema

**DB Schema + Migration:**
- `macroSnapshots` table gains 8 new nullable columns: `avg_posted_wage REAL`, `unemployment_rate REAL`, `reservation_wage_p25/p50/p75 REAL`, `vacancies_total INTEGER`, `applicants_total INTEGER`, `displaced_this_iteration INTEGER`.
- `migrate.ts` adds PRAGMA `table_info(macro_snapshots)` guard block — idempotent, runs twice = no-op.
- `MacroSnapshot` shared type extended with 8 optional nullable fields.

**macroSnapshotRepo.ts:** `insertMacroSnapshot` now accepts and persists all 8 new fields via conditional spread.

**simulationRunner.ts:**
- D-16: `let displacedThisIteration = 0` declared before bankruptcy block. Incremented at both release sites: paid workers released from registry (`displacedThisIteration++` after `employmentRegistry.delete`) AND the "Release ALL employees" loop for non-working staff.
- D-20: `applicantsTotalThisIter` captured from matching-pass block scope.
- D-20: At end of iteration, computes: `laborAvgPostedWage` (workforce-weighted), `laborUnemploymentRate`, `laborVacanciesTotal`, reservation wage quartiles (P25/P50/P75) from `sessionReservationWages` with floor fallback.
- `iterTelemetry` assignment includes all 8 new fields.
- `insertMacroSnapshot` call includes inline IIFE computations for labor metrics (avoids ordering dependency with telemetry block).
- `isEmployableAgent` imported from `helpers/isEmployableAgent.ts`.

### Task 3 — D-21 Dashboard Charts

4 new chart components appended to `EconomicDashboard.tsx`:
1. **`AvgWageChart`** — LineChart of workforce-weighted avg posted wage (`CHART_GREEN`). Shows wage convergence toward MRP.
2. **`UnemploymentChart`** — LineChart of unemployment % (`CHART_ORANGE`). Shows labor market clearing over iterations.
3. **`VacanciesApplicantsChart`** — Two-line LineChart of vacancies vs applicants (`CHART_BLUE` / `CHART_VIOLET`). Shows supply/demand equilibration.
4. **`DisplacedChart`** — LineChart with dots for bankruptcy displacement events (`CHART_RED`). Spikes only when enterprises go bankrupt.

All panels follow existing conventions: `sectionStyle`, 220px height, CSS theme tokens only (no hex literals), empty states when no data.

### Task 5 — Deterministic Harness

`laborSmoke.test.ts` — 4 new real assertions replacing `it.todo`:
- **L-05/L-06**: Starting wage 80 > MRP ceiling (agriculture sector, spot=6.0, MRP=58) → wage converges below 80 within 20 iters, stays ≥ minimum wage.
- **L-09/L-11**: With capacity > agentCount, unemployment ≤ 30% by iter 5 and sustained through iter 20.
- **SFC**: Total fiat (agent wealth + owner wealth) delta < 0.1 per iteration — wages are transfers, not creation.
- **D-16**: Simulated bankruptcy of 3-employee enterprise → `displacedThisIteration = 3`, employment registry empty, enterprise dissolved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] sector field must be 'agriculture' not 'food'**
- **Found during:** Task 5 test debugging
- **Issue:** Test initialized enterprise with `sector: 'food'` which is not a valid `EnterpriseSector`. The valid values are `'agriculture' | 'industry' | 'services' | 'government'`. `sectorToCommodity('food')` returns `undefined`, bypassing the MRP ceiling.
- **Fix:** Changed to `sector: 'agriculture'` which maps to `'food'` commodity, enabling the MRP ceiling test to work correctly.
- **Files modified:** `laborSmoke.test.ts`
- **Commit:** a664614

**2. [Rule 1 - Bug] Duplicate processWageAdjustment calls caused explosive wage growth**
- **Found during:** Task 5 test debugging
- **Issue:** Initial harness called `processWageAdjustment` twice per iteration (first for no-op, then for result). Since it mutates `ent.wage` in-place, the second call compounded the first.
- **Fix:** Removed the first call; pass `ent` directly by reference (not a shallow copy) to the single remaining call.
- **Files modified:** `laborSmoke.test.ts`
- **Commit:** a664614

**3. [Rule 2 - Missing critical] Inline IIFE for macroSnapshot labor fields**
- **Found during:** Task 2 integration
- **Issue:** `insertMacroSnapshot` is called inside the inflation block (~line 3318) which runs BEFORE the telemetry block (~line 3526) where `laborAvgPostedWage` etc. are computed. Referencing these variables before assignment would be a runtime error.
- **Fix:** Used inline IIFE lambdas inside the `insertMacroSnapshot` call to recompute the labor metrics at insertion time. Slightly redundant but eliminates ordering dependency.
- **Files modified:** `simulationRunner.ts`
- **Commit:** 0cb9cde

## Verification Checks

- `npx tsc --noEmit -p shared/tsconfig.json` — PASS (0 errors)
- `npx tsc --noEmit -p server/tsconfig.json` — PASS (0 errors)
- `npx tsc --noEmit -p web/tsconfig.json` — PASS (0 errors)
- `npm run build -w web` — PASS (builds clean)
- `npm run test -w server` — 588 passed | 8 todo | 0 failures
- `npx vitest run server/src/llm/__tests__/promptContent.test.ts` — 27 passed | 0 todo
- `npx vitest run server/src/orchestration/__tests__/laborSmoke.test.ts` — 6 passed | 0 todo
- SFC: D-16 displacement counter is read-only aggregate, no fiat paths touched; telemetry derivation is read-only
- Task 4 (live visual): PAUSED at checkpoint — awaiting browser verification

## Known Stubs

None. All 8 TelemetryLog labor-market fields are populated each iteration and emitted via SSE. The macroSnapshots schema accepts and persists all 8 fields. The dashboard renders all 4 panels with proper empty states. The `ammSubsistenceCalibrationFactor` remains at DEFAULT=1.0 (policy knob per 12-06 decision — not forced default).

## Self-Check: PASSED

Files modified:
- server/src/llm/prompts/shared.ts — EXISTS
- server/src/llm/prompts/agent-intent.ts — EXISTS
- server/src/orchestration/helpers/marketBoard.ts — EXISTS
- server/src/llm/__tests__/promptContent.test.ts — EXISTS
- server/src/orchestration/simulationRunner.ts — EXISTS
- server/src/db/schema.ts — EXISTS
- server/src/db/migrate.ts — EXISTS
- server/src/db/repos/macroSnapshotRepo.ts — EXISTS
- shared/src/types.ts — EXISTS
- web/src/components/EconomicDashboard.tsx — EXISTS
- server/src/orchestration/__tests__/laborSmoke.test.ts — EXISTS

Commits:
- 627e2cc — Task 1 (D-17 + D-19)
- 0cb9cde — Task 2 (D-16 + D-20)
- 73fd9ab — Task 3 (D-21 dashboard)
- a664614 — Task 5 (laborSmoke harness)
