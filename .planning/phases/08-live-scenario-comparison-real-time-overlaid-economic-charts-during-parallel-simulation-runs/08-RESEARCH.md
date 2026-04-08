# Phase 8: Live Scenario Comparison - Research

**Researched:** 2026-04-07
**Domain:** Real-time multi-scenario charting, parallel SSE streaming, multi-provider LLM load balancing, session grouping
**Confidence:** HIGH

## Summary

Phase 8 transforms the Simulation page from a single-session viewer into a multi-scenario live comparison dashboard. The core challenge spans four distinct domains: (1) multi-series recharts rendering with overlaid lines from N scenarios on shared axes, (2) parallel SSE stream management where N EventSource connections feed into a unified Zustand store, (3) a server-side multi-provider LLM load balancer that distributes requests round-robin across configured providers with per-provider rate limits, and (4) session grouping with a DB schema extension plus UI adaptations across 5 pages (Home, Simulation, Reflection, AgentReview, Artifacts).

The existing codebase provides strong foundations: recharts 3.8.1 already renders CPI, M1/M2, Fiscal, and Bond Yield charts in `EconomicDashboard.tsx`; the SSE pattern in `simulationStore.ts` with RAF-batched flushes is proven; `scenarioStore.ts` already forks sessions and tracks `scenarioSessionIds`; and the LLM gateway in `server/src/llm/gateway.ts` already abstracts multiple providers. The work is predominantly extension of existing patterns rather than greenfield creation.

**Primary recommendation:** Structure implementation in 6 waves: (1) DB schema + session grouping, (2) multi-provider load balancer, (3) parallel simulation orchestration + multi-SSE store, (4) chart redesign with multi-scenario overlays, (5) collapsible panels + responsive layout, (6) post-simulation stages (Reflection, Review, Artifacts). Each wave has a clear test boundary.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Overlaid lines on the same chart panels. Each scenario is a different-colored line series on shared axes. No side-by-side or small multiples.
- D-02: Scenarios distinguished by color + dash patterns (solid/dashed/dotted) for colorblind accessibility. Consistent colors across all charts.
- D-03: M1/M2 money supply chart switches from area format (N=1) to line format (N>1). Reverts to area for single scenario.
- D-04: Fiscal budget chart uses grouped bars per category when N>1 (one bar per scenario side by side per category).
- D-05: Live stat badges above each chart showing latest value per scenario in scenario colors.
- D-06: No divergence zone highlighting between scenario lines.
- D-07: No click-to-focus/highlight-scenario feature. All scenarios always shown at equal visibility.
- D-08: Maximum 4 scenarios supported for overlay.
- D-09: Shared crosshair tooltip on hover showing ALL scenarios' values at the hovered iteration.
- D-10: True parallel execution with separate SSE streams. Not sequential.
- D-11: One SSE connection per running scenario. Frontend tracks each independently.
- D-12: All scenarios forced to same iteration count. Keeps X-axis aligned.
- D-13: When one scenario finishes before others, chart line stays static at final value. "Complete" badge.
- D-14: After ALL scenarios finish, "View Full Comparison" button linking to Phase 6 comparison page.
- D-15: Server-side rate limiting with multi-provider support. Round-robin with rate awareness.
- D-16: Provider config in `~/.policylab/config.json`: providers array with model, endpoint, apiKey, and rateLimit fields.
- D-17: Enhanced Simulation page, NOT a new page. URL: `/sessions/:baseId/simulate?scenarios=id1,id2,id3`.
- D-18: Statistics panel becomes central chart hub. ALL charts inline as recharts LineCharts. Scrollable.
- D-19: All existing StatCard sparklines converted to recharts LineCharts.
- D-20: Economic Dashboard data moves from TelemetryPanel modal into Statistics panel inline.
- D-21: TelemetryPanel modal: remove Economic tab. Keep Classic tab as modal.
- D-22: Same layout for N=1 and N>1. Single scenario shows one colored line. No mode switching.
- D-23: Live Feed and Agent Status gain collapse buttons. Shrink to thin sidebar with expand button.
- D-24: When side panels collapse, Statistics auto-expands. 2-column auto-flow grid for charts.
- D-25: Chart order: CPI, Money Supply, Fiscal, Bond Yields, Wealth, Health, Happiness, Cortisol, Dopamine, Gini, Trust/Crime.
- D-26: Multi-scenario mode: Live Feed and Agent Status use tabs to switch scenario.
- D-27: Collapsible config diff header above charts showing parameter differences.
- D-28: Top bar: multi-progress bars. Controls apply to ALL scenarios simultaneously.
- D-29: Panel collapse state resets each page visit.
- D-30: Navigate to Simulation page immediately on "Run All Scenarios".
- D-31: No drill-down from multi-scenario view to individual session pages.
- D-32: Pause/resume/abort applies to ALL running scenarios simultaneously. No per-scenario controls.
- D-33: No time-range zoom or brush selection on charts.
- D-34: "Add More Iterations" and "End & Proceed" apply to all scenarios.
- D-35: Sessions stay independent in DB. Add nullable groupId + scenarioLabel to sessions table.
- D-36: Home page shows grouped sessions as single card with scenario count badge.
- D-37: Clicking grouped card navigates to group's current stage.
- D-38: Resume navigation tracked on base session.
- D-39: Standalone session (null groupId) uses same enhanced Simulation page.
- D-40: Existing Compare page unchanged.
- D-41: User can add new scenarios to existing groups from Design Review.
- D-42: When adding to existing group, only new scenarios run.
- D-43: Reflection: side-by-side evaluations + cross-scenario data table + LLM narrative.
- D-44: Reflection cross-scenario analysis AND Phase 6 Comparison page both kept.
- D-45: Agent Reflections: per-agent comparison cards showing reflections from ALL scenarios side by side.
- D-46: Reflections run in parallel using multi-provider load balancer.
- D-47: Same stage flow preserved: Reflection -> Review -> Artifacts.
- D-48: Review page agent chat includes context from ALL scenarios.
- D-49: Artifacts: per-scenario exports + combined markdown policy brief.

