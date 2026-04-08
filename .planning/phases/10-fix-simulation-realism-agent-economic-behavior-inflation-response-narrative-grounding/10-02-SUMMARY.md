---
phase: 10-fix-simulation-realism
plan: 02
subsystem: enterprise-engine
tags: [enterprise, wages, insolvency, idle-fallback, production, cost-pass-through]
dependency_graph:
  requires: ["10-01"]
  provides: ["enterpriseEngine delta-return module"]
  affects: ["simulationRunner (Plan 04 wiring)"]
tech_stack:
  added: []
  patterns: ["delta-return (matching bankingEngine/capitalMarketEngine)"]
key_files:
  created:
    - server/src/mechanics/enterpriseEngine.ts
    - server/src/mechanics/__tests__/enterpriseEngine.test.ts
  modified:
    - shared/src/types.ts
decisions:
  - "Enterprise engine follows delta-return pattern (no DB imports) matching bankingEngine and capitalMarketEngine"
  - "Industry sector produces secondary raw_materials at 50% of primary tools output"
  - "Idle fallback subsistence food production is outside SFC perimeter (creates food from nothing)"
  - "Cost pass-through at 50% rate: enterprises absorb half of wage cost increases"
metrics:
  duration_seconds: 168
  completed: "2026-04-08T20:09:14Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 1
  test_count: 16
  test_pass: 16
---

# Phase 10 Plan 02: Enterprise Engine Summary

Pure deterministic enterprise engine with delta-return pattern: wage payments with minimum wage floor, insolvency tracking with configurable bankruptcy threshold, idle agent subsistence fallback, sector-to-commodity production mapping with industry secondary output, and 50% cost pass-through pricing.

## Task Completion

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for enterprise engine | a21f038 | enterpriseEngine.test.ts, types.ts |
| 1 (GREEN) | Implement enterprise engine | a657f8a | enterpriseEngine.ts |

## What Was Built

### Enterprise Engine (`server/src/mechanics/enterpriseEngine.ts`)

New pure deterministic module with 5 exported functions and 3 exported interfaces, following the delta-return pattern (zero DB imports):

1. **sectorToCommodity** - Maps 4 enterprise sectors to commodity types (agriculture->food, industry->tools, services->luxury_goods, government->none)
2. **processEnterpriseWages** - Pays workers with minimum wage enforcement, pro-rata partial pay when treasury insufficient, insolvency counter tracking
3. **processEnterpriseInsolvency** - Triggers bankruptcy after configurable consecutive deficit iterations (default 3)
4. **processIdleFallback** - Forces subsistence food production for agents idle beyond threshold (default 2 iterations)
5. **processEnterpriseProduction** - Maps enterprises to commodity output with industry secondary raw_materials at 50%
6. **processEnterpriseCostPassThrough** - Computes sell price markup when wage costs rise (50% pass-through rate)

### Types Added (`shared/src/types.ts`)

- `EnterpriseSector` type: 'agriculture' | 'industry' | 'services' | 'government'
- `EnterpriseCommodity` type: 'food' | 'tools' | 'raw_materials' | 'luxury_goods' | 'none'
- EconomyConfig fields: `minimumWage`, `enterpriseInsolvencyThreshold`, `idleFallbackProduction`, `idleFallbackThreshold`

### Tests (`server/src/mechanics/__tests__/enterpriseEngine.test.ts`)

16 assertions across 6 describe blocks covering all behaviors. Full server suite: 177/177 green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added EnterpriseSector/EnterpriseCommodity types to shared/src/types.ts**
- **Found during:** Task 1 setup
- **Issue:** Plan 01 (wave 1 dependency) adds these types but runs in parallel; types not yet present
- **Fix:** Added types and EconomyConfig enterprise fields directly in this plan
- **Files modified:** shared/src/types.ts
- **Commit:** a21f038

## Known Stubs

None - all functions are fully implemented with real logic.

## Verification Results

- `npx vitest run server/src/mechanics/__tests__/enterpriseEngine.test.ts` - 16/16 pass
- `npm run test -w server -- --run` - 177/177 pass (no regressions)
- `grep -c "import.*db" server/src/mechanics/enterpriseEngine.ts` - 0 (no DB imports)
- 5 exported functions + 3 exported types confirmed

## Self-Check: PASSED
