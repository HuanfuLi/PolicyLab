# Design Enhancement Plan

Forensic audit of simulation bugs and economy design weaknesses identified after "The Liberty Guild" session.
This document is the authoritative implementation brief for coding agents.

---

## Part 1 — Pending Bug Fixes (from CONVERSATION.md)

These four fixes were verified against the codebase and are confirmed legitimate.
They should be implemented before the design enhancements in Part 2.

### Fix A — Zero-Sum STEAL
**Status**: Not yet implemented
**File**: `server/src/orchestration/simulationRunner.ts`

`physicsEngine.ts` gives the thief `w = stolen` wealth but nothing deducts that amount from the victim's `weekStateMap`. Ghost fiat is created on every STEAL action.

**Implementation**:
After `weekState.wealthDelta += physics.wealthDelta` for a STEAL action, find the target agent's `weekStateMap` entry and deduct the stolen amount:
```
targetWeekState = weekStateMap.get(targetAgent.id)
available = max(0, targetAgent.currentStats.wealth + targetWeekState.wealthDelta)
actualStolen = min(physics.wealthDelta, available)   // cap if victim is broke
targetWeekState.wealthDelta -= actualStolen
// adjust thief's wealthDelta to actualStolen if victim couldn't cover full amount
```

---

### Fix B — Death & Humiliation Wealth Redistribution
**Status**: Not yet implemented
**File**: `server/src/orchestration/simulationRunner.ts`

Two fiat destruction vectors:

**B1 — Death**: When `shouldDie = true`, the dying agent's final wealth is written to `statUpdates` but next iteration dead agents are excluded from `aliveAgents`, so their wealth vanishes from the active economy permanently.

**B2 — Humiliation**: When `shouldHumiliate = true`, `newWealth = 0` with no transfer. The stripped wealth is destroyed, never entering `seizedWealthPool`.

**Implementation**:
In the stat-resolution loop, before zeroing values:
```
// B1: Death redistribution
if (shouldDie) {
  const dyingWealth = max(0, agent.currentStats.wealth + weekState.wealthDelta)
  seizedWealthPool += dyingWealth
  // Do NOT push dying agent's wealth to statUpdates
}

// B2: Humiliation redistribution
if (shouldHumiliate) {
  const strippedWealth = max(0, agent.currentStats.wealth + weekState.wealthDelta)
  seizedWealthPool += strippedWealth
  newWealth = 0
}
```
The existing `seizedWealthPool` redistribution block at the end of the iteration will distribute the pooled wealth to all alive agents as UBI automatically.

---

### Fix C — SFC Assertion Counts Dead Agents
**Status**: Not yet implemented
**File**: `server/src/orchestration/simulationRunner.ts`

The post-iteration SFC check at line ~2294 computes `sfcActual` from `agents.reduce(...)` which includes ALL agents (dead + alive). Dead agents' wealth is locked in DB records but excluded from the active economy, so the check never flags real fiat drain.

**Implementation**:
```
// Change from:
const sfcActual = agents.reduce((sum, a) => sum + a.currentStats.wealth, 0) + AMM

// To:
const sfcActual = agents.filter(a => a.isAlive).reduce((sum, a) => sum + a.currentStats.wealth, 0) + AMM
```

---

### Fix D — Structured Market Context in Resolution Prompt
**Status**: Not yet implemented
**Files**: `server/src/llm/prompts.ts`, `server/src/orchestration/simulationRunner.ts`

Food market data is appended as a one-liner to the generic `sessionIterationMetrics` string. The LLM ignores it when agent health signals are prominent, causing "famine" narration despite food abundance.

**Implementation**:
Add an `ammContext` parameter to `buildResolutionPrompt`, `buildGroupResolutionMessages`, and `buildMergeResolutionMessages`. Render it as a dedicated structured block:
```
[FOOD MARKET STATE — AUTHORITATIVE GROUND TRUTH]
- Food in AMM reserve: 47.3 units  ← ABUNDANT
- Current spot price: 1.21 fiat/food
- Verdict: NO FOOD SHORTAGE EXISTS. Do NOT narrate famine or empty markets.
```
Pass the current AMM state from the runner at all resolution call sites.

---

## Part 2 — Death Statistics Inconsistency

### Problem Statement

After 25 iterations, the Agent Status panel shows 6 agents in red and LIFECYCLE shows skull emojis, but Statistics shows 28/28 alive and `computeStats` never decrements the count.

### Root Cause

**The humiliation mechanic intercepts near-death agents.**
When `health < 20 && food == 0`, `shouldHumiliate` fires *before* `shouldDie` and resets health to 30. This prevents health from ever reaching the death threshold (`health <= 0`). The LLM narrates these agents as dying (skull emoji in lifecycle events) but the physics engine rescues them, so `deaths` array remains empty and `aliveCount` never changes.

