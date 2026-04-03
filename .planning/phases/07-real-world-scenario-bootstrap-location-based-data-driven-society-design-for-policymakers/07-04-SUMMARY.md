---
phase: 07-real-world-scenario-bootstrap
plan: 04
subsystem: scenario-builder-ui
tags: [scenario-tabs, diff-markers, scenario-store, design-review, economy-config]
dependency_graph:
  requires: [ScenarioTab, EconomyConfig, BudgetAllocation, LocationProfile, fork-endpoint, compare-route]
  provides: [useScenarioStore, ScenarioTabs, DiffMarker, DataConfidenceBadge, scenario-builder-in-design-review]
  affects: [web/src/pages/DesignReview.tsx]
tech_stack:
  added: []
  patterns: [zustand-store, delta-tracking, conditional-rendering, tab-based-ui]
key_files:
  created:
    - web/src/stores/scenarioStore.ts
    - web/src/components/ScenarioTabs.tsx
    - web/src/components/DiffMarker.tsx
    - web/src/components/DataConfidenceBadge.tsx
  modified:
    - web/src/pages/DesignReview.tsx
decisions:
  - "DataConfidenceBadge created as minimal stub since plan 07-03 (parallel wave 3) owns the richer version"
  - "runAllScenarios runs simulations sequentially per Research open question 3 (LLM cost management)"
  - "Multi-scenario comparison navigates to first pair for now; multi-compare enhancement deferred"
  - "Scenario deltas computed by comparing every EconomyConfig key between tab config and baseline"
metrics:
  duration_seconds: 296
  completed: "2026-04-01T20:25:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 1
requirements:
  - RWB-06
  - RWB-07
---

# Phase 07 Plan 04: Scenario Builder UI Summary

Tab-based multi-scenario builder on Design Review with inline diff markers, Zustand store for scenario management, and Run All Scenarios parallel execution with auto-comparison navigation.

## What Was Built

### Scenario Store (scenarioStore.ts)
- `useScenarioStore` Zustand store managing multi-scenario tab state
- `initFromSession`: creates Baseline tab from session's current EconomyConfig and BudgetAllocation
- `addScenario`: clones baseline config into new tab with auto-generated letter names (A, B, C...)
- `updateScenarioConfig`: patches tab config and auto-computes deltas by comparing each key to baselineConfig
- `runAllScenarios`: forks session for each non-baseline tab, patches config, starts simulations sequentially, returns fork IDs for comparison navigation
- `removeScenario`, `renameScenario`, `setActiveTab`, `updateScenarioBudget`, `reset` for full tab lifecycle

### DiffMarker (DiffMarker.tsx)
- Inline diff display component showing baseline vs current value
- Renders nothing when values are equal (no visual noise)
- Numeric values show signed delta: (+0.05) in yellow, (-0.02) in blue
- Non-numeric values show simple before/after text

### ScenarioTabs (ScenarioTabs.tsx)
- Tab bar with Baseline always first (cannot be removed)
- "+ Add Scenario" button appends new tabs cloned from baseline
- Non-baseline tabs have X close button and double-click-to-rename
- Delta count badge on tabs with modified parameters
- Diff summary panel above EconomyTab showing all changed parameters with DiffMarker
- "Run All Scenarios" button disabled when only baseline exists or when running
- Spinner state during scenario execution

### DataConfidenceBadge (DataConfidenceBadge.tsx)
- Minimal confidence badge showing colored dot + level text (high/medium/low)
- Tooltip with source info on hover
- Created as stub; plan 07-03 provides the richer version

### DesignReview Integration (DesignReview.tsx)
- Detects location-bootstrapped sessions via `session.config.locationProfile`
- Location sessions: Economy tab renders ScenarioTabs instead of plain EconomyTab
- Non-location sessions: Economy tab unchanged (plain EconomyTab)
- Run All Scenarios handler: forks, simulates, navigates to `/session/:id/compare/:forkId`
- Scenario store reset on session change to prevent stale tab state

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created DataConfidenceBadge stub**
- **Found during:** Task 2
- **Issue:** Plan references DataConfidenceBadge component which is owned by parallel plan 07-03 (wave 3) and doesn't exist yet
- **Fix:** Created minimal DataConfidenceBadge.tsx with confidence dot + text display
- **Files created:** web/src/components/DataConfidenceBadge.tsx
- **Commit:** 82f95d3

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 534400e | ScenarioStore, DiffMarker, and ScenarioTabs components |
| 2 | 82f95d3 | Wire ScenarioTabs into DesignReview for location sessions |

## Verification

- `npm run build -w shared` passes
- `npm run build -w web` passes (Vite build successful)
- No new lint errors introduced (pre-existing lint errors remain)
- Server build has pre-existing type errors unrelated to this plan

## Known Stubs

None that block the plan's goal. DataConfidenceBadge is intentionally minimal and will be enhanced by plan 07-03.

## Self-Check: PASSED

- All 5 files verified present on disk
- Both commits (534400e, 82f95d3) verified in git log
