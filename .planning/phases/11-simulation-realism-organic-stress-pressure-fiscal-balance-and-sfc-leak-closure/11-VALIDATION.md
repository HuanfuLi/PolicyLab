---
phase: 11
slug: simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-13
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (server), jest (web if touched) |
| **Config file** | server/vitest.config.ts |
| **Quick run command** | `npx vitest run server/src/mechanics/__tests__/sfcInvariant.test.ts server/src/mechanics/__tests__/edgeCases.test.ts` |
| **Full suite command** | `npm run test -w server` |
| **Estimated runtime** | ~15 seconds (quick), ~60 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

*Populated during Plan 11-10 final verification wave. Each plan's automated test commands are consolidated below; see plan SUMMARY.md files for per-plan detail.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| cortisolStrip | 11-02 | 1 | D-01 | unit | `npx vitest run server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts -x` | ✅ | ✅ green |
| happinessStrip | 11-02 | 1 | D-06 | unit | `npx vitest run server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts -x` | ✅ | ✅ green |
| structuralPressures | 11-02 | 1 | D-02, D-07 | unit | `npx vitest run server/src/mechanics/__tests__/structuralPressures.test.ts -x` | ✅ | ✅ green |
| physicsConfig.thresholds | 11-01 | 0 | D-03, D-04, D-08 | unit | `npx vitest run server/src/mechanics/__tests__/physicsConfig.thresholds.test.ts -x` | ✅ | ✅ green |
| sfcEscrow | 11-03 | 1 | D-10, D-11 | integration | `npx vitest run server/src/__tests__/sfcEscrow.test.ts -x` | ✅ | ✅ green |
| sfcTaxation | 11-04 | 2 | D-12, D-14 | integration | `npx vitest run server/src/__tests__/sfcTaxation.test.ts -x` | ✅ | ✅ green |
| centralAgentTaxPolicy | 11-05 | 3 | D-13 | unit | `npx vitest run server/src/llm/__tests__/centralAgentTaxPolicy.test.ts -x` | ✅ | ✅ green |
| fiscalBudgetAssertion | 11-08 | 4 | D-15 | integration | `npx vitest run server/src/__tests__/fiscalBudgetAssertion.test.ts -x` | ✅ | ✅ green |
| governanceToggle | 11-06 | 3 | D-17 | integration | `npx vitest run server/src/orchestration/__tests__/governanceToggle.test.ts -x` | ✅ | ✅ green |
| governanceAmendment | 11-06 | 3 | D-18, D-19 | integration | `npx vitest run server/src/orchestration/__tests__/governanceAmendment.test.ts -x` | ✅ | ✅ green |
| sfcSubsystemDrift | 11-07 | 4 | D-20, D-21, D-22, D-23 | integration | `npx vitest run server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts -x` | ✅ | ✅ green |
| statClamping | 11-02 | 1 | D-03, D-08 | unit | `npx vitest run server/src/orchestration/__tests__/statClamping.test.ts -x` | ✅ | ✅ green |
| sfcPhase11 umbrella | 11-10 | 6 | ALL (D-01..D-14, D-17..D-23) | integration | `npx vitest run server/src/__tests__/sfcPhase11.test.ts -x` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Decisions Coverage

All 23 Phase-11 decisions are traced to at least one automated test above:

