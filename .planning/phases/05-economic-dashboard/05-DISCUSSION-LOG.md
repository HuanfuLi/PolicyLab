# Phase 5: Economic Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 05-economic-dashboard
**Areas discussed:** Chart placement & navigation, Charting approach, Real-time update behavior, Empty & missing-data states, Chart responsiveness, Data persistence & export

---

## Chart Placement & Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| New tab in TelemetryPanel | Add an 'Economy' tab to the existing TelemetryPanel modal | |
| Inline on Simulation page | Render the 4 panels directly on the Simulation page below the feed | |
| Separate dashboard page | New /sessions/:id/economy route | |
| You decide | Claude picks the best approach | |

**User's choice:** Initially selected "Inline on Simulation page" with "Collapsible section", then revised to "TelemetryPanel" (existing modal) during follow-up.
**Notes:** User explicitly corrected: "For last question, use Telemetry table instead of inline."

| Option | Description | Selected |
|--------|-------------|----------|
| Stacked vertical | Full-width charts stacked vertically | ✓ |
| 2x2 grid | Four charts in a 2-column grid | |
| You decide | Claude picks based on chart types | |

**User's choice:** Stacked vertical

| Option | Description | Selected |
|--------|-------------|----------|
| Replace related charts | Fiat Supply overlaps with M1/M2 — replace it | ✓ |
| New 'Economy' tab | Tab bar: General | Economy | |
| Append below existing | Add at the bottom | |

**User's choice:** Replace related charts (Fiat Supply replaced by M1/M2)

| Option | Description | Selected |
|--------|-------------|----------|
| Top of panel | Economy charts first, then existing charts | ✓ |
| After Fiat Supply replacement | Insert near Chart 1A position | |
| Bottom of panel | Existing charts first | |

**User's choice:** Top of panel (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Rename to reflect scope | Something like "Simulation Dashboard" | ✓ |
| Keep current name | "Economy Telemetry Terminal" | |
| You decide | Claude picks | |

**User's choice:** Rename to reflect scope

---

## Charting Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Keep custom SVG | Extend SVGLineChart, zero new deps | |
| Install recharts | Built-in AreaChart, BarChart, tooltips | ✓ |
| You decide | Claude picks | |

**User's choice:** Install recharts

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate all to recharts | Replace all SVGLineChart with recharts | ✓ |
| Mixed approach | New charts recharts, old stay SVG | |
| You decide | Claude picks | |

**User's choice:** Migrate all to recharts

| Option | Description | Selected |
|--------|-------------|----------|
| Match current theme | Custom dark theme with CSS variables | ✓ |
| Recharts defaults | Out-of-the-box styling | |
| You decide | Claude handles | |

**User's choice:** Match current theme (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Stacked area bands | M0 bottom, M1 stacked, M2 above | ✓ |
| Overlapping lines with fill | Separate lines with translucent fills | |
| You decide | Claude picks | |

**User's choice:** Stacked area bands

| Option | Description | Selected |
|--------|-------------|----------|
| Tooltips on hover | Standard recharts tooltip | ✓ |
| Tooltips + crosshair | Synced vertical crosshair | |
| Static only | No hover interaction | |

**User's choice:** Tooltips on hover (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped bars per category | Bar groups with allocation + quality score | ✓ |
| Horizontal stacked bar | Proportional bar with separate quality indicators | |
| You decide | Claude picks | |

**User's choice:** Grouped bars per category

| Option | Description | Selected |
|--------|-------------|----------|
| Simple moving average | N-iteration SMA as second line | ✓ |
| Exponential smoothing | EMA line | |
| You decide | Claude picks | |

**User's choice:** Simple moving average (Recommended)

---

## Real-Time Update Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Append per iteration | Each SSE event adds a data point | ✓ |
| Batched updates | Buffer N iterations then re-render | |
| Manual refresh only | Charts update on button click | |

**User's choice:** Append per iteration (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend TelemetryLog | Add fields to existing interface | ✓ |
| Separate EconomySnapshot type | New type and separate endpoint | |

**User's choice:** Extend TelemetryLog (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Use simulationStore data | Read from store during live run | ✓ |
| Keep REST-only | Always fetch via REST | |
| You decide | Claude picks | |

**User's choice:** Use simulationStore data (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| REST fetch from telemetry endpoint | Fall back to REST for completed sims | ✓ |
| Always use store + load on mount | Single store-based data path | |
| You decide | Claude picks | |

**User's choice:** REST fetch from telemetry endpoint

---

## Empty & Missing-Data States

| Option | Description | Selected |
|--------|-------------|----------|
| Hide chart entirely | Don't render if data null | |
| Show empty state message | Render container with 'No data available' | ✓ |
| Show chart with zero baseline | Render axes with flat zero line | |

**User's choice:** Show empty state message

| Option | Description | Selected |
|--------|-------------|----------|
| Single empty state | Generic 'No bond data available' | ✓ |
| Contextual messages | Different messages per reason | |
| You decide | Claude picks | |

**User's choice:** Single empty state (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep current behavior | Single panel-wide "No data" when no iterations | ✓ |
| Show chart containers with individual empty states | Render all sections even pre-data | |
| You decide | Claude picks | |

**User's choice:** Keep current behavior

---

## Chart Responsiveness

| Option | Description | Selected |
|--------|-------------|----------|
| ResponsiveContainer | Recharts ResponsiveContainer fills parent | ✓ |
| Fixed width matching panel | Set chart width to ~860px | |
| You decide | Claude picks | |

**User's choice:** ResponsiveContainer (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| All charts responsive | ResponsiveContainer for all migrated charts | ✓ |
| Only new economy charts responsive | Keep fixed width for migrated existing | |

**User's choice:** All charts responsive (Recommended)

---

## Data Persistence & Export

| Option | Description | Selected |
|--------|-------------|----------|
| Not now | Skip export for Phase 5 | |
| CSV export button | Download CSV from panel header | ✓ |
| JSON export button | Download JSON for external tools | |

**User's choice:** CSV export button

| Option | Description | Selected |
|--------|-------------|----------|
| In panel header | Next to Refresh button | ✓ |
| Per chart section | Each chart gets own export button | |
| You decide | Claude places it | |

**User's choice:** In panel header (Recommended)

---

## Claude's Discretion

- Exact renamed title for TelemetryPanel
- Chart color assignments for economy charts
- SMA window size for CPI trend overlay
- CSV column ordering and formatting
- Recharts chart heights

## Deferred Ideas

None — discussion stayed within phase scope
