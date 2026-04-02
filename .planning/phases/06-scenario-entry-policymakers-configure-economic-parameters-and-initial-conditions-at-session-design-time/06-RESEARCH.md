# Phase 6: Scenario Entry — Research

**Researched:** 2026-04-01
**Domain:** React 19 UI (Design Review tab extension), Express route upgrades (fork + config endpoints), LLM prompt expansion (comparison dimensions)
**Confidence:** HIGH — all key files read directly from codebase; no speculative claims

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Economy tab added to Design Review page alongside existing Overview/Agents/Law tabs. No separate page or wizard.
- **D-02:** Fork-from-design enables A/B scenario comparison. After designing agents, user forks the session, changes economic parameters in the Economy tab, then re-simulates. Comparison page shows both runs side-by-side.
- **D-03:** Existing `POST /api/sessions/:id/fork` endpoint already clones agents + design and sets stage to `design-review`. Upgrade it to also clone EconomyConfig so users can modify economic params before re-simulating.
- **D-04:** Parameters organized in collapsible grouped panels within the Economy tab: Banking, Fiscal, Inflation sections. Each section contains its EconomyConfig parameters.
- **D-05:** Input controls are sliders with numeric input fields. Slider for quick adjustment, numeric field for precision. Show min/max/default for each parameter.
- **D-06:** Soft limits with override — parameters have recommended ranges. Going outside shows a warning + "I understand the risks" confirmation dialog. Never hard-block experimentation.
- **D-07:** Inline tooltips — info icon next to each parameter. Hover/click shows 1-2 sentence explanation + real-world analogy (e.g., "Reserve ratio: US banks typically hold 10%").
- **D-08:** Comparison page shows a "Configuration Differences" section listing exactly which economic parameters differ between the two sessions. Critical for policy analysis — "we changed X, and here's what happened."
- **D-09:** Comparison dimensions expanded from 5 to 8-10, adding economic metrics: Gini coefficient, inflation rate, banking stability, fiscal spending effectiveness alongside existing Economic Equality, Citizen Wellbeing, Social Cohesion, Governance Effectiveness, Long-term Stability.
- **D-10:** `POST /fork-simulation` endpoint exists but is not exposed in UI. Evaluate whether to surface it for "branch from iteration N" scenarios.

### Claude's Discretion

- Exact slider ranges and default values for each EconomyConfig parameter (derive from research and existing physicsConfig.ts patterns)
- Panel collapse/expand behavior and visual styling (follow existing Design Review patterns)
- How to handle the Economy tab for pre-v1.0 sessions (likely hide it or show disabled state)
- Whether to add scenario presets ("Free Market", "Social Democracy") — nice-to-have, not required
- Exact 8-10 comparison dimension names and scoring methodology for new economic dimensions

### Deferred Ideas (OUT OF SCOPE)

- Scenario presets/templates ("Free Market", "Social Democracy", "Austerity")
- Multi-session comparison (>2 sessions)
- Branch from iteration N (fork-simulation surfacing in UI)
- Export comparison as policy brief (PDF/markdown)
</user_constraints>

---

## Summary

Phase 6 is a UI/UX layer that makes the economic parameters configured in Phases 1–4 accessible to policymakers. The work spans three areas: (1) a new Economy tab in `DesignReview.tsx`, (2) upgrades to the fork endpoint and comparison system, and (3) an expansion of the LLM comparison prompt.

The codebase is already well-prepared. The `PUT /api/sessions/:id/config` endpoint already accepts `economyConfig` patches (line 349 in `sessions.ts`) and `budgetAllocation` patches (line 364). The `EconomyConfig` type in `shared/src/types.ts` is fully defined with 15 fields across banking, capital markets, and fiscal domains. The fork endpoint at line 353 in `sessions.ts` currently drops config entirely and reconstructs a minimal config object — the upgrade is to carry `economyConfig` and `budgetAllocation` forward from the source session.

