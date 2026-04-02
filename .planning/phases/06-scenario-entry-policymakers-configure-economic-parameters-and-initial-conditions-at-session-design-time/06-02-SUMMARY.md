---
phase: 06-scenario-entry
plan: 02
subsystem: fork-endpoint, comparison-route, shared-types
tags: [fork, comparison, economy-config, param-diff, telemetry]
dependency_graph:
  requires: [06-00]
  provides: [fork-preserves-economy-config, economy-param-diff-comparison, comparison-telemetry]
  affects: [server/src/routes/sessions.ts, server/src/routes/compare.ts, shared/src/types.ts]
tech_stack:
  added: []
  patterns: [deterministic-param-diff, session-config-cloning, telemetry-extraction]
key_files:
  created:
    - server/src/__tests__/scenarioEntry.test.ts
  modified:
    - server/src/routes/sessions.ts
    - shared/src/types.ts
    - server/src/routes/compare.ts
decisions:
  - Fork config uses conditional spread to preserve economyConfig/budgetAllocation only when present — avoids polluting new sessions with stale defaults
  - computeParamDiffs is deterministic (no LLM) — diffing is structural comparison of EconomyConfig keys, not narrative generation
  - EconomyParamDiff is optional on ComparisonResult for backward compatibility with stored comparisons that predate this plan
  - fiscalRepo.createBudget used for budget cloning — reuses the existing upsert/create pattern without duplicating logic
metrics:
  duration_minutes: 15
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_changed: 4
---

# Phase 06 Plan 02: Fork + Comparison Param-Diff Infrastructure Summary

**One-liner:** Fork endpoint clones economyConfig/budgetAllocation from source session; comparison route extracts economic telemetry and computes deterministic EconomyParamDiff list.

## What Was Built

### Task 1: Fork Endpoint Upgrade (server/src/routes/sessions.ts)

The `POST /:id/fork` handler now:
1. Parses `source.config` JSON to extract `economyConfig` and `budgetAllocation`.
2. Spreads both into the new session's config JSON when present (conditional spread — sessions without economic config are unaffected).
3. Clones the fiscal budget DB record via `fiscalRepo.createBudget(newId, sourceBudget)` when the source had a `budgetAllocation`.

The `fork-simulation` endpoint was explicitly left untouched per plan scope.

### Task 2: EconomyParamDiff Type + Comparison Route Upgrade

**shared/src/types.ts:**
- Added `EconomyParamDiff` interface with `param`, `label`, `session1Value`, `session2Value` fields.
- Extended `ComparisonResult` with optional `economyParamDiffs?: EconomyParamDiff[]` field (D-08).

**server/src/routes/compare.ts:**
- `loadSessionSummary` now extracts economic telemetry from the last iteration's `statistics` JSON: `giniCoefficient`, `m1`, `loansOutstanding`, `infrastructureQuality`, `educationQuality`, `defenseQuality`, `welfareQuality`.
- `loadSessionSummary` now extracts `economyConfig` from the session's config JSON.
- Added `PARAM_LABELS` map (23 keys) for human-readable parameter display.
- Added `computeParamDiffs(config1, config2)` — deterministic structural diff that skips non-numeric/non-boolean values and uses PARAM_LABELS for display labels.
- `POST /api/compare` now computes `economyParamDiffs` and includes it in the `ComparisonResult` response (omitted when empty).

### Test Coverage (server/src/__tests__/scenarioEntry.test.ts)

16 tests across 4 describe blocks:
- Fork config construction: 6 tests (preserves economyConfig, preserves budgetAllocation, handles null/malformed source, omits fields when absent)
- computeParamDiffs: 6 tests (identical configs, changed numeric, changed boolean, multiple diffs, unknown key label, empty configs)
- EconomyParamDiff type shape: 2 tests (number values, boolean values)
- ComparisonResult accepts economyParamDiffs: 2 tests (backward compat without field, with field present)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data paths are wired. `economyConfig` is extracted from real session config; telemetry is extracted from real iteration statistics. If a session has no economic config or no iterations, the fields return `undefined`/`{}` which the UI must handle gracefully (expected behavior for pre-simulation sessions).

## Self-Check: PASSED

Files verified present:
- server/src/routes/sessions.ts — contains `sourceConfig.economyConfig` spread
- shared/src/types.ts — contains `EconomyParamDiff` interface
- server/src/routes/compare.ts — contains `computeParamDiffs`, `economyParamDiffs`
- server/src/__tests__/scenarioEntry.test.ts — 16 tests, all passing

Commits verified:
- 684d18a: feat(06-02): upgrade fork endpoint to preserve economyConfig and budgetAllocation
- 8172040: feat(06-02): add EconomyParamDiff type and upgrade comparison route with telemetry and param diff

Build: passes (npm run build exits 0)
Tests: 16/16 passing (npx vitest run server/src/__tests__/scenarioEntry.test.ts)
