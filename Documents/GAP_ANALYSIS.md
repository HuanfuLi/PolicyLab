# GAP ANALYSIS: PolicyLab Neuro-Symbolic Engine

> **Originally audited:** 2026-03-21 (as "Ideal World")
> **Last updated:** 2026-04-05 (all items resolved after v1.0 milestone + 5 audit rounds)

This document outlines the inconsistencies, technical debt, and architectural gaps identified during the original audit. All items have been resolved.

## 1. SFC Violations (Economy Engine)
**Status: FULLY RESOLVED**

*   **[FIXED] Ghost Wealth Creation**: Standalone `WORK` actions (non-enterprise) are now funded from a **State Treasury** (`sessionStateTreasury`). This ensures that income is a zero-sum transfer from a pre-funded pool rather than fiat creation from nothing. 
*   **[FIXED] Double Income Suppression**: `WORK_AT_ENTERPRISE` now suppresses `roleIncome` in `physicsEngine.ts`. Wealth is exclusively handled by the runner's wage settlement logic, eliminating double-counting.
*   **[FIXED] Zero-Sum STEAL**: Theft now deducts from the victim's balance in `simulationRunner.ts`. If the victim is broke, the thief's gain is capped at the actual amount taken.
*   **[FIXED] Wealth Redistribution**: Logic for redistributing wealth from deceased or humiliated agents into the `seizedWealthPool` (UBI) has been implemented, closing the final major fiat leak.

## 2. Dangling Variables (Psychological Engine)
**Status: FULLY RESOLVED**

*   **[FIXED] Dopamine Integration**: `dopamine` is no longer a "ghost stat." It now influences the **effectiveness of REST actions** in `simulationRunner.ts`. High dopamine improves health recovery, while low dopamine (anhedonia) impairs it.
*   **[FIXED] Cortisol Sync**: Cortisol is now fully integrated with the allostatic load pipeline (cortisol → strain → load → disease). The `clampHappinessByPhysiology` function and `AllostaticEngine` are both wired correctly.

## 3. Deprecated & Redundant Code
**Status: RESOLVED**

*   **[FIXED] EconomyEngine.ts**: Deleted. All logic lives in `AutomatedMarketMaker` and `simulationRunner.ts`.

## 4. Neuro-Symbolic Disconnects
**Status: RESOLVED**

*   **[FIXED] Stats Sync**: The "Dead Man Walking" bug is resolved. Statistics and telemetry are now calculated after re-fetching the current agent list from the database.
*   **[FIXED] Math-to-Narrative Grounding**: A `physicsLog` containing the exact mathematical traces (multipliers, deltas) from the previous iteration is now injected into the LLM's resolution prompts. This ensures the narrator cannot hallucinate outcomes that contradict the physics engine.
*   **[FIXED] Market Context Awareness**: AMM spot prices and reserves are now injected into the `System Metrics` block of the LLM prompt, fixing the "Narrative-Market Paradox."

## 5. Action Failure Rate
**Status: IMPROVED**

*   **[IMPROVED] Instruction Hardening**: The resolution prompt now includes explicit rules for `DEATH` (health ≤ 5) and more descriptive action schemas.

---
**Final Audit Verdict**: All original gaps have been resolved. The system is architecturally stable with Stock-Flow Consistent economics (195 tests, 0 type errors). v1.0 milestone added fractional reserve banking, capital markets, fiscal policy, inflation dynamics, economic dashboard, scenario comparison, and real-world data bootstrap. See `MODULE_MAP.md` for the current module architecture and `PROBLEM_SOLVING_ROADMAP.md` in `.planning/` for the full audit trail.