The comparison system in `compare.ts` and `CompareSessions.tsx` is data-driven: the 5 hardcoded dimension names live only in the LLM prompt string in `prompts.ts` (line 1314), so expanding to 8-10 dimensions requires changing the prompt and nothing else on the comparison infrastructure side. The parameter diff feature requires extracting `economyConfig` from both sessions' `config` JSON blobs in `loadSessionSummary` and returning it alongside the comparison result.

**Primary recommendation:** Build in three focused waves: (1) Economy tab + EconomyConfig patching, (2) fork upgrade + parameter diff infrastructure, (3) comparison prompt expansion + diff UI.

---

## Standard Stack

### Core (all already in project — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 | 19.x | UI components | Already in project |
| Zustand | in use | State management for session config | Established pattern in `sessionDetailStore.ts` |
| Lucide React | in use | Icons (Info, ChevronDown, AlertTriangle) | Already used throughout DesignReview |
| Drizzle ORM | in use | DB queries in fork endpoint | All routes use this |
| Vitest | in use | Unit tests for new parameter validation | `server/vitest.config.ts` configured |

### No new dependencies required

This phase is purely configuration UI and route upgrades. All needed libraries are already installed. CSS variables (`var(--primary)`, `var(--glass-border)`, etc.) handle styling consistently.

**Installation:** None required.

---

## Architecture Patterns

### Existing Tab Pattern (DesignReview.tsx)

The current tab system uses a simple `activeTab` state variable with three string values: `'overview' | 'agents' | 'law'`. Adding the Economy tab means:

1. Extend the union type: `'overview' | 'agents' | 'law' | 'economy'`
2. Add a `<button style={tabBtnStyle('economy')} onClick={() => setActiveTab('economy')}>` in the tab bar at line ~200
3. Add `{activeTab === 'economy' && <EconomyTab ... />}` in the content area at line ~212
4. Create `EconomyTab` as a sub-component within the file or as a separate component import

### Config Patching Pattern (established)

The `updateLockedVariables` action in `sessionDetailStore.ts` shows the exact pattern for patching session config:

```typescript
// Source: web/src/stores/sessionDetailStore.ts lines 339-351
await brainstormApi.patchConfig(id, { lockedVariables: lockedVars });
set(state => ({
  session: state.session
    ? { ...state.session, config: { ...state.session.config, lockedVariables: lockedVars } }
    : state.session,
}));
```

EconomyConfig patching follows this same pattern — call `brainstormApi.patchConfig(id, { economyConfig: partialUpdate })` then optimistically update the store. The server merges the patch at line 349-352 in `sessions.ts`.

### Collapsible Panel Pattern (existing in DesignReview)

The "Advanced Control" dropdown at lines 475-523 in `DesignReview.tsx` shows the existing collapsible pattern: a local boolean state (`showAdvancedControl`), a button that toggles it, and an absolutely-positioned panel. For the Economy tab panels, the same principle applies but inline (not absolutely positioned):

```typescript
// Pattern: inline collapsible section
const [bankingOpen, setBankingOpen] = useState(true);
// ...
<div>
  <button onClick={() => setBankingOpen(v => !v)}>
    <ChevronDown size={16} style={{ transform: bankingOpen ? 'rotate(180deg)' : 'none' }} />
    Banking
  </button>
  {bankingOpen && <div>...params...</div>}
</div>
```

### Slider + Number Input Pattern

No existing slider in the codebase — this is new. The standard HTML5 `<input type="range">` paired with `<input type="number">` is the right approach, controlled by a shared state value:

```typescript
// Recommended pattern for dual-control param entry
const [value, setValue] = useState(defaultVal);
// Keep both inputs in sync:
<input type="range" min={min} max={max} step={step} value={value}
  onChange={e => setValue(Number(e.target.value))} />
<input type="number" min={min} max={max} value={value}
  onChange={e => setValue(Number(e.target.value))}
  onBlur={e => handleSave(Number(e.target.value))} />
```

