# Phase 5: Economic Dashboard - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Four real-time chart panels surface the economic telemetry produced by Phases 1-4: CPI trends, money supply dynamics (M1/M2), fiscal budget execution, and bond yields. Charts live inside the existing TelemetryPanel and update in real time during simulation runs.

</domain>

<decisions>
## Implementation Decisions

### Chart Placement & Navigation
- **D-01:** Economy charts go inside the existing TelemetryPanel (modal overlay), not inline on the Simulation page
- **D-02:** Layout is stacked vertical (full-width charts, like existing TelemetryPanel charts)
- **D-03:** The existing "Fiat Supply" chart (Chart 1A) is replaced by the M1/M2 area chart (which subsumes it). Other existing charts (Food Reserve, Spot Price, Thermodynamic, Gini, Trust/Crime, Psychology) remain
- **D-04:** Economy charts positioned at the top of the panel, above existing charts
- **D-05:** TelemetryPanel renamed to reflect expanded scope (e.g., "Simulation Dashboard" or "Economic Observatory" — Claude's discretion on exact name)

### Charting Library
- **D-06:** Install recharts for all chart rendering
- **D-07:** Migrate ALL existing SVGLineChart usages to recharts equivalents — unified charting system, no mixed approach
- **D-08:** Recharts charts themed to match current dark theme: dark background, existing --chart-* CSS color tokens, muted gridlines
- **D-09:** M1/M2 area chart uses stacked area bands: M0 as bottom band, M1 stacked above, M2 above that
- **D-10:** Fiscal budget chart uses grouped bars per category — each budget category (infrastructure, education, defense, welfare) as a bar group showing allocation amount + public goods quality score side by side
- **D-11:** CPI chart smoothed trend overlay uses simple moving average (N-iteration SMA, rendered as second line)
- **D-12:** Recharts tooltips on hover enabled for all charts (show exact values on hover)

### Real-Time Update Behavior
- **D-13:** Charts update by appending per iteration — each SSE iteration_complete event adds a new data point (same pattern as existing telemetry)
- **D-14:** Economy data fields extend the existing TelemetryLog type (add CPI, budget allocation, bond yields as optional fields). Same SSE pipeline, same storage
- **D-15:** During a live simulation, TelemetryPanel reads from simulationStore.statsHistory (already populated by SSE). No separate fetch needed
- **D-16:** For post-simulation viewing (completed simulations), TelemetryPanel falls back to REST fetch from existing /api/sessions/:id/simulate/telemetry endpoint

### Empty & Missing-Data States
- **D-17:** When a chart's data fields are all null/undefined, show an empty state message ("No data available") inside the chart container. Do not hide charts entirely
- **D-18:** Bond yield chart uses single generic empty state ("No bond data available") — no distinction between "no bonds issued" vs "bonds feature not enabled"
- **D-19:** When no telemetry data exists at all (no iterations run), keep current behavior: single panel-wide "No telemetry data available yet" message

### Chart Responsiveness
- **D-20:** All recharts charts (new economy charts AND migrated existing charts) use ResponsiveContainer to fill parent width
- **D-21:** Charts automatically resize within the TelemetryPanel modal (maxWidth: 960px)

### Data Export
- **D-22:** Add a CSV export button in the TelemetryPanel header (next to existing Refresh button)
- **D-23:** CSV export includes all telemetry data (existing + economy fields) in a single download

### Claude's Discretion
- Exact renamed title for TelemetryPanel (something reflecting expanded scope)
- Chart color assignments for economy charts (which --chart-* tokens for CPI, M1/M2 bands, budget categories, bond yields)
- SMA window size (N) for CPI trend overlay
- Exact CSV column ordering and formatting
- Recharts chart height values for each panel

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Telemetry Infrastructure
- `web/src/components/TelemetryPanel.tsx` — Current chart panel with SVGLineChart, styling patterns, data fetching, chart color tokens
- `web/src/components/LineChart.tsx` — Alternate SVG chart component (simpler than SVGLineChart in TelemetryPanel)
- `web/src/stores/simulationStore.ts` — SSE event handling, statsHistory population, store architecture
- `web/src/pages/Simulation.tsx` — Where TelemetryPanel is opened from, session lifecycle context

### Shared Types
- `shared/src/types.ts` — TelemetryLog interface (lines 227-265), SessionExport interface (includes telemetryLogs)

### Server Telemetry
- `server/src/routes/simulate.ts` — SSE endpoint, telemetry REST endpoint
- `server/src/orchestration/simulationRunner.ts` — Where TelemetryLog data is computed per iteration
- `server/src/mechanics/physicsEngine.ts` — Deterministic delta calculations, source of telemetry values

### Economy Systems (data sources for charts)
- `server/src/db/repos/economyRepo.ts` — Economy data persistence

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SVGLineChart` in TelemetryPanel.tsx — Will be replaced by recharts, but provides reference for chart styling, color tokens, layout patterns
- `LineChart` in LineChart.tsx — Simpler chart component, also to be migrated
- Chart CSS variables: `--chart-blue`, `--chart-orange`, `--chart-green`, `--chart-teal`, `--chart-red`, `--chart-violet`, `--chart-emerald`, `--chart-coral` (defined in index.css)
- `simulationStore.statsHistory` — Already populated by SSE events, provides real-time data feed

### Established Patterns
- TelemetryPanel uses inline styles (React.CSSProperties objects) — not CSS modules or Tailwind
- Charts render conditionally based on data availability (e.g., `logs.some(l => l.giniCoefficient != null)`)
- TelemetryLog interface uses optional fields for newer metrics — backward compatible pattern
- Panel is modal overlay with dark theme (rgba backgrounds, blur backdrop)

### Integration Points
- TelemetryPanel is imported and rendered in Simulation.tsx
- `simulationStore.statsHistory` is the live data source during simulation
- REST endpoint `/api/sessions/:id/simulate/telemetry` is the historical data source
- TelemetryLog in `shared/src/types.ts` is the shared type extended by both server and frontend

</code_context>

<specifics>
## Specific Ideas

- M1/M2 visualization: Classic money supply stacked area chart with M0 as bottom band
- Budget chart: Grouped bars with allocation amount and public goods quality score side by side per category
- CPI chart: Laspeyres index line with SMA trend overlay as second line
- Bond yields: Line chart tracking government and corporate bond coupon yields over time

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-economic-dashboard*
*Context gathered: 2026-04-01*
