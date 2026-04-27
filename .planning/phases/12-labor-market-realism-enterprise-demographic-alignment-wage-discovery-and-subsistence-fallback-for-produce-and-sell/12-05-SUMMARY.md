---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: 05
subsystem: orchestration, enterprise-engine, labor-market
tags: [labor-market, matching-pass, reservation-wage, D-12, D-13, D-14, tdd, sfc-invariant]
dependency_graph:
  requires:
    - "12-01: sessionReservationWages, sessionQuitLastIteration Maps in simulationState.ts"
    - "12-04: processWageAdjustment wired in iteration preamble (reads lastApplicants/lastVacancies we now populate)"
  provides:
    - "server/src/orchestration/helpers/matchingPass.ts: runApplyForJobMatching() pure helper"
    - "server/src/orchestration/simulationRunner.ts: PAS reservation-wage write, D-13 matching pass at line ~1345, death cleanup"
    - "server/src/orchestration/enterpriseActionDispatch.ts: QUIT_JOB D-14 auto-reapply mark, HIRE_EMPLOYEE vestigial comment"
    - "server/src/orchestration/__tests__/matchingPass.test.ts: 11 real assertions (L-09/L-10/D-03/SFC)"
    - "server/src/mechanics/__tests__/sfcInvariant.test.ts: Phase 12 matching-pass net-zero fiat assertion"
  affects:
    - "12-06 (simulationRunner.ts — keep edits in localized blocks for clean append)"
    - "12-07 (displacedThisIteration telemetry — matching pass vacancy data feeds into it)"
tech_stack:
  added: []
  patterns:
    - "Pure helper module pattern (matches structuralPressures.ts, bankingEngine.ts precedent)"
    - "Greedy best-offer matching: O(applicants × enterprises) — acceptable for ≤150 agents"
    - "Consume-and-clear: sessionQuitLastIteration consumed in simulationRunner BEFORE calling helper"
    - "TDD red-green-refactor per task (tests written + verified green before commit)"
key_files:
  created:
    - "server/src/orchestration/helpers/matchingPass.ts"
  modified:
    - "server/src/orchestration/simulationRunner.ts"
    - "server/src/orchestration/enterpriseActionDispatch.ts"
    - "server/src/orchestration/__tests__/matchingPass.test.ts"
    - "server/src/mechanics/__tests__/sfcInvariant.test.ts"
decisions:
  - "Reservation wage written as economyDelta.wealthDelta from PRODUCE_AND_SELL action — uses actual AMM fiat received (not point-estimate formula from plan) since PAS now sells directly to AMM in enterpriseActionDispatch.ts; value is deterministic and reflects real proceeds"
  - "Matching pass extracted to helpers/matchingPass.ts (planner decision in Task 3 action step 1) — enables direct unit testing without simulationRunner mounting"
  - "Applicant pool construction (APPLY_FOR_JOB intents + sessionQuitLastIteration) stays in simulationRunner — it's runner-context data; only greedy algorithm in helper"
  - "reservationFloor = max(minimumWage * 0.5, 1) — D-12 small_constant = 1 per plan"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-04-27"
  tasks: 3
  files_modified: 5
---

# Phase 12 Plan 05: Labor-Market Clearing Pipeline (D-12/D-13/D-14) Summary

Closed the labor-market feedback loop: per-agent reservation wages populated from PRODUCE_AND_SELL proceeds each iteration, greedy APPLY_FOR_JOB matching pass placed automatically after the intent phase, QUIT_JOB marks agents for auto-reapply next iteration — the heart of Phase 12's labor realism.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Populate sessionReservationWages at PAS resolution + stale cleanup on death | 503f2fc | simulationRunner.ts |
| 2 | Matching pass helper + simulationRunner wiring + QUIT_JOB D-14 dispatch | ce54a79 | matchingPass.ts, simulationRunner.ts, enterpriseActionDispatch.ts |
| 3 | Real assertions: L-09/L-10/D-03 + SFC Phase 12 test | abcab83 | matchingPass.test.ts, sfcInvariant.test.ts |

