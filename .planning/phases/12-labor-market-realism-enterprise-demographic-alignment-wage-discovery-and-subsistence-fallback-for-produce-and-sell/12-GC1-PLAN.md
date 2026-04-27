---
phase: 12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell
plan: GC1
type: execute
wave: 0
depends_on: []
files_modified:
  - shared/src/types.ts
  - server/src/db/repos/enterpriseRepo.ts
  - server/src/db/repos/__tests__/enterpriseRepo.test.ts
  - server/src/orchestration/simulationRunner.ts
gap_closure: true
autonomous: true
requirements: [L-05, L-11]
phase_req_ids: [L-05, L-11]
must_haves:
  truths:
    - "enterpriseRepo exports updateEnterpriseRuntimeState(input) that writes wage, employees JSON, last_applicants, last_vacancies via direct db.update().run() (mirrors updateEnterpriseInsolvencyAsync direct-write pattern)"
    - "employees array is deduplicated via [...new Set(input.employees)] before JSON.stringify so duplicate UUIDs from bootstrap can never re-enter the DB"
    - "simulationRunner calls updateEnterpriseRuntimeState for every enterprise once per iteration, AFTER the matching pass has set lastApplicants/lastVacancies and AFTER processWageAdjustment has finalized the new wage"
    - "simulationRunner enterprise hydration block (currently lines 297-326) reads lastApplicants and lastVacancies from the DB blueprint instead of hardcoding 0 — pause/resume restores the wage discovery feedback loop"
    - "EnterpriseBlueprint loaded from DB now exposes lastApplicants and lastVacancies (previously dropped at the repo boundary)"
    - "Integration test: after one iteration runs, DB rows for every surviving enterprise have wage/employees/last_applicants/last_vacancies matching the in-memory EnterpriseRecord exactly"
  artifacts:
    - path: "server/src/db/repos/enterpriseRepo.ts"
      provides: "updateEnterpriseRuntimeState({ enterpriseId, wage, employees, lastApplicants, lastVacancies }) direct-write update; getEnterprises also returns lastApplicants/lastVacancies on the blueprint"
    - path: "server/src/db/repos/__tests__/enterpriseRepo.test.ts"
      provides: "vitest module covering insert→update→read round-trip including deduplication of employees"
    - path: "server/src/orchestration/simulationRunner.ts"
      provides: "end-of-iteration write-back loop calling updateEnterpriseRuntimeState; load path reads lastApplicants/lastVacancies from DB blueprint"
  key_links:
    - from: "server/src/orchestration/simulationRunner.ts (end-of-iteration block, after sessionPreviousEnterpriseLedgers snapshot at line ~3564)"
      to: "server/src/db/repos/enterpriseRepo.ts updateEnterpriseRuntimeState"
      via: "for...of enterpriseRegistry.values() loop calling updateEnterpriseRuntimeState per enterprise"
      pattern: "updateEnterpriseRuntimeState\\("
    - from: "server/src/orchestration/simulationRunner.ts:311 (load path lastApplicants assignment)"
      to: "EnterpriseBlueprint.lastApplicants from getEnterprises"
      via: "bp.lastApplicants ?? 0 instead of hardcoded 0"
      pattern: "lastApplicants:\\s*bp\\.lastApplicants"
    - from: "server/src/db/repos/enterpriseRepo.ts insertEnterprise & updateEnterpriseRuntimeState"
      to: "DB enterprises.employees JSON column with no duplicate UUIDs"
      via: "JSON.stringify([...new Set(employees)])"
      pattern: "new Set\\("
---

<objective>
Close VERIFICATION Gaps 1 and 3: persist enterprise runtime state (wage, employees, lastApplicants, lastVacancies) to the DB at the end of every iteration so the wage discovery feedback loop survives pause/resume. Also restore lastApplicants/lastVacancies from DB on session reload instead of hardcoding 0 (which currently makes the first 6 iterations of every session produce a zero nudge signal — observed in the Germany smoke).

