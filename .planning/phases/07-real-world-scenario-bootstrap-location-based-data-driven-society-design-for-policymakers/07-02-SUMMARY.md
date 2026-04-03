---
phase: 07-real-world-scenario-bootstrap
plan: 02
subsystem: bootstrap-pipeline
tags: [location-data-service, bootstrap-pipeline, sse-route, llm-prompts, economy-config]
dependency_graph:
  requires: [LocationProfile, worldBankApi, photonGeocoder, locationCache, giniDistribution, indicatorMap]
  provides: [fetchLocationData, profileToEconomyConfig, generateAgentRoster, generateLawPromptContext, bootstrapRoute, locationSearchRoute, buildLocationAgentRosterMessages, buildLocationLawMessages, buildScenarioInterpretationMessages]
  affects: [server/src/index.ts, server/src/llm/prompts.ts]
tech_stack:
  added: []
  patterns: [SSE-streaming, data-pipeline-orchestration, rate-conversion, fallback-profiles]
key_files:
  created:
    - server/src/data/locationDataService.ts
    - server/src/data/dataBootstrapPipeline.ts
    - server/src/routes/bootstrap.ts
    - server/src/data/__tests__/dataBootstrapPipeline.test.ts
  modified:
    - server/src/llm/prompts.ts
    - server/src/index.ts
decisions:
  - "Annual rates from World Bank divided by 12 (ITERATIONS_PER_YEAR) for per-iteration conversion"
  - "Gini from World Bank (0-100 scale) divided by 100 before passing to distributeWealth (0-1 scale)"
  - "Budget allocation: military->defense, health->welfare, education->education, infrastructure estimated as 30% of known total"
  - "Industry agents receive wealthiest slots, agriculture agents receive lowest — reflects real wealth distribution patterns"
  - "Bootstrap route mounted at both /api/sessions and /api paths for :id/bootstrap and /locations/search respectively"
metrics:
  duration_seconds: 396
  completed: "2026-04-03T02:35:25Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 2
  tests_added: 7
  tests_total_passing: 25
requirements:
  - RWB-04
  - RWB-05
---

# Phase 07 Plan 02: Bootstrap Pipeline + SSE Route Summary

Server-side bootstrap pipeline: location data orchestrator fetching all World Bank data categories, data-to-simulation converter mapping real indicators to EconomyConfig + agent roster + law context, and SSE bootstrap route streaming progress with heartbeat and fallback handling.

## What Was Built

### Location Data Service (locationDataService.ts)
- `fetchLocationData` orchestrates cache check, World Bank batch fetch for 4 categories (demographics, economics, fiscal, infrastructure), and profile assembly
- Each category uses `fetchIndicatorBatch` with codes from `indicatorMap.ts`
- Governance and infrastructure fields marked as LLM-sourced (filled by bootstrap route)
- Assembled profile cached via `setCachedProfile` for 30-day TTL reuse

### Data Bootstrap Pipeline (dataBootstrapPipeline.ts)
- `profileToEconomyConfig`: Maps LocationProfile to EconomyConfig with all four toggles enabled (banking, capital markets, fiscal, inflation). Annual interest rates divided by 12. Reserve requirement clamped to [0.03, 0.20]. Budget spending rate from government expense % GDP clamped to [0.05, 0.25]. Budget allocation normalized from military/health/education spending with infrastructure estimated as 30% of known total.
- `generateAgentRoster`: Sector counts proportional to employment data. Wealth distributed via Gini/100 scale through `distributeWealth`. Industry agents get wealthiest slots, agriculture gets lowest.
- `generateLawPromptContext`: Formats governance data for LLM prompt injection.

### Bootstrap SSE Route (bootstrap.ts)
- `POST /api/sessions/:id/bootstrap`: Full SSE pipeline with 6 steps (geocoding done, demographics, economics, governance, infrastructure, generation). Heartbeat every 10 seconds. LLM calls for governance summary, infrastructure summary, agent roster enrichment, law generation, and optional scenario interpretation. Persists economyConfig, budgetAllocation, locationProfile, agents, law, and society overview.
- `GET /api/locations/search?q=:query`: Geocoding autocomplete via Photon API returning name, country, countryCode, coordinates, type.
- Fallback profile created when World Bank data unavailable.

### LLM Prompts (prompts.ts additions)
- `buildLocationAgentRosterMessages`: Generates culturally appropriate agent names and backgrounds
- `buildLocationLawMessages`: Generates location-aware foundational law from governance context
- `buildScenarioInterpretationMessages`: Interprets policy scenario text into EconomyConfig parameter overrides

### Route Registration (index.ts)
- Bootstrap router mounted at `/api/sessions` (for /:id/bootstrap) and `/api` (for /locations/search)

## Tests

7 new tests in `dataBootstrapPipeline.test.ts`:
1. All four enabled toggles set to true
2. Annual interest rate 6% converted to per-iteration 0.005
3. Budget allocation fractions sum to 1.0
4. Confidence metadata keyed by parameter name
5. Missing realInterestRate falls back to 0.005
6. Sector employment proportional agent counts (30/40/30 -> 9/12/9)
7. Gini-distributed wealth with correct total and approximate coefficient

All 25 data layer tests passing (18 existing + 7 new).

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all data flows are wired to real implementations.

## Self-Check: PASSED

All 4 created files verified on disk. Both task commits (4fb049c, ecf15fe) found in git log.
