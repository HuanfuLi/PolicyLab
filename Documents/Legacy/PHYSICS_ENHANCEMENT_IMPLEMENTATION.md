# Ideal World - Neuro-Symbolic Architecture (Generative Agent Enhanced) Upgrade Blueprint

This blueprint establishes a perfect integration framework between the underlying deterministic physics/economic engine and the top-level generative agent cognitive architecture. The ultimate goal is to facilitate the emergence of realistic social behaviors driven by genuine economic pressures, such as class consciousness and strikes.

To guarantee high cohesion, low coupling, and the ability for progressive evolution, this implementation roadmap is strictly divided into mutually independent, testable **Phases**. This ensures that AI Agents can execute incremental upgrades across different sessions without interfering with existing systems. Furthermore, dedicated integration strategies are provided to allow rapid combination and testing of workflows after each phase is completed.

---

## Phase 1: Deterministic Physics & Economic Engine (The Symbolic Foundation)

This phase entirely shifts the symbolic layer away from hardcoded rules towards a realistic resource-based simulation. It must be able to run independently of the LLM by accepting standard `ActionCodes`.

### Component 1A: Dynamic Skills and Dual-Track Production
*   **Goal**: Abolish static, hardcoded occupations. Empower Agents with a fluid skill system based on "learning by doing."
*   **Design**:
    *   Initialize all Agents with an egalitarian starting skill matrix.
    *   Executing specific actions increases the corresponding skill multiplier while maintaining a natural decay over time.
    *   **Dual-Track Labor**: Agents can operate independently as primary producers (subsistence/peasant mode) or expend significant capital to establish corporate entities. Capitalist Agents can use `SET_WAGE` to hire others, establishing an employer-employee dynamic.

### Component 1B: Physical Asset Inventory
*   **Goal**: Introduce physical, consumable assets to ground survivability in tangible resources.
*   **Design**:
    *   Introduce items like **Food** (embodying direct survival pressure) and **Tools** (embodying means of production/productivity).
    *   Attach physical properties to these items, such as spoilage rates for food and durability/depreciation curves for tools.

### Component 1C: Global Order Book Matching Engine
*   **Goal**: Replace 1-on-1 bartering with a realistic market clearing mechanism.
*   **Design**:
    *   Abstract all market interactions into `POST_BUY_ORDER` and `POST_SELL_ORDER` commands (containing target item, price, and quantity).
    *   All parsed orders enter a global system order book.
    *   At the end of each iteration, the system matches orders centrally based on price/time priority, dynamically establishing the market's supply-demand equilibrium and real-time price indices.

### 🔗 Phase 1 Integration & Testing Strategy
*   **Testing**: This phase can be tested in complete isolation from LLMs. Write a dummy script that feeds randomized or deterministic `ActionCodes` (e.g., 50 Agents posting buy/sell orders) into the `physicsEngine` and verify if the Order Book resolves correctly, inventories update, and prices reflect simulated supply/demand.

---

## Phase 2: The Neuro-Symbolic Bridge (Parsing & Safety)

This phase acts as the critical translation layer, securely mapping the boundless creativity of natural language onto the rigid boundaries of the Physics Engine.

### Component 2A: The Parser Agent (Lightweight Intermediary)
*   **Goal**: Allow the primary Generative Agent to output purely natural language intents without worrying about system syntax.
*   **Design**:
    *   The Main Agent outputs its thoughts naturally (e.g., *"I can't afford food anymore! I refuse to work at the factory today, I'm going to the plaza to protest."*).
    *   A smaller, highly-constrained LLM (the Parser Agent) receives this string and maps it strictly to the allowed symbolic action schema (e.g., `ActionCode: STRIKE`).

### Component 2B: Safety and Fallback Mechanism
*   **Goal**: Prevent engine crashes or undefined states caused by LLM hallucinations.
*   **Design**:
    *   If the Main Agent outputs a behavior that holds zero economic or physical relevance to the engine (e.g., *"Take a walk on the beach"*), the Parser Agent must safely map this to `ActionCode: REST` or `NONE`.
    *   This guarantees the deterministic engine in Phase 1 always receives valid typed parameters.

### 🔗 Phase 2 Integration & Testing Strategy
*   **Testing**: Test the Parse Agent independently by passing it an array of diverse natural language strings (both relevant and absurd). Assert that the output is always a valid `ActionCode`.
*   **Integration with Phase 1**: Chain the resolved `ActionCodes` from the Parser Agent directly into the Phase 1 Physics Engine inputs.

---

## Phase 3: Generative Cognitive Layer & Subjective Memory

This phase overhauls the Agent's consciousness. It removes the "omniscient" global data injection (like broadcasting the Gini index to everyone) and grounds the Agent in a limited, subjective perspective driven by localized experiences.

### Component 3A: Localized Memory Stream
*   **Goal**: Establish strict information asymmetry. Agents only know what they physically experience.
*   **Design**:
    *   Every experience is recorded as a natural language memory object containing a description, creation timestamp, and last-accessed timestamp.
    *   Macro-data (prices, inequality) is *not* globally broadcast. Agents must travel to a location (e.g., a Market or Exchange) or converse with others to deduce prices, inherently simulating information delay and localization.

### Component 3B: 3D Retrieval System
*   **Goal**: Intelligently surface the most relevant context from a massive memory stream.
*   **Design**:
    *   Calculate a composite retrieval score based on three dimensions:
        1.  **Recency**: Exponential decay based on time since creation/last access.
        2.  **Importance**: Prompt the LLM to score the memory's fundamental significance (1-10) upon creation.
        3.  **Relevance**: Cosine similarity between the memory embedding and the current situation/query.

### Component 3C: Directed Economic Reflection Tree
*   **Goal**: Synthesize raw experiences into high-level sociological and economic motivations.
*   **Design**:
    *   Trigger an asynchronous reflection cycle when the sum of incoming memory importance breaches a threshold.
    *   **Crucial Dimension Injection**: When prompting the LLM for reflection, structurally force the inclusion of survival-centric questions (e.g., *"Based on your recent memories, what is your high-level view on your personal financial security, the difficulty of acquiring resources, and the fairness of society?"*).
    *   This forced economic reflection gives rise to synthesized higher-order memories, serving as the direct algorithmic catalyst for class consciousness and protest motivation.

### Component 3D: Recursive Planning
*   **Goal**: Shift behavior from immediate reaction to long-term proactive strategy.
*   **Design**:
    *   Based on retrieved memories and reflections, the Agent drafts a macroscopic natural language daily/weekly plan.
    *   This plan is recursively broken down into specific steps. 
    *   **Dynamic Overwrite**: If confronted with severe sudden events (e.g., being robbed or witnessing hyperinflation), the Agent is forced to halt, trigger an immediate situational evaluation, and rewrite the recursive plan.

### 🔗 Phase 3 Integration & Testing Strategy
*   **Testing**: Can be tested by manually injecting synthetic memories (e.g., "I starved yesterday", "Bread costs $1000") and observing if the Reflection Tree successfully generates anti-establishment class consciousness.
*   **Full System Integration (Phases 1 + 2 + 3)**:
    1.  Agent retrieves subjective context via the **3D Retrieval System** (Phase 3).
    2.  Agent forms a **Recursive Plan** and outputs a natural language action step (Phase 3).
    3.  **Parser Agent** translates the step into an `ActionCode` (Phase 2).
    4.  **Physics Engine & Order Book** completely resolves the world state (Phase 1).
    5.  The physical outcomes (trade success/failure, wage received) are converted back into natural language experiences and injected into the Agent's **Localized Memory Stream** (Phase 3), ready for the next iteration.
