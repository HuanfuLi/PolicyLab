---
phase: 08-live-scenario-comparison
plan: 05
subsystem: ui
tags: [react, recharts, zustand, multi-scenario, sse, collapsible-panels]

requires:
  - phase: 08-03
    provides: multiScenarioStore for N concurrent SSE streams
  - phase: 08-04
    provides: ScenarioChart, CollapsiblePanel, ConfigDiffHeader, ScenarioProgressBar components
provides:
  - Multi-scenario Simulation page with overlaid economic charts
  - URL-based scenario group routing (?scenarios=id1,id2,id3)
  - Collapsible side panels with auto-expanding 2-column chart grid
  - DesignReview navigation wiring for parallel scenario launch
affects: [08-06, 08-07, 08-08, comparison-page]

tech-stack:
  added: []
  patterns:
    - "URL-based scenario group passing via ?scenarios query param"
    - "Multi-store pattern: multiScenarioStore for N scenarios + legacy simulationStore for intent history"
    - "Collapsible panel layout with bothCollapsed auto-grid"

key-files:
  created: []
  modified:
    - web/src/pages/Simulation.tsx
    - web/src/pages/DesignReview.tsx
    - web/src/stores/scenarioStore.ts

key-decisions:
  - "URL route uses /session/:id/simulation?scenarios= matching App.tsx pattern, not /sessions/:id/simulate"
  - "Legacy simulationStore retained for intent history data; multiScenarioStore handles all SSE and scenario state"
  - "11 ScenarioChart instances cover CPI, Money Supply (M0+Fiat), M1, Gini, Wealth, Health, Happiness, Cortisol, Dopamine, Trust, Crime"

patterns-established:
  - "Multi-scenario URL routing: ?scenarios=comma-separated session IDs"
  - "N=1 backward compat: no ?scenarios param = single session group"

requirements-completed: [LSC-02, LSC-10]

duration: 12min
completed: 2026-04-07
---

# Phase 8 Plan 5: Simulation Page Rewrite Summary

**Multi-scenario live comparison dashboard with 11 overlaid charts, collapsible panels, per-scenario progress bars, and View Full Comparison CTA**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-08T03:23:43Z
- **Completed:** 2026-04-08T03:35:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Rewrote Simulation.tsx from 955-line single-session page to multi-scenario live comparison dashboard
- 11 ScenarioChart instances rendering CPI, money supply, inequality, agent stats, trust, and crime metrics
- Collapsible side panels with auto-expanding 2-column grid when both panels collapsed
- Per-scenario progress bars in top bar with global pause/resume/abort controls
- Scenario tabs in Live Feed and Agent Status panels for N>1
- ConfigDiffHeader showing economy config differences between scenarios
- View Full Comparison button appears after all scenarios complete (D-14, LSC-10)
- DesignReview Run All Scenarios now navigates to Simulation page with scenario query params

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite Simulation page with multi-scenario layout and inline charts** - `7250a7f` (feat)
2. **Task 2: Wire DesignReview Run All Scenarios to parallel launch navigation** - `5a546d7` (feat)

## Files Created/Modified
- `web/src/pages/Simulation.tsx` - Major rewrite: multi-scenario dashboard with ScenarioChart, CollapsiblePanel, ConfigDiffHeader, ScenarioProgressBar
- `web/src/pages/DesignReview.tsx` - Updated handleRunAllScenarios to pass navigate for automatic redirect
- `web/src/stores/scenarioStore.ts` - Fixed navigation URL to match App.tsx route pattern

## Decisions Made
- Used `/session/:id/simulation?scenarios=` route pattern matching existing App.tsx routes (was incorrectly `/sessions/:id/simulate` in Plan 03)
- Retained legacy simulationStore for agent intent history data alongside multiScenarioStore
- Bond yields chart omitted from D-25 order (nested object in TelemetryLog, not a simple field); replaced with Trust Index and Crime Rate which are top-level telemetry fields

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed navigation URL in scenarioStore**
- **Found during:** Task 2
- **Issue:** scenarioStore.runAllScenarios navigated to `/sessions/:id/simulate` which doesn't match App.tsx route `/session/:id/simulation`
- **Fix:** Changed URL pattern to `/session/${baseSessionId}/simulation?scenarios=`
- **Files modified:** web/src/stores/scenarioStore.ts
- **Verification:** TypeScript compiles, route pattern matches App.tsx
- **Committed in:** 5a546d7

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Route fix essential for navigation to work. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Simulation page fully wired for multi-scenario comparison
- Plans 06-08 can build on this for additional scenario management features
- Bond yields chart could be added in a future plan when TelemetryLog nested fields are supported by mergeScenarioData

## Self-Check: PASSED

- [x] web/src/pages/Simulation.tsx exists
- [x] web/src/pages/DesignReview.tsx exists
- [x] web/src/stores/scenarioStore.ts exists
- [x] Commit 7250a7f found
- [x] Commit 5a546d7 found

---
*Phase: 08-live-scenario-comparison*
*Completed: 2026-04-07*
