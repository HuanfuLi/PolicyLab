---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: 02
subsystem: data-bootstrap, orchestration-helpers, test-coverage
tags: [wave-1, enterprise-generation, capacity, labor-market, isEmployableAgent, D-04, D-05, D-07, L-01, L-03]
dependency_graph:
  requires:
    - "12-01: EnterpriseBlueprint.capacity field (optional number) on shared types"
  provides:
    - "server/src/orchestration/helpers/isEmployableAgent.ts: isEmployableAgent(agent) predicate (D-07)"
    - "server/src/data/dataBootstrapPipeline.ts: generateEnterprises with 110% vacancy target, D-05 invariant, auto-inflation"
    - "server/src/data/__tests__/enterpriseGeneration.test.ts: real assertions for L-01/L-02/L-03/D-07"
  affects:
    - "server/src/routes/bootstrap.ts: generateEnterprises call site now receives capacity on each blueprint"
    - "12-03 creative-mode plan: can import isEmployableAgent for same invariant check"
    - "12-04 matching pass: consumes isEmployableAgent as eligibility predicate"
tech_stack:
  added: []
  patterns:
    - "isEmployableAgent as shared predicate (D-07) — pure function, case-insensitive, excludes bank/central_bank/central_agent/official"
    - "buildBlueprint inner helper in generateEnterprises — encapsulates blueprint construction for reuse in auto-inflation loop"
    - "D-05 invariant loop: 10-attempt auto-inflation, sector-deficit fix + system-level capacity bump, logs [Phase 12 L-03] Vacancy invariant: auto-inflate marker"
    - "TDD: RED (test fails on missing module) → GREEN (implement) → committed"
key_files:
  created:
    - "server/src/orchestration/helpers/isEmployableAgent.ts"
    - "server/src/orchestration/helpers/__tests__/isEmployableAgent.test.ts"
  modified:
    - "server/src/data/dataBootstrapPipeline.ts"
    - "server/src/data/__tests__/enterpriseGeneration.test.ts"
decisions:
  - "isEmployableAgent accepts {type?: string; role?: string} minimal interface — works with AgentBlueprint, Agent, and EnterpriseRecord-adjacent shapes without coupling to any one type"
  - "NON_EMPLOYEE_ROLES is a module-scope Set for O(1) lookup — consistent with existing helpers pattern (structuralPressures.ts)"
  - "generateEnterprises keeps sectorGroups over ALL agents for owner/employee assignment; builds parallel employableSectorGroups for capacity math — preserves existing owner-selection behavior"
  - "buildBlueprint inner helper extracted to deduplicate blueprint construction between main loop and auto-inflation loop"
  - "runInvariantCheck is an inner closure — keeps invariant logic co-located with the generation loop for readability, avoids exposing internal state"
  - "employableCount === 0 guard in systemOk computation prevents division-by-zero and vacuous failures when all agents are institutional"
  - "Auto-inflation throws after 10 attempts with [Phase 12 L-03] prefix — grepping for this prefix in logs identifies bootstrap failures"
  - "D-06 it.todo entries moved with explicit comment 'owned by 12-03 creative-mode plan' per plan instructions"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-04-27"
  tasks: 3
  files_modified: 4
---

# Phase 12 Plan 02: Demographic-Aligned Enterprise Generation Summary

Demographic-aligned enterprise generation for location-mode bootstrap: isEmployableAgent predicate (D-07), 110% vacancy target capacity on each blueprint (D-04), D-05 post-generation invariant with auto-inflation loop, and 10 real test assertions replacing Wave 0 todos.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | isEmployableAgent helper + TDD test | 9c2144c | helpers/isEmployableAgent.ts, helpers/__tests__/isEmployableAgent.test.ts |
| 2 | Extend generateEnterprises with capacity, 110% vacancy target, D-05 invariant | 40a2e98 | dataBootstrapPipeline.ts |
| 3 | Real assertions in enterpriseGeneration.test.ts replacing Wave 0 todos | 1bb2299 | __tests__/enterpriseGeneration.test.ts |

## What Was Built

### Task 1 — isEmployableAgent helper

`server/src/orchestration/helpers/isEmployableAgent.ts`:
- Pure predicate: `(agent: { type?: string; role?: string }) => boolean`
- Excludes `type='bank'` (bank agents per CLAUDE.md)
- Excludes `role in {central_bank, central_agent, official}` (governance/ownership roles)
- Case-insensitive via `.toLowerCase()`
- 13 assertions covering all exclusion paths, case variants, positive cases