### Claude's Discretion
- Collapsed side panel visual design (thin strip with icon vs floating button)
- Chart color palette selection (4 distinct colors + dash patterns)
- Stat badge layout and styling
- Config diff header design and collapse behavior
- Progress bar stacking layout
- Multi-provider load balancer internal architecture (queue design, retry strategy)
- Cross-scenario comparison LLM prompt design
- Combined policy brief structure and content depth
- Home page grouped card visual design

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LSC-01 | Statistics panel shows all charts as recharts LineCharts with multi-scenario overlaid lines, shared crosshair tooltips, live stat badges | Recharts 3.8.1 multi-series LineChart pattern with shared Tooltip; data merging strategy for N scenario TelemetryLog arrays |
| LSC-02 | Live Feed and Agent Status collapse buttons; Statistics auto-expands to 2-column grid | CSS grid with dynamic column template; collapse state as React useState |
| LSC-03 | True parallel simulation with separate SSE streams; multi-progress bars; global pause/resume/abort | N EventSource connections managed by new multiScenarioStore; batch control via Promise.all on N endpoints |
| LSC-04 | Multi-provider LLM load balancer with round-robin + per-provider rate limits | New loadBalancer.ts wrapping existing gateway.ts providers; token bucket rate limiting |
| LSC-05 | Sessions table groupId + scenarioLabel; Home page grouped card | Drizzle schema migration adding nullable text columns; SQL GROUP BY for home page query |
| LSC-06 | Reflection side-by-side evaluations + cross-scenario data table + LLM narrative | Multi-session reflection store; new comparison prompt building on existing comparison.ts pattern |
| LSC-07 | Review page agent chat with cross-scenario context | Extend agent chat prompt with multi-scenario reflections and stats |
| LSC-08 | Artifacts per-scenario exports + combined policy brief | New LLM prompt for policy brief generation; markdown template |
| LSC-09 | Add new scenarios to existing groups; only new scenarios run | Extend fork endpoint to accept groupId; scenarioStore tracks existing completed sessions |
| LSC-10 | "View Full Comparison" button after all scenarios complete | Conditional render when all SSE streams report simulation-complete; link to Phase 6 comparison page |
| LSC-11 | TelemetryPanel Economic tab removed; Classic tab modal preserved | Remove EconomicDashboard import from TelemetryPanel; keep SVGLineChart Classic tab |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Shared types**: All cross-workspace data structures live in `shared/src/types.ts`. Import as `@policylab/shared`.
- **CSS variables**: Use theme tokens from `web/src/index.css`. Both dark and light themes supported.
- **Multi-provider LLM**: Gateway in `server/src/llm/` abstracts Anthropic, OpenAI, Gemini, Ollama. Provider/model selected from config.
- **Economic parameters**: All tunable params stored in session-level `EconomyConfig`, never hardcoded.
- **Zustand stores**: Domain-sliced; avoid cross-store coupling.
- **asyncLogFlusher**: Route high-frequency writes through it to prevent SQLITE_BUSY.
- **Bank agents**: Excluded from citizenAgents filter and computeSystemFiatTotal.

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 | Multi-series chart rendering | Already used for EconomicDashboard; supports multi-Line on shared axes natively |
| zustand | 5.0.11 | State management for multi-scenario data | Already used for all stores; supports multiple independent store instances |
| react-router-dom | 7.13.1 | URL-based scenario routing with query params | Already handles all routing |
| drizzle-orm + better-sqlite3 | (existing) | Schema migration for groupId/scenarioLabel columns | Already manages all DB operations |
| EventSource (browser native) | N/A | SSE connections (1 per scenario) | Already used in simulationStore.connectSSE |

