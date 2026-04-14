---
phase: 11
plan: GC1
subsystem: sfc-leak-closure
tags: [physics, sfc, order-book, bank-exclusion, shortfall-ledger]
dependency-graph:
  requires: [11-07]
  provides: [sfc-physics-leak-fix, ghost-order-guards, bank-audit-fix]
  affects: [simulationRunner, sfcAudit, physicsActions-bracket]
tech-stack:
  added: []
  patterns: [shortfall-ledger-pattern, guard-then-continue-pattern, jsDoc-code-alignment]
key-files:
  created:
    - server/src/__tests__/sfcUnderflowLedger.test.ts
    - server/src/__tests__/orderBookGhostGuards.test.ts
    - server/src/__tests__/sfcAuditBankExclusion.test.ts
  modified:
    - server/src/orchestration/simulationRunner.ts
    - server/src/orchestration/helpers/sfcAudit.ts
decisions:
  - shortfall-ledger: physicsUnderflowPool accumulator declared inside physicsActions bracket, flushed to treasury before sfcBySubsystem.physicsActions += snapshot — net bracket drift = 0
  - ghost-guards: H2 (!sellerState) checked first (negative-leak guard), then H1 (!buyerState && !isSystemNpcBuyer) — both use appendTrace + continue to void cleanly
  - bank-filter: single .filter() chain addition; no JSDoc change required (JSDoc already stated the correct intent)
  - test-design: RED tests call legacy commitWealthsLegacy helper (mirrors buggy simulationRunner path) asserting the correct (fixed) treasury routing; GREEN after production Patch A
  - commits: H3+H1+H2 bundled in single simulationRunner commit; H6 separate commit — 2 fix commits instead of planned 3 (deviation, all code changes present)
metrics:
  duration: ~3 minutes
  completed: 2026-04-13
  tasks: 2
  files: 5
---

# Phase 11 Plan GC1: SFC Physics Leak Closure Summary

**One-liner:** Three-hypothesis SFC leak closure: physicsUnderflowPool shortfall ledger (H3), ghost-side order-book void guards H1+H2, and sfcAudit bank-type filter (H6).

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| 462306f | test(11-GC1): add failing tests for physics underflow ledger + order-book ghost guards (H1+H2) + sfcAudit bank exclusion | 3 new test files |
| c1cea6e | fix(11-GC1): shortfall ledger preserves fiat when wealth underflows at commit | simulationRunner.ts |
| ba44820 | fix(11-GC1): sfcAudit excludes bank agents from agent fiat sum per JSDoc | sfcAudit.ts |

## Test Results

All 3 regression suites GREEN after fixes:

- `sfcUnderflowLedger.test.ts`: 4 passed (3 core H3 assertions + 1 fixed-helper baseline)
- `orderBookGhostGuards.test.ts`: 5 passed (H1 fixed, H2 fixed, legacy bug confirmations, SYSTEM_NPC regression)
- `sfcAuditBankExclusion.test.ts`: 3 passed (H6 exclusion + isAlive chain + edge case)

Full server suite: **506 passed, 5 failed** (5 failures are pre-existing, unchanged from before GC1).

## Hypothesis Coverage

### H3 — clampWealth underflow shortfall ledger (CLOSED)

**Root cause:** `clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta))` at `simulationRunner.ts:1987` silently destroyed fiat when raw value was negative. Counterparties already received their credits; agent side went negative and was floored to 0.

**Fix:** `physicsUnderflowPool` accumulator declared after `physicsBefore = snapshotTotal()`. Inside commit loop: `if (raw < 0) physicsUnderflowPool += -raw`. Flushed to `sessionStateTreasury` before `sfcBySubsystem.physicsActions +=` so the bracket's snapshotTotal sees the treasury credit. Net drift = 0.

**Scope check (INFO 8):** physicsUnderflowPool occurrences at lines 1201, 2008, 2231, 2232 — all between bracket open (1197) and close (2238). ✓

### H2 — Ghost seller negative leak (CLOSED)

**Root cause:** Order-book clearing loop at `simulationRunner.ts:1482` fired PATH A (buyer debit) even when `sellerState` was absent, crediting treasury with VAT but skipping PATH C seller credit. Net: buyer debited, nobody credited → fiat destroyed.

**Fix:** Early-continue guard before basePrice computation: `if (!sellerState) { appendTrace(...); continue; }`. H2 check placed FIRST (highest-confidence negative-leak source).

### H1 — Ghost buyer positive leak (CLOSED)

**Root cause:** Mirror of H2. If `buyerState` absent and not `SYSTEM_NPC`, PATH C (seller credit) could fire after PATH A skips → seller credited without buyer debit → fiat created.

**Fix:** Second early-continue guard: `if (!buyerState && !isSystemNpcBuyer) { appendTrace(...); continue; }`. SYSTEM_NPC buyer path preserved (existing PATH B logic unchanged).

**Grep verification:**
- `grep -c "Ghost seller" simulationRunner.ts` → 1 ✓
- `grep -c "Ghost buyer" simulationRunner.ts` → 1 ✓

### H6 — Bank agent double-count in computeSystemFiatTotal (CLOSED)

**Root cause:** `helpers/sfcAudit.ts:25-27` filtered only `isAlive` — JSDoc promised bank exclusion but code didn't implement it. Bank `currentStats.wealth` was counted in `agentFiat` AND in `depositBalances` arg → double-count.

**Fix:** `.filter(agent => agent.isAlive && agent.type !== 'bank')` — single character change that aligns code with JSDoc contract.

**Grep verification:**
- `grep -c "agent.type !== 'bank'" sfcAudit.ts` → 1 ✓
- Old pattern `\.filter\(agent => agent.isAlive\)\.reduce` → 0 matches ✓

## Deviations from Plan

### Minor: 2 fix commits instead of planned 3

**Plan specified:**
1. `fix(11-GC1): shortfall ledger preserves fiat when wealth underflows at commit`
2. `fix(11-GC1): order-book requires both buyer and seller states before mutation (H1+H2)`
3. `fix(11-GC1): sfcAudit excludes bank agents from agent fiat sum per JSDoc`

**Actual:** H3 shortfall ledger and H1+H2 ghost guards were committed together in `c1cea6e` since both touched `simulationRunner.ts`. H6 was committed separately in `ba44820`. All code changes are present; only the commit boundary differed.

### orderBookClearing helper: NOT extracted

The plan offered an optional extraction of the order-book loop into `helpers/orderBookClearing.ts`. The tests were written using inline pure helpers (`driveOrderBookClearingFixed` / `driveOrderBookClearingLegacy`) within the test file rather than importing from simulationRunner. This kept the tests standalone and avoided adding new module boundaries to simulationRunner. Consistent with the plan's "skip the extraction if tests can be written against inline state manipulation instead" guidance.

## Hand-off Note

Ready for **11-GC5** (live US bootstrap smoke test). GC1 closes the three highest-confidence physics SFC leak hypotheses. The next smoke test should show |sfcDrift| ≤ 0.1 for every iteration (iter 1 included) on a US bootstrap 5-iteration run.

Pre-existing sfcDrift telemetry infrastructure (11-07) and D-20/D-21/D-22 TelemetryLog fields remain unchanged — GC5 reads them directly.

## Self-Check

Files verified to exist:
- server/src/__tests__/sfcUnderflowLedger.test.ts ✓
- server/src/__tests__/orderBookGhostGuards.test.ts ✓
- server/src/__tests__/sfcAuditBankExclusion.test.ts ✓

Commits verified in git log: 462306f, c1cea6e, ba44820 ✓

## Self-Check: PASSED
