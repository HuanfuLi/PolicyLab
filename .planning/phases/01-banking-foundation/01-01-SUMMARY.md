---
phase: 01-banking-foundation
plan: 01
subsystem: database
tags: [typescript, sqlite, drizzle-orm, vitest, banking, economy, sfc]

# Dependency graph
requires: []
provides:
  - EconomyConfig interface with 6 required banking fields and 3 optional future flags
  - DEFAULT_ECONOMY_CONFIG exported from @policylab/shared
  - LoanContract, DepositAccount, BankBalanceSheet types exported from @policylab/shared
  - TelemetryLog extended with m0, m1, loansOutstanding optional fields
  - getEconomyConfig() backward-compat helper in server/src/mechanics/economyConfigUtils.ts
  - depositAccounts, loanContracts, bankBalanceSheets Drizzle ORM table definitions
  - CREATE TABLE IF NOT EXISTS migrations for all 3 banking tables with indexes
  - computeSystemFiatTotal extended with depositBalances and collateralEscrow params (default 0)
affects:
  - 01-02 (banking engine builds against these types and tables)
  - 01-03 (simulation wiring calls computeSystemFiatTotal with banking params)
  - all future phases using banking types from @policylab/shared

# Tech tracking
tech-stack:
  added: []
  patterns:
    - EconomyConfig as session-level config: all tunable economic parameters stored in session config, never hardcoded
    - getEconomyConfig backward-compat: null/missing config returns bankingEnabled:false for legacy sessions
    - computeSystemFiatTotal extended with optional params defaulting to 0 for backward compatibility

key-files:
  created:
    - shared/src/types.ts (EconomyConfig, DEFAULT_ECONOMY_CONFIG, LoanContract, DepositAccount, BankBalanceSheet + TelemetryLog extension)
    - server/src/mechanics/economyConfigUtils.ts (getEconomyConfig helper)
    - server/src/__tests__/economyConfig.test.ts (16 tests)
  modified:
    - server/src/db/schema.ts (3 banking tables added)
    - server/src/db/migrate.ts (3 CREATE TABLE IF NOT EXISTS blocks + indexes)
    - server/src/orchestration/simulationRunner.ts (computeSystemFiatTotal extended)
    - server/src/db/index.ts (Rule 1 bug fix: missing opening quote in dbPath string)

key-decisions:
  - "EconomyConfig has bankingEnabled:false as the backward-compat default for legacy sessions (getEconomyConfig returns false when config is null or missing economyConfig key)"
  - "computeSystemFiatTotal new params default to 0 — existing call sites need zero changes until Plan 03 wires them"
  - "LoanContract status enum is 'active' | 'repaid' | 'defaulted' — sufficient for Phase 1 banking engine"
  - "DepositAccount.accountType is 'demand' only — savings/time deposits are out of scope for v1.0"

patterns-established:
  - "Pattern 1: EconomyConfig as session config key — all banking parameters live in session.config.economyConfig"
  - "Pattern 2: getEconomyConfig spread merge — DEFAULT_ECONOMY_CONFIG spread first, then partial override, ensuring all fields always present"
  - "Pattern 3: Migration idempotence — all new tables use CREATE TABLE IF NOT EXISTS, safe to re-run"

requirements-completed: [CONF-01, CONF-02, CONF-03, BANK-08]

# Metrics
duration: 25min
completed: 2026-04-01
---

# Phase 01 Plan 01: Types, Schema, and SFC Foundation Summary

