---
phase: 03-fiscal-policy
verified: 2026-04-02T00:15:00Z
status: gaps_found
score: 6/8 must-haves verified
gaps:
  - truth: "A new session's design screen exposes budget allocation sliders for infrastructure, education, defense, and welfare; the allocation is stored in session config and applied every iteration automatically"
    status: failed
    reason: "No server route accepts budget allocation at design time, and no frontend UI exists for configuring budget sliders. upsertBudget is only called from importexport.ts — meaning budget allocation can only be set via session import, not via the design flow. The fiscal engine falls back to DEFAULT_BUDGET_ALLOCATION (25/25/25/25) every iteration."
    artifacts:
      - path: "server/src/routes/sessions.ts"
        issue: "PUT /:id/config does not accept or persist budgetAllocation or fiscalEnabled fields"
      - path: "server/src/routes/design.ts"
        issue: "No fiscalBudget or economyConfig handling — route has zero fiscal awareness"
      - path: "web/src/components/DesignReview.tsx"
        issue: "File does not exist; web/src/components/ has no fiscal-related components"
    missing:
      - "Server route to accept and store budgetAllocation and fiscalEnabled in session config (or as fiscalRepo upsertBudget call)"
      - "Frontend budget allocation sliders in the design/DesignReview screen (4 sliders summing to 1.0)"
      - "API wiring so the frontend slider values are persisted via upsertBudget before simulation starts"
  - truth: "Public goods quality scores for each category exist as persistent state in the DB; they increase (with diminishing returns) when spending exceeds a threshold and decay when spending is absent; the score is visible in simulation telemetry"
    status: partial
    reason: "Public goods quality IS persisted to DB per iteration (confirmed in simulationRunner) and the gain/decay mechanics are fully implemented and tested. However the score is NOT included in TelemetryLog — it is absent from the SSE telemetry stream and the in-memory telemetry snapshots. 'Visible in simulation telemetry' is unmet."
    artifacts:
      - path: "shared/src/types.ts"
        issue: "TelemetryLog interface (line 227) has no public goods quality fields (infrastructureQuality, educationQuality, defenseQuality, welfareQuality). Fields exist only on SessionExport (line 314-316), not on the per-iteration snapshot."
      - path: "server/src/orchestration/simulationRunner.ts"
        issue: "iterTelemetry object (line 3065) does not include fiscal/public goods quality fields despite having the fiscalDelta data available in scope"
    missing:
      - "Add infrastructureQuality, educationQuality, defenseQuality, welfareQuality optional fields to TelemetryLog interface in shared/src/types.ts"
      - "Populate those fields in iterTelemetry from the active public goods state each iteration (read from fiscalRepo.getPublicGoodsState or from fiscalDelta.updatedPublicGoods if fiscalEnabled)"
human_verification:
  - test: "Verify budget allocation sliders in design screen"
    expected: "Design/DesignReview UI shows 4 labeled sliders (infrastructure, education, defense, welfare) that sum to 100%, user can adjust them, and the values are saved before launching simulation"
    why_human: "Frontend UI existence and usability cannot be verified programmatically — no web components exist for this yet"
---

# Phase 3: Fiscal Policy Verification Report

**Phase Goal:** At session design time a policymaker configures budget allocation across infrastructure, education, defense, and welfare; each iteration the engine executes spending from the treasury, applies per-category multiplier effects to agent stats, and public goods quality compounds with investment or decays without it

**Verified:** 2026-04-02T00:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Note on ROADMAP Inconsistency

The ROADMAP.md progress table shows Phase 3 as "2/3 plans executed" with 03-03-PLAN.md unchecked. The git log and 03-03-SUMMARY.md both confirm 03-03 WAS executed (commits 8cad2bd, 97c3c23, 9267185 on 2026-04-01). The ROADMAP progress table was not updated. The code state is authoritative — all three plans were executed.

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Design screen exposes budget allocation sliders; allocation stored in session config and applied every iteration | ✗ FAILED | No frontend fiscal components exist. `upsertBudget` only called from importexport.ts. No server route stores budget at design time. |
| 2 | Each budget category produces measurable per-iteration effect on relevant simulation stat; effect absent when allocation is zero | ✓ VERIFIED | physicsEngine.ts applies `productivityBonus` to WORK (line 167), `enforcementBonus` to SUPPRESS (line 360); skillSystem.ts applies `skillGainBonus` via `skillGainMultiplier` parameter; all backed by 18 unit tests + 20 SFC integration tests. |
| 3 | Public goods quality scores persist; increase with spending (diminishing returns); decay without it; score visible in telemetry | ✗ PARTIAL | DB persistence: verified (simulationRunner line 2914-2920). Gain/decay mechanics: verified (18 tests pass). Telemetry visibility: FAILED — TelemetryLog has no public goods fields. Score is queryable from DB but absent from SSE stream. |
| 4 | Treasury never goes negative after budget execution; insufficient funds → proportional scaling | ✓ VERIFIED | `executeBudget` scales spending to `Math.min(totalSpending, treasuryBalance)` (fiscalEngine.ts). Test "scales spending down proportionally when treasury is below expected spend (FISC-04)" passes. |