Purpose: L-05 (wage adjustment depends on lastApplicants/lastVacancies feedback), L-11 (DB-persisted state for telemetry consistency across pause/resume).
Output: new repo function + repo test + simulationRunner write-back loop + load-path fix.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-CONTEXT.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-01-PLAN.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-04-PLAN.md
@.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-05-PLAN.md

<interfaces>
Existing repo state (server/src/db/repos/enterpriseRepo.ts):
```typescript
// Lines 18-41: insertEnterprise(sessionId, blueprint) — direct db.insert().run()
// Lines 43-76: getEnterprises(sessionId) returns EnterpriseBlueprint[] — currently DROPS lastApplicants/lastVacancies on the way out
// Lines 88-103: updateEnterpriseInsolvencyAsync(enterpriseId, counter, isBankrupt)
//               — name says "Async" but actually does synchronous db.update().run()
//               — sets only consecutiveInsolvencyIterations + isBankrupt
//               — that direct-write pattern is the precedent this plan follows
```

Existing schema (server/src/db/schema.ts:312-317):
```typescript
capacity: integer('capacity').notNull().default(20),
lastApplicants: integer('last_applicants').notNull().default(0),
lastVacancies: integer('last_vacancies').notNull().default(0),
```
Columns already present. No schema change needed — this is purely a repo + runner fix.

Existing matching pass (server/src/orchestration/helpers/matchingPass.ts:116-119):
```typescript
// Persist lastApplicants / lastVacancies for next-iteration wage nudge (D-03)
for (const ent of enterpriseRegistry.values()) {
  ent.lastApplicants = applicantCountsByEnt.get(ent.id) ?? 0;
  ent.lastVacancies = Math.max(0, (ent.capacity ?? 0) - ent.employees.size);
}
```
This sets the values in-memory only. The DB write is what's missing.

Existing simulationRunner load path (lines 297-326):
```typescript
const blueprints = enterpriseRepo.getEnterprises(scope);
for (const bp of blueprints) {
  enterpriseRegistry.set(bp.id, {
    // ...
    capacity: bp.capacity != null && bp.capacity > 0 ? bp.capacity : Math.max((bp.employees ?? []).length, 20),
    lastApplicants: 0, // Phase 12 D-03 — populated by matching pass   ← BUG: should be bp.lastApplicants
    lastVacancies: 0,  // Phase 12 D-03 — populated by matching pass   ← BUG: should be bp.lastVacancies
  });
  // ...
}
```

Existing end-of-iteration anchor (simulationRunner.ts:3561-3564):
```typescript
// ── Phase 12 D-01: Snapshot per-enterprise ledger for next iteration's profit-share ──
// Must persist BEFORE telemetry is built so next-iteration processWageAdjustment
// receives accurate last-period revenue/wage/worker data. SFC invariant: read-only copy.
sessionPreviousEnterpriseLedgers.set(sessionId, new Map(enterpriseLedgerMap));
```
This is the natural insertion point — the matching pass at line 1380-1391 has already mutated lastApplicants/lastVacancies, and processWageAdjustment at line 719 has already mutated wage. The DB write goes immediately after the in-memory snapshot.

EnterpriseBlueprint type (shared/src/types.ts:844-857) — must be extended optionally:
```typescript
export interface EnterpriseBlueprint {
  // ... existing fields ...
  capacity?: number;
  // ADD (this plan):
  /** Last-iteration applicant count restored from DB on session resume. Phase 12 D-03. */
  lastApplicants?: number;
  /** Last-iteration vacancy count restored from DB on session resume. Phase 12 D-03. */
  lastVacancies?: number;
}
```