Save on blur (not on every keystroke) to avoid excessive API calls. This matches the agent stat editing pattern at lines 274-309 in `DesignReview.tsx`.

### SessionConfig Type Extension

`SessionConfig` in `shared/src/types.ts` currently has no `economyConfig` field. The config is stored as a JSON blob (`session.config` in DB), so the type needs to be extended:

```typescript
// shared/src/types.ts — extend SessionConfig
export interface SessionConfig {
  totalIterations: number;
  checklist: BrainstormChecklist;
  readyForDesign: boolean;
  lockedVariables?: string[];
  economyConfig?: Partial<EconomyConfig>;     // NEW
  budgetAllocation?: BudgetAllocation;        // NEW (already in DB layer)
}
```

The server-side config PATCH endpoint already handles both fields at runtime (lines 317-365 in `sessions.ts`). Adding them to the TypeScript type ensures frontend store accesses are type-safe.

### Fork Endpoint Upgrade

The `POST /api/sessions/:id/fork` endpoint at line 353 in `sessions.ts` currently hardcodes a minimal config:

```typescript
// Current (line 367-371) — drops source economyConfig
const config = JSON.stringify({
  totalIterations,
  checklist: { governance: true, ... },
  readyForDesign: true,
});
```

The upgrade: parse the source session's config JSON and carry `economyConfig` and `budgetAllocation` forward:

```typescript
let sourceConfig: Record<string, unknown> = {};
if (source.config) {
  try { sourceConfig = JSON.parse(source.config); } catch {}
}
const config = JSON.stringify({
  totalIterations,
  checklist: { governance: true, economy: true, legal: true, culture: true, infrastructure: true },
  readyForDesign: true,
  economyConfig: sourceConfig.economyConfig ?? undefined,
  budgetAllocation: sourceConfig.budgetAllocation ?? undefined,
});
```

Also, if the source session has a `budgetAllocation` in config, the fork should create a corresponding `fiscalBudget` DB record via `fiscalRepo.createBudget(newId, allocation)`.

### Comparison Prompt Expansion

The comparison dimensions are hardcoded in `prompts.ts` at line 1314 as a comma-separated list in the system prompt string and as explicit JSON keys in the example. To expand from 5 to 8:

1. Update the system prompt to list 8 dimension names
2. Update the JSON template to include 8 objects in the `dimensions` array
3. Pass additional telemetry data (Gini, M1 growth rate, fiscal quality scores) to `loadSessionSummary` and include it in the prompt so the LLM has data to score the new dimensions

`loadSessionSummary` currently (lines 23-68 in `compare.ts`) only reads `sessions`, `agents`, and `iterations`. It needs to also read the last iteration's `statistics` JSON for telemetry fields (`giniCoefficient`, `m1`, `infrastructureQuality`, etc.) and the session's `config` JSON for `economyConfig` values.

### Parameter Diff in Comparison Result

The `ComparisonResult` type in `shared/src/types.ts` only has `session1Id`, `session2Id`, `narrative`, `dimensions`, `verdict`. A new optional field is needed:

```typescript
// shared/src/types.ts
export interface EconomyParamDiff {
  param: string;
  label: string;
  session1Value: number | boolean;
  session2Value: number | boolean;
}

export interface ComparisonResult {
  // ...existing fields...
  economyParamDiffs?: EconomyParamDiff[];  // NEW
}
```

The diff is computed deterministically in `compare.ts` (not by LLM) by comparing `economyConfig` JSON blobs from both sessions. Only params that differ are included.

### Anti-Patterns to Avoid