Additionally, `outcome.died = true` in `agentOutcomes` is the only other death trigger, but the LLM inconsistently sets this flag.

### Fix A1 — Lifecycle–Outcome Reconciliation
**File**: `server/src/orchestration/simulationRunner.ts`

After parsing the resolution, reconcile lifecycle death events with the outcome map. If the LLM narrated a death in `lifecycleEvents` but didn't set `died: true` in `agentOutcomes`, force it:
```typescript
// After: const outcomeMap = new Map(resolution.agentOutcomes.map(o => [o.agentId, o]))
for (const event of resolution.lifecycleEvents ?? []) {
  if (event.type === 'death' && event.agentId) {
    const existing = outcomeMap.get(event.agentId);
    if (existing && !existing.died) {
      outcomeMap.set(event.agentId, { ...existing, died: true });
    }
  }
}
```

### Fix A2 — Raise Death Threshold
**File**: `server/src/orchestration/simulationRunner.ts`

Health almost never reaches exactly 0 due to integer rounding in metabolism and partial nutrition. Change:
```typescript
// From:
const shouldDie = (outcome?.died === true) || newHealth <= 0;
// To:
const shouldDie = (outcome?.died === true) || newHealth <= 2;
```
This catches "1-health zombie" agents who are functionally dead but survive on rounding noise.

### Fix A3 — Sharpen Resolution Prompt Death Rule
**File**: `server/src/llm/prompts.ts`

Add an explicit rule to `buildResolutionPrompt`, `buildGroupResolutionMessages`, and any merged resolution prompt:
```
DEATH RULE: Any agent whose current health stat is ≤ 5 MUST have "died": true
set in their agentOutcomes entry. Do not narrate recovery for agents at ≤ 5 health
unless they explicitly received food or medical aid this iteration.
```

---

## Part 3 — Economy Narrowing (Food Monopoly)

### Problem Statement

Simulations converge to all agents producing food. Market has surplus food at very low prices but the LLM continues to narrate scarcity. Raw materials, tools, and luxury goods are never produced or traded. The multi-commodity economy does not emerge.

### Root Cause Analysis

1. **Only food has a profit alert.** The `🚨 PROFIT ALERT` block is only generated for the food AMM. Multi-commodity AMMs (raw_materials, luxury_goods) appear in the market board with `trend: 'unknown'` and no profit signal. Every agent rationally chooses food.

2. **No food abundance/glut signal.** The profit alert fires at `priceRatio ≥ 1.5`. When food is overproduced and price drops below baseline, no signal tells agents "food market saturated, stop producing." The missing negative feedback loop lets overproduction persist indefinitely.

3. **Production chain is invisible.** Agents see action codes `PRODUCE_AND_SELL` with `itemType` options but receive no explanation of how raw_materials → tools → productivity multiplier works. Without understanding the chain, there's no rational motive to produce anything but the most-signaled item.

4. **Default inventory is homogeneous.** All agents start from `DEFAULT_INVENTORY` (0 tools, 0 raw_materials). Roles like artisan, miner, or craftsman have no mechanical advantage in their specialty from day one.

5. **Economy diversity is unmeasured.** No metric tracks what fraction of `PRODUCE_AND_SELL` actions targeted each commodity. Without a diversity signal, neither the LLM nor the runner can detect or correct a monoculture.

---

### Fix B1 — Universal Profit Alerts for Multi-Commodity AMMs
**File**: `server/src/orchestration/simulationRunner.ts`

In the multi-AMM section of the market board builder (the block that creates `multiEntries`), compute a `profitAlert` for each non-food commodity when its spot price exceeds 150% of baseline price. Mirror the existing food profit alert format. The baseline prices for non-food commodities should be stored alongside `INITIAL_FOOD_SPOT_PRICE`.

Example output in agent prompt:
```
🚨 PROFIT ALERT: Raw Materials are in HIGH DEMAND (Spot Price: 4.50, +125% above baseline).
Executing [PRODUCE_AND_SELL] for 'raw_materials' will yield ~90 Wealth this week.
```

---

### Fix B2 — Food Abundance / Glut Warning (Reverse Signal)
**File**: `server/src/orchestration/simulationRunner.ts`

When food AMM `priceRatio < 0.7` (food price is ≤70% of baseline, indicating oversupply), inject a glut warning into the food `MarketBoardEntry`:
```
⚠️ GLUT ALERT: Food market OVERSUPPLIED. Price is ${pct}% below baseline.
Continuing food production will sell at a loss this week.
Consider PRODUCE_AND_SELL for raw_materials or luxury_goods instead.
```
This creates the negative feedback loop that redirects agents away from food when supply is excessive.

---

### Fix B3 — Production Chain Block in Agent Prompt
**File**: `server/src/llm/prompts.ts`

