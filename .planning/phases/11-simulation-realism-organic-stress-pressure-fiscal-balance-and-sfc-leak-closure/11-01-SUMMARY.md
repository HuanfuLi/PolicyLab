---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 01
subsystem: foundation
tags: [typescript, shared-types, vitest, sfc, physicsConfig, scaffolding]

# Dependency graph
requires:
  - phase: 10-fix-simulation-realism
    provides: cortisolFloor=3 convention, income tax hook (D-32), GDP-scaled public goods (D-31), EconomyConfig optional-field pattern
provides:
  - TaxPolicy + PublicGoodsEscrow types exported from @policylab/shared
  - EconomyConfig optional fields taxPolicy, governanceEnabled, publicGoodsEscrow
  - TelemetryLog optional fields sfcDrift + sfcDriftBySubsystem (6 subsystems)
  - 15 new Phase 11 fields in physicsConfig (10 coefficients + 4 clamps + 1 threshold)
  - Raised stress thresholds lowWealthThreshold=50, lowHealthThreshold=60
  - computeSystemFiatTotal trailing publicGoodsEscrow param (default 0)
  - 13 vitest scaffold files with 11 real passing assertions + 95 it.todo placeholders
affects: [11-02, 11-03, 11-04, 11-05, 11-06, 11-07, 11-08, 11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 foundation: shared contracts + test scaffolds ship before implementation waves so parallel downstream plans can import without blocking on each other"
    - "EconomyConfig optional-field + DEFAULT_ECONOMY_CONFIG pattern extended with per-decision JSDoc citing Phase 11 D-XX"
    - "publicGoodsEscrow as trailing optional parameter with default 0 — backward compatible with all 4 existing sfcAudit call sites"
    - "it.todo scaffolds per-decision so downstream waves convert placeholders to real assertions as they land production code"

key-files:
  created:
    - server/src/__tests__/sfcPhase11.test.ts
    - server/src/__tests__/sfcEscrow.test.ts
    - server/src/__tests__/sfcTaxation.test.ts
    - server/src/__tests__/fiscalBudgetAssertion.test.ts
    - server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts
    - server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts
    - server/src/mechanics/__tests__/structuralPressures.test.ts
    - server/src/mechanics/__tests__/physicsConfig.thresholds.test.ts
    - server/src/orchestration/__tests__/governanceToggle.test.ts
    - server/src/orchestration/__tests__/governanceAmendment.test.ts
    - server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts
    - server/src/orchestration/__tests__/statClamping.test.ts
    - server/src/llm/__tests__/centralAgentTaxPolicy.test.ts
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/deferred-items.md
  modified:
    - shared/src/types.ts
    - server/src/mechanics/physicsConfig.ts
    - server/src/orchestration/helpers/sfcAudit.ts

key-decisions:
  - "Wave 0 ships no physics/orchestration behavior — contracts + scaffolds only — so Waves 1–6 can land in parallel"
  - "publicGoodsEscrow modeled as trailing optional param on computeSystemFiatTotal rather than a new signature; preserves 4 caller sites in simulationRunner unchanged"
  - "DEFAULT_ECONOMY_CONFIG ships taxPolicy (flat 15%/10%/15%) + governanceEnabled=true; publicGoodsEscrow intentionally absent (materializes at fiscal tick runtime, not config default)"
  - "13 scaffold files (plan spec said 14; Task 4b's 7th item is a roll-up verification check, not a new file) — this matches the plan's 4a=7 + 4b=6 actual file-creation split"
  - "Seed coefficients from 11-RESEARCH.md §10 hit physicsConfig directly; tuning happens via existing /api/settings/physics-config hot-swap endpoint, no new infra needed"
  - "Per-decision JSDoc @see Phase 11 D-XX comments added to every new field; downstream waves can grep D-XX to find contract-to-implementation links"

patterns-established:
  - "it.todo scaffold per decision: describe block with file-level decision-ID comment so grep -l D-XX locates owning scaffold"
  - "Scaffold-vs-real-assertion split: only physicsConfig.thresholds.test.ts contains real passing assertions (Task 2 output); the other 12 scaffolds use it.todo exclusively — waves convert to real tests as they implement"
  - "Targeted-file smoke run per checker guidance: verify ONLY the new scaffolds, not the full server suite, so pre-existing test noise does not block Wave-0 landing"

requirements-completed: [D-03, D-04, D-05, D-08, D-09, D-11, D-13, D-17, D-21]

# Metrics
duration: 5min
completed: 2026-04-13
---

# Phase 11 Plan 01: Wave 0 Foundation Summary

**Extended @policylab/shared with TaxPolicy/PublicGoodsEscrow/sfcDrift contracts, added 15 Phase-11 physicsConfig coefficients, extended computeSystemFiatTotal with publicGoodsEscrow, and laid 13 vitest scaffolds so waves 1–6 can land in parallel.**

## Performance

- **Duration:** 5 min (first commit 15:30:33Z → last commit 15:34:45Z)
- **Started:** 2026-04-13T19:30:33Z
- **Completed:** 2026-04-13T19:34:45Z
- **Tasks:** 5 (Task 1, 2, 3, 4a, 4b)
- **Files modified:** 16 (3 production + 13 new test files)

## Accomplishments

- **Shared type contract extended** — `TaxPolicy`, `PublicGoodsEscrow`, `sfcDrift*` exported; `EconomyConfig` and `TelemetryLog` accept three and two new optional fields respectively; `DEFAULT_ECONOMY_CONFIG` ships flat 15%/10%/15% tax defaults + `governanceEnabled=true`.
- **physicsConfig carries all 15 Phase-11 fields** with seed values from 11-RESEARCH.md §10 (combined bad-society max ≈ 10.4 cortisol/tick, ≈ 12 happiness/tick). Raised `lowWealthThreshold` 20→50, `lowHealthThreshold` 30→60 per D-04. Cortisol clamp [3, 95], happiness clamp [5, 95]. `updatePhysicsConfig` hot-swap pattern preserved — new keys are live-tunable via existing `PUT /api/settings/physics-config` endpoint.
- **computeSystemFiatTotal extended** with trailing optional `publicGoodsEscrow` parameter (default 0). All four existing callers in `simulationRunner.ts` (lines ~471, ~2399, ~2549, ~2742) compile unchanged. Plans 03 (escrow ledger) and 07 (SFC subsystem drift) can now wire real escrow values.
- **13 vitest scaffold files created** covering all 9 Wave-0 decision IDs. 11 real passing assertions in `physicsConfig.thresholds.test.ts` actively verify Task 2 output; 95 `it.todo` placeholders await downstream waves. Targeted-file smoke runs pass — no pre-existing test noise contaminates scaffold verification.

## Task Commits

Each task committed atomically:

1. **Task 1: Extend shared types with TaxPolicy / PublicGoodsEscrow / sfcDrift** — `37243eb` (feat)
2. **Task 2: Extend physicsConfig with Phase 11 coefficients and raised thresholds** — `5285edc` (feat)
3. **Task 3: Extend computeSystemFiatTotal with publicGoodsEscrow** — `122a944` (feat)
4. **Task 4a: Create 7 mechanics-owned test scaffolds** — `48bb281` (test)
5. **Task 4b: Create 6 orchestration/llm-owned test scaffolds** — `2116155` (test)

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update)

