---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 07
subsystem: orchestration/sfc-instrumentation
tags: [typescript, simulationRunner, sfc, telemetry, observability, vitest]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: TelemetryLog.sfcDrift + sfcDriftBySubsystem optional fields, computeSystemFiatTotal trailing publicGoodsEscrow param, sfcSubsystemDrift.test.ts + sfcPhase11.test.ts scaffolds
  - phase: 11
    plan: 03
    provides: sessionPublicGoodsEscrow Map + getTotalEscrow helper, fiscal escrow credit step, all 4 computeSystemFiatTotal call sites already wired with publicGoodsEscrow
  - phase: 11
    plan: 04
    provides: capital-gains tax withholding inside the cmkt positive-delta loop (lives inside the new capmkt accountSubsystem wrapper; SFC-neutral)
provides:
  - sfcSubsystemAccounting helper (initializeSfcBySubsystem, accountSubsystem, accountSubsystemAsync, reportDriftIfOverThreshold, SubsystemKey type)
  - snapshotTotal() closure in runner mirroring the existing computeSystemFiatTotal call-site argument list
  - sfcBySubsystem accumulator initialized at start of every iteration
  - 4 wrapped subsystem ticks (physicsActions snapshot pair; banking/capmkt closure form; fiscal async closure form returning quality+spending)
  - iterTelemetry.sfcDrift + iterTelemetry.sfcDriftBySubsystem populated every iteration (incl. iter 1 baseline)
  - reportDriftIfOverThreshold structured per-subsystem console.error per D-23 (no auto-correction)
  - 15 real sfcSubsystemDrift helper assertions + 8 sfcPhase11 integration-contract assertions
