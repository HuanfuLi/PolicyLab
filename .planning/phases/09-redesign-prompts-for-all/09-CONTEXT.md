# Phase 9: Redesign Prompts for All - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Redesign all LLM prompts in `server/src/llm/prompts.ts` (2025 lines, 20+ builder functions) to:
1. Fix the death spiral caused by agents not producing food — give agents complete economic knowledge so they reason from first principles
2. Deepen agent immersion — remove simulation-awareness, remove mechanical system tags, make agents BE their characters
3. Enrich agent backgrounds for differentiated emergent behavior
4. Restructure the monolithic prompts.ts into domain-specific modules

This phase does NOT change the physics engine, action codes, or simulation runner. It changes only what the LLM sees and how prompts are organized.

</domain>

<decisions>
## Implementation Decisions

### Economic Survival Signals
- **D-01:** Agents receive full physics rules as lived knowledge — they know MET metabolism costs ~5-6 food/iter, how AMM constant-product pricing works (buy more → price rises), that production yields 20 food, and that wealth = survival. They reason from first principles rather than receiving reactive alerts.
- **D-02:** Each agent sees a personal economic dashboard every iteration: current food price (AMM spot price), their wealth vs food cost, AMM reserve status. They can calculate "can I afford to eat next week?" themselves.
- **D-03:** Market data is presented as numbers, not narrative abstractions. Agents see "food price: 25.6 fiat/unit" not "food is expensive."

### Prompt Accuracy & Freshness
- **D-04:** Fix the inaccurate MET claim — current prompt says "1 Food is consumed automatically" but actual cost is ~5-6 food/iter. Replace with accurate lived knowledge: "You need roughly 5-6 food units per week to survive."
- **D-05:** Keep Darwinian Market price anchoring for iteration 1 ("fair price for food is 3-5 Wealth"). From iteration 2 onward, replace with live AMM market data (actual spot prices).

### Agent Immersion
- **D-06:** Remove all third-person simulation framing. "You are a citizen living in a simulated society" → first-person embodiment. The agent IS the person, not playing a character in a simulation.
- **D-07:** Remove all mechanical [SYSTEM TAG] labels: [BACKGROUND SYSTEM], [CAPITALIST IDENTITY], [BIOLOGICAL SUBCONSCIOUS], [LEGAL RISK ASSESSMENT], [AVAILABLE ACTIONS], etc. Rewrite the content as natural lived experience, inner thoughts, or embodied knowledge. The information stays; the game-engine framing goes.
- **D-08:** Stress/biological state prose (the evocative "cold descending darkness" writing) is kept but woven into the agent's internal state naturally without the [BIOLOGICAL SUBCONSCIOUS] tag.

### Role-Specific Behavior
- **D-09:** Role-specific economic instincts woven into agent life stories, not injected as system blocks. A farmer's background includes "he knows that when food is scarce, those who produce eat first and profit most." Remove the [CAPITALIST IDENTITY] block and replace with character-driven economic philosophy from the life story.
- **D-10:** The penalty framing for NONE action changes from mechanical ("-1 Health, +2 Cortisol") to lived knowledge ("Sitting idle eats at you — your body weakens and anxiety builds").

### Agent Backgrounds
- **D-11:** Central Agent generates 5-8 sentence full life stories per agent: childhood, formative events, relationships, fears, ambitions, and economic philosophy. Example: "Tomas grew up on the eastern ridge... He distrusts merchants — they once paid him half-price for a full harvest during a drought. He hoards food instinctively."
- **D-12:** The `buildAgentRosterMessages` prompt changes from "1-2 sentence background" to require rich life stories that include economic instincts and role-specific knowledge.

### Central Agent Narrative
- **D-13:** Central Agent resolution prompt KEEPS mechanical framing ("You are the Central Agent resolving iteration N"). Immersion changes are for citizen agents only.
- **D-14:** NARRATIVE DIRECTIVE keeps friction-first bias. "Prioritise FRICTION, INEQUALITY, DISRUPTION" stays as-is.

### Agent Memory & Cognitive Context
- **D-15:** Add economic memory — agents remember past prices they paid, wages earned, production outcomes. "Last week food cost me 18 fiat. Two weeks ago it was 12. Prices are rising fast." Enables emergent economic reasoning from personal experience.
- **D-16:** Multi-week planning — agents form goals like "save 50 fiat to buy tools" or "produce food for 3 weeks then switch to luxury goods." Plans carry forward and update based on outcomes.

### Action Schema Presentation
- **D-17:** Actions presented as natural language + code mapping: "Farm your land and sell the harvest (PRODUCE_AND_SELL)" instead of bare code-first format. Agent thinks naturally but outputs correct action codes.
- **D-18:** Action penalties/effects described as lived knowledge, not game mechanics. "Sitting idle eats at you" not "-1 Health, +2 Cortisol penalty."