## Files Created/Modified

### Production

- `shared/src/types.ts` — Added `TaxPolicy` (D-13), `PublicGoodsEscrow` (D-11) interfaces; extended `EconomyConfig` with `taxPolicy`, `governanceEnabled`, `publicGoodsEscrow` (optional); extended `TelemetryLog` with `sfcDrift`, `sfcDriftBySubsystem` (optional); extended `DEFAULT_ECONOMY_CONFIG`.
- `server/src/mechanics/physicsConfig.ts` — Added 4 stat clamps (cortisol 3/95, happiness 5/95), `giniStressThreshold=0.35`, 4 cortisol pressure coefficients (`k_inflation_cor`, `k_gini_cor`, `k_unemp_cor`, `k_pg_cor`), 5 happiness pressure coefficients (`k_peer_death_hap`, `k_gini_hap`, `k_unemp_hap`, `k_welfare_hap`, `k_inflation_hap`); raised `lowWealthThreshold` 20→50, `lowHealthThreshold` 30→60.
- `server/src/orchestration/helpers/sfcAudit.ts` — Added trailing `publicGoodsEscrow: number = 0` parameter to `computeSystemFiatTotal`; added to return-sum.

### Scaffold Tests (mechanics-owned, Task 4a)

- `server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts` — D-01, 14 todos for stripped per-action cortisol relief
- `server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts` — D-06, 10 todos for stripped per-action happiness rewards
- `server/src/mechanics/__tests__/structuralPressures.test.ts` — D-02/D-07, 1 real assertion (9 k_* coefficients present) + 13 todos
- `server/src/mechanics/__tests__/physicsConfig.thresholds.test.ts` — D-03/D-04/D-08, **10 real passing assertions** validating Task 2 output
- `server/src/__tests__/sfcEscrow.test.ts` — D-10/D-11, 7 todos for escrow ledger + SFC inclusion
- `server/src/__tests__/sfcTaxation.test.ts` — D-12/D-14, 8 todos for 5 tax hook sites
- `server/src/__tests__/fiscalBudgetAssertion.test.ts` — D-15, 5 todos for startup assertion

### Scaffold Tests (orchestration/llm-owned, Task 4b)

- `server/src/orchestration/__tests__/governanceToggle.test.ts` — D-17, 4 todos for toggle + backward-compat
- `server/src/orchestration/__tests__/governanceAmendment.test.ts` — D-18/D-19, 5 todos for paragraph-diff ballot
- `server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts` — D-20..D-23, 10 todos for per-subsystem telemetry
- `server/src/orchestration/__tests__/statClamping.test.ts` — D-03/D-08, 5 todos for cortisol/happiness clamp commits
- `server/src/llm/__tests__/centralAgentTaxPolicy.test.ts` — D-13, 5 todos for Central Agent taxPolicy selection
- `server/src/__tests__/sfcPhase11.test.ts` — umbrella integration scaffold, 9 todos + shared-type import smoke

