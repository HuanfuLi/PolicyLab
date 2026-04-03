---
phase: 07-real-world-scenario-bootstrap
plan: 03
subsystem: frontend-bootstrap-ui
tags: [frontend, react, zustand, sse, geocoding, ui]
dependency_graph:
  requires: [07-01, 07-02]
  provides: [bootstrap-ui, location-search, confidence-badge, bootstrap-store]
  affects: [web/src/pages/IdeaInput.tsx]
tech_stack:
  added: [LocationSearch, DataConfidenceBadge, bootstrapStore]
  patterns: [SSE-via-fetch-reader, zustand-domain-store, debounced-autocomplete]
key_files:
  created:
    - web/src/components/LocationSearch.tsx
    - web/src/components/DataConfidenceBadge.tsx
    - web/src/stores/bootstrapStore.ts
  modified:
    - web/src/pages/IdeaInput.tsx
decisions:
  - "IdeaInput uses null mode state for selection screen, 'creative' and 'location' as sub-modes"
  - "Bootstrap SSE uses fetch + ReadableStream reader (matching existing SSE patterns)"
  - "bootstrapStore creates session via sessionsStore.createSession before starting SSE"
metrics:
  duration_minutes: 4
  completed: "2026-04-03T02:41:42Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 07 Plan 03: Frontend Bootstrap UI Summary

Dual-mode IdeaInput page with location search autocomplete, bootstrap progress panel, and reusable DataConfidenceBadge component backed by a Zustand SSE store.

## What Was Built

### Task 1: LocationSearch + DataConfidenceBadge + bootstrapStore (578f69c)

**LocationSearch** (`web/src/components/LocationSearch.tsx`):
- Autocomplete input with 300ms debounce calling `GET /api/locations/search`
- Dropdown results show name, state, country with type badge (city/state/country)
- Blur-delay pattern to allow dropdown click before close
- Styled with project CSS variables

**DataConfidenceBadge** (`web/src/components/DataConfidenceBadge.tsx`):
- Inline badge with colored dot (green/yellow/red) for confidence level
- Source labels: API, Web, Estimate
- Hover tooltip for sourceNote

**bootstrapStore** (`web/src/stores/bootstrapStore.ts`):
- Zustand store tracking 6 bootstrap steps: geocoding, demographics, economics, governance, infrastructure, generation
- SSE via `fetch` + `ReadableStream.getReader()` + `TextDecoder` for progressive event parsing
- Handles step_start, step_done, step_fallback, complete, error events
- Manages selectedLocation, agentCount (default 50), scenario text

### Task 2: IdeaInput dual-mode UI (d575f19)

Modified `web/src/pages/IdeaInput.tsx`:
- **Mode selection screen**: Two cards — "Describe a Society" (Sparkles icon) and "Mirror a Real Location" (Globe icon)
- **Creative mode**: Existing textarea + presets + "Begin Brainstorming" button completely preserved
- **Location mode**: LocationSearch component, agent count slider (20-150) with numeric input, policy scenario textarea, "Begin Bootstrap" button
- **Progress panel**: Shows 6 steps with animated status icons (spinner/checkmark/warning/circle) and fallback source display
- **Error handling**: Error message with retry button
- **Navigation**: Auto-navigates to `/session/:id/design-review` on bootstrap complete
- Back links on all sub-modes return to mode selection

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npm run build -w web` passes (web workspace builds clean)
- `npm run lint -w web` has no new errors from this plan's files (pre-existing errors in other files unchanged)
- IdeaInput.tsx contains both mode cards, LocationSearch import, useBootstrapStore import
- Agent count input has min=20 max=150
- All 6 bootstrap steps tracked in progress panel
- Creative flow presets array and handleBegin function preserved

## Known Stubs

None - all components are wired to real API endpoints and store state.
