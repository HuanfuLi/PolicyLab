---
phase: 10-fix-simulation-realism
plan: GC2
type: gap-closure
wave: 1
depends_on: ["10-GC1"]
files_modified:
  - server/src/orchestration/simulationRunner.ts
  - server/src/mechanics/inflationEngine.ts
  - server/src/mechanics/__tests__/inflationEngine.test.ts
autonomous: true
gap_found_by: post-simulation analysis of session-china.json (2026-04-09)
requirements:
  - D-30
  - D-12
must_haves:
  truths:
    - "CPI auto-initializes from real AMM spot prices on the first iteration"
    - "CPI moves away from 100 when food prices change between iterations"
    - "Tools, luxury_goods, and raw_materials have non-zero baseline prices so CPI basket is meaningful"
    - "inflationRate and inflationExpectations are non-zero after 2+ iterations with price movement"
    - "All inflation engine tests pass"
  artifacts:
    - path: "server/src/orchestration/simulationRunner.ts"
      provides: "hasBasePrices check correctly detects all-zero base prices as uninitialized"
    - path: "server/src/mechanics/__tests__/inflationEngine.test.ts"
      provides: "Tests for CPI movement with real price data"
---

<objective>
Fix the CPI / inflation engine — the second most critical bug. CPI has been frozen at 100 across all iterations in every simulation run, making the inflation system completely non-functional.

**Root cause chain (two compounding bugs):**

**Bug A — Wrong `hasBasePrices` check (simulationRunner.ts:3658)**:
```typescript
// BROKEN: checks for key existence, not non-zero values
const hasBasePrices = Object.keys(persistedEconomyConfig.cpiBasePrices ?? {}).length > 0;
```
The session config initializes `cpiBasePrices: { food: 0, tools: 0, luxury_goods: 0, raw_materials: 0 }` — 4 keys all set to 0. The check sees 4 keys → `hasBasePrices = true` → the auto-init block never runs → base prices stay at zero.

Then in `inflationEngine.ts:103`:
```typescript
const ratio = basePrice === 0 ? 1 : currentPrice / basePrice;
```
Every basket item gets `ratio = 1` → `CPI = 1 × 100 = 100` forever.

**Bug B — Non-food basket items have no real prices**:
Even after fixing Bug A, `tools`, `luxury_goods`, and `raw_materials` fall back to `1.0` in `getInflationBasketPrices()` (simulationRunner.ts:590-592) because multi-AMM pools for these commodities have no real trading volume. These 3 items represent 60% of the CPI basket weight, meaning CPI movement is severely dampened even when food prices change significantly.

**Fix required:**
1. Fix the `hasBasePrices` check to detect all-zero values as "uninitialized"
2. Initialize baseline prices for non-food items using known AMM commodity baselines so the full basket contributes to CPI measurement
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-CONTEXT.md
@server/src/orchestration/simulationRunner.ts
@server/src/mechanics/inflationEngine.ts
@server/src/mechanics/__tests__/inflationEngine.test.ts

<critical_context>
**The broken hasBasePrices check is at simulationRunner.ts line 3658:**
```typescript
const hasBasePrices = Object.keys(persistedEconomyConfig.cpiBasePrices ?? {}).length > 0;
if (!hasBasePrices) {
  persistedEconomyConfig.cpiBasePrices = { ...currentPrices };
  // ... persist to DB ...
}
```
The fix is to check if ANY value is non-zero, not just key count.

**The `getInflationBasketPrices` function is at simulationRunner.ts lines 578-594:**
```typescript
function getInflationBasketPrices(
  sessionId: string,
  economyConfig: ReturnType<typeof getEconomyConfig>,
  priceIndices: PriceIndex[] = []): Record<string, number> {
  const iterationPrices = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    iterationPrices.set(idx.itemType, idx.volume > 0 ? idx.vwap : idx.lastPrice);
  }
  const priceHistory = sessionPriceHistory.get(sessionId);
  const basePrices = economyConfig.cpiBasePrices ?? {};
  return {
    food: iterationPrices.get('food') ?? priceHistory?.get('food') ?? basePrices.food ?? 1,
    tools: iterationPrices.get('tools') ?? priceHistory?.get('tools') ?? basePrices.tools ?? 1,
    luxury_goods: iterationPrices.get('luxury_goods') ?? priceHistory?.get('luxury_goods') ?? basePrices.luxury_goods ?? 1,
    raw_materials: iterationPrices.get('raw_materials') ?? priceHistory?.get('raw_materials') ?? basePrices.raw_materials ?? 1,
  };
}
```
`tools`, `luxury_goods`, `raw_materials` have no multi-AMM priceIndices and no priceHistory → fall back to `basePrices.X ?? 1`.

