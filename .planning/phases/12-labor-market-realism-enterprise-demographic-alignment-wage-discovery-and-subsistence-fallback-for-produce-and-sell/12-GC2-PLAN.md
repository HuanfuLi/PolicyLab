---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: GC2
type: execute
wave: 0
depends_on: []
files_modified:
  - server/src/routes/bootstrap.ts
  - server/src/data/dataBootstrapPipeline.ts
  - server/src/data/__tests__/dataBootstrapPipeline.test.ts
gap_closure: true
autonomous: true
requirements: [L-01]
phase_req_ids: [L-01]
must_haves:
  truths:
    - "bootstrap.ts disambiguates duplicate AgentBlueprint names BEFORE building agentNameToId so each agent name resolves to a unique UUID even when the LLM emits collisions"
    - "dataBootstrapPipeline.ts entEmployees push site uses Set-based dedup so the entEmployees array assigned to blueprint.employees never contains duplicate UUIDs"
    - "Unit test: when bootstrap is given a roster containing two agents named 'Heinrich' (or any other duplicate-name pair), the resulting EnterpriseBlueprint.employees array contains both distinct UUIDs (not the same one twice) and no UUID appears more than once across the full roster"
    - "Defensive logging: when a name collision is detected, console.warn surfaces the collision count and the disambiguation suffix used"
  artifacts:
    - path: "server/src/routes/bootstrap.ts"
      provides: "name-disambiguation pass producing a uniqueName field on each citizen row before agentNameToId is built; agentNameToId remains a Map<string, string> keyed by the disambiguated name"
    - path: "server/src/data/dataBootstrapPipeline.ts"
      provides: "Set-based dedup guard before assigning entEmployees into blueprint; also accepts disambiguated names through the agentNameToId pathway without changes to its public API"
    - path: "server/src/data/__tests__/dataBootstrapPipeline.test.ts"
      provides: "test asserting no duplicate UUIDs in any blueprint.employees array given a duplicate-name input"
  key_links:
    - from: "server/src/routes/bootstrap.ts (just before line 514 — the agentNameToId Map construction)"
      to: "unique-name guarantee on citizenRows"
      via: "for-loop that detects collisions on r.name and rewrites duplicates with a numeric suffix (Heinrich -> Heinrich (2)) before the Map is built"
      pattern: "Map\\(citizenRows.map\\(r => \\[r\\.name, r\\.id\\]\\)\\)"
    - from: "server/src/data/dataBootstrapPipeline.ts:518-528 (entEmployees push site)"
      to: "deduplicated string[] assigned to blueprint.employees"
      via: "[...new Set(entEmployees)] before the blueprint object literal"
      pattern: "new Set\\(entEmployees\\)|new Set<string>\\(\\)"
---

<objective>
Close VERIFICATION Gap 2: when the LLM (or upstream profile data) produces an agent roster with duplicate names, the bootstrap silently maps both names to one UUID and then round-robin-pushes that single UUID multiple times into the enterprise employees JSON column. Confirmed in the Germany session DB inspection (5× same UUID for one agent in services). The runtime Set deduplicates, but the DB stores duplicates — corrupting any tool that reads the column directly and bloating the JSON payload.

Two coordinated fixes:
1. **Bootstrap name disambiguation**: before building `agentNameToId`, detect name collisions on `citizenRows` and rewrite duplicates with a stable numeric suffix so each agent has a unique key in the Map.
2. **Defensive dedup at the push site**: in `dataBootstrapPipeline.ts buildBlueprint`, wrap the final `entEmployees` array in `[...new Set(...)]` before assigning to the blueprint. This is belt-and-suspenders so any future codepath that reaches this site cannot reintroduce duplicates.

Purpose: L-01 (bootstrap correctness — no corrupted employee assignments).
Output: bootstrap rewrite + pipeline dedup + unit test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-CONTEXT.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-02-PLAN.md

<interfaces>
Existing bootstrap site (server/src/routes/bootstrap.ts:512-521):
```typescript
// Generate and persist enterprise blueprints (Phase 10)
// Build name→UUID map from persisted agents so enterprises store UUIDs directly (GC1)
const agentNameToId = new Map(citizenRows.map(r => [r.name, r.id]));
const enterpriseBlueprints = generateEnterprises(
  blueprints,        // ← AgentBlueprint[] from data pipeline (may contain duplicate names)
  profile,
  baseFiat,
  finalConfig.minimumWage ?? 5,
  agentNameToId,     // ← THE BUG: duplicate r.name keys silently overwrite each other
);
```

