---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: GC4
type: execute
wave: 1
depends_on: [12-GC1]
files_modified:
  - server/src/llm/centralAgent.ts
  - shared/src/types.ts
  - server/src/db/repos/macroSnapshotRepo.ts
  - server/src/db/repos/__tests__/macroSnapshotRepo.test.ts
gap_closure: true
autonomous: true
requirements: [L-02, L-11]
phase_req_ids: [L-02, L-11]
must_haves:
  truths:
    - "centralAgent.generateDesign invokes generateEnterprisesFromCentralAgent after the agent roster step (Step 3) and before the design-review stage transition"
    - "Generated enterprise blueprints are persisted via insertEnterprise so creative-mode sessions populate the enterprises DB table on the same path as location-mode sessions"
    - "If generateEnterprisesFromCentralAgent throws (3 retry exhaustion), the design step propagates the error and does NOT advance the session to design-review (mirrors how Phase 10 enterprise bootstrap failures work in location mode)"
    - "shared/src/types.ts DesignProgressEvent union admits step: 'enterprises' and totalSteps: number (broadened from literal 3) so the new Step 4 SSE events type-check"
    - "centralAgent.generateDesign disambiguates duplicate agent names BEFORE building agentNameToId (mirroring 12-GC2 bootstrap.ts fix) so creative-mode rosters with name collisions cannot resolve enterprise owner/employee names to wrong UUIDs"
    - "macroSnapshotRepo.rowToMacroSnapshot uses Drizzle row type inference for Phase 12 fields (no `(row as any)` casts) — column-name mismatches surface at compile time, not as silent nulls"
    - "Integration test: a fresh session's iteration-1 macro snapshot has reservationWageP25/P50/P75 NON-NULL when the caller passes the floor value (the typical case for a session with zero PAS activity)"
  artifacts:
    - path: "server/src/llm/centralAgent.ts"
      provides: "generateDesign Step 4: name disambiguation + enterprise generation via generateEnterprisesFromCentralAgent + insertEnterprise loop; SSE step_start/step_done events for the new step"
    - path: "shared/src/types.ts"
      provides: "DesignProgressEvent union extended: step admits 'enterprises'; totalSteps broadened from literal 3 to number"
    - path: "server/src/db/repos/macroSnapshotRepo.ts"
      provides: "rowToMacroSnapshot uses Drizzle's $inferSelect inference directly for the 8 Phase 12 fields; no any-cast"
    - path: "server/src/db/repos/__tests__/macroSnapshotRepo.test.ts"
      provides: "round-trip insert→read test asserting reservationWageP25/P50/P75 non-null when the caller passes the floor value"
  key_links:
    - from: "server/src/llm/centralAgent.ts generateDesign Step 3 completion"
      to: "server/src/data/creativeEnterpriseGeneration.ts generateEnterprisesFromCentralAgent"
      via: "import + invoke after agent batch insert, before stage transition"
      pattern: "generateEnterprisesFromCentralAgent\\("
    - from: "server/src/llm/centralAgent.ts (after generateEnterprisesFromCentralAgent returns)"
      to: "server/src/db/repos/enterpriseRepo.ts insertEnterprise"
      via: "for-loop persisting blueprints to the enterprises DB table"
      pattern: "insertEnterprise\\(session\\.id"
    - from: "server/src/llm/centralAgent.ts (BEFORE agentNameToId Map construction)"
      to: "unique-name guarantee on agentRows (mirrors 12-GC2 bootstrap.ts pattern)"
      via: "seenNameCounts loop that detects collisions and rewrites duplicates with numeric suffix"
      pattern: "seenNameCounts"
    - from: "shared/src/types.ts DesignProgressEvent"
      to: "centralAgent.ts Step 4 SSE event emission"
      via: "step union extended with 'enterprises'; totalSteps broadened to number"
      pattern: "'enterprises'"
    - from: "server/src/db/repos/macroSnapshotRepo.ts row read"
      to: "Drizzle MacroSnapshotRow type ($inferSelect on macroSnapshots schema)"
      via: "row.reservationWageP25 etc. typed via Drizzle inference instead of (row as any).reservationWageP25"
      pattern: "row\\.reservationWageP(25|50|75)"
---

<objective>
Close two related VERIFICATION gaps:

