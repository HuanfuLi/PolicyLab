---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 02
subsystem: physics/orchestration
tags: [typescript, physicsEngine, simulationRunner, vitest, cortisol, happiness, structural-pressures, clamps]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: physicsConfig coefficients (k_* and clamps) + scaffold tests
provides:
  - Stripped per-action cortisol relief on 11 actions (WORK, WORK_AT_ENTERPRISE, REST, PRODUCE_AND_SELL, POST_BUY_ORDER, POST_SELL_ORDER, HELP, DEPOSIT, REPAY_LOAN, BUY_BOND, ISSUE_GOV_BOND)
  - Stripped per-action happiness reward on 8 actions (REST, POST_BUY_ORDER, POST_SELL_ORDER, PRODUCE_AND_SELL, DEPOSIT, REPAY_LOAN, BUY_SHARES, BUY_BOND)
  - New helper server/src/orchestration/helpers/structuralPressures.ts exporting applyStructuralPressures() — pure, DB-free, unit-testable
  - 4 cortisol structural pressures + 5 happiness structural pressures applied per iteration to every alive citizen
  - Bank / central_bank agent exclusion pattern for organic-stress loop
  - Raised clamp bounds applied at final stat commit: cortisol ∈ [3, 95], happiness ∈ [5, 95]