### No New Dependencies Required

This phase does not require any new npm packages. All features are implementable with the existing stack:
- **Multi-series charts**: recharts 3.8.1 supports arbitrary N Line elements on a single LineChart.
- **Multiple SSE**: Browser-native EventSource supports 6+ concurrent connections per origin.
- **Rate limiting**: Implementable with a simple token bucket in plain TypeScript.
- **Collapsible panels**: CSS transitions + React state.

## Architecture Patterns

### Recommended Project Structure
```
server/src/
  llm/
    loadBalancer.ts          # NEW: Multi-provider round-robin with rate limits
  routes/
    sessions.ts              # MODIFY: groupId/scenarioLabel in fork, grouped list query
    simulate.ts              # MODIFY: batch pause/resume/abort for scenario groups
  db/
    schema.ts                # MODIFY: Add groupId, scenarioLabel to sessions table
shared/src/
  types.ts                   # MODIFY: SessionMetadata + groupId/scenarioLabel, AppSettings + providers array
web/src/
  stores/
    multiScenarioStore.ts    # NEW: Multi-session SSE management, merged data for charts
  components/
    ScenarioChart.tsx         # NEW: Reusable multi-scenario recharts wrapper
    CollapsiblePanel.tsx      # NEW: Collapse/expand wrapper for side panels
    ConfigDiffHeader.tsx      # NEW: Collapsible param diff display
    ScenarioStatBadge.tsx     # NEW: Live stat badges per scenario
    PolicyBrief.tsx           # NEW: Combined policy brief viewer
  pages/
    Simulation.tsx            # MAJOR REWRITE: Multi-scenario layout, inline charts, collapse
    Reflection.tsx            # MAJOR REWRITE: Side-by-side evaluations, cross-scenario
    AgentReview.tsx           # MODIFY: Multi-scenario context in chat
    Artifacts.tsx             # MODIFY: Per-scenario + combined policy brief
    HomePage.tsx              # MODIFY: Grouped session cards
```