asyncLogFlusher: INSERT-only (server/src/db/asyncLogFlusher.ts:81-85 docs). Cannot be used for UPDATE. Use direct synchronous db.update().run() like updateEnterpriseInsolvencyAsync.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend EnterpriseBlueprint with optional lastApplicants/lastVacancies + extend getEnterprises to surface them</name>
  <files>shared/src/types.ts, server/src/db/repos/enterpriseRepo.ts</files>
  <read_first>
    - shared/src/types.ts:844-857 (EnterpriseBlueprint definition)
    - server/src/db/repos/enterpriseRepo.ts (full file — current insertEnterprise + getEnterprises)
    - server/src/db/schema.ts:285-319 (enterprises table — columns already exist)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 1 + gap 3
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-CONTEXT.md D-03 (lastApplicants/lastVacancies semantics)
  </read_first>
  <behavior>
    - EnterpriseBlueprint gains two new optional number fields lastApplicants and lastVacancies. All existing call sites continue to compile (the fields are optional).
    - getEnterprises returns rows whose lastApplicants and lastVacancies match the DB columns (no longer dropped). Legacy DB rows with NULL columns return 0 for both (the column NOT NULL DEFAULT 0 already prevents nulls, but the read path still coerces to be safe).
    - shared types compile under `npx tsc --noEmit -p shared/tsconfig.json`.
  </behavior>
  <action>
    1. In `shared/src/types.ts`, find the `EnterpriseBlueprint` interface (line ~844) and extend it. Append, immediately after the existing `capacity?: number;` field (which lives just before the closing brace), these two fields:

    ```typescript
    /** Last-iteration applicant count restored from DB on session resume. Phase 12 D-03 / 12-GC1. */
    lastApplicants?: number;
    /** Last-iteration vacancy count restored from DB on session resume. Phase 12 D-03 / 12-GC1. */
    lastVacancies?: number;
    ```

    Do NOT change any existing field. Do NOT alter ordering. Use the same JSDoc style as the existing `capacity?: number` doc comment on the line above.

    2. In `server/src/db/repos/enterpriseRepo.ts` `getEnterprises` function (lines 43-76), inside the `rows.map(row => { ... })` block, BEFORE the final `return { ... }` object, add:

    ```typescript
    // Phase 12 GC1: surface last_applicants / last_vacancies so simulationRunner
    // can restore the wage discovery feedback signal on session resume.
    // Coerce nullable read into number defaulting to 0.
    const rawLastApplicants = (row as typeof row & { lastApplicants?: number | null }).lastApplicants;
    const rawLastVacancies = (row as typeof row & { lastVacancies?: number | null }).lastVacancies;
    const lastApplicants = typeof rawLastApplicants === 'number' ? rawLastApplicants : 0;
    const lastVacancies = typeof rawLastVacancies === 'number' ? rawLastVacancies : 0;
    ```

    Then add `lastApplicants` and `lastVacancies` to the returned object immediately after the existing `capacity` line:

    ```typescript
    return {
      // ... existing fields including capacity ...
      capacity,
      lastApplicants,
      lastVacancies,
    };
    ```

    3. Run `npx tsc --noEmit -p shared/tsconfig.json` and `npx tsc --noEmit -p server/tsconfig.json` to confirm no type errors.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx tsc --noEmit -p shared/tsconfig.json && npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "lastApplicants?:\s*number" shared/src/types.ts` returns at least 1 (new field present on EnterpriseBlueprint).
    - `grep -c "lastVacancies?:\s*number" shared/src/types.ts` returns at least 1.
    - `grep -q "lastApplicants," server/src/db/repos/enterpriseRepo.ts && grep -q "lastVacancies," server/src/db/repos/enterpriseRepo.ts` exits 0 (both fields included in returned blueprint).
    - `npx tsc --noEmit -p shared/tsconfig.json` exits 0.
    - `npx tsc --noEmit -p server/tsconfig.json` exits 0 OR exits with same number of pre-existing errors as before this plan (no new errors introduced).
  </acceptance_criteria>
  <done>EnterpriseBlueprint exposes the two new optional fields; getEnterprises returns them; types compile.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add updateEnterpriseRuntimeState to enterpriseRepo + dedicated repo test</name>
  <files>server/src/db/repos/enterpriseRepo.ts, server/src/db/repos/__tests__/enterpriseRepo.test.ts</files>
  <read_first>
    - server/src/db/repos/enterpriseRepo.ts (full file — focus on updateEnterpriseInsolvencyAsync at lines 88-103 as the direct-write pattern precedent)
    - server/src/db/asyncLogFlusher.ts:81-98 (confirms enqueue is INSERT-only — must NOT use it for UPDATE)
    - server/src/db/repos/__tests__/agentRepo.test.ts (style reference for vitest + sqlite test setup if it exists; if not, look at any other repo test for setup patterns)
    - server/src/db/index.ts (db handle import path)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 1 (acceptance: "Add updateEnterpriseStateAsync(enterpriseId, { wage, employees, lastApplicants, lastVacancies }) to enterpriseRepo.ts")
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 2 ("Deduplicate entEmployees ... Set-based deduplication")
  </read_first>
  <behavior>
    - New exported function `updateEnterpriseRuntimeState(input)` writes the four runtime fields via a single synchronous `db.update(enterprises).set({...}).where(eq(enterprises.id, input.enterpriseId)).run()` — same direct-write idiom as updateEnterpriseInsolvencyAsync.
    - Employees array is deduplicated via `[...new Set(input.employees)]` before `JSON.stringify`. This is defense-in-depth: even if the in-memory Set semantics are bypassed somewhere, the DB persists no duplicates.
    - Function does not throw on a no-op (zero-row update); it logs a warning if `info.changes === 0` because that means the enterprise row was deleted (e.g., bankruptcy) — the caller should have filtered it out.
    - Test file covers: (a) round-trip insert → update → re-read produces identical wage/employees/lastApplicants/lastVacancies, (b) employees with duplicates are deduplicated in DB, (c) update on a non-existent enterpriseId is a safe no-op.
  </behavior>
  <action>
    1. In `server/src/db/repos/enterpriseRepo.ts`, append a new exported function below the existing `updateEnterpriseInsolvencyAsync` (around line 103). Use this exact signature and body:

    ```typescript
    /**
     * Phase 12 GC1 (closes VERIFICATION Gap 1 + Gap 3): persist runtime enterprise state
     * to the DB at the end of each iteration so wage discovery / employees / matching-pass
     * counters survive pause/resume.
     *
     * Mirrors the direct-write pattern of updateEnterpriseInsolvencyAsync — the "Async"
     * suffix on that function is a misnomer; it does a synchronous db.update().run().
     * asyncLogFlusher cannot be used here because it only supports INSERTs (see
     * server/src/db/asyncLogFlusher.ts).
     *
     * Employees array is deduplicated defensively via `new Set` so any stray duplicate
     * UUIDs (e.g., from a bootstrap with duplicate agent names — Gap 2) cannot enter
     * the DB even if Gap 2's bootstrap-time fix is bypassed.
     */
    export function updateEnterpriseRuntimeState(input: {
      enterpriseId: string;
      wage: number;
      employees: string[];
      lastApplicants: number;
      lastVacancies: number;
    }): void {
      const dedupedEmployees = [...new Set(input.employees)];
      const info = db.update(enterprises)
        .set({
          wage: input.wage,
          employees: JSON.stringify(dedupedEmployees),
          lastApplicants: input.lastApplicants,
          lastVacancies: input.lastVacancies,
        })
        .where(eq(enterprises.id, input.enterpriseId))
        .run();
      if (info.changes === 0) {
        // Caller should have filtered out bankrupt/deleted enterprises before calling.
        // A zero-change UPDATE is suspicious but not fatal.
        console.warn(`[Phase 12 GC1] updateEnterpriseRuntimeState: no row matched id=${input.enterpriseId}`);
      }
    }
    ```

    2. Create `server/src/db/repos/__tests__/enterpriseRepo.test.ts`. If `agentRepo.test.ts` exists in the same directory, mirror its setup pattern (it likely uses an in-memory SQLite via the existing test scaffolding). If no such pattern is established, use the project's standard test setup. Required test cases:

    ```typescript
    import { describe, it, expect, beforeEach } from 'vitest';
    import { insertEnterprise, getEnterprises, updateEnterpriseRuntimeState } from '../enterpriseRepo.js';
    // Import any test-DB setup helper used by other repo tests; if none exists, use the
    // approach already used in agentRepo.test.ts. Adapt as necessary.

    describe('Phase 12 GC1: enterpriseRepo runtime state persistence', () => {
      // Each test runs against a fresh-ish session id to avoid cross-test pollution.
      const sessionId = 'test-session-gc1';

      beforeEach(() => {
        // Clean enterprises for this session id if needed (use the test DB helper
        // available in the test scaffold).
      });

      it('updateEnterpriseRuntimeState round-trip: insert → update → re-read returns updated values', () => {
        const blueprint = {
          id: 'ent_test_1',
          name: 'Test Farm',
          ownerId: 'agent-owner-1',
          sector: 'agriculture' as const,
          industry: 'agriculture',
          commodityOutput: 'food' as const,
          initialCapital: 100,
          initialInventory: {},
          employees: ['agent-1', 'agent-2'],
          wage: 5,
          isServiceEnterprise: false,
          capacity: 10,
        };
        insertEnterprise(sessionId, blueprint);

        updateEnterpriseRuntimeState({
          enterpriseId: 'ent_test_1',
          wage: 12.5,
          employees: ['agent-3', 'agent-4', 'agent-5'],
          lastApplicants: 7,
          lastVacancies: 3,
        });

        const reloaded = getEnterprises(sessionId);
        const ent = reloaded.find(e => e.id === 'ent_test_1');
        expect(ent).toBeDefined();
        expect(ent!.wage).toBe(12.5);
        expect(ent!.employees).toEqual(['agent-3', 'agent-4', 'agent-5']);
        expect(ent!.lastApplicants).toBe(7);
        expect(ent!.lastVacancies).toBe(3);
      });

      it('updateEnterpriseRuntimeState deduplicates employees array before persisting', () => {
        const blueprint = {
          id: 'ent_test_2',
          name: 'Test Industry',
          ownerId: 'agent-owner-2',
          sector: 'industry' as const,
          industry: 'industry',
          commodityOutput: 'tools' as const,
          initialCapital: 100,
          initialInventory: {},
          employees: [],
          wage: 5,
          isServiceEnterprise: false,
          capacity: 10,
        };
        insertEnterprise(sessionId, blueprint);

        // Pass duplicate UUIDs intentionally
        updateEnterpriseRuntimeState({
          enterpriseId: 'ent_test_2',
          wage: 8,
          employees: ['dup-1', 'dup-1', 'dup-2', 'dup-1'],
          lastApplicants: 0,
          lastVacancies: 0,
        });

        const reloaded = getEnterprises(sessionId);
        const ent = reloaded.find(e => e.id === 'ent_test_2');
        expect(ent).toBeDefined();
        expect(ent!.employees.sort()).toEqual(['dup-1', 'dup-2']);
      });

      it('updateEnterpriseRuntimeState on missing enterpriseId is a safe no-op (warns, does not throw)', () => {
        // Should not throw; should log a warn (we do not assert the warn here to avoid
        // brittleness — just confirm no exception).
        expect(() => updateEnterpriseRuntimeState({
          enterpriseId: 'does-not-exist',
          wage: 1,
          employees: [],
          lastApplicants: 0,
          lastVacancies: 0,
        })).not.toThrow();
      });
    });
    ```

    3. If the existing test scaffold for repo tests requires importing an in-memory DB initializer (look at `server/src/db/repos/__tests__/agentRepo.test.ts` for the pattern), mirror that exactly.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npx vitest run server/src/db/repos/__tests__/enterpriseRepo.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "export function updateEnterpriseRuntimeState" server/src/db/repos/enterpriseRepo.ts` exits 0.
    - `grep -q "new Set(input.employees)" server/src/db/repos/enterpriseRepo.ts` exits 0 (defensive deduplication present).
    - `grep -q "asyncLogFlusher" server/src/db/repos/enterpriseRepo.ts | grep -q updateEnterpriseRuntimeState` returns nothing (asyncLogFlusher MUST NOT be used for the new UPDATE).
    - `npx vitest run server/src/db/repos/__tests__/enterpriseRepo.test.ts` exits 0 with all 3 tests passing.
    - `npx tsc --noEmit -p server/tsconfig.json` exits with no new errors vs Task 1 baseline.
  </acceptance_criteria>
  <done>updateEnterpriseRuntimeState exported, deduplicates employees, and the new repo test file passes 3/3.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire updateEnterpriseRuntimeState into simulationRunner end-of-iteration + fix load-path hardcode</name>
  <files>server/src/orchestration/simulationRunner.ts</files>
  <read_first>
    - server/src/orchestration/simulationRunner.ts:289-326 (current load path — fix the lastApplicants:0 / lastVacancies:0 hardcodes here)
    - server/src/orchestration/simulationRunner.ts:1370-1402 (matching pass result handling — confirms lastApplicants/lastVacancies are set in-memory by matchingPass.ts)
    - server/src/orchestration/simulationRunner.ts:3556-3575 (end-of-iteration block where sessionPreviousEnterpriseLedgers is snapshotted at line 3564 — insert the write-back loop immediately AFTER that snapshot, BEFORE iterTelemetry construction)
    - server/src/orchestration/helpers/matchingPass.ts:116-119 (in-memory mutation of ent.lastApplicants/ent.lastVacancies that needs to be persisted)
    - server/src/db/repos/enterpriseRepo.ts (after Task 2 — updateEnterpriseRuntimeState exists)
    - .planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-VERIFICATION.md gap 1 + gap 3 (acceptance criteria)
  </read_first>
  <behavior>
    - At end of each iteration, AFTER `sessionPreviousEnterpriseLedgers.set(sessionId, new Map(enterpriseLedgerMap))` at line 3564 and BEFORE iterTelemetry construction begins at line 3568, iterate `enterpriseRegistry.values()` and call `updateEnterpriseRuntimeState` per enterprise.
    - The load path at lines 311-312 stops hardcoding `lastApplicants: 0, lastVacancies: 0` and instead reads `bp.lastApplicants ?? 0` / `bp.lastVacancies ?? 0` from the loaded blueprint.
    - SFC invariant: this is a metadata write only — no fiat / no AMM / no escrow side effects. `processWageAdjustment` already has SFC-clean tests; this plan's write does not move money.
    - Bankrupt enterprises (already filtered out of enterpriseRegistry by deletion) are skipped naturally — the for...of only iterates surviving enterprises.
  </behavior>
  <action>
    1. In `server/src/orchestration/simulationRunner.ts`, find the import block near the top of the file (where `processWageAdjustment` is imported from enterpriseEngine — around line 73). Add to the existing `enterpriseRepo` import block (or wherever updateEnterpriseInsolvencyAsync is currently imported from) the new import:

    Find the existing line that imports from enterpriseRepo (search for `enterpriseRepo` or `updateEnterpriseInsolvencyAsync`). It is likely a namespace import like `import * as enterpriseRepo from ...`. If so, the new function is automatically reachable as `enterpriseRepo.updateEnterpriseRuntimeState`. If it is a named-import block, add `updateEnterpriseRuntimeState` to it. (Read the file first to see which pattern is used.)

    2. Fix the load-path hardcoded zeros at lines 311-312. Replace:

    ```typescript
        capacity: bp.capacity != null && bp.capacity > 0 ? bp.capacity : Math.max((bp.employees ?? []).length, 20), // Phase 12 D-04
        lastApplicants: 0, // Phase 12 D-03 — populated by matching pass
        lastVacancies: 0,  // Phase 12 D-03 — populated by matching pass
    ```

    with:

    ```typescript
        capacity: bp.capacity != null && bp.capacity > 0 ? bp.capacity : Math.max((bp.employees ?? []).length, 20), // Phase 12 D-04
        lastApplicants: bp.lastApplicants ?? 0, // Phase 12 GC1: restore from DB so wage feedback survives pause/resume
        lastVacancies: bp.lastVacancies ?? 0,   // Phase 12 GC1: restore from DB so wage feedback survives pause/resume
    ```

    3. Insert the end-of-iteration write-back loop. Find the line at 3564 that reads:

    ```typescript
          sessionPreviousEnterpriseLedgers.set(sessionId, new Map(enterpriseLedgerMap));
    ```

    Immediately after that line (still inside the same outer iteration loop block, before `iterTelemetry` construction begins at line 3568), add:

    ```typescript
          // ── Phase 12 GC1: Persist enterprise runtime state to DB ──
          // Closes VERIFICATION Gap 1 + Gap 3. wage / employees / lastApplicants / lastVacancies
          // are mutated in-memory by processWageAdjustment (line 719) and the matching pass
          // (line 1380) within this iteration; without this loop they would be lost on pause/resume.
          // SFC invariant: pure metadata write, no fiat movement.
          for (const ent of enterpriseRegistry.values()) {
            enterpriseRepo.updateEnterpriseRuntimeState({
              enterpriseId: ent.id,
              wage: ent.wage,
              employees: [...ent.employees],
              lastApplicants: ent.lastApplicants,
              lastVacancies: ent.lastVacancies,
            });
          }
    ```

    (If the import pattern uses a different name than `enterpriseRepo`, adapt the call accordingly — e.g., `updateEnterpriseRuntimeState({...})` if it's a flat named import.)

    4. Run the full server test suite to confirm no regression in any existing test, and that the new repo test from Task 2 still passes when invoked through this wiring path.
  </action>
  <verify>
    <automated>cd /Users/Code/PolicyLab && npm run test -w server -- --reporter=dot --run 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "lastApplicants: bp.lastApplicants" server/src/orchestration/simulationRunner.ts` exits 0 (load-path hardcode fixed).
    - `grep -q "lastVacancies: bp.lastVacancies" server/src/orchestration/simulationRunner.ts` exits 0.
    - `grep -c "lastApplicants: 0," server/src/orchestration/simulationRunner.ts` returns 0 (the old hardcode is gone — note this checks for the literal "lastApplicants: 0," which was the bug; if any unrelated `lastApplicants: 0` remains in test fixtures, that's fine, but the load path one MUST be removed).
    - `grep -q "updateEnterpriseRuntimeState" server/src/orchestration/simulationRunner.ts` exits 0.
    - `grep -B2 -A2 "updateEnterpriseRuntimeState" server/src/orchestration/simulationRunner.ts | grep -q "for (const ent of enterpriseRegistry.values())"` exits 0 (the call is inside the right loop).
    - `npm run test -w server -- --reporter=dot --run` exits 0 (full suite green; no regression).
    - `npx tsc --noEmit -p server/tsconfig.json` exits with no new errors vs prior tasks.
  </acceptance_criteria>
  <done>Load path reads lastApplicants/lastVacancies from DB; end-of-iteration write-back loop calls updateEnterpriseRuntimeState for every surviving enterprise; full server test suite passes.</done>
</task>

</tasks>

<verification>
- `npx vitest run server/src/db/repos/__tests__/enterpriseRepo.test.ts` — 3/3 tests green (round-trip, dedup, no-op safety).
- `npm run test -w server -- --reporter=dot --run` — full server suite green (no regression in matching pass, wage adjustment, or SFC invariant tests).
- Manual smoke: start `npm run dev`, run a fresh session for 3 iterations, then SQL-inspect `SELECT id, wage, last_applicants, last_vacancies, employees FROM enterprises WHERE session_id = ?` — values match in-memory state and update each iteration. Pausing and reloading the session preserves the values (no reset to 0).
- SFC invariant: not exercised by this plan directly. The wage-property-only invariant from 12-04 sfcInvariant test still passes.
</verification>

<success_criteria>
- VERIFICATION Gap 1 closed: enterprise wage / employees / lastApplicants / lastVacancies persisted at end of every iteration.
- VERIFICATION Gap 3 closed: load path no longer hardcodes lastApplicants/lastVacancies to 0; pause/resume restores the wage feedback signal.
- Defense-in-depth against Gap 2: even if duplicate UUIDs sneak past the bootstrap fix in 12-GC2, the dedup in updateEnterpriseRuntimeState ensures the DB never persists them.
- Existing 591 tests still green; 3 new tests added.
</success_criteria>

<output>
After completion, create `.planning/phases/12-labor-market-realism-enterprise-demographic-alignment-wage-discovery-and-subsistence-fallback-for-produce-and-sell/12-GC1-SUMMARY.md`.
</output>
</content>
</invoke>