Add a `[PRODUCTION CHAIN]` section inside `buildNaturalIntentPrompt`, placed directly before the `[AVAILABLE ACTIONS]` block. This section explains the inter-commodity economy so agents have a rational basis for diversifying:

```
[PRODUCTION CHAIN]
- Raw materials → sold directly to the AMM or used as manufacturing input
- Tools → holding tools in your inventory gives a +15% wage multiplier on WORK
  (buying tools is an investment; selling depletes your productivity advantage)
- Luxury goods → discretionary consumer goods; high-margin when food is plentiful
  and basic needs are met; low-margin when citizens are starving
- Food → subsistence good; critical when scarce, low-margin when plentiful
  (check the market board — if food is in GLUT, pivot to other goods)
```

---

### Fix B4 — Role-Differentiated Starting Inventories
**File**: `server/src/orchestration/simulationRunner.ts`

In Phase 1 initialization (where `economyRepo.initializeForSession` is called), assign starting inventories by role tier instead of using a uniform `DEFAULT_INVENTORY`. Add a helper that maps roles to starting inventories:

| Role pattern | Food | Tools | Raw materials | Luxury goods |
|---|---|---|---|---|
| farmer / gatherer / herder | 10 | 0 | 2 | 0 |
| artisan / craftsman / blacksmith / carpenter / smith | 3 | 5 | 5 | 0 |
| merchant / trader / shopkeeper | 3 | 1 | 2 | 3 |
| scholar / healer / teacher / doctor / priest | 3 | 0 | 0 | 5 |
| miner / builder / laborer / worker | 5 | 2 | 4 | 0 |
| default (all others) | 5 | 0 | 0 | 0 |

Role matching is case-insensitive substring match against the agent's `role` string.

---

### Fix B5 — Economy Diversity Metric in System Context
**File**: `server/src/orchestration/simulationRunner.ts`

After the market board is built, compute the distribution of `PRODUCE_AND_SELL` actions by commodity type from `weekStateMap`. If food accounts for >70% of all `PRODUCE_AND_SELL` actions, append to `sessionIterationMetrics`:
```
Economy warning: ${pct}% of production was food this iteration.
Raw materials and luxury goods are undersupplied — agents who diversify will find higher margins.
```
This biases the LLM resolution toward nudging agents to diversify and prevents runaway monoculture.

---

## Part 4 — Economic Decision Intelligence: Replace Hardcoded Alerts with Rich Market Data

### Design Philosophy

The current profit alert system tells agents *what to do* ("execute PRODUCE_AND_SELL for Food — this is the most lucrative action"). This is paternalistic, bypasses LLM reasoning, and creates a monoculture because every agent receives identical instructions.

The correct design: give agents *raw, structured economic data* and let them reason about opportunity themselves. A farmer with high farming skill, low food reserves in the AMM, and 5 units of raw_materials in their inventory should be able to *deduce* the optimal play without being told. This is both more realistic (real market participants reason from data, not system alerts) and better demonstrates LLM economic reasoning capability.

**Core change: remove all hardcoded profit/glut alerts. Replace with a structured `[MARKET INTELLIGENCE]` block that exposes raw supply, demand, price, and trend data for every commodity.**

---

### Current State Audit

What agents currently see (confirmed from code review):

| Information | Status | Detail |
|---|---|---|
| Own wealth, health, happiness | ✓ Exact numbers | `agent.currentStats.*` |
| Own stress (cortisol) | ✗ Only categorical | "overwhelmed / tense / manageable" |
| Own mood (dopamine) | ✗ Only categorical | "good spirits / neutral / disheartened" |
| Own food inventory | ✓ Exact quantity | `inv.food.quantity` |
| Own tools inventory | ✓ Count only | `inv.tools.quantity` |
| Own raw_materials inventory | ✗ Not shown | Not included in `economyContext` |
| Own luxury_goods inventory | ✗ Not shown | Not included in `economyContext` |
| Own skills | ✗ Top 3 only, rounded | `topSkills` string, not full matrix |
| Market prices | ✗ Vague | "avg clearing price X; trend up" |
| AMM food reserve level | ✗ Not shown | Never passed to intent prompt |
| AMM raw_materials reserve | ✗ Not shown | Never passed |
| AMM luxury_goods reserve | ✗ Not shown | Never passed |
| Trade volume this iteration | ✗ Not shown | Never passed |
| Food profit alert | ✓ Hardcoded | Only fires at price ≥ 1.5× baseline |
| Non-food profit alerts | ✗ Never fires | No equivalent for other commodities |
| Employment board | ✓ Available | Enterprise, wage, min_skill, owner |
| Enterprise vacancy count | ✗ Not shown | Not tracked |
| Other agents' wealth / health | ✗ Intentionally excluded | Privacy design decision |

**Critical gap:** agents cannot see AMM reserve levels, full inventory, exact cortisol/dopamine, or any signal about non-food commodity supply/demand. They receive a single opinionated instruction ("produce food") rather than data to reason from.

