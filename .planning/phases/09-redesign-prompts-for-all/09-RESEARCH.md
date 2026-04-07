# Phase 9: Redesign Prompts for All - Research

**Researched:** 2026-04-06
**Domain:** LLM prompt engineering, TypeScript module refactoring
**Confidence:** HIGH

## Summary

Phase 9 is a prompt rewrite and file restructuring phase that touches only `server/src/llm/prompts.ts` (2025 lines, 20+ builder functions) and its consumers. The current prompts cause a death spiral where agents never produce food (totalCaloriesProduced=0 in 18/20 iterations across multiple test sessions), largely because: (1) the prompt falsely claims "1 Food is consumed automatically" when actual MET cost is ~5-6 food/iter, (2) agents lack economic reasoning context to understand food production is essential for survival, and (3) mechanical system tags like [BIOLOGICAL SUBCONSCIOUS] break immersion and reduce LLM agency.

The phase has three orthogonal workstreams: (A) fix economic survival signals to prevent the death spiral, (B) rewrite citizen agent prompts for immersion (remove simulation-awareness, system tags, and third-person framing), and (C) split the monolithic prompts.ts into 7 domain-specific modules. These workstreams have minimal interdependence -- the file split can be done before or after content rewrites.

**Primary recommendation:** Split prompts.ts into modules first (mechanical refactoring, easily validated via TypeScript compilation + existing tests), then rewrite citizen intent prompt content (the most impactful and riskiest change), then update remaining prompts (roster generation for richer backgrounds, reflection prompts for immersion consistency).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Agents receive full physics rules as lived knowledge -- MET metabolism costs ~5-6 food/iter, AMM constant-product pricing, production yields 20 food, wealth = survival. First-principles reasoning, not reactive alerts.
- **D-02:** Personal economic dashboard every iteration: food price (AMM spot), wealth vs food cost, AMM reserve status. Agent calculates affordability themselves.
- **D-03:** Market data presented as numbers, not narrative abstractions. "food price: 25.6 fiat/unit" not "food is expensive."
- **D-04:** Fix inaccurate MET claim -- replace "1 Food is consumed automatically" with "You need roughly 5-6 food units per week to survive."
- **D-05:** Keep Darwinian Market price anchoring for iteration 1 ("fair price for food is 3-5 Wealth"). From iteration 2+, replace with live AMM data.
- **D-06:** Remove all third-person simulation framing. First-person embodiment, not "playing a character in a simulation."
- **D-07:** Remove all mechanical [SYSTEM TAG] labels. Rewrite content as natural lived experience. Information stays; game-engine framing goes.
- **D-08:** Stress/biological state prose kept but woven naturally without [BIOLOGICAL SUBCONSCIOUS] tag.
- **D-09:** Role-specific economic instincts woven into agent life stories, not injected as system blocks.
- **D-10:** NONE action penalty described as lived knowledge ("Sitting idle eats at you"), not game mechanics ("-1 Health, +2 Cortisol").
- **D-11:** Central Agent generates 5-8 sentence full life stories per agent: childhood, formative events, relationships, fears, ambitions, economic philosophy.
- **D-12:** `buildAgentRosterMessages` prompt changes from "1-2 sentence background" to require rich life stories with economic instincts and role-specific knowledge.
- **D-13:** Central Agent resolution prompt KEEPS mechanical framing. Immersion changes are for citizen agents only.
- **D-14:** NARRATIVE DIRECTIVE keeps friction-first bias unchanged.
- **D-15:** Economic memory -- agents remember past prices, wages, production outcomes. Enables emergent economic reasoning from personal experience.
- **D-16:** Multi-week planning -- agents form goals that carry forward and update based on outcomes.
- **D-17:** Actions presented as natural language + code mapping: "Farm your land and sell the harvest (PRODUCE_AND_SELL)".
- **D-18:** Action penalties/effects described as lived knowledge, not game mechanics.
- **D-19:** Split prompts.ts into 7 domain modules: agent-intent, central-agent, reflection, governance, comparison, location, shared.
- **D-20:** Template strings stay inline inside builder functions (no external template files).

