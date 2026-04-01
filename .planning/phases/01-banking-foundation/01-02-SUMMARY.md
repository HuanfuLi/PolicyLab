---
phase: 01-banking-foundation
plan: 02
subsystem: database
tags: [banking, drizzle-orm, sqlite, vitest, fractional-reserve, SFC, M1-expansion, loan-lifecycle]

# Dependency graph
requires:
  - phase: 01-banking-foundation/01-01
    provides: EconomyConfig type, LoanContract, DepositAccount, BankBalanceSheet types in shared/src/types.ts; deposit_accounts, loan_contracts, bank_balance_sheets schema tables; getEconomyConfig helper
provides:
  - bankingRepo.ts: complete CRUD for deposit_accounts, loan_contracts, bank_balance_sheets (13 exported functions)
  - bankingEngine.ts: deterministic banking logic — canIssueLoan, processLoanRequest, processRepayment, accrueInterest, processDefault, accrueDepositInterest, processIteration (7 exported functions + BankingDelta type)
  - banking.test.ts: 24 unit tests covering BANK-01 through BANK-05
affects:
  - 01-banking-foundation/01-03 (simulation loop wiring — imports bankingEngine.processIteration and bankingRepo CRUD)
  - any phase that needs to read loan or deposit state

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BankingDelta pattern: all engine mutations returned as delta objects; caller applies to DB in batch"
    - "Balance-sheet model for loan M1 accounting: issuance/repayment are balance-sheet events, not wealth transfers"
    - "Running balance tracking in processIteration: local Maps track state as steps execute within one tick"

key-files:
  created:
    - server/src/db/repos/bankingRepo.ts
    - server/src/mechanics/bankingEngine.ts
    - server/src/mechanics/__tests__/banking.test.ts
  modified: []

key-decisions:
  - "BankingDelta return pattern: engine functions return deltas rather than mutating DB directly — Plan 03 applies in batch via bankingRepo"
  - "Bank reserves modeled as bank agent.currentStats.wealth — single source of truth, keeps SFC perimeter clean (avoids Pitfall 4)"
  - "accrueInterest and processRepayment are separate functions: accrueInterest handles per-iteration interest tracking; processRepayment handles explicit payment events from action queue"
  - "processIteration step order: interest accrual → default checks → deposit interest → balance sheet snapshot ensures defaults use post-interest consecutiveMissed counts"

patterns-established:
  - "Pattern 1: Banking repo uses synchronous .run() / .all() / .get() Drizzle calls (better-sqlite3 sync) matching agentRepo and economyRepo patterns"
  - "Pattern 2: Row mapper functions (rowToDeposit, rowToLoan, rowToBalanceSheet) convert DB rows to typed domain objects — no raw row leaks"
  - "Pattern 3: Pure engine functions — bankingEngine.ts has no direct DB imports; all reads happen via params, all writes returned as deltas"

requirements-completed: [BANK-01, BANK-02, BANK-03, BANK-04, BANK-05]

# Metrics
duration: 4min
completed: 2026-04-01
---

# Phase 01 Plan 02: Banking Repository and Engine Summary

**Fractional reserve banking engine with reserve-ratio enforcement, M1 loan expansion, collateral escrow, interest accrual, and default mechanics — 13 repo CRUD functions and 7 pure engine functions, all tested (24 passing)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T17:16:51Z
- **Completed:** 2026-04-01T17:20:40Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- Built `bankingRepo.ts` with typed CRUD for all three banking tables: upsert/get/list deposits, insert/query/update loans (with aggregate totals), insert/query balance sheets
- Built `bankingEngine.ts` with 7 pure functions implementing the full loan lifecycle: reserve ratio gating, M1 expansion on issuance, principal/interest split on repayment, consecutive-missed tracking for default, pro-rated deposit interest payment, and per-iteration orchestration returning a `BankingDelta`
- 24 unit tests covering all BANK-01 through BANK-05 behaviors pass in GREEN state

## Task Commits

Each task was committed atomically:

1. **Task 1: Banking repository — CRUD for deposits, loans, balance sheets** - `7f40a24` (feat)
2. **Task 2 RED: Add failing tests for banking engine** - `0ac001d` (test)
3. **Task 2 GREEN: Implement banking engine** - `2eb63b4` (feat)

**Plan metadata:** (docs commit below)

_Note: Task 2 used TDD: RED commit of tests followed by GREEN commit of implementation_

## Files Created/Modified

- `server/src/db/repos/bankingRepo.ts` — CRUD layer for deposit_accounts, loan_contracts, bank_balance_sheets; 13 exported functions following agentRepo/economyRepo patterns
- `server/src/mechanics/bankingEngine.ts` — Pure banking logic: canIssueLoan, processLoanRequest, processRepayment, accrueInterest, processDefault, accrueDepositInterest, processIteration; returns BankingDelta (no DB side effects)
- `server/src/mechanics/__tests__/banking.test.ts` — 24 unit tests; pure functions tested with inline mock agents and deposits (no DB)

## Decisions Made

- **BankingDelta pattern:** Engine functions return delta structs rather than writing to DB. Plan 03 (simulation loop integration) will apply deltas in batch via bankingRepo. This keeps the engine pure-ish and testable without DB.
- **Bank reserves = agent.wealth:** The bank agent's `currentStats.wealth` is its M0 reserve pool. No separate reserve map. This avoids SFC double-counting (Pitfall 4) and keeps `computeSystemFiatTotal` perimeter clean.
- **Separate accrueInterest vs processRepayment:** `accrueInterest` runs every iteration as an automatic per-loan tick; `processRepayment` processes an explicit payment (from a REPAY_LOAN action). Split enables both flows without conflating them.
- **processIteration step order:** (1) interest accrual first → updates consecutiveMissed, (2) default check uses updated counts, (3) deposit interest, (4) balance sheet snapshot. This ordering is semantically correct: defaults should fire on post-accrual missed counts.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `bankingRepo.ts` and `bankingEngine.ts` are ready for Plan 03 (`simulationRunner.ts` wiring)
- Plan 03 needs to: (a) call `bankingEngine.processIteration()` after each physics tick, (b) apply the returned `BankingDelta` via `bankingRepo` functions, (c) extend `computeSystemFiatTotal` with `loansOutstanding` from `bankingRepo.getTotalLoansOutstanding()`
- No blockers.

---
*Phase: 01-banking-foundation*
*Completed: 2026-04-01*
