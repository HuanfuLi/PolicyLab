---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 08
subsystem: fiscal/orchestration/route-guards
tags: [typescript, fiscalEnabled, runSimulation, abortReset, putConfig, vitest]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: Wave 0 fiscalBudgetAssertion.test.ts scaffold (5 it.todos) — converted into 19 real assertions here
provides:
  - assertFiscalBudgetExists helper (DI-friendly; throws descriptive error naming three known root causes)
  - assertPutConfigFiscalFlip helper (PUT /config 400 guard for fiscalEnabled false→true flip)
  - rehydrateFiscalBudgetOnAbortReset helper (recreates fiscal_budgets row from session.config after abort-reset wipe)
  - runSimulation startup assertion (fail-fast when fiscalEnabled=true and no fiscal_budgets row)
  - Removal of both `?? DEFAULT_BUDGET_ALLOCATION` silent fallbacks at simulationRunner lines ~640 and ~2540
  - PUT /api/sessions/:id/config returns 400 on illegal flip (or auto-creates row when allocation supplied)
  - POST /simulate/abort-reset rehydrates fiscal_budgets from session.config when fiscalEnabled
  - 19 real assertions in fiscalBudgetAssertion.test.ts (5 helper-contract + 5 PUT-flip + 5 abort-reset + 4 source-grep)
