# PolicyLab Architecture Changelog

This document tracks major architectural refinements and critical bug fixes.

---

## v1.0 Real Economy Engine (April 1-5, 2026)

7 phases delivered. 25 requirements met. 65+ bugs fixed across 7 audit rounds.

### New Economic Systems
* **Fractional Reserve Banking (Phase 1):** Bank agents, deposit accounts, loan lifecycle, reserve enforcement, M1 expansion/contraction, interest accrual, default/bankruptcy
* **Capital Markets (Phase 2):** Enterprise equity with dividends, government/corporate bonds with coupon/maturity, secondary market share sales
* **Fiscal Policy (Phase 3):** 4 budget categories (infrastructure, education, defense, welfare), spending multipliers, persistent public goods quality with diminishing returns
* **Inflation Dynamics (Phase 4):** CPI from Laspeyres basket, M1-to-price feedback via AMM, central bank action codes, inflation expectations in agent cognition
* **Economic Dashboard (Phase 5):** 4 real-time Recharts panels (CPI, Money Supply M0/M1/M2, Fiscal Budget, Bond Yields)
* **Scenario Builder (Phase 6):** Economy parameter UI, fork-based A/B comparison, 8-dimension scoring, config diff table
* **Real-World Bootstrap (Phase 7):** World Bank API (23 indicators), Photon geocoder, Gini-based wealth distribution, tab-based scenario builder

### Architecture Improvements (Post-Milestone)
* **Modularity refactoring:** Extracted `simulationState.ts` (14 session Maps), `telemetryCollector.ts`, `orderBookRepo.ts`; decoupled `prompts.ts` from mechanics; moved `AMMState` to shared types
* **Module Map:** Created `MODULE_MAP.md` — 477-line module registry with exports, tests, dependencies, and isolation guide
* **Bug fixes:** 65+ issues fixed across 5 audit rounds + 1 final comprehensive audit (see `.planning/PROBLEM_SOLVING_ROADMAP.md`)
* **Test suite:** 195 tests across 18 files (SFC invariants, engine unit tests, data pipeline tests)

### Database
* Schema expanded from ~12 tables to 26 tables (added banking, capital markets, fiscal, macro snapshots, order book tables)
* `asyncLogFlusher` upgraded with max retry limit (5 attempts)
* `eraseSimulationData` now cleans all 16 simulation-generated tables (was missing 10)

---

## Pre-v1.0 Changes (March 2026, inherited from Ideal World)

Below is the original changelog from before the PolicyLab fork.

---


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