**COMMODITY_BASELINES already defined at simulationRunner.ts ~1477:**
```typescript
const COMMODITY_BASELINES: Record<string, number> = {
  food: FOOD_SPOT_BASELINE,    // e.g. 5.0 or similar
  raw_materials: 4.0,
  luxury_goods: 12.0,
  tools: 12.0
};
```
This is the correct set of starting prices for non-food items. These should be used as the initial base prices so that the CPI basket reflects real commodity value relationships.

**The inflationEngine.ts `??` vs `=== 0` issue:**
Line 101: `const basePrice = input.basePrices[item] ?? 1;`
This `??` (nullish coalescing) only replaces `null`/`undefined`, NOT `0`. So `0 ?? 1 === 0` (zero passes through). The `ratio === 0 ? 1 : ...` guard at line 103 then forces ratio = 1. The fix in simulationRunner ensures base prices are never zero, so the `inflationEngine.ts` code itself is fine — it just needs non-zero inputs.
</critical_context>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix hasBasePrices check + initialize non-food baseline prices</name>
  <files>server/src/orchestration/simulationRunner.ts</files>
  <read_first>server/src/orchestration/simulationRunner.ts</read_first>
  <action>
**Fix 1: The hasBasePrices check (line 3658)**

Find the inflation tick block (search for `// ── Inflation tick ─────` around line 3651). Replace the broken `hasBasePrices` check with a value-aware check:

```typescript
// BEFORE (broken — checks key count, not values):
const hasBasePrices = Object.keys(persistedEconomyConfig.cpiBasePrices ?? {}).length > 0;

// AFTER (correct — checks if ANY value is actually non-zero):
const hasBasePrices = Object.values(persistedEconomyConfig.cpiBasePrices ?? {})
  .some(v => (v ?? 0) > 0);
```

Keep the rest of the auto-init block identical:
```typescript
if (!hasBasePrices) {
  persistedEconomyConfig.cpiBasePrices = { ...currentPrices };
  session.config = {
    ...configRoot,
    economyConfig: {
      ...((configRoot.economyConfig as Record<string, unknown> | undefined) ?? {}),
      ...persistedEconomyConfig,
    },
  };
  await sessionRepo.updateConfig(sessionId, session.config as Record<string, unknown>);
}
```

**Fix 2: Initialize non-food commodity baselines in currentPrices**

The `currentPrices` variable (computed just before the `hasBasePrices` check, by calling `getInflationBasketPrices(...)`) returns `1` for tools/luxury_goods/raw_materials because those multi-AMMs have no trading volume yet. When we save `currentPrices` as base prices, we'd save `{food: 6.17, tools: 1, luxury_goods: 1, raw_materials: 1}`.

This means CPI will still only move based on food price changes (food = 40% basket weight). While better than 100% frozen, it's misleading. Fix by using `COMMODITY_BASELINES` as fallback for non-food items.

Find or confirm the `COMMODITY_BASELINES` constant in simulationRunner.ts (around line 1477). Then update the `getInflationBasketPrices` function (lines 578-594) to use these baselines as fallback instead of `1`:

```typescript
// Find COMMODITY_BASELINES (it should already exist as a const around line 1477):
// const COMMODITY_BASELINES: Record<string, number> = {
//   food: FOOD_SPOT_BASELINE,
//   raw_materials: 4.0,
//   luxury_goods: 12.0,
//   tools: 12.0
// };

// IMPORTANT: COMMODITY_BASELINES is defined inside a function scope. 
// Either move it to module scope, or duplicate the non-food values as a 
// module-scope constant. Add near the top of the file (after imports):
const NON_FOOD_COMMODITY_BASELINES: Record<string, number> = {
  raw_materials: 4.0,
  luxury_goods: 12.0,
  tools: 12.0,
};

// Then update getInflationBasketPrices (lines 578-594):
function getInflationBasketPrices(
  sessionId: string,
  economyConfig: ReturnType<typeof getEconomyConfig>,
  priceIndices: PriceIndex[] = []): Record<string, number> {
  const iterationPrices = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    iterationPrices.set(idx.itemType, idx.volume > 0 ? idx.vwap : idx.lastPrice);
  }
  const priceHistory = sessionPriceHistory.get(sessionId);
  const basePrices = economyConfig.cpiBasePrices ?? {};
  return {
    food: iterationPrices.get('food') ?? priceHistory?.get('food') ?? basePrices.food ?? 1,
    tools: iterationPrices.get('tools') ?? priceHistory?.get('tools') ?? basePrices.tools ?? NON_FOOD_COMMODITY_BASELINES.tools,
    luxury_goods: iterationPrices.get('luxury_goods') ?? priceHistory?.get('luxury_goods') ?? basePrices.luxury_goods ?? NON_FOOD_COMMODITY_BASELINES.luxury_goods,
    raw_materials: iterationPrices.get('raw_materials') ?? priceHistory?.get('raw_materials') ?? basePrices.raw_materials ?? NON_FOOD_COMMODITY_BASELINES.raw_materials,
  };
}
```

**Result**: On iteration 1, `currentPrices` will be `{food: ~6.0, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0}`. These non-zero prices get saved as `cpiBasePrices`. On iteration 2+, `hasBasePrices = true` and the auto-init is skipped. CPI is now computed as `(food_current/food_base) × 0.4 + (tools_current/tools_base) × 0.25 + ...` — which will move as food prices fluctuate and as enterprise production eventually affects non-food prices.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx tsc -p server/tsconfig.json --noEmit 2>&1 | head -10</automated>
  </verify>
  <acceptance_criteria>
    - `hasBasePrices` check uses `.some(v => (v ?? 0) > 0)` on values, not key count
    - `NON_FOOD_COMMODITY_BASELINES` constant defined at module scope with tools=12, luxury_goods=12, raw_materials=4
    - `getInflationBasketPrices` uses `NON_FOOD_COMMODITY_BASELINES` for non-food fallback instead of literal `1`
    - TypeScript compiles with zero errors
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add/update CPI auto-init and movement tests in inflationEngine.test.ts</name>
  <files>server/src/mechanics/__tests__/inflationEngine.test.ts</files>
  <read_first>server/src/mechanics/__tests__/inflationEngine.test.ts, server/src/mechanics/inflationEngine.ts</read_first>
  <action>
Add 4 targeted tests to `inflationEngine.test.ts` covering the fixed behavior:

**Test 1: CPI moves when food price increases vs base price**
```typescript
it('CPI rises above 100 when food price increases from base', () => {
  const result = computeInflation({
    iterationNumber: 2,
    currentPrices: { food: 7.5, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0 },
    basePrices:    { food: 6.0, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0 },
    m1Current: 80000,
    m1Previous: 80000,
    previousCpi: 100,
    recentCpiHistory: [100],
    economyConfig: { ...DEFAULT_ECONOMY_CONFIG, cpiBasketWeights: { food: 0.4, tools: 0.25, luxury_goods: 0.2, raw_materials: 0.15 } },
  });
  // Food ratio = 7.5/6.0 = 1.25; other ratios = 1.0
  // CPI = (1.25×0.4 + 1.0×0.25 + 1.0×0.2 + 1.0×0.15) × 100 = (0.5 + 0.25 + 0.2 + 0.15) × 100 = 110
  expect(result.cpi).toBeCloseTo(110, 1);
  expect(result.inflationRate).toBeGreaterThan(0);
});
```