**EconomyConfig type + 3 banking DB tables + backward-compat getEconomyConfig helper + computeSystemFiatTotal extended with deposit/escrow params for M1-aware SFC audit**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-01T17:09:00Z
- **Completed:** 2026-04-01T17:14:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Exported EconomyConfig, DEFAULT_ECONOMY_CONFIG, LoanContract, DepositAccount, BankBalanceSheet from @policylab/shared — all downstream banking plans now have typed contracts to build against
- Created getEconomyConfig() backward-compat helper: pre-v1.0 sessions get bankingEnabled:false; new sessions merge partial config with defaults
- Added three banking tables (deposit_accounts, loan_contracts, bank_balance_sheets) to schema.ts and migrate.ts with appropriate FK cascades and indexes
- Extended computeSystemFiatTotal with depositBalances and collateralEscrow params (default 0) — SFC audit is M1-aware when banking is active, unbroken for legacy sessions
- All 16 new tests pass; build clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared types + EconomyConfig + backward-compat helper + tests** - `be8c235` (feat)
2. **Task 2: DB schema tables + migration + extended computeSystemFiatTotal** - `046b51b` (feat)

**Plan metadata:** *(this commit)*

_Note: Task 1 was TDD (tests written first, confirmed RED, then implementation made them GREEN)_

## Files Created/Modified

- `shared/src/types.ts` - Added EconomyConfig, DEFAULT_ECONOMY_CONFIG, LoanContract, DepositAccount, BankBalanceSheet; extended TelemetryLog with m0/m1/loansOutstanding
- `server/src/mechanics/economyConfigUtils.ts` - New file: getEconomyConfig() backward-compat helper
- `server/src/__tests__/economyConfig.test.ts` - New file: 16 tests covering all type shapes and config merge logic
- `server/src/db/schema.ts` - Added depositAccounts, loanContracts, bankBalanceSheets table definitions
- `server/src/db/migrate.ts` - Added CREATE TABLE IF NOT EXISTS SQL + 4 indexes for banking tables
- `server/src/orchestration/simulationRunner.ts` - Extended computeSystemFiatTotal with depositBalances and collateralEscrow params
- `server/src/db/index.ts` - Rule 1 bug fix: corrected missing opening quote in dbPath string literal

## Decisions Made

- EconomyConfig returns bankingEnabled:false for legacy sessions (null config or missing economyConfig key) — ensures zero behavioral change for existing sessions
- computeSystemFiatTotal new params default to 0 to preserve backward compatibility at all existing call sites; Plan 03 wires the real values
- LoanContract.status type is 'active' | 'repaid' | 'defaulted' — covers all Phase 1 banking engine states

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing opening quote in db/index.ts dbPath string literal**
- **Found during:** Task 2 (building server TypeScript after schema changes)
- **Issue:** `server/src/db/index.ts` line 13 had `path.join(dbDir, .policylab.db')` — missing opening single quote caused TypeScript parse error (TS1135, TS1005, TS1002)
- **Fix:** Corrected to `path.join(dbDir, 'policylab.db')` — removed the `.policylab.db` prefix (this is a non-home-dir path inside the `.policylab` directory, not the directory name itself)
- **Files modified:** `server/src/db/index.ts`
- **Verification:** `tsc -p server/tsconfig.json` passes cleanly after fix
- **Committed in:** `046b51b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary fix — the server would not compile without it. No scope creep.

## Issues Encountered

- `npm run build` and `npm run test` failed because npm workspaces use local .bin references which aren't on PATH in this shell environment. Resolved by running `npm install` to populate node_modules, then using `node -e "execSync(...)"` with the local `node_modules/.bin/tsc` and `node_modules/.bin/vitest` binaries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All type contracts for banking engine are defined and exported from @policylab/shared
- All 3 banking DB tables exist in schema and migration (CREATE TABLE IF NOT EXISTS — safe to deploy)
- computeSystemFiatTotal is M1-aware with backward-compat defaults — Plan 03 can pass real values without breaking Plan 01/02
- getEconomyConfig() available for all server code that needs to read banking parameters
- Ready for Plan 02: banking engine (OPEN_DEPOSIT, REQUEST_LOAN, REPAY_LOAN action handlers)

---
*Phase: 01-banking-foundation*
*Completed: 2026-04-01*