## What Was Built

### Task 1 — Reservation wage population (D-12)

Added to `server/src/orchestration/simulationRunner.ts`:

- **Import** of `sessionReservationWages` and `sessionQuitLastIteration` from `simulationState.js`.
- **PAS write** at the inner action loop: after `applyEnterpriseAction` returns for `PRODUCE_AND_SELL`, `economyDelta.wealthDelta` is stored as the agent's reservation wage for next iteration:
  ```typescript
  if (action.actionCode === 'PRODUCE_AND_SELL') {
    let rwMap = sessionReservationWages.get(sessionId);
    if (!rwMap) { rwMap = new Map(); sessionReservationWages.set(sessionId, rwMap); }
    rwMap.set(agent.id, economyDelta.wealthDelta);
  }
  ```
- **Death cleanup**: after the per-agent stat-update loop, deletes dead agents from the reservation wage Map to prevent stale reads (12-RESEARCH §8 risk mitigation).

**Deviation from plan**: Plan specified a point-estimate formula `(producedUnits - consumedUnits) × ammSpotPrice - toolWearCost`. In practice, PRODUCE_AND_SELL in `enterpriseActionDispatch.ts` already sells directly to the AMM and returns `economyDelta.wealthDelta` as the actual fiat received. Using this actual value is simpler, more deterministic, and avoids recomputing quantities already handled by the dispatch. The reserve-wage semantics (D-12: "last-period PAS net proceeds") are satisfied.

### Task 2 — Matching pass + QUIT_JOB D-14 (D-13, D-14)

**New file:** `server/src/orchestration/helpers/matchingPass.ts`

- `runApplyForJobMatching(MatchingPassInput): MatchingPassResult` — pure function, no DB, no fiat movement.
- Greedy algorithm: for each applicant (skip employed), filter enterprises by `vacancy > 0 AND wage >= reservationWage`, sort by wage DESC then employees.size ASC, place at best.
- After loop: sets `ent.lastApplicants` (pre-clear count) and `ent.lastVacancies` (post-placement count) per enterprise; clears `ent.applicants`.

**simulationRunner.ts** — matching pass block inserted at line ~1345 (after `weekStateMap.employer_id` population, before `const orderBook = getOrderBook`):
- Builds `applicantIds` from APPLY_FOR_JOB intents + `sessionQuitLastIteration` (consume-and-clear).
- Calls `runApplyForJobMatching` with reservation wages from `sessionReservationWages`.
- Appends `[MATCH]` trace line with applicant count, placements, and remaining vacancies.

**enterpriseActionDispatch.ts** — QUIT_JOB handler:
- After existing `employmentRegistry.delete` / `employees.delete`, adds agent to `sessionQuitLastIteration` for D-14 auto-reapply.
- HIRE_EMPLOYEE: added `// Phase 12: HIRE_EMPLOYEE is now vestigial — matching pass supersedes it.` comment per 12-RESEARCH §8 mitigation (code path kept, not removed).

**SFC verification**: `matchingPass.ts` contains zero references to `wealthDelta`, `treasury`, AMM reserves, or any fiat accumulator. All mutations are to `employmentRegistry`, `enterprise.employees`, `enterprise.applicants`, `enterprise.lastApplicants`, `enterprise.lastVacancies`, and `weekStateMap.employer_id` (via setter callback).

### Task 3 — Real test assertions (L-09, L-10, D-03, SFC)

