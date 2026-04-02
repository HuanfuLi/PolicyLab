---
phase: 03-fiscal-policy
plan: 01
subsystem: database
tags: [drizzle, sqlite, typescript, fiscal-policy, public-goods, economy-config]

# Dependency graph
requires:
  - phase: 02-capital-markets
    provides: schema.ts pattern for new table additions, bankingRepo/capitalMarketsRepo CRUD patterns
  - phase: 01-banking-foundation
    provides: EconomyConfig type structure, DEFAULT_ECONOMY_CONFIG, db/index.ts imports

provides:
  - BudgetAllocation interface in shared types (4 spending category fractions)
  - PublicGoodsState interface in shared types (per-iteration quality scores)
  - EconomyConfig fiscal tuning fields (7 optional fields, all backward-compatible)
  - DEFAULT_BUDGET_ALLOCATION and DEFAULT_PUBLIC_GOODS_INITIAL exported constants
  - fiscal_budgets DB table with migration
  - public_goods_state DB table with migration
  - fiscalRepo.ts with full CRUD (upsertBudget, getActiveBudget, upsertPublicGoodsState, getPublicGoodsState, getPublicGoodsStateBySession, deleteBySession)

affects: [03-02-fiscal-engine, 03-03-simulation-wiring, 06-scenario-entry]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fiscal tables follow Capital Markets Phase 2 schema.ts pattern (sqliteTable with FK cascade)"
    - "fiscalRepo follows bankingRepo drizzle pattern: rowTo* helpers, eq/sql imports, typed returns"
    - "Budget allocation: one-per-session upsert pattern (check existing, update or insert)"
    - "Public goods: per-iteration rows, getPublicGoodsState returns highest iterationNumber"

key-files:
  created:
    - server/src/db/repos/fiscalRepo.ts
  modified:
    - shared/src/types.ts
    - server/src/db/schema.ts
    - server/src/db/migrate.ts

key-decisions:
  - "EconomyConfig fiscal fields all optional — fiscalEnabled remains absent/falsy in DEFAULT_ECONOMY_CONFIG so existing sessions unaffected"
  - "Budget allocation stored as one-per-session record (not per-iteration) — design-time config per FISC-01"
  - "Public goods state stored per-iteration to allow trend analysis and session export"
  - "fiscalRepo has zero physics-engine logic — pure data layer, fiscal engine (Plan 02) will use it"

patterns-established:
  - "Fiscal budget: upsert by sessionId check (not by id) — only one active budget per session"
  - "Public goods latest: ORDER BY iteration_number DESC LIMIT 1 pattern"

requirements-completed: [FISC-01, FISC-04]

# Metrics
duration: 18min
completed: 2026-04-01
---

# Phase 3 Plan 01: Fiscal Policy Types, Schema, and Repository Summary

**BudgetAllocation and PublicGoodsState types with 7 EconomyConfig fiscal extensions, two new SQLite tables with migrations, and fiscalRepo providing full CRUD for budget allocations and public goods quality state**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-01T23:11:00Z
- **Completed:** 2026-04-01T23:29:00Z
- **Tasks:** 2
- **Files modified:** 4 (1 created)

## Accomplishments

- BudgetAllocation and PublicGoodsState types established in shared package — importable by both server and web
- EconomyConfig extended with 7 fiscal tuning fields (budgetSpendingRate, 4 multipliers, decay rate, diminishing returns exponent) — all optional, backward-compatible, with sensible defaults in DEFAULT_ECONOMY_CONFIG
- fiscal_budgets and public_goods_state tables created via idempotent migration with proper indexes
- fiscalRepo.ts provides upsertBudget, getActiveBudget, upsertPublicGoodsState, getPublicGoodsState, getPublicGoodsStateBySession, deleteBySession — following established bankingRepo drizzle patterns
- All 104 existing tests pass unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared types + EconomyConfig extensions for fiscal policy** - `bb06dd6` (feat)
2. **Task 2: DB schema + migration + fiscalRepo CRUD** - `360a432` (feat)

## Files Created/Modified

- `shared/src/types.ts` - Added BudgetAllocation, PublicGoodsState interfaces; fiscal fields on EconomyConfig; DEFAULT_BUDGET_ALLOCATION and DEFAULT_PUBLIC_GOODS_INITIAL constants
- `server/src/db/schema.ts` - Added fiscalBudgets and publicGoodsState drizzle table definitions
- `server/src/db/migrate.ts` - Added CREATE TABLE IF NOT EXISTS for fiscal_budgets and public_goods_state with indexes
- `server/src/db/repos/fiscalRepo.ts` - New file: full CRUD for both fiscal tables following bankingRepo patterns

## Decisions Made

- EconomyConfig fiscal fields all optional with `fiscalEnabled` remaining absent in DEFAULT_ECONOMY_CONFIG — existing sessions receive zero behavioral change
- Budget allocation stored as one-per-session record (upsert by sessionId) — design-time config per FISC-01 spec
- Public goods state stored per-iteration to enable trend analysis and session export/import
- fiscalRepo has zero physics engine logic — pure data layer; fiscal engine (Plan 02) will own the computation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Types, schema, and CRUD foundation complete for Plan 02 (fiscal engine)
- fiscalRepo exports are immediately usable by fiscalEngine.ts for budget disbursement and quality update calculations
- EconomyConfig fiscal multiplier fields ready for use in physicsEngine spending multiplier application
- Concern (carried from STATE.md): fiscal multiplier magnitudes need calibration against existing agent wealth/productivity ranges during Plan 02 implementation

## Self-Check: PASSED

- FOUND: shared/src/types.ts
- FOUND: server/src/db/schema.ts
- FOUND: server/src/db/migrate.ts
- FOUND: server/src/db/repos/fiscalRepo.ts
- FOUND: .planning/phases/03-fiscal-policy/03-01-SUMMARY.md
- FOUND commit: bb06dd6
- FOUND commit: 360a432

---
*Phase: 03-fiscal-policy*
*Completed: 2026-04-01*