- **Don't re-fetch session on every slider change.** Debounce or save on blur only. The current DB PATCH for `lockedVariables` fires on every checkbox change (single click = single call), which is fine, but a slider `onChange` fires on every pixel drag. Use `onMouseUp`/`onBlur` to trigger the save.
- **Don't hardcode EconomyConfig field metadata in multiple places.** Define a single parameter metadata array (label, key, min, max, step, default, tooltip, soft-limit) and derive both the UI and the validation from it. This prevents min/max/tooltip drift.
- **Don't pass raw `economyConfig` object to comparison LLM.** Extract only the values that differ and present them in the param diff table. Dumping the full config into the prompt wastes tokens and confuses the model.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip popup | Custom tooltip component | HTML `title` attr or a simple CSS `:hover` pseudo-element | Phase 6 tooltips are read-only info labels — no interaction needed beyond hover/click to show text. See D-07. |
| Slider debounce | Custom debounce hook | `onMouseUp` / `onBlur` event on the range input | Browser already fires `onMouseUp` when user releases slider — zero debounce logic needed |
| Parameter range validation | Custom validation engine | Simple array of `{ key, min, max, softMin, softMax }` objects checked inline | No complex dependency validation needed for EconomyConfig; flat numeric ranges suffice |
| Budget allocation pie visualization | Custom SVG donut | Four `<input type="range">` controls that auto-normalize to 1.0 | Budget is 4 sliders that must sum to 1.0; the normalization constraint is the feature |

**Key insight:** This phase is display + configuration persistence, not computation. Resist the urge to add charting or visualization libraries — the existing `LineChart.tsx` SVG pattern is sufficient for any trend indicators, and the comparison page already handles dimension visualization.

---

## EconomyConfig Parameter Metadata (Claude's Discretion — Recommended Ranges)

Derived from `shared/src/types.ts` defaults (`DEFAULT_ECONOMY_CONFIG`) and real-world analogies:

### Banking Section

| Key | Label | Min | Max | Step | Default | Soft Limit Range | Real-world Analogy |
|-----|-------|-----|-----|------|---------|------------------|--------------------|
| `reserveRequirement` | Reserve Ratio | 0.01 | 0.50 | 0.01 | 0.10 | 0.05–0.20 | US: 10%, EU: 1%, China: 12.5% |
| `baseLoanInterestRate` | Loan Interest Rate (per iter) | 0.001 | 0.05 | 0.001 | 0.005 | 0.002–0.015 | 0.5%/iter ≈ ~6% annual at 12 iter/year |
| `depositInterestRate` | Deposit Interest Rate (per iter) | 0.0 | 0.02 | 0.001 | 0.002 | 0.001–0.008 | Should be < loan rate |
| `defaultLoanTermIterations` | Loan Term (iterations) | 5 | 50 | 1 | 20 | 10–30 | |
| `defaultThresholdIterations` | Default Threshold (missed payments) | 1 | 10 | 1 | 3 | 2–5 | |

### Fiscal Section

| Key | Label | Min | Max | Step | Default | Soft Limit Range | Real-world Analogy |
|-----|-------|-----|-----|------|---------|------------------|--------------------|
| `budgetSpendingRate` | Budget Spending Rate | 0.01 | 0.50 | 0.01 | 0.10 | 0.05–0.25 | 10% of treasury disbursed per iter |
| `infrastructureMultiplier` | Infrastructure Productivity Bonus | 0.001 | 0.02 | 0.001 | 0.005 | 0.002–0.01 | Per quality point |
| `educationMultiplier` | Education Skill Gain Bonus | 0.001 | 0.02 | 0.001 | 0.005 | 0.002–0.01 | Per quality point |
| `defenseMultiplier` | Defense Enforcement Bonus | 0.001 | 0.02 | 0.001 | 0.003 | 0.001–0.008 | Per quality point |
| `welfareMultiplier` | Welfare UBI Supplement | 0.001 | 0.01 | 0.001 | 0.002 | 0.001–0.005 | Per quality point |
| `publicGoodsDecayRate` | Public Goods Decay (per iter) | 0.1 | 5.0 | 0.1 | 0.5 | 0.2–2.0 | Quality loss without spending |
| `publicGoodsGainDiminishing` | Diminishing Returns Exponent | 0.3 | 1.0 | 0.05 | 0.7 | 0.5–0.9 | 1.0 = linear, 0.5 ≈ sqrt |