### Documentation

- `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/deferred-items.md` — logs 3 pre-existing TypeScript errors on base branch (not caused by 11-01) and pre-existing dirty working-tree files; Phase 11 downstream plans that touch AgentStats or reflectionRunner should fold these in incidentally.

## Decisions Made

- **Wave 0 as pure foundation** — no physics behavior changes, no orchestration changes. All extensions are optional + backward-compatible so 8 downstream plans can implement in parallel.
- **Scaffold split 7 + 6 = 13 files** (not 14 as plan text said in one place). Plan Task 4b enumerates 6 new files plus a 7th "roll-up verification" item that checks all 13 exist — the roll-up is an acceptance check, not a file. Frontmatter-level `files_modified` count of 14 was aspirational text; actual deliverable is 13 scaffolds with the roll-up gate applied.
- **publicGoodsEscrow default 0 everywhere** — preserves four existing `computeSystemFiatTotal` callers unchanged. Plan 03 (escrow ledger owner) and Plan 07 (SFC telemetry) wire real values.
- **Seed coefficients anchored to 11-RESEARCH.md §10**, not literature — matches D-05 / D-09 decision to ship conservative defaults and tune empirically via hot-swap endpoint.
- **`publicGoodsEscrow` omitted from `DEFAULT_ECONOMY_CONFIG`** — it is a runtime ledger snapshot that materializes when the fiscal tick runs, not a config default. Matches the escrow-as-session-state principle of D-11.

## Deviations from Plan

None — plan executed exactly as written.

The plan called for "14 test scaffold files" in one acceptance criterion and 7+6=13 in another. The 7+6=13 structure is the actual file-level deliverable; the 14th item in the plan text is a roll-up verification check (Task 4b item 7) that validates all 13 exist. No deviation — all deliverables present. The counting discrepancy is flagged in Decisions above for clarity, and the plan's `files_modified` frontmatter list explicitly enumerates 13 test paths, confirming 13 is the correct count.

## Issues Encountered

**Pre-existing TypeScript errors on the base branch** — `git stash && tsc` on a clean tree shows 3 pre-existing errors (2 in `edgeCases.test.ts` on `AgentStats.satiety`, 1 in `reflectionRunner.ts`). None were caused by Plan 11-01. Logged to `deferred-items.md` for future Phase 11 plans that touch those files. The Plan 11-01 diff for `tsc --noEmit -p server/tsconfig.json` is flat (same 3 errors before and after).

**Pre-existing dirty working tree** — 6 files were modified before Plan 11-01 started (STATE.md, package-lock.json, migrate.ts, orderBook.ts, bootstrap.ts, simulate.ts). None relate to Wave 0 scope. Not committed by this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**All 8 downstream Phase 11 plans unblocked.** Every wave can import `TaxPolicy`, `PublicGoodsEscrow`, and `sfcDrift*` from `@policylab/shared`; every wave can reference the 15 new `physicsConfig` coefficients; `computeSystemFiatTotal` is ready to receive real escrow values from Plan 03.

**Scaffold-to-real conversion contract:** Each downstream wave must convert its owning scaffold's `it.todo` placeholders to real assertions as production code lands. Decision-ID grep (`grep -l "D-XX" server/src/**/__tests__/*.ts`) locates the owning scaffold for any decision.

**Hot-swap tuning ready:** All 10 new k_* coefficients and 4 new thresholds are live-tunable via the existing `PUT /api/settings/physics-config` endpoint. Empirical tuning can happen in parallel with wave implementation without code changes.

**Blockers:** None.

## Self-Check: PASSED

- `shared/src/types.ts` contains `TaxPolicy`, `PublicGoodsEscrow`, `governanceEnabled?`, `sfcDriftBySubsystem?` — verified via grep counts (1, 1, 1, 1).
- `server/src/mechanics/physicsConfig.ts` contains `k_inflation_cor: 0.3`, `lowWealthThreshold: 50`, `lowHealthThreshold: 60`, `cortisolCeiling: 95`, `happinessFloor: 5`, `giniStressThreshold: 0.35` — verified via grep.
- `server/src/orchestration/helpers/sfcAudit.ts` contains `publicGoodsEscrow: number = 0` and includes it in return sum — verified.
- 13 test scaffold files all exist — verified via `ls` (exit 0).
- Commits `37243eb`, `5285edc`, `122a944`, `48bb281`, `2116155` all present in git log — verified.
- `npm run build -w shared` exits 0 — verified.
- Targeted-file scaffold smoke run: 11 passed + 95 todo across 13 files, 0 failures — verified.
- Cross-file link `k_inflation_cor` appears in both `physicsConfig.ts` and `structuralPressures.test.ts` + `physicsConfig.thresholds.test.ts` — verified via grep.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