When `citizenRows` has two rows with `r.name = 'Heinrich'`, the Map ends up with one entry mapping 'Heinrich' to whichever UUID was last in the iteration — the other UUID is unreachable through this map. Then the round-robin in dataBootstrapPipeline.ts:518-528 pushes the SAME UUID multiple times into `entEmployees`.

Existing pipeline push site (server/src/data/dataBootstrapPipeline.ts:517-528):
```typescript
// Distribute employees round-robin across enterprises in this sector
const entEmployees: string[] = [];
for (let j = 0; j < employees.length; j++) {
  if (j % owners.length === ownerIndex) {
    const agentName = employees[j].name;
    const resolvedId = agentNameToId?.get(agentName) ?? agentName;
    if (agentNameToId && !agentNameToId.has(agentName)) {
      console.warn(`[Enterprise] Employee "${agentName}" not found in agent name→UUID map`);
    }
    entEmployees.push(resolvedId);   // ← BUG: no dedup; duplicate names → same UUID pushed twice
  }
}
```

The `blueprints` AgentBlueprint[] is a separate sequence from `citizenRows`. They were aligned in earlier code by zipping; if name collision happens, both rows in citizenRows have unique UUIDs but identical names. The fix must give each row a unique key path — either by suffixing the name on the citizenRows side AND on the blueprints side (so the upstream/downstream agree), OR by passing a UUID-based map.

PLANNER DECISION: suffix duplicate names with ` (N)` (space + parenthesized 1-based count) on BOTH citizenRows AND the corresponding blueprints entries before the Map is built. Order matters: the FIRST occurrence keeps the bare name, subsequent occurrences get ` (2)`, ` (3)`, etc. This preserves the natural-looking name for the most common single-occurrence case and only adds suffixes when a collision exists.

