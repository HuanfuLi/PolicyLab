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