affects: [11-03, 11-04, 11-05, 11-06, 11-07, 11-08, 11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delta-return helper pattern: applyStructuralPressures takes a context object, mutates weekStateMap + statUpdates, returns a small telemetry result — no DB, no side-effects outside its context"
    - "Bank/central_bank filter: agent.type === 'bank' OR agent.role?.toLowerCase() === 'central_bank' — consistent with Phase 10 instititutional-agent pattern"
    - "Clamp-at-final-commit-site: raised bounds [3,95]/[5,95] applied ONLY at statUpdate rebuild, not on weekState.cortisolDelta accumulator (matches Phase 10 GC3 convention from STATE.md)"
    - "Trace-line preservation: strip edits rewrite string only, never delete trace.push — PhysicsLaboratory UI reads every trace line (Pitfall 1 from 11-RESEARCH.md)"

key-files:
  created:
    - server/src/orchestration/helpers/structuralPressures.ts
  modified:
    - server/src/mechanics/physicsEngine.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts
    - server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts
    - server/src/mechanics/__tests__/structuralPressures.test.ts
    - server/src/orchestration/__tests__/statClamping.test.ts
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/deferred-items.md

key-decisions:
  - "Extracted structural pressure logic to a standalone helper (structuralPressures.ts) rather than inlining in simulationRunner — unit-testable in isolation, matches the delta-return engine pattern (bankingEngine, capitalMarketEngine, fiscalEngine) and the pressure logic is self-contained enough to justify its own module"
  - "Applied clamps at BOTH the per-agent final-stats push AND the post-pressure re-clamp in the helper — the first-pass clamp at lines 1820-1822 now uses physicsConfig.cortisolCeiling/Floor directly so even if structural pressures skip an agent (e.g. all agents institutional), the Phase-11 bounds still apply"
  - "Hoisted `inflationSignalForPressure` as a let-binding outside the `if (inflationEnabled)` block rather than calling computeInflation twice — zero-cost structural coupling vs duplicate LLM-free computation"
  - "HELP action: stripped cortisol to 0 (D-01) but retained happiness +5 (altruistic outcome per D-06); reworded trace line to say 'outcome-driven, retained'"
  - "BUY_SHARES baseline cortisol was already 0 (WARNING 11 fix) — added explicit regression test (cortisolStrip.test.ts line 65) to guarantee no future regression upward, paired with happiness strip"
  - "Deviated from plan grep acceptance 'cortisolDelta: 10/4' — physicsEngine uses variable assignments (cor = 10) not object literals, so those greps never match; unit tests carry the real verification via expect(...).toBe(10) / toBe(4)"

patterns-established:
  - "Structural pressure loop excludes institutional agents via TWO predicates: agent.type === 'bank' OR agent.role?.toLowerCase() === 'central_bank'. Both are needed: bootstrap inserts a bank as type='bank' and centralBank.ts creates a role='central_bank' agent (different discriminators)"
  - "Post-cognition memory reads weekState.cortisolDelta/happinessDelta as RAW unclamped accumulator; persistence / telemetry reads statUpdates which are clamp-bounded. Keeps the cognition prompt honest about the direction and magnitude of pressure while the stat display stays within sane bounds"
  - "Bottom-quintile gating uses `statUpdate.wealth <= bottomQuintileCutoff` where cutoff = sortedWealth[floor(n * 0.2)].wealth — includes agents at the boundary (not strict <). Test coverage: 10-agent sample [10..100] → cutoff 30 → 3 agents (wealth 10, 20, 30) receive Gini pressure"

requirements-completed: [D-01, D-02, D-03, D-06, D-07, D-08]

# Metrics
duration: 8min
completed: 2026-04-13
---

# Phase 11 Plan 02: Structural Pressures & Symmetric Happiness/Cortisol Summary

**Stripped per-action cortisol/happiness on 19 actions, added 9 structural macro pressures in a new helper, and raised cortisol/happiness clamps to [3,95]/[5,95] — eliminating utopia bias so stress tracks real macro conditions rather than agent activity level.**

## Performance

- **Duration:** 8 min (first commit 15:45:00Z → last commit 15:49:33Z)
- **Started:** 2026-04-13T19:43:28Z
- **Completed:** 2026-04-13T19:50:51Z
- **Tasks:** 2 (strip + pressure injection)
- **Files modified:** 7 (2 production + 1 new helper + 4 test files + 1 doc)

## Accomplishments

- **11 cortisol strips landed in physicsEngine.ts** — WORK, WORK_AT_ENTERPRISE, REST, PRODUCE_AND_SELL, POST_BUY_ORDER, POST_SELL_ORDER, HELP, DEPOSIT, REPAY_LOAN, BUY_BOND, ISSUE_GOV_BOND all have `cor = 0` with trace strings reworded to "per-action relief removed; structural pressures apply at tick end". Outcome-driven cortisol preserved: STEAL +10, STRIKE +5, QUIT_JOB +4, SABOTAGE +18, EMBEZZLE +20.
- **8 happiness strips landed** — REST, POST_BUY_ORDER, POST_SELL_ORDER, PRODUCE_AND_SELL, DEPOSIT, REPAY_LOAN, BUY_SHARES (WARNING 11 fix: was +1), BUY_BOND → `hap = 0`. HELP +5 altruistic happiness retained per D-06; STRIKE +5, FOUND_ENTERPRISE +3, HIRE/FIRE/POST_JOB +2, APPLY_FOR_JOB +1 all retained.
- **New helper `server/src/orchestration/helpers/structuralPressures.ts`** — exports `applyStructuralPressures(context)`. Pure function, no DB, no HTTP. Takes a `StructuralPressureContext` (aliveAgents, weekStateMap, statUpdates, employmentRegistry, giniCoefficient, inflationSignal, publicGoodsQuality, lifecycleEvents). Mutates weekState deltas AND statUpdates cortisol/happiness. Returns a small `StructuralPressureResult` for telemetry.
- **Pressure coverage — cortisol (D-02):** `k_inflation_cor × max(0, CPI - expected)` for all citizens; `k_gini_cor × max(0, Gini - threshold)` for bottom-quintile only; `k_unemp_cor` for unemployed with wealth < lowWealthThreshold; `k_pg_cor × (1 - min(infra, edu, welfare)/50)` for all citizens.
- **Pressure coverage — happiness (D-07):** `−k_peer_death_hap × deathsThisTick` for all citizens; `−k_gini_hap × giniExcess` for bottom-quintile only; `−k_unemp_hap` for unemployed + low wealth; `−k_welfare_hap × (1 - welfareQuality/50)` for all citizens; `−k_inflation_hap × surprise` for all citizens.
- **Runner integration in simulationRunner.ts** — hoisted `inflationSignalForPressure` so the pressure block reads CPI surprise; inserted `applyStructuralPressures(...)` call immediately after the inflation tick closes and before `finalStatsByAgentId` is rebuilt; added a physics trace emit `[PHYSICS] Structural pressures applied to N citizens: Σcortisol=..., Σhappiness=..., deaths=...`.
- **Raised clamp bounds at final stat commit** (lines 1820-1822) — `newCortisol = clamp(physicsConfig.cortisolFloor=3, physicsConfig.cortisolCeiling=95, ...)`, `newHappiness = clamp(physicsConfig.happinessFloor=5, physicsConfig.happinessCeiling=95, ...)`. `runningCortisol` accumulator in the mid-iteration action-loop (line 1322) intentionally NOT clamped — preserves Phase 10 GC3 convention.
- **65 real passing assertions across 4 Phase-11-owned test files** (+ 16 in edgeCases regression) — 16 cortisol strip, 12 happiness strip, 15 structural pressure mechanics, 6 stat clamping. Wave 0 `it.todo` placeholders converted.

## Task Commits

Each task committed atomically with `--no-verify` per parallel-wave protocol:

1. **Task 1 RED: test(11-02): add failing tests for per-action cortisol/happiness strip** — `60e3ab6` (test)
2. **Task 1 GREEN: feat(11-02): strip per-action cortisol/happiness rewards per D-01 and D-06** — `726f462` (feat)
3. **Task 2: feat(11-02): structural pressure injection loop with raised clamps per D-02/D-03/D-07/D-08** — `4a4b885` (feat)

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update)