**Gap 5 (L-02):** `creativeEnterpriseGeneration.ts` exists with passing tests but is never wired into the creative-mode bootstrap flow. Creative-mode sessions fall back to location-mode `generateEnterprises`, which doesn't see the society overview and doesn't use the Central Agent LLM with retry-with-healing. Fix: invoke `generateEnterprisesFromCentralAgent` from `centralAgent.generateDesign` after the agent roster step, and persist the resulting blueprints via `insertEnterprise`.

**Gaps 6 + 7 (L-11):** `macroSnapshotRepo.rowToMacroSnapshot` uses `(row as any).reservationWageP25` etc., bypassing Drizzle type inference. This masks schema mismatches — if a column is renamed or absent, reads return `undefined` silently instead of failing at compile time. Fix: replace the `(row as any)` casts with direct typed reads from the `MacroSnapshotRow` type already exported on line 7. Add an integration test that asserts reservationWageP25/P50/P75 round-trip correctly when the caller passes the floor value (the typical case for a fresh session with zero PAS activity).

Purpose: L-02 (creative-mode enterprise generation in production code path), L-11 (telemetry persistence type-safety + integration coverage).
Output: centralAgent wiring + DesignProgressEvent type extension + name disambiguation + macroSnapshotRepo type-safe reads + new integration test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-CONTEXT.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-03-PLAN.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-07-PLAN.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-GC2-PLAN.md

<interfaces>
Existing module (server/src/data/creativeEnterpriseGeneration.ts:166-172):
```typescript
export async function generateEnterprisesFromCentralAgent(params: {
  overview: string;
  agentRoster: AgentBlueprint[];
  baseFiat: number;
  minimumWage: number;
  llm: LLMProvider;
}): Promise<EnterpriseBlueprint[]>
```
Throws on 3-attempt exhaustion: `Error('[Phase 12 L-03 creative-mode] Central Agent failed to generate valid enterprise roster after 3 attempts: <lastError>')`.

Existing centralAgent design pipeline (server/src/llm/centralAgent.ts:125-327):
- Step 1 (line 140-168): overview generation (3 LLM steps total — overview, law, agents).
- Step 2 (line 171-195): law generation.
- Step 3 (line 197-275): agent roster generation + DB insert in batches of 25.
- After Step 3: economyConfig injection (lines 276-318), bank agent insert (if bankingEnabled), then stage transition to design-review (lines 320-326).

The natural insertion point for Step 4 is INSIDE the `if (!existingConfig.economyConfig)` block, immediately after the bank-agent insert. That naturally scopes economyConfig and confines Step 4 to the creative-mode code path (location-mode already has its own enterprise bootstrap).

Existing imports at top of centralAgent.ts include `getProvider`, `db`, `sessions`, `agents` from various modules.

What needs to be added:
- `import { generateEnterprisesFromCentralAgent } from '../data/creativeEnterpriseGeneration.js';`
- `import { insertEnterprise } from '../db/repos/enterpriseRepo.js';`
- `import type { AgentBlueprint } from '@policylab/shared';`

Existing DesignProgressEvent (shared/src/types.ts:1087-1091):
```typescript
export type DesignProgressEvent =
  | { type: 'step_start'; step: 'overview' | 'law' | 'agents'; stepIndex: number; totalSteps: 3 }
  | { type: 'step_done'; step: 'overview' | 'law' | 'agents'; stepIndex: number }
  | { type: 'complete'; sessionStage: Stage }
  | { type: 'error'; step: string; message: string };
```
The `step` union and `totalSteps: 3` literal must be extended to admit the new Step 4 — TypeScript will reject `{ step: 'enterprises', totalSteps: 4 }` against the current type. Required changes:
- `step_start` variant: `step: 'overview' | 'law' | 'agents'` → `step: 'overview' | 'law' | 'agents' | 'enterprises'`
- `step_done` variant: same union extension
- `totalSteps: 3` → `totalSteps: number` (broaden to allow both 3 and 4 — caller decides)

Existing macroSnapshotRepo (server/src/db/repos/macroSnapshotRepo.ts:7-35):
```typescript
type MacroSnapshotRow = typeof macroSnapshots.$inferSelect;   // Drizzle type already inferred
type MacroSnapshotInsert = typeof macroSnapshots.$inferInsert;

function rowToMacroSnapshot(row: MacroSnapshotRow): MacroSnapshot {
  return {
    // ... existing typed fields ...
    avgPostedWage: (row as any).avgPostedWage ?? null,            // ← THE BUG
    unemploymentRate: (row as any).unemploymentRate ?? null,      // ← THE BUG
    reservationWageP25: (row as any).reservationWageP25 ?? null,  // ← THE BUG
    reservationWageP50: (row as any).reservationWageP50 ?? null,  // ← THE BUG
    reservationWageP75: (row as any).reservationWageP75 ?? null,  // ← THE BUG
    vacanciesTotal: (row as any).vacanciesTotal ?? null,          // ← THE BUG
    applicantsTotal: (row as any).applicantsTotal ?? null,        // ← THE BUG
    displacedThisIteration: (row as any).displacedThisIteration ?? null, // ← THE BUG
  };
}
```

