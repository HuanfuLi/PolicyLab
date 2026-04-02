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
duration: 12min + checkpoint verification cycle
completed: "2026-04-02"
---

# Phase 06 Plan 03: Comparison Prompt Expansion + Config Diff UI Summary

**8-dimension LLM comparison prompt with economic telemetry injection, ConfigDiffSection table with session-title headers, and fork button relabeled for A/B policy workflow — end-to-end verified**

## Performance

- **Duration:** 12 min (tasks 1-2) + checkpoint verification cycle
- **Started:** 2026-04-01T13:20:00Z
- **Completed:** 2026-04-02T17:45:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify — approved)
- **Files modified:** 3

## Accomplishments

- Extended `SessionSummaryInput` with 7 optional economic telemetry fields and updated `buildComparisonMessages` to request 8 dimensions and inject available telemetry
- Added `ConfigDiffSection` React component to `CompareSessions.tsx` that renders a parameter diff table with actual session titles as column headers, placed before the dimension rows
- Updated fork button label from "Fork & Simulate" to "Fork & Change Policy" to communicate the A/B experiment workflow intent (D-02)
- Post-checkpoint verification approved; 3 issues identified and fixed: tooltip theme-aware CSS vars, duplicate Fiscal Policy section removed, disabled sections made clickable to enable

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand comparison prompt to 8 dimensions with economic telemetry** - `4dd1e1d` (feat)
2. **Task 2: Add Configuration Differences section to comparison UI and update fork button** - `47617a4` (feat)
3. **Task 3: Post-checkpoint verification fixes** - `0c0b525` (fix — tooltip CSS vars, duplicate section, disabled section UX)

**Plan metadata (prior):** `de0a98b` (docs: complete plan — pre-verification)

## Files Created/Modified

- `server/src/llm/prompts.ts` — Extended `SessionSummaryInput` with optional telemetry fields; updated system prompt to 8 dimensions; updated `fmt` function to append economic telemetry line; updated JSON template with 8 dimension objects
- `web/src/pages/CompareSessions.tsx` — Added `EconomyParamDiff` import; added `ConfigDiffSection` component; added conditional rendering of diff section before dimension rows
- `web/src/pages/DesignReview.tsx` — Updated fork button label to "Fork & Change Policy"

## Decisions Made

- SessionSummaryInput telemetry fields are all optional — sessions without economic config or iterations still produce valid comparison prompts, just without the telemetry section
- ConfigDiffSection placed before dimension rows — user sees what changed before seeing how outcomes differed, reinforcing A/B causality
- compare.ts passes full summary objects to buildComparisonMessages (no destructuring) — extended SessionSummaryInput consumes new fields automatically without requiring changes to compare.ts

## Deviations from Plan

### Auto-fixed Issues (Post-Checkpoint Verification)

**1. [Rule 1 - Bug] Tooltip used hardcoded hex color instead of theme-aware CSS var**
- **Found during:** Task 3 (human checkpoint verification)
- **Issue:** Tooltip background used hardcoded hex (`#1a1a2e`), breaking dark-mode theme consistency
- **Fix:** Replaced with `var(--panel-bg)` and related CSS vars from the existing design system
- **Files modified:** `web/src/pages/DesignReview.tsx`
- **Verification:** Visual inspection confirmed theme consistency
- **Committed in:** `0c0b525`

**2. [Rule 1 - Bug] Duplicate Fiscal Policy section appeared in DesignReview Economy tab**
- **Found during:** Task 3 (human checkpoint verification)
- **Issue:** Fiscal Policy configuration panel was rendered twice in the Economy tab
- **Fix:** Removed the duplicate JSX block
- **Files modified:** `web/src/pages/DesignReview.tsx`
- **Verification:** Visual inspection confirmed single Fiscal Policy section
- **Committed in:** `0c0b525`

**3. [Rule 2 - Missing Critical] Disabled sections (Capital Markets, Inflation) were not clickable to enable**
- **Found during:** Task 3 (human checkpoint verification)
- **Issue:** Disabled sections showed a locked appearance with no interaction affordance; users had no UI path to enable these features
- **Fix:** Made disabled section headers clickable; clicking shows an "Enable" affordance that activates the feature in `economyConfig` state
- **Files modified:** `web/src/pages/DesignReview.tsx`
- **Verification:** Clicking a disabled section now enables it and reveals controls
- **Committed in:** `0c0b525`

**4. [Intentional design] Fork button only shows after simulation (isPastDesign)**
- Fork button visibility is gated on `isPastDesign` — only appears after the source session has been simulated at least once.
- Confirmed as intended: forking makes sense only when there is a completed run to diverge from.
- No code change required; documented here for future reference.

---

**Total deviations:** 3 auto-fixed post-checkpoint (2 Rule 1 bugs, 1 Rule 2 missing critical UX)
**Impact on plan:** All fixes necessary for correctness and usability. No scope creep — fixes limited to files modified by this plan.

## Known Stubs

None — all data paths are wired. `economyParamDiffs` comes from the real `computeParamDiffs` deterministic diff; telemetry comes from real session iteration statistics. If sessions have no diff or no iterations, the ConfigDiffSection is simply not rendered (guarded by `length > 0`).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 06 (Scenario Entry) is fully complete. All 4 plans executed and end-to-end verified. Requirements D-02, D-08, D-09 are satisfied.

The full policymaker workflow is functional: Economy tab configuration → fork with config preservation → simulate → compare with 8-dimension scoring and configuration diff table.

Phase 4 (Inflation Loop) plans 02-03 and Phase 5 plan 02 (EconomicDashboard charts) remain pending. No blockers from this plan for downstream work.

---
*Phase: 06-scenario-entry*
*Completed: 2026-04-02*