### Pattern 1: Multi-Scenario Data Merging for Charts

**What:** Merge N scenario TelemetryLog arrays into a single recharts-compatible dataset keyed by iterationNumber.

**When to use:** Every chart in the Statistics panel.

**Example:**
```typescript
// Each scenario has its own TelemetryLog[] array
// Merge into flat rows for recharts: { iterationNumber, cpi_baseline, cpi_scenarioA, ... }
interface MergedDataPoint {
  iterationNumber: number;
  [key: string]: number | null; // e.g. "cpi_baseline", "cpi_Policy A"
}

function mergeScenarioData(
  scenarios: Array<{ label: string; data: TelemetryLog[] }>,
  field: keyof TelemetryLog
): MergedDataPoint[] {
  const byIteration = new Map<number, MergedDataPoint>();
  for (const { label, data } of scenarios) {
    for (const row of data) {
      const existing = byIteration.get(row.iterationNumber) ?? { iterationNumber: row.iterationNumber };
      existing[`${String(field)}_${label}`] = row[field] as number ?? null;
      byIteration.set(row.iterationNumber, existing);
    }
  }
  return Array.from(byIteration.values()).sort((a, b) => a.iterationNumber - b.iterationNumber);
}
```

Then render N `<Line>` elements dynamically:
```tsx
<LineChart data={mergedData}>
  {scenarios.map((s, i) => (
    <Line
      key={s.label}
      dataKey={`cpi_${s.label}`}
      stroke={SCENARIO_COLORS[i]}
      strokeDasharray={SCENARIO_DASHES[i]}
      dot={false}
      name={s.label}
    />
  ))}
  <Tooltip content={<SharedCrosshairTooltip />} />
</LineChart>
```

### Pattern 2: Multi-SSE Store Architecture

**What:** A new Zustand store that manages N concurrent EventSource connections, each writing to scenario-keyed state maps.

**When to use:** Simulation page in multi-scenario mode.

**Key design:**
```typescript
interface MultiScenarioState {
  // Keyed by sessionId
  scenarios: Record<string, {
    label: string;
    color: string;
    dashPattern: string;
    sessionId: string;
    isRunning: boolean;
    isPaused: boolean;
    isComplete: boolean;
    currentIteration: number;
    totalIterations: number;
    macroHistory: TelemetryLog[];
    statsHistory: IterationStats[];
    feed: IterationFeed[];
    finalReport: string | null;
    error: string | null;
  }>;
  
  // Global controls
  allComplete: boolean;
  anyRunning: boolean;
  
  // Actions
  initScenarios: (sessions: Array<{ id: string; label: string }>) => void;
  connectAll: () => Array<() => void>;  // Returns cleanup fns
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  abortAll: () => Promise<void>;
  reset: () => void;
}
```

Each scenario's SSE uses the same RAF-batched flush pattern from the existing `simulationStore.connectSSE`. The store computes `allComplete` and `anyRunning` as derived state.

### Pattern 3: Multi-Provider Load Balancer

**What:** Server-side request dispatcher that distributes LLM calls across configured providers.

**Architecture:**
```typescript
interface ProviderSlot {
  provider: LLMProvider;
  label: string;
  rateLimit: number | null;  // null = unlimited (local)
  tokenBucket: { tokens: number; lastRefill: number; rate: number } | null;
  inflight: number;
}

class LoadBalancer implements LLMProvider {
  private slots: ProviderSlot[];
  private roundRobinIndex: number = 0;
  
  chat(messages, options): Promise<string> {
    const slot = this.nextAvailableSlot();
    slot.inflight++;
    try {
      return await slot.provider.chat(messages, options);
    } finally {
      slot.inflight--;
    }
  }
  
  private nextAvailableSlot(): ProviderSlot {
    // Round-robin with rate awareness:
    // Skip slots that have exhausted their token bucket
    // Fall back to slot with earliest token refill
  }
}
```

