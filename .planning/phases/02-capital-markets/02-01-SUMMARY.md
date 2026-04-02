---
phase: 02-capital-markets
plan: 01
subsystem: database
tags: [typescript, sqlite, drizzle, action-codes, capital-markets, equity, bonds]

# Dependency graph
requires:
  - phase: 01-banking-foundation
    provides: EconomyConfig type, Drizzle schema patterns, ActionCode union, ACTION_SKILL_MAP structure
provides:
  - EquityPosition and BondHolding shared types exported from @policylab/shared
  - equity_positions and bond_holdings Drizzle table definitions in schema.ts
  - CREATE TABLE IF NOT EXISTS migration blocks for both capital market tables (with indexes)
  - BUY_SHARES, SELL_SHARES, BUY_BOND, ISSUE_GOV_BOND ActionCodes in the union type
  - CAPITAL_MARKET_ACTIONS set for filtering/routing in the physics engine
  - 4 ACTION_SKILL_MAP entries wiring new codes to trading/management skills
  - EconomyConfig extended with dividendPayoutRatio, govBondCouponRate, govBondTermIterations
  - SessionExport extended with optional equityPositions and bondHoldings arrays
affects:
  - 02-02 (capital markets engine — imports these types and tables)
  - 02-03 (integration — wires engine into physics loop)
  - 03-fiscal-policy (fiscal engine touches EconomyConfig)
  - importexport.ts (SessionExport now includes capital market arrays)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capital market tables follow the same Drizzle pattern as depositAccounts: id PK, sessionId + ownerAgentId with cascade deletes"
    - "enterpriseOwnerId stored as agent.id (DB-persisted string), not in-memory enterpriseId — survives export/import"
    - "ISSUE_GOV_BOND restricted to ELITE_ACTIONS only; BUY_SHARES/SELL_SHARES/BUY_BOND in BASE_ACTIONS"
    - "ACTION_SKILL_MAP must be updated atomically with ActionCode union additions to avoid TypeScript exhaustiveness error"

key-files:
  created: []
  modified:
    - shared/src/types.ts
    - server/src/db/schema.ts
    - server/src/db/migrate.ts
    - server/src/mechanics/actionCodes.ts
    - server/src/mechanics/skillSystem.ts

key-decisions:
  - "enterpriseOwnerId is agent.id (DB-persisted), NOT the in-memory enterpriseId — survives session export/import"
  - "Corporate bond issuerId = agent.id of enterprise owner (same agent.id rationale)"
  - "No bondEscrow in SFC — bond purchase is a direct wealth transfer between buyer and issuer, both already in the SFC perimeter"
  - "BUY_SHARES, SELL_SHARES, BUY_BOND available to all non-bank roles; ISSUE_GOV_BOND restricted to elite tier (leader/governor)"
  - "Dividends are planned to flow from enterprise owner wealth directly — no separate retained_earnings account (SFC-trivial)"

patterns-established:
  - "Capital market type contract: separate EquityPosition and BondHolding interfaces with explicit status lifecycle fields"
  - "Migration idempotency: CREATE TABLE IF NOT EXISTS + separate indexes for all new tables"

requirements-completed: [CMKT-01, CMKT-06]

# Metrics
duration: 15min
completed: 2026-04-01
---

# Phase 02 Plan 01: Capital Markets Types, Schema, and Action Codes Summary

**EquityPosition and BondHolding shared types, DB tables with migrations, and 4 capital market ActionCodes wired into the permission system and skill map**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-01T21:39:10Z
- **Completed:** 2026-04-01T21:54:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added EquityPosition and BondHolding interfaces to shared types with full lifecycle fields (status, coupon rates, maturity)
- Extended EconomyConfig with 3 optional capital market parameters; extended SessionExport with optional equity/bond arrays for backward-compatible export/import
- Added equityPositions and bondHoldings Drizzle table definitions and idempotent SQL migration blocks (each with session + owner indexes)
- Added BUY_SHARES, SELL_SHARES, BUY_BOND, ISSUE_GOV_BOND to the ActionCode union with role-gated permission sets and CAPITAL_MARKET_ACTIONS export set
- Wired all 4 new ActionCodes into ACTION_SKILL_MAP (trading/management mappings) — full monorepo build passes with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared types + EconomyConfig extensions + SessionExport fields** - `31eb94e` (feat)
2. **Task 2: DB schema tables + migration + ActionCodes + skillSystem** - `754ef81` (feat)

**Plan metadata:** _(committed with final docs commit)_

## Files Created/Modified

- `shared/src/types.ts` - EquityPosition + BondHolding interfaces; EconomyConfig +3 fields; SessionExport +2 optional arrays
- `server/src/db/schema.ts` - equityPositions and bondHoldings Drizzle table definitions
- `server/src/db/migrate.ts` - CREATE TABLE IF NOT EXISTS for equity_positions and bond_holdings (with indexes)
- `server/src/mechanics/actionCodes.ts` - 4 new ActionCodes in union; CAPITAL_MARKET_ACTIONS set; BASE_ACTIONS and ELITE_ACTIONS updated
- `server/src/mechanics/skillSystem.ts` - ACTION_SKILL_MAP entries for BUY_SHARES, SELL_SHARES, BUY_BOND, ISSUE_GOV_BOND

## Decisions Made

- `enterpriseOwnerId` uses agent.id (DB-persisted) rather than in-memory enterpriseId to survive session export/import round-trips.
- No bond escrow in the SFC accounting — bond purchase is a direct wealth transfer already within the SFC perimeter.
- ISSUE_GOV_BOND restricted to ELITE_ACTIONS (leader/governor role tier only); the three investor actions go into BASE_ACTIONS so all citizens can participate in markets.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — the TypeScript exhaustiveness requirement for ACTION_SKILL_MAP was noted in the plan (Pitfall 5) and handled atomically in Task 2 by adding all 4 skill entries in the same edit as the ActionCode union additions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-02 can import EquityPosition, BondHolding from @policylab/shared and reference equityPositions/bondHoldings tables from schema.ts
- Plan 02-02 can use CAPITAL_MARKET_ACTIONS and BUY_SHARES/SELL_SHARES/BUY_BOND/ISSUE_GOV_BOND ActionCodes for engine dispatch
- EconomyConfig fields (dividendPayoutRatio, govBondCouponRate, govBondTermIterations) are available for engine configuration

---
*Phase: 02-capital-markets*
*Completed: 2026-04-01*
