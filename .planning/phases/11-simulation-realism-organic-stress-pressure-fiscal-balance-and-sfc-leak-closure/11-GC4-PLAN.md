---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC4
type: execute
wave: 2
depends_on: [GC3]
files_modified:
  - web/src/components/EconomyTab.tsx
  - web/src/components/TaxPolicyEditor.tsx
  - server/src/routes/sessions.ts
  - shared/src/types.ts
  - server/src/__tests__/putConfigTaxPolicyValidation.test.ts
  - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md
autonomous: false
gap_closure: true
requirements: [GC-02]
decisions_addressed: [GC-02]
must_haves:
  truths:
    - "Policymakers can edit taxPolicy at design stage BEFORE simulation starts — kind selector, flat rates, or progressive brackets"
    - "The editor disables (opacity 0.5 + cursor not-allowed + lock tooltip) after simulation starts, mirroring GovernanceToggle from 11-09"
    - "Server-side validateTaxPolicy runs on every PUT /config that includes economyConfig.taxPolicy — invalid shapes are rejected with 400"
    - "Manual edits set sources.taxPolicy = 'user' so future re-bootstraps distinguish user preference from stale derivation"
    - "Progressive bracket editor enforces: at least one bracket, strictly-increasing upto, first bracket min=0"
  artifacts:
    - path: "web/src/components/TaxPolicyEditor.tsx"
      provides: "Controlled form with kind selector (flat | progressive), rate inputs, bracket editor"
      min_lines: 100
    - path: "server/src/routes/sessions.ts"
      provides: "validateTaxPolicy call inside PUT /config handler; 400 on invalid input"
      contains: "validateTaxPolicy"
    - path: "shared/src/types.ts"
      provides: "DataSource includes 'user' (if not already); TaxPolicy import clean"
      contains: "'user'"
    - path: ".planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md"
      provides: "Updated TaxPolicyEditor section replacing TaxPolicyReadout"
  key_links:
    - from: "web/src/components/TaxPolicyEditor.tsx"
      to: "PUT /api/sessions/:id/config with { economyConfig: { taxPolicy, sources: { taxPolicy: 'user' } } }"
      via: "onEconomyConfigChange callback (existing pattern from other EconomyTab controls)"
      pattern: "onEconomyConfigChange.*taxPolicy"
    - from: "server/src/routes/sessions.ts:398-400 PUT /config"
      to: "validateTaxPolicy helper"
      via: "body.economyConfig.taxPolicy = validateTaxPolicy(body.economyConfig.taxPolicy) BEFORE merge"
      pattern: "validateTaxPolicy\\(body"
---

<objective>
Close G4 by replacing the read-only `TaxPolicyReadout` at `web/src/components/EconomyTab.tsx:245` (and its mount at `:643`) with a fully-editable `TaxPolicyEditor`. Per forensics-G3 §5 and user request:

- **Kind selector** (radio or toggle): flat | progressive
- **Rate inputs**: `income`, `vat`, `capitalGains` — 0-50%, step 0.5
- **Bracket editor** (progressive only): array of `{ upto, rate }` rows with add/remove; enforce non-empty + strictly-increasing `upto`; first row must have `upto > 0`
- **DataConfidenceBadge**: swaps from "Estimate" (source=`llm` or `api`) to "Custom" (source=`user`) after manual edit
- **Disabled after simulation start**: mirror GovernanceToggle from 11-09 — use `isPastCheckpoint` prop already threaded through ScenarioTabs → EconomyTab
- **Server validation**: PUT `/api/sessions/:id/config` MUST call `validateTaxPolicy(body.economyConfig.taxPolicy)` before merging into stored config. Currently the PUT handler at `server/src/routes/sessions.ts:398-400` shallow-merges blindly. Invalid shapes return 400.
- **Source tracking**: on manual edit, `sources.taxPolicy = 'user'` persists alongside the policy

**Dependency note:** This plan depends on 11-GC3 so the default policy users see (before any manual edit) reflects the correctly-calibrated heuristic. If users edit routinely, it's because they disagree with a correct default — not because the derivation is broken.

**UI-SPEC update:** The existing `11-UI-SPEC.md` §Component Inventory names `TaxPolicyReadout` as non-interactive. Update the spec to rename the component to `TaxPolicyEditor` and document the form contract (kind selector, rate inputs, bracket editor, disabled state, source badge transition). This keeps the design contract honest for future plans.

