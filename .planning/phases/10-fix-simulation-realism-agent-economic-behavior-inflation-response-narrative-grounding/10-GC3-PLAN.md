---
phase: 10-fix-simulation-realism
plan: GC3
type: gap-closure
wave: 1
depends_on: ["10-GC1"]
files_modified:
  - server/src/mechanics/fiscalEngine.ts
  - server/src/mechanics/__tests__/fiscal.test.ts
  - server/src/orchestration/simulationRunner.ts
autonomous: true
gap_found_by: post-simulation analysis of session-china.json (2026-04-09)
requirements:
  - D-31
must_haves:
  truths:
    - "Public goods quality takes at least 10 iterations of near-maximum spending to hit 100%"
    - "At 1-2% GDP spending per category (typical), quality gain is 1-3 points per iteration"
    - "Cortisol never drops below 3 regardless of how well-fed/employed agents are"
    - "Public goods quality gain formula calibrated: 10% GDP spending = ~6 quality points/iter max"
    - "All fiscal engine tests pass"
  artifacts:
    - path: "server/src/mechanics/fiscalEngine.ts"
      provides: "GDP_SCALED_MAX_GAIN_PER_ITER reduced from 75 to 6"
    - path: "server/src/orchestration/simulationRunner.ts"
      provides: "clampStat for cortisol uses floor of 3 instead of 0"
---

<objective>
Fix two calibration issues that make the simulation unrealistic: public goods quality saturates too fast, and cortisol collapses to zero.

**Issue 1 — GDP_SCALED_MAX_GAIN_PER_ITER = 75 (fiscalEngine.ts:102) is 10× too high (D-31 miscalibrated)**

The D-31 fix was supposed to make quality require "near-maximum treasury commitment." But `GDP_SCALED_MAX_GAIN_PER_ITER = 75` means even at 1.8% of GDP spending (far below the 10% target), quality gains are 22+ points/iteration — saturating 100% within 3 iterations.

**Math proof from simulation data:**
- Iter 1: infra spend = 625, totalEconomyFiat ≈ 34,400
- spendingRatio = 625/34400 = 1.82% (target is 10%)
- ratioEffect = min(1.0, 0.0182 / 0.10) = 0.182
- diminishedEffect = 0.182^0.7 ≈ 0.304
- gain = **75 × 0.304 = 22.8 points** — way too high
- Starting from 50: 50 → 72.6 → 94 → 100 (capped) in 3 iterations

**Correct calibration**: At the 10% GDP target (full funding), max gain should be 6-8 points/iter. This means:
- Full funding (10% GDP): 100% quality takes ~13-17 iterations of sustained maximum spending
- Typical funding (2% GDP): ~1.5-2 pts/iter — quality grows slowly, never saturates
- Below threshold (<1% GDP): <1 pt/iter — quality slowly decays or stays flat

**Issue 2 — Cortisol drops to exactly 0 (physicsEngine + simulationRunner)**

`clampStat()` in `simulationRunner.ts:403-406` uses `Math.max(0, Math.min(100, value))` — floor is 0.

With well-fed agents doing successful subsistence production, cortisol gains (+3 WORK relief, -3 PRODUCE relief) consistently outweigh cortisol sources (no poverty, no legal trouble). Cortisol drops to 0 by iteration 6. A floor of 0 makes cortisol a meaningless metric.

Real populations always have background stress: work fatigue, relational tension, health uncertainty. A minimum floor of 3 represents "baseline human stress" that never disappears.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-CONTEXT.md
@server/src/mechanics/fiscalEngine.ts
@server/src/mechanics/__tests__/fiscal.test.ts
@server/src/orchestration/simulationRunner.ts

<critical_context>
**The GDP_SCALED_MAX_GAIN_PER_ITER constant in fiscalEngine.ts (line 102):**
```typescript
// Current (too high):
const GDP_SCALED_MAX_GAIN_PER_ITER = 75;

// After fix:
const GDP_SCALED_MAX_GAIN_PER_ITER = 6;
```

**The updatePublicGoodsQuality formula (fiscalEngine.ts:126-139):**
```typescript
if (gdpScaling && totalEconomyFiat && totalEconomyFiat > 0) {
  const spendingRatio = spendAmount / totalEconomyFiat;
  const ratioEffect = Math.min(1.0, spendingRatio / TARGET_SPENDING_RATIO);
  const diminishedEffect = Math.pow(ratioEffect, diminishingExponent);
  const gain = GDP_SCALED_MAX_GAIN_PER_ITER * diminishedEffect;
  newQuality = currentQuality + gain;
}
```
`TARGET_SPENDING_RATIO = 0.10` (10% of GDP per category for full effect).
`diminishingExponent` comes from `economyConfig.publicGoodsGainDiminishing ?? 0.7`.