**Score:** 6/8 must-haves verified (2 truths failed/partial, 1 contains 2 sub-truths)

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `shared/src/types.ts` | BudgetAllocation, PublicGoodsState, EconomyConfig fiscal fields | ✓ VERIFIED | `BudgetAllocation` (line 507), `PublicGoodsState` (line 523), 7 fiscal EconomyConfig fields (lines 398-440), `DEFAULT_BUDGET_ALLOCATION` (line 542), `DEFAULT_PUBLIC_GOODS_INITIAL` (line 553) |
| `server/src/db/schema.ts` | fiscalBudgets, publicGoodsState table definitions | ✓ VERIFIED | `fiscalBudgets` table (line 251), `publicGoodsState` table (line 269) |
| `server/src/db/migrate.ts` | CREATE TABLE IF NOT EXISTS for fiscal tables | ✓ VERIFIED | `fiscal_budgets` (line 311), `public_goods_state` (line 323), indexes on both |
| `server/src/db/repos/fiscalRepo.ts` | Budget and public goods CRUD | ✓ VERIFIED | All 6 exported functions present: `upsertBudget`, `getActiveBudget`, `upsertPublicGoodsState`, `getPublicGoodsState`, `getPublicGoodsStateBySession`, `deleteBySession` |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/mechanics/fiscalEngine.ts` | executeBudget, updatePublicGoodsQuality, getMultiplierEffects | ✓ VERIFIED | 318 lines. Exports: `FiscalDelta`, `MultiplierEffects`, `updatePublicGoodsQuality`, `getMultiplierEffects`, `executeBudget`. Zero DB/LLM imports confirmed (grep returns 0). |
| `server/src/mechanics/__tests__/fiscal.test.ts` | Unit tests for fiscal engine | ✓ VERIFIED | 400 lines, 18 tests, all passing |

#### Plan 03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/orchestration/simulationRunner.ts` | Fiscal engine wiring in iteration loop | ✓ VERIFIED | Fiscal tick at line 2878-2933 after capital market tick. Imports fiscalEngine (line 64) and fiscalRepo (line 65). Guarded by `fiscalEnabled`. |
| `server/src/mechanics/physicsEngine.ts` | Public goods multiplier application | ✓ VERIFIED | `fiscalMultipliers` optional field on PhysicsInput (line 53-56). `productivityBonus` applied to WORK (line 167). `enforcementBonus` applied to SUPPRESS (line 360). Backward-compatible defaults to 0. |
| `server/src/llm/prompts.ts` | Budget allocation and public goods context in agent prompts | ✓ VERIFIED | `CitizenFiscalContext` interface (line 558), `buildCitizenFiscalSection` (line 599), optional `citizenFiscalContext` parameter on `buildNaturalIntentPrompt` (line 716). |
| `server/src/routes/importexport.ts` | Fiscal data in session export/import | ✓ VERIFIED | `fiscalRepo` imported (line 24). Export: `fiscalBudget` (line 161) and `publicGoodsState` (line 165). Import: restores both via `upsertBudget` (line 391) and `upsertPublicGoodsState` (line 405). |
| `server/src/__tests__/sfcFiscal.test.ts` | SFC integration tests for fiscal spending | ✓ VERIFIED | 432 lines, 20 tests, all passing |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `fiscalRepo.ts` | `schema.ts` | drizzle table imports | ✓ WIRED | `import { fiscalBudgets, publicGoodsState } from '../schema.js'` (line 11) |
| `economyConfigUtils.ts` | `shared/src/types.ts` | EconomyConfig with fiscal fields | ✓ WIRED | `fiscalEnabled` present in EconomyConfig; `getEconomyConfig` spreads DEFAULT_ECONOMY_CONFIG which includes fiscal defaults |
| `fiscalEngine.ts` | `shared/src/types.ts` | BudgetAllocation, PublicGoodsState, EconomyConfig imports | ✓ WIRED | `import type { BudgetAllocation, EconomyConfig, PublicGoodsState } from '@policylab/shared'` (line 19) |
| `simulationRunner.ts` | `fiscalEngine.ts` | executeBudget call in iteration loop | ✓ WIRED | `fiscalEngine.executeBudget({...})` at line 2887. Import at line 64. |
| `simulationRunner.ts` | `fiscalRepo.ts` | DB persistence of public goods state | ✓ WIRED | `fiscalRepo.upsertPublicGoodsState(...)` at line 2915. Import at line 65. |
| `physicsEngine.ts` | `shared/src/types.ts` | MultiplierEffects type for stat bonuses | ✓ WIRED | `productivityBonus` applied at line 167, `enforcementBonus` at line 360 via optional `fiscalMultipliers` on `PhysicsInput` |
| Design UI | `server` | budget allocation sliders → upsertBudget | ✗ NOT_WIRED | No frontend fiscal components. No server route to accept budget allocation at design time. `upsertBudget` is only reachable via session import. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `simulationRunner.ts` fiscal tick | `budgetAllocation` | `fiscalRepo.getActiveBudget(sessionId)` | Returns null (no design-time setter) → falls back to `DEFAULT_BUDGET_ALLOCATION` always | ⚠️ HOLLOW_PROP — wired but data source always returns null; default is used every run |
| `simulationRunner.ts` fiscal tick | `currentPublicGoods` | `fiscalRepo.getPublicGoodsState(sessionId)` | Returns persisted row after iteration 1, null on first iteration (correct) | ✓ FLOWING |
| `physicsEngine.ts` | `fiscalMultipliers` | `sessionFiscalMultipliers.get(sessionId)` (1-iter lag) | Real values from previous iteration's `fiscalEngine.executeBudget` | ✓ FLOWING |
| `TelemetryLog` SSE stream | public goods quality | Not present | No field in `TelemetryLog` for quality scores | ✗ DISCONNECTED |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 18 fiscal unit tests pass | `npx vitest run server/src/mechanics/__tests__/fiscal.test.ts` | 18/18 passed | ✓ PASS |
| 20 SFC fiscal integration tests pass | `npx vitest run server/src/__tests__/sfcFiscal.test.ts` | 20/20 passed | ✓ PASS |
| Full server test suite (142 tests) | `npm run test -w server` | 142/142 passed | ✓ PASS |
| TypeScript compiles clean (shared + server) | `npx tsc --noEmit -p shared/tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` | No errors | ✓ PASS |
| Design UI: budget sliders functional | Human test needed | Not testable programmatically | ? SKIP |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FISC-01 | 03-01, 03-03 | Budget categories configurable at session design time | ✗ BLOCKED | Types exist, repo CRUD exists, but no design-time route or UI. Only accessible via session import. |
| FISC-02 | 03-02, 03-03 | Spending multipliers affect specific simulation stats | ✓ SATISFIED | physicsEngine.ts applies `productivityBonus` (WORK), `enforcementBonus` (SUPPRESS); skillSystem.ts applies `skillGainBonus`. 18 unit tests + 20 integration tests confirm. |
| FISC-03 | 03-02, 03-03 | Public goods quality [0-100], increases with diminishing returns, decays without spending | ✓ SATISFIED (DB only) | Quality scores persist per iteration in `public_goods_state` table. Gain/decay tested. BUT not in telemetry stream — partially satisfies "visible in telemetry" clause. |
| FISC-04 | 03-01, 03-02, 03-03 | Treasury never goes negative; proportional scaling on insufficient funds | ✓ SATISFIED | `executeBudget` clamps to treasury balance. Dedicated test "scales spending down proportionally" passes. |