### Claude's Discretion
- Exact wording of immersive rewrites -- flexibility in rephrasing, following D-06/D-07/D-08 principles.
- How economic memory is structured and injected -- implementation details.
- How multi-week plans are persisted and updated -- may require minor cognitive engine changes or just prompt changes.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Architecture Patterns

### Recommended Module Structure (D-19)

```
server/src/llm/
  prompts/
    index.ts              # Re-exports everything (backward compat)
    agent-intent.ts       # buildNaturalIntentPrompt, buildIntentPrompt, related types/helpers
    central-agent.ts      # buildBrainstormMessages, buildOverviewMessages, buildLawMessages,
                          # buildAgentRosterMessages, buildResolutionPrompt, buildFinalReportPrompt,
                          # buildGroupResolutionMessages, buildMergeResolutionMessages, buildRefineMessages
    reflection.ts         # buildAgentReflectionPrompt, buildAgentReflection2Prompt,
                          # buildEvaluationPrompt, buildReviewChatPrompt, buildPostMortemPrompt
    governance.ts         # buildProposalPrompt, buildBallotPrompt, buildVotePrompt,
                          # buildFranchiseSizePrompt, buildLegalityCheckPrompt
    comparison.ts         # buildComparisonMessages, buildComparisonChatMessages
    location.ts           # buildLocationAgentRosterMessages, buildLocationLawMessages,
                          # buildScenarioInterpretationMessages
    shared.ts             # ACTION_SCHEMAS, buildActionDictionary, all exported interfaces/types,
                          # helper builders (buildMarketBoardSection, buildEmploymentBoardSection, etc.)
```

### Import Dependency Map (Consumers to Update)

| Consumer File | Current Import | New Import Path |
|---|---|---|
| `centralAgent.ts` | `./prompts.js` | `./prompts/index.js` (or individual modules) |
| `simulationRunner.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |
| `reflectionRunner.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |
| `governanceManager.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |
| `routes/bootstrap.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |
| `routes/compare.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |
| `routes/review.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |
| `__tests__/sfcInflation.test.ts` | `../llm/prompts.js` | `../llm/prompts/index.js` |

### Pattern: Barrel Re-export for Backward Compatibility

The `prompts/index.ts` barrel file must re-export everything from all sub-modules so that existing `import { X } from '../llm/prompts.js'` paths continue to work after renaming (import path changes from `prompts.ts` to `prompts/index.ts` which resolves identically when `prompts/` is a directory with `index.ts`).

**Critical detail:** TypeScript/Node resolves `./prompts.js` to `./prompts/index.js` when `prompts` is a directory. The old file `prompts.ts` MUST be deleted (not left alongside the directory) to avoid ambiguity. All 8 consumer files need their import path changed from `./prompts.js` to `./prompts/index.js` (or just `./prompts/index.js` explicitly for clarity).

### Pattern: Static Prefix + Dynamic Suffix (Preserve)

The existing pattern in `buildNaturalIntentPrompt` splits content into:
- **Static prefix** (cacheable via `cache_control: { type: 'ephemeral' }`) -- identical across all agents in an iteration
- **Dynamic suffix** -- agent-specific data that changes every call

This pattern MUST be preserved in the rewrite. It enables prompt caching with Anthropic's API, reducing latency and cost for multi-agent simulations by ~50%.

### Pattern: Conditional Feature Blocks (Preserve)

Context blocks are injected conditionally based on session config flags:
```typescript
const citizenBankingBlock = buildCitizenBankingSection(citizenBankingContext);
const bankOperationsBlock = buildBankOperationsSection(bankOperationsContext);
```

These helper builders return empty strings when context is undefined, enabling zero-cost feature toggling. This pattern MUST be preserved.