### Prompt Structure
- **D-19:** Split prompts.ts into domain-specific modules:
  - `prompts/agent-intent.ts` — citizen decision prompts (buildNaturalIntentPrompt, buildIntentPrompt)
  - `prompts/central-agent.ts` — brainstorm, overview, law, resolution, merge prompts
  - `prompts/reflection.ts` — agent reflection, evaluation, review chat
  - `prompts/governance.ts` — proposals, ballots, voting, franchise size, legality
  - `prompts/comparison.ts` — comparison messages, comparison chat
  - `prompts/location.ts` — location-based roster, law, scenario interpretation
  - `prompts/shared.ts` — action schemas, helper builders, shared types
- **D-20:** Template strings stay inline inside builder functions (no external template files). The prompt IS the logic.

### Claude's Discretion
- Exact wording of the immersive rewrites — Claude has flexibility in how to rephrase mechanical blocks into natural language, as long as D-06/D-07/D-08 principles are followed.
- How economic memory is structured and injected — implementation details deferred to planning.
- How multi-week plans are persisted and updated — may require minor changes to cognitive engine or just prompt changes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Prompt System
- `server/src/llm/prompts.ts` — Current monolithic prompt file (2025 lines, 20+ builders). The file being restructured.
- `CLAUDE.md` §"Key Files" — Notes prompts.ts as "single source of truth for all LLM prompts and JSON output schemas"
- `CLAUDE.md` §"Development Conventions" — "Add/modify in prompts.ts only. All LLM calls must use structured JSON outputs with explicit schemas."

### Economic Mechanics (context for accurate prompt content)
- `server/src/mechanics/physicsConfig.ts` — satietyKcalPerPoint=70, tickDurationHrs=1 (determines ~5.7 food/iter MET cost)
- `server/src/mechanics/allostaticEngine.ts` — MET metabolism calculation, stress pipeline
- `server/src/mechanics/actionCodes.ts` — All action codes and role-permission table
- `server/src/orchestration/simulationRunner.ts` lines 796-819 — PRODUCE_AND_SELL resolution (BASE_PRODUCE_QUANTITY=20)
- `server/src/orchestration/simulationRunner.ts` lines 414-530 — MET metabolism auto-buy cascade
- `server/src/orchestration/simulationRunner.ts` lines 2449-2505 — Background farming + famine reserve injection

### Cognitive System
- `server/src/cognition/cognitiveEngine.ts` — Memory retrieval, plan formation, reflection system
- `server/src/cognition/__tests__/phase3.test.ts` — Existing cognitive system tests

### Death Spiral Evidence
- `Results/session-lex-mercatoria.json` — Session showing totalCaloriesProduced=0 in 18/20 iterations
- `Results/session-the-veridian-accord.json` — Same pattern, confirming systemic prompt failure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildActionDictionary()` (prompts.ts:485) — Action schema builder, needs natural language rewrite per D-17
- `buildMarketBoardSection()`, `buildEmploymentBoardSection()`, `buildPersonalStatusSection()` — Existing context builders that inject market data
- `buildCitizenBankingSection()`, `buildCitizenCapitalMarketSection()`, `buildCitizenFiscalSection()` — Financial context builders
- `ACTION_SCHEMAS` object (prompts.ts:346-479) — Action descriptions and parameter schemas

### Established Patterns
- Static prefix (cacheable across agents) + dynamic suffix (agent-specific) pattern in buildNaturalIntentPrompt
- Context blocks injected conditionally based on feature flags (bankingEnabled, capitalMarketsEnabled, etc.)
- All prompts return `LLMMessage[]` arrays consumed by the multi-provider LLM gateway

### Integration Points
- `simulationRunner.ts` calls `buildNaturalIntentPrompt()` with all context parameters — parameter signature changes need to be wired here
- `centralAgent.ts` calls brainstorm/overview/law/resolution prompts
- `cognitiveEngine.ts` provides memory/plan/reflection context to intent prompts
- Market data (AMM spot price, food reserve) is available in simulationRunner via `sessionAMMRegistry` — needs to be passed through to prompt builders (new parameter)
- Agent roster generation happens in `centralAgent.ts` and `dataBootstrapPipeline.ts`

</code_context>

<specifics>
## Specific Ideas

- The Tomas Alder life story example represents the target depth and quality for agent backgrounds: childhood origin, formative trauma, economic philosophy derived from experience, specific behavioral instincts (hoards food), personal fears
- Economic dashboard should feel like the agent's own awareness: "I have 12 fiat. Food costs 25.6 per unit at market. I can barely afford 2 days of food." Not a data table.
- The death spiral investigation (from Results/ directory) is the primary motivation — two sessions with 31 and 41 agents both collapsed to avgWealth=7, avgHealth=30, avgHappiness=0 because agents never chose PRODUCE_AND_SELL despite having it available

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-redesign-prompts-for-all*
*Context gathered: 2026-04-07*