The load balancer wraps existing provider instances from `gateway.ts`. It reads the new `providers` array from `~/.policylab/config.json` and creates one slot per configured provider.

### Pattern 4: Session Grouping Schema

**What:** Nullable `groupId` and `scenarioLabel` columns on the sessions table.

**Schema change:**
```typescript
// In schema.ts
export const sessions = sqliteTable('sessions', {
  // ... existing columns ...
  groupId: text('group_id'),           // UUID, nullable. Shared by all sessions in a scenario group.
  scenarioLabel: text('scenario_label'), // e.g. "Baseline", "Policy A". Nullable.
});
```

**Migration approach:** SQLite `ALTER TABLE ADD COLUMN` with nullable columns requires no data migration. Existing sessions get NULL for both columns.

**Grouping query for Home page:**
```sql
SELECT *, COUNT(*) OVER (PARTITION BY group_id) as scenario_count
FROM sessions
ORDER BY COALESCE(group_id, id), created_at
```

### Anti-Patterns to Avoid
- **Separate store per scenario**: Do NOT create N independent Zustand stores. Use a single multiScenarioStore with scenario-keyed maps. Multiple stores would require cross-store coupling for "all complete" checks.
- **Polling for chart updates**: Do NOT poll telemetry endpoints. Use the SSE stream data directly. The current pattern of polling `/simulate/telemetry` for macroHistory is acceptable for N=1 but would create O(N) polling load for multi-scenario.
- **Sharing EventSource across scenarios**: Each scenario MUST have its own EventSource. The SSE protocol is per-session on the server side (`simulationManager` is keyed by sessionId).
- **Mutating existing simulationStore**: Do NOT extend the existing simulationStore to handle N sessions. Create a new multiScenarioStore. The existing store continues to work for the N=1 backward-compatible case, and multiScenarioStore delegates to it for N=1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom timer-based limiter | Token bucket algorithm (simple, proven) | Handles bursts correctly; refill math is 3 lines |
| Multi-series chart rendering | Custom SVG overlay system | recharts `<Line>` elements on shared `<LineChart>` | recharts already handles axes, tooltips, legends natively |
| SSE connection management | Custom WebSocket layer | Browser-native EventSource | Already proven in the codebase; handles reconnection automatically |
| Crosshair tooltip | Manual mouse position tracking | recharts shared `<Tooltip>` with custom content | recharts provides cursor position and all series values at hovered point |
| Responsive grid layout | JavaScript resize observer | CSS grid with `auto-fill` + `minmax` | Pure CSS; no JS overhead; works with collapse transitions |

## Common Pitfalls

### Pitfall 1: SSE Connection Limit
**What goes wrong:** Browsers have a per-origin limit on concurrent HTTP/1.1 connections (typically 6 for Chrome/Firefox). With 4 scenarios = 4 SSE streams + regular API calls, you approach the limit.
**Why it happens:** SSE connections are long-lived HTTP/1.1 connections that count against the browser's per-origin pool.
**How to avoid:** The limit is 6 for HTTP/1.1, so 4 SSE + 2 remaining API slots is tight but viable. Vite's dev proxy runs on the same origin. If HTTP/2 is available (production), the limit does not apply. For dev, ensure no other long-lived connections are open. Consider closing SSE connections for completed scenarios immediately.
**Warning signs:** API calls hang or time out during multi-scenario simulation.

### Pitfall 2: RAF Flush Ordering Across N Stores
**What goes wrong:** With N SSE connections each using RAF-batched flushes, the flush order can cause intermediate inconsistent state where some scenarios are 1 frame ahead of others.
**Why it happens:** Each EventSource fires its own RAF callback independently.
**How to avoid:** This is cosmetically acceptable -- charts update slightly out of sync by 1 frame (16ms). Do NOT try to synchronize flushes across scenarios; the complexity is not worth it. The visual difference is imperceptible.
**Warning signs:** None visible to users. Only matters for snapshot testing.

### Pitfall 3: Memory Growth with N Scenario Histories
**What goes wrong:** With 4 scenarios each accumulating TelemetryLog[] and IterationStats[], memory grows 4x. For 200 iterations with rich telemetry objects, this can be significant.
**Why it happens:** Each scenario maintains its own full history array.
**How to avoid:** Apply the existing `MACRO_HISTORY_CAP = 1000` per scenario. With 4 scenarios, max memory is 4000 entries. TelemetryLog objects are ~40 fields * 8 bytes = ~320 bytes each, so 4000 * 320 = ~1.3MB. This is fine.
**Warning signs:** Browser memory exceeding 500MB during simulation.

### Pitfall 4: Drizzle Schema Migration on Existing DB
**What goes wrong:** Adding columns to SQLite with Drizzle can fail if the migration strategy is push-based and the column already exists from a partial previous run.
**Why it happens:** SQLite `ALTER TABLE ADD COLUMN` is idempotent-ish but Drizzle's `drizzle-kit push` may error on duplicate column.
**How to avoid:** Use Drizzle's `push` strategy (the project already uses it). For safety, wrap in a try-catch or check column existence first. The columns are nullable so no DEFAULT constraint issues.
**Warning signs:** Server startup crash with "duplicate column name" error.

### Pitfall 5: Parallel Simulation Server Load
**What goes wrong:** Running 4 simulations simultaneously means 4x LLM calls per iteration tick. Without the load balancer, a single provider gets hammered.
**Why it happens:** Each simulation independently calls the LLM gateway for N agents * 4 scenarios.
**How to avoid:** This is exactly what LSC-04 (multi-provider load balancer) solves. Implement the load balancer BEFORE parallel execution. Test with 2 scenarios first.
**Warning signs:** 429 rate limit errors from cloud LLM providers.

### Pitfall 6: Stage Progression for Grouped Sessions
**What goes wrong:** With grouped sessions, advancing stage (simulating -> reflecting -> reviewing -> completed) needs to happen coherently across the group.
**Why it happens:** The existing stage progression is per-session. With groups, the "base session" tracks group-wide stage (D-38).
**How to avoid:** Only advance stage on the base session (the session whose ID is in the URL). Forked scenario sessions stay at their own stage independently. The base session's stage is the "group stage" for navigation purposes.
**Warning signs:** Clicking a grouped card navigates to wrong page.

### Pitfall 7: Config Diff Computation for N Scenarios
**What goes wrong:** Config diff between N scenarios is combinatorial if you compare all pairs.
**Why it happens:** With 4 scenarios there are 6 possible pairs.
**How to avoid:** Per D-27, the diff header shows which params differ across scenarios with values per scenario. This is a union-of-all-differing-keys approach, not pairwise. For each key, if any scenario differs from baseline, show all scenario values. Single pass: iterate all keys, check if any value differs from baseline.

## Code Examples