### Capital Markets Section (optional — only show if `capitalMarketsEnabled`)

| Key | Label | Min | Max | Step | Default | Soft Limit Range |
|-----|-------|-----|-----|------|---------|------------------|
| `dividendPayoutRatio` | Dividend Payout Ratio | 0.0 | 0.30 | 0.01 | 0.05 | 0.02–0.15 |
| `govBondCouponRate` | Gov Bond Coupon (per iter) | 0.001 | 0.03 | 0.001 | 0.008 | 0.003–0.015 |
| `govBondTermIterations` | Gov Bond Maturity (iterations) | 5 | 30 | 1 | 10 | 5–20 |

### Budget Allocation Sub-section (within Fiscal)

Four sliders that must sum to 1.0. Use a normalization approach: when one slider moves, proportionally reduce others. Or allow free entry and show a "remaining" indicator, warning on save if total != 1.0.

---

## Recommended Comparison Dimensions (8 total)

Expanding from the current 5 to 8. New dimensions leverage telemetry data already computed by Phases 1-4:

| # | Dimension Name | Data Source | New? |
|---|---------------|-------------|------|
| 1 | Economic Equality | Gini coefficient (`giniCoefficient` in iteration stats) | Existing |
| 2 | Citizen Wellbeing | avg health + happiness + dopamine | Existing |
| 3 | Social Cohesion | trust index, crime rate, cooperation actions | Existing |
| 4 | Governance Effectiveness | law adherence, suppression use, role distribution | Existing |
| 5 | Long-term Stability | agent mortality rate, allostatic load trends | Existing |
| 6 | Banking Stability | loan default rate, M1 growth rate, reserve ratio compliance | **NEW** — from `m1`, `loansOutstanding` in `TelemetryLog` |
| 7 | Fiscal Effectiveness | public goods quality scores, spending efficiency (quality/fiat) | **NEW** — from `infrastructureQuality`, `educationQuality` etc. |
| 8 | Economic Growth | wealth trajectory trend (slope), Gini trend, poverty rate change | **NEW** — derived from iteration stats sequence |

The LLM needs the last-iteration telemetry + the iteration trend to score dimensions 6–8. `loadSessionSummary` must extract these from the DB.

---

## Common Pitfalls

### Pitfall 1: Budget Allocation Normalization Edge Case
**What goes wrong:** User sets infrastructure to 0.8, then tries to adjust education — remaining budget is 0.2 across 3 categories. If normalization is aggressive it silently zeroes out defense/welfare.
**Why it happens:** Proportional normalization breaks when all remaining sliders are at 0.
**How to avoid:** Show a running "total" indicator and only normalize on save/confirm, not on every slider move. Keep sliders independent during editing, validate sum at persist time. The server already validates: `Math.abs(sum - 1.0) > 0.01` returns 400.
**Warning signs:** Users report budget not saving; sum is not exactly 1.0.

### Pitfall 2: EconomyConfig Not Cloned During Fork
**What goes wrong:** Forked session inherits no economic parameters; the Economy tab shows defaults, and a user who didn't notice will re-simulate with default economics, making the comparison meaningless.
**Why it happens:** The current fork endpoint (line 367-371 in `sessions.ts`) constructs a fresh config object and ignores the source session's config entirely.
**How to avoid:** The fork endpoint upgrade (D-03) is the fix. Always verify in tests that a forked session's `config.economyConfig` matches the source.
**Warning signs:** Compare page shows identical economic parameters for both sessions even when user changed them.