## Files Created/Modified

### Production

- `server/src/mechanics/physicsEngine.ts` — 11 cortisol + 8 happiness strips. Each action case: (a) delta assignment now `0`; (b) trace.push preserved with reworded string naming "per-action relief/reward removed; structural pressures apply at tick end"; (c) outcome-driven retained actions unchanged. No deletion of any trace line — Pitfall 1 honored.
- `server/src/orchestration/helpers/structuralPressures.ts` — NEW. Single export `applyStructuralPressures(ctx)`. Reads `physicsConfig.k_*`/thresholds/clamps from the hot-swappable config module — fully runtime-tunable via existing `PUT /api/settings/physics-config`. Institutional-agent exclusion via two-predicate filter. Returns `{ citizensAffected, deathsThisTick, totalCortisolPressure, totalHappinessPressure }`.
- `server/src/orchestration/simulationRunner.ts` — added import, hoisted inflation signal let-binding, inserted pressure block after inflation tick closes, raised clamps at final stat commit.

### Tests (scaffolds → real)

- `server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts` — 16 assertions: 11 strips + 4 outcome-driven retention guards (STEAL/STRIKE/QUIT_JOB/BUY_SHARES) + 1 trace string check
- `server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts` — 12 assertions: 8 strips + 4 retention guards (STRIKE/HELP/FOUND_ENTERPRISE/QUIT_JOB) incl WARNING 11 fix
- `server/src/mechanics/__tests__/structuralPressures.test.ts` — 15 assertions: 1 coefficient presence + 8 cortisol mechanics (incl bank + central_bank exclusion + hot-swap) + 6 happiness mechanics
- `server/src/orchestration/__tests__/statClamping.test.ts` — 6 assertions: clamp bounds present + ceiling saturation + floor saturation + floor-3 enforcement + raw-accumulator check

### Documentation

- `.planning/phases/11-.../deferred-items.md` — appended 5 pre-existing test failures (economyConfig.test.ts × 4, banking.test.ts × 1) verified out of scope via `git stash && vitest`.

## Decisions Made

- **Helper extraction over inlining** — plan offered a choice ("If the pressure loop is hard to test in isolation, extract"). I chose extraction unconditionally because (a) matches the pattern of bankingEngine/capitalMarketEngine/fiscalEngine (pure delta-return helpers), (b) unit tests don't have to mount the simulationRunner dependency graph, (c) the context object makes the integration point explicit at the call site.
- **Two-predicate institutional exclusion** — `agent.type === 'bank' || agent.role?.toLowerCase() === 'central_bank'` rather than a single-role check. Necessary because bootstrap inserts a bank as `type='bank'` (no role discriminator guaranteed) and the central bank is created with `role='central_bank'` (type may be plain `'agent'`).
- **First-pass clamp at 1820-1822 also raised** — the plan only explicitly required clamps at "final commit sites". The helper re-clamps statUpdates post-pressure, but if structural pressures skip (edge case: no alive citizens), the Phase-11 bounds must still apply. Applying at both places is defense-in-depth with zero computational cost.
- **Trace rewording uses "per-action relief removed" verbatim** — makes grep verification trivial (one string matches all 11 stripped cortisol actions). Count is 10 because REST/HELP/PRODUCE_AND_SELL share a single trace line that covers both cortisol and happiness commentary, but the cortisol-specific substring "per-action relief removed" appears on 10 lines (DEPOSIT/REPAY_LOAN/WORK/WORK_AT_ENTERPRISE/POST_ORDERS/HELP/PRODUCE_AND_SELL/BUY_BOND/ISSUE_GOV_BOND and also the REST combined line counts once). Happiness strip rewording uses "per-action reward removed" (count 7, also combined-line effects).
- **Post-hoc statUpdates mutation** — the helper mutates `statUpdates` cortisol/happiness fields directly because statUpdates are already built at lines 1879 (pre-inflation). Rebuilding statUpdates from scratch post-pressure would duplicate the death/humiliation/lock-variable logic — the in-place mutation is simpler and equivalent.
- **Used `employmentRegistry: Map<string, EmploymentRecord> | Set<string>` typing** — lets tests pass a plain `Set<string>` while production passes the full Map. Both have `.has()`, type union handles it.

## Deviations from Plan

### Scope-aligned auto-fixes

None — plan executed as specified.

### Documentation adjustments (Rule 2 territory: trivial accuracy)