The Drizzle schema (server/src/db/schema.ts:241-249) already declares all 8 columns with their proper types. So `MacroSnapshotRow` ALREADY has all 8 fields with `number | null` typing. The `(row as any)` cast is unnecessary and harmful — direct `row.reservationWageP25` etc. is type-safe.

Name-disambiguation pattern from 12-GC2-PLAN.md Task 2 (bootstrap.ts):
```typescript
const seenNameCounts = new Map<string, number>();
for (let i = 0; i < citizenRows.length; i++) {
  const baseName = citizenRows[i].name;
  const seen = seenNameCounts.get(baseName) ?? 0;
  if (seen > 0) {
    citizenRows[i].name = `${baseName} (${seen + 1})`;
  }
  seenNameCounts.set(baseName, seen + 1);
}
```
This same vulnerability exists in creative-mode: the LLM may emit duplicate names, which would silently collapse in `new Map(agentRows.map(r => [r.name, r.id]))` and produce wrong-UUID owner/employee assignments. GC1's dedup guard prevents DB duplicates but does NOT fix wrong-UUID mapping (an employee whose name collides will be mapped to a stranger's UUID). Mirror the GC2 pattern in GC4 Task 1 BEFORE building agentNameToId.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire generateEnterprisesFromCentralAgent into centralAgent.generateDesign</name>
  <files>server/src/llm/centralAgent.ts, shared/src/types.ts</files>
  <read_first>
    - server/src/llm/centralAgent.ts:1-50 (imports — confirm getProvider, LLMProvider availability)
    - server/src/llm/centralAgent.ts:125-327 (full generateDesign function — focus on the 3-step pipeline ending at line 326 with `onProgress({ type: 'complete', sessionStage: 'design-review' })`)
    - server/src/data/creativeEnterpriseGeneration.ts:1-220 (full module — confirm signature + AgentBlueprint shape requirements)
    - server/src/db/repos/enterpriseRepo.ts:18-41 (insertEnterprise signature)
    - shared/src/types.ts (lines 1080-1100 — DesignProgressEvent definition that must be extended; also AgentBlueprint shape — minimal required fields for creativeEnterpriseGeneration's isEmployableAgent filter)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-GC2-PLAN.md Task 2 (the bootstrap.ts disambiguation pattern to mirror)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 5 (acceptance: "wire generateEnterprisesFromCentralAgent into the creative-mode bootstrap flow" + "pass the LLM provider, overview, and agentRoster")
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-CONTEXT.md D-06, D-15
  </read_first>
  <behavior>
    - shared/src/types.ts DesignProgressEvent union extended to admit `step: 'enterprises'` (both step_start and step_done variants) and `totalSteps: number` (broadened from literal 3 so the caller can pass 3 or 4).
    - centralAgent.generateDesign gains a Step 4 (enterprise generation) AFTER the existing Step 3 (agents) and the bank-agent insert block, BEFORE the stage transition to design-review.
    - Step 4 emits SSE events: `{ type: 'step_start', step: 'enterprises', stepIndex: 3, totalSteps: 4 }` then `{ type: 'step_done', step: 'enterprises', stepIndex: 3 }` on success.
    - The existing 3 step events (`overview`, `law`, `agents`) keep their stepIndex (0, 1, 2) but their `totalSteps` arg should be bumped from 3 to 4 to keep the progress UI honest.
    - BEFORE building agentNameToId from agentRows, Step 4 disambiguates duplicate agent names with the SAME suffix pattern used in 12-GC2 Task 2 (bootstrap.ts). This prevents the LLM-emitted duplicate-name → wrong-UUID-assignment bug from corrupting enterprise owner/employee fields. GC1's dedup guard at the DB layer prevents duplicate INSERTs but does NOT fix wrong-UUID mapping; this disambiguation does.
    - On generateEnterprisesFromCentralAgent throwing (3-retry exhaustion), the function does NOT transition to design-review; it propagates the error so the SSE outer try/catch surfaces it. This mirrors how Phase 10 enterprise bootstrap failures work in location mode (bootstrap.ts aborts with SSE error on enrichment failure — STATE.md decision log).
    - Persisted enterprises go through the SAME insertEnterprise path that location-mode uses, so the simulationRunner load path (which 12-GC1 also updates) sees them identically.
  </behavior>
  <action>
    1. **Extend DesignProgressEvent in `shared/src/types.ts`** (lines 1087-1091):

    Find the current definition:

    ```typescript
    export type DesignProgressEvent =
      | { type: 'step_start'; step: 'overview' | 'law' | 'agents'; stepIndex: number; totalSteps: 3 }
      | { type: 'step_done'; step: 'overview' | 'law' | 'agents'; stepIndex: number }
      | { type: 'complete'; sessionStage: Stage }
      | { type: 'error'; step: string; message: string };
    ```

    Replace with (extends the step union to include 'enterprises' on BOTH variants; broadens totalSteps from literal 3 to number so the caller decides):

    ```typescript
    export type DesignProgressEvent =
      | { type: 'step_start'; step: 'overview' | 'law' | 'agents' | 'enterprises'; stepIndex: number; totalSteps: number }
      | { type: 'step_done'; step: 'overview' | 'law' | 'agents' | 'enterprises'; stepIndex: number }
      | { type: 'complete'; sessionStage: Stage }
      | { type: 'error'; step: string; message: string };
    ```

    Phase 12 GC4 provenance comment optional but nice: add `// Phase 12 GC4: 'enterprises' step + totalSteps broadened from 3 to number` above the type if it improves grep-ability.

    2. In `server/src/llm/centralAgent.ts`, add imports near the top of the file (next to existing imports):

    ```typescript
    import { generateEnterprisesFromCentralAgent } from '../data/creativeEnterpriseGeneration.js';
    import { insertEnterprise } from '../db/repos/enterpriseRepo.js';
    import type { AgentBlueprint } from '@policylab/shared';
    ```

    3. Bump `totalSteps` from `3` to `4` in the three existing `onProgress` calls within `generateDesign`. Find these three lines and update them:

       - Around line 140: change `totalSteps: 3` to `totalSteps: 4` in the overview step_start event.
       - Around line 171: change `totalSteps: 3` to `totalSteps: 4` in the law step_start event.
       - Around line 198: change `totalSteps: 3` to `totalSteps: 4` in the agents step_start event.

       The corresponding `step_done` events do not carry totalSteps and are unchanged.

       (The DesignProgressEvent type extension in step 1 above makes these literal-4 values type-check.)

    4. Insert a new Step 4 block INSIDE the `if (!existingConfig.economyConfig) { ... }` block, immediately AFTER the bank-agent insert block (after the closing brace of `if (economyConfig.bankingEnabled) { ... }` around line 318), still inside the outer `if (!existingConfig.economyConfig)`:

    ```typescript
        // ── Step 4: Phase 12 GC4 (closes Gap 5 / L-02) — Enterprise generation ──
        // Wire creativeEnterpriseGeneration.ts into the creative-mode bootstrap.
        // Without this, creative-mode sessions fall back to the location-mode
        // generateEnterprises which does not see the society overview.
        onProgress({ type: 'step_start', step: 'enterprises', stepIndex: 3, totalSteps: 4 });

        // Phase 12 GC4 defense: disambiguate duplicate agent names BEFORE building the
        // name→UUID map. Mirrors 12-GC2 bootstrap.ts fix — creative-mode LLM may also
        // emit duplicate names, which would silently collapse in `new Map(...)` and
        // produce wrong-UUID owner/employee assignments. GC1's DB-layer dedup guard
        // prevents duplicate INSERTs but does NOT fix wrong-UUID mapping (an employee
        // whose name collides would be mapped to a stranger's UUID). This loop fixes that.
        const seenNameCounts = new Map<string, number>();
        for (const row of agentRows) {
          const baseName = row.name;
          const seen = seenNameCounts.get(baseName) ?? 0;
          if (seen > 0) {
            row.name = `${baseName} (${seen + 1})`;
          }
          seenNameCounts.set(baseName, seen + 1);
        }
        // Now safe to build the map — names are unique.

        // Build minimal AgentBlueprint[] from the LLM agent output for the
        // generator's isEmployableAgent filter. Sector inference happens inside
        // creativeEnterpriseGeneration via the agent's role.
        const agentRoster: AgentBlueprint[] = agentsData.agents.map(a => ({
          name: a.name,
          role: a.role,
          background: a.background ?? '',
          initialStats: {
            wealth: a.initialStats?.wealth ?? 50,
            health: a.initialStats?.health ?? 70,
            happiness: a.initialStats?.happiness ?? 60,
            cortisol: a.initialStats?.cortisol ?? 20,
          },
          personalityTraits: Array.isArray(a.personalityTraits) ? a.personalityTraits.slice(0, 2) : [],
        } as unknown as AgentBlueprint));

        // Read baseFiat from the freshly written economyConfig (default 1000 if absent)
        const baseFiat = (economyConfig as { baseFiat?: number }).baseFiat ?? 1000;
        const minimumWage = (economyConfig as { minimumWage?: number }).minimumWage ?? 5;

        const blueprintList = await generateEnterprisesFromCentralAgent({
          overview: overviewData.overview,
          agentRoster,
          baseFiat,
          minimumWage,
          llm: provider,
        });

        // Persist via the same path location-mode uses
        const agentNameToId = new Map(agentRows.map(r => [r.name, r.id]));
        for (const bp of blueprintList) {
          // Resolve owner / employee names to UUIDs (same convention as location-mode bootstrap)
          const resolvedOwnerId = agentNameToId.get(bp.ownerId) ?? bp.ownerId;
          const resolvedEmployees = (bp.employees ?? [])
            .map(name => agentNameToId.get(name) ?? name);
          insertEnterprise(session.id, {
            ...bp,
            ownerId: resolvedOwnerId,
            employees: [...new Set(resolvedEmployees)],  // GC2-style dedup defense-in-depth
          });
        }

        onProgress({ type: 'step_done', step: 'enterprises', stepIndex: 3 });
        // ── End Step 4 ──
    ```

    5. Do NOT wrap the Step 4 block in a try/catch — let `generateEnterprisesFromCentralAgent`'s exhaustion error propagate up to the caller's outer try/catch (which converts it to an SSE error event). The session stage will NOT advance to design-review on failure, which is the correct behavior — bootstrap aborts cleanly.

    6. The final stage transition lines (around 320-326) remain unchanged. Note: the duplicate `step_done` for 'agents' at line 325 looks suspicious but pre-existing — leave it alone unless it breaks the new step ordering. (The `complete` event is what the UI watches for stage transition.)

    7. **Optional (consider): mirror the disambiguated name back to the DB.** The disambiguation loop mutates `agentRows[i].name` in memory, but the DB rows (already inserted in Step 3 batches) still hold the bare collided names. For consistency with 12-GC2's bootstrap.ts behavior, add a follow-up DB update inside the Step 4 block to persist the disambiguated names. If `db`, `agents`, `eq`, `sqlite` are not all imported in centralAgent.ts, you may either skip this DB mirror (the in-memory map is the only consumer that strictly needs uniqueness for this code path) OR add the missing imports. Document the choice in the GC4 SUMMARY. Recommended: mirror to DB if imports are already present; skip if it requires touching unrelated import surface.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -25</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "import { generateEnterprisesFromCentralAgent }" server/src/llm/centralAgent.ts` exits 0.
    - `grep -q "import { insertEnterprise }" server/src/llm/centralAgent.ts` exits 0.
    - `grep -q "generateEnterprisesFromCentralAgent({" server/src/llm/centralAgent.ts` exits 0.
    - `grep -q "step: 'enterprises'" server/src/llm/centralAgent.ts` exits 0.
    - `grep -q "'enterprises'" shared/src/types.ts` exits 0 (DesignProgressEvent union extended).
    - `grep -q "seenNameCounts" server/src/llm/centralAgent.ts` exits 0 (name-disambiguation loop present, mirroring 12-GC2 fix).
    - `grep -c "totalSteps: 4" server/src/llm/centralAgent.ts` returns at least 4 (the 3 bumped existing events + 1 new step_start for enterprises).
    - `grep -c "totalSteps: 3" server/src/llm/centralAgent.ts` returns 0 (the old totalSteps=3 has been replaced everywhere in this file).
    - `grep -c "totalSteps: 3" shared/src/types.ts` returns 0 (literal-3 broadened to number in DesignProgressEvent).
    - `npx tsc --noEmit -p server/tsconfig.json` shows no new errors related to centralAgent.ts or shared/src/types.ts.
    - `npm run test -w server -- --reporter=dot --run` exits 0 (no regression in any existing test, particularly the creativeEnterpriseGeneration tests which exercise the underlying module).
  </acceptance_criteria>
  <done>shared/src/types.ts DesignProgressEvent admits 'enterprises' + totalSteps:number; centralAgent.generateDesign disambiguates duplicate names then invokes generateEnterprisesFromCentralAgent on the creative-mode path; blueprints are persisted via insertEnterprise; SSE step events include the new 'enterprises' step; types compile.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Replace (row as any) casts in macroSnapshotRepo with Drizzle type inference</name>
  <files>server/src/db/repos/macroSnapshotRepo.ts</files>
  <read_first>
    - server/src/db/repos/macroSnapshotRepo.ts (full file — focus on rowToMacroSnapshot at lines 12-35)
    - server/src/db/schema.ts:228-250 (macroSnapshots schema — confirms all 8 Phase 12 columns are typed real()/integer() returning number | null)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gaps 6 + 7 (acceptance: "Remove (row as any) casts for Phase 12 macroSnapshot fields; use the Drizzle schema inference directly")
  </read_first>
  <behavior>
    - All 8 `(row as any).XXX` casts in rowToMacroSnapshot replaced with direct `row.XXX` access.
    - Since the schema columns are `real()` and `integer()` without `.notNull()`, Drizzle infers them as `number | null`. The MacroSnapshot consumer type accepts `number | null` already (the existing `?? null` pattern works on a typed `number | null` source).
    - No behavior change: read paths return the same values; writes are unchanged.
    - Compile-time safety: if a column is renamed or removed in schema.ts, this file fails to compile rather than silently returning undefined.
  </behavior>
  <action>
    1. In `server/src/db/repos/macroSnapshotRepo.ts`, find the `rowToMacroSnapshot` function (lines 12-35) and replace the 8 `(row as any).XXX` lines.

    Current lines 25-33:

    ```typescript
        // Phase 12 D-20: labor-market telemetry (nullable)
        avgPostedWage: (row as any).avgPostedWage ?? null,
        unemploymentRate: (row as any).unemploymentRate ?? null,
        reservationWageP25: (row as any).reservationWageP25 ?? null,
        reservationWageP50: (row as any).reservationWageP50 ?? null,
        reservationWageP75: (row as any).reservationWageP75 ?? null,
        vacanciesTotal: (row as any).vacanciesTotal ?? null,
        applicantsTotal: (row as any).applicantsTotal ?? null,
        displacedThisIteration: (row as any).displacedThisIteration ?? null,
    ```

    Replace with (Drizzle infers all of these as `number | null` from the schema; no cast needed):

    ```typescript
        // Phase 12 D-20: labor-market telemetry (nullable — typed via Drizzle $inferSelect; closes GC4 Gap 6 + 7)
        avgPostedWage: row.avgPostedWage ?? null,
        unemploymentRate: row.unemploymentRate ?? null,
        reservationWageP25: row.reservationWageP25 ?? null,
        reservationWageP50: row.reservationWageP50 ?? null,
        reservationWageP75: row.reservationWageP75 ?? null,
        vacanciesTotal: row.vacanciesTotal ?? null,
        applicantsTotal: row.applicantsTotal ?? null,
        displacedThisIteration: row.displacedThisIteration ?? null,
    ```

    2. Run `npx tsc --noEmit -p server/tsconfig.json`. The compile should succeed because `MacroSnapshotRow = typeof macroSnapshots.$inferSelect` already includes all 8 fields. If a real type error surfaces (e.g., MacroSnapshot type doesn't include one of these fields), update the MacroSnapshot type in shared/src/types.ts to add the missing optional fields with `number | null | undefined`.

    3. Do NOT change the `MacroSnapshotInsert` type or the `insertMacroSnapshot` function — those are already typed correctly via Drizzle.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "(row as any).reservationWage" server/src/db/repos/macroSnapshotRepo.ts` returns 0 (no any-casts remain on reservation wage fields).
    - `grep -c "(row as any)" server/src/db/repos/macroSnapshotRepo.ts` returns 0 (NO any-casts at all in this file after the cleanup).
    - `grep -c "row\.reservationWageP25" server/src/db/repos/macroSnapshotRepo.ts` returns at least 1 (direct typed access used).
    - `grep -c "row\.reservationWageP50" server/src/db/repos/macroSnapshotRepo.ts` returns at least 1.
    - `grep -c "row\.reservationWageP75" server/src/db/repos/macroSnapshotRepo.ts` returns at least 1.
    - `npx tsc --noEmit -p server/tsconfig.json` exits with no new errors vs baseline.
  </acceptance_criteria>
  <done>All 8 (row as any) casts replaced with direct typed reads; compile succeeds.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Integration test for macroSnapshotRepo round-trip with reservationWage non-null</name>
  <files>server/src/db/repos/__tests__/macroSnapshotRepo.test.ts</files>
  <read_first>
    - server/src/db/repos/macroSnapshotRepo.ts (after Task 2 — typed reads)
    - server/src/db/repos/__tests__/agentRepo.test.ts (style reference for vitest + sqlite test setup if it exists; if not, look at any other repo test for setup patterns; if 12-GC1 Task 2 created enterpriseRepo.test.ts in this same directory, mirror that setup pattern)
    - server/src/db/index.ts (db handle import path)
    - shared/src/types.ts MacroSnapshot interface (confirm field names + nullability)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 6 (acceptance: "Add an integration test that verifies reservationWageP25/P50/P75 are non-null in macroSnapshot after iteration 1 even with zero PAS activity")
  </read_first>
  <behavior>
    - New vitest module covering: insertMacroSnapshot then getLatestSnapshot round-trip preserves the 3 reservation-wage fields with their floor value (2.5).
    - Zero-PAS session simulation: caller passes reservationWageP25=2.5, P50=2.5, P75=2.5 (the floor when no agent has run PAS yet); after read-back, all three fields are exactly 2.5 (not null, not undefined).
    - Also asserts that omitting the fields entirely leaves them as null on read (not 2.5 — preserves the explicit-null contract for legacy rows).
  </behavior>
  <action>
    1. Create `server/src/db/repos/__tests__/macroSnapshotRepo.test.ts`. If `enterpriseRepo.test.ts` (created in 12-GC1 Task 2) exists in the same directory, mirror its setup pattern. If `agentRepo.test.ts` exists with a different pattern, mirror it instead. The test must use the project's standard test DB scaffolding.

    Required test cases:

    ```typescript
    import { describe, it, expect } from 'vitest';
    import { insertMacroSnapshot, getLatestSnapshot } from '../macroSnapshotRepo.js';
    import { db } from '../../index.js';

    describe('Phase 12 GC4: macroSnapshotRepo Phase 12 field round-trip', () => {
      const sessionId = 'test-session-gc4';

      it('round-trip preserves reservationWageP25/P50/P75 when caller passes the floor value (zero-PAS session)', () => {
        // Simulate iteration 1 of a fresh session where no agent has run PRODUCE_AND_SELL
        // yet: telemetry block populates the floor value max(minimumWage*0.5, 1) = 2.5
        // for every employable agent, so all three quartiles equal 2.5.
        insertMacroSnapshot(db, {
          sessionId,
          iterationNumber: 9991,  // unique number to avoid collision with other tests
          m0: 1000, m1: 1000, cpi: 1.0, inflationRate: 0,
          inflationExpectations: 0,
          totalLoansOutstanding: 0, treasuryBalance: 100,
          // Phase 12 fields the caller would supply at iter 1 of a fresh session:
          reservationWageP25: 2.5,
          reservationWageP50: 2.5,
          reservationWageP75: 2.5,
          unemploymentRate: 1.0,
          avgPostedWage: 5,
          vacanciesTotal: 30,
          applicantsTotal: 0,
          displacedThisIteration: 0,
        });

        const latest = getLatestSnapshot(db, sessionId);
        expect(latest).not.toBeNull();
        expect(latest!.reservationWageP25).toBe(2.5);
        expect(latest!.reservationWageP50).toBe(2.5);
        expect(latest!.reservationWageP75).toBe(2.5);
        expect(latest!.unemploymentRate).toBe(1.0);
        expect(latest!.avgPostedWage).toBe(5);
        expect(latest!.vacanciesTotal).toBe(30);
        expect(latest!.applicantsTotal).toBe(0);
        expect(latest!.displacedThisIteration).toBe(0);
      });

      it('round-trip preserves NULL when caller omits the Phase 12 fields (legacy row pattern)', () => {
        const legacySessionId = 'test-session-gc4-legacy';
        insertMacroSnapshot(db, {
          sessionId: legacySessionId,
          iterationNumber: 9992,
          m0: 1000, m1: 1000, cpi: 1.0, inflationRate: 0,
          inflationExpectations: 0,
          totalLoansOutstanding: 0, treasuryBalance: 100,
          // All Phase 12 fields omitted (undefined → not inserted via the conditional spread)
        });

        const latest = getLatestSnapshot(db, legacySessionId);
        expect(latest).not.toBeNull();
        expect(latest!.reservationWageP25).toBeNull();
        expect(latest!.reservationWageP50).toBeNull();
        expect(latest!.reservationWageP75).toBeNull();
        expect(latest!.unemploymentRate).toBeNull();
        expect(latest!.avgPostedWage).toBeNull();
        expect(latest!.vacanciesTotal).toBeNull();
        expect(latest!.applicantsTotal).toBeNull();
        expect(latest!.displacedThisIteration).toBeNull();
      });
    });
    ```

    2. If MacroSnapshot type in shared/src/types.ts does not currently include the Phase 12 fields with appropriate nullability, the test will fail to compile. In that case, extend `MacroSnapshot` in `shared/src/types.ts` to include them as `number | null` (NOT optional with `?:`) — they are always present on the type, just nullable. Confirm by reading the existing MacroSnapshot interface first.

    3. If the project test setup requires creating tables in an in-memory SQLite before running tests (e.g., a `setup.ts` or test fixture invoking `migrate()`), ensure that scaffolding is referenced. Look at how the existing `agentRepo.test.ts` (or `enterpriseRepo.test.ts` from 12-GC1) handles this — mirror exactly.

    4. Run `npx vitest run server/src/db/repos/__tests__/macroSnapshotRepo.test.ts` and confirm both tests pass.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx vitest run server/src/db/repos/__tests__/macroSnapshotRepo.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `server/src/db/repos/__tests__/macroSnapshotRepo.test.ts` exists.
    - `grep -q "round-trip preserves reservationWageP25" server/src/db/repos/__tests__/macroSnapshotRepo.test.ts` exits 0.
    - `grep -q "round-trip preserves NULL when caller omits" server/src/db/repos/__tests__/macroSnapshotRepo.test.ts` exits 0.
    - `npx vitest run server/src/db/repos/__tests__/macroSnapshotRepo.test.ts` exits 0 with both tests passing.
    - `npm run test -w server -- --reporter=dot --run` exits 0 (no regression in any other test).
  </acceptance_criteria>
  <done>Both new tests pass: floor-value round-trip preserves 2.5; legacy-row pattern preserves NULL.</done>
</task>

</tasks>

<verification>
- `npx vitest run server/src/db/repos/__tests__/macroSnapshotRepo.test.ts` — both round-trip tests green.
- `npx tsc --noEmit -p server/tsconfig.json` — no new errors.
- `npm run test -w server -- --reporter=dot --run` — full server suite green.
- Manual smoke (location mode): bootstrap a Germany session; macroSnapshots after iter 1 has reservationWageP25/P50/P75 populated (2.5 floor or actual reservation wage values).
- Manual smoke (creative mode): create a "Describe a Society" session; the design completes without falling back to location-mode generateEnterprises; the enterprises table populates from the Central Agent's blueprints with sectors matching the society overview.
- Manual smoke (creative mode duplicate-name regression): create a "Describe a Society" session whose LLM emits two agents with the same name; verify (a) DB agents.name column reflects the suffixed name OR (b) at minimum, no enterprise.employees JSON contains a duplicate UUID and no owner is mapped to the wrong agent.
- SFC invariant: not exercised. centralAgent.generateDesign is design-time (no fiat movement); macroSnapshotRepo is read-only telemetry.
</verification>

<success_criteria>
- VERIFICATION Gap 5 closed: creative-mode bootstrap actually invokes generateEnterprisesFromCentralAgent (the orphan module from 12-03 now has a production caller).
- VERIFICATION Gap 6 closed: macroSnapshotRepo no longer uses (row as any) casts; column-name mismatches surface at compile time.
- VERIFICATION Gap 7 closed: integration test asserts reservationWageP25/P50/P75 round-trip correctly with the floor value.
- DesignProgressEvent type updated to admit the new Step 4 ('enterprises') without TypeScript rejection.
- Creative-mode duplicate-name vulnerability closed (mirrors 12-GC2 bootstrap.ts fix).
- 2 new tests added; full suite still green.
</success_criteria>

<output>
After completion, create `.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-GC4-SUMMARY.md`.
</output>
</content>
