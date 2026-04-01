# GAP ANALYSIS: Ideal World Neuro-Symbolic Engine (Audit: 2026-03-21)

This document outlines the inconsistencies, technical debt, and architectural gaps identified during the audit of the Ideal World simulation platform.

## 1. SFC Violations (Economy Engine)
**Status: RESOLVED / STABILIZED**

*   **[FIXED] Ghost Wealth Creation**: Standalone `WORK` actions (non-enterprise) are now funded from a **State Treasury** (`sessionStateTreasury`). This ensures that income is a zero-sum transfer from a pre-funded pool rather than fiat creation from nothing. 
*   **[FIXED] Double Income Suppression**: `WORK_AT_ENTERPRISE` now suppresses `roleIncome` in `physicsEngine.ts`. Wealth is exclusively handled by the runner's wage settlement logic, eliminating double-counting.
*   **[FIXED] Zero-Sum STEAL**: Theft now deducts from the victim's balance in `simulationRunner.ts`. If the victim is broke, the thief's gain is capped at the actual amount taken.
*   **[FIXED] Wealth Redistribution**: Logic for redistributing wealth from deceased or humiliated agents into the `seizedWealthPool` (UBI) has been implemented, closing the final major fiat leak.

## 2. Dangling Variables (Psychological Engine)
**Status: RESOLVED**

*   **[FIXED] Dopamine Integration**: `dopamine` is no longer a "ghost stat." It now influences the **effectiveness of REST actions** in `simulationRunner.ts`. High dopamine improves health recovery, while low dopamine (anhedonia) impairs it.
*   **[STILL PRESENT] Cortisol Sync**: Minor inconsistency remains between `clampHappinessByPhysiology` and `AllostaticEngine` impact, but the primary physiological loop is functional.

## 3. Deprecated & Redundant Code
**Status: MAINTENANCE**

*   **[STILL PRESENT] EconomyEngine.ts**: `server/src/mechanics/economyEngine.ts` remains in the codebase. It is entirely redundant as its logic has been fully moved to `AutomatedMarketMaker` and `simulationRunner.ts`. **Recommendation: Delete file.**

## 4. Neuro-Symbolic Disconnects
**Status: RESOLVED**

*   **[FIXED] Stats Sync**: The "Dead Man Walking" bug is resolved. Statistics and telemetry are now calculated after re-fetching the current agent list from the database.
*   **[FIXED] Math-to-Narrative Grounding**: A `physicsLog` containing the exact mathematical traces (multipliers, deltas) from the previous iteration is now injected into the LLM's resolution prompts. This ensures the narrator cannot hallucinate outcomes that contradict the physics engine.
*   **[FIXED] Market Context Awareness**: AMM spot prices and reserves are now injected into the `System Metrics` block of the LLM prompt, fixing the "Narrative-Market Paradox."

## 5. Action Failure Rate
**Status: IMPROVED**

*   **[IMPROVED] Instruction Hardening**: The resolution prompt now includes explicit rules for `DEATH` (health ≤ 5) and more descriptive action schemas.

---
**Final Audit Verdict**: The system has reached architectural stability. The core economic and physiological loops are now Stock-Flow Consistent and mathematically grounded.
