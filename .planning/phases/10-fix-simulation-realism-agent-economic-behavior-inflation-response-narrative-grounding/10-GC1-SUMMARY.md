---
phase: 10-fix-simulation-realism
plan: GC1
subsystem: enterprise-employment
tags: [bug-fix, db-schema, enterprise, employment-registry, simulation-runner]
requires: []
provides: [enterprise-employees-persisted, employment-registry-populated]
affects: [simulation-runner, bootstrap-pipeline, enterprise-repo]
tech-stack-added: []
tech-stack-patterns: [ALTER TABLE guard, JSON column round-trip, registry population at init]
key-files-created: []
key-files-modified:
  - server/src/db/schema.ts
  - server/src/db/index.ts
  - server/src/db/repos/enterpriseRepo.ts
  - server/src/data/dataBootstrapPipeline.ts
  - server/src/routes/bootstrap.ts
  - server/src/orchestration/simulationRunner.ts
  - server/src/data/__tests__/enterpriseBootstrap.test.ts
decisions:
  - "ALTER TABLE guard pattern for additive column additions to existing SQLite DBs (no migration runner)"
  - "Optional nameToId param on generateEnterprises preserves backward compat for tests using agent names"
  - "Employment registry populated at enterprise init block (iteration 1) so buildPersonalStatus finds jobs immediately"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-09T04:21:05Z"
  tasks-completed: 4
  files-modified: 7
  tests-added: 3
  tests-total: 280
---

# Phase 10 Plan GC1: Fix Enterprise Employment System — Summary

## One-liner

Wired the enterprise employment system end-to-end: DB schema now persists employee UUID arrays, simulationRunner populates sessionEmploymentRegistry at init, and agents see their employer in every turn context.

## Problem Fixed

The China simulation showed every agent as unemployed despite the bootstrap pipeline generating enterprise blueprints with employee lists. The root cause was a 4-link chain of broken wiring:

1. `schema.ts` enterprises table had no `employees` column — never added
2. `enterpriseRepo.insertEnterprise` did not persist `blueprint.employees`
3. `enterpriseRepo.getEnterprises` hard-coded `employees: []` on every returned blueprint
4. `simulationRunner.ts` loaded blueprints with empty employees, built enterprise registry with empty `Set`s, and never called `employmentReg.set(...)` — so `buildPersonalStatus()` found no employment record for any agent and told every agent "You are currently unemployed"

**Result of bug:** All 50 citizen agents subsisted via PRODUCE only. Zero wages, zero enterprise production, zero banking demand from enterprise payroll.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Add `employees TEXT NOT NULL DEFAULT '[]'` column to enterprises table; ALTER TABLE guard in db/index.ts; update repo insert + get | a47f5cd |
| 2 | Add optional `agentNameToId` param to `generateEnterprises`; simplify bootstrap.ts to pass map directly | a47f5cd |
| 3 | Populate `sessionEmploymentRegistry` inside enterprise init block in simulationRunner.ts | a47f5cd |
| 4 | Add 3 new tests: UUID resolution, name fallback, JSON round-trip | a47f5cd |

## Changes Made

### server/src/db/schema.ts
Added `employees: text('employees').notNull().default('[]')` column to the `enterprises` table definition.

### server/src/db/index.ts
Added an idempotent `ALTER TABLE enterprises ADD COLUMN employees TEXT NOT NULL DEFAULT '[]'` guard using `better-sqlite3` `.prepare().run()`. Wrapped in try/catch so it silently skips if column already exists. This pattern handles existing user DBs without a migration runner.

### server/src/db/repos/enterpriseRepo.ts
- `insertEnterprise`: now includes `employees: JSON.stringify(blueprint.employees ?? [])` in the insert values
- `getEnterprises`: now parses `row.employees` with `JSON.parse` in a try/catch block, returning `[]` on malformed data

### server/src/data/dataBootstrapPipeline.ts
Added optional `agentNameToId?: Map<string, string>` parameter to `generateEnterprises`. When provided, both `ownerId` and all employee entries use UUID lookup via the map, falling back to the agent name for backward compatibility (existing tests pass agent names directly).

### server/src/routes/bootstrap.ts
Simplified the enterprise generation block: now passes the existing `agentNameToId` map directly to `generateEnterprises` instead of mutating `bp.ownerId` and `bp.employees` post-hoc. The for-loop over blueprints now just calls `insertEnterprise(id, bp)` with no additional resolution needed.

### server/src/orchestration/simulationRunner.ts
Inside the `existingRegistry.size === 0 && entConfig.bankingEnabled` block:
- Calls `getEmploymentRegistry(sessionId)` once before the blueprint loop
- Resolves each employee entry by ID first, then by name (legacy support), filtering out nulls
- Calls `employmentReg.set(employeeId, EmploymentRecord)` for each resolved employee with `startedAt: 1`
- Uses `resolvedOwnerId` (owner UUID) for both the enterprise registry and employment records

## Deviations from Plan

### Auto-simplified Task 2

**Found during:** Task 2
**Issue:** `bootstrap.ts` already had post-hoc name-to-UUID resolution logic (lines 434-439), making it redundant once `generateEnterprises` accepts the map directly.
**Fix:** Removed the post-hoc mutation loop; the `generateEnterprises` call now handles resolution in one step.
**Files modified:** `server/src/routes/bootstrap.ts`
**Commit:** a47f5cd

## Known Stubs

None — all enterprise employees are now persisted as UUIDs and loaded into the employment registry on simulation start.

## Self-Check: PASSED

- `server/src/db/schema.ts` employees column: present at line 296
- `server/src/db/repos/enterpriseRepo.ts` JSON.stringify call: present at line 29
- `server/src/orchestration/simulationRunner.ts` employmentReg.set call: present at line 1318
- `getEmploymentRegistry` call count in simulationRunner.ts: 5 (existing 4 + 1 new in init block)
- Commit a47f5cd: exists in git log
- All 280 server tests pass