Purpose: Without G4, users who spot a bad default (remaining edge cases after GC3) have no way to correct it. Locks taxPolicy to whatever the Central Agent chose at design, defeating the scenario-builder value.

Output: TaxPolicyEditor component + server-side validation + DataSource `'user'` enum + UI-SPEC update + 2 regression tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-09-SUMMARY.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G3-taxpolicy-flat-fallback.md
@CLAUDE.md

<interfaces>
<!-- Extracted from codebase. Executor uses these directly — no exploration needed. -->

From web/src/components/EconomyTab.tsx:245-296 (current TaxPolicyReadout — to be REPLACED):
```tsx
function TaxPolicyReadout({ policy }: { policy: TaxPolicy | undefined }) {
  return (
    <div style={{
      padding: '16px 16px 8px',
      borderRadius: '10px',
      background: 'var(--glass-bg)',
      border: '1px solid var(--glass-border)',
      marginBottom: '16px',
    }}>
      {/* ... read-only render for flat / progressive / empty ... */}
    </div>
  );
}
```
Mount site at line 643: `<TaxPolicyReadout policy={economyConfig.taxPolicy} />`

From 11-09-SUMMARY.md patterns established:
- `isPastCheckpoint` is threaded DesignReview → ScenarioTabs → EconomyTab as a boolean prop
- EconomyTab has an `onEconomyConfigChange?: (patch: Partial<EconomyConfig>) => void` callback for all its sliders
- Disabled pattern: `opacity: 0.5; cursor: not-allowed; title="Locked after simulation starts."`
- DataConfidenceBadge: reusable component that accepts `source`, `confidence`, `sourceNote` props. Check `web/src/components/DataConfidenceBadge.tsx` for the exact prop shape.

From server/src/routes/sessions.ts:380-420 (PUT /config handler — current shallow merge):
```typescript
updatedConfig = { ...currentConfig };
if (body.economyConfig !== undefined) {
  const existingEconomy = (currentConfig.economyConfig ?? {}) as Record<string, unknown>;
  updatedConfig.economyConfig = { ...existingEconomy, ...body.economyConfig };
}
```
No validation. GC4 must add a `validateTaxPolicy` call + reject-on-invalid behavior.

From server/src/mechanics/economyConfigUtils.ts:
```typescript
export function validateTaxPolicy(input: unknown): TaxPolicy;
// Total function — returns a valid TaxPolicy for any input, coercing malformed shapes.
```
Key insight for GC4: validateTaxPolicy is TOTAL (never throws). For GC4's PUT validation, we need either:
- **Option A**: Strict validator that throws on invalid — add a new `assertValidTaxPolicy(input): TaxPolicy` sibling OR a flag on validateTaxPolicy
- **Option B**: Call validateTaxPolicy, compare result to input, return 400 if divergent (rejects shape corruption but accepts clamped values)
**Prefer Option B** — keeps the validator's total contract intact, only the server route checks for "did the input get coerced?" If yes, 400.

From shared/src/types.ts: DataSource type (search for it):
```typescript
export type DataSource = 'api' | 'web' | 'llm' | 'user';  // ← confirm 'user' exists; add if missing
```
(If 'user' is already present — skip the types patch for that part.)

