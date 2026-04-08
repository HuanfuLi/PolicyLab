---
phase: 10-fix-simulation-realism
plan: 05b
type: execute
wave: 3
depends_on: ["10-01", "10-04"]
files_modified:
  - server/src/mechanics/fiscalEngine.ts
  - server/src/mechanics/__tests__/fiscalEngine.test.ts
  - server/src/orchestration/simulationRunner.ts
  - shared/src/types.ts
autonomous: true
requirements:
  - D-31
  - D-32
must_haves:
  truths:
    - "Income/production tax collects revenue from WORK income and enterprise revenue each iteration (D-32)"
    - "Tax revenue flows back to treasury, creating sustainable government funding"
    - "Public goods quality gain is scaled by spending-to-GDP ratio — trivial spending cannot max quality (D-31)"
    - "Decay/gain parameters rebalanced so 100% quality requires near-maximum treasury commitment"
    - "EconomyConfig has incomeTaxRate field with backward-compatible default"
  artifacts:
    - path: "server/src/mechanics/fiscalEngine.ts"
      provides: "computeIncomeTax function + rebalanced public goods scaling"
      exports: ["computeIncomeTax", "executeBudget"]
    - path: "server/src/mechanics/__tests__/fiscalEngine.test.ts"
      provides: "Tax collection + public goods scaling tests"
      min_lines: 30
  key_links:
    - from: "server/src/mechanics/fiscalEngine.ts"
      to: "server/src/orchestration/simulationRunner.ts"
      via: "computeIncomeTax called in fiscal tick"
      pattern: "computeIncomeTax"
---

<objective>
Implement income/production taxation and rebalance public goods quality scaling for fiscal realism.

Purpose: Without taxation, the treasury is a one-way drain — government always becomes insolvent. Without spending-to-GDP scaling, trivial fiscal spending produces 100% public goods quality from iteration 2 onward, making budget allocation meaningless. These two fixes create a functioning fiscal feedback loop: taxes fund spending, spending produces quality proportional to economic commitment.

Output: `computeIncomeTax` in fiscalEngine.ts, public goods gain scaled by spending/GDP ratio, rebalanced decay parameters, all wired into simulationRunner.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-CONTEXT.md
@server/src/mechanics/fiscalEngine.ts
@server/src/mechanics/__tests__/fiscalEngine.test.ts
@server/src/orchestration/simulationRunner.ts
@shared/src/types.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement income/production tax collection (D-32)</name>
  <files>server/src/mechanics/fiscalEngine.ts, server/src/mechanics/__tests__/fiscalEngine.test.ts, shared/src/types.ts</files>
  <read_first>server/src/mechanics/fiscalEngine.ts, server/src/mechanics/__tests__/fiscalEngine.test.ts, shared/src/types.ts</read_first>
  <behavior>
    - computeIncomeTax with 15% rate and 3 agents earning 100, 200, 300: total tax = 90, per-agent deductions [15, 30, 45]
    - computeIncomeTax with 0% rate: total tax = 0, no deductions
    - computeIncomeTax with agents who earned 0: no tax on zero income
    - Tax revenue added to treasury balance
    - Agent wealth reduced by tax amount
  </behavior>
  <action>
Add `computeIncomeTax` to fiscalEngine.ts:

```typescript
export interface TaxInput {
  agentIncomes: Array<{ agentId: string; income: number }>; // income earned this iteration (wages, enterprise revenue)
  taxRate: number; // from EconomyConfig.incomeTaxRate
}

export interface TaxOutput {
  totalRevenue: number;
  perAgentTax: Array<{ agentId: string; taxAmount: number }>;
  trace: string[];
}

export function computeIncomeTax(input: TaxInput): TaxOutput {
  const perAgentTax: Array<{ agentId: string; taxAmount: number }> = [];
  let totalRevenue = 0;

  for (const { agentId, income } of input.agentIncomes) {
    if (income <= 0) continue;
    const tax = income * input.taxRate;
    perAgentTax.push({ agentId, taxAmount: tax });
    totalRevenue += tax;
  }

  return {
    totalRevenue,
    perAgentTax,
    trace: [`[FISCAL] Income tax collected: ${totalRevenue.toFixed(2)} from ${perAgentTax.length} agents at ${(input.taxRate * 100).toFixed(1)}% rate`],
  };
}
```