- **D-01 (strip cortisol rewards):** cortisolStrip
- **D-02 (structural cortisol pressures):** structuralPressures, sfcPhase11 umbrella
- **D-03 (cortisol ceiling 95):** physicsConfig.thresholds, statClamping
- **D-04 (raised auto-escalation thresholds):** physicsConfig.thresholds
- **D-05 (conservative coefficient defaults):** physicsConfig.thresholds
- **D-06 (strip happiness rewards):** happinessStrip
- **D-07 (structural happiness pressures):** structuralPressures, sfcPhase11 umbrella
- **D-08 (happiness clamp [5,95]):** physicsConfig.thresholds, statClamping
- **D-09 (conservative happiness coefficients):** physicsConfig.thresholds
- **D-10 (welfare-only distribution):** sfcEscrow, sfcPhase11 umbrella
- **D-11 (public goods escrow in M0):** sfcEscrow, sfcPhase11 umbrella
- **D-12 (extended tax base):** sfcTaxation, sfcPhase11 umbrella
- **D-13 (Central-Agent taxPolicy):** centralAgentTaxPolicy, sfcPhase11 umbrella
- **D-14 (inline tax withholding):** sfcTaxation, sfcPhase11 umbrella
- **D-15 (fiscal_budgets startup assertion):** fiscalBudgetAssertion
- **D-16 (franchise sizing unchanged):** *no test — intentional; franchise mechanic confirmed complete pre-Phase-11*
- **D-17 (governanceEnabled toggle):** governanceToggle, sfcPhase11 umbrella
- **D-18 (law amendment ballot):** governanceAmendment
- **D-19 (paragraph-level law diff):** governanceAmendment
- **D-20 (subsystem drift instrumentation):** sfcSubsystemDrift, sfcPhase11 umbrella
- **D-21 (sfcDriftBySubsystem telemetry):** sfcSubsystemDrift, sfcPhase11 umbrella
- **D-22 (0.1 drift threshold):** sfcSubsystemDrift, sfcPhase11 umbrella
- **D-23 (log-only, no auto-correct):** sfcSubsystemDrift, sfcPhase11 umbrella

---

## Wave 0 Requirements

Scaffolded during Plan 11-01 (foundation wave); strengthened by downstream plans; finalised in 11-10.

- [x] `server/src/__tests__/sfcPhase11.test.ts` — structural pressure invariants, escrow SFC closure, tax collection totals (populated by Plan 11-07 and Plan 11-10)
- [x] `server/src/mechanics/__tests__/structuralPressures.test.ts` — per-pressure unit tests (inflation, Gini, unemployment, public-goods) (Plan 11-02)
- [x] `server/src/orchestration/__tests__/governanceToggle.test.ts` + `governanceAmendment.test.ts` — toggle + law-amendment ballot handling (Plan 11-06)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Utopia-bias baseline comparison | D-01..D-09 | Requires full LLM-driven simulation run + visual telemetry comparison | Bootstrap "United States" scenario, run 10 iterations, compare cortisol/wealth/M0 trajectories against `Results/session-united-states.json` baseline. Success = non-monotonic stats. Plan 11-10 Task 2 human-verify checkpoint. |
| Law amendment ratification flow | D-18 | LLM-driven; deterministic test would require mocked provider | Run governance-enabled simulation to iter 5, observe law text change in session.law after ratified amendment. |
| Central-Agent taxPolicy generation | D-13 | LLM-driven | Bootstrap fresh session, inspect EconomyConfig.taxPolicy in DesignReview UI. |
| UI surfacing for governance toggle + taxPolicy + SFC drift panel | Plan 11-09 UX | Visual/interaction contract | Covered by Plan 11-09 UI checkpoint (already approved). |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (2026-04-13, Plan 11-10)

---

## Phase-Suite Baseline (at Plan 11-10 verification)

Full `npm run test -w server` result after Plan 11-10 umbrella consolidation:

- **Test Files:** 41 (39 passed, 2 pre-existing failures)
- **Tests:** 490 (485 passed, 5 pre-existing failures)
- **Pre-existing failures** (documented in `deferred-items.md`, out of Phase 11 scope):
  - `server/src/__tests__/economyConfig.test.ts` — 4 failures on `baseLoanInterestRate` / `depositInterestRate` default mismatches (stale test vs. shared defaults change)
  - `server/src/mechanics/__tests__/banking.test.ts` — 1 failure on `canIssueLoan(0, 0, 0, 0.10)` (stale test vs. logic change)
- **New in Plan 11-10:** +11 umbrella tests in `sfcPhase11.test.ts` — all green
- **Phase-11-owned tests:** 100% green (cortisolStrip, happinessStrip, structuralPressures, physicsConfig.thresholds, sfcEscrow, sfcTaxation, centralAgentTaxPolicy, fiscalBudgetAssertion, governanceToggle, governanceAmendment, sfcSubsystemDrift, statClamping, sfcPhase11 umbrella)