**After fix math check (with GDP_SCALED_MAX_GAIN_PER_ITER = 6):**
- At full 10% GDP spending: ratioEffect=1.0, diminishedEffect=1.0, gain=6 pts/iter → 100% in ~17 iters
- At 2% GDP spending: ratioEffect=0.2, diminishedEffect=0.2^0.7≈0.35, gain=6×0.35=2.1 pts/iter → 100% never
- At 1.82% GDP (current China sim): gain=6×0.304≈1.8 pts/iter — slowly improving but not saturating
- Starting from 50%, at 1.82% spending: 50 → 52 → 54 → ... gradual improvement that creates real policy tension

**The clampStat function in simulationRunner.ts:403-406:**
```typescript
function clampStat(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, value));  // floor is 0
}
```
This is used for health, happiness, cortisol, and dopamine. We cannot change the shared function.

Instead, apply a cortisol-specific floor AFTER `clampStat` at each of the two call sites where cortisol is computed:
- Line 2873: `let newCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);`
- Line 2764: `const currentCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);`

Change both to:
```typescript
const CORTISOL_FLOOR = 3;
let newCortisol = Math.max(CORTISOL_FLOOR, clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta));
```

Define `const CORTISOL_FLOOR = 3;` near the top of the file alongside other physics constants.

**Note on runningCortisol at line 2350:**
```typescript
runningCortisol = clampStat(runningCortisol + effectiveCortisolDelta);
```
This is the multi-action accumulator within a single iteration. The floor should be applied to the FINAL cortisol value (line 2873), not to each intermediate accumulation step. Do NOT apply the floor at line 2350.
</critical_context>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Recalibrate GDP_SCALED_MAX_GAIN_PER_ITER in fiscalEngine.ts</name>
  <files>server/src/mechanics/fiscalEngine.ts, server/src/mechanics/__tests__/fiscal.test.ts</files>
  <read_first>server/src/mechanics/fiscalEngine.ts, server/src/mechanics/__tests__/fiscal.test.ts</read_first>
  <action>
**Step 1: Change the constant**

In `server/src/mechanics/fiscalEngine.ts`, find line 102:
```typescript
const GDP_SCALED_MAX_GAIN_PER_ITER = 75;
```
Change to:
```typescript
// GDP-scaled max quality gain per iteration at full target spending (10% of GDP per category).
// At full funding: 6 pts/iter → reaching 100% quality requires ~17 iterations of maximum spending.
// At typical 2% GDP spending: ~2 pts/iter — quality improves slowly, creating real fiscal trade-offs.
const GDP_SCALED_MAX_GAIN_PER_ITER = 6;
```

**Step 2: Update affected tests in fiscal.test.ts**

Find any tests that assert specific quality values using the GDP-scaled formula with the old `75` constant. Update expected values to match the new `6` constant.

For each affected test, recalculate the expected output:
- Old formula: gain = 75 × (spendingRatio / 0.10)^0.7
- New formula: gain = 6 × (spendingRatio / 0.10)^0.7

Example: if a test uses `spendAmount = 500, totalEconomyFiat = 10000`:
- spendingRatio = 0.05 (5% of GDP)
- ratioEffect = min(1, 0.05/0.10) = 0.5
- diminishedEffect = 0.5^0.7 ≈ 0.616
- OLD gain: 75 × 0.616 = 46.2 pts → NEW gain: 6 × 0.616 = 3.7 pts

Update test assertions accordingly.

**Step 3: Add a new calibration test**

Add a test that explicitly verifies the calibration goal — 10% GDP spending produces 6 pts/iter, and 1% GDP spending produces less than 1 pt/iter:

```typescript
describe('GDP-scaled quality calibration', () => {
  const config: Partial<EconomyConfig> = {
    publicGoodsDecayRate: 0.5,
    publicGoodsGainDiminishing: 0.7,
    publicGoodsSpendingToGdpScaling: true,
    budgetSpendingRate: 0.1,
  };

  it('produces ~6 quality points at full 10% GDP spending', () => {
    // spendAmount = 1000, totalEconomyFiat = 10000 → spendingRatio = 0.10 (full target)
    const result = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 1000,
      decayRate: 0.5,
      diminishingExponent: 0.7,
      gdpScaling: true,
      totalEconomyFiat: 10000,
    });
    // ratioEffect = 1.0, diminishedEffect = 1.0, gain = 6.0
    expect(result).toBeCloseTo(56, 0);  // 50 + 6 = 56
  });

  it('produces less than 1 quality point at 1% GDP spending', () => {
    // spendAmount = 100, totalEconomyFiat = 10000 → spendingRatio = 0.01 (10% of target)
    const result = updatePublicGoodsQuality({
      currentQuality: 50,
      spendAmount: 100,
      decayRate: 0.5,
      diminishingExponent: 0.7,
      gdpScaling: true,
      totalEconomyFiat: 10000,
    });
    // ratioEffect = 0.1, diminishedEffect = 0.1^0.7 ≈ 0.2, gain = 6 × 0.2 = 1.2
    expect(result - 50).toBeLessThan(1.5);
    expect(result - 50).toBeGreaterThan(0);
  });

  it('never saturates at 100 from a single iteration even at max spending', () => {
    const result = updatePublicGoodsQuality({
      currentQuality: 95,  // near max
      spendAmount: 1000,
      decayRate: 0.5,
      diminishingExponent: 0.7,
      gdpScaling: true,
      totalEconomyFiat: 10000,  // 10% GDP spending
    });
    // 95 + 6 = 101 → clamped to 100
    expect(result).toBe(100);
  });
});
```

