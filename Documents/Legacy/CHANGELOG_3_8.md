# IDEAL WORLD: ARCHITECTURE CHANGELOG

## 1. Core Simulation Architecture & Engine Updates

* **HMAS Map-Reduce (Clustering) Architecture:** Implemented a three-stage simulation pipeline (Map, Reduce, Merge) to support up to 150+ agents. This bypasses LLM context limits by clustering agents by role and generating group-level narratives before final synthesis.
* **Transition to Hybrid Micro-Turn System:** Scaled the simulation time down from "1 Iteration = 1 Year" to "1 Iteration = 1 Week" to allow for higher-resolution decision making.
* **Action Queue (Multi-Action Turns):** Removed the "1 Action per Iteration" bottleneck. Agents can now generate an array of up to 3 sequential actions per iteration (e.g., `["WORK_AT_ENTERPRISE", "POST_BUY_ORDER", "REST"]`).
* **AMM Persistence & SFC Resilience:** Implemented `amm_snapshots` in SQLite to ensure Automated Market Maker reserves survive server restarts. Added Stock-Flow Consistent (SFC) drift detection to catch fiat leaks in the circular economy.
* **Sequential Resolution & Interrupts:** The Symbolic engine now processes actions in an agent's queue sequentially. If physiological thresholds are breached mid-queue (e.g., Health drops below 20 after Action 1), subsequent actions are immediately aborted.
* **Single-Pass Structured Output:** Deprecated the standalone "Parser Agent" to prevent API/Socket concurrency crashes. LLMs now output `internal_monologue`, `public_narrative`, and `ActionCodes` (as a JSON array) in a single generation tick.
* **Regime Collapse Fail-State (Early Termination):** Introduced a global circuit breaker. If societal average `Cortisol >= 100` or `Happiness <= 0`, the simulation automatically aborts the main loop, declares the society a failure, and skips directly to the Post-Mortem review.

## 2. Neuro-Symbolic Cognitive Layer (LLM Logic)

* **Localized Memory Stream (Information Asymmetry):** Eradicated "Global Information Contamination" (hive-mind). Agents no longer receive global `stateSummary` injections. They only know what they physically observe, trade, or learn via the `COMMUNICATE` action.
* **Hard Context Capping:** Implemented token truncation for memory retrieval to prevent Context Window overflow and subsequent LLM hallucinations.
* **Class-Based Tone Overrides:** Imposed strict prompt rules to break LLM "RLHF homogenization." Agents must speak and reflect using the vocabulary, biases, and rawness appropriate to their socioeconomic class.
* **Directional Economic Reflection:** Forced agents to ground their periodic reflections in material reality (finances, hunger, equality) rather than purely abstract philosophy, accelerating the emergence of class consciousness.
* **The Post-Mortem Interview Mechanism:** "Ghost Society" bug fixed. Dead agents are completely isolated from the action loop (they cannot work or trade). However, their frozen memories are preserved, and they are prompted at the end of the simulation to critique the systemic failures that killed them.

## 3. Deterministic Physics & Metabolism (The "Body")

* **Passive Metabolism & Auto-Consumption:** Decoupled basic survival from the LLM's active decision space. At the end of every iteration, the engine automatically consumes `1 Food` from the agent's inventory, or auto-buys it using `Wealth`.
* **Empirical MET System (Metabolic Equivalent of Task):** Replaced flat caloric burns with physiological MET multipliers. `WORK_HEAVY_MANUAL` drains satiety up to 7.25x faster than `REST` or `WORK_COGNITIVE`, ensuring physical laborers must eat significantly more.
* **Age Inefficiency Modifier:** Agents over the age of 60 incur up to a 25% biomechanical penalty on physical exertion, requiring more food to produce the same physical output.
* **Allostatic Load Pipeline (Psychosomatic Decay):** Replaced flat stress penalties with the Energetic Model of Allostatic Load (EMAL). Transient `Cortisol` (0-100) mathematically converts into reversible `Strain`, which calcifies into irreversible `Load`, eventually draining structural `Health` to simulate chronic stress-induced mortality.

## 4. Macroeconomics & Market Mechanics

* **Strict Fiat-Only Market Enforcement:** Removed barter (`TRADE`) to close deflationary black holes. All exchanges must use legal tender (`Wealth`) via `POST_BUY_ORDER` and `POST_SELL_ORDER`.
* **Autonomous Agent Pricing:** Agents now dynamically set their own bid/ask prices on the global order book based on injected context.
* **Dynamic Market Board Context:** LLMs are injected with a real-time `[Current Market Board]` showing average clearing prices and trends for all commodities (`Food`, `Tech_Parts`, `Luxury`), forcing them to act as rational economic actors.
* **Constant Product Automated Market Maker (AMM):** Replaced the fragile peer-to-peer order book with an algorithmic liquidity pool ($x \cdot y = k$). The system acts as the buyer and seller of last resort, ensuring dynamic pricing and infinite liquidity (preventing market freezes).
* **Stock-Flow Consistent UBI (Demurrage Tax):** Implemented a 2% wealth decay ($\tau$) on fiat currency at the end of macro-cycles. Hoarded wealth decays and is redistributed as Universal Basic Income, forcing the velocity of money and preventing liquidity traps.
* **Darwinian Humiliation Fallback:** If an agent reaches `0 Food`, `Health < 20`, and cannot afford the AMM spot price, the system force-feeds them synthetic slop, resets their `Wealth` to 0, spikes `Cortisol` to 100, and injects a traumatic memory to spark revolutionary intent.

## 5. Society, Labor & Enterprise Mechanics

* **Action Space Clarification (PRODUCE vs. WORK):**
* `PRODUCE_AND_SELL`: Independent entrepreneurship. Generates items into the agent's inventory and automatically lists them on the AMM. Generates 0 direct wealth until sold.
* `WORK_AT_ENTERPRISE`: Wage labor. Generates items directly into the employer's inventory in exchange for a fixed `Wealth` wage.


* **Hard Commodity Utility:** Assigned physical purpose to all items to create real demand:
* `Tech_Parts / Tools`: Provide a 2.0x Productivity Buff to labor output.
* `Raw_Materials`: Required as supply-chain inputs for manufacturing enterprises.
* `Luxury_Services`: Drastically reduces `Cortisol` to prevent mental breakdowns and productivity penalties.


* **Enterprise HR & Recruitment Loop:** Added `FOUND_ENTERPRISE`, `POST_JOB_OFFER`, `APPLY_FOR_JOB`, `HIRE_EMPLOYEE`, and `FIRE_EMPLOYEE`. Entrepreneurs can leverage economies of scale and hire labor based on skill metrics.
* **Strict Employment Contracts:** Employed agents are contextually bound by their job. If they are employed, their action queue MUST contain at least one `WORK_AT_ENTERPRISE` action, or they must explicitly use the `QUIT_JOB` action to break the contract.
* **Asymmetric Class Actions:** Introduced class-restricted actions (e.g., `EMBEZZLE`, `CALL_POLICE` for Elites; `STRIKE`, `RIOT`, `SABOTAGE` for Commoners) to allow for real systemic oppression and physical pushback.