---

### C1 — Replace Profit Alert with Structured Market Intelligence Block

**Files**: `server/src/llm/prompts.ts`, `server/src/orchestration/simulationRunner.ts`

**What to remove**: The `profitAlert` field on `MarketBoardEntry` and the hardcoded food profit alert computation in the runner (lines ~1894–1908). Remove the food glut warning (Fix B2 from Part 3) since this is now superseded by richer data.

**What to add**: A new `MarketIntelligence` object passed into `buildNaturalIntentPrompt` containing structured data for every active commodity. The prompt renders this as a `[MARKET INTELLIGENCE]` block placed prominently before `[AVAILABLE ACTIONS]`.

**New data structure** (add to `prompts.ts`):
```typescript
export interface CommodityMarketData {
  itemType: string;
  /** Current AMM spot price (fiat per unit). Null if no AMM for this commodity. */
  spotPrice: number | null;
  /** AMM reserve level in units. Null if no AMM. */
  ammReserve: number | null;
  /** Qualitative reserve status derived from reserve vs initial seeding. */
  reserveStatus: 'critical' | 'low' | 'normal' | 'surplus';
  /** Price trend vs last iteration: positive = rising, negative = falling, 0 = flat. */
  priceDelta: number | null;
  /** Number of units traded this iteration (order book + AMM combined). */
  volumeThisIteration: number;
  /** Spot price this iteration vs the iteration-0 baseline (ratio). */
  priceVsBaseline: number | null;
}

export interface MarketIntelligence {
  commodities: CommodityMarketData[];
  /** Total alive agent count — for per-capita reasoning. */
  populationSize: number;
  /** Number of active enterprises by industry. */
  enterprisesByIndustry: Record<string, number>;
  /** Number of unemployed agents. */
  unemployedCount: number;
}
```

**Rendered prompt block** (example output):
```
[MARKET INTELLIGENCE — Use this data to reason about economic opportunity]

Commodity prices and supply:
  food          │ Price: 3.21 fiat/unit  │ AMM reserve:  42 units (NORMAL)   │ Trend: ▼ -0.4 this week
  raw_materials │ Price: 5.80 fiat/unit  │ AMM reserve:   6 units (LOW)      │ Trend: ▲ +1.2 this week
  luxury_goods  │ Price: 8.10 fiat/unit  │ AMM reserve:  18 units (NORMAL)   │ Trend: ▶  0.0 this week
  tools         │ Price: 12.40 fiat/unit │ AMM reserve:   3 units (CRITICAL) │ Trend: ▲ +2.1 this week

Economy:
  Population: 24 alive agents
  Active enterprises: food ×3, manufacturing ×1, services ×2
  Unemployed agents: 7

How to read this:
- LOW/CRITICAL reserve means the market is undersupplied and prices will rise further if no one produces.
- SURPLUS reserve means the market is oversupplied and selling now yields less than baseline.
- Your production skills determine how efficiently you can create each commodity type.
```

**Design notes:**
- `reserveStatus` thresholds: CRITICAL < 20% of initial seed, LOW < 50%, NORMAL 50–150%, SURPLUS > 150%.
- The "How to read this" guidance is static instructional text — it teaches the LLM the economic logic once so it can self-apply it.
- No directive language ("you should", "most lucrative"). The agent sees the state and decides.
- All four commodity AMMs must be initialized at simulation start (even with small reserves) so every commodity has a visible price from iteration 1.

**Runner changes**: At the intent-collection loop, after building `latestMarketBoard`, construct a `MarketIntelligence` object from:
- `sessionAMMRegistry` (food spot price + reserve)
- `sessionMultiAMMRegistry` (raw_materials, luxury_goods, tools spot prices + reserves)
- `employmentRegistry` + `enterpriseRegistry` for the enterprise counts
- `aliveAgents` for population and unemployment

---

### C2 — Expose Full Inventory in Agent Prompt

**Files**: `server/src/llm/prompts.ts`, `server/src/orchestration/simulationRunner.ts`

**What to change**: The `economyContext` object passed to `buildNaturalIntentPrompt` currently only includes `foodLevel`, `toolCount`, and `topSkills`. Extend it to expose the agent's complete inventory and full skill matrix.

**Current** `economyContext` structure (in runner):
```typescript
{
  foodLevel: inv?.food?.quantity ?? 10,
  toolCount: inv?.tools?.quantity ?? 1,
  topSkills: sortedSkills.slice(0, 3).map(...)join(', '),
  isStarving: ...
}
```

**New** `economyContext` structure:
```typescript
{
  inventory: {
    food:          { quantity: number },
    tools:         { quantity: number },
    raw_materials: { quantity: number },
    luxury_goods:  { quantity: number },
  },
  skills: SkillMatrix,          // full matrix, not just top 3
  isStarving: boolean,
}
```

