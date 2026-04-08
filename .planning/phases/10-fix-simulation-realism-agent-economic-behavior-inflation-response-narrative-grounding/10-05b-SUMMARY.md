---
phase: 10-fix-simulation-realism
plan: 05b
subsystem: fiscal-engine
tags: [income-tax, public-goods, gdp-scaling, fiscal-policy, sfc]

requires:
  - phase: 10-01
    provides: EconomyConfig type with fiscal fields
  - phase: 10-04
    provides: Enterprise engine wired into simulationRunner

provides:
  - computeIncomeTax function for flat-rate income taxation
  - GDP-scaled public goods quality gain (spending-to-GDP ratio)
  - incomeTaxRate and publicGoodsSpendingToGdpScaling EconomyConfig fields
  - Sustainable fiscal funding loop (taxes replenish treasury)

affects: [simulation-runner, fiscal-engine, economy-config, agent-prompts]

tech-stack:
  added: []
  patterns: [gdp-ratio-scaling, income-tracking-map, pre-budget-tax-collection]

key-files:
  created: []
  modified:
    - server/src/mechanics/fiscalEngine.ts
    - server/src/mechanics/__tests__/fiscal.test.ts
    - server/src/orchestration/simulationRunner.ts
    - shared/src/types.ts

decisions:
  - "Income tax collected before budget execution so revenue is available for spending"
  - "GDP scaling target ratio set at 10% — full quality gain requires 10% of GDP per category"
  - "Agent income tracked via agentIterationIncome Map covering both WORK and enterprise wages"
  - "GDP-scaled quality gain uses diminishing returns on ratio effect (not on raw gain)"

metrics:
  duration_seconds: 423
  completed: "2026-04-08T20:42:00Z"
  tasks_completed: 3
  tasks_total: 3
  test_count: 28
  files_modified: 4
---

# Phase 10 Plan 05b: Income Tax + GDP-Scaled Public Goods Summary

Income tax collects 15% of WORK/enterprise wage income per iteration, funding the treasury sustainably. Public goods quality scales with spending-to-GDP ratio so trivial spending produces low quality (~4 points) while significant commitment (10%+ GDP per category) produces meaningful quality (~75 points).

## Task Completion

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Income tax collection (D-32) | 7a15382 | computeIncomeTax function + 5 TDD tests |
| 2 | GDP-scaled public goods (D-31) | 4eaa606 | GDP ratio scaling + incomeTaxRate/publicGoodsSpendingToGdpScaling config |
| 3 | Wire into simulationRunner | a9c0d30 | Income tracking, tax collection, totalEconomyFiat passed to executeBudget |

## Implementation Details

### Income Tax (D-32)
- `computeIncomeTax(TaxInput): TaxOutput` in fiscalEngine.ts
- Flat rate applied to positive income only; zero/negative income exempt
- Returns per-agent deductions and total treasury revenue
- SFC-neutral: wealth transfer from agents to treasury (no fiat created/destroyed)

### GDP-Scaled Public Goods (D-31)
- Quality gain formula: `gain = MAX_GAIN * min(1, spendingRatio/targetRatio)^diminishingExponent`
- TARGET_SPENDING_RATIO = 0.10 (10% of GDP per category for full effect)
- GDP_SCALED_MAX_GAIN_PER_ITER = 75 (max quality points per iteration at full ratio)
- Backward compatible: legacy formula when `publicGoodsSpendingToGdpScaling` is false/undefined

### SimulationRunner Wiring
- `agentIterationIncome` Map tracks income from WORK actions and enterprise wages
- Tax collection runs before budget execution in the fiscal tick
- `totalEconomyFiat` computed from agent wealth sum + treasury balance
- Tax traces appended to physics trace log for narrative grounding

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all functionality is fully wired.

## Pre-existing Issues

- `inflationEngine.test.ts` has 1 pre-existing failure (inflationExpectations rolling mean test) unrelated to this plan's changes.