The blueprints array is the same length as citizenRows (one row per agent); they are constructed from the same source (the LLM roster). We need to apply the SAME disambiguation to both sequences in the SAME order so the names align.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add Set-based dedup guard at the entEmployees push site in dataBootstrapPipeline.ts</name>
  <files>server/src/data/dataBootstrapPipeline.ts</files>
  <read_first>
    - server/src/data/dataBootstrapPipeline.ts:497-552 (full buildBlueprint function — focus on the entEmployees push site at lines 517-528 and the blueprint object construction at line 538-551)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 2 acceptance criteria
  </read_first>
  <behavior>
    - Defense-in-depth: even if the upstream Map contains a collision, the entEmployees array passed into the blueprint is deduplicated before the blueprint literal is constructed.
    - No behavior change for the no-duplicate case.
    - Logs a single console.warn per collision with the count.
  </behavior>
  <action>
    1. In `server/src/data/dataBootstrapPipeline.ts`, find the buildBlueprint function. The current push loop at lines 517-528 is:

    ```typescript
    const entEmployees: string[] = [];
    for (let j = 0; j < employees.length; j++) {
      if (j % owners.length === ownerIndex) {
        const agentName = employees[j].name;
        const resolvedId = agentNameToId?.get(agentName) ?? agentName;
        if (agentNameToId && !agentNameToId.has(agentName)) {
          console.warn(`[Enterprise] Employee "${agentName}" not found in agent name→UUID map`);
        }
        entEmployees.push(resolvedId);
      }
    }
    ```

    Replace this exact block with:

    ```typescript
    const entEmployees: string[] = [];
    const seenIds = new Set<string>();
    let dupCount = 0;
    for (let j = 0; j < employees.length; j++) {
      if (j % owners.length === ownerIndex) {
        const agentName = employees[j].name;
        const resolvedId = agentNameToId?.get(agentName) ?? agentName;
        if (agentNameToId && !agentNameToId.has(agentName)) {
          console.warn(`[Enterprise] Employee "${agentName}" not found in agent name→UUID map`);
        }
        // Phase 12 GC2: defense-in-depth dedup so duplicate-name collisions in agentNameToId
        // (closes VERIFICATION Gap 2) cannot store duplicate UUIDs in blueprint.employees.
        // Bootstrap-side disambiguation (12-GC2 Task 2) is the primary fix; this guard
        // catches any future codepath that bypasses it.
        if (seenIds.has(resolvedId)) {
          dupCount++;
          continue;
        }
        seenIds.add(resolvedId);
        entEmployees.push(resolvedId);
      }
    }
    if (dupCount > 0) {
      console.warn(`[Phase 12 GC2] Enterprise blueprint dropped ${dupCount} duplicate employee UUID(s) before persistence (sector=${sector}, owner=${owners[ownerIndex].name})`);
    }
    ```

    2. The blueprint literal at line 538-551 already uses `entEmployees`; no change needed there. Confirm by reading lines 538-551.

    3. Do NOT alter the round-robin distribution logic itself (`j % owners.length === ownerIndex`) — that controls WHICH agents go to WHICH enterprise; it is correct.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "seenIds = new Set<string>()" server/src/data/dataBootstrapPipeline.ts` exits 0.
    - `grep -q "Phase 12 GC2" server/src/data/dataBootstrapPipeline.ts` exits 0 (provenance comment present).
    - `grep -q "if (seenIds.has(resolvedId))" server/src/data/dataBootstrapPipeline.ts` exits 0.
    - `npx tsc --noEmit -p server/tsconfig.json` shows no new errors vs baseline.
  </acceptance_criteria>
  <done>buildBlueprint contains the Set-based dedup guard and warns when duplicates are dropped; types compile.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Disambiguate duplicate names in bootstrap.ts before agentNameToId is built</name>
  <files>server/src/routes/bootstrap.ts</files>
  <read_first>
    - server/src/routes/bootstrap.ts:495-525 (the section that builds citizenRows, persists agents, and constructs agentNameToId at line 514)
    - server/src/routes/bootstrap.ts (search for where `blueprints` is built — likely earlier in the function — to confirm both citizenRows and blueprints share the same name source)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 2 acceptance criteria
  </read_first>
  <behavior>
    - BEFORE the line `const agentNameToId = new Map(citizenRows.map(r => [r.name, r.id]));`, run a disambiguation pass that:
      - Iterates citizenRows in order.
      - Tracks a `Map<string, number>` of name -> next-suffix counter (starts at 2 for the second occurrence; first stays bare).
      - For each row, if its name has been seen, rewrite `row.name = '${row.name} (${counter})'` and bump the counter for that bare name.
      - Mirrors the same rewrite onto the corresponding `blueprints` entry (matched by index — citizenRows and blueprints are in the same order; if not, by some other key visible in the file).
    - Logs a single summary console.warn `[Phase 12 GC2] Disambiguated N duplicate agent name(s): [Heinrich -> Heinrich (2), ...]` if any collisions occurred. Empty case: no log.
    - After the pass, the `agentNameToId = new Map(citizenRows.map(r => [r.name, r.id]))` line works correctly because each row.name is now unique.
  </behavior>
  <action>
    1. Read `server/src/routes/bootstrap.ts` around lines 495-525 to confirm the exact ordering relationship between `citizenRows` and `blueprints`. Both should be derived from the same source array (the LLM-generated roster `agentsData.agents` or equivalent). Verify they are index-aligned.

    2. Insert the disambiguation pass IMMEDIATELY BEFORE the line at 514:

    ```typescript
    const agentNameToId = new Map(citizenRows.map(r => [r.name, r.id]));
    ```

    Insert this block:

    ```typescript
    // ── Phase 12 GC2: Disambiguate duplicate agent names BEFORE building agentNameToId ──
    // Closes VERIFICATION Gap 2. When the LLM produces agents with duplicate names
    // (observed in Germany bootstrap: 5x same UUID for one agent in the services
    // employees JSON), the original Map(citizenRows.map(...)) silently collapses
    // the duplicates to a single entry pointing at whichever UUID was last in
    // iteration order. Subsequent round-robin push in dataBootstrapPipeline then
    // writes the same UUID multiple times to the DB.
    //
    // Fix: rewrite duplicates with a stable numeric suffix on BOTH citizenRows
    // AND blueprints (they are index-aligned), so each name maps to a unique UUID.
    {
      const seenNameCounts = new Map<string, number>();
      const renamings: string[] = [];
      for (let i = 0; i < citizenRows.length; i++) {
        const baseName = citizenRows[i].name;
        const seen = seenNameCounts.get(baseName) ?? 0;
        if (seen > 0) {
          const suffixed = `${baseName} (${seen + 1})`;
          renamings.push(`${baseName} -> ${suffixed}`);
          citizenRows[i].name = suffixed;
          // Mirror onto the corresponding blueprint entry (index-aligned)
          if (blueprints[i]) blueprints[i].name = suffixed;
        }
        seenNameCounts.set(baseName, seen + 1);
      }
      if (renamings.length > 0) {
        console.warn(`[Phase 12 GC2] Disambiguated ${renamings.length} duplicate agent name(s): [${renamings.join(', ')}]`);
      }
    }
    ```

    3. Confirm the line at 514 (now shifted down by the inserted block) still reads:

    ```typescript
    const agentNameToId = new Map(citizenRows.map(r => [r.name, r.id]));
    ```

    No change to this line itself — the disambiguation pass above guarantees uniqueness.

    4. If `citizenRows` is built from a `.values()` iterator or otherwise non-mutable array, you may need to convert to a mutable array first. Inspect the actual type — if `citizenRows` has been spread from a transaction insert result, it is plain array of plain objects and is mutable. The `name` property is the persisted agent name; mutating it post-DB-write is fine because DB reads from this point forward use the in-memory copy. (DB rows still have the bare name — that's acceptable because agentNameToId is the only consumer of the disambiguation; agent display names should also reflect the suffix to match the DB's name column.)

    5. If `citizenRows[i].name` mutation does NOT propagate to the DB (which it won't, since agents were already inserted at line 508 in batches), the DB rows have the bare collided names. **Decision:** also UPDATE the DB to write the disambiguated name back, so downstream displays + the agentRepo.getAgents path see the correct unique name. Add immediately AFTER the disambiguation block:

    ```typescript
    // Mirror disambiguation back into the DB so agents.name reflects the unique key
    if (renamings.length > 0) {
      // (re-run the rename loop because `renamings` was scoped to the block above)
      const seen2 = new Map<string, number>();
      for (let i = 0; i < citizenRows.length; i++) {
        const r = citizenRows[i];
        // The post-renaming names already include suffixes; we just persist them
        // back. Use a single transaction to avoid 1 query per agent.
      }
      sqlite.transaction(() => {
        for (const r of citizenRows) {
          db.update(agents).set({ name: r.name }).where(eq(agents.id, r.id)).run();
        }
      })();
    }
    ```

    NOTE: this requires `sqlite`, `db`, `agents`, and `eq` to already be imported in bootstrap.ts. Verify imports at the top of the file. If `agents` table or `eq` isn't imported, add them — they are used elsewhere in this same file (line 506 `db.delete(agents)...`).

    Adjust the duplicated logic — declare `renamings` outside the block scope OR re-walk the citizenRows to detect "names that contain a suffix in parentheses". Simpler: just always issue the bulk update when any disambiguation occurred. Refactor:

    Replace the entire disambiguation block with this self-contained version:

    ```typescript
    // ── Phase 12 GC2: Disambiguate duplicate agent names BEFORE building agentNameToId ──
    // Closes VERIFICATION Gap 2 (5x duplicate UUIDs in services employees JSON for Germany).
    const renamings: string[] = [];
    {
      const seenNameCounts = new Map<string, number>();
      for (let i = 0; i < citizenRows.length; i++) {
        const baseName = citizenRows[i].name;
        const seen = seenNameCounts.get(baseName) ?? 0;
        if (seen > 0) {
          const suffixed = `${baseName} (${seen + 1})`;
          renamings.push(`${baseName} -> ${suffixed}`);
          citizenRows[i].name = suffixed;
          if (blueprints[i]) blueprints[i].name = suffixed;
        }
        seenNameCounts.set(baseName, seen + 1);
      }
    }
    if (renamings.length > 0) {
      console.warn(`[Phase 12 GC2] Disambiguated ${renamings.length} duplicate agent name(s): [${renamings.join(', ')}]`);
      // Mirror onto DB so agents.name reflects the unique key (downstream displays + getAgents)
      sqlite.transaction(() => {
        for (const r of citizenRows) {
          db.update(agents).set({ name: r.name }).where(eq(agents.id, r.id)).run();
        }
      })();
    }
    ```

    6. Verify the imports at top of file: `sqlite`, `db`, `agents`, `eq`. They should already be present given line 504-510 uses `sqlite.transaction(() => { db.delete(agents).where(eq(agents.sessionId, id)).run(); ... })`. If `eq` isn't imported, add `import { eq } from 'drizzle-orm';` at the top.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "Phase 12 GC2: Disambiguate duplicate agent names" server/src/routes/bootstrap.ts` exits 0.
    - `grep -q "seenNameCounts = new Map<string, number>()" server/src/routes/bootstrap.ts` exits 0.
    - `grep -q "Disambiguated.*duplicate agent name" server/src/routes/bootstrap.ts` exits 0.
    - `grep -B2 -A1 "agentNameToId = new Map" server/src/routes/bootstrap.ts | grep -q "renamings"` exits 0 (the disambiguation block precedes the Map construction).
    - `npx tsc --noEmit -p server/tsconfig.json` shows no new errors.
  </acceptance_criteria>
  <done>Bootstrap detects + suffixes duplicate names; mirrors to DB; agentNameToId is built from unique keys.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Test that duplicate-name input produces no duplicate UUIDs in any blueprint.employees</name>
  <files>server/src/data/__tests__/dataBootstrapPipeline.test.ts</files>
  <read_first>
    - server/src/data/__tests__/dataBootstrapPipeline.test.ts (existing test file — find a fixture/style reference; if it has a generateEnterprises or buildBlueprint test, mirror that setup)
    - server/src/data/dataBootstrapPipeline.ts (after Task 1 — entEmployees dedup is in place)
    - server/src/data/__tests__/enterpriseBootstrap.test.ts (alternate style reference if dataBootstrapPipeline.test.ts has no enterprise fixture)
  </read_first>
  <behavior>
    - New describe block 'Phase 12 GC2: employee deduplication' added to dataBootstrapPipeline.test.ts.
    - Test 1 (pipeline-level dedup): when generateEnterprises is invoked with an `agentNameToId` containing a collision (two names mapping to the same UUID, simulating what a non-disambiguated Map would produce), the resulting blueprints have NO blueprint.employees array containing duplicate UUIDs.
    - Test 2 (regression guard): with a clean, all-unique input, blueprint.employees stays unchanged in length and content (no false positives from the dedup guard).
  </behavior>
  <action>
    1. Open `server/src/data/__tests__/dataBootstrapPipeline.test.ts` (if missing, create it). Append:

    ```typescript
    import { describe, it, expect } from 'vitest';
    import { generateEnterprises } from '../dataBootstrapPipeline.js';
    import type { AgentBlueprint } from '@policylab/shared';

    describe('Phase 12 GC2: employee deduplication in blueprint.employees', () => {

      function buildAgents(spec: Array<{ name: string; role: string; sector?: string }>): AgentBlueprint[] {
        return spec.map((s, i) => ({
          name: s.name,
          role: s.role,
          background: '',
          sector: s.sector as any,
          // Fill remaining required AgentBlueprint fields with safe defaults — adjust to match the
          // actual AgentBlueprint shape in shared/src/types.ts. Inspect the type first.
          initialStats: { wealth: 50, health: 70, happiness: 60, cortisol: 20 },
          personalityTraits: [],
        } as unknown as AgentBlueprint));
      }

      it('GC2: collision in agentNameToId does not produce duplicate UUIDs in blueprint.employees', () => {
        // Simulate a 6-agent roster with 1 duplicate-name pair AND a Map collision
        // (the Map maps both 'Heinrich' instances to the same UUID — the original bug).
        const agents = buildAgents([
          { name: 'Anna',     role: 'farmer',  sector: 'agriculture' },
          { name: 'Heinrich', role: 'worker',  sector: 'industry' },
          { name: 'Heinrich', role: 'worker',  sector: 'industry' },   // duplicate name
          { name: 'Klaus',    role: 'shopkeep', sector: 'services' },
          { name: 'Maria',    role: 'farmer',  sector: 'agriculture' },
          { name: 'Owner',    role: 'capitalist', sector: 'industry' }, // owner role
        ]);
        const agentNameToId = new Map<string, string>([
          ['Anna', 'uuid-anna'],
          ['Heinrich', 'uuid-heinrich-collided'],   // ← collision: only one entry for both Heinrichs
          ['Klaus', 'uuid-klaus'],
          ['Maria', 'uuid-maria'],
          ['Owner', 'uuid-owner'],
        ]);
        const blueprints = generateEnterprises(agents, null, 100, 5, agentNameToId);

        // For every blueprint, blueprint.employees must have no duplicate UUIDs.
        for (const ent of blueprints) {
          const ids = ent.employees ?? [];
          const unique = new Set(ids);
          expect(ids.length).toBe(unique.size); // no duplicates
        }
      });

      it('GC2: regression guard — fully unique roster preserves all employee assignments unchanged', () => {
        const agents = buildAgents([
          { name: 'A', role: 'farmer',  sector: 'agriculture' },
          { name: 'B', role: 'worker',  sector: 'industry' },
          { name: 'C', role: 'shopkeep', sector: 'services' },
          { name: 'D', role: 'farmer',  sector: 'agriculture' },
          { name: 'E', role: 'worker',  sector: 'industry' },
          { name: 'Owner', role: 'capitalist', sector: 'industry' },
        ]);
        const agentNameToId = new Map<string, string>([
          ['A', 'uuid-a'], ['B', 'uuid-b'], ['C', 'uuid-c'],
          ['D', 'uuid-d'], ['E', 'uuid-e'], ['Owner', 'uuid-owner'],
        ]);
        const blueprints = generateEnterprises(agents, null, 100, 5, agentNameToId);
        const allAssigned: string[] = [];
        for (const ent of blueprints) {
          for (const id of ent.employees ?? []) allAssigned.push(id);
        }
        // Each unique agent UUID appears at most once across all blueprints
        const counts = new Map<string, number>();
        for (const id of allAssigned) counts.set(id, (counts.get(id) ?? 0) + 1);
        for (const [, n] of counts) expect(n).toBeLessThanOrEqual(1);
      });
    });
    ```

    2. Inspect the actual `AgentBlueprint` shape in `shared/src/types.ts` and adjust the `buildAgents` factory to match. The required minimal fields are name, role, background, sector (if present), and initialStats. If `AgentBlueprint` has additional required fields, fill them with sensible test values.

    3. If `dataBootstrapPipeline.test.ts` does not yet exist, create it. If it exists with an existing test setup (imports, helpers), reuse them — don't duplicate.

    4. Run the test — it MUST pass. If the dedup guard from Task 1 is missing, Test 1 will fail with a count mismatch.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx vitest run server/src/data/__tests__/dataBootstrapPipeline.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `server/src/data/__tests__/dataBootstrapPipeline.test.ts` exists.
    - `grep -q "Phase 12 GC2: employee deduplication" server/src/data/__tests__/dataBootstrapPipeline.test.ts` exits 0.
    - `npx vitest run server/src/data/__tests__/dataBootstrapPipeline.test.ts` exits 0 with both new tests passing.
    - `npm run test -w server -- --reporter=dot --run` exits 0 (no regression in any other test).
  </acceptance_criteria>
  <done>Both new tests pass; dedup guard is exercised; regression test confirms no false positives on clean input.</done>
</task>

</tasks>

<verification>
- `npx vitest run server/src/data/__tests__/dataBootstrapPipeline.test.ts` — new tests green.
- `npm run test -w server -- --reporter=dot --run` — full suite green.
- Manual smoke: bootstrap a new Germany session via `npm run dev`, complete bootstrap, then SQL-inspect: `SELECT id, name FROM agents WHERE session_id = ? AND name LIKE '% (%)'` — if any disambiguations occurred, the rows show unique suffixes; `SELECT employees FROM enterprises WHERE session_id = ?` — no duplicate UUIDs in any JSON array.
</verification>

<success_criteria>
- VERIFICATION Gap 2 closed: bootstrap rosters with duplicate names produce no duplicate UUIDs in blueprint.employees, and the agents.name DB column is updated to use unique disambiguated names.
- Defense-in-depth: even if the bootstrap-side fix is bypassed (e.g., a future code path constructs blueprints differently), the entEmployees dedup in dataBootstrapPipeline.ts catches it.
- Existing 591 tests still green; 2 new tests added.
</success_criteria>

<output>
After completion, create `.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-GC2-SUMMARY.md`.
</output>
</content>
</invoke>