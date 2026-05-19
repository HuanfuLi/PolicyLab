---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
verified: 2026-04-26T23:50:00Z
status: gaps_found
score: 7/11 must-haves verified
re_verification: false
gaps:
  - truth: "DB persistence: enterprise employees, lastApplicants, lastVacancies, and wage are NOT written back to DB during iteration — only read at session startup"
    status: failed
    reason: "enterpriseRepo has no UPDATE path for employees, last_applicants, last_vacancies, or wage. Changes made by the matching pass and processWageAdjustment live only in-memory. On pause/resume, the DB is reloaded (line 298) resetting lastApplicants=0, lastVacancies=0, employees to bootstrap snapshot, and wage to initial bootstrap wage."
    artifacts:
      - path: "server/src/db/repos/enterpriseRepo.ts"
        issue: "Only updateEnterpriseInsolvencyAsync exists (insolvency counter + isBankrupt). No updateEnterpriseEmployees, updateEnterpriseWage, or updateEnterpriseLabourMarket function."
      - path: "server/src/orchestration/simulationRunner.ts"
        issue: "Line 298: getEnterprises() loads from DB at startup; lines 311-312 hardcode lastApplicants=0, lastVacancies=0. No enterprise state is written back to DB after matching pass or wage adjustment."
    missing:
      - "Add updateEnterpriseStateAsync(enterpriseId, { wage, employees, lastApplicants, lastVacancies }) to enterpriseRepo.ts"
      - "Call it at end of each iteration (asyncLogFlusher path) so pause/resume restores correct runtime state"
      - "Restore lastApplicants/lastVacancies from DB on session resume, not hardcode to 0"

  - truth: "Employee deduplication: bootstrap employees JSON contains duplicate UUIDs when LLM generates agents with duplicate names"
    status: failed
    reason: "agentNameToId is a Map built from citizenRows (line 514 bootstrap.ts). If two AgentBlueprints share the same name, the second overwrites the first in the Map. The round-robin employee assignment then pushes the same UUID multiple times into entEmployees. The in-memory Set<string> at runtime deduplicates, but the DB employees JSON column stores the raw array with duplicates."
    artifacts:
      - path: "server/src/routes/bootstrap.ts"
        issue: "Line 514: new Map(citizenRows.map(r => [r.name, r.id])) — duplicate agent names produce a Map that maps the name to only one UUID. Line 526: entEmployees.push(resolvedId) with no deduplication guard before push."
      - path: "server/src/data/dataBootstrapPipeline.ts"
        issue: "buildBlueprint() line 526: entEmployees.push(resolvedId) does not check for duplicates."
    missing:
      - "Deduplicate entEmployees array before assigning to blueprint: replace plain push with Set-based deduplication"
      - "In bootstrap.ts, validate that blueprint names are unique before building agentNameToId; if duplicates exist, append a disambiguating suffix"

  - truth: "Wage adjustment and lastApplicants/lastVacancies feedback loop is broken on pause/resume: DB reload resets all signals to 0"
    status: partial
    reason: "Within a single continuous server session, processWageAdjustment reads ent.lastApplicants and ent.lastVacancies from in-memory EnterpriseRecord that was populated by the previous matching pass. This works correctly in memory. However, the live smoke showed wages stayed at 25 for 6 iterations (iters 1-6) before any movement — suggesting the first 6 iterations had lastApplicants=lastVacancies=0 because the matching pass populates AFTER the D-01 wage adjustment runs (correct order), but the very first iteration has no prior matching pass data. The subsequent wage crash at iter 9 was caused by a FOUND_ENTERPRISE action creating a wage=0 enterprise, which was fixed in commit e0db800 but is unrelated to this gap."
    artifacts:
      - path: "server/src/orchestration/simulationRunner.ts"
        issue: "Lines 311-312: lastApplicants and lastVacancies hardcoded to 0 on DB load. After pause/resume the entire wage feedback signal resets, making the first post-resume iterations behave like iteration 1."
    missing:
      - "Persist lastApplicants and lastVacancies to DB at end of each iteration (via enterpriseRepo update)"
      - "Restore them from DB on session reload rather than hardcoding to 0"

  - truth: "Reservation wage telemetry (reservationWageP25/P50/P75) is hollow when no agents used PRODUCE_AND_SELL"
    status: partial
    reason: "The telemetry computes reservation wages by reading sessionReservationWages, then falling back to max(minimumWage*0.5, 1)=2.5 for agents with no PAS history. When most agents are employed (dominant case for Germany), very few have real PAS reservation wages; all report the floor value 2.5. The live smoke showed these fields as 'undefined' in macroSnapshots, contradicting the code. Investigation of the macroSnapshotRepo shows the fields are passed via conditional spread (...(snapshot.reservationWageP25 !== undefined ? ...)) — the value is defined (2.5) in code, but the live smoke JSON had them as null in DB rows. This suggests the macro snapshot insert was not including these fields in the session-germany run, possibly because that session predates the migration guard and the DB columns did not exist yet when those snapshots were written."
    artifacts:
      - path: "server/src/db/repos/macroSnapshotRepo.ts"
        issue: "Line 56-58: reservationWageP25/P50/P75 only inserted when !== undefined. The telemetry block always computes them (minimum is floor 2.5), so they should be defined. The gap is more likely a migration timing issue: the DB columns may not have existed for the session-germany run."
    missing:
      - "Confirm migration was run before the session-germany smoke test (ALTER TABLE macro_snapshots ADD COLUMN reservation_wage_p25 REAL)"
      - "Add an integration test that verifies reservationWageP25/P50/P75 are non-null in macroSnapshot after iteration 1 even with zero PAS activity"

  - truth: "PAS calibration (ammSubsistenceCalibrationFactor=1.0) does not reduce PAS margin in a real session — the factor is a knob set to no-op"
    status: partial
    reason: "The default ammSubsistenceCalibrationFactor is 1.0, which means the AMM food pool is sized identically to pre-Phase 12 behavior. The 12-06 smoke test uses a special thin-pool configuration (createAMMForSession with targetSpotPrice=0.6) that is NOT the same as what a real 30-agent session produces. A real session uses avgWealth*agentCount fiat reserve with targetSpotPrice=6.0, producing a much larger pool. The factor of 1.0 on a 30-agent session leaves PAS margin unchanged. The D-09 target (median net ~0) is only achievable when factor >= 8-12 in a typical session. The unit test passes because it uses a special parameterization that already achieves subsistence margin — it does not validate the real-session default."
    artifacts:
      - path: "shared/src/types.ts"
        issue: "DEFAULT_ECONOMY_CONFIG.ammSubsistenceCalibrationFactor = 1.0. D-09 says median net ~0; the smoke test achieves this via a thin pool, not via a real-session calibration."
      - path: "server/src/orchestration/__tests__/laborSmoke.test.ts"
        issue: "Test uses createAMMForSession(1, 100, 0.6, 0, factor) which has spot price 0.6. Real sessions use spot price ~6.0 and much larger pools; factor=1.0 has zero compression effect on real sessions."
    missing:
      - "Run calibration test with real-session pool parameters (agentCount=30, avgWealth~100, targetSpotPrice=6.0) to determine the factor needed to hit D-09 median~0"
      - "Update DEFAULT_ECONOMY_CONFIG.ammSubsistenceCalibrationFactor to the calibrated value, OR document that factor must be set per-session in scenario config"

  - truth: "L-02: creative-mode enterprise generation is implemented but not wired into any bootstrap call path"
    status: partial
    reason: "creativeEnterpriseGeneration.ts exports generateEnterprisesFromCentralAgent with correct retry logic and validator, but it is never called from the creative-mode bootstrap route. The centralAgent.ts design pipeline (overview → law → agents) does not invoke enterprise generation. Creative-mode sessions have enterprises generated via generateEnterprises (location-mode function) in dataBootstrapPipeline.ts, which does not receive the Central Agent LLM client. D-06/D-15 was planned; the module exists with tests, but the wiring to the actual creative-mode flow is absent."
    artifacts:
      - path: "server/src/data/creativeEnterpriseGeneration.ts"
        issue: "Module exists and compiles with correct D-05 invariant logic. But no caller in bootstrap or centralAgent.ts imports or calls generateEnterprisesFromCentralAgent."
      - path: "server/src/llm/centralAgent.ts"
        issue: "Design generation pipeline does not call generateEnterprisesFromCentralAgent after generating the agent roster."
    missing:
      - "Wire generateEnterprisesFromCentralAgent into the creative-mode bootstrap flow (centralAgent.ts or the session creation route)"
      - "Pass the LLM provider, overview, and agentRoster from the session creation context"

  - truth: "L-11: unemploymentRate shows correctly in live Germany run but reservationWageP25/P50/P75 are null in macroSnapshots DB — SSE telemetry path is wired but DB persistence missed reservation wage columns in the session-germany run"
    status: partial
    reason: "Code analysis shows the telemetry computation and DB insert are correct. The null values in session-germany likely predate the schema migration. New sessions should have correct behavior. However, the macroSnapshotRepo.ts uses (row as any).reservationWageP25 to read back the values — this type-unsafe cast suggests the Drizzle schema definition and the TypeScript inference are not aligned, risking silent null returns even when migration succeeds."
    artifacts:
      - path: "server/src/db/repos/macroSnapshotRepo.ts"
        issue: "Lines 27-33: uses (row as any).reservationWageP25 etc. These fields are in the Drizzle schema (schema.ts lines 244-249) and should be strongly typed without any-cast. The cast may mask column-not-found errors."
    missing:
      - "Remove (row as any) casts for Phase 12 macroSnapshot fields; use the Drizzle schema inference directly"
      - "Add integration test asserting reservationWageP25/P50/P75 non-null after iter 1 in a fresh session"
human_verification:
  - test: "Live wage convergence toward MRP over 20 iterations"
    expected: "avgPostedWage chart should show non-flat movement within 5 iterations: rising when vacancies > applicants, stabilizing near MRP (food_spot × 10 − 2) by iteration 15-20"
    why_human: "Requires live simulation; wage trajectory depends on LLM action distribution, AMM prices, and enterprise survival"
  - test: "Unemployment rate convergence"
    expected: "Should start near 1.0, drop to [0.05, 0.3] by iteration 5, stabilize thereafter. If Germany run is representative, it peaked at 0.9 (iter 9) due to wage crash from the FOUND_ENTERPRISE=0 bug (now fixed in e0db800)"
    why_human: "Requires live simulation with the bug fix applied"
  - test: "PAS subsistence behavior with employed vs unemployed agents"
    expected: "Employed agents should choose WORK_AT_ENTERPRISE; unemployed should prefer APPLY_FOR_JOB; PAS should be rare when employment market is active"
    why_human: "LLM behavior; requires reading agent intent narratives"
  - test: "Creative-mode enterprise generation wiring"
    expected: "A fresh creative-mode session (Describe a Society) should produce enterprises with capacity matching the D-05 invariant and sector coverage matching the society overview"
    why_human: "Requires live session creation to verify the wiring gap is addressed"
---

# Phase 12: Labor Market Realism Verification Report

**Phase Goal:** Make paid employment the primary livelihood for citizen agents and PRODUCE_AND_SELL a genuine subsistence fallback for those who cannot find work. Three coupled deliverables: (1) demographic-aligned enterprise generation in both location and creative modes so every employable agent has at least one plausible employer; (2) a dynamic labor market where enterprises post wages that adjust per-iteration against applicant pressure, vacancy pressure, and P&L, bounded by marginal revenue product of labor, with agents using a reservation-wage anchor from last-period self-production; (3) PRODUCE_AND_SELL recalibrated so its net proceeds barely cover subsistence food cost.

**Verified:** 2026-04-26T23:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (L-01 through L-11)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| L-01 | Location-mode bootstrap produces enterprises with total capacity >= 1.05 × employable agents | VERIFIED | `generateEnterprises` in `dataBootstrapPipeline.ts:460-613` implements D-04/D-05 with auto-inflation loop; `enterpriseGeneration.test.ts` has 3 passing assertions for 110% target. Germany: 2 enterprises but capacity 9+25=34 vs 28 employable = 1.21× (passes). |
| L-02 | Creative-mode enterprise generation covers all >=5% workforce sectors with >=1 enterprise | PARTIAL | `creativeEnterpriseGeneration.ts` exists with correct D-05 invariant logic and passing tests. BUT: it is never called from the creative-mode bootstrap path — `centralAgent.ts` does not invoke `generateEnterprisesFromCentralAgent`. Creative-mode sessions fall back to `generateEnterprises` (location-mode function). D-06/D-15 wiring gap. |
| L-03 | D-05 invariant auto-inflates enterprise count or capacity on failure, logs correction | VERIFIED | Auto-inflation loop at `dataBootstrapPipeline.ts:615-673`; logs `[Phase 12 L-03] Vacancy invariant: auto-inflate`; test `L-03: console.info with 'Vacancy invariant: auto-inflate' is the correction marker` passes. |
| L-04 | Reservation wage populated from last-period PAS net proceeds; fallback to max(minimumWage×0.5, 1) | VERIFIED | `simulationRunner.ts:1510-1518`: reservation wage set at PAS resolution using `economyDelta.wealthDelta`; read at `simulationRunner.ts:947-949` for matching pass and prompt. Fallback floor at line 948. |
| L-05 | Hybrid wage adjustment: linear nudge (applicant/vacancy pressure) + profit-share top-up + min floor | VERIFIED | `enterpriseEngine.ts:258-370` implements all 5 D-01 steps in correct order. `laborMarket.test.ts` has 5 passing assertions covering surplus nudge, shortage nudge, profit topup (P&L>0 and P&L<=0), and min floor. |
| L-06 | MRP ceiling: wage <= (spot × productionPerWorker) − perWorkerInputCost; skipped when spot<=0 or NaN | VERIFIED | `enterpriseEngine.ts:320-339`: MRP ceiling implemented with `if (spot > 0 && Number.isFinite(spot))` guard. 3 passing tests in `laborMarket.test.ts` covering clamp, zero-spot skip, NaN skip. |
| L-07 | PRODUCE_AND_SELL median net proceeds ~0 at steady state over 10 iterations (±0.5 fiat) | PARTIAL | `laborSmoke.test.ts` smoke test passes with a thin-pool configuration (targetSpotPrice=0.6), not a real-session pool (targetSpotPrice=6.0, 30 agents). Default `ammSubsistenceCalibrationFactor=1.0` has no compression effect in real sessions. Germany smoke: 50 PAS occurrences across 16 iters and 30 agents = very low frequency, suggesting employed agents skip PAS as designed, but there is no post-hoc verification that the PAS net proceeds were ~0 for those 50 cases. |
| L-08 | WORK_AT_ENTERPRISE description shows agent's actual wage (D-17); PAS description reframed as subsistence (D-18) | VERIFIED | `shared.ts:38-41`: WORK_AT_ENTERPRISE default description present; `agent-intent.ts:421-429`: per-agent override built from `personalStatus.employerWage`; `shared.ts:26-28`: PAS description reframed to "Farm your land for subsistence..." with ~4 units wording. 3 passing tests in `promptContent.test.ts`. |
| L-09 | APPLY_FOR_JOB matching pass: greedy best-offer (highest wage first, tie-break smallest workforce), wage >= reservation_wage filter | VERIFIED | `matchingPass.ts` extracted helper with correct algorithm. `matchingPass.test.ts` has 9 passing assertions covering highest-wage placement, tie-breaker, vacancy decrement, unmatched applicant, already-employed skip, multi-applicant ordering, quit reapply, D-03 persistence, SFC. |
| L-10 | QUIT_JOB adds agent to sessionQuitLastIteration for auto-reapply next iteration | VERIFIED | `enterpriseActionDispatch.ts` QUIT_JOB handler (found in search) adds to `sessionQuitLastIteration`; consumed by matching pass at `simulationRunner.ts:1376-1378`. |
| L-11 | All 7 labor-market telemetry fields (avgPostedWage, unemploymentRate, reservationWageP25/P50/P75, vacanciesTotal, applicantsTotal, displacedThisIteration) emitted per-iteration and persisted | PARTIAL | `TelemetryLog` in `shared/src/types.ts:334-350` has all 8 fields (7 labor + displaced). `simulationRunner.ts:3619-3711` computes and emits them. `macroSnapshots` schema at `schema.ts:241-249` has all 8 columns. `macroSnapshotRepo.ts:54-62` inserts them. Germany smoke: `avgPostedWage` and `unemploymentRate` populated correctly; `reservationWageP25/P50/P75` were null in DB (likely pre-migration session, not a code bug). Dashboard in `EconomicDashboard.tsx:372-513` renders all 4 panels. **Gap**: `(row as any)` type-unsafe casts in macroSnapshotRepo may mask read failures; reservationWage fields untested in integration path. |

**Score: 7/11** truths verified (L-01, L-03, L-04, L-05, L-06, L-08, L-09, L-10 verified; L-02, L-07, L-11 partial)

---

## Required Artifacts

| Artifact | Expected (per PLANs) | Status | Details |
|----------|---------------------|--------|---------|
| `shared/src/types.ts` | TelemetryLog Phase 12 fields, EconomyConfig tunables, EnterpriseBlueprint capacity | VERIFIED | All 8 TelemetryLog fields, 4 EconomyConfig fields, `capacity?: number` on EnterpriseBlueprint. |
| `server/src/orchestration/simulationState.ts` | EnterpriseRecord.capacity/lastApplicants/lastVacancies, sessionReservationWages, sessionQuitLastIteration | VERIFIED | All 3 EnterpriseRecord fields, both Maps, cleanup in `cleanupSessionState`. |
| `server/src/db/schema.ts` | enterprises.capacity, last_applicants, last_vacancies; macroSnapshots 8 new columns | VERIFIED | All columns present at lines 312-317 and 241-249. |
| `server/src/db/migrate.ts` | ALTER TABLE guards for enterprise columns and macroSnapshot columns | VERIFIED | PRAGMA-check guards at lines 406-413 and 422-433. |
| `server/src/db/repos/enterpriseRepo.ts` | insertEnterprise persists capacity; loadEnterprises reads capacity; UPDATE path for runtime state | PARTIAL | `insertEnterprise` and `getEnterprises` correct. **Missing**: no `updateEnterpriseState` function for employees, wage, lastApplicants, lastVacancies — these fields are never written back to DB during simulation. |
| `server/src/mechanics/enterpriseEngine.ts` | `processWageAdjustment` pure function | VERIFIED | Full implementation at lines 258-370; exported; tests pass. |
| `server/src/orchestration/helpers/matchingPass.ts` | `runApplyForJobMatching` extracted helper | VERIFIED | File exists with full D-13 algorithm; 9 tests pass. |
| `server/src/orchestration/helpers/isEmployableAgent.ts` | `isEmployableAgent` predicate per D-07 | VERIFIED | File exists; 13 tests pass. |
| `server/src/data/dataBootstrapPipeline.ts` | generateEnterprises with 110% vacancy target, D-05 invariant, auto-inflation | VERIFIED | Full implementation with auto-inflation loop; tests pass. |
| `server/src/data/creativeEnterpriseGeneration.ts` | generateEnterprisesFromCentralAgent with retryWithHealing | WIRED_BUT_UNWIRED | Module compiles and has passing tests. NOT wired into creative-mode bootstrap flow. |
| `server/src/llm/prompts/shared.ts` | buildActionDictionary(overrides?) + PAS rewritten description + employment board | VERIFIED | Override parameter at line 156; PAS description at line 27-28; employment board with reservation wage at line 402-433. |
| `server/src/llm/prompts/agent-intent.ts` | Per-agent wage override for WORK_AT_ENTERPRISE; reservationWage passed to board | VERIFIED | Lines 421-429 (override build); line 401 (board call with reservationWage); line 969 (reservationWageForAgent passed). |
| `server/src/orchestration/helpers/marketBoard.ts` | buildEmploymentBoardEntries with vacancies/workforce/capacity | VERIFIED | Lines 41-44 populate Phase 12 fields. |
| `server/src/orchestration/simulationRunner.ts` | Wage adjustment preamble; matching pass at line ~1296; telemetry; displaced counter | VERIFIED | All four insertion points confirmed. |
| `server/src/db/repos/macroSnapshotRepo.ts` | Insert and read Phase 12 labor-market fields | PARTIAL | Insert correct; read uses `(row as any)` cast which bypasses Drizzle type safety. |
| `web/src/components/EconomicDashboard.tsx` | 4 new labor-market chart panels (D-21) | VERIFIED | Lines 372-513 render avgPostedWage, unemploymentRate, vacancies vs applicants, displaced events. |
| Test files (6 files) | laborMarket.test.ts, enterpriseGeneration.test.ts, matchingPass.test.ts, laborSmoke.test.ts, sfcInvariant.test.ts, promptContent.test.ts | VERIFIED | 53 test files pass; 591 tests pass; 8 todos pending (L-04 behavioral todos and 3 L-11 telemetry unit test todos). |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `generateEnterprises` | `EnterpriseBlueprint.capacity` | each blueprint sets capacity explicitly | VERIFIED | `buildBlueprint()` at line 550: `capacity: capacityPerEnt` |
| `D-05 invariant check` | console.info auto-inflate trace | fires on vacancy shortfall | VERIFIED | `dataBootstrapPipeline.ts:635`: `console.info('[Phase 12 L-03]...')` |
| `processWageAdjustment` | `EnterpriseRecord.wage` (in-memory) | mutating assignment after math | VERIFIED | `enterpriseEngine.ts:362`: `ent.wage = wage` |
| `simulationRunner preamble` | `processWageAdjustment` | call between registry load and employment board | VERIFIED | `simulationRunner.ts:719`: `const wageResult = processWageAdjustment(wageAdjInput)` |
| `sessionReservationWages` | PAS resolution | set at PRODUCE_AND_SELL action case | VERIFIED | `simulationRunner.ts:1514-1518` |
| `sessionReservationWages` | matching pass | read via `sessionReservationWages.get(sessionId)` | VERIFIED | `simulationRunner.ts:1384` |
| `QUIT_JOB dispatch` | `sessionQuitLastIteration` | add after clearing employmentRegistry | VERIFIED | Confirmed via grep in enterpriseActionDispatch.ts |
| `matchingPass lastApplicants/lastVacancies` | `processWageAdjustment` next iteration | read from in-memory EnterpriseRecord | VERIFIED (in-memory only) | Works in single continuous session; breaks on pause/resume (DB resets to 0) |
| `enterpriseRepo.insertEnterprise` | DB `enterprises.capacity` | write at bootstrap | VERIFIED | `enterpriseRepo.ts:37`: capacity written |
| `enterpriseRepo.getEnterprises` | DB `enterprises.capacity` | read at session startup | VERIFIED | `enterpriseRepo.ts:54-56`: capacity read with legacy guard |
| `enterprises.employees` | DB `employees` JSON column | written at bootstrap, NEVER updated during simulation | BROKEN | No UPDATE path in enterpriseRepo for employees; on resume, DB shows bootstrap snapshot with possible duplicates |
| `enterprises.last_applicants/last_vacancies` | DB persist | updated by matching pass | BROKEN | No UPDATE path; runtime state only; resets to 0 on resume |
| `enterprises.wage` | DB persist | updated by processWageAdjustment | BROKEN | No UPDATE path; runtime wage only; resets to bootstrap wage on resume |
| `TelemetryLog Phase 12 fields` | `macroSnapshots` DB | inserted via macroSnapshotRepo | VERIFIED | All 8 fields in insert path |
| `macroSnapshots DB` | SSE telemetry → frontend `macroHistory` | via getSessionTelemetry → `/api/telemetry` endpoint → simulationStore.loadMacroHistory | VERIFIED | Path confirmed through route handler and store |
| `buildActionDictionary(overrides)` | WORK_AT_ENTERPRISE description with actual wage | actionSchemaOverrides in agent-intent.ts | VERIFIED | Lines 421-429 and 432 |
| `buildEmploymentBoardSection(reservationWage)` | reservation wage in prompt | passed from simulationRunner line 969 | VERIFIED | Lines 401, 969 |
| `creativeEnterpriseGeneration.ts` | creative-mode bootstrap | called from centralAgent.ts or bootstrap route | BROKEN | Module exists but has no caller in production code |
| `displacedThisIteration counter` | bankruptcy release loops | incremented at lines 1993 and 2011 | VERIFIED | Two distinct increment sites confirmed |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `EconomicDashboard.tsx` (avgPostedWage panel) | `macroHistory[i].avgPostedWage` | `simulationRunner.ts:3628-3637` computes workforce-weighted avg; persisted to DB | YES — computed from live `enterpriseRegistry` each iteration | FLOWING |
| `EconomicDashboard.tsx` (unemploymentRate panel) | `macroHistory[i].unemploymentRate` | `simulationRunner.ts:3621-3625` computes from `isEmployableAgent` filter + employmentRegistry | YES — computed from live agent+employment state | FLOWING |
| `EconomicDashboard.tsx` (vacancies/applicants panel) | `vacanciesTotal`, `applicantsTotal` | `simulationRunner.ts:3640-3642, 3394` | YES — vacancies from live enterpriseRegistry; applicants from matching pass count | FLOWING |
| `EconomicDashboard.tsx` (displaced panel) | `displacedThisIteration` | `simulationRunner.ts:1993, 2011` incremented in bankruptcy loops | YES — real bankruptcy displacement count | FLOWING |
| `matchingPass.ts` (applicant pool) | `applicantIds` | APPLY_FOR_JOB from LLM intents + sessionQuitLastIteration | YES — real LLM-generated actions | FLOWING |
| `processWageAdjustment` (lastApplicants) | `ent.lastApplicants` | Set by matching pass at `matchingPass.ts:117` | YES — within single session; HOLLOW after pause/resume (resets to 0) | STATIC on resume |
| `sessionReservationWages` | `rwMap.get(agentId)` | Set at PAS resolution `simulationRunner.ts:1518` | YES for agents who used PAS; floor=2.5 for employed agents | FLOWING (floor dominates in high-employment scenario) |
| `macroSnapshots.reservationWageP25/P50/P75` | DB read via `macroSnapshotRepo.ts:27-33` | `(row as any).reservationWageP25` | YES if migration ran before session; NULL if columns absent | HOLLOW_PROP (type-unsafe cast masks schema mismatches) |
| `enterprises.employees` (DB) | JSON array in DB | Written at bootstrap; never updated | NO — always shows bootstrap snapshot; runtime employment state not persisted | STATIC |
| `enterprises.wage` (DB) | `wage` column | Written at bootstrap; never updated by processWageAdjustment | NO — DB wage frozen at bootstrap; runtime wage diverges from DB | STATIC |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 53 server test files pass | `npm run test -w server -- --reporter=dot --run` | 591 passed, 8 todo, 0 failed | PASS |
| Phase 12 L-05/L-06 wage math | `npx vitest run server/src/mechanics/__tests__/laborMarket.test.ts` | 9 tests pass (2 todos remain for L-04 behavioral) | PASS |
| Matching pass L-09/L-10 | `npx vitest run server/src/orchestration/__tests__/matchingPass.test.ts` | 9 tests pass | PASS |
| PAS smoke L-07 | `npx vitest run server/src/orchestration/__tests__/laborSmoke.test.ts` | All pass (thin-pool parameterization) | PASS (with caveat) |
| Enterprise generation L-01/L-02/L-03 | `npx vitest run server/src/data/__tests__/enterpriseGeneration.test.ts` | All pass | PASS |
| Prompt content D-17/D-18/D-19 | `npx vitest run server/src/llm/__tests__/promptContent.test.ts` | All Phase 12 tests pass | PASS |
| isEmployableAgent D-07 | `npx vitest run server/src/orchestration/helpers/__tests__/isEmployableAgent.test.ts` | 13 tests pass | PASS |
| SFC invariants (wage + matching) | `npx vitest run server/src/mechanics/__tests__/sfcInvariant.test.ts` | Phase 12 SFC tests pass | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| L-01 | 12-02 | Location-mode bootstrap produces summed capacity >= 1.05 × employable agents | SATISFIED | generateEnterprises + invariant check + 3 passing tests |
| L-02 | 12-03 | Creative-mode coverage: all >=5% sectors have >=1 enterprise with retry | BLOCKED | creativeEnterpriseGeneration.ts not wired into creative-mode bootstrap |
| L-03 | 12-02, 12-03 | D-05 invariant auto-inflation on vacancy shortfall | SATISFIED | Auto-inflation loop + console.info + test |
| L-04 | 12-05 | Reservation wage = last PAS net proceeds; fallback floor | SATISFIED | PAS resolution writes to sessionReservationWages; fallback at line 948-949 |
| L-05 | 12-04 | Hybrid wage adjustment: nudge + profit-share + min floor | SATISFIED | processWageAdjustment; 5 tests |
| L-06 | 12-04 | MRP ceiling; skipped when spot <= 0 or NaN | SATISFIED | MRP code + 3 tests |
| L-07 | 12-06 | PAS median net ~0 over 10 iters | NEEDS HUMAN | Thin-pool test passes; real-session calibration untested; factor=1.0 is a no-op in real sessions |
| L-08 | 12-07 | WORK description with actual wage (D-17); PAS description reframed (D-18) | SATISFIED | override param wired; PAS copy changed; 3 tests |
| L-09 | 12-05 | APPLY_FOR_JOB greedy matching: highest wage, tie-break workforce, wage>=reservation | SATISFIED | runApplyForJobMatching; 9 tests |
| L-10 | 12-05 | QUIT_JOB auto-reapply next iteration | SATISFIED | sessionQuitLastIteration wired; test passes |
| L-11 | 12-07 | 7 labor-market telemetry fields emitted + persisted + rendered | PARTIAL | Code correct; DB persistence of runtime enterprise state (employees, wage, lastApplicants) absent; reservationWage DB read uses unsafe cast |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| `server/src/db/repos/enterpriseRepo.ts` | 88-103 | `updateEnterpriseInsolvencyAsync` is the ONLY enterprise update path; no update for wage, employees, lastApplicants, lastVacancies | BLOCKER | Pause/resume resets all runtime enterprise state to bootstrap snapshot; wage discovery feedback loop breaks on resume |
| `server/src/orchestration/simulationRunner.ts` | 311-312 | `lastApplicants: 0, lastVacancies: 0` hardcoded on DB load | BLOCKER | First iteration after resume has no labor signal for wage adjustment; FOUND_ENTERPRISE action was already patched (e0db800) |
| `server/src/data/dataBootstrapPipeline.ts` | 526 | `entEmployees.push(resolvedId)` with no duplicate guard | WARNING | If LLM generates duplicate agent names, same UUID pushed multiple times into employees array; in-memory Set deduplicates at runtime but DB JSON stores duplicates |
| `server/src/db/repos/macroSnapshotRepo.ts` | 27-33 | `(row as any).reservationWageP25` etc. | WARNING | Bypasses Drizzle type inference; column absence produces undefined without compile-time error; masks migration failures |
| `server/src/data/creativeEnterpriseGeneration.ts` | entire file | Module compiled and tested but has zero callers in production code path | WARNING | Creative-mode sessions do not benefit from D-06/D-15 (LLM enterprise generation with D-05 invariant retry) |
| `server/src/orchestration/__tests__/laborSmoke.test.ts` | 43 | `createAMMForSession(1, 100, 0.6, 0, factor)` — thin-pool spec differs from real-session pool | WARNING | L-07 smoke tests pass on a parameterization that does not reflect default session behavior; real-session PAS margin untested |
| `server/src/llm/prompts/agent-intent.ts` | 425 | `personalStatus.enterprise_id` used as employer name in WORK override (e.g., "ent_agri_1") instead of `enterpriseRecord.name` or `ownerName` | INFO | Agent sees enterprise ID string as employer name in prompt, not human-readable name like "Agriculture 1" |
| `server/src/mechanics/__tests__/laborMarket.test.ts` | 124-125 | 2 `it.todo` entries for L-04 behavioral reservation wage tests | INFO | L-04 is wired correctly in code; todos are behavioral integration tests that were deferred |
| `server/src/mechanics/__tests__/laborMarket.test.ts` | 142-144 | 3 `it.todo` entries for L-11 telemetry unit tests | INFO | L-11 is wired correctly; todos are unit-test coverage for telemetry computation |

---

## Human Verification Required

### 1. Wage Convergence Toward MRP After Bug Fix

**Test:** Run a fresh Germany or China 30-agent session for 20 iterations with the e0db800 FOUND_ENTERPRISE wage=0 fix applied. Check the Average Posted Wage dashboard panel.
**Expected:** avgPostedWage should move within 3-5 iterations (rising from ~25 initial when vacancies > applicants), plateau near or below MRP (approximately food_spot × 10 − 2; if food spot ≈ 3.0 early, MRP ≈ 28). Should not flat-line at 25 for 6+ iterations.
**Why human:** Requires live LLM simulation; wage trajectory depends on action distribution which is non-deterministic.

### 2. Unemployment Rate Convergence After Fix

**Test:** Same session as above. Check the Unemployment Rate dashboard panel.
**Expected:** Should start near 1.0 (all unemployed), drop to [0.1, 0.4] range by iter 5 as matching pass places agents, stabilize thereafter. The Germany pre-fix run showed 0.9 at iter 9 (wage crash caused re-unemployment). New run should not show that spike pattern.
**Why human:** LLM agent behavior determines who applies for jobs vs who idles.

### 3. PAS Net Proceeds in Real Session

**Test:** After 20 iterations, find agents who executed PRODUCE_AND_SELL actions. Check their wealth trajectory. Should be flat or slightly declining if employed (occasional PAS while between jobs), not growing.
**Expected:** PAS should function as survival action with ~0 net margin, not a profitable entrepreneurship path.
**Why human:** Requires reading individual agent wealth logs; no automated extract path for per-action-code net proceeds.

### 4. Creative-Mode Session Enterprise Generation

**Test:** Create a new Creative Mode session (Describe a Society) with 30 agents. Inspect enterprises generated.
**Expected:** Enterprises should cover all major sectors in the society description; `creativeEnterpriseGeneration.ts` should be called (currently it is NOT). This test will FAIL in its current state (it falls back to `generateEnterprises` which may or may not produce sector-aligned enterprises for a creative society).
**Why human:** Requires UI interaction to trigger creative-mode bootstrap.

---

## Gaps Summary

Phase 12 delivers most of its mechanical promises: the wage-adjustment formula (D-01), matching pass (D-13), reservation wage population (D-12), PAS prompt reframing (D-18), action-dictionary wage interpolation (D-17), employment board augmentation (D-19), telemetry emission (D-20), and dashboard charts (D-21) are all correctly implemented and tested. The test suite is green (591 passing, 8 todos) and the Germany smoke run confirms paid employment dominates (212 WORK_AT_ENTERPRISE actions) — the primary goal metric.

However, four structural gaps prevent the phase from being fully achieved:

**Gap 1 (Blocker): No runtime DB persistence for enterprise state.** Enterprise wage, employees, lastApplicants, and lastVacancies are mutated in-memory each iteration but never written back to the DB. On pause/resume, `enterpriseRepo.getEnterprises()` reloads the bootstrap snapshot, resetting wage to initial value (losing all wage discovery), employees to the bootstrap assignment (losing all matching-pass placements), and lastApplicants/lastVacancies to 0 (breaking the feedback loop for wage adjustment). This makes the labor market stateless across pause/resume boundaries.

