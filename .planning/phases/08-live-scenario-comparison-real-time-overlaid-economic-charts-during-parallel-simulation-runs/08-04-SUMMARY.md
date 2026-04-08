---
phase: 08-live-scenario-comparison-real-time-overlaid-economic-charts-during-parallel-simulation-runs
plan: 04
subsystem: ui
tags: [react, recharts, vitest, scenario-comparison, telemetry]
requires:
  - phase: 07-real-world-scenario-bootstrap
    provides: scenario tabs, baseline/scenario config structure, design-review scenario flow
provides:
  - reusable multi-scenario chart wrapper and stat badges
  - collapsible side-panel shell and per-scenario progress bar
  - collapsible config diff header for EconomyConfig overrides
  - classic-only telemetry modal with economic tab removed
affects: [phase-08-plan-05, simulation-page, telemetry-modal]
tech-stack:
  added: []
  patterns: [shared scenario-data merge utility, reusable multi-scenario chart primitives, classic-only telemetry modal]
key-files:
  created:
    - shared/src/scenarioDataMerge.ts
    - server/src/__tests__/scenarioDataMerge.test.ts
    - web/src/components/ScenarioChart.tsx
    - web/src/components/ScenarioStatBadge.tsx
    - web/src/components/CollapsiblePanel.tsx
    - web/src/components/ConfigDiffHeader.tsx
    - web/src/components/ScenarioProgressBar.tsx
  modified:
    - shared/package.json
    - web/src/components/TelemetryPanel.tsx
key-decisions:
  - "ScenarioChart owns its own scenario colors and dash arrays so Plan 05 can reuse it without store coupling."
  - "ConfigDiffHeader compares scalar EconomyConfig overrides against the first scenario as baseline and suppresses itself for single-scenario mode."
patterns-established:
  - "Shared chart data is flattened as field_label keys keyed by iterationNumber for recharts multi-series rendering."
  - "Telemetry modal now treats Classic charts as the only modal view; inline economic charts belong on the Simulation page."
requirements-completed: [LSC-01, LSC-11]
duration: 4 min
completed: 2026-04-07
---

# Phase 08 Plan 04: Reusable Multi-Scenario Chart Primitives Summary

**Reusable multi-scenario chart, config-diff, and panel-control components for the live comparison simulation layout**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-08T02:34:00Z
- **Completed:** 2026-04-08T02:37:58Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added a shared scenario-data merge utility with server-side coverage for flattening telemetry and iteration stats into recharts-friendly rows.
- Built reusable `ScenarioChart`, `ScenarioStatBadge`, `CollapsiblePanel`, `ConfigDiffHeader`, and `ScenarioProgressBar` components for Plan 05 to assemble.
- Removed the TelemetryPanel Economic tab and preserved the Classic SVG chart modal as the only telemetry modal view.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ScenarioChart, ScenarioStatBadge, and data merge utility** - `386a4b3` (feat)
2. **Task 2: Create CollapsiblePanel, ConfigDiffHeader, ScenarioProgressBar, and clean up TelemetryPanel** - `0c69112` (feat)

## Files Created/Modified
- `shared/src/scenarioDataMerge.ts` - Shared utility for merging telemetry/stat histories into flat multi-scenario chart rows.
- `server/src/__tests__/scenarioDataMerge.test.ts` - Vitest coverage for telemetry/stat merge behavior and sparse-iteration handling.
- `web/src/components/ScenarioChart.tsx` - Recharts wrapper for overlaid scenario lines, optional area/bar rendering, and stat badges.
- `web/src/components/ScenarioStatBadge.tsx` - Compact colored latest-value badge for per-scenario chart stats.
- `web/src/components/CollapsiblePanel.tsx` - Collapse/expand shell for side panels with left/right affordances.
- `web/src/components/ConfigDiffHeader.tsx` - Collapsible baseline-vs-scenario config diff table for scalar EconomyConfig changes.
- `web/src/components/ScenarioProgressBar.tsx` - Per-scenario progress bar with running/paused/complete/error states.
- `web/src/components/TelemetryPanel.tsx` - Classic-only telemetry modal after removing economic dashboard tab wiring.
- `shared/package.json` - Added `./scenarioDataMerge` export for cross-workspace consumption.

## Decisions Made
- Kept chart-series styling local to `ScenarioChart` so later page integration can use it without importing scenario-store internals.
- Limited config diff rendering to scalar `number | boolean` EconomyConfig values; nested objects stay out of this header until a dedicated formatter exists.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The plan’s suggested `vitest` command used `-x`, which this repository’s Vitest version does not support. Verification was rerun successfully without that flag.
- Initial sandboxed test execution hit a Windows `spawn EPERM`; rerunning the same test outside the sandbox passed cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 05 can now assemble the new Simulation page layout from the reusable chart, diff, collapse, and progress components created here.
- No known code blockers remain in the owned files for the next plan.

## Self-Check

PASSED - summary file exists, both task commits are present in git history, and the committed file lists match the intended task boundaries.

---
*Phase: 08-live-scenario-comparison-real-time-overlaid-economic-charts-during-parallel-simulation-runs*
*Completed: 2026-04-07*
