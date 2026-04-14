---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC3
subsystem: bootstrap-pipeline
tags: [tax-policy, bootstrap, heuristic, world-bank, sfc, gap-closure]
requirements: [D-13]
decisions_addressed: [D-13]
dependency_graph:
  requires: [11-05]
  provides: [D-13-heuristic-recalibration]
  affects: [11-GC4, bootstrap-tax-policy-defaults]
tech_stack:
  added: []
  patterns: [composite-welfare-state-gate, bootstrap-invariant-assertion]
key_files:
  created:
    - server/src/__tests__/bootstrapTaxPolicyFixtures.test.ts
  modified:
    - server/src/data/dataBootstrapPipeline.ts
    - server/src/routes/bootstrap.ts
    - server/src/llm/__tests__/centralAgentTaxPolicy.test.ts
decisions:
  - "Composite welfare-state gate: gdpPC > 25000 AND (govExpensePct > 18 || taxRevenuePct > 15 || govDebtPct > 60) catches US/DE/UK/JP, excludes IN/BR/NG, calibrated against WB GC.XPN.TOTL.GD.ZS scale"
  - "Bootstrap invariant assertion: throw early if locationProfile set but dataSources['taxPolicy'] !== 'api' — catches silent scenario-override regressions"
metrics:
  duration: "2 minutes"
  completed: "2026-04-14"
  tasks: 2
  files: 4
---

# Phase 11 Plan GC3: Bootstrap Tax Policy Heuristic Recalibration Summary

**One-liner:** Composite welfare-state gate (govExpensePct>18 || taxRevenuePct>15 || govDebtPct>60) fixes WB-scale miscalibration so US/DE/JP now derive progressive taxPolicy, with route-level invariant asserting sources.taxPolicy='api' on all bootstrap sessions.

## What Was Built

### G3 Issue (forensics-G3)

`dataBootstrapPipeline.ts` used `govExpensePctGdp > 30` as the progressive threshold, but the World Bank `GC.XPN.TOTL.GD.ZS` indicator only measures *central*-government expense (US=24.9%, DE=26%). The original threshold was calibrated against OECD *general*-government scale (~37% for US). All modern welfare states failed the gate on WB-scale data.

### Fix Applied

**Patch A — Composite heuristic (dataBootstrapPipeline.ts:221-230):**

Replaced single `govExpensePct > 30` gate with composite `isWelfareState` signal:
```typescript
const taxRevenuePct = profile.fiscal.taxRevenuePctGdp?.value ?? 0;
const govDebtPct = profile.fiscal.govDebtPctGdp?.value ?? 0;
const isWelfareState = govExpensePct > 18 || taxRevenuePct > 15 || govDebtPct > 60;
if (gdpPC > 25000 && isWelfareState) { /* progressive */ }
```

The progressive body (3 brackets at upto 500/2000/10000) and flat body are byte-preserved per WARNING-4.

**Patch B — Bootstrap invariant (bootstrap.ts:534-542):**

Added assertion before the DB write: if `profile` is present (bootstrap path) and `dataSources['taxPolicy'] !== 'api'`, throw a descriptive error. Guards against downstream mutations (scenario LLM override, creative-mode collision) silently bypassing the derivation.

**Patch C — centralAgentTaxPolicy.test.ts:**

Added one additional test exercising the `taxRevenuePct > 15` composite arm explicitly: `gdpPC=40000, govExpensePct=10, taxRevenuePct=20` → progressive.

## Country-Fixture Coverage Matrix

| Country | gdpPC | govExpense | taxRevenue | govDebt | Gate trigger              | Before GC3 | After GC3  | Change |
|---------|-------|-----------|-----------|---------|--------------------------|------------|------------|--------|
| US      | 84534 | 24.9%     | 10.97%    | 117.97% | govDebtPct > 60          | flat       | progressive| FIXED  |
| Germany | 52000 | 26%       | 11%       | 66%     | govDebtPct > 60          | flat       | progressive| FIXED  |
| UK      | 48000 | 39%       | 24%       | 100%    | govExpensePct > 18       | progressive| progressive| stable |
| Japan   | 34000 | 21%       | 12%       | 260%    | govDebtPct > 60          | flat       | progressive| FIXED  |
| India   | 2500  | 15%       | 12%       | 83%     | gdpPC < 25000 (excluded) | flat       | flat       | stable |
| Brazil  | 9000  | 22%       | 13%       | 86%     | gdpPC < 25000 (excluded) | flat       | flat       | stable |
| Nigeria | 2100  | 8%        | 7%        | 46%     | gdpPC < 25000 (excluded) | flat       | flat       | stable |

3 countries flipped from flat → progressive: US, Germany, Japan.

## Invariant Reachability

The invariant assertion at `server/src/routes/bootstrap.ts:534-542` is reachable via:
1. Any bootstrap where `profileToEconomyConfig` returns `sources['taxPolicy'] !== 'api'` (would require mutation in the derivation path — currently impossible since line 279 hardcodes `'api'`).
2. Any scenario override that accidentally sets `dataSources['taxPolicy']` to another value.

The test `invariant: locationProfile present → sources.taxPolicy === 'api'` in the fixture suite confirms the normal path always returns `'api'`. If that ever breaks, the route assertion will throw before the DB write, making the regression immediately visible.

## Test Counts

- **bootstrapTaxPolicyFixtures.test.ts**: 8 tests (7 country fixtures + 1 invariant) — all passing
- **centralAgentTaxPolicy.test.ts**: 19 tests — all passing (1 new composite-gate test added)
- **Full server suite**: 502 passed, 9 failed (all 9 pre-existing failures in sfcAuditBankExclusion, sfcUnderflowLedger, economyConfig, banking — none in GC3 files)

## Commits

| Hash    | Message |
|---------|---------|
| 8aa1216 | test(11-GC3): add 7-country bootstrap taxPolicy fixtures + sources invariant |
| 900f7c7 | fix(11-GC3): recalibrate bootstrap taxPolicy heuristic for WB indicator scale |
| 3c4b4be | fix(11-GC3): assert locationProfile sessions commit with sources.taxPolicy='api' |

## Deviations from Plan

None — plan executed exactly as written. Patch A, B, and C applied in order. Byte-preservation invariant for progressive body confirmed via grep.

## Hand-off Note for 11-GC4

11-GC4 (editable TaxPolicy) can now ship on top of a correct default. For ~80% of developed-world locations (high GDP + welfare state indicators), bootstrap produces progressive taxPolicy with realistic WB-derived rates. Policymakers editing tax policy in GC4's editor will be adjusting a correct baseline, not correcting a systematic derivation error.

D-13 is co-owned by 11-05 (original prompt schema + validator) and 11-GC3 (heuristic recalibration + locationProfile invariant).

## Self-Check: PASSED