**New rendered prompt block**:
```
Your inventory:
  Food:          8 units
  Tools:         2 units   (each tool gives +15% wage on WORK)
  Raw materials: 0 units
  Luxury goods:  3 units

Your skills (level 0–100):
  farming:       62  ← primary skill for PRODUCE food
  crafting:      41  ← primary skill for PRODUCE tools/raw_materials
  trading:       28
  management:    15
  (all others below 10)
```

Showing the full skill matrix lets agents reason: "My crafting skill is 41 — I am moderately efficient at producing tools. Tools are CRITICAL in the market. This is a better use of my time than farming."

---

### C3 — Expose Cortisol and Dopamine as Numbers with Context

**File**: `server/src/llm/prompts.ts`

**What to change**: In `buildNaturalIntentPrompt`, cortisol and dopamine are currently rendered as categorical labels ("overwhelmed / tense / manageable"). Show the exact values alongside a brief interpretation so the LLM can self-model its decision-making quality.

**Current**:
```
- Stress level: HIGH
- Satisfaction: neutral
```

**New**:
```
- Cortisol (stress): 74/100  — high; risk tolerance is impaired, may over-weight immediate survival
- Dopamine (drive):  38/100  — below baseline; motivation is reduced, prone to conservative choices
```

This allows the LLM to incorporate psychophysiological self-awareness: an agent with cortisol 90 might rationally decide to REST rather than STEAL because it knows its judgment is compromised. An agent with dopamine 15 might explain its passivity through inner monologue. This is more realistic and richer behavior.

---

### C4 — Add Role Economic Profile Block

**File**: `server/src/llm/prompts.ts`

**What to add**: A short `[YOUR ECONOMIC PROFILE]` block injected once per agent, derived from their role and skill matrix. This replaces the need for any hardcoded advice by giving role-specific economic context.

**Example for a Blacksmith**:
```
[YOUR ECONOMIC PROFILE]
Role specialization: Craftsman
Your crafting skill (level 58) makes you one of the more efficient tool and raw_material producers.
- PRODUCE_AND_SELL tools: your skill multiplier ~1.7× baseline output
- PRODUCE_AND_SELL raw_materials: your skill multiplier ~1.5× baseline output
- WORK at a manufacturing enterprise: your crafting skill commands premium wages
Comparative advantage: you produce tools ~2× more efficiently than a farmer with crafting skill 20.
```

**Implementation**: This block is generated in the runner at intent-collection time by computing the agent's top skill category, looking up its `ACTION_MULTIPLIER` from `skillSystem.ts`, and rendering a 2–3 line specialization summary. No LLM call needed — pure symbolic computation.

---

### C5 — Add Economic Memory: Last-N-Iterations Personal Price History

**Files**: `server/src/orchestration/simulationRunner.ts`, `server/src/llm/prompts.ts`

**Problem**: Agents see only "trend: up/down/flat" with no numerical context. An agent who sold food last week at price 6.0 and sees it at 3.2 this week needs to know the magnitude of the drop to reason about whether to keep producing.

**What to add**: Track each agent's last 3 trade prices per commodity in `sessionLastActionResults` (already exists). Render a personal price history in the `[Week N Results]` block:

```
[Week 5 Results]
Your trades:
  Sold 10 food at 3.21/unit  (was 4.10 last week, 5.80 two weeks ago — falling ▼▼)
  Bought 2 tools at 12.40/unit
Net: Wealth +28.4, Health +0, Happiness +3
```

This gives agents longitudinal context without adding a separate memory system — the data is already present in `weekState.events`, just needs formatting.

---

### C6 — Initialize All Four Commodity AMMs at Simulation Start

**File**: `server/src/orchestration/simulationRunner.ts`

**Problem**: Currently only the food AMM is always initialized. The multi-commodity AMMs (`raw_materials`, `luxury_goods`) are initialized via `createMultiCommodityAMMs` but may start with zero or tiny reserves, causing `spotPrice = undefined` or wildly distorted prices on the first trade.

**What to change**: Ensure all four commodity AMMs are seeded at simulation start with reserves proportional to population size and realistic initial prices:

| Commodity | Initial reserve (per 10 agents) | Initial fiat reserve | Baseline price |
|---|---|---|---|
| food | 50 units | 300 fiat | 6.0 fiat/unit |
| raw_materials | 30 units | 90 fiat | 3.0 fiat/unit |
| tools | 10 units | 120 fiat | 12.0 fiat/unit |
| luxury_goods | 15 units | 150 fiat | 10.0 fiat/unit |

These seedings ensure that from iteration 1, every commodity has a visible, reasonable spot price that agents can reason about. The `priceVsBaseline` ratio in `MarketIntelligence` (C1) compares current spot price to these baselines.