**Orphaned requirements:** None. All 4 FISC requirements are claimed by plans.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/src/orchestration/simulationRunner.ts` | 2883 | `fiscalRepo.getActiveBudget(sessionId) ?? DEFAULT_BUDGET_ALLOCATION` | ⚠️ Warning | `getActiveBudget` returns null for all sessions that were not created via import. The `??` fallback silently applies equal 25/25/25/25 allocation without the user ever configuring it. This masks the missing design-time configuration — the fiscal engine appears to "work" but always uses defaults. |
| `server/src/routes/sessions.ts` | 308-349 | `PUT /:id/config` does not handle `economyConfig`, `budgetAllocation`, or `fiscalEnabled` | ✗ Blocker | No pathway for a client to enable fiscal policy or set budget allocation on a session. |

---

### Human Verification Required

#### 1. Budget Allocation Design Screen

**Test:** Navigate to session design review screen, look for infrastructure/education/defense/welfare budget sliders  
**Expected:** Four sliders or input controls labeled by category, constrained to sum to 100%, with a save action that persists values before simulation launch  
**Why human:** No frontend fiscal components exist — this is confirmed absent, not uncertain

---

## Gaps Summary

Two gaps block full goal achievement:

**Gap 1 — Design-time configurability (FISC-01 core):** The goal states "at session design time a policymaker configures budget allocation." The fiscal engine is fully implemented and wired, but budget allocation is never configurable from the UI or API at design time. The server has no route to accept `budgetAllocation` or `fiscalEnabled`. The frontend has no fiscal components. Every simulation run falls back silently to 25/25/25/25 equal allocation. The feature is mechanically correct but operationally inert — a policymaker cannot actually configure it. This requires: (a) a server endpoint to accept and store budget allocation during the design stage, and (b) frontend budget allocation controls on the design review screen.

**Gap 2 — Telemetry visibility (FISC-03 partial):** Public goods quality scores are correctly computed and persisted to the `public_goods_state` DB table, but they do not appear in `TelemetryLog` or the SSE telemetry stream. The success criterion explicitly states "the score is visible in simulation telemetry." This requires adding four optional quality fields to `TelemetryLog` and populating them in `iterTelemetry` each iteration.

Both gaps are additive — they require new code only, no rework of existing logic. The fiscal engine, repository, physics multipliers, prompts, and export/import are all production-ready.

---

_Verified: 2026-04-02T00:15:00Z_
_Verifier: Claude (gsd-verifier)_