Import `updatePublicGoodsQuality` from fiscalEngine if not already imported in the test file.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx vitest run server/src/mechanics/__tests__/fiscal.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - `GDP_SCALED_MAX_GAIN_PER_ITER` is 6 (not 75)
    - All existing fiscal tests pass (update expected values if needed)
    - New calibration tests pass: ~6 pts at 10% GDP, <1.5 pts at 1% GDP, clamped at 100 from 95
    - `updatePublicGoodsQuality` is exported (needed for direct test import) — add `export` keyword if missing
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Add CORTISOL_FLOOR = 3 to prevent cortisol collapsing to zero</name>
  <files>server/src/orchestration/simulationRunner.ts</files>
  <read_first>server/src/orchestration/simulationRunner.ts</read_first>
  <action>
**Step 1: Define CORTISOL_FLOOR constant**

Near the top of `simulationRunner.ts`, after the `clampStat` function definition (around line 406), add:
```typescript
// Minimum physiological cortisol level — even in good economic conditions, background
// stress from work, uncertainty, and aging is always present. Prevents cortisol from
// becoming a meaningless metric in well-functioning economies.
const CORTISOL_FLOOR = 3;
```

**Step 2: Apply floor at the final cortisol commit sites**

There are exactly 2 places where cortisol is finalized from `clampStat` into a new stat value:

**Site A (line ~2873)** — end of per-agent stat update for alive agents:
```typescript
// BEFORE:
let newCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);

// AFTER:
let newCortisol = Math.max(CORTISOL_FLOOR, clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta));
```

**Site B (line ~2764)** — this is the earlier clamp during per-agent processing (check exact context by reading lines 2760-2770):
```typescript
// BEFORE (if this is the per-agent cortisol clamp):
const currentCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);

// AFTER:
const currentCortisol = Math.max(CORTISOL_FLOOR, clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta));
```

**Do NOT apply CORTISOL_FLOOR at**:
- `runningCortisol = clampStat(runningCortisol + effectiveCortisolDelta)` (line 2350) — this is a per-action accumulator, applying the floor here would compound errors across multi-action sequences
- Any line with `targetUpdate.cortisol = clampStat(...)` — this handles suppression/crime victims, leave those alone

**Step 3: Confirm with a search**

After editing, verify: `grep -n "clampStat.*cortisol\|cortisol.*clampStat" server/src/orchestration/simulationRunner.ts` should show the two sites with `Math.max(CORTISOL_FLOOR, ...)` applied, and the multi-action accumulator without it.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx tsc -p server/tsconfig.json --noEmit 2>&1 | head -10 && npm run test -w server -- --run 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `CORTISOL_FLOOR = 3` constant defined near line 406
    - Exactly 2 cortisol clamp sites apply `Math.max(CORTISOL_FLOOR, clampStat(...))`: the alive-agent final stat update and the per-agent processing clamp
    - `runningCortisol` accumulator at line ~2350 is NOT modified
    - TypeScript compiles with zero errors
    - All tests pass
  </acceptance_criteria>
</task>

</tasks>

<verification>
- `npx tsc -p server/tsconfig.json --noEmit` — zero errors
- `npm run test -w server -- --run` — full suite green
- `grep "GDP_SCALED_MAX_GAIN_PER_ITER" server/src/mechanics/fiscalEngine.ts` — shows `= 6`
- `grep "CORTISOL_FLOOR" server/src/orchestration/simulationRunner.ts | wc -l` — at least 3 (definition + 2 usages)
- Manual math check: `updatePublicGoodsQuality({ currentQuality: 50, spendAmount: 625, decayRate: 0.5, diminishingExponent: 0.7, gdpScaling: true, totalEconomyFiat: 34400 })` → should return ~51.8 (not ~73 as before)
</verification>

<success_criteria>
Public goods quality now requires sustained fiscal commitment to improve. At China's typical government spending (~2% GDP per category), quality gains are ~2 pts/iter — after 10 iterations of heavy spending, quality might reach 70%, creating real fiscal policy tension. Cortisol has a floor of 3, ensuring it remains a meaningful stress indicator even in well-performing economies. All tests pass.
</success_criteria>

<output>
After completion, create `.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-GC3-SUMMARY.md`
</output>