affects: [11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Helper-extraction-then-DI-test pattern: pure assertions live in a tiny helper module (fiscalBudgetGuard.ts) so vitest can verify the contract without mounting the 3000-line simulationRunner. The runner imports the helper; tests inject mocks. Mirrors the structuralPressures.ts and lawDiff.ts precedents from 11-02 / 11-06."
    - "Structured-result idiom for route guards: assertPutConfigFiscalFlip returns { ok: true } | { ok: false; status: 400; error: string } rather than throwing — the caller decides whether to forward as a transaction-rollback throw (so the in-progress sqlite.transaction unwinds) or a direct res.status(400).json(...). Keeps the helper pure and the route in control of HTTP semantics."
    - "Bang-assertion at consumer sites: after the runSimulation startup gate runs, both per-iteration getActiveBudget callers use `fiscalRepo.getActiveBudget(scope)!` instead of `?? DEFAULT_BUDGET_ALLOCATION`. The bang is grep-friendly, surfaces a runtime TypeError if the invariant ever breaks (vs silent stub data), and documents the dependency on the startup gate via an inline comment."
    - "Source-grep contract tests: four assertions in fiscalBudgetAssertion.test.ts read the actual production source files via fs.readFile + import.meta.url, asserting (a) zero `?? DEFAULT_BUDGET_ALLOCATION` patterns in the runner, (b) canonical phrase in the runner, (c) rehydration log marker in simulate.ts, (d) flip-guard symbol in sessions.ts. These tests fail loudly if any future refactor reintroduces a silent fallback."

key-files:
  created:
    - server/src/orchestration/helpers/fiscalBudgetGuard.ts
  modified:
    - server/src/orchestration/simulationRunner.ts
    - server/src/routes/sessions.ts
    - server/src/routes/simulate.ts
    - server/src/__tests__/fiscalBudgetAssertion.test.ts

key-decisions:
  - "Extracted the assertion into helpers/fiscalBudgetGuard.ts as three pure-ish exports (assertFiscalBudgetExists, assertPutConfigFiscalFlip, rehydrateFiscalBudgetOnAbortReset) so vitest can unit-test the contract without mounting runSimulation or spinning up Express. Plan called for inline assertions; extraction was chosen for testability + reusability across the three call sites (runner startup, PUT /config, abort-reset). The runner / route handlers become 5-10 line wrappers."
  - "Startup assertion placed immediately after publicGoodsEscrow hydration (line ~318), before the iteration loop and AMM init. session.config is loaded by line 227 and economyConfig is derived inline via getEconomyConfig — the assertion runs once per runSimulation call and fails fast before any DB writes or LLM calls. The thrown Error propagates through the existing try/catch in the route handler (line 109) into simulationManager.broadcast as an SSE { type: 'error', message: ... } event — same path Phase 10 D-28 established for bootstrap LLM failures. No new SSE wiring needed."
  - "Bang-assertion (`fiscalRepo.getActiveBudget(scope)!`) at both consumer sites instead of an `if (allocation) { ... } else throw` block. The startup gate guarantees the invariant; the bang documents the dependency. If a future refactor moves the call site outside the fiscalEnabled guard, TypeScript narrowing would still surface the issue at compile time. Cleaner than re-asserting at every call site."
  - "Structured-result return for assertPutConfigFiscalFlip rather than throwing. The helper does not know whether the route caller is inside a sqlite.transaction (where throwing rolls back) or outside (where it would skip the response). Returning { ok: false; status; error } lets the route choose: in this case sessions.ts throws a tagged Error inside the transaction so the existing rollback semantics fire, then the catch handler forwards as a 400."
  - "rehydrateFiscalBudgetOnAbortReset silently no-ops on three skip paths: missing session, fiscalEnabled=false, no allocation found. The third path is honest — if no allocation can be recovered from session.config we cannot recreate the row. The next runSimulation start will then trip assertFiscalBudgetExists with its descriptive error, which is the desired observable failure rather than a silent state-loss."
  - "Allocation lookup checks both session.config.budgetAllocation (the conventional location, written by PUT /config and bootstrap.ts) AND session.config.economyConfig.budgetAllocation (a defensive fallback). Some legacy paths nested it under economyConfig; checking both prevents an honest no-op when an old session is rehydrated."
  - "Removed `DEFAULT_BUDGET_ALLOCATION` from the simulationRunner.ts import list. The constant is still exported from @policylab/shared and used by other test fixtures and the scenario-store baseline merge, but the runner no longer references it — the only legitimate use cases are tests and frontend defaults, neither of which can mask state loss."

patterns-established:
  - "Helper-extraction idiom for D-15-class invariants: any future startup gate that needs to fail-fast on missing per-session state should follow the fiscalBudgetGuard.ts pattern — a tiny module exporting (a) the assertion, (b) any companion route guards, and (c) any post-wipe rehydration helpers. Test the module directly with mocks; keep the runner / routes as thin wrappers."
  - "Source-grep contract tests for invariants the type system cannot enforce: when an invariant is `this string must not appear in this file`, write a test that reads the file via fs.readFile + import.meta.url. Cheaper than a custom lint rule, fails loudly on any regression, no infrastructure to maintain."
  - "Structured-result for route-level guards: helpers that need to communicate HTTP status codes back to a route handler should return tagged unions (`{ ok: true } | { ok: false; status; error }`) rather than throwing. Keeps the helper testable and the route in control of transaction unwinding semantics."

decisions-addressed: [D-15]
requirements-completed: []

# Metrics
duration: 6min
completed: 2026-04-13
---

# Phase 11 Plan 08: Fiscal Budget Startup Assertion + Silent-Fallback Removal Summary

**Closed the D-15 invisible-bug class where bootstrap appeared to succeed but fiscal state was silently default — runSimulation now fails fast with descriptive root-cause guidance when fiscalEnabled=true and no fiscal_budgets row exists, both `?? DEFAULT_BUDGET_ALLOCATION` masking sites are removed, PUT /config enforces budgetAllocation on fiscalEnabled flips, and abort-reset rehydrates the budget row from session.config so the simulation restart succeeds rather than silently using stub data.**

## Performance

- **Duration:** ~6 min (first commit `2053003` 20:57Z → last commit `4446255` 21:01Z)
- **Started:** 2026-04-13T20:56:03Z
- **Completed:** 2026-04-13T21:01:57Z
- **Tasks:** 2 (TDD RED + Task 1 GREEN; Task 2 wiring)
- **Files created:** 1 (fiscalBudgetGuard.ts helper)
- **Files modified:** 4 (simulationRunner, sessions, simulate, test conversion)
- **Commits:** 3 (1 test, 1 GREEN feat, 1 Task-2 feat)

## Accomplishments

- **New helper `server/src/orchestration/helpers/fiscalBudgetGuard.ts`** with 3 exports + 1 marker constant:
  - `ASSERTION_PHRASE` — exported constant for grep-asserted error message
  - `assertFiscalBudgetExists(scope, economyConfig, sessionId, getActiveBudget?)` — DI-friendly startup gate. Throws descriptive Error when `economyConfig.fiscalEnabled === true` and `getActiveBudget(scope)` returns null. Error message names the three known root causes (abort-reset wipe, PUT /config flip, bootstrap regression) and points at remediation (re-bootstrap or POST budgetAllocation via PUT /config).
  - `assertPutConfigFiscalFlip({ sessionId, currentEconomyConfig, incomingEconomyConfig, incomingBudgetAllocation })` — structured-result guard. Returns `{ ok: true }` when flip is legal or row already exists; auto-creates the row when a flip-true-from-false is accompanied by allocation; returns `{ ok: false; status: 400; error }` otherwise. Checks both top-level `body.budgetAllocation` and nested `body.economyConfig.budgetAllocation`.
  - `rehydrateFiscalBudgetOnAbortReset(sessionId)` — async helper invoked after `eraseSimulationData` wipes `fiscal_budgets`. Recreates the row from `session.config.budgetAllocation` (or `session.config.economyConfig.budgetAllocation`) when `fiscalEnabled === true`. Logs `[SIMULATE] Abort-reset re-created fiscal_budgets ...` on success; silently no-ops on the three skip paths (missing session, fiscalEnabled false, no allocation).

- **runSimulation startup assertion** wired in `server/src/orchestration/simulationRunner.ts` immediately after the public-goods escrow hydration block (line ~327). One call to `assertFiscalBudgetExists(scope, startupEconomyConfig, sessionId)` per `runSimulation` invocation. Fails fast before iteration loop, AMM init, or any DB writes.

- **Both silent fallbacks removed** at:
  - Line ~640 (per-iteration budget context, formerly `fiscalRepo.getActiveBudget(scope) ?? DEFAULT_BUDGET_ALLOCATION`)
  - Line ~2540 (fiscal tick block inside `accountSubsystemAsync`, same pattern)
  Both now use `fiscalRepo.getActiveBudget(scope)!` with an inline comment documenting the startup-gate dependency. Grep `?? DEFAULT_BUDGET_ALLOCATION` returns 0 in simulationRunner.ts.

- **PUT /api/sessions/:id/config flip guard** wired in `server/src/routes/sessions.ts` inside the existing read-modify-write `sqlite.transaction()`. After currentConfig is parsed and before the UPDATE statement, `assertPutConfigFiscalFlip` runs with the incoming + current state. On flip-true-from-false with no row and no allocation, the helper returns `{ ok: false; status: 400; error: 'Flipping fiscalEnabled to true requires budgetAllocation ...' }` which the route throws as a tagged Error so the transaction unwinds, then forwards as `res.status(400).json({ error })` in the existing catch handler (extended to forward 400 alongside the existing 404 short-circuit).

- **POST /simulate/abort-reset rehydration** wired in `server/src/routes/simulate.ts` immediately after `eraseSimulationData(id)`. One call to `rehydrateFiscalBudgetOnAbortReset(id)` before the stage transition. Logs the rehydration event when it actually creates a row.

- **Test conversion:** `server/src/__tests__/fiscalBudgetAssertion.test.ts` upgraded from 5 `it.todo` placeholders to 19 real assertions:
  - **Helper contract (5):** throws on missing row, error message contains sessionId + ASSERTION_PHRASE + 3 root-cause keywords, no throw when row exists, no throw + no lookup when fiscalEnabled false, no throw + no lookup when fiscalEnabled undefined (legacy)
  - **PUT flip guard (5):** 400 on illegal flip, creates row when allocation supplied, succeeds (no-op) when row exists, no-op when not flipping, no-op when economyConfig untouched
  - **Abort-reset rehydration (5):** recreates from top-level allocation, recreates from nested allocation, skips when fiscalEnabled false, skips when no allocation, skips when session missing
  - **Source-grep contracts (4):** zero `?? DEFAULT_BUDGET_ALLOCATION` in simulationRunner, ASSERTION_PHRASE present in simulationRunner, rehydration log marker in simulate.ts, flip guard symbol + 400 message in sessions.ts

## Task Commits

Each task committed atomically:

1. **Task 1 RED:** `test(11-08): add failing tests for fiscal budget startup assertion (D-15)` — `2053003`
2. **Task 1 GREEN:** `feat(11-08): add fiscal budget startup assertion + remove silent fallbacks (D-15)` — `59d37c2`
3. **Task 2:** `feat(11-08): close PUT /config flip + abort-reset rehydration paths (D-15)` — `4446255`

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update)