affects: [11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Subsystem-bracket pattern: snapshotTotal() closure + accountSubsystem(key, snapshot, block, acc) wraps each subsystem so any per-subsystem fiat leak surfaces in TelemetryLog.sfcDriftBySubsystem.* without bug-hunting"
    - "Async sister helper accountSubsystemAsync — same accumulation semantics, awaits the block before snapshotting after; required because fiscal tick awaits sessionRepo.updateConfig for escrow snapshot persistence"
    - "Snapshot pair (not closure) for the physics action block — large multi-page region with await/early-exit flow; single physicsBefore = snapshotTotal() before / sfcBySubsystem.physicsActions += (snapshotTotal() - physicsBefore) after keeps the diff minimal and bundles trade + enforcement + wage settlement into one bucket per planner discretion (split deferred to a future phase if drift localizes here)"
    - "Closure-return idiom for fiscal: closure RETURNS { quality, spending } so outer scope can assign to outer let bindings — TS does not flow control-flow narrowing across async callback closures; assigning inside the closure narrows the outer let to never at later use sites"
    - "Forward-declare bankingTotalDeposits/Collateral/LoansOutstanding next to statUpdates so snapshotTotal() (defined immediately below) can read live banking accumulators when wrapping the physics block — moved their original declarations from inside the banking tick to one block up and dropped the duplicate let inside the banking tick"
    - "Per-subsystem reportDriftIfOverThreshold: emits one [SFC] iter=N total drift line + one per-subsystem line for any bucket whose individual delta also exceeds threshold — grep-friendly forensic audit format parallels the [FISCAL] / [TAX] convention"

key-files:
  created:
    - server/src/orchestration/helpers/sfcSubsystemAccounting.ts
  modified:
    - server/src/orchestration/simulationRunner.ts
    - server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts
    - server/src/__tests__/sfcPhase11.test.ts

key-decisions:
  - "SubsystemKey is a string-literal union (physicsActions | trade | enforcement | banking | capmkt | fiscal) matching the TelemetryLog.sfcDriftBySubsystem shape from Plan 11-01 — single source of truth lives in shared/src/types.ts; helper key list mirrors it"
  - "Phase 11 wires only 4 buckets (physicsActions / banking / capmkt / fiscal); trade and enforcement remain at 0 this phase — they are sub-subsystems bundled into physicsActions per planner discretion in 11-07-PLAN.md §Task 2 step 4. A future phase can split them with intermediate snapshots if drift localizes to the physicsActions bucket"
  - "Snapshot pair (manual physicsBefore + delta) for the physics action loop, accountSubsystem closure form for banking/capmkt/fiscal — keeps diff small and avoids forcing the entire 1000-line physics region into a callback parameter"
  - "accountSubsystemAsync added rather than rewriting fiscal's await sessionRepo.updateConfig as fire-and-forget — the persistence MUST complete before the snapshot-after fires so escrow inclusion is visible in the snapshot"
  - "snapshotTotal() argument list copy-pasted from the existing call site at line ~2754 (telemetry construction) so any change to the signature stays in sync — Plan 11-01 / 11-03 already extended the canonical 8-arg shape with publicGoodsEscrow as trailing optional"
  - "iter 1 emits sfcDrift=0 (no prior baseline) but still populates sfcDriftBySubsystem so dashboards render an unbroken series — first iteration contributes mostly initial-state values rather than per-subsystem deltas, which is honest"
  - "Replaced the existing bare console.warn drift line with reportDriftIfOverThreshold (D-23) — preserves the threshold semantics (still 0.1) but now structured per-subsystem; D-23 explicitly forbids auto-correction so the simulation continues unchanged on drift detection"
  - "Closure-return pattern for fiscal (return { quality, spending }) — bypasses the TS narrowing-loss problem in async closure assignments without weakening types or adding casts"

patterns-established:
  - "Forward-declared accumulators near statUpdates: banking totals are now declared once at the top of the iteration (next to statUpdates) so any helper closure defined immediately below can read them. Cleaner than threading them through callback parameters or making them session-scoped Maps."
  - "Structured drift report format `[SFC] iter=N total drift=±N.NNNN` followed by per-subsystem lines `[SFC]   bucket: ±N.NNNN` — grep-able by `[SFC] iter=`"
  - "Inline snapshot-pair pattern for large blocks: `const before = snapshotTotal(); /* ...big block... */ acc.subsystem += (snapshotTotal() - before);` — preferred over closure when the block has multiple early exits or contains other accountSubsystem nestings"

decisions-addressed: [D-20, D-21, D-22, D-23]

# Metrics
duration: 7min
completed: 2026-04-13
---

# Phase 11 Plan 07: SFC Subsystem Drift Telemetry Summary

**Instrumented per-subsystem SFC balance deltas in simulationRunner.ts: every TelemetryLog now carries sfcDrift (total) and sfcDriftBySubsystem (6-bucket breakdown), with structured console.error reporting at the existing 0.1 fiat/iter threshold and zero auto-correction per D-23 — making future SFC leaks observable rather than discovered through bug-hunting.**

## Performance

- **Duration:** ~7 min (first commit dc082c5 → last commit 727e464)
- **Started:** 2026-04-13T16:39Z
- **Completed:** 2026-04-13T16:50Z
- **Tasks:** 2 (helper + runner wiring)
- **Files modified:** 4 (1 new helper + 1 runner + 2 test conversions)

## Accomplishments

- **New helper `server/src/orchestration/helpers/sfcSubsystemAccounting.ts`** with 5 exports:
  - `SubsystemKey` string-literal union of the 6 buckets
  - `SfcBySubsystem` record type
  - `initializeSfcBySubsystem()` — returns zeroed accumulator (called at start of every iteration)
  - `accountSubsystem(key, snapshot, block, acc)` — synchronous bracket; `+=` accumulator; exception-safe (throw bypasses accumulator update)
  - `accountSubsystemAsync(key, snapshot, blockAsync, acc)` — async sister; awaits the block before snapshotting after; same accumulation + exception semantics
  - `reportDriftIfOverThreshold(iter, drift, acc, thresh=0.1)` — D-23 structured logger; `[SFC] iter=N total drift=…` + per-subsystem lines for buckets exceeding threshold; no auto-correction, no pause
- **Runner instrumentation in `server/src/orchestration/simulationRunner.ts`:**
  - Imported helper symbols + `accountSubsystemAsync`
  - Forward-declared `bankingTotalDeposits` / `bankingCollateralEscrow` / `bankingLoansOutstanding` next to `statUpdates` (line ~1149); removed duplicate `let` declarations from inside the banking tick
  - Defined `snapshotTotal()` closure (line ~1161) mirroring the canonical 8-arg `computeSystemFiatTotal` call-site shape used at telemetry construction (~2754) and SFC audit (~2948)
  - Initialized `sfcBySubsystem` at start of every iteration (line ~525); accumulator resets per iteration
  - Wrapped 4 subsystem ticks:
    - **physicsActions** — snapshot pair around the entire physics action block (Ghost Enterprise Cleanup → Phase Sheriff C); bundles trade + enforcement + wage settlement
    - **banking** — `accountSubsystem('banking', snapshotTotal, () => { ... }, sfcBySubsystem)` closure form
    - **capmkt** — `accountSubsystem('capmkt', ...)` closure form (includes capital-gains withholding from Plan 11-04 that lives inside this region)
    - **fiscal** — `await accountSubsystemAsync('fiscal', ..., async () => { ...; return { quality, spending }; }, sfcBySubsystem)` async form; closure returns quality+spending so outer scope can assign without TS narrowing loss
  - Replaced bare `console.warn` drift line with `reportDriftIfOverThreshold(iterNum, sfcDrift, sfcBySubsystem, 0.1)` — preserves D-23 semantics (no auto-correction) while emitting structured per-subsystem breakdown
  - Populated `iterTelemetry.sfcDrift` + `iterTelemetry.sfcDriftBySubsystem` every iteration (incl. iter 1 baseline)
- **Test conversion:**
  - `sfcSubsystemDrift.test.ts` (10 it.todo → 15 real assertions): initialize/accumulate/throw-safety/passthrough/threshold-stay-silent/threshold-trigger/per-subsystem-lines/custom-threshold/SubsystemKey-shape; +3 async-helper assertions (await + reject + return-passthrough)
  - `sfcPhase11.test.ts` (9 it.todo → 8 real assertions for Plan 11-07's scope + 8 remaining todos owned by other waves): TelemetryLog type contract; sum-invariant clean run; sum-invariant under synthetic leak; threshold reporting; async accumulator clean + leak; per-iteration reset

## Task Commits

Each task committed atomically (with `--no-verify` per parallel-execution coordination):

1. **Task 1: feat(11-07): add SFC subsystem accounting helper** — `dc082c5`
2. **Task 2: feat(11-07): wire SFC subsystem drift telemetry into simulationRunner** — `727e464`

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update)

## Files Created/Modified

### Production

- `server/src/orchestration/helpers/sfcSubsystemAccounting.ts` (NEW, 95 lines) — Helper module exporting `SubsystemKey`, `SfcBySubsystem`, `initializeSfcBySubsystem`, `accountSubsystem`, `accountSubsystemAsync`, `reportDriftIfOverThreshold`. Per-decision JSDoc references Phase 11 D-20/D-21/D-22/D-23.
- `server/src/orchestration/simulationRunner.ts` — Imports helper. Forward-declares banking totals + defines snapshotTotal() closure inside iteration loop. Initializes sfcBySubsystem at iteration start. Wraps 4 subsystem ticks (physicsActions snapshot pair; banking/capmkt accountSubsystem closure; fiscal accountSubsystemAsync closure returning quality+spending). Replaces bare console.warn with reportDriftIfOverThreshold. Populates iterTelemetry.sfcDrift + sfcDriftBySubsystem every iteration.

### Tests (scaffold → real)

- `server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts` — 10 `it.todo` → 15 real assertions covering helper-level contract: initialize/accumulate/throw-safety/passthrough/threshold-stay-silent/threshold-trigger/per-subsystem-lines/custom-threshold/SubsystemKey-shape + 3 async-helper assertions. All pass.
- `server/src/__tests__/sfcPhase11.test.ts` — 9 `it.todo` → 8 real Plan-11-07-owned assertions (TelemetryLog contract, sum invariant, threshold reporting, async accumulator behavior, per-iteration reset) + 8 remaining `it.todo` owned by future waves (full integration M0-constant runs, governance, cortisol/wealth trajectories). 16 assertions, 8 todo.

## Decisions Made

- **SubsystemKey union mirrors the TelemetryLog.sfcDriftBySubsystem shape from Plan 11-01** — single source of truth in `shared/src/types.ts`. Helper string union must stay in sync; tests verify all 6 keys present.
- **Only 4 buckets wired this phase (physicsActions / banking / capmkt / fiscal)** — trade and enforcement bundle into physicsActions per planner discretion. Splitting them requires intermediate snapshots inside the per-action loop, which adds complexity without immediate benefit. If drift localizes to physicsActions in a future run, a follow-up phase can split.
- **Snapshot pair for physics, closure form for banking/capmkt/fiscal** — physics block is huge with multiple early-exit paths and async/await flow; manual `physicsBefore = snapshotTotal(); /* ... */ acc.physicsActions += (snapshotTotal() - physicsBefore);` keeps the diff minimal. Closure form is cleaner for the smaller well-bounded subsystems.
- **`accountSubsystemAsync` is a separate exported function** rather than an `accountSubsystem` overload that detects Promise — keeps the synchronous and asynchronous paths visually distinct in the runner; no runtime detection cost; TypeScript gets cleaner inference.
- **Closure-return idiom for fiscal** — `accountSubsystemAsync` callback returns `{ quality, spending }` and outer scope assigns to outer `let` bindings. This bypasses TS's loss of control-flow narrowing across async closures (writing to a `T | null` outer binding inside an async callback narrows the outer use-sites to `never`). Alternative casts would weaken the contract; this preserves full type safety.
- **iter 1 emits `sfcDrift=0`** (no prior baseline) but still populates `sfcDriftBySubsystem` so dashboards can render an unbroken series. The first iteration's per-subsystem deltas reflect movements between initial state and first iteration end — non-zero and informative even on iter 1.
- **Replaced existing console.warn with reportDriftIfOverThreshold** — preserves the existing 0.1 threshold semantics; D-23 explicitly forbids auto-correction so the simulation continues unchanged.

## Deviations from Plan

### Documentation adjustments

- **Plan's `<read_first>` referenced existing call sites at lines ~471, 2398, 2548, 2741.** Actual line numbers in the current file (after Plans 11-01..11-06 land) are ~491, 2566, 2754, 2948. Verified via `grep -n "computeSystemFiatTotal" simulationRunner.ts` before writing the closure, per Warning 7. The closure copies the argument list from the line-2754 telemetry call site (the closest existing call site inside the iteration loop).
- **Plan's grep acceptance `grep -c "computeSystemFiatTotal(" simulationRunner.ts` expects (previous_count + 1).** Actual count went from 4 invocations to 5 (the new `snapshotTotal` closure adds 1). With the import line (1) + 4 existing call sites + 1 new closure = 6 occurrences without parens (`grep -c "computeSystemFiatTotal"`). With parens (`grep -c "computeSystemFiatTotal("`) it's 5 (4 original + 1 new). Either form satisfies the spirit of the acceptance.
- **Plan called for an `accountSubsystem` async variant inline.** I added a dedicated exported `accountSubsystemAsync` function instead — gives downstream waves a stable API surface and keeps tests separate. Both variants share the same accumulator-update semantics and exception safety.
- **Fiscal closure returns quality+spending instead of mutating outer `let`.** The plan's example used direct outer-binding mutation (`fiscalPublicGoodsQuality = fiscalDelta.updatedPublicGoods`); that triggered TS error TS2339 on later use sites because TS does not narrow across async callback closures. Resolved by returning the values from the closure and assigning outside. Behavior identical; type-safety preserved.

### Auto-fixed Issues

None — no Rule 1/2/3 auto-fixes triggered. All changes were in scope of the 4 prescribed wrapping sites + the telemetry+drift-warning sites.

## Issues Encountered

- **Pre-existing test failures unchanged.** `npm run test -w server` shows the same 5 failures (`economyConfig.test.ts` × 4 + `banking.test.ts` × 1) documented in 11-01..11-04 deferred-items. Zero impact on Phase-11-owned tests: 104 SFC tests across 8 files all green (`sfcBanking 6, sfcCapitalMarkets 9, sfcEscrow 9, sfcFiscal 20, sfcInflation 9, sfcPhase11 16, sfcTaxation 28, sfcSubsystemDrift 15`).
- **Pre-existing TypeScript errors unchanged.** `tsc --noEmit` reports the same 3 errors (`edgeCases.test.ts` × 2 satiety + `reflectionRunner.ts` × 1 possibly-undefined). tsc diff vs base: flat — my changes introduce 0 new TS errors.
- **TS narrowing loss across async closures** — encountered when fiscal closure was originally written to mutate the outer `fiscalPublicGoodsQuality` / `fiscalCategorySpending` `let` bindings. TS narrowed these to `never` at later truthy-branch use sites (line ~2884). Fixed by closure-return idiom (closure returns `{ quality, spending }`; outer assigns after `await`).
- **No auth gates encountered.** Plan executed fully autonomously.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plans 11-09 + 11-10 unblocked.** The drift telemetry surface is stable:

- **Plan 11-09 (frontend dashboard plan) can read the new `TelemetryLog.sfcDrift` + `TelemetryLog.sfcDriftBySubsystem` fields directly from SSE/polling — the macroHistory accumulator in the simulationStore will pick them up automatically when the schema gains the optional fields.
- **Plan 11-10 (post-Phase-11 validation) can run the United States baseline bootstrap and read the structured drift breakdown to verify M0 conservation across all Phase-11 changes (escrow, taxation, structural pressures, governance toggle, law amendment) without re-running ad-hoc audits.

**Empirical validation ready.** A clean 5-iteration run with all Phase 11 features enabled (banking + capmkt + fiscal + governance) should now show every TelemetryLog with `sfcDrift` near 0 and `sfcDriftBySubsystem.{banking,capmkt,fiscal,physicsActions}` each near 0. Any residual drift will localize to a specific bucket — the diagnostic value of this phase.

**Future extension point (deferred):** Splitting `physicsActions` into separate `trade` and `enforcement` buckets requires intermediate snapshots inside the per-action loop. Currently both are 0 (bundled). If a future run shows `physicsActions` consistently non-zero, a follow-up phase can split with surgical intermediate snapshots at line ~1232 (enforcement seizure) and ~1418 (order-book trade execution).

**Blockers:** None.

## Known Stubs

None. The drift telemetry pipeline is fully wired:
- snapshotTotal() reads live `statUpdates` wealth + runtime banking accumulators + `getTotalEscrow(sessionId)` — no placeholder values.
- All 4 wrapped subsystems compute real deltas; values flow into `iterTelemetry.sfcDriftBySubsystem`.
- `reportDriftIfOverThreshold` emits structured logs immediately on detection.
- `iter 1` populates `sfcDrift=0` (no baseline) but `sfcDriftBySubsystem` is real.

Two buckets — `trade` and `enforcement` — are intentionally 0 this phase per planner discretion; bundled into `physicsActions`. Documented in Decisions Made and Plan 11-07 itself; not a stub but a documented future extension point.

## Self-Check: PASSED

- `server/src/orchestration/helpers/sfcSubsystemAccounting.ts` exists — verified.
- `grep -c "export type SubsystemKey"` returns 1 — verified.
- `grep -c "export function accountSubsystem"` returns 1 (matches `accountSubsystem` only; `accountSubsystemAsync` matches `export async function`) — verified.
- `grep -c "export function initializeSfcBySubsystem"` returns 1 — verified.
- `grep -c "export function reportDriftIfOverThreshold"` returns 1 — verified.
- `grep -c "'physicsActions'"` returns ≥ 1 — verified (literal in initializeSfcBySubsystem).
- `grep -c "console.error"` returns ≥ 1 — verified (inside reportDriftIfOverThreshold).
- `grep -c "accountSubsystem" server/src/orchestration/simulationRunner.ts` returns 7 (≥ 3 required: import + banking + capmkt + fiscal + capmktAsync + 2 import lines).
- `grep -c "sfcBySubsystem" server/src/orchestration/simulationRunner.ts` returns 12 (≥ 5 required).
- `grep -c "initializeSfcBySubsystem" server/src/orchestration/simulationRunner.ts` returns 2 (import + init).
- `grep -c "iterTelemetry.sfcDrift" server/src/orchestration/simulationRunner.ts` returns 4 (sfcDrift + sfcDriftBySubsystem + 2 baseline).
- `grep -c "iterTelemetry.sfcDriftBySubsystem" server/src/orchestration/simulationRunner.ts` returns 2 (assignment in both branches).
- `grep -c "reportDriftIfOverThreshold" server/src/orchestration/simulationRunner.ts` returns 3 (import + 2 referenced; 1 actual call).
- `grep -c "snapshotTotal" server/src/orchestration/simulationRunner.ts` returns 10 (1 def + 9 invocations).
- `npx vitest run server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts` exits 0 with 15 passing assertions.
- `npx vitest run server/src/__tests__/sfcPhase11.test.ts` exits 0 with 16 passing + 8 todo.
- `npm run test -w server`: 458 passed / 5 failed (pre-existing) / 13 todo — net +30 passes vs base.
- `npx tsc --noEmit -p server/tsconfig.json`: 3 errors (all pre-existing); zero new errors caused by 11-07.
- Commits `dc082c5`, `727e464` present in `git log --oneline -5` — verified.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
