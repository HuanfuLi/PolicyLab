---
phase: 10-fix-simulation-realism
plan: 03
subsystem: data-bootstrap
tags: [enterprise, bootstrap, world-bank, location-mode, creative-mode]
dependency_graph:
  requires: ["10-01"]
  provides: ["generateEnterprises", "EnterpriseBlueprint type", "WB enterprise indicators"]
  affects: ["dataBootstrapPipeline", "indicatorMap", "locationDataService", "central-agent prompts", "bootstrap route"]
tech_stack:
  added: []
  patterns: ["sector-based enterprise grouping", "elite-owner assignment", "TDD red-green"]
key_files:
  created:
    - server/src/data/__tests__/enterpriseBootstrap.test.ts
  modified:
    - server/src/data/dataBootstrapPipeline.ts
    - server/src/data/indicatorMap.ts
    - server/src/data/locationDataService.ts
    - server/src/llm/prompts/central-agent.ts
    - server/src/llm/centralAgent.ts
    - server/src/routes/bootstrap.ts
    - shared/src/types.ts
decisions:
  - "Laborer agents can own enterprises when no elite/specialist exists in a sector (fallback to highest-wealth)"
  - "Enterprise IDs use sector abbreviation prefix: ent_agri_1, ent_indu_2, etc."
  - "Bootstrap aborts with SSE error event on LLM enrichment failure, no silent fallback to stubs"
metrics:
  duration_seconds: 388
  completed: "2026-04-08T20:12:51Z"
  tasks: 2
  files: 7
---

# Phase 10 Plan 03: Enterprise Bootstrap Summary

Enterprise auto-creation from WB data (location-mode) and LLM prompt (creative-mode), with bootstrap failure on enrichment error

## One-liner

generateEnterprises creates 1-3 enterprises per sector with elite owners, GDP-proportional capital, sector-mapped commodities, and WB enterprise density fallback; creative-mode roster prompt now outputs enterprises alongside agents; bootstrap aborts cleanly on LLM failure.

## What Was Done

### Task 1: WB enterprise indicators + generateEnterprises function (TDD)

- Added `IC.BUS.NDNS.ZS` (business density) and `IC.BUS.NREG` (new businesses) to `indicatorMap.ts`
- Added `enterpriseDensity` and `newBusinesses` optional DataPoint fields to `LocationProfile.economics` in `shared/src/types.ts`
- Added `EnterpriseBlueprint`, `EnterpriseSector`, `EnterpriseCommodity` types to `shared/src/types.ts`
- Wired new indicators into `locationDataService.ts` economics fetch group
- Implemented `generateEnterprises()` function in `dataBootstrapPipeline.ts`:
  - Groups agents by sector (agriculture, industry, services, government)
  - Uses WB enterprise density data when available, falls back to `ceil(sectorAgents/5)` clamped to [1,3]
  - Assigns elite/specialist agents as owners, falls back to highest-wealth when none available
  - Capital = GDP per capita * 0.3 per enterprise
  - Sector-to-commodity mapping: agriculture->food, industry->tools, services->luxury_goods, government->none
  - Inventory seeded by sector type
  - Employees distributed round-robin across sector enterprises
  - Government enterprises marked as `isServiceEnterprise: true`
- 8 passing tests covering: sector creation, elite ownership preference, GDP capital, commodity mapping, fallback heuristic, government services, shape validation, wage floors

### Task 2: Creative-mode enterprise generation + bootstrap failure handling

- Added `enterprises` JSON output schema to creative-mode roster generation prompt in `central-agent.ts`
- Prompt instructs LLM to create 1-3 enterprises per economic sector with named owners and employees
- Updated `centralAgent.ts` response parsing to extract optional `enterprises` array
- Changed bootstrap.ts enrichment error handling: now sends SSE error event and aborts instead of silently using stub backgrounds

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | 12ef40e | test(10-03): add failing tests for enterprise bootstrap |
| 1 (GREEN) | bdbc946 | feat(10-03): add generateEnterprises function with WB indicators |
| 2 | b82f652 | feat(10-03): creative-mode enterprise generation + bootstrap failure handling |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adjusted elite-ownership test expectation**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test expected laborers never own enterprises, but agriculture sector has only laborer roles (farmer, ranch_hand, agricultural_technician). The plan spec says "If no eligible owner, use highest-wealth agent" which can be a laborer.
- **Fix:** Changed test to verify elite/specialist preference in sectors that have them (industry), rather than absolute laborer exclusion.
- **Files modified:** server/src/data/__tests__/enterpriseBootstrap.test.ts

## Pre-existing Issues

- `scenarioDataMerge.test.ts` fails with module resolution error (Missing "./scenarioDataMerge" specifier) -- pre-existing, unrelated to this plan's changes.

## Known Stubs

None -- all functions are fully implemented and wired.

## Self-Check: PASSED