**`matchingPass.test.ts`** — 11 real `expect()` assertions (0 `it.todo` remaining):
- L-09: highest-wage placement (e3@15 > e2@10 > e1@5, reservation=8 → placed at e3)
- L-09: tie-breaker smallest workforce (both wage=10, 3 vs 1 employees → picks 1-employee enterprise)
- L-09: vacancy decrement (capacity=3, after hire: employees.size=1, vacancies=2)
- L-09: unmatched when reservation > all wages (reservation=20, all wages ≤ 8 → unemployed)
- L-09: already-employed applicants skipped (no double-employment)
- L-09: multi-applicant placement (2 applicants, e1 capacity=1 → one each at e1/e2)
- L-10: quit-then-reapply (agent in applicantIds pool → placed at higher-paying enterprise)
- D-03: lastApplicants and lastVacancies set; applicants.clear() called
- D-03: lastVacancies=0 at full capacity
- SFC: wealth Map unchanged after pass (proves by construction no fiat mutated)
- Reservation wage fallback: max(minimumWage×0.5, 1)=2.5; enterprise wage=3 ≥ 2.5 → placed

**`sfcInvariant.test.ts`** — 1 real assertion replaces Phase 12 matching-pass todo:
- 3 agents placed at 2 enterprises; wealth Map unchanged (net-zero fiat proof).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reservation wage computation uses actual wealthDelta instead of point-estimate**
- **Found during:** Task 1
- **Issue:** Plan's point-estimate formula requires `producedUnits`, `consumedUnits`, `toolWearCost` as separate variables. In the current codebase, PRODUCE_AND_SELL sells directly to the AMM inside `applyEnterpriseAction` and returns `economyDelta.wealthDelta` as the exact fiat received. The plan's point-estimate variables don't exist as distinct values in scope at the insertion point.
- **Fix:** Used `economyDelta.wealthDelta` directly — the actual AMM sale proceeds — as the reservation wage. This satisfies D-12 semantics ("last-period PAS net proceeds") more accurately than a point-estimate.
- **Files modified:** `simulationRunner.ts`
- **Commit:** 503f2fc

**2. [Rule 3 - Blocking] Applicant pool construction stays in simulationRunner (not passed as param)**
- **Found during:** Task 3 helper extraction
- **Issue:** Task 3 action step says "Applicant-pool construction from intents + sessionQuitLastIteration stays in simulationRunner (it's runner-context data)." This is consistent — `intents` and `sessionQuitLastIteration` are runner context. The helper receives the pre-built `applicantIds: Set<string>` as input.
- **Fix:** Design confirmed correct — no change needed.

## Verification Checks

- `npx tsc --noEmit -p server/tsconfig.json` — PASS (zero errors)
- `npx vitest run server/src/orchestration/__tests__/matchingPass.test.ts` — 11 pass, 0 todo
- `npx vitest run server/src/mechanics/__tests__/sfcInvariant.test.ts` — 19 pass, 1 todo (10-iter smoke, out-of-scope for this plan)
- `npm run test -w server` — 578 passed, 17 todo, 0 failures (no regression)
- SFC invariant: explicit test asserts matching pass is net-zero fiat (wealth Map unchanged before/after)
- Code review: `matchingPass.ts` contains zero fiat-field references (`wealthDelta`, `treasury`, AMM reserve)

## Known Stubs

None. The matching pass is fully operational:
- `sessionReservationWages` entries written at PRODUCE_AND_SELL resolution each iteration
- `sessionQuitLastIteration` consumed-and-cleared each iteration
- `lastApplicants`/`lastVacancies` populated after each pass (feeds 12-04's processWageAdjustment)
- Fallback reservation wage `max(minimumWage × 0.5, 1)` applies for agents with no PAS history

The labor-market clearing loop (D-12 → D-13 → D-03 → D-01 → D-13 next iter) is now fully closed.

## Self-Check: PASSED

Files created/modified:
- server/src/orchestration/helpers/matchingPass.ts — EXISTS
- server/src/orchestration/simulationRunner.ts — EXISTS
- server/src/orchestration/enterpriseActionDispatch.ts — EXISTS
- server/src/orchestration/__tests__/matchingPass.test.ts — EXISTS
- server/src/mechanics/__tests__/sfcInvariant.test.ts — EXISTS

Commits:
- 503f2fc — Task 1 (reservation wages + death cleanup)
- ce54a79 — Task 2 (matching pass helper + wiring + QUIT_JOB D-14)
- abcab83 — Task 3 (test assertions)