**Test 2: CPI falls below 100 when food price decreases**
```typescript
it('CPI falls below 100 when food price decreases from base', () => {
  const result = computeInflation({
    iterationNumber: 2,
    currentPrices: { food: 4.8, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0 },
    basePrices:    { food: 6.0, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0 },
    m1Current: 80000,
    m1Previous: 80000,
    previousCpi: 100,
    recentCpiHistory: [100],
    economyConfig: { ...DEFAULT_ECONOMY_CONFIG },
  });
  // Food ratio = 4.8/6.0 = 0.8; CPI = (0.8×0.4 + 1.0×0.6) × 100 = (0.32 + 0.60) × 100 = 92
  expect(result.cpi).toBeLessThan(100);
  expect(result.inflationRate).toBeLessThan(0);
});
```

**Test 3: Zero base price causes ratio=1 (fallback behavior documented)**
```typescript
it('treats zero base price as ratio 1 (CPI contribution = weight)', () => {
  // This documents the existing guard: basePrice===0 → ratio=1
  const result = computeInflation({
    iterationNumber: 2,
    currentPrices: { food: 10.0, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0 },
    basePrices:    { food: 0, tools: 0, luxury_goods: 0, raw_materials: 0 },  // all zeros
    m1Current: 80000,
    m1Previous: 80000,
    previousCpi: 100,
    recentCpiHistory: [100],
    economyConfig: { ...DEFAULT_ECONOMY_CONFIG },
  });
  // All base prices are 0 → all ratios = 1 → CPI = 100
  expect(result.cpi).toBeCloseTo(100, 1);
  expect(result.inflationRate).toBeCloseTo(0, 2);
});
```

**Test 4: Non-food basket items contribute to CPI when their prices change**
```typescript
it('non-food price increases raise CPI proportional to basket weight', () => {
  const result = computeInflation({
    iterationNumber: 3,
    currentPrices: { food: 6.0, tools: 15.0, luxury_goods: 12.0, raw_materials: 4.0 },
    basePrices:    { food: 6.0, tools: 12.0, luxury_goods: 12.0, raw_materials: 4.0 },
    m1Current: 80000,
    m1Previous: 80000,
    previousCpi: 100,
    recentCpiHistory: [100],
    economyConfig: { ...DEFAULT_ECONOMY_CONFIG, cpiBasketWeights: { food: 0.4, tools: 0.25, luxury_goods: 0.2, raw_materials: 0.15 } },
  });
  // tools ratio = 15/12 = 1.25; food/luxury/raw_materials = 1.0
  // CPI = (1.0×0.4 + 1.25×0.25 + 1.0×0.2 + 1.0×0.15) × 100 = (0.4 + 0.3125 + 0.2 + 0.15) × 100 = 106.25
  expect(result.cpi).toBeCloseTo(106.25, 1);
});
```

Add these tests inside an existing `describe` block or create `describe('CPI movement', ...)`. Import `DEFAULT_ECONOMY_CONFIG` if not already imported.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx vitest run server/src/mechanics/__tests__/inflationEngine.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - All 4 new tests pass green
    - No existing inflation tests are broken
    - Tests cover: food price increase raises CPI, food price decrease lowers CPI, zero base = ratio 1, non-food basket contribution
  </acceptance_criteria>
</task>

</tasks>

<verification>
- `npx tsc -p server/tsconfig.json --noEmit` — zero errors
- `npm run test -w server -- --run` — full suite green
- `grep -n "hasBasePrices" server/src/orchestration/simulationRunner.ts` — shows `.some(v => (v ?? 0) > 0)` pattern
- `grep -n "NON_FOOD_COMMODITY_BASELINES" server/src/orchestration/simulationRunner.ts` — constant present
- `grep -n "NON_FOOD_COMMODITY_BASELINES" server/src/orchestration/simulationRunner.ts | wc -l` — at least 3 (definition + 3 usages)
</verification>

<success_criteria>
CPI auto-initializes from real AMM spot prices (food ~5-6, tools 12, luxury_goods 12, raw_materials 4) on the first iteration. From iteration 2 onward, CPI moves as food prices fluctuate. A minimum wage shock that raises enterprise costs (via cost pass-through) will cause goods prices to rise, which will appear in CPI within 1-2 iterations. inflationRate and inflationExpectations will be non-zero after 2+ iterations.
</success_criteria>

<output>
After completion, create `.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-GC2-SUMMARY.md`
</output>
