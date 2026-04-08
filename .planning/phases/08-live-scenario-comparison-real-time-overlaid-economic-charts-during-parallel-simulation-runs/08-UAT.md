---
status: testing
phase: 08-live-scenario-comparison
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md, 08-08-SUMMARY.md]
started: 2026-04-08T00:30:00Z
updated: 2026-04-08T00:30:00Z
---

## Current Test

number: 2
name: Home Page Grouped Sessions
expected: |
  On Home page, if any sessions share a groupId, they appear as a single card with a scenario count badge (e.g., "3 scenarios"). Ungrouped sessions appear normally as individual cards.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Run `npm run dev`. Server boots without errors, "Database migrations applied" appears, frontend loads at localhost:5173, Home page displays session list without errors.
result: pass

### 2. Home Page Grouped Sessions
expected: On Home page, if any sessions share a groupId, they appear as a single card with a scenario count badge (e.g., "3 scenarios"). Ungrouped sessions appear normally as individual cards.
result: [pending]

### 3. Scenario Builder — Run All Scenarios
expected: In Design Review for a location-bootstrapped session, add 2 scenario tabs with different economic parameters. Click "Run All Scenarios". You are navigated to the Simulation page with `?scenarios=id1,id2,id3` in the URL. Scenario tabs persist across page refresh.
result: [pending]

### 4. Multi-Scenario Simulation — Overlaid Charts
expected: On the Simulation page with multiple scenarios, the Statistics panel (Col 2) shows recharts LineCharts with multiple colored/dashed lines per chart — one per scenario. Shared crosshair tooltip shows all scenarios' values on hover. Live stat badges above each chart show latest values per scenario.
result: [pending]

### 5. Collapsible Panels
expected: Live Feed (Col 1) and Agent Status (Col 3) each have a collapse button. Clicking collapse shrinks the panel to a thin sidebar. When both are collapsed, the Statistics panel auto-expands to a 2-column chart grid.
result: [pending]

### 6. Multi-Progress Bars
expected: Top bar shows one progress bar per scenario, each in its scenario's color. Pause/Resume/Abort buttons affect ALL scenarios simultaneously.
result: [pending]

### 7. Config Diff Header
expected: Above the charts, a collapsible config diff header shows which EconomyConfig parameters differ across scenarios with values per scenario.
result: [pending]

### 8. Scenario Tabs in Side Panels
expected: In multi-scenario mode, Live Feed and Agent Status panels have tabs (Baseline | A | B) to switch which scenario's narrative/agents are displayed.
result: [pending]

### 9. View Full Comparison Button
expected: After ALL scenarios finish, a "View Full Comparison" button appears linking to the Phase 6 comparison page.
result: [pending]

### 10. N=1 Backward Compatibility
expected: Create and run a single session (no scenarios). The Simulation page shows the same enhanced layout with one blue line per chart. No crashes, no scenario-specific UI elements (no legend, no config diff, no scenario tabs).
result: [pending]

### 11. TelemetryPanel Classic Only
expected: Opening the TelemetryPanel modal shows only the Classic tab (SVG charts). The Economic tab has been removed (that data is now inline in the Statistics panel).
result: [pending]

### 12. Reflection — Cross-Scenario Summary
expected: After multi-scenario simulation, proceeding to Reflection shows side-by-side society evaluations. A cross-scenario data table at top with LLM-generated narrative comparing outcomes. Per-agent comparison cards with scenario-colored borders.
result: [pending]

### 13. Agent Review — Cross-Scenario Chat
expected: On the Review page after multi-scenario simulation, chatting with an agent allows cross-scenario questions (e.g., "How did you fare under Policy A vs Baseline?"). Agent responds with awareness of different scenarios.
result: [pending]

### 14. Artifacts — Policy Brief
expected: On the Artifacts page after multi-scenario simulation, there are per-scenario export options AND a "Generate Policy Brief" button. Clicking it produces a combined markdown policy brief with executive summary, scenario comparison table, key findings, and policy recommendations.
result: [pending]

### 15. Add Scenario to Existing Group
expected: After completing a multi-scenario run, return to the base session's Design Review. Add a new scenario tab. Click "Run All Scenarios". Only the new scenario runs (existing completed scenarios keep their results). The new scenario appears in the charts alongside the old ones.
result: [pending]

## Summary

total: 15
passed: 0
issues: 0
pending: 15
skipped: 0
blocked: 0

## Gaps

[none yet]
