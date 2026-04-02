---
phase: 06-scenario-entry
plan: 03
subsystem: comparison-prompt, comparison-ui, design-review
tags: [llm-prompt, comparison, economy-config, param-diff, fork-ux]
dependency_graph:
  requires:
    - phase: 06-02
      provides: EconomyParamDiff type, economyParamDiffs on ComparisonResult, loadSessionSummary telemetry fields
  provides:
    - 8-dimension comparison prompt with Banking Stability, Fiscal Effectiveness, Economic Growth
    - economic telemetry (gini, m1, quality scores) in LLM comparison context
    - ConfigDiffSection UI component showing changed params with session-title column headers
    - Fork button relabeled to "Fork & Change Policy" for A/B experiment workflow
  affects:
    - server/src/llm/prompts.ts
    - web/src/pages/CompareSessions.tsx
    - web/src/pages/DesignReview.tsx
tech-stack:
  added: []
  patterns: [optional-telemetry-injection-in-prompts, conditional-ui-section-on-optional-data]
key-files:
  created: []
  modified:
    - server/src/llm/prompts.ts
    - web/src/pages/CompareSessions.tsx
    - web/src/pages/DesignReview.tsx
key-decisions:
  - "SessionSummaryInput telemetry fields are all optional — sessions without economic config or iterations still produce valid comparison prompts, just without the telemetry section"
  - "ConfigDiffSection placed before dimension rows — user sees what changed before seeing how outcomes differed, reinforcing A/B causality"
  - "compare.ts passes full summary objects to buildComparisonMessages (no destructuring) — extended SessionSummaryInput consumes new fields automatically without modifying compare.ts"
patterns-established:
  - "Prompt telemetry injection: build a string[] of available fields then append as one line if non-empty — avoids undefined text in prompts"
  - "Conditional UI sections: check both existence and length before rendering optional data tables"
requirements-completed:
  - D-09
  - D-02
duration: 12min
completed: "2026-04-01"
---

# Phase 06 Plan 03: Comparison Prompt Expansion + Config Diff UI Summary

**8-dimension LLM comparison prompt with economic telemetry injection, ConfigDiffSection table with session-title headers, and fork button relabeled for A/B policy workflow**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-01T13:20:00Z
- **Completed:** 2026-04-01T13:32:00Z
- **Tasks:** 2 (Task 3 is checkpoint — pending human verification)
- **Files modified:** 3

## Accomplishments

- Extended `SessionSummaryInput` with 7 optional economic telemetry fields and updated `buildComparisonMessages` to request 8 dimensions and inject available telemetry
- Added `ConfigDiffSection` React component to `CompareSessions.tsx` that renders a parameter diff table with actual session titles as column headers, placed before the dimension rows
- Updated fork button label from "Fork & Simulate" to "Fork & Change Policy" to communicate the A/B experiment workflow intent (D-02)

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand comparison prompt to 8 dimensions with economic telemetry** - `4dd1e1d` (feat)
2. **Task 2: Add Configuration Differences section to comparison UI and update fork button** - `47617a4` (feat)
3. **Task 3: Verify full scenario entry workflow** - checkpoint (pending human verification)

## Files Created/Modified

- `server/src/llm/prompts.ts` — Extended `SessionSummaryInput` with optional telemetry fields; updated system prompt to 8 dimensions; updated `fmt` function to append economic telemetry line; updated JSON template with 8 dimension objects
- `web/src/pages/CompareSessions.tsx` — Added `EconomyParamDiff` import; added `ConfigDiffSection` component; added conditional rendering of diff section before dimension rows
- `web/src/pages/DesignReview.tsx` — Updated fork button label to "Fork & Change Policy"

## Decisions Made

- SessionSummaryInput telemetry fields are all optional — sessions without economic config or iterations still produce valid comparison prompts, just without the telemetry section
- ConfigDiffSection placed before dimension rows — user sees what changed before seeing how outcomes differed, reinforcing A/B causality
- compare.ts passes full summary objects to buildComparisonMessages (no destructuring) — extended SessionSummaryInput consumes new fields automatically without requiring changes to compare.ts

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data paths are wired. `economyParamDiffs` comes from the real `computeParamDiffs` deterministic diff; telemetry comes from real session iteration statistics. If sessions have no diff or no iterations, the ConfigDiffSection is simply not rendered (guarded by `length > 0`).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 06 is now complete pending human verification of the full end-to-end flow (Task 3 checkpoint). Once verified, all D-02, D-08, D-09 requirements are satisfied.

---
*Phase: 06-scenario-entry*
*Completed: 2026-04-01*