Also store these baseline prices in a per-session map (`sessionCommodityBaselines`) so `priceVsBaseline` remains accurate across pause/resume.

---

### C7 — Remove Hardcoded Profit Alert from `buildMarketBoardSection`

**File**: `server/src/llm/prompts.ts`

**What to remove**: The `profitAlert?: string` field from `MarketBoardEntry` interface and all rendering of it in `buildMarketBoardSection`. This is the final step that ensures no directive language reaches agents — they see only data.

**What this enables**: The LLM, given the `[MARKET INTELLIGENCE]` block (C1) with raw reserve levels and prices, will naturally deduce "tools are CRITICAL, I have crafting skill 58, I should produce tools" without being told. This is the intended emergent behavior.

---

### Summary of Part 4 Changes

| ID | Change | Removes | Adds | Files |
|---|---|---|---|---|
| C1 | Structured market intelligence block | `profitAlert`, `ammNote` in system metrics | `MarketIntelligence` type + `[MARKET INTELLIGENCE]` prompt block | `prompts.ts`, `simulationRunner.ts` |
| C2 | Full inventory + full skill matrix | `topSkills` string, food/tool only | Complete `inventory` + `SkillMatrix` in prompt | `prompts.ts`, `simulationRunner.ts` |
| C3 | Cortisol/dopamine as numbers | Categorical stress labels | Exact values with interpretation | `prompts.ts` |
| C4 | Role economic profile block | Nothing | `[YOUR ECONOMIC PROFILE]` derived from role + skills | `prompts.ts`, `simulationRunner.ts` |
| C5 | Personal price history in results | Nothing | 3-iteration trade price history in `[Week N Results]` | `prompts.ts`, `simulationRunner.ts` |
| C6 | Initialize all commodity AMMs | Absent/thin non-food AMMs | Population-scaled seeding with baselines | `simulationRunner.ts` |
| C7 | Remove hardcoded profit alert | `profitAlert` field and all rendering | Nothing (superseded by C1) | `prompts.ts`, `simulationRunner.ts` |

**Net effect**: Agents go from receiving one opinionated directive ("produce food — it's most lucrative") to receiving a structured economic picture they reason about themselves. Economic diversity emerges from agent heterogeneity (different skills, inventories, risk tolerance) applied to real market signals, not from the system telling different agents different things.

---

## Updated Implementation Order

Revised to include all parts:

| Priority | ID | Description | Part | Effort |
|---|---|---|---|---|
| 1 | Fix A | Zero-sum STEAL | 1 | Low |
| 2 | Fix B | Death & humiliation redistribution | 1 | Low |
| 3 | Fix C | SFC assertion alive-only filter | 1 | Trivial |
| 4 | A1 | Lifecycle–outcome death reconciliation | 2 | Low |
| 5 | A2 | Death threshold health ≤ 2 | 2 | Trivial |
| 6 | A3 | Resolution prompt death rule | 2 | Low |
| 7 | Fix D | Structured market context in resolution | 1 | Medium |
| 8 | C6 | Initialize all commodity AMMs at start | 4 | Medium |
| 9 | C7 | Remove hardcoded profit alert | 4 | Low |
| 10 | C1 | Market intelligence block | 4 | High |
| 11 | C2 | Full inventory + skill matrix in prompt | 4 | Medium |
| 12 | C3 | Cortisol/dopamine as exact numbers | 4 | Low |
| 13 | C4 | Role economic profile block | 4 | Medium |
| 14 | C5 | Personal price history in results | 4 | Medium |
| 15 | B4 | Role-differentiated starting inventories | 3 | Medium |
| 16 | B5 | Economy diversity metric in system context | 3 | Low |

*Note: B1 (multi-commodity profit alerts), B2 (food glut warning), and B3 (production chain block) from Part 3 are superseded by C1, C6, and C4 respectively. They should NOT be implemented.*

---

## Files Affected (Complete)

| File | Changes |
|---|---|
| `server/src/orchestration/simulationRunner.ts` | Fix A, B, C, D; A1, A2; B4, B5; C1, C2, C4, C5, C6, C7 |
| `server/src/llm/prompts.ts` | Fix D; A3; C1, C2, C3, C4, C5, C7 |
| `shared/src/types.ts` | Add `MarketIntelligence`, `CommodityMarketData` types |

---

## Part 5 — Engine Integrity Fixes (from GAP_ANALYSIS.md audit, 2026-03-21)

All five items below were verified against the live codebase before writing these specs.

---

### D1 — Remove `roleIncome` Ghost Wealth from `physicsEngine.ts`

**Status**: Not yet implemented
**Priority**: URGENT
**Files**: `server/src/mechanics/physicsEngine.ts`, `server/src/mechanics/physicsConfig.ts`, `server/src/orchestration/simulationRunner.ts`