From 11-UI-SPEC.md §Component Inventory (lines ~195-210): `TaxPolicyReadout` listed as non-interactive. GC4 renames + documents editor contract.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED + GREEN — server-side validateTaxPolicy in PUT /config handler</name>
  <files>server/src/routes/sessions.ts, server/src/__tests__/putConfigTaxPolicyValidation.test.ts, shared/src/types.ts</files>
  <read_first>
    - server/src/__tests__/putConfigTaxPolicyValidation.test.ts (new — will not exist)
    - server/src/routes/sessions.ts (read full — understand PUT /config handler at lines 370-440, all existing validation patterns)
    - server/src/mechanics/economyConfigUtils.ts (full 105 lines — confirm validateTaxPolicy signature + DEFAULT_TAX_POLICY)
    - shared/src/types.ts (grep `DataSource` + `TaxPolicy` — confirm enum includes 'user')
    - server/src/__tests__/ (scan for any existing route-level tests; use supertest or direct handler invocation pattern)
  </read_first>
  <behavior>
    Test 1 (RED→GREEN): "PUT /config with valid flat taxPolicy is accepted"
      - Request body: `{ economyConfig: { taxPolicy: { kind: 'flat', rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 } } } }`
      - Assert: response 200, stored config contains the taxPolicy verbatim
    Test 2 (RED→GREEN): "PUT /config with valid progressive taxPolicy is accepted"
      - Body includes: `{ kind: 'progressive', rates: {...}, brackets: [{upto: 500, rate: 0.1}, {upto: 5000, rate: 0.2}] }`
      - Assert: 200, stored verbatim
    Test 3 (FAILS today, RED): "PUT /config with malformed taxPolicy.kind returns 400"
      - Body: `{ kind: 'wealth-tax', rates: {} }` (invalid kind)
      - Assert: response 400 with error containing `taxPolicy`
      - Today this returns 200 with the merge blindly accepting garbage; post-fix returns 400.
    Test 4 (FAILS today, RED): "PUT /config with non-increasing progressive brackets returns 400"
      - Body: `{ kind: 'progressive', rates: {...}, brackets: [{upto: 1000}, {upto: 500}] }`
      - Assert: 400
    Test 5 (RED→GREEN): "PUT /config with taxPolicy but no other economyConfig fields merges shallowly without wiping"
      - Pre-state: session has `economyConfig = { reserveRequirement: 0.1, taxPolicy: {...old} }`
      - Body: `{ economyConfig: { taxPolicy: {...new} } }`
      - Assert: after PUT, `economyConfig.reserveRequirement === 0.1` AND `economyConfig.taxPolicy === new`
  </behavior>
  <action>
    **Step 1 — shared/src/types.ts:** Grep for existing `DataSource` type. If `'user'` is NOT in the union, add it: `export type DataSource = 'api' | 'web' | 'llm' | 'user';`. Commit separately if already present — move on.

    **Step 2 — RED tests:** Create `server/src/__tests__/putConfigTaxPolicyValidation.test.ts`. Use supertest if the project has it (check `package.json` dependencies); otherwise invoke the Express handler directly with mock req/res. Base patterns on any existing route tests in `server/src/__tests__/` or `server/src/routes/__tests__/`. If no test pattern exists, create a minimal helper that boots an express app instance with the sessions router.

    **Step 3 — GREEN patch at sessions.ts:398-400:**
    Before the merge, add validation (**Option B — coerce-comparison approach**):
    ```ts
    if (body.economyConfig !== undefined) {
      // Phase 11 GC4 / forensics-G3 §5: server-side taxPolicy validation.
      // PUT path previously bypassed validateTaxPolicy (invoked only at bootstrap +
      // creative-design paths); without this guard, malformed shapes from the UI (or
      // a rogue client) would silently merge and corrupt session state.
      const incoming = body.economyConfig as Record<string, unknown>;
      if (incoming.taxPolicy !== undefined) {
        const validated = validateTaxPolicy(incoming.taxPolicy);
        // Reject if validator coerced the input (shape mismatch). We accept clamped
        // values — validateTaxPolicy clamps rates to [0, 0.5] silently, which is a
        // documented part of its total contract — but we refuse structural corruption
        // (wrong kind, non-increasing brackets, non-object).
        const looksCoerced =
          (typeof incoming.taxPolicy !== 'object' || incoming.taxPolicy === null) ||
          (incoming.taxPolicy as { kind?: string }).kind !== validated.kind ||
          (validated.kind === 'progressive' && !Array.isArray((incoming.taxPolicy as { brackets?: unknown }).brackets));
        if (looksCoerced) {
          throw Object.assign(
            new Error('Invalid taxPolicy shape — must be { kind: "flat"|"progressive", rates: {...}, brackets?: [{upto, rate}] with strictly-increasing upto }'),
            { status: 400 }
          );
        }
        incoming.taxPolicy = validated;
      }
      const existingEconomy = (currentConfig.economyConfig ?? {}) as Record<string, unknown>;
      updatedConfig.economyConfig = { ...existingEconomy, ...incoming };
    }
    ```
    Import `validateTaxPolicy` from `../mechanics/economyConfigUtils.js` at the top of sessions.ts if not already imported.

    **Commit messages (atomic):**
    1. `test(11-GC4): add PUT /config taxPolicy validation tests`
    2. (if shared types patched) `chore(11-GC4): add 'user' to DataSource union`
    3. `fix(11-GC4): validate taxPolicy shape in PUT /config handler`
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/putConfigTaxPolicyValidation.test.ts && npm run test -w server</automated>
  </verify>
  <acceptance_criteria>
    - grep `validateTaxPolicy\(incoming.taxPolicy\)` in server/src/routes/sessions.ts returns 1 match
    - grep `Invalid taxPolicy shape` in server/src/routes/sessions.ts returns 1 match
    - grep `import.*validateTaxPolicy.*economyConfigUtils` in server/src/routes/sessions.ts returns 1 match
    - `npx vitest run server/src/__tests__/putConfigTaxPolicyValidation.test.ts` shows 5 passed, 0 failed
    - `npx vitest run server/src/__tests__/sfcPhase11.test.ts` shows all passing (INFO-9 belt-and-suspenders — transitively covered by full suite but explicit for clarity)
    - `npm run test -w server` shows no new failures (≥ 506 passed, ≤ 5 pre-existing failures)
    - git log -3 --format=%s contains `test(11-GC4)` and `fix(11-GC4)`
  </acceptance_criteria>
  <done>Server-side validation blocks invalid taxPolicy at PUT /config; shape regressions from frontend are rejected with 400; shallow merge of other fields still works.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: TaxPolicyEditor component + wire into EconomyTab + update 11-UI-SPEC.md</name>
  <files>web/src/components/TaxPolicyEditor.tsx, web/src/components/EconomyTab.tsx, .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md</files>
  <read_first>
    - web/src/components/EconomyTab.tsx (read lines 1-300 to understand imports + TaxPolicyReadout + prop threading, and lines 620-700 for the Fiscal section mount)
    - web/src/components/DataConfidenceBadge.tsx (confirm prop shape — source/confidence/sourceNote)
    - web/src/components/GovernanceToggle.tsx (IF extracted — otherwise inline in EconomyTab; find the governance toggle logic circa the Fiscal section; use as the disabled-state template)
    - web/src/stores/scenarioStore.ts (understand how PUT /config fires — the `onEconomyConfigChange` flow)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md §Component Inventory + §TaxPolicy Readout (lines ~143-155, 200-210)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-09-SUMMARY.md §Tech tracking patterns (theme tokens, a11y, verbatim copy)
  </read_first>
  <behavior>
    After this task:
    - TaxPolicyEditor renders a controlled form with:
      - Kind radio/toggle (flat | progressive)
      - For `flat`: three number inputs (income/vat/capitalGains) 0-50%, step 0.5
      - For `progressive`: three rate inputs (rates.income/vat/capitalGains as defaults) + a bracket editor — each row `{ upto, rate }` with Add Row / Remove Row buttons; empty grid blocked (min 1 row); validation inline (non-increasing upto shown as red border + error text)
      - DataConfidenceBadge shows "Estimate" (source=llm|api) or "Custom" (source=user) — transition-aware
      - Disabled appearance (opacity 0.5, cursor not-allowed, title='Locked after simulation starts.') when `isPastCheckpoint` is true
    - On any change, EconomyTab calls `onEconomyConfigChange({ taxPolicy: newPolicy, sources: { ...existing, taxPolicy: 'user' } })` — patch includes sources so manual edits flag correctly
    - In EconomyTab.tsx: the `<TaxPolicyReadout />` JSX at line 643 is replaced with `<TaxPolicyEditor policy={economyConfig.taxPolicy} source={bootstrapSources?.taxPolicy} isPastCheckpoint={isPastCheckpoint} onChange={...} />`
    - The old `function TaxPolicyReadout(...)` block (lines 245-ish-296) is DELETED (moved into the new component file with editor behavior; retain the empty-state copy).
    - UI-SPEC is updated: rename §TaxPolicy Readout to §TaxPolicy Editor; document new behavior contract.
  </behavior>
  <action>
    **Step 1 — create TaxPolicyEditor.tsx:**
    Create `web/src/components/TaxPolicyEditor.tsx` as a new file. ~150-200 lines.

    Component contract:
    ```tsx
    import { useState } from 'react';
    import type { TaxPolicy, DataSource } from '@policylab/shared';
    import { DataConfidenceBadge } from './DataConfidenceBadge';

    export interface TaxPolicyEditorProps {
      policy: TaxPolicy | undefined;
      source: DataSource | undefined;  // 'api' | 'llm' | 'user'; maps to Estimate vs Custom badge
      isPastCheckpoint: boolean;
      onChange: (patch: { taxPolicy: TaxPolicy; source: DataSource }) => void;
    }

    export function TaxPolicyEditor({ policy, source, isPastCheckpoint, onChange }: TaxPolicyEditorProps) {
      // Controlled form logic:
      // - Kind selector with two radio buttons
      // - When flat: 3 rate inputs (income, vat, capitalGains) with range 0-50, step 0.5, display as %
      // - When progressive: 3 baseline rate inputs + bracket table with +/- row controls
      //   Validation: brackets non-empty, strictly increasing upto, first upto > 0
      // - On any field edit: emit onChange({ taxPolicy: newPolicy, source: 'user' }) — always flag as user
      // - When isPastCheckpoint: wrap entire editor with
      //     style={{ opacity: 0.5, pointerEvents: 'none' }} title="Locked after simulation starts."
      //   and disable all inputs
    }
    ```

    Styling: reuse the EXISTING sectionStyle padding/border/radius/background from the old TaxPolicyReadout:
    ```tsx
    padding: '16px 16px 8px',
    borderRadius: '10px',
    background: 'var(--glass-bg)',
    border: '1px solid var(--glass-border)',
    marginBottom: '16px',
    ```
    Theme-token-only (no hex). Labels/subheadings match the existing typography scale (0.78rem section title, 0.82rem body, 0.7rem badge).

    Copy (VERBATIM from 11-UI-SPEC.md + forensics-G3 §5):
    - Section heading (replaces "Tax Policy (chosen at design)"): **"Tax Policy"**
    - Subheading (if source === 'api' or 'llm'): "Suggested by the Central Agent from real-world context. Adjust if the default does not reflect your policy."
    - Subheading (if source === 'user'): "Custom tax policy. Reset by re-running bootstrap if you want the data-driven default back."
    - Empty-state (policy === undefined): "No tax policy configured — this session predates Phase 11. Default flat 10% will apply. Start editing to add a custom policy."
    - Kind selector labels: "Flat" | "Progressive"
    - Flat rate labels: "Income rate", "VAT rate", "Capital gains rate" — all followed by "%"
    - Progressive bracket row labels: "Up to wealth: {upto}" + "Rate: {rate}%"
    - Add row button: "+ Add bracket"
    - Remove row button: "Remove" (trashcan icon from lucide-react optional)
    - Validation errors (inline, color var(--color-red)):
      - "Brackets must have strictly increasing wealth thresholds"
      - "At least one bracket is required for progressive tax"
      - "First bracket must start above zero"

    Use `DataConfidenceBadge` with:
    - `source==='user'` → `<DataConfidenceBadge source="user" confidence="high" sourceNote="Custom — set by you in the design stage" />`
    - else → `<DataConfidenceBadge source={source ?? 'llm'} confidence="medium" sourceNote="Estimate — generated from bootstrap data" />`

    **Step 2 — patch EconomyTab.tsx:**
    a. Import: `import { TaxPolicyEditor } from './TaxPolicyEditor';`
    b. Remove `function TaxPolicyReadout(...)` block (lines 245-296).
    c. At line 643 mount site, replace `<TaxPolicyReadout policy={economyConfig.taxPolicy} />` with:
    ```tsx
    <TaxPolicyEditor
      policy={economyConfig.taxPolicy}
      source={bootstrapSources?.taxPolicy as DataSource | undefined}
      isPastCheckpoint={isPastCheckpoint ?? false}
      onChange={({ taxPolicy, source }) => onEconomyConfigChange({
        taxPolicy,
        // Preserve all other sources; only overwrite taxPolicy source
        sources: { ...(bootstrapSources ?? {}), taxPolicy: source },
      } as Partial<EconomyConfig>)}
    />
    ```
    (Adjust the `onEconomyConfigChange` invocation to match the real prop name and how `bootstrapSources` is passed into EconomyTab. The existing mechanism already exists for other Sources-aware updates; mirror it.)

    **Step 3 — update 11-UI-SPEC.md:**
    Open `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md`. Edit:
    1. §Scope Summary table: change the Governance toggle / TaxPolicy readout row to say "TaxPolicy editor (was readout)".
    2. §Component Inventory: rename `TaxPolicyReadout` to `TaxPolicyEditor`; change "new" to "revised in GC4"; update the Source of truth line to say "D-13 + GC4".
    3. §Copywriting Contract §TaxPolicy Readout → rename section to §TaxPolicy Editor (D-13 + GC4). Replace the copy with the VERBATIM strings from Step 1 above.
    4. Add a new subsection §Interaction Contract §TaxPolicy Editor below the §Governance Toggle interaction block:
       - Idle: Controlled form. User can switch kind, edit rates, add/remove brackets.
       - Hover/focus: same pattern as other EconomyTab inputs (primary-glow ring).
       - Disabled (post-checkpoint): opacity 0.5, cursor not-allowed, pointerEvents none.
       - Validation errors display inline with var(--color-red); save button (if any) stays enabled but the server rejects on PUT.
       - Source badge transition: "Estimate" → "Custom" immediately on first change.
    5. §Integration Contract §Write path — add paragraph:
       - "TaxPolicy edits flow through PUT /api/sessions/:id/config with body `{ economyConfig: { taxPolicy, sources: { taxPolicy: 'user' } } }`. Server validates via `validateTaxPolicy`; invalid shapes return 400. (GC4 / forensics-G3 §5)"

    **Commit messages:**
    1. `feat(11-GC4): TaxPolicyEditor replaces read-only readout with editable form`
    2. `docs(11-GC4): update 11-UI-SPEC for TaxPolicyEditor contract`

    **Verify web build:** `npm run build -w web` — must succeed.
  </action>
  <verify>
    <automated>npm run build -w web && npm run lint -w web</automated>
  </verify>
  <acceptance_criteria>
    - File `web/src/components/TaxPolicyEditor.tsx` exists with `≥ 100` lines
    - grep `export function TaxPolicyEditor` in web/src/components/TaxPolicyEditor.tsx returns 1 match
    - grep `TaxPolicyReadout` in web/src/components/EconomyTab.tsx returns 0 matches (old component removed)
    - grep `TaxPolicyEditor` in web/src/components/EconomyTab.tsx returns 2 matches (import + mount)
    - grep `'user'` in web/src/components/TaxPolicyEditor.tsx returns ≥ 1 match (source tracking)
    - grep `isPastCheckpoint` in web/src/components/TaxPolicyEditor.tsx returns ≥ 2 matches (prop + usage)
    - grep `opacity: 0.5` in web/src/components/TaxPolicyEditor.tsx returns 1 match (disabled state)
    - grep `TaxPolicyEditor` in .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-UI-SPEC.md returns ≥ 3 matches (section heading + inventory + interaction)
    - grep `#[0-9a-fA-F]\{3,6\}` in web/src/components/TaxPolicyEditor.tsx returns 0 matches (theme-token-only rule)
    - **WARNING 5 — validation-logic grep acceptance (editor validates, not just exists):**
      - grep `strictly increasing` in web/src/components/TaxPolicyEditor.tsx returns ≥ 1 match (non-increasing bracket error string present)
      - grep `At least one bracket` in web/src/components/TaxPolicyEditor.tsx returns ≥ 1 match (empty-bracket error string present)
      - grep -E `First bracket must start above zero|first bracket must start` web/src/components/TaxPolicyEditor.tsx returns ≥ 1 match (zero-upto error string present)
    - `npm run build -w web` exits 0
    - git log -2 --format=%s contains `feat(11-GC4)` and `docs(11-GC4)`
  </acceptance_criteria>
  <done>TaxPolicyEditor component shipped + wired in EconomyTab + UI-SPEC updated to match the revised contract. Web build passes. Lint clean.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human UAT — TaxPolicyEditor design-stage flow</name>
  <what-built>
    Editable TaxPolicyEditor in the Fiscal section of Design Review's Economy tab. Replaces the read-only TaxPolicyReadout from 11-09. Server-side validation on PUT /config. Source-tag transitions from 'api'/'llm' → 'user' on manual edit. Disabled after simulation starts.
  </what-built>
  <how-to-verify>
    1. Start dev servers: `npm run dev` — verify both backend (Express on :3001) and frontend (Vite on :5173) start cleanly.
    2. Bootstrap a fresh **United States** session via the location-mode entry (IdeaInput → "Mirror a Real Location" → "United States" → 30 agents → no scenario text).
    3. After bootstrap completes, land on Design Review. Scroll to the Economy tab → Fiscal section.
    4. **Verify default correctness (depends on GC3):** The TaxPolicyEditor should show `kind = progressive` with 3 brackets. Badge should say "Estimate" with source='api'.
    5. **Verify editability:**
       - Toggle kind from `progressive` to `flat`. Confirm the bracket editor disappears and 3 rate inputs show.
       - Change `income` rate from the default to `0.25` (25%). Confirm the badge transitions to "Custom" (source='user').
       - Toggle back to `progressive`. Add a new bracket. Confirm a new row appears with default `{upto: previousMax+1000, rate: 0.2}` or similar sensible seed.
       - Try to set a bracket `upto` lower than the previous row's `upto`. Confirm inline red error message "Brackets must have strictly increasing wealth thresholds" — and the save should be gated or visibly rejected.
    6. **Verify server rejection:** Open DevTools → Network. Manually fire a PUT to `/api/sessions/{id}/config` with body `{ economyConfig: { taxPolicy: { kind: 'wealth-tax', rates: {} } } }` (use curl or fetch from console). Confirm response is `400` with error message containing `taxPolicy`.
    7. **Verify lock state:** Click "Start Simulation". Wait a few seconds for the simulation to enter the Simulating stage. Return to Design Review (via back/nav if UI allows, or inspect the page in-place). Confirm the TaxPolicyEditor is now visually disabled (opacity 0.5, cursor not-allowed) and tooltip "Locked after simulation starts." appears on hover.
    8. **Verify both themes:** Toggle dark/light theme (if the app has a toggle). Confirm the editor renders correctly in both — no hex-literal contrast issues, DataConfidenceBadge tooltip still opaque/readable (regression guard for 11-09's UAT fix).
    9. **Verify accessibility:** Tab through the editor with keyboard only. Confirm focus rings appear on each input. Use a screen reader (VoiceOver/NVDA) to confirm the disabled-state tooltip is announced.

    Resume only if all 9 checks pass. If any UI/UX issue surfaces, decide in-band fix vs deferred (matching 11-09's UAT pattern — single-file single-token tweaks are in-band; anything touching component architecture is deferred with a new gap-closure plan).
  </how-to-verify>
  <resume-signal></resume-signal>
  <action>See how-to-verify above. Executor pauses; user performs the verification steps manually; user responds with approval or describes issues.</action>
  <verify>Manual human verification per how-to-verify steps; no automated command (this is a checkpoint).</verify>
  <done>User types "approved" after confirming all listed verification steps pass.</done>
</task>

</tasks>

<verification>
- grep `export function TaxPolicyEditor` web/src/components/TaxPolicyEditor.tsx: 1 match
- grep `TaxPolicyReadout` web/src/components/EconomyTab.tsx: 0 matches
- grep `validateTaxPolicy\(incoming.taxPolicy\)` server/src/routes/sessions.ts: 1 match
- grep `TaxPolicyEditor` .planning/phases/11-.../11-UI-SPEC.md: ≥ 3 matches
- `npm run build -w web`: exits 0
- `npx vitest run server/src/__tests__/putConfigTaxPolicyValidation.test.ts`: 5 passed, 0 failed
- Human UAT: 9/9 checks passed
</verification>

<success_criteria>
- Policymakers can correct a bootstrap-derived taxPolicy at design time without touching the CLI.
- Server enforces shape validity — no garbage taxPolicy reaches `session.config`.
- Manual edits are traceable: `sources.taxPolicy = 'user'` so future re-bootstraps know this was a user choice.
- Editor locks after simulation start, matching 11-09's GovernanceToggle pattern — zero drift from Phase-11 interaction conventions.
- UI-SPEC is source-of-truth for the new editable contract.
</success_criteria>

<output>
After completion, create `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC4-SUMMARY.md` with:
- Commits list (expected: 1 test + 1-2 server fix + 1 feat component + 1 docs UI-SPEC + possibly 1 UAT-fix in-band)
- UAT checklist outcome (9/9 or list of deferred items)
- Screenshots or short description of editor in both themes (if user provided)
- Confirmation that 11-UI-SPEC.md now documents TaxPolicyEditor contract
- Hand-off note: 11-GC5 verification plan is the final gate before closing Phase 11
</output>
