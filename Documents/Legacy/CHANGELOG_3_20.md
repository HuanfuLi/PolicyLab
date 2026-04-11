# IDEAL WORLD: ARCHITECTURE CHANGELOG (March 20, 2026)

This document tracks major architectural refinements and critical bug fixes implemented after the Phase 3/4 baseline.

## 1. Data Integrity & Synchronization (The "Alive" Engine)

* **Stale Agent Sync (Critical Bug Fix):** Resolved the "Eternal Stats" / "Dead Man Walking" bug. The simulation loop now re-loads the `agents` array from the database at the end of every iteration (`agents = await agentRepo.listBySession(sessionId)`). This ensures that `computeStats`, narrative summaries, and the final report reflect current wealth, health, and death statuses rather than Iteration 0 values.
* **Allostatic State Persistence:** Implemented full database persistence for `allostatic_strain` and `allostatic_load`. The simulation now seeds the in-memory allostatic map from the DB on startup and bulk-persists updates at the end of every week, ensuring physiological "scarring" survives server restarts.
* **Telemetry Embedding:** Iteration telemetry (Total Fiat Supply, AMM Reserves, Satiety Burn) is now embedded directly into the `statistics` JSON of the `iterations` table, making historical performance data accessible even after the server's in-memory telemetry logs are cleared.

## 2. Metabolic & Physiological Precision

* **Floating-Point Food Consumption:** Eradicated "phantom food" waste. Replaced `Math.ceil(satietyCost)` with high-precision rounding (`r4`). Agents now consume exact fractional amounts of food (e.g., 1.4 units) from their inventory, preventing mathematically unjustified famines caused by rounding errors.
* **Hedonic Adaptation Fix:** Refined the `dopamineDecay` application in the `physicsEngine`. Decay is no longer applied cumulatively per sub-action in the queue, preventing "Hedonic Collapse" where societal dopamine would hit 0 within 5 iterations due to high-resolution turns.
* **Satiety Remainder Tracking:** The engine now accurately tracks fractional nutritional deficits, allowing agents to stay in a "hungry" state with partial nutrition without triggering a full starvation health penalty.

## 3. Macroeconomics & Market Stability

* **Ghost Enterprise Cleanup:** Implemented a pre-iteration "Regime Maintenance" block. The system now automatically identifies enterprises owned by deceased agents, dissolves them, releases employees with a severance notification, and clears the registries. This prevents workers from being trapped in inactive employment loops.
* **Market-Aware Resolution Prompts:** Updated `buildGroupResolutionMessages` and `buildResolutionPrompt` to inject real-time AMM Food Reserves and Spot Prices. This forces the LLM to narrate "abundance" or "famine" based on actual market liquidity rather than purely on agent health trends.
* **Hardened SFC Drift Enforcement:** Upgraded the Stock-Flow Consistent (SFC) tracker. The system now performs a baseline check against `initialFiat` every iteration. If the total fiat (Agent Wealth + AMM Reserves) drifts by more than ±0.1, a critical `🚨 SFC LEAK` error is logged, ensuring the circular economy remains closed-loop.

## 4. Performance & Infrastructure

* **AMM Snapshot Vacuuming:** Added `economyRepo.vacuumAMMSnapshots(sessionId)` which runs every 10 iterations. It prunes redundant market snapshots while retaining "decadal" and "latest" rows to manage database growth and WAL write amplification.
* **Atomic Transaction Sync:** Consolidated `bulkUpdateStats`, `bulkMarkDead`, and `bulkUpdateAllostaticStates` into a single `sqlite.transaction` block per iteration, ensuring the agent's physical, social, and economic states are committed atomically.
* **Abort-Reset Race Guard:** Hardened the persistence logic to check `isAbortRequested` immediately before iteration commits, preventing "ghost iterations" from being recorded after a user has issued a reset command.