### Multi-Series LineChart with Shared Tooltip (recharts 3.8.1)
```tsx
// Source: Verified against existing EconomicDashboard.tsx patterns + recharts docs
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const SCENARIO_COLORS = ['var(--chart-blue)', 'var(--chart-orange)', 'var(--chart-green)', 'var(--chart-violet)'];
const SCENARIO_DASHES = ['', '8 4', '4 4', '2 4'];  // solid, long dash, short dash, dotted

interface ScenarioChartProps {
  data: MergedDataPoint[];
  scenarios: Array<{ label: string; index: number }>;
  field: string;
  title: string;
  yFormatter?: (v: number) => string;
}

function ScenarioChart({ data, scenarios, field, title, yFormatter }: ScenarioChartProps) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {/* Live stat badges */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {scenarios.map(s => {
          const latest = data[data.length - 1];
          const val = latest?.[`${field}_${s.label}`];
          return (
            <span key={s.label} style={{ color: SCENARIO_COLORS[s.index], fontSize: '0.78rem', fontWeight: 600 }}>
              {s.label}: {val != null ? (yFormatter?.(val as number) ?? val) : '--'}
            </span>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <XAxis dataKey="iterationNumber" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
          <YAxis tickFormatter={yFormatter} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} width={48} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--primary)', borderRadius: 8 }}
            // Shared crosshair: recharts Tooltip with multiple Lines shows all values at cursor
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
          {scenarios.map(s => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={`${field}_${s.label}`}
              stroke={SCENARIO_COLORS[s.index]}
              strokeDasharray={SCENARIO_DASHES[s.index]}
              strokeWidth={2}
              dot={false}
              name={s.label}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### Token Bucket Rate Limiter
```typescript
// Source: Standard token bucket algorithm
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private readonly rate: number,       // tokens per second
    private readonly capacity: number,   // max burst
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  
  async waitForToken(): Promise<void> {
    while (!this.tryConsume()) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }
}
```

### Collapsible Panel CSS Pattern
```tsx
// Source: Standard CSS transition pattern
function CollapsiblePanel({ 
  side, collapsed, onToggle, children 
}: { 
  side: 'left' | 'right'; collapsed: boolean; onToggle: () => void; children: React.ReactNode 
}) {
  return (
    <div style={{
      width: collapsed ? '40px' : undefined,
      minWidth: collapsed ? '40px' : '300px',
      transition: 'all 0.3s ease',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {collapsed ? (
        <button onClick={onToggle} style={{
          position: 'absolute', top: '50%', [side]: 0,
          transform: 'translateY(-50%)',
          // expand icon
        }} />
      ) : (
        <>
          <button onClick={onToggle} style={{ position: 'absolute', top: 8, [side === 'left' ? 'right' : 'left']: 8 }}>
            {/* collapse icon */}
          </button>
          {children}
        </>
      )}
    </div>
  );
}
```

### Session Group Fork with groupId
```typescript
// Extending existing fork endpoint in sessions.ts
// Source: Existing fork code at lines 385-456
router.post('/:id/fork', async (req, res) => {
  const { id } = req.params;
  const { iterations, groupId, scenarioLabel } = req.body;
  
  // ... existing fork logic ...
  
  await db.insert(sessions).values({
    id: newId,
    title: scenarioLabel ? `${source.title} — ${scenarioLabel}` : `${source.title} (fork)`,
    // ... existing fields ...
    groupId: groupId ?? null,
    scenarioLabel: scenarioLabel ?? null,
  });
  
  res.status(201).json({ id: newId });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential scenario runs (Phase 7 decision) | Parallel execution with load balancer (Phase 8) | Now | 4x faster scenario comparison |
| StatCard bar sparklines | recharts LineCharts for all metrics | Phase 8 | Consistent multi-scenario rendering |
| TelemetryPanel modal for economic data | Inline charts in Statistics panel | Phase 8 | Economic data always visible |
| Single-provider LLM | Multi-provider round-robin with rate limits | Phase 8 | Supports parallel sim load |
| Flat session list | Grouped sessions with scenario badges | Phase 8 | Policymaker-friendly session management |

**Deprecated by this phase:**
- `StatCard` component (bar sparklines) -- replaced by recharts LineCharts
- `EconomicDashboard` as TelemetryPanel child -- data moves inline to Statistics panel
- Sequential `runAllScenarios` in scenarioStore -- replaced by parallel execution
- Single-provider `getProvider()` for simulation -- wrapped by load balancer during parallel runs

## Open Questions

1. **N=1 store delegation**
   - What we know: D-22 says same layout for N=1 and N>1. D-39 says standalone session uses same enhanced page.
   - What's unclear: Should N=1 use multiScenarioStore (with 1 entry) or the existing simulationStore? Using multiScenarioStore for all cases simplifies the page but means rewriting how existing features (auto-proceed, continue, fork) work.
   - Recommendation: Use multiScenarioStore for ALL cases (N=1 included). The existing simulationStore can be kept for backward compat but the Simulation page should always use multiScenarioStore. This eliminates conditional logic.

2. **Load balancer scope**
   - What we know: D-15/D-16 specify multi-provider round-robin for parallel execution.
   - What's unclear: Should the load balancer replace `getProvider()`/`getCitizenProvider()` globally, or only wrap them for parallel simulation calls?
   - Recommendation: Create the load balancer as an opt-in layer. During parallel simulation, `simulationRunner.ts` uses the load balancer. Single simulations and other LLM calls (brainstorming, reflection, etc.) continue using the existing gateway. This minimizes blast radius.

3. **Base session identification in groups**
   - What we know: D-38 says stage progression tracked on base session. The URL uses `baseId`.
   - What's unclear: How to identify which session in a group is the "base". 
   - Recommendation: The base session is the Baseline scenario tab's session. It is either the original session (not a fork) or explicitly marked. When forking, the base session gets the groupId first. The base session ID is the first element in the `?scenarios=` query param.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | server/vitest.config.ts |
| Quick run command | `npm run test -w server -- --run` |
| Full suite command | `npm run test -w server -- --run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LSC-01 | Multi-scenario chart data merging | unit | `npx vitest run server/src/__tests__/scenarioDataMerge.test.ts -x` | Wave 0 |
| LSC-03 | Parallel simulation batch control | unit | `npx vitest run server/src/__tests__/simulationBatchControl.test.ts -x` | Wave 0 |
| LSC-04 | Load balancer round-robin + rate limiting | unit | `npx vitest run server/src/llm/__tests__/loadBalancer.test.ts -x` | Wave 0 |
| LSC-05 | Session grouping schema + queries | unit | `npx vitest run server/src/__tests__/sessionGrouping.test.ts -x` | Wave 0 |
| LSC-06 | Cross-scenario reflection data assembly | unit | `npx vitest run server/src/__tests__/crossScenarioReflection.test.ts -x` | Wave 0 |
| LSC-08 | Policy brief generation | unit | `npx vitest run server/src/__tests__/policyBrief.test.ts -x` | Wave 0 |
| LSC-02 | Panel collapse + grid expansion | manual | Visual inspection | N/A |
| LSC-07 | Agent chat cross-scenario context | integration | Manual chat test | N/A |
| LSC-09 | Add scenarios to existing group | integration | Manual test via Design Review | N/A |
| LSC-10 | View Full Comparison button | manual | Visual after all complete | N/A |
| LSC-11 | TelemetryPanel Economic tab removal | manual | Visual inspection | N/A |

### Sampling Rate
- **Per task commit:** `npm run test -w server -- --run`
- **Per wave merge:** `npm run test -w server -- --run` (full 207+ tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/src/llm/__tests__/loadBalancer.test.ts` -- covers LSC-04 (round-robin + rate limits)
- [ ] `server/src/__tests__/sessionGrouping.test.ts` -- covers LSC-05 (groupId/scenarioLabel queries)
- [ ] Framework install: None needed -- vitest already configured and passing 207 tests

## Sources

### Primary (HIGH confidence)
- Codebase inspection of all referenced files (simulationStore.ts, scenarioStore.ts, Simulation.tsx, EconomicDashboard.tsx, gateway.ts, simulationManager.ts, schema.ts, settings.ts, types.ts, etc.)
- recharts 3.8.1 -- multi-Line rendering verified via existing EconomicDashboard.tsx patterns (CPI chart already uses 2 Lines)
- Browser EventSource -- 6 concurrent connections per origin is well-documented browser behavior

### Secondary (MEDIUM confidence)
- Token bucket rate limiting -- standard algorithm, widely documented

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and in use; no new dependencies
- Architecture: HIGH - extending proven patterns (SSE, Zustand, recharts, Drizzle) already in the codebase
- Pitfalls: HIGH - identified from direct code analysis (SSE connection limits, memory growth, stage progression)

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable -- no external dependency changes expected)