### Anti-Patterns to Avoid
- **External template files:** D-20 explicitly locks template strings inline. Do not create `.txt` or `.md` template files.
- **Breaking the barrel:** Do not remove exports from `prompts/index.ts` that consumers currently use. Every type and function must remain accessible.
- **Changing function signatures in the split:** The file split (D-19) MUST NOT change any function signature. Signature changes happen in separate content-rewrite tasks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AMM spot price formatting | Custom price formatter | Pass raw number, format inline in template string | Numbers are the point (D-03) |
| Economic memory persistence | New DB table for price history | Existing `cognitiveEngine.ts` memory system (D-15) | Memories already persist via `createExperienceMemories` |
| Multi-week plan persistence | New plan storage system | Existing `recursivePlanner.ts` plan system (D-16) | Plans already carry forward with `getAgentPlan`/`runPlanning` |
| Action schema rewrite | New action schema format | Modify existing `ACTION_SCHEMAS` object + `buildActionDictionary` helper | Schema structure stays, descriptions change |

## Common Pitfalls

### Pitfall 1: Breaking the Static/Dynamic Split
**What goes wrong:** Moving agent-specific data into the static prefix or session data into the dynamic suffix breaks prompt caching.
**Why it happens:** The new economic dashboard (D-02) includes AMM spot prices which are per-iteration (static) but feel agent-specific.
**How to avoid:** AMM spot price, food reserve status, and iteration-level market data belong in the STATIC prefix (they're the same for all agents in an iteration). Agent wealth, inventory, and personal economic assessment belong in the DYNAMIC suffix.
**Warning signs:** If the static prefix varies between agent calls in the same iteration, caching is broken.

### Pitfall 2: Prompt Length Explosion
**What goes wrong:** Adding D-01 (full physics rules as lived knowledge), D-02 (personal economic dashboard), D-15 (economic memory), and D-16 (multi-week plans) could bloat the prompt beyond context limits.
**Why it happens:** Each decision adds 100-300 tokens of context.
**How to avoid:** Budget tokens carefully. Physics rules as lived knowledge should be ~150 words (not a textbook). Economic dashboard should be ~50 words. Memory should be truncated to top 3-5 entries. Plans should be the current step only (already the pattern in cognitive context).
**Warning signs:** Total system prompt exceeding ~2000 tokens for citizen intent prompts.

### Pitfall 3: Import Path Resolution After File Split
**What goes wrong:** TypeScript compilation fails because `./prompts.js` doesn't resolve correctly when `prompts.ts` becomes `prompts/index.ts`.
**Why it happens:** Node.js module resolution differs between `file.ts` and `directory/index.ts`. The `.js` extension in imports (required by the project's ESM config) needs to resolve correctly.
**How to avoid:** After creating `prompts/` directory and deleting `prompts.ts`, update all 8 consumer imports to `./prompts/index.js` explicitly. Run `npm run build` to verify.
**Warning signs:** `Cannot find module './prompts.js'` errors at compile time.

### Pitfall 4: Losing JSON Output Schema Enforcement
**What goes wrong:** Immersive rewrite removes JSON schema examples from the prompt, causing LLM output to become free-form text instead of parseable JSON.
**Why it happens:** The immersion rewrite (D-06/D-07) focuses on removing mechanical framing, but the JSON output schema IS a mechanical block that must stay.
**How to avoid:** The `[FINAL OUTPUT RULE]` block and JSON schema example MUST remain in the citizen intent prompt. Immersion changes affect the character context, NOT the output format requirements.
**Warning signs:** JSON parse failures in `parseSinglePassIntent` after prompt changes.

### Pitfall 5: Central Agent Prompts Accidentally Modified
**What goes wrong:** Immersion rewrites bleed into Central Agent prompts (resolution, merge, group resolution), breaking their mechanical framing.
**Why it happens:** D-13 explicitly says Central Agent keeps mechanical framing. Easy to miss during a global find-and-replace.
**How to avoid:** Clearly mark which prompt builders are citizen-facing vs. Central Agent-facing. Only citizen-facing builders get immersion rewrites: `buildNaturalIntentPrompt`, `buildIntentPrompt`, `buildAgentReflectionPrompt`, `buildAgentReflection2Prompt`, `buildReviewChatPrompt`, `buildPostMortemPrompt`.
**Warning signs:** Resolution prompts losing their structured "[PHYSICS LOG]" and "[OBJECTIVE SYSTEM METRICS]" blocks.

### Pitfall 6: MET Cost Precision
**What goes wrong:** The prompt says "5-6 food units per week" but actual MET cost varies by action type, weight, and age.
**Why it happens:** MET cost = (weightKg x MET x AgeModifier) / satietyKcalPerPoint. With defaults (70kg, age 35, satietyKcalPerPoint=70), single REST action yields ~2.86 food cost. Multi-action queues (up to 3 actions) yield ~5-9 food cost depending on activity intensity.
**How to avoid:** Use "roughly 5-6 food units" as the lived knowledge claim (D-04), which is accurate for typical single-action turns. The agent doesn't need to know the exact formula -- they need a useful heuristic.
**Warning signs:** Agents making decisions based on exact numbers that don't match the actual MET calculation.

### Pitfall 7: Economic Memory Token Budget
**What goes wrong:** D-15 (economic memory) accumulates unbounded history, consuming all available context.
**Why it happens:** Each iteration adds new price/wage memories. After 20 iterations, this could be 100+ memory entries.
**How to avoid:** The existing `memoryStream.ts` already has scoring and retrieval limits. Economic memories should flow through the same system -- `createExperienceMemories` already captures wealth deltas and events. The prompt just needs to format the top N economic memories with price data prominently surfaced.
**Warning signs:** Memory context exceeding ~300 tokens in the intent prompt.

## Code Examples

### Current Death Spiral Root Cause

The current prompt (line 779) says:
```
[BACKGROUND SYSTEM] This is a weekly simulation. Basic survival is handled symbolically:
after all actions, 1 Food is consumed automatically.
```

Actual MET metabolism (simulationRunner.ts line 414-530) consumes ~5-6 food per iteration via `applyMETMetabolism`. The discrepancy means agents believe food costs are trivial and never prioritize PRODUCE_AND_SELL.

### Immersive Rewrite Pattern (D-06/D-07/D-08)

**Before (current):**
```
[BIOLOGICAL SUBCONSCIOUS] A cold, descending darkness presses in from all sides...
[CAPITALIST IDENTITY] You are a business owner...
[LEGAL RISK ASSESSMENT] Current enforcement level: 2.0/3.0
```

**After (target):**
```
A cold, descending darkness presses in from all sides. A primal, animal fear
is rising from somewhere deep...

As a business owner, your livelihood depends on the enterprise you built.
Your workers produce the goods; your job is to price them right, hire well,
and dominate the market. Manual labor is beneath you now.

You know the law is enforced strictly here. Getting caught stealing would
cost you a quarter of your savings and the stress would be unbearable.
```

### Economic Dashboard Pattern (D-02/D-03)

**Target format in dynamic suffix:**
```typescript
const economicAwareness = `You know these things about your economic situation:
- You have ${agent.currentStats.wealth} fiat in your pocket
- Food costs ${ammSpotPrice.toFixed(1)} fiat per unit at market right now
- At that price, you can afford ${Math.floor(agent.currentStats.wealth / ammSpotPrice)} units of food
- You need about 5-6 food per week to survive
- The market has ${ammFoodReserve.toFixed(0)} food available for purchase
${agent.currentStats.wealth < ammSpotPrice * 6 ? '- You cannot afford a full week of food. This is a crisis.' : ''}`;
```

### Action Dictionary Rewrite Pattern (D-17)

**Before:**
```
1. "PRODUCE_AND_SELL"
   Produce goods and sell to the Global Market AMM for immediate fiat.
   Params: { "itemType": "food" | "raw_materials"... }
```

**After:**
```
1. Farm your land and sell the harvest (PRODUCE_AND_SELL)
   You work the fields, produce goods, and sell directly to the market for fiat.
   You'll produce about 20 units of food -- enough to feed yourself and 3-4 others.
   Params: { "itemType": "food" | "raw_materials"... }
```

### Agent Roster Background Pattern (D-11/D-12)

**Before (current, line 178):**
```
"background": "string - 1-2 sentence background"
```

**After:**
```
"background": "string - 5-8 sentence life story including: childhood origin, a formative
event that shaped their worldview, their economic philosophy (do they hoard, share, trade
aggressively?), a fear or ambition that drives them, and specific knowledge tied to their
role (a farmer knows planting seasons; a merchant knows price patterns)"
```

### New Parameter: AMM Market Data for Intent Prompt

The `buildNaturalIntentPrompt` function needs a new optional parameter to inject AMM spot price data (D-02):

```typescript
/** AMM market data for economic dashboard (D-02). */
ammMarketData?: {
  foodSpotPrice: number;
  foodReserve: number;
  fiatReserve: number;
};
```

This data is already available in `simulationRunner.ts` via `sessionAMMRegistry` (confirmed in CONTEXT.md code_context section). The caller just needs to pass it through.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| "1 Food consumed automatically" | ~5-6 food MET metabolism per iteration | Phase 1 (MET system) | Prompt is stale -- agents don't know real food costs |
| Single action per turn | Multi-Action Queue (up to 3 actions) | Phase 2 | Prompt updated but MET cost description wasn't |
| No economic context | Full inventory + skills + market board | Phases 1-4 | Agents have data but lack reasoning framework |
| No memory system | 3D memory retrieval + recursive planner | Phase 3 (cognitive engine) | Memory exists but economic memories not prioritized |

## Integration Points

### simulationRunner.ts Changes Required

The `buildNaturalIntentPrompt` call site (around line 1300-1400 of simulationRunner.ts) needs to pass AMM market data as a new parameter. The data is already computed in the simulation loop:

```typescript
const amm = sessionAMMRegistry.get(sessionId);
const ammMarketData = amm ? {
  foodSpotPrice: amm.spotPrice(),
  foodReserve: amm.foodReserve,
  fiatReserve: amm.fiatReserve,
} : undefined;
```

### cognitiveEngine.ts Integration (D-15/D-16)

Economic memory (D-15) should leverage the existing `createExperienceMemories` function which already captures `wealthDelta`, `economyEvents[]`, and `isStarving`. The prompt builder should format economic memories with price context when available.

Multi-week planning (D-16) already exists via `recursivePlanner.ts`. The prompt should surface the plan goal and current step more prominently in the economic reasoning context.

### Prompt Function Signature Changes

Only `buildNaturalIntentPrompt` and `buildAgentRosterMessages` need signature changes:
- `buildNaturalIntentPrompt`: add `ammMarketData` parameter
- `buildAgentRosterMessages`: update the background instruction in the system prompt (no signature change needed, just content)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | `server/vitest.config.ts` |
| Quick run command | `npm run test -w server -- --run` |
| Full suite command | `npm run test -w server` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-04 | MET cost accuracy in prompt text | unit | `npx vitest run server/src/llm/__tests__/promptContent.test.ts -x` | No -- Wave 0 |
| D-06/D-07 | No simulation-awareness tags in citizen prompts | unit | `npx vitest run server/src/llm/__tests__/promptContent.test.ts -x` | No -- Wave 0 |
| D-13 | Central Agent prompts retain mechanical framing | unit | `npx vitest run server/src/llm/__tests__/promptContent.test.ts -x` | No -- Wave 0 |
| D-17 | Action dictionary uses natural language format | unit | `npx vitest run server/src/llm/__tests__/promptContent.test.ts -x` | No -- Wave 0 |
| D-19 | File split -- all exports accessible via barrel | unit | `npx vitest run server/src/llm/__tests__/promptExports.test.ts -x` | No -- Wave 0 |
| D-19 | TypeScript compilation succeeds after split | build | `npm run build` | N/A (build command) |
| ALL | Existing tests still pass after refactor | regression | `npm run test -w server` | Yes -- 20 test files |

### Sampling Rate
- **Per task commit:** `npm run build && npm run test -w server -- --run`
- **Per wave merge:** `npm run test -w server`
- **Phase gate:** Full suite green + build clean before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/llm/__tests__/promptContent.test.ts` -- Tests that prompt output contains correct survival info (D-04), lacks [SYSTEM TAG] patterns (D-06/D-07), includes natural action descriptions (D-17)
- [ ] `server/src/llm/__tests__/promptExports.test.ts` -- Tests that all currently exported functions/types are accessible from the new barrel
- [ ] Existing `sfcInflation.test.ts` imports `buildNaturalIntentPrompt` -- must still compile after split

## Open Questions

1. **Economic memory formatting**
   - What we know: `createExperienceMemories` already captures wealth deltas and economy events. `formatMemoriesForPrompt` retrieves and formats them.
   - What's unclear: Whether existing memory format includes enough price-specific data for D-15's "Last week food cost me 18 fiat" level of detail.
   - Recommendation: Check `economyEvents` array contents in simulationRunner.ts -- events like "Auto-bought 3.2 food from AMM for 18.5 fiat" already contain this data. The memory system likely captures these strings. If so, D-15 may require only prompt formatting changes, not new data collection.

2. **Multi-week plan visibility**
   - What we know: `recursivePlanner.ts` already creates/advances plans with goals and steps. `CognitivePreOutput.planGoal` and `currentPlanStep` are passed to the prompt.
   - What's unclear: Whether plans currently include economic goals ("save 50 fiat") or are limited to narrative goals.
   - Recommendation: The planner's `runPlanning` prompt (in cognitiveEngine.ts) may need minor wording changes to encourage economic goals. This is within Claude's discretion per CONTEXT.md.

3. **AMM spot price availability on iteration 1**
   - What we know: D-05 says "Keep Darwinian Market price anchoring for iteration 1." AMM exists from the start with initial reserves.
   - What's unclear: Whether AMM spot price on iteration 1 is meaningful (before any trades).
   - Recommendation: Use initial AMM spot price for the dashboard (it will be the configured initial price), but also inject the Darwinian anchor text. Both serve the agent.

## Sources

### Primary (HIGH confidence)
- `server/src/llm/prompts.ts` -- Full 2025-line file read, all 20+ builder functions analyzed
- `server/src/mechanics/physicsConfig.ts` -- satietyKcalPerPoint=70, tickDurationHrs=1 verified
- `server/src/orchestration/simulationRunner.ts` -- MET metabolism cascade (lines 414-530), PRODUCE_AND_SELL resolution (lines 796-825) verified
- `server/src/cognition/cognitiveEngine.ts` -- CognitivePreOutput interface and pipeline verified
- `server/src/mechanics/actionCodes.ts` -- All 28 action codes verified
- `09-CONTEXT.md` -- All 20 decisions and canonical references read

### Secondary (MEDIUM confidence)
- MET cost estimate of ~5-6 food/iter based on physicsConfig defaults (70kg, age 35, satietyKcalPerPoint=70) -- actual varies by action type and agent stats

## Metadata

**Confidence breakdown:**
- Architecture (file split): HIGH -- straightforward barrel re-export pattern, all consumer imports mapped
- Content rewrite (immersion): HIGH -- clear decisions D-01 through D-18, existing prompt patterns well understood
- Economic memory integration: MEDIUM -- depends on existing memory content granularity (see Open Question 1)
- Pitfalls: HIGH -- identified from direct code analysis

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain -- prompt engineering patterns don't change rapidly)