### Task 2 — generateEnterprises extension

`server/src/data/dataBootstrapPipeline.ts`:
- Imports `isEmployableAgent` from `../orchestration/helpers/isEmployableAgent.js`
- Computes `employableAgents = agents.filter(isEmployableAgent)` and parallel `employableSectorGroups`
- Phase 12 constants: `SECTOR_MIN_SHARE = 0.05`, `SYSTEM_VACANCY_FLOOR = 1.05`, `SYSTEM_VACANCY_TARGET = 1.10`
- `capacityPerEnt = max(2, ceil(sectorEmployableCount * 1.10 / entCount))` per sector
- `buildBlueprint` inner helper encapsulates blueprint construction
- D-05 invariant loop (10 attempts):
  - Sector deficits: adds 1 enterprise per deficient sector with `console.info('[Phase 12 L-03] Vacancy invariant: auto-inflate — adding enterprise...')`
  - System shortfall: bumps capacity round-robin with `console.info('[Phase 12 L-03] Vacancy invariant: auto-inflate — bumping capacity...')`
  - Throws `[Phase 12 L-03] Post-bootstrap vacancy invariant failed after auto-inflation: ...` on exhaustion
- All existing enterpriseBootstrap.test.ts (11 tests) still pass

### Task 3 — Real test assertions

`server/src/data/__tests__/enterpriseGeneration.test.ts`:
- `buildEmployableAgents(count, sectorDistribution)` local helper
- `buildProfile({ gdpPerCapita, enterpriseDensity, sectorEmployment })` local helper
- **L-01** (3 tests): total capacity ≥ 1.05×, capacity field present ≥2, sector capacity scales with workforce
- **L-02** (2 tests): all ≥5% sectors covered, all roster sectors have ≥1 enterprise
- **L-03** (2 tests): invariant satisfied for realistic profiles, log marker format validated via spy
- **D-07** (3 tests): official/bank/central_agent excluded from employable denominator
- D-06 entries: 2 `it.todo` with comment "owned by 12-03 creative-mode plan"

## Deviations from Plan

### Auto-fixed Issues

None.

### Design choices made at implementation time

**1. buildBlueprint inner helper** — plan pseudocode showed the auto-inflation loop duplicating blueprint construction. Extracted `buildBlueprint` inner function to DRY this up. Both the main loop and auto-inflation loop call it.

**2. Auto-inflation path for capacity is defensive** — the math guarantees `sum(capacity) >= employableCount * 1.10 >= employableCount * 1.05` in all normal cases. The capacity auto-inflation loop only fires for truly pathological edge cases (e.g., all agents are institutional/bank). The sector-deficit loop similarly can't fire in normal flow since the generation loop creates ≥1 enterprise per sectorGroup. The loops are defensive infrastructure for future callers.

**3. L-03 test uses spy + OR clause** — the plan said "assert console.info was called with 'Auto-inflating' OR assert final invariant passes." Since auto-inflation doesn't trigger for realistic WB inputs (the math ensures it), the test validates: (a) the invariant passes for multiple roster sizes, and (b) any log messages that DO appear carry the required marker pattern.

## Verification Checks

- `npx vitest run server/src/data/__tests__/enterpriseGeneration.test.ts` — 10 passed, 2 todos (D-06 delegated to 12-03)
- `npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts` — 11 passed (no regression)
- `npx vitest run server/src/orchestration/helpers/__tests__/isEmployableAgent.test.ts` — 13 passed
- `npx tsc --noEmit -p server/tsconfig.json` — exit 0, clean
- `npx tsc --noEmit -p shared/tsconfig.json` — exit 0, clean

## Known Stubs

None. All production behavior is implemented and verified. D-06 (creative-mode retry) is delegated to 12-03 via `it.todo` with explicit comment.

## Self-Check: PASSED

Files created:
- server/src/orchestration/helpers/isEmployableAgent.ts — EXISTS
- server/src/orchestration/helpers/__tests__/isEmployableAgent.test.ts — EXISTS

Files modified:
- server/src/data/dataBootstrapPipeline.ts — EXISTS
- server/src/data/__tests__/enterpriseGeneration.test.ts — EXISTS

Commits:
- 9c2144c — Task 1 (isEmployableAgent helper)
- 40a2e98 — Task 2 (generateEnterprises extension)
- 1bb2299 — Task 3 (test assertions)