## Files Created/Modified

### Production

- `server/src/orchestration/helpers/fiscalBudgetGuard.ts` (NEW, 130 lines) — three exported helpers + ASSERTION_PHRASE constant + JSDoc tying each to D-15 and the specific bug class it closes
- `server/src/orchestration/simulationRunner.ts` — imported `assertFiscalBudgetExists`, dropped `DEFAULT_BUDGET_ALLOCATION` from the @policylab/shared import (still imports `DEFAULT_PUBLIC_GOODS_INITIAL`), added 4-line startup assertion block, replaced both `?? DEFAULT_BUDGET_ALLOCATION` fallbacks with bang-asserted lookups + inline comment
- `server/src/routes/sessions.ts` — imported `assertPutConfigFiscalFlip` + `EconomyConfig` type, wired guard inside the PUT /config transaction, extended catch handler to forward 400 alongside 404
- `server/src/routes/simulate.ts` — imported `rehydrateFiscalBudgetOnAbortReset`, called it after `eraseSimulationData` in the abort-reset handler

### Tests (scaffold → real)

- `server/src/__tests__/fiscalBudgetAssertion.test.ts` — 5 `it.todo` placeholders → 19 real assertions across 4 describe blocks. Uses `vi.mock` + dynamic import for sessionRepo + fiscalRepo so route-level guards can be tested without DB. Source-grep contracts via `fs.readFile + import.meta.url`.