### Pitfall 3: Comparison LLM Scores New Dimensions Without Data
**What goes wrong:** The LLM assigns arbitrary scores for "Banking Stability" or "Fiscal Effectiveness" if `loadSessionSummary` doesn't pass actual telemetry for those dimensions.
**Why it happens:** The comparison prompt currently only provides `avgWealth`, `avgHealth`, `avgHappiness`, and `deaths`. The LLM hallucinates scores when data is absent.
**How to avoid:** Add `m1`, `loansOutstanding`, `infrastructureQuality`, `educationQuality`, `giniCoefficient` to the `SessionSummaryInput` type and to what `loadSessionSummary` queries. Only add a dimension to the prompt if its data is present.
**Warning signs:** Banking Stability scores look the same for sessions with very different reserve ratios.

### Pitfall 4: Soft-Limit Dialog Fires on Page Load
**What goes wrong:** If the session already has an out-of-range EconomyConfig (set programmatically or via a prior session), the Economy tab initializes with a warning dialog.
**Why it happens:** Validation runs on component mount if current values are checked against soft limits.
**How to avoid:** Only trigger the soft-limit warning dialog on user interaction (slider move or numeric input blur), not on initial render. Initialize `pendingWarning` state as `null`, only set it in event handlers.

### Pitfall 5: SessionConfig Type Mismatch
**What goes wrong:** TypeScript compilation fails because `session.config.economyConfig` doesn't exist on `SessionConfig`.
**Why it happens:** `SessionConfig` in `shared/src/types.ts` (line 392) does not currently include `economyConfig` or `budgetAllocation`. The backend handles these at runtime (JSON blob merge), but the frontend type is strict.
**How to avoid:** Add `economyConfig?: Partial<EconomyConfig>` and `budgetAllocation?: BudgetAllocation` to `SessionConfig` in Wave 1, before writing any component code that reads these fields.

---

## Code Examples

### Economy Tab Component Structure

```typescript
// Source: DesignReview.tsx tab state pattern (lines 24, 170-182)
// Extend existing activeTab state union
const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'law' | 'economy'>('overview');

// Tab button (follows tabBtnStyle pattern)
<button style={tabBtnStyle('economy')} onClick={() => setActiveTab('economy')}>
  <DollarSign size={18} /> Economy
</button>

// Tab content
{activeTab === 'economy' && (
  <EconomyTab
    sessionId={id}
    economyConfig={session?.config?.economyConfig ?? {}}
    budgetAllocation={session?.config?.budgetAllocation ?? DEFAULT_BUDGET_ALLOCATION}
    onSave={(patch) => handleEconomyConfigSave(patch)}
  />
)}
```

### Config Patch Action in Store

```typescript
// New action for sessionDetailStore.ts — follows updateLockedVariables pattern
updateEconomyConfig: async (id: string, patch: Partial<EconomyConfig>) => {
  await brainstormApi.patchConfig(id, { economyConfig: patch });
  set(state => ({
    session: state.session
      ? {
          ...state.session,
          config: state.session.config
            ? { ...state.session.config, economyConfig: { ...(state.session.config.economyConfig ?? {}), ...patch } }
            : null,
        }
      : state.session,
  }));
},
```

### Fork Endpoint Config Preservation

```typescript
// Source: server/src/routes/sessions.ts line 353 — fork endpoint upgrade
let sourceConfig: Record<string, unknown> = {};
if (source.config) {
  try { sourceConfig = JSON.parse(source.config); } catch {}
}
const config = JSON.stringify({
  totalIterations,
  checklist: { governance: true, economy: true, legal: true, culture: true, infrastructure: true },
  readyForDesign: true,
  ...(sourceConfig.economyConfig ? { economyConfig: sourceConfig.economyConfig } : {}),
});
// After insert, also clone budget if present:
const sourceBudget = sourceConfig.budgetAllocation as BudgetAllocation | undefined;
if (sourceBudget) {
  fiscalRepo.createBudget(newId, sourceBudget);
}
```

### Comparison loadSessionSummary Extension

