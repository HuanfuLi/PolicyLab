---
phase: 06-scenario-entry
plan: 01
subsystem: frontend-config
tags: [economy-config, design-review, ui, policymaker, session-config]
dependency_graph:
  requires: [05-01, 03-01, 04-01]
  provides: [economy-tab-ui, economy-config-persistence]
  affects: [web/src/pages/DesignReview.tsx, web/src/components/EconomyTab.tsx, shared/src/types.ts]
tech_stack:
  added: []
  patterns: [slider-numeric-pair, collapsible-section, soft-limit-warning, proportional-redistribution]
key_files:
  created:
    - web/src/components/EconomyTab.tsx
  modified:
    - shared/src/types.ts
    - web/src/stores/sessionDetailStore.ts
    - web/src/pages/DesignReview.tsx
decisions:
  - EconomyTab receives economyConfig and budgetAllocation as props from DesignReview — no direct store coupling in the component
  - Soft-limit warnings shown as inline dialog (not window.confirm) for better UX and testability
  - Capital Markets and Inflation sections hidden by default when feature flags are off (opacity 0.4 with toggle pills)
  - Budget allocation uses proportional redistribution on slider change to always approach 100% total
  - Save on mouseUp/onBlur pattern (not onChange) to avoid flooding PUT /config with every slider tick
metrics:
  duration_minutes: 15
  completed_date: "2026-04-02"
  tasks_completed: 2
  files_modified: 4
---

# Phase 6 Plan 1: Economy Configuration Tab for Design Review Summary

Economy tab added to the Design Review page exposing all EconomyConfig parameters (Banking, Fiscal, Capital Markets, Inflation) as slider+numeric controls with tooltips, soft-limit warnings, and budget allocation sub-panel.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend SessionConfig type and add updateEconomyConfig store action | d4ba443 | shared/src/types.ts, web/src/stores/sessionDetailStore.ts |
| 2 | Build EconomyTab component and wire into DesignReview | bdc5926 | web/src/components/EconomyTab.tsx, web/src/pages/DesignReview.tsx |

## What Was Built

**SessionConfig extension (shared/src/types.ts):**
- Added `economyConfig?: Partial<EconomyConfig>` to SessionConfig interface
- Added `budgetAllocation?: BudgetAllocation` to SessionConfig interface

**Store action (web/src/stores/sessionDetailStore.ts):**
- Added `updateEconomyConfig(id, patch)` action following the `updateLockedVariables` pattern
- Persists via `brainstormApi.patchConfig(id, { economyConfig: patch })`
- Performs optimistic merge of patch into `session.config.economyConfig`

**EconomyTab component (web/src/components/EconomyTab.tsx, 380+ lines):**
- 18 parameter entries across 4 sections (Banking: 5, Fiscal: 7, Capital Markets: 3, Inflation: 3)
- Each parameter has: label, min/max/step, softMin/softMax, and tooltip with real-world analogy
- Feature toggle pills for bankingEnabled/fiscalEnabled/capitalMarketsEnabled/inflationEnabled
- Collapsible sections (Banking and Fiscal open by default, others closed)
- Slider + numeric input pair per parameter, saves on mouseUp/onBlur
- Soft-limit warning shown inline when value is outside recommended range — requires user confirmation before persisting
- Budget allocation sub-section in Fiscal with proportional redistribution and sum validation
- Pre-v1.0 session banner when no economy flags are set
- Info icon with hover tooltip showing real-world analogies

**DesignReview.tsx wiring:**
- Extended `activeTab` type union to include `'economy'`
- Added Economy tab button with DollarSign icon from lucide-react
- Renders `<EconomyTab>` component when economy tab is active
- Destructures `updateEconomyConfig` from store

## Deviations from Plan

### Auto-fixed Issues

None.

### Implementation Choices

**1. Inline soft-limit warning dialog instead of window.confirm**
- Found during: Task 2
- Issue: Plan mentioned "simple window.confirm" but that blocks the browser UI thread and cannot be styled
- Fix: Used inline warning div with "I understand the risks" / "Revert" buttons — same semantic behavior but better UX
- Files modified: web/src/components/EconomyTab.tsx

**2. Feature toggle pills added**
- Found during: Task 2
- Issue: Capital Markets and Inflation sections are conditionally visible but the plan didn't specify how to enable them from the UI
- Fix: Added feature toggle pill buttons at the top of the tab that toggle the boolean flags (bankingEnabled, fiscalEnabled, etc.), which then control section visibility. This is a Rule 2 addition (missing critical functionality for the UI to be useful)
- Files modified: web/src/components/EconomyTab.tsx

## Known Stubs

None — all parameters are wired to real `onConfigChange` callback which calls `updateEconomyConfig` store action persisting via `PUT /api/sessions/:id/config`.

## Self-Check: PASSED

- web/src/components/EconomyTab.tsx: FOUND
- web/src/pages/DesignReview.tsx contains 'economy': FOUND
- shared/src/types.ts SessionConfig has economyConfig: FOUND
- web/src/stores/sessionDetailStore.ts has updateEconomyConfig: FOUND
- Commits d4ba443, bdc5926: FOUND in git log