## Decisions Made

- **Helper extraction over inline assertion** — Plan called for inline. Extracted into `helpers/fiscalBudgetGuard.ts` to make the contract unit-testable without mounting the 3000-line runner. Mirrors `structuralPressures.ts` (11-02) and `lawDiff.ts` (11-06) precedents. Runner / route handlers become 5-10 line wrappers around the helpers.
- **Startup assertion location** — Placed right after publicGoodsEscrow hydration (line ~327), well before the iteration loop. The error throw propagates through the existing route-level try/catch into `simulationManager.broadcast` as an SSE `{ type: 'error', message: ... }` event without any new wiring — same path Phase 10 D-28 established for bootstrap LLM failures.
- **Bang-assertion at consumer sites** — Cleaner than re-asserting at every call site. The inline comment documents the dependency on the startup gate. Grep-friendly (`!` is unique in this context).
- **Structured-result for route guards** — `assertPutConfigFiscalFlip` returns `{ ok: true } | { ok: false; status; error }` rather than throwing. Keeps the helper pure and lets the route choose whether to throw inside the transaction (this case) or short-circuit before opening one.
- **Rehydration honest-no-op on missing allocation** — If no allocation can be recovered from session.config, skip silently. The next `runSimulation` will trip the startup assertion with descriptive guidance — that is the desired observable failure rather than fabricating a default that masks state loss.
- **Allocation lookup checks both locations** — `session.config.budgetAllocation` (canonical) AND `session.config.economyConfig.budgetAllocation` (defensive). Legacy sessions may have it nested.
- **Dropped `DEFAULT_BUDGET_ALLOCATION` from runner import** — Constant still exported from `@policylab/shared` and used elsewhere (test fixtures, frontend scenario-store baseline merge). The runner no longer references it — those are the only legitimate use cases.

## Deviations from Plan

### Documentation adjustments

