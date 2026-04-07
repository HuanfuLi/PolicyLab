---
phase: 09-redesign-prompts-for-all
verified: 2026-04-07T01:30:00Z
status: passed
score: 20/20 design decisions verified
re_verification: false
---

# Phase 9: Redesign Prompts for All — Verification Report

**Phase Goal:** Fix the agent death spiral by giving agents accurate economic knowledge and first-principles reasoning, deepen agent immersion by removing simulation-awareness and mechanical system tags, enrich agent backgrounds with 5-8 sentence life stories for differentiated emergent behavior, and restructure the monolithic prompts.ts into 7 domain-specific modules.
**Verified:** 2026-04-07T01:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

The phase is organized around 4 plans across 3 waves. All 4 plans executed. Each goal component is verified below.

### Observable Truths (Derived from Plan must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Monolithic prompts.ts split into 7 domain modules + barrel index | VERIFIED | 8 files in `server/src/llm/prompts/`, original `prompts.ts` deleted |
| 2 | All consumers import via `prompts/index.js` barrel | VERIFIED | All 6 consumer files confirmed (centralAgent, simulationRunner, reflectionRunner, governanceManager, bootstrap, compare) |
| 3 | Accurate MET cost in `buildNaturalIntentPrompt` ("5-6 units") | VERIFIED | Line 226: "5-6 units of food every week" |
| 4 | No simulation framing in `buildNaturalIntentPrompt` | VERIFIED | Line 215: "You live in a society" (not "simulated society"); D-06 test passes |
| 5 | No mechanical [SYSTEM TAG] labels in citizen intent prompt | VERIFIED | All 6 tags absent from `buildNaturalIntentPrompt`; D-07 test passes |
| 6 | Biological prose preserved without [BIOLOGICAL SUBCONSCIOUS] tag | VERIFIED | "A cold, descending darkness presses in" at line 363, tag removed |
| 7 | Enterprise owner is character-driven paragraph, not [CAPITALIST IDENTITY] | VERIFIED | Line 355: "As a business owner, your livelihood depends on..." |
| 8 | Natural action format (code in parentheses, lived-knowledge penalties) | VERIFIED | "Farm your land and sell the harvest directly to the market (PRODUCE_AND_SELL)" in shared.ts |
| 9 | Personal economic dashboard with ammMarketData parameter | VERIFIED | Parameter at line 207-212; market data injected in dynamic suffix when provided |
| 10 | Darwinian Market price anchoring preserved for iteration 1 | VERIFIED | Lines 347-349: "first trading day" + "3-5 fiat per unit" anchor |
| 11 | Agent roster requests 5-8 sentence life stories (creative mode) | VERIFIED | central-agent.ts line 173: "5-8 sentence life story including: where they grew up..." |
| 12 | Agent roster requests 5-8 sentence life stories (location mode) | VERIFIED | location.ts line 33: identical 5-8 sentence life story format |
| 13 | Economic instinct requirement in roster | VERIFIED | central-agent.ts line 192: "Each background MUST include an economic instinct" |
| 14 | Central Agent resolution prompt retains mechanical framing | VERIFIED | "[PHYSICS LOG]", "[OBJECTIVE SYSTEM METRICS]", "Central Agent" all present; D-13 test passes |
| 15 | NARRATIVE DIRECTIVE friction-first bias preserved | VERIFIED | "FRICTION, INEQUALITY, and DISRUPTION" at lines 248 and 440 |
| 16 | Citizen-facing reflection prompts use immersive framing | VERIFIED | reflection.ts uses "You are ${agent.name}, a ${agent.role}. This is your life, your world" — no [SYSTEM tags or simulation framing |
| 17 | Economic memory (D-15) verified — economyEvents flows to memory | VERIFIED | cognitiveEngine.ts line 193 passes economyEvents to createExperienceMemories |
| 18 | Planner prompts elicit economic goals (D-16) | VERIFIED | recursivePlanner.ts line 162: "Save enough to buy tools", "Produce food every week until I have 100 fiat" |
| 19 | Live AMM market data wired from simulationRunner to buildNaturalIntentPrompt | VERIFIED | simulationRunner.ts line 1436-1441: ammMarketData computed outside agent loop; passed at line 1634 |
| 20 | All 12 prompt content tests pass (0 skipped) | VERIFIED | `npm run test -w server -- --run` → 207 tests pass, 0 skipped in promptContent.test.ts |

**Score: 20/20 truths verified**

---

## Required Artifacts

### Plan 01: Module Split

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/llm/prompts/index.ts` | Barrel re-export of all 7 modules | VERIFIED | All 7 `export *` lines present |
| `server/src/llm/prompts/agent-intent.ts` | Citizen decision prompts | VERIFIED | 461 lines, exports `buildNaturalIntentPrompt`, `buildIntentPrompt` |
| `server/src/llm/prompts/central-agent.ts` | Central Agent prompts | VERIFIED | 529 lines, exports all required functions |
| `server/src/llm/prompts/reflection.ts` | Reflection + review prompts | VERIFIED | 5 functions exported |
| `server/src/llm/prompts/governance.ts` | Governance prompts | VERIFIED | Exports `buildProposalPrompt`, `buildBallotPrompt`, etc. |
| `server/src/llm/prompts/comparison.ts` | Comparison prompts | VERIFIED | Exports `buildComparisonMessages`, `buildComparisonChatMessages` |
| `server/src/llm/prompts/location.ts` | Location-based prompts | VERIFIED | 6661 bytes, exports `buildLocationAgentRosterMessages` |
| `server/src/llm/prompts/shared.ts` | Shared types + action schemas | VERIFIED | 406 lines, `ACTION_SCHEMAS` + all helpers exported |
| `server/src/llm/__tests__/promptContent.test.ts` | Prompt content tests | VERIFIED | 206 lines, 12 tests all active (0 skipped), all pass |
| `server/src/llm/prompts.ts` | DELETED | VERIFIED | File not present; no stale `prompts.js` imports in any consumer |

### Plan 02: Intent Prompt Rewrite

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/llm/prompts/agent-intent.ts` | Rewritten intent prompts | VERIFIED | Static prefix uses "You live in a society", 5-6 food knowledge, no tags |
| `server/src/llm/prompts/shared.ts` | Natural language action dictionary | VERIFIED | Natural language + code mapping format; "What you can do this week:" header |
| `server/src/cognition/cognitiveEngine.ts` | economyEvents verified flowing to memory | VERIFIED | Line 193: economyEvents passed to createExperienceMemories |
| `server/src/cognition/recursivePlanner.ts` | Economic goal examples in planner prompt | VERIFIED | Line 162: economic goal examples added |

### Plan 03: Roster + Reflection

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/llm/prompts/central-agent.ts` | 5-8 sentence roster + preserved resolution | VERIFIED | Line 173: 5-8 sentence schema; Lines 225-248: mechanical framing preserved |
| `server/src/llm/prompts/reflection.ts` | Immersive citizen-facing prompts | VERIFIED | First-person embodiment; "This is your life, your world" |
| `server/src/llm/prompts/location.ts` | Location roster with 5-8 sentence format | VERIFIED | Line 33 and 41: identical life story schema + economic instinct rule |

### Plan 04: AMM Wiring

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/orchestration/simulationRunner.ts` | AMM market data wired to intent prompt | VERIFIED | Lines 1436-1441: computed outside agent loop; line 1634: passed to buildNaturalIntentPrompt |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `prompts/index.ts` | All 7 sub-modules | `export * from './shared.js'` (×7) | VERIFIED | All 7 export lines present |
| `centralAgent.ts` | `prompts/index.ts` | `from './prompts/index.js'` | VERIFIED | Import confirmed |
| `simulationRunner.ts` | `prompts/index.ts` | `from '../llm/prompts/index.js'` | VERIFIED | Import confirmed |
| `buildNaturalIntentPrompt` static prefix | MET metabolism knowledge | Inline template string "5-6 units of food" | VERIFIED | Line 226 |
| `cognitiveEngine.ts` economyEvents | Agent memory in intent prompt | `createExperienceMemories(economyEvents)` | VERIFIED | Line 193 |
| `simulationRunner.ts` | `buildNaturalIntentPrompt` | `ammMarketData` parameter | VERIFIED | Computed at line 1437, passed at line 1634 |
| `buildAgentRosterMessages` | Rich agent backgrounds | "5-8 sentence life story" schema | VERIFIED | central-agent.ts line 173 |
| `buildLocationAgentRosterMessages` | Rich agent backgrounds (location mode) | "5-8 sentence life story" schema | VERIFIED | location.ts line 33 |
| `buildResolutionPrompt` | Mechanical Central Agent framing | "[PHYSICS LOG]", "[OBJECTIVE SYSTEM METRICS]" | VERIFIED | Lines 229, 225 |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `buildNaturalIntentPrompt` | `ammMarketData.foodSpotPrice` | `simulationRunner.ts` → `primaryAMMForMI.spotPrice` | Yes — live AMM state per iteration | FLOWING |
| `buildNaturalIntentPrompt` | `cognitiveContext.memoryContext` | `cognitiveEngine.ts` → `createExperienceMemories(economyEvents)` | Yes — economyEvents includes price strings | FLOWING |
| `buildNaturalIntentPrompt` | `cognitiveContext.planGoal` | `recursivePlanner.ts` → economic goal LLM output | Yes — real LLM-generated goal | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Barrel exports 4 key builders | `vitest run promptContent.test.ts` | "barrel exports all prompt builders" PASS | PASS |
| D-04: MET accuracy | grep "5-6" agent-intent.ts | Line 226 match | PASS |
| D-06: No simulation framing in buildNaturalIntentPrompt | Test D-06 | "no simulation framing" PASS | PASS |
| D-07: No mechanical tags | Test D-07 | All 6 tags absent from buildNaturalIntentPrompt | PASS |
| D-11: Rich life stories | Test D-11 | "5-8 sentence life story" in roster output | PASS |
| D-13: Central Agent framing | Test D-13 | "Central Agent" in buildResolutionPrompt | PASS |
| AMM wiring | grep "ammMarketData" simulationRunner.ts | Lines 1437, 1634 | PASS |
| Full test suite | `npm run test -w server -- --run` | 207 tests pass, 19 test files | PASS |

---

## Requirements Coverage

Phase 09 uses a local D-xx design-decision numbering (defined in `09-CONTEXT.md`), not the global BANK-xx/FISC-xx requirement IDs. All 20 design decisions map to plan requirements as follows:

| Requirement | Source Plan(s) | Description | Status |
|-------------|----------------|-------------|--------|
| D-01 | 02 | Agents receive full physics rules as lived knowledge | SATISFIED |
| D-02 | 02, 04 | Personal economic dashboard (AMM spot price, affordability) | SATISFIED |
| D-03 | 02 | Market data as numbers ("food price: 25.6 fiat/unit") | SATISFIED |
| D-04 | 02 | Fix inaccurate MET claim ("~5-6 food/iter" replaces "1 Food") | SATISFIED |
| D-05 | 02 | Darwinian Market price anchoring preserved for iteration 1 | SATISFIED |
| D-06 | 02, 03 | No third-person simulation framing in citizen prompts | SATISFIED |
| D-07 | 02 | No mechanical [SYSTEM TAG] labels in citizen prompts | SATISFIED |
| D-08 | 02 | Biological prose kept, [BIOLOGICAL SUBCONSCIOUS] tag removed | SATISFIED |
| D-09 | 02 | Character-driven enterprise owner paragraph | SATISFIED |
| D-10 | 02 | NONE action uses lived-knowledge penalty ("Sitting idle eats at you") | SATISFIED |
| D-11 | 03 | 5-8 sentence life stories in agent roster (creative mode) | SATISFIED |
| D-12 | 03 | `buildAgentRosterMessages` requests rich life stories + economic instincts | SATISFIED |
| D-13 | 03 | Central Agent resolution prompt retains mechanical framing | SATISFIED |
| D-14 | 03 | NARRATIVE DIRECTIVE friction-first bias preserved | SATISFIED |
| D-15 | 02 | Economic memory (economyEvents) flows through to agent memory | SATISFIED |
| D-16 | 02 | Planner prompt elicits economic goals | SATISFIED |
| D-17 | 02 | Actions use natural language + code mapping | SATISFIED |
| D-18 | 02 | Action penalties described as lived knowledge | SATISFIED |
| D-19 | 01 | prompts.ts split into 7 domain modules | SATISFIED |
| D-20 | 01 | Template strings stay inline in builder functions | SATISFIED — no .template or .txt files found |

**All 20 design decisions satisfied.**

Note: D-01 through D-20 are phase-local design decisions in `09-CONTEXT.md`, not global requirement IDs. Global requirements (BANK-xx, FISC-xx, INFL-xx, CONF-xx, CMKT-xx) are unaffected by this phase.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `agent-intent.ts` | 44 | `buildIntentPrompt` still contains "simulated society" | INFO | This is the legacy Phase 1 function (not the rewritten `buildNaturalIntentPrompt`). D-06 only targets `buildNaturalIntentPrompt`, which is clean. Legacy function retained for backward compatibility. |

No blocker or warning-level anti-patterns found. The one info-level item is the legacy `buildIntentPrompt` function which predates Phase 9 and was intentionally left unchanged (it is the Phase 1 simple prompt, not the Phase 2+ natural intent prompt that agents actually use).

---

## Human Verification Required

### 1. Death Spiral Behavioral Test

**Test:** Run a new simulation with 20+ agents in a resource-limited society. Observe whether agents now choose PRODUCE_AND_SELL in early iterations to maintain food supply.
**Expected:** Agents with 5-6 food knowledge should produce food proactively rather than waiting to starve. `totalCaloriesProduced` should be non-zero across iterations.
**Why human:** Requires a live LLM call and multi-iteration simulation run. Cannot verify emergent behavior from static code analysis.

### 2. Life Story Quality in Generated Roster

**Test:** Create a new session using Creative Mode and proceed to Design Review. Inspect the generated agent backgrounds.
**Expected:** Each agent background should be 5-8 sentences long, include a formative event, an economic philosophy, and a personal fear or ambition.
**Why human:** Requires live LLM generation. Static verification confirms the prompt asks for rich backgrounds; quality of output requires human judgment.

### 3. Economic Dashboard Rendering

**Test:** Start a simulation and observe the agent intent prompt content in server logs (with logging enabled). Confirm the "What you see at the market" section appears with real AMM prices.
**Expected:** "Food price: X.X fiat per unit", affordability calculation, and market stock visible in agent prompts from iteration 2 onward.
**Why human:** Requires a running simulation to observe actual prompt content at runtime.

---

## Gaps Summary

None. All 20 design decisions verified. All 207 server tests pass. All 12 prompt content tests pass (0 skipped). The phase goal is fully achieved.

---

_Verified: 2026-04-07T01:30:00Z_
_Verifier: Claude (gsd-verifier)_