Add tests for tax collection.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx vitest run server/src/mechanics/__tests__/fiscalEngine.test.ts -x 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - fiscalEngine.ts exports computeIncomeTax
    - Tax is calculated as income * taxRate per agent
    - Zero income agents are skipped
    - Total revenue sums all individual taxes
    - Tests pass for standard rate, zero rate, and mixed income scenarios
  </acceptance_criteria>
  <done>Income tax computation implemented and tested. Flat rate applied to positive income only. Returns per-agent deductions and total treasury revenue.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rebalance public goods quality scaling (D-31)</name>
  <files>server/src/mechanics/fiscalEngine.ts, server/src/mechanics/__tests__/fiscalEngine.test.ts</files>
  <read_first>server/src/mechanics/fiscalEngine.ts</read_first>
  <behavior>
    - Spending 750 on 84K economy (~0.9% GDP) produces quality ~10-15%, NOT 100%
    - Spending 10% of GDP produces quality ~60-70%
    - Spending 25%+ of GDP produces quality ~90-100%
    - Quality still decays when spending is absent
    - Existing decay rate parameter still functions
  </behavior>
  <action>
Modify the public goods quality gain formula in `executeBudget` (or wherever quality is updated):

1. Compute spending-to-GDP ratio: `spendingRatio = categorySpending / totalEconomyFiat`
2. Scale the quality gain by this ratio: `effectiveGain = baseGain * Math.min(1.0, spendingRatio / targetSpendingRatio)`
   where `targetSpendingRatio` is ~0.05 (5% of GDP per category to achieve full gain effect)
3. Apply diminishing returns on top: `qualityDelta = effectiveGain ^ publicGoodsGainDiminishing`
4. Cap quality at 100

This means:
- 0.9% GDP spending → effectiveGain scaled to ~18% of max → quality gain ~15
- 5% GDP spending → effectiveGain at 100% → full quality gain (but still subject to diminishing returns)
- With decay at 0.5, equilibrium quality requires sustained significant spending

When `publicGoodsSpendingToGdpScaling` is false (backward compat), use old formula.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx vitest run server/src/mechanics/__tests__/fiscalEngine.test.ts -x 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - Public goods quality gain scales with spending-to-GDP ratio
    - Trivial spending (<1% GDP) produces low quality (~10-15%), NOT 100%
    - Significant spending (5%+ GDP) produces meaningful quality (60%+)
    - Quality decays when spending is absent
    - Backward compat: old behavior when publicGoodsSpendingToGdpScaling is false
    - Tests verify scaling at multiple spending levels
  </acceptance_criteria>
  <done>Public goods quality gain scaled by spending-to-GDP ratio. Trivial spending no longer maxes quality. Equilibrium requires sustained significant treasury commitment.</done>
</task>

<task type="auto">
  <name>Task 3: Wire tax collection + GDP-scaled public goods into simulationRunner</name>
  <files>server/src/orchestration/simulationRunner.ts</files>
  <read_first>server/src/orchestration/simulationRunner.ts</read_first>
  <action>
1. After wage settlement (where agents receive income), collect agent incomes for the iteration
2. Call `computeIncomeTax` with the collected incomes and `economyConfig.incomeTaxRate`
3. Deduct tax from each agent's wealth
4. Add total revenue to treasury balance
5. Pass total economy fiat to `executeBudget` for GDP-scaled public goods calculation

Wire in the fiscal tick section of simulationRunner, after enterprise wages are settled but before budget execution.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npm run test -w server -- --run 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - simulationRunner.ts imports computeIncomeTax from fiscalEngine
    - Tax collection happens after wage settlement, before budget execution
    - Tax revenue flows to treasury
    - Agent wealth reduced by tax amount
    - Total economy fiat passed to budget execution for GDP scaling
    - SFC audit still passes (tax is a transfer, not creation/destruction)
    - All existing tests pass
  </acceptance_criteria>
  <done>Tax collection wired into simulation loop. Treasury receives income tax revenue each iteration. Public goods quality scaled by spending-to-GDP ratio. Fiscal system now has a sustainable funding loop.</done>
</task>

</tasks>

<verification>
- `npx vitest run server/src/mechanics/__tests__/fiscalEngine.test.ts -x` all tests pass
- `npm run test -w server -- --run` full suite green
- `grep "computeIncomeTax" server/src/orchestration/simulationRunner.ts` shows wiring
- `grep "incomeTaxRate" shared/src/types.ts` shows config field
</verification>

<success_criteria>
Income tax collects 15% of WORK income per iteration, funding the treasury sustainably. Public goods quality scales with spending-to-GDP ratio — trivial spending produces low quality, significant commitment required for 100%. SFC audit passes (tax is a wealth transfer, not creation). Full test suite green.
</success_criteria>

<output>
After completion, create `.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-05b-SUMMARY.md`
</output>