- **Plan's grep acceptance `grep -c "cortisolDelta: 10"` / `grep -c "cortisolDelta: 4"` — the pattern never matches** because `physicsEngine.ts` assigns via `cor = 10` / `cor = 4` (variable), not an object literal like `cortisolDelta: 10`. No regression — the retention is proven by the real unit tests `expect(resolve('STEAL').cortisolDelta).toBe(10)` and `expect(resolve('QUIT_JOB').cortisolDelta).toBe(4)`. Noted in Decisions.
- **Plan referenced `physics_sandbox.ts` fixture factory from 11-RESEARCH.md §Wave 0** — no such file exists on the tree. Used the `makeAgent` helper pattern from `edgeCases.test.ts` (the canonical pattern). Each new test file defines its own `makeAgent`.

## Issues Encountered

- **Pre-existing test failures** — `npm run test -w server` reports 5 failures in `economyConfig.test.ts` (4) and `banking.test.ts` (1). Verified via `git stash && vitest` that these failures exist on the base branch unchanged. Logged to `deferred-items.md`. Zero impact on Phase-11-owned tests (65/65 green).
- **Pre-existing TypeScript errors** — tsc still reports 3 errors from Wave 0 (`edgeCases.test.ts` × 2 satiety, `reflectionRunner.ts` × 1). My new test files avoid these (satiety omitted). `tsc --noEmit` diff vs base: flat.
- **esbuild comment parse error on first-write of structuralPressures.ts** — JSDoc comment contained `@see .planning/phases/11-*/11-CONTEXT.md` — the `*/` character combination confused esbuild. Fixed by using plain prose: `See .planning/phases/11-.../11-CONTEXT.md D-01 through D-09`. No functional impact.

## User Setup Required

None.

## Next Phase Readiness

**Plans 11-03 through 11-10 unblocked.** The structural pressure helper is stable, unit-tested, and can be extended:
- Plan 11-03 (fiscal / escrow) — can feed its PublicGoodsEscrow ledger into a future extension of the helper's context if new pressures emerge from escrow underfunding.
- Plan 11-04+ (governance, tax shape) — no intersection with structural pressures; the pressure loop reads only physicsConfig + macro snapshots.
- Plans that touch simulationRunner.ts (e.g. 11-03 fiscal/escrow tick) — pressure injection is a ~25-line block at one call site; merge contention minimal.

**Empirical tuning unblocked.** All 9 k_* coefficients are hot-swappable via `PUT /api/settings/physics-config`. Structural-pressure tests verify hot-swap works (`k_inflation_cor=0` → zero inflation-surprise pressure).

**Utopia-bias baseline measurable.** Re-running the United States bootstrap for 5 iterations should now show non-monotonic cortisol (per 11-CONTEXT.md §Specifics) once Plan 11-03's fiscal changes land alongside.

**Blockers:** None.

## Known Stubs

None. All structural pressures are wired to real physicsConfig coefficients and real simulation state (statUpdates.wealth for bottom-quintile gating, employmentRegistry for unemployment, resolution.lifecycleEvents for deaths, inflationSignalForPressure for surprise, fiscalPublicGoodsQuality for pg underfunding). No placeholder values or hardcoded stubs ship in this plan.

## Self-Check: PASSED

- `server/src/orchestration/helpers/structuralPressures.ts` exists — verified via grep (applyStructuralPressures export present, 1 match).
- `server/src/mechanics/physicsEngine.ts` contains 10 "per-action relief removed" trace strings (cortisol) + 7 "per-action reward removed" strings (happiness) — verified via grep.
- `server/src/mechanics/physicsEngine.ts` contains 0 occurrences of `cortisolDelta: -3`, `-5`, `-2`, `-1` (all stripped) — verified.
- `server/src/orchestration/simulationRunner.ts` contains `applyStructuralPressures(` call site at line 2492 — verified.
- `server/src/orchestration/simulationRunner.ts` contains `physicsConfig.cortisolCeiling` and `physicsConfig.happinessFloor` — verified via grep.
- Commits `60e3ab6`, `726f462`, `4a4b885` all present in `git log --oneline -5` — verified.
- Phase-11 test suite: 65 passed across 4 test files (cortisolStrip 16, happinessStrip 12, structuralPressures 15, statClamping 6) + edgeCases regression 16 — verified via vitest run.
- SFC test suite: 41 passed across sfcBanking, sfcFiscal, sfcInflation, sfcCapitalMarkets (sfcInvariant.test.ts does not exist on this branch) — verified.
- `npm run build -w shared` exits 0 — verified.
- `tsc --noEmit -p server/tsconfig.json` diff vs base: flat (3 pre-existing errors unchanged, my new files clean).
- Cross-file link `k_inflation_cor` present in physicsConfig.ts AND structuralPressures.ts AND structuralPressures.test.ts — verified via grep.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