**Gap 2 (Blocker): Employee deduplication in bootstrap.** When the LLM generates agents with duplicate names, `agentNameToId` silently maps the name to one UUID, causing the same UUID to appear multiple times in `entEmployees`. The in-memory `Set<string>` deduplicates at runtime, but the DB `employees` JSON column stores the duplicates. This was observed in the Germany session (5× same UUID for one agent in services). Fix: deduplicate `entEmployees` before blueprint construction.

**Gap 3 (Warning): PAS calibration smoke test uses non-representative pool parameters.** The `laborSmoke.test.ts` L-07 test passes, but it uses a thin pool (agentCount=1, targetSpotPrice=0.6) that is not representative of a 30-agent session at targetSpotPrice=6.0. The `ammSubsistenceCalibrationFactor=1.0` default has no compression effect on real sessions. The D-09 "median net ~0" target is currently only demonstrated in the thin-pool case, not for real sessions.

**Gap 4 (Warning): Creative-mode enterprise generation not wired.** `creativeEnterpriseGeneration.ts` is a complete, tested module implementing D-06/D-15 (LLM enterprise blueprints with D-05 invariant retry). It has no callers. Creative-mode sessions use the location-mode `generateEnterprises` function, which does not have access to the society overview for sector-aligned generation and does not use the Central Agent LLM retryWithHealing path.