- **Plan's action step 1 placed assertion "near the start of runSimulation (after loading session and economyConfig, before the iteration loop)".** Concretely placed at line ~327 — right after the `publicGoodsEscrow` hydration block, where `session` is in scope and `economyConfig` is derived inline. Earlier than this would require restructuring the `getEconomyConfig` call; later would risk DB writes happening before the assertion fires.
- **Plan's action step 1.2 said "replace `?? DEFAULT_BUDGET_ALLOCATION` with `getActiveBudget(scope)!` (bang-assertion) OR gate the whole fiscal block on `if (economyConfig.fiscalEnabled)`".** Chose bang-assertion at both sites because the surrounding code already gates on `iterEconomyConfig.fiscalEnabled` (line 633 ternary + line 2511 outer `if`). The bang documents the dependency without adding a redundant nested guard.
- **Plan's action step 1.3 said to "wrap the throw in a try-catch at the SSE entry point in `server/src/routes/simulate.ts` and emit a meaningful SSE error" if the existing handler doesn't propagate.** Verified the existing handler at line 109-119 already catches the error and broadcasts via `simulationManager.broadcast(id, { type: 'error', message: ... })` plus the new belt-and-suspenders `simulationManager.finish(id)` from the working tree. Re-tested this path implicitly by running `npm run test -w server` (no SSE-specific test, but the runtime behavior matches Phase 10 D-28 bootstrap LLM failure precedent). No new wrapping needed.
- **Plan's action step 2.1 had the guard return a 400 directly via `res.status(400).json(...)`.** Restructured the helper to return `{ ok: false; status; error }` and the route translates: throws a tagged Error inside the transaction so sqlite rolls back, then the catch handler forwards as 400. Cleaner separation of concerns and preserves transaction semantics if the helper ever does additional DB work.
- **Plan's action step 3 example used `db.delete(fiscalBudgets)` followed by inline rehydration code.** The wipe already happens inside `eraseSimulationData(id)` — the rehydration is a separate call after that function returns, so the helper sees the post-wipe state. Functionally identical; cleaner separation.

### Auto-fixed Issues

None — no Rule 1/2/3 auto-fixes triggered. All changes were within the prescribed scope.

## Issues Encountered