```typescript
// Source: server/src/routes/compare.ts lines 23-68
// Add telemetry extraction from last iteration statistics
const lastIter = iterRows[iterRows.length - 1];
let telemetry: {
  giniCoefficient?: number; m1?: number; loansOutstanding?: number;
  infrastructureQuality?: number; educationQuality?: number;
} = {};
if (lastIter) {
  try {
    const stats = JSON.parse(lastIter.statistics);
    telemetry = {
      giniCoefficient: stats.giniCoefficient,
      m1: stats.m1,
      loansOutstanding: stats.loansOutstanding,
      infrastructureQuality: stats.infrastructureQuality,
      educationQuality: stats.educationQuality,
    };
  } catch {}
}
// Also extract economyConfig from session config for param diff
let economyConfig: Record<string, unknown> = {};
if (session.config) {
  try {
    const cfg = JSON.parse(session.config);
    economyConfig = cfg.economyConfig ?? {};
  } catch {}
}
return { ..., telemetry, economyConfig };
```

### Comparison Prompt Expansion (8 dimensions)

```typescript
// Source: server/src/llm/prompts.ts line 1313 — system prompt change
`Compare them objectively across exactly 8 dimensions: Economic Equality, Citizen Wellbeing, Social Cohesion, Governance Effectiveness, Long-term Stability, Banking Stability, Fiscal Effectiveness, Economic Growth.`

// JSON template addition (3 new items):
{ "name": "Banking Stability", "score1": 0, "score2": 0, "analysis": "..." },
{ "name": "Fiscal Effectiveness", "score1": 0, "score2": 0, "analysis": "..." },
{ "name": "Economic Growth", "score1": 0, "score2": 0, "analysis": "..." }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `PUT /config` only handled `totalIterations`, `checklist`, `lockedVariables` | Also handles `economyConfig` and `budgetAllocation` (Phase 3 additions) | Phase 3 | EconomyConfig patching API already exists — Phase 6 only adds UI |
| Fork endpoint drops all config | Fork endpoint must preserve `economyConfig` | Phase 6 | Users can A/B compare policy variants |
| 5 comparison dimensions | 8 dimensions | Phase 6 | Adds economic domain coverage |

---

## Open Questions

1. **How to handle the Economy tab for pre-v1.0 sessions (sessions with no `economyConfig` in their config JSON)?**
   - What we know: The backend returns `null` or an empty object for `session.config.economyConfig` if the field was never set. `DEFAULT_ECONOMY_CONFIG` in `shared/src/types.ts` provides known-good defaults.
   - What's unclear: Should the tab show "Economy features not available for this session" or show the defaults and allow patching (which would activate economy features retroactively)?
   - Recommendation: Show the tab with `DEFAULT_ECONOMY_CONFIG` values as placeholders. If the session doesn't have `bankingEnabled: true` set in its config, display a banner: "Economy features were not configured for this session. These defaults will apply if you fork it." This is consistent with the backward-compat approach established in Phase 1 (CONF-03).

2. **D-10: Should `POST /fork-simulation` be surfaced for "branch from iteration N"?**
   - What we know: The endpoint exists at line 413 in `sessions.ts`. Context.md marks this as evaluation-required (D-10), but the deferred section lists it as out of scope.
   - Recommendation: Do not surface it in Phase 6. Label it deferred per the CONTEXT.md deferred section.

3. **Should new comparison dimensions 6-8 appear for sessions without economy telemetry?**
   - What we know: Pre-economy sessions won't have `m1`, `giniCoefficient`, or `infrastructureQuality` in their iteration statistics.
   - Recommendation: Pass `null`/`undefined` for missing fields to the LLM prompt, and note in the prompt: "Score as N/A if data is unavailable." The `ComparisonDimension` type already accepts a string `analysis` — the LLM can write "Data not available for this session type" as the analysis for missing dimensions.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 6 is purely code/config changes. No external tools, services, or CLIs beyond the project's existing Node.js/npm environment are required.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (in `server/vitest.config.ts`) |
| Config file | `server/vitest.config.ts` |
| Quick run command | `npm run test -w server` |
| Full suite command | `npm run test -w server` |

### Phase Requirements → Test Map

This phase has no dedicated REQUIREMENTS.md entries (Phase 6 was added to roadmap after initial requirements definition). The relevant v1.0 requirements that Phase 6 surfaces in UI are already implemented (CONF-01, CONF-02, FISC-01, FISC-04). Tests below cover Phase 6's own logic:

| Behavior | Test Type | Automated Command | Notes |
|----------|-----------|-------------------|-------|
| Fork endpoint preserves `economyConfig` in cloned session | unit/integration | `npm run test -w server -- --reporter=verbose` | New test in `server/src/routes/__tests__/` or inline route test |
| Fork endpoint creates `fiscalBudget` record when source has `budgetAllocation` | unit | same | Verify `fiscalRepo.createBudget` call |
| Budget allocation validation: rejects allocations not summing to 1.0 | unit | same | Already partially tested via route |
| `EconomyParamDiff` computation: only shows changed params | unit | same | Pure function, easy to test |
| Comparison prompt includes 8 dimensions | integration | Manual / LLM call | Verify prompt string content |

### Wave 0 Gaps

- [ ] `server/src/routes/__tests__/fork.test.ts` — covers fork config cloning behavior (no existing fork test found)
- [ ] `server/src/routes/__tests__/compareParamDiff.test.ts` — covers `economyParamDiff` extraction logic

---

## Project Constraints (from CLAUDE.md)

All directives that apply to Phase 6 implementation:

- **Shared types**: `EconomyConfig`, `BudgetAllocation`, `SessionConfig`, `ComparisonResult`, `EconomyParamDiff` additions must go in `shared/src/types.ts`. Import via `@policylab/shared`.
- **Economic parameters**: All tunable economic parameters must be stored in session-level config via `EconomyConfig` type, never hardcoded (CONF-02). The Economy tab is the enforcement mechanism for this rule.
- **Prompt changes**: Comparison prompt expansion must be made in `server/src/llm/prompts.ts` only.
- **Zustand stores**: Domain-sliced; avoid cross-store coupling. Economy config state lives in `sessionDetailStore`, not a new store.
- **SSE/real-time**: Not applicable to this phase (config patching is plain REST).
- **asyncLogFlusher**: Not applicable (config writes are low-frequency, once-per-user-action).

---

## Sources

### Primary (HIGH confidence)
- `web/src/pages/DesignReview.tsx` — full tab structure, Advanced Control pattern, fork button, stat editing pattern
- `web/src/stores/sessionDetailStore.ts` — config patching pattern, store action structure
- `server/src/routes/sessions.ts` lines 308-409 — config PATCH + fork endpoint code
- `server/src/routes/compare.ts` — comparison endpoint, `loadSessionSummary` structure
- `web/src/pages/CompareSessions.tsx` — dimension rendering, `ComparisonDimension` consumption
- `web/src/stores/compareStore.ts` — comparison state shape
- `shared/src/types.ts` — `EconomyConfig`, `SessionConfig`, `ComparisonResult`, `BudgetAllocation`, `TelemetryLog` definitions
- `server/src/mechanics/physicsConfig.ts` — parameter range patterns, existing config structure
- `server/src/llm/prompts.ts` lines ~1309-1365 — comparison prompt with 5 hardcoded dimensions
- `server/vitest.config.ts` — test framework configuration

### Secondary (MEDIUM confidence)
- Real-world reserve ratio data (US 10%, EU 1%, China 12.5%) — well-documented public figures; appropriate for tooltips

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present in codebase
- Architecture patterns: HIGH — all patterns traced to specific file lines
- Parameter ranges: MEDIUM — derived from defaults + real-world analogies; calibration may need adjustment after simulating
- Pitfalls: HIGH — all grounded in actual code paths read

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable codebase, no fast-moving dependencies)
