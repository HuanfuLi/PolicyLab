# Phase 11 — Deferred Items (pre-existing, out of scope)

Discovered during Plan 11-01 execution. Present on `refactor/structural-decomposition` base branch BEFORE any 11-01 change. Not caused by 11-01 tasks; not in scope for Wave 0 foundation plan.

## Pre-existing TypeScript errors (verified via `git stash && tsc` on clean tree)

1. `server/src/mechanics/__tests__/edgeCases.test.ts:14` — `'satiety' does not exist in type 'AgentStats'`
2. `server/src/mechanics/__tests__/edgeCases.test.ts:15` — `'satiety' does not exist in type 'AgentStats'`
3. `server/src/orchestration/reflectionRunner.ts:200` — `Object is possibly 'undefined'`

Impact on 11-01: zero. `tsc --noEmit -p server/tsconfig.json` exits 3 errors both before and after Plan 11-01 — the diff is flat. Phase 11 future plans that touch `AgentStats` or `reflectionRunner` should fold these in as incidental fixes.

## Pre-existing dirty files in working tree (not 11-01)

The following files carry uncommitted edits from a prior session (visible in `git status` at 11-01 start):

- `.planning/STATE.md` (stale)
- `package-lock.json`
- `server/src/db/migrate.ts`
- `server/src/mechanics/orderBook.ts`
- `server/src/routes/bootstrap.ts`
- `server/src/routes/simulate.ts`

None relate to Plan 11-01 scope. Untouched by this plan's commits.

## Pre-existing test failures (verified during 11-02 via `git stash && vitest`)

Before Plan 11-02 edits, `npm run test -w server` showed 5 failures in 2 files that are unrelated to Phase 11 scope:

1. `server/src/__tests__/economyConfig.test.ts` — 4 failures on `baseLoanInterestRate` / `depositInterestRate` default mismatches (expects 0.005 / 0.003, actual 0.001 / 0.0005). Points to a previous defaults change.
2. `server/src/mechanics/__tests__/banking.test.ts` — 1 failure on `canIssueLoan(0, 0, 0, 0.10)` — logic change vs stale test.

Impact on 11-02: zero. All 65 Phase-11-owned tests (cortisolStrip, happinessStrip, structuralPressures, statClamping, edgeCases regression) pass. Folded forward as deferred — future phase touching banking defaults or canIssueLoan should fix.

## Agent-roster generation issues (surfaced during Phase 11 UAT, outside scope)

Observed while UAT-verifying 11-09 frontend on a China location bootstrap. These concern `centralAgent` roster generation / LLM prompts, not the Phase 11 (stress/fiscal/SFC) contract surface.

1. **Duplicated agent names in roster** — multiple agents in the same session share identical display names. Generation prompt does not enforce uniqueness, or the LLM is resampling without deduplication. Recommend: add a per-session name-dedup pass in `generateAgentRoster()` or extend the prompt with a "names must be unique across the roster" rule.
2. **All-Chinese-character names for China bootstrap** — a China location seed produces 100% Hanzi names with no romanization. Unclear whether intended (authenticity) or a bug (downstream UI truncation / search). At minimum, the frontend should handle multi-byte names gracefully in every roster view; at best, prompts should emit `{name, latinName}` pairs so both scripts are available.

Impact on Phase 11: zero. Neither issue touches stress pressures, fiscal escrow, tax withholding, governance, SFC drift, or budget assertions. Logged here so a follow-up phase (likely a "roster polish" or "agent generation hardening" phase) can pick them up.