**Problem**:
`physicsEngine.ts` contains `roleIncome()` (lines 89-95) which returns a flat fiat grant based on role tier (`elite=14`, `artisan=10`, `scholar=8`, `default=6`). This wealth is created from nothing and violates SFC.

Two separate violations:

- **`WORK_AT_ENTERPRISE`**: Enterprise wages are already correctly paid by the runner through `weekStateMap` (employer's wealth debited, worker's wealth credited). The runner then *also* adds `physics.wealthDelta` (= `roleIncome × productionMult`) on top, creating double income. The `roleIncome` call on line 151 must be removed entirely from the `WORK_AT_ENTERPRISE` branch.

- **Standalone `WORK`**: `roleIncome` is the *sole* income source. This income should instead come from a tracked **State Treasury** (a dedicated fiat reservoir initialized at session start). The treasury value must be persisted in the session's `EconomyState` so the SFC assertion can verify: `sum(agentWealth) + sum(AMMReserves) + treasury = totalMint`.

**Implementation**:

1. In `physicsEngine.ts`, split the `WORK` and `WORK_AT_ENTERPRISE` branches. For `WORK_AT_ENTERPRISE`, set `wealthDelta = 0` (wages are the runner's responsibility, not physics).

2. In `physicsConfig.ts`, keep `roleIncomeElite/Artisan/Scholar/Default` — they now define the amount *deducted from treasury* per WORK action, not created from air.

3. In `simulationRunner.ts`, add a `stateTreasury: number` accumulator initialized to a configurable amount (e.g., `totalAgents × 500`). On each WORK action (non-enterprise only): deduct `roleIncome` from `stateTreasury`, credit it to agent. If `stateTreasury < roleIncome`, cap the payout to available treasury balance (agent gets what's left, or 0).

4. Include `stateTreasury` in the SFC assertion: `sfcExpected = initialMint; sfcActual = sum(aliveAgentWealth) + sum(AMMFiatReserves) + stateTreasury`.

5. Persist `stateTreasury` in `EconomyState` so it survives across iterations.

---

### D2 — Give `dopamine` a Mechanical Role

**Status**: Not yet implemented
**Priority**: Medium
**Files**: `server/src/mechanics/allostaticEngine.ts`, `server/src/orchestration/simulationRunner.ts`

**Problem**:
`dopamine` is calculated, decayed (`-3/tick`), and shown to LLMs as an exact number (C3), but it never influences any simulation outcome. It is a "ghost stat" — complexity with no mechanical payoff.

**Implementation**:

Give dopamine two mechanical effects in `allostaticEngine.ts`:

1. **Anhedonia Anxiety Feedback**: Each tick, if `dopamine ≤ 30`, add `+4` to cortisol. This models low-reward-state anxiety: dopamine depletion escalates stress. Cap cortisol at 100.

2. **REST Recovery Scaling**: When an agent performs a `REST` action, scale the health recovery by dopamine level:
   - `dopamine ≥ 70`: health recovery ×1.25 (well-rested, motivated recovery)
   - `30 < dopamine < 70`: health recovery ×1.0 (baseline)
   - `dopamine ≤ 30`: health recovery ×0.75 (anhedonia impairs recovery)

   Apply this multiplier inside `simulationRunner.ts` when computing `newHealth` for REST outcomes.

This makes dopamine a meaningful economic signal: agents who consistently fail to obtain food/luxury goods (low dopamine) spiral into cortisol-driven stress and poor recovery, creating natural inequality dynamics.

---

### D3 — Delete `economyEngine.ts` (Dead Code)

**Status**: Not yet implemented
**Priority**: MAINTENANCE
**Files**: `server/src/mechanics/economyEngine.ts`, `server/src/orchestration/simulationRunner.ts`

**Problem**:
`economyEngine.ts` is entirely unused in production. Its `runEconomyIteration()` and `initializeAgentEconomy()` are only called by Phase 1 test files. The only production import is `cleanupSessionEconomy`, which itself only calls `clearOrderBook(sessionId)` plus deletes from a `sessionContracts` map that the runner never uses (the runner uses `employmentRegistry`).

**Implementation**:

1. In `simulationRunner.ts`, replace the `cleanupSessionEconomy(sessionId)` call with a direct inline call: `clearOrderBook(sessionId)`. Update the import to pull `clearOrderBook` directly from wherever it is defined (likely `server/src/mechanics/orderBook.ts` or similar).

2. Delete `server/src/mechanics/economyEngine.ts`.

3. Update any test files that import from `economyEngine.ts` — if they are Phase 1 legacy tests that are no longer relevant, delete them too. If they test still-relevant logic, migrate the tested function inline.

4. Verify TypeScript build passes after deletion.

---

### D4 — Surface `physics.trace` to LLM Resolution Context

**Status**: Not yet implemented
**Priority**: Medium (Neuro-Symbolic coherence)
**Files**: `server/src/orchestration/simulationRunner.ts`, `server/src/llm/prompts.ts`

**Problem**:
`resolveAction()` in `physicsEngine.ts` returns a `trace: string[]` array containing step-by-step math strings (e.g., `"health: 72 - 5 (action cost) + 3 (food) = 70"`). The runner collects `physics.trace` per action but discards it immediately — it is never fed to the LLM resolution prompt. This is the **Math-to-Narrative Lag**: the narrator LLM invents plausible numbers that may contradict the actual physics computation.

**Implementation**:

1. In `simulationRunner.ts`, after each `resolveAction()` call, accumulate `physics.trace` entries into a per-agent trace map:
   ```
   agentTraceMap: Map<agentId, string[]>
   agentTraceMap.get(agentId).push(...physics.trace)
   ```

2. Before calling `buildGroupResolutionMessages()`, serialize the trace map into a compact `[PHYSICS LOG]` string:
   ```
   [PHYSICS LOG]
   Agent Alice: health 72→70 (-2), wealth 120→134 (+14 role income)
   Agent Bob: health 45→40 (-5 action cost), wealth 88→88
   ```
   Keep each agent's trace to the last 3 entries to avoid token bloat.

3. In `prompts.ts`, add a `physicsLog?: string` parameter to `buildGroupResolutionMessages`. Inject it into the system prompt immediately before the `[RESOLUTION CONTEXT]` block:
   ```
   The following math log shows the exact mechanical outcomes for this iteration.
   Your narrative MUST be consistent with these numbers — do not invent different values.

   ${physicsLog}
   ```

4. In `buildResolutionPrompt` (single-agent path), add the same `physicsLog` parameter and inject it the same way.

---

### D5 — Parameter Schema Hardening (Reduce Hallucination Rate)

**Status**: Not yet implemented
**Priority**: USABILITY (targets 12-15% action failure rate)
**Files**: `server/src/llm/prompts.ts`

**Problem**:
Approximately 12-15% of agent actions fail because the LLM hallucinates incorrect parameter names or values (e.g., `"amount"` instead of `"quantity"`, numeric strings instead of numbers). The current prompt lists action schemas as prose, which is ambiguous.

**Implementation**:

In `buildNaturalIntentPrompt`, add a dedicated `[PARAMETER SCHEMA — EXACT FORMAT REQUIRED]` block to the static prefix. Show the three most hallucination-prone actions as concrete JSON examples:

```
[PARAMETER SCHEMA — EXACT FORMAT REQUIRED]
Your actionParameters field MUST exactly match these schemas. Wrong keys = action fails.

PRODUCE_AND_SELL:
{"itemType": "food", "quantity": 3}
// itemType: "food" | "raw_materials" | "luxury_goods"
// quantity: integer 1-10

POST_BUY_ORDER:
{"itemType": "food", "quantity": 2, "maxPrice": 8}
// maxPrice: number (your max willingness to pay per unit)

STEAL:
{"targetAgentId": "agent_abc123"}
// targetAgentId: exact agent ID string from the agent list

WORK_AT_ENTERPRISE:
{"enterpriseId": "ent_xyz789"}
// enterpriseId: exact enterprise ID string from the enterprise list
```

Additionally, in the action listing section, replace prose parameter descriptions with inline JSON schema annotations for each action. This gives the LLM a concrete reference it can directly copy rather than infer.

---

## Implementation Order — Part 5

| Priority | ID | Description | Effort |
|---|---|---|---|
| 1 | D1 | Remove `roleIncome` ghost wealth; add State Treasury | High |
| 2 | D3 | Delete `economyEngine.ts` dead code | Low |
| 3 | D5 | Parameter schema hardening | Low |
| 4 | D2 | Dopamine mechanical integration | Medium |
| 5 | D4 | Physics trace → LLM resolution context | Medium |

## Files Affected — Part 5

| File | Changes |
|---|---|
| `server/src/mechanics/physicsEngine.ts` | D1: Remove `roleIncome` from `WORK_AT_ENTERPRISE` branch; zero out `wealthDelta` for enterprise workers |
| `server/src/mechanics/physicsConfig.ts` | D1: `roleIncome*` values remain but semantics change to treasury-deduction rates |
| `server/src/orchestration/simulationRunner.ts` | D1: Add `stateTreasury`; D2: REST recovery scaling; D3: inline `clearOrderBook`; D4: agentTraceMap accumulation |
| `server/src/mechanics/allostaticEngine.ts` | D2: Dopamine→cortisol feedback; dopamine REST recovery multiplier |
| `server/src/mechanics/economyEngine.ts` | D3: DELETE this file |
| `server/src/llm/prompts.ts` | D4: `physicsLog` parameter; D5: parameter schema block |
| `shared/src/types.ts` | D1: Add `stateTreasury` to `EconomyState` |