---

## Live Smoke Evidence (Germany 16-iteration Run)

The Germany session (`/Users/Code/PolicyLab/Results/Sessions/session-germany.json`) confirms:

- **Enterprise generation (L-01 PASSED):** 2 enterprises (ent_indu_1 capacity=9, ent_serv_1 capacity=25). 34 total capacity for ~28 employable agents = 1.21× target. D-04/D-05 met.

- **Employment domination (primary goal MET):** 212 WORK_AT_ENTERPRISE actions across 16 iters vs 50 PRODUCE_AND_SELL = enterprise employment is primary livelihood. Phase goal partially achieved.

- **Unemployment rate anomaly (L-11 PARTIAL):** `unemploymentRate` peaked at 0.9 (iter 9) and stabilized 0.6-0.77. The spike was caused by a `FOUND_ENTERPRISE` action creating a wage=0 enterprise (now fixed in e0db800), which dragged `avgPostedWage` from 25 → 5.09 at iter 9, making the posted wage below all reservation wages and leaving agents unemployed. This bug masked the Phase 12 wage feedback loop behavior in this run.

- **lastApplicants/lastVacancies persistence gap (DB GAP CONFIRMED):** 176 APPLY_FOR_JOB actions across 15 iterations are documented in macroSnapshots, but `enterprises.last_applicants=0` and `enterprises.last_vacancies=0` in the DB throughout. The matching pass sets these in-memory, but they are never written to DB. This means `processWageAdjustment` reads 0 for both values at iteration start (loaded from DB), causing the nudge factor to be 1.0 (no nudge) — the wage-discovery feedback loop was effectively disabled for the full 16-iteration run because of the missing DB write-back.

- **Reservation wage fields null in macroSnapshots (L-11 PARTIAL):** `reservationWageP25/P50/P75` are null across all 15 iterations. Code analysis suggests this session predates the schema migration; new sessions should populate these. Alternatively, the `(row as any)` cast in macroSnapshotRepo may fail silently.

- **Employee duplicates (CONFIRMED):** DB inspection shows duplicate UUIDs in services enterprise employees JSON (5× same ID for one agent). Caused by duplicate agent names → same UUID in agentNameToId → pushed multiple times.

---

_Verified: 2026-04-26T23:50:00Z_
_Verifier: Claude (gsd-verifier)_