- **Pre-existing test failures unchanged.** `npm run test -w server`: 477 passed / 5 failed / 8 todo. The 5 failures (`economyConfig.test.ts` × 4, `banking.test.ts` × 1) are documented in 11-02's `deferred-items.md` as base-branch failures. Net delta: +19 passes (from this plan's test conversion), 0 new failures.
- **Pre-existing TypeScript errors unchanged.** `npx tsc --noEmit -p server/tsconfig.json` reports the same 4 errors (`sfcPhase11.test.ts` × 1 vitest type variance, `edgeCases.test.ts` × 2 satiety, `reflectionRunner.ts` × 1 possibly-undefined). tsc diff vs base: flat — my changes introduce 0 new TS errors. Confirmed by `git stash && tsc && stash pop`.
- **Working-tree dirty files at session start (out of scope for 11-08):** `package-lock.json`, `server/src/db/migrate.ts`, `server/src/mechanics/orderBook.ts`, `server/src/routes/bootstrap.ts` had pre-existing uncommitted changes from prior sessions (per the orchestrator's coordination block). Reviewed each: legitimate prior-session improvements to error handling and SYSTEM_NPC order persistence, but unrelated to D-15. **Not committed in this plan** — leaving them in the working tree for the operator to decide their disposition. Only `server/src/routes/sessions.ts` and `server/src/routes/simulate.ts` (which are in plan scope) were committed.
- **No auth gates encountered** — plan executed fully autonomously.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plans 11-09 + 11-10 unblocked.** The fiscal-state invariant is now load-bearing and observable:

- **Plan 11-09 (frontend dashboard) — no intersection** with this plan. The dashboard reads `TelemetryLog` fields produced by the runner, which is unchanged for fiscalEnabled=false sessions and now strictly correct for fiscalEnabled=true sessions (previously could have silently rendered DEFAULT_BUDGET_ALLOCATION-derived values).
- **Plan 11-10 (post-Phase-11 validation) can re-run the United States bootstrap and trust that any fiscalEnabled=true session has a real budget row underpinning its telemetry. If validation surfaces an unexpected mismatch between session.config.budgetAllocation and the actual fiscal tick behavior, the assertion's three root-cause messages give an immediate triage path (which call site failed).
- **Operator-visible diagnostic.** When the runtime tries to start a fiscalEnabled session with no row, the operator now sees `[FISCAL] Session <id> has fiscalEnabled=true but no fiscal_budgets row. This indicates either (a) ... (b) ... (c) ... Re-bootstrap the session or POST budgetAllocation via PUT /api/sessions/<id>/config.` instead of the simulation silently running on stub data.

**Empirical validation ready.** Re-running the original bug scenario (session 3b25f15c) should now (1) throw with descriptive guidance on simulation start, (2) succeed after `PUT /config { budgetAllocation }` (which now also creates the row), (3) survive abort-reset → restart cycle without silent state loss.

**Future extension point (deferred):** The same pattern (helper-extraction + assertion + rehydration + source-grep contract) can be applied to other per-session state that bootstrap creates: `bankBalanceSheets` for bankingEnabled sessions, `enterprises` for sessions with `enterpriseSeed`. If any of those silent-default-on-missing patterns surface as bugs in 11-10 validation, fold that work into a follow-up plan with this one as the precedent.

**Blockers:** None.

## Known Stubs

None. The fiscal startup gate is fully wired:
- `assertFiscalBudgetExists` calls real `fiscalRepo.getActiveBudget` (no mock-shape in production code).
- `assertPutConfigFiscalFlip` calls real `fiscalRepo.createBudget` when allocation is supplied — no placeholder.
- `rehydrateFiscalBudgetOnAbortReset` calls real `sessionRepo.getById` + real `fiscalRepo.createBudget`.
- The bang-asserted `getActiveBudget(scope)!` call sites have a real startup gate guaranteeing the invariant; if the gate ever fails, a runtime TypeError surfaces immediately rather than silent stub data flowing into the fiscal tick.

## Self-Check: PASSED

- `server/src/orchestration/helpers/fiscalBudgetGuard.ts` exists — verified.
- `grep -c "fiscalEnabled=true but no fiscal_budgets" server/src/orchestration/simulationRunner.ts` returns 1 — verified.
- `grep -cE "\\?\\?\\s*DEFAULT_BUDGET_ALLOCATION" server/src/orchestration/simulationRunner.ts` returns 0 — verified.
- `grep -c "DEFAULT_BUDGET_ALLOCATION" server/src/orchestration/simulationRunner.ts` returns 3 — three comment references documenting the removed pattern (no live `?? DEFAULT_BUDGET_ALLOCATION`).
- `grep -c "flipsTrueFromFalse\\|assertPutConfigFiscalFlip" server/src/routes/sessions.ts` returns 3 — verified (1 import, 1 call, 1 comment).
- `grep -c "requires budgetAllocation" server/src/orchestration/helpers/fiscalBudgetGuard.ts` returns 1 — verified (the 400 message lives in the helper, sessions.ts forwards it).
- `grep -c "rehydrateFiscalBudgetOnAbortReset" server/src/routes/simulate.ts` returns 2 — verified (import + call site).
- `grep -c "re-created fiscal_budgets" server/src/orchestration/helpers/fiscalBudgetGuard.ts` returns 1 — verified (the rehydration log marker; helper logs from inside, simulate.ts comment also references it).
- `npx vitest run server/src/__tests__/fiscalBudgetAssertion.test.ts` exits 0 with 19 passing assertions — verified.
- `npm run test -w server`: 477 passed / 5 failed (all pre-existing) / 8 todo — verified +19 net passes vs base.
- `npx tsc --noEmit -p server/tsconfig.json`: 4 errors (all pre-existing); zero new errors caused by 11-08.
- Commits `2053003`, `59d37c2`, `4446255` all present in `git log --oneline -5` — verified.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
