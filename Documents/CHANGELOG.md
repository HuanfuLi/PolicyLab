# IDEAL WORLD: ARCHITECTURE CHANGELOG (March 21, 2026)

This document tracks major architectural refinements and critical bug fixes implemented after the Phase 3/4 baseline.


## 1. Economy and Market Enhancements

* **State Treasury (D1):** Introduced a state treasury to fund standalone WORK actions. This ensures Stock-Flow Consistency (SFC) by treating income as a transfer from the treasury to the agent, keeping the total fiat supply constant. Treasury state is persisted in AMM snapshots and restored on process restart.
* **Wealth Seizure Redistribution (Fix A/B):** Fixed the 'Arrest Bug' where seized wealth was permanently lost. Seized wealth from arrests, deaths, and humiliations is now explicitly added to the seizedWealthPool and redistributed equally to all living agents at the end of the iteration, maintaining a closed-loop economy.
* **Dopamine-Scaled Recovery (D2):** Rest recovery is now scaled by dopamine levels. High dopamine (≥70) yields 1.25x health recovery, while low dopamine (≤30) yields 0.75x recovery, simulating anhedonia.
* **Role-Differentiated Inventories (B4):** Agents now receive role-specific starting inventories (e.g., farmers start with food and raw materials, artisans with tools) rather than a uniform generic inventory, improving early-game economic specialization.
* **Monoculture Warning (B5):** The engine now detects if >70% of production actions are focused purely on food and injects a diversity warning into the LLM context to encourage production of raw materials and luxury goods.


## 2. Agent Cognition and Narrative Alignment

* **Cortisol and Dopamine Baseline (D3):** Agent initial stats now include base values for cortisol (default 20) and dopamine (default 50). These can be tuned based on the agent's role (e.g., higher baseline stress for oppressed roles).
* **Personality Traits:** Introduced an array of immutable personality traits (e.g., 'risk-tolerant', 'cooperative') assigned during the design phase. These traits bias decision-making via prompt context, increasing behavioral diversity.
* **Humiliation Cortisol Reset:** Humiliation now resets cortisol to 85 (instead of 100). This crucially prevents agents from getting trapped in a 'Cortisol Death Spiral' where they repeatedly suffer mental breakdowns (interrupt threshold 90) and can never recover.
* **Mental Breakdown Recovery:** Added a deterministic recovery path: if an agent's turn is interrupted by a mental breakdown, their cortisol is capped at 75 for the next iteration, allowing them a chance to re-engage with the economy.
* **Physics Log Injection (D4):** The last iteration's physics trace logs are now directly injected into the next iteration's resolution prompt, improving the narrative's alignment with deterministic outcomes.


## 3. Telemetry and UI Improvements

* **Analytical Metrics:** Added rich analytical metrics to the telemetry logs, including the Gini Coefficient (wealth inequality), Trust Index (cooperation vs. predation), Crime Rate, Social Mobility Index, and population-average Cortisol/Dopamine.
* **Telemetry Charts:** The frontend TelemetryPanel has been expanded with new charts visualizing Wealth Inequality, Social Trust vs Crime, and Population Psychology (Cortisol/Dopamine) to track societal health over time.

## 4. Refactoring and Code Health

* **Removed Legacy Economy Engine:** The legacy Phase 1 economyEngine.ts and its associated tests (phase1.test.ts) were deleted, as their responsibilities have been fully subsumed by simulationRunner.ts.
* **Database Schema Migration:** Updated the gents table and gentRepo to support personalityTraits parsing and persistence.
* **Codebase Documentation:** Substantially rewrote CODEBASE_OVERVIEW.md, README.md, and README_ZH.md to accurately reflect the current Phase 4 architectural state, including the new frontend/backend module layout, active APIs, and accurate mechanic summaries.

