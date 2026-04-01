# IMPLEMENTATION OVERSIGHT: IDEAL WORLD ARCHITECTURE (REVISED)

Following a re-examination of the codebase after the "implementation fix" and the "Single-Pass Action Selection" feature update, the following architectural status is confirmed.

## 1. Core Simulation Architecture & Engine Updates

### ✅ Resolved: Regime Collapse Threshold Discrepancy
*   **Status:** Updated in `simulationRunner.ts`.
*   **Observation:** The code uses `95/5` for safety and stability to prevent "zombie iterations."
*   **Code Snippet:**
    ```typescript
    // server/src/orchestration/simulationRunner.ts (Lines 1443-1444)
    const COLLAPSE_CORTISOL = 95;
    const COLLAPSE_HAPPINESS = 5;
    ```

---

## 2. Neuro-Symbolic Cognitive Layer (LLM Logic)

### ✅ Resolved: Single-Pass Action Selection (Parser Deprecation)
*   **Status:** Fully Implemented.
*   **Observation:** The two-step process (Natural Language -> Parser Agent) has been replaced by a single-pass structured JSON output.
*   **Mechanism:**
    1.  **Action Dictionary:** `server/src/llm/prompts.ts` now injects a full list of `ACTION_DESCRIPTIONS` and parameters into the system prompt.
    2.  **Structured Output:** The LLM is forced to return a JSON object containing `internal_monologue`, `public_narrative`, and an `actions` array.
    3.  **Role-Based Restriction:** `getAllowedActions(agent.role)` is passed to the prompt, ensuring agents only see and select actions valid for their social class (Asymmetric Class Actions).
    4.  **Validation:** `simulationRunner.ts` validates the selected `actionCode` against the `allowedSet` for the agent's role, dropping hallucinated or disallowed actions before they reach the Physics Engine.
*   **Code Snippet (Validation):**
    ```typescript
    // server/src/orchestration/simulationRunner.ts
    const allowedSet = new Set<string>(getAllowedActions(agent.role));
    let validatedActions = parsed.actions.filter(a => {
      if (!allowedSet.has(a.actionCode)) {
        console.warn(`[HALLUCINATION] ${agent.name} disallowed code "${a.actionCode}" — dropped`);
        return false;
      }
      return true;
    });
    ```

### ✅ Resolved: Directional Economic Reflection
*   **Status:** Implemented in `reflectionTree.ts`.
*   **Observation:** The `buildReflectionPrompt` now structurally forces the LLM to address "Personal Financial Security," "Resource Acquisition Difficulty," and "Societal Fairness."

---

## 3. Deterministic Physics & Metabolism (The "Body")

### ✅ Resolved: Empirical MET System (Metabolic Equivalent of Task)
*   **Status:** Integrated into `simulationRunner.ts`.
*   **Observation:** The `applyMETMetabolism` function uses the MET system from `allostaticEngine.ts` to compute a variable `satietyCost` based on the agent's primary action.

### ⚠️ Partial: Age Inefficiency Modifier & Persistence
*   **Status:** Logic exists but data is transient.
*   **Observation:** `applyMETMetabolism` uses `agent.age ?? 35`. However, the `age` field is still missing from the `agents` database table and the `Agent` TypeScript type.

### ⚠️ Partial: Allostatic Load Pipeline (Psychosomatic Decay)
*   **Status:** Integrated but transient.
*   **Observation:** The allostatic load pipeline is executed in the main loop, but `allostaticStrain` and `allostaticLoad` values are stored in a volatile Map and **NOT persisted to the database**.

---

### ✅ Resolved: HMAS Map-Reduce (Clustering) Architecture
*   **Status:** Fully Implemented in `simulationRunner.ts`.
*   **Observation:** The simulation now supports 150+ agents by clustering them by role and performing a Map-Reduce narrative synthesis.

---

## 4. Macroeconomics & Market Mechanics

### ✅ Resolved: Constant Product Automated Market Maker (AMM)
*   **Status:** Integrated for Food and Commodity trades.
*   **Observation:** `simulationRunner.ts` uses `AutomatedMarketMaker` for food, raw materials, and luxury goods, providing algorithmic liquidity.

### ✅ Resolved: AMM Persistence & SFC Resilience
*   **Status:** Implemented via `amm_snapshots` table.
*   **Observation:** AMM reserves are now persisted to the SQLite database every iteration, with a vacuum process to manage growth. Stock-Flow Consistent (SFC) drift detection is active.

### ⚠️ Partial: Stock-Flow Consistent UBI (Demurrage Tax)
*   **Status:** Integrated in `simulationRunner.ts`.
*   **Observation:** `computeDemurrageCycle` is called every macro-cycle (10 iterations) to redistribute wealth via a 2% tax.

---

## 5. Society, Labor & Enterprise Mechanics

### ✅ Resolved: Hard Commodity Utility (Tool Buff & Luxury Services)
*   **Status:** Implemented and integrated.
*   **Observation:** Tools provide a ~2.0x productivity buff, and luxury goods reduce Cortisol by 20 points.

### ✅ Resolved: Darwinian Humiliation Fallback
*   **Status:** Implemented in `simulationRunner.ts`.
*   **Observation:** Agents with `< 20 Health` and `0 Food` are "humiliated" (wealth reset to 0, health to 30, cortisol to 100) and receive a specific cognitive prompt.
