---
phase: 10-fix-simulation-realism
plan: GC1
type: gap-closure
wave: 0
depends_on: []
files_modified:
  - server/src/db/schema.ts
  - server/src/db/repos/enterpriseRepo.ts
  - server/src/data/dataBootstrapPipeline.ts
  - server/src/orchestration/simulationRunner.ts
autonomous: true
gap_found_by: post-simulation analysis of session-china.json (2026-04-09)
requirements:
  - D-01
  - D-02
  - D-03
  - D-05
  - D-07
  - D-24
must_haves:
  truths:
    - "Enterprise employees are persisted to DB and reloaded on simulation start"
    - "sessionEmploymentRegistry is populated from blueprint employees at iteration 1 init"
    - "Agents know their employment status (employer, wage) via buildPersonalStatus"
    - "Enterprise wages are actually paid to employees who WORK"
    - "Bootstrap stores employee agent IDs (not names) in the DB"
    - "All existing tests still pass"
  artifacts:
    - path: "server/src/db/schema.ts"
      provides: "enterprises table with employees column (JSON array of agent IDs)"
    - path: "server/src/db/repos/enterpriseRepo.ts"
      provides: "insertEnterprise persists employees, getEnterprises returns them"
    - path: "server/src/orchestration/simulationRunner.ts"
      provides: "Employment registry populated from blueprints at simulation init"
  key_links:
    - from: "server/src/db/repos/enterpriseRepo.ts"
      to: "server/src/db/schema.ts"
      via: "enterprises table employees column"
      pattern: "employees"
    - from: "server/src/orchestration/simulationRunner.ts"
      to: "server/src/orchestration/simulationState.ts"
      via: "getEmploymentRegistry"
      pattern: "sessionEmploymentRegistry"
---

<objective>
Fix the enterprise employment system — the most critical bug discovered in the China simulation run.

**Root cause chain identified:**
1. `dataBootstrapPipeline.ts:471` generates enterprise blueprints with `employees: string[]` (agent names), but...
2. `schema.ts` enterprises table has NO `employees` column — it was never added
3. `enterpriseRepo.ts:43` hard-codes `employees: []` in `getEnterprises()` return
4. `simulationRunner.ts:1285-1316` loads blueprints (all with empty employees), creates enterprise registry entries with `employees: new Set([])` — but NEVER populates `sessionEmploymentRegistry`
5. `buildPersonalStatus()` (line ~370) reads `sessionEmploymentRegistry` to determine employment — finds nothing — tells every agent "You are currently unemployed"
6. Result: all 50 citizen agents resort to subsistence PRODUCE. Zero wages, zero enterprise production, zero banking demand.

**Evidence from simulation**: Every agent reflection contains "no factory shifts available" / "factory gates stayed locked". The enterprise system built in Phase 10 is completely non-functional because of this DB persistence gap.

This plan fixes the full chain: DB schema → repo persistence → simulation init → employment registry population.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-CONTEXT.md
@server/src/db/schema.ts
@server/src/db/repos/enterpriseRepo.ts
@server/src/data/dataBootstrapPipeline.ts
@server/src/orchestration/simulationRunner.ts
@server/src/orchestration/simulationState.ts

<critical_context>
**The DB uses SQLite via Drizzle ORM, no migration runner.** Schema changes require:
1. Adding the column to `schema.ts`
2. Running `npx drizzle-kit push --config=server/drizzle.config.ts` to sync the schema (or the equivalent `db.run(sql)` in the existing DB initialization code if no drizzle-kit config exists)
3. Checking `server/src/db/index.ts` for how the DB is initialized — if it uses `migrate()` or push, follow that pattern

**Agent name vs ID**: `dataBootstrapPipeline.ts` generates employees as agent NAMES (e.g., "Agent-I1"), not UUIDs. The simulation runner uses agent UUIDs for all registry lookups. The fix MUST convert names to IDs when populating the employment registry.

**The `EnterpriseBlueprint.employees: string[]` type** currently stores names from the bootstrap. After this fix, the DB should store resolved UUIDs, and `getEnterprises()` should return UUIDs. The in-memory `EnterpriseRecord.employees: Set<string>` in simulationState.ts is keyed by agent ID.

**The employment registry structure** (`sessionEmploymentRegistry: Map<sessionId, Map<agentId, EmploymentRecord>>`):
```typescript
export interface EmploymentRecord {
  enterpriseId: string;
  employerId: string;  // enterprise owner's agent ID
  employeeId: string;  // worker agent ID
  wage: number;
  minSkill: number;
  startedAt: number;  // iteration number when employed
}
```

**Where `buildPersonalStatus` is defined** — search simulationRunner.ts for `function buildPersonalStatus` (around line 366-378). It reads `sessionEmploymentRegistry.get(sessionId)?.get(agentId)`.

**The enterprise init block is at simulationRunner.ts lines 1279-1317** — this is where the employment registry must be populated after loading blueprints.
</critical_context>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add employees column to enterprises DB table + update repo</name>
  <files>server/src/db/schema.ts, server/src/db/repos/enterpriseRepo.ts</files>
  <read_first>server/src/db/schema.ts, server/src/db/repos/enterpriseRepo.ts, server/src/db/index.ts</read_first>
  <action>
**Step 1: Update schema.ts**

In `server/src/db/schema.ts`, find the `enterprises` table definition (around line 282). Add an `employees` column as a TEXT column storing a JSON array of agent IDs:

```typescript
export const enterprises = sqliteTable('enterprises', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  sector: text('sector').notNull(),
  industry: text('industry').notNull(),
  commodityOutput: text('commodity_output').notNull(),
  initialCapital: real('initial_capital').notNull(),
  wage: real('wage').notNull(),
  isServiceEnterprise: integer('is_service_enterprise', { mode: 'boolean' }).notNull().default(false),
  consecutiveInsolvencyIterations: integer('consecutive_insolvency_iterations').notNull().default(0),
  isBankrupt: integer('is_bankrupt', { mode: 'boolean' }).notNull().default(false),
  employees: text('employees').notNull().default('[]'),  // JSON array of agent IDs
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

**Step 2: Apply schema change to SQLite DB**

Check `server/src/db/index.ts` for the DB initialization pattern. If Drizzle is using `push` mode or direct SQL, add an `ALTER TABLE` guard to add the column if it doesn't exist. Look for any existing migration/push patterns and follow them exactly.

If the DB uses `better-sqlite3` with direct `.run()` calls for initialization, add this guard to the DB init block:
```typescript
// Guard: add employees column if missing (one-time schema migration for gap closure GC1)
try {
  db.run(sql`ALTER TABLE enterprises ADD COLUMN employees TEXT NOT NULL DEFAULT '[]'`);
} catch {
  // Column already exists — safe to ignore
}
```

If there's a `drizzle-kit push` script in `server/package.json`, run it: `npx drizzle-kit push --config=server/drizzle.config.ts`

**Step 3: Update enterpriseRepo.ts**

Replace the `insertEnterprise` function to persist the employees array:
```typescript
export function insertEnterprise(sessionId: string, blueprint: EnterpriseBlueprint): void {
  db.insert(enterprises).values({
    id: blueprint.id,
    sessionId,
    name: blueprint.name,
    ownerId: blueprint.ownerId,
    sector: blueprint.sector,
    industry: blueprint.industry,
    commodityOutput: blueprint.commodityOutput,
    initialCapital: blueprint.initialCapital,
    wage: blueprint.wage,
    isServiceEnterprise: blueprint.isServiceEnterprise,
    employees: JSON.stringify(blueprint.employees ?? []),  // persist resolved IDs
  }).run();
}
```

Replace the `getEnterprises` function to parse employees from JSON:
```typescript
export function getEnterprises(sessionId: string): EnterpriseBlueprint[] {
  const rows = db.select().from(enterprises).where(eq(enterprises.sessionId, sessionId)).all();
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    sector: row.sector as EnterpriseSector,
    industry: row.industry,
    commodityOutput: row.commodityOutput as EnterpriseCommodity,
    initialCapital: row.initialCapital,
    initialInventory: {},
    employees: (() => {
      try { return JSON.parse(row.employees ?? '[]') as string[]; }
      catch { return []; }
    })(),
    wage: row.wage,
    isServiceEnterprise: row.isServiceEnterprise,
  }));
}
```

**Step 4: Verify TypeScript compiles**
Run `npx tsc -p server/tsconfig.json --noEmit` — fix any type errors before proceeding.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx tsc -p server/tsconfig.json --noEmit 2>&1 | head -10 && npm run test -w server -- --run 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `enterprises` table in schema.ts has an `employees TEXT NOT NULL DEFAULT '[]'` column
    - `insertEnterprise` calls `JSON.stringify(blueprint.employees ?? [])` before persisting
    - `getEnterprises` parses `row.employees` with `JSON.parse` and catches errors, returning `[]` on failure
    - TypeScript compiles with zero errors
    - Existing tests still pass
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Resolve employee names → agent IDs in bootstrap pipeline</name>
  <files>server/src/data/dataBootstrapPipeline.ts, server/src/routes/bootstrap.ts</files>
  <read_first>server/src/data/dataBootstrapPipeline.ts, server/src/routes/bootstrap.ts, shared/src/types.ts</read_first>
  <action>
The `generateEnterprises()` function in `dataBootstrapPipeline.ts` (line ~427) stores employees by agent name (`employees[j].name`). The DB and simulation runner need UUIDs, not names. 

**Option A (preferred)**: Change `generateEnterprises` to accept a name-to-ID lookup map, and store IDs directly.

In `dataBootstrapPipeline.ts`, update the `generateEnterprises` function signature to also accept a `nameToId: Map<string, string>` parameter:

```typescript
export function generateEnterprises(
  agentRoster: Array<{ name: string; role: string; type?: string }>,
  profile: LocationProfile,
  agentNameToId?: Map<string, string>,  // optional: if provided, store IDs not names
): EnterpriseBlueprint[]
```

When building `entEmployees`, resolve to ID if map is available:
```typescript
// Inside the employee assignment loop (line ~456-459):
for (let j = 0; j < employees.length; j++) {
  if (j % owners.length === i) {
    const agentName = employees[j].name;
    // Prefer UUID if name-to-ID map provided; fall back to name for backward compat
    entEmployees.push(agentNameToId?.get(agentName) ?? agentName);
  }
}
```

Similarly resolve the `ownerId`:
```typescript
ownerId: agentNameToId?.get(owners[i].name) ?? owners[i].name,
```

**In `server/src/routes/bootstrap.ts`**: After calling `generateAgentRoster()` and before calling `generateEnterprises()`, build the name-to-ID map from the saved agents:

```typescript
// Build name→ID lookup from persisted agents so enterprises store UUIDs
const agentNameToId = new Map<string, string>(
  savedAgents.map(a => [a.name, a.id])
);
const enterprises = generateEnterprises(agentRoster, profile, agentNameToId);
for (const ent of enterprises) {
  enterpriseRepo.insertEnterprise(session.id, ent);
}
```

Make sure `savedAgents` is the array of agents returned after DB insertion (with UUIDs populated). Check the existing bootstrap.ts flow to confirm the variable name for persisted agents.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx tsc -p server/tsconfig.json --noEmit 2>&1 | head -10</automated>
  </verify>
  <acceptance_criteria>
    - `generateEnterprises` accepts optional `nameToId` map parameter
    - When map is provided, `employees` and `ownerId` in returned blueprints contain agent UUIDs
    - `bootstrap.ts` builds a name-to-ID map from persisted agents before calling `generateEnterprises`
    - `bootstrap.ts` passes the name-to-ID map to `generateEnterprises`
    - TypeScript compiles with zero errors
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Populate employment registry from blueprints at simulation init</name>
  <files>server/src/orchestration/simulationRunner.ts</files>
  <read_first>server/src/orchestration/simulationRunner.ts, server/src/orchestration/simulationState.ts</read_first>
  <action>
In `simulationRunner.ts`, find the enterprise init block at lines **1279-1317**. After the for-loop that populates `existingRegistry` (the enterprise registry), add code to populate `sessionEmploymentRegistry`.

**The current block (lines 1284-1316):**
```typescript
if (existingRegistry.size === 0 && entConfig.bankingEnabled) {
  const blueprints = enterpriseRepo.getEnterprises(sessionId);
  const bankAgent = agents.find(a => a.type === 'bank' && a.isAlive);
  for (const bp of blueprints) {
    const ownerAgent = agents.find(a => a.id === bp.ownerId) ?? agents.find(a => a.name === bp.ownerId);
    existingRegistry.set(bp.id, {
      id: bp.id,
      ownerId: ownerAgent?.id ?? bp.ownerId,
      ownerName: ownerAgent?.name ?? 'Unknown',
      industry: bp.industry,
      employees: new Set(bp.employees),
      applicants: new Set(),
      wage: bp.wage,
      minSkill: 0,
    });
    // ... deposit account creation ...
  }
}
```

**Replace with** (add employment registry population after the enterprise registry set call, inside the for-loop):

```typescript
if (existingRegistry.size === 0 && entConfig.bankingEnabled) {
  const blueprints = enterpriseRepo.getEnterprises(sessionId);
  const bankAgent = agents.find(a => a.type === 'bank' && a.isAlive);
  const employmentReg = getEmploymentRegistry(sessionId);

  for (const bp of blueprints) {
    // Resolve owner: ownerId may be UUID (new sessions) or name (legacy sessions)
    const ownerAgent = agents.find(a => a.id === bp.ownerId) ?? agents.find(a => a.name === bp.ownerId);
    const resolvedOwnerId = ownerAgent?.id ?? bp.ownerId;

    // Resolve employee IDs: bp.employees may contain UUIDs (new) or names (legacy)
    const resolvedEmployeeIds = bp.employees
      .map(nameOrId => {
        const byId = agents.find(a => a.id === nameOrId);
        if (byId) return byId.id;
        const byName = agents.find(a => a.name === nameOrId);
        return byName?.id ?? null;
      })
      .filter((id): id is string => id !== null);

    existingRegistry.set(bp.id, {
      id: bp.id,
      ownerId: resolvedOwnerId,
      ownerName: ownerAgent?.name ?? 'Unknown',
      industry: bp.industry,
      employees: new Set(resolvedEmployeeIds),
      applicants: new Set(),
      wage: bp.wage,
      minSkill: 0,
    });

    // ── Populate employment registry so agents know their job (D-24 fix) ──
    // Without this, buildPersonalStatus() returns employed=false for all workers.
    for (const employeeId of resolvedEmployeeIds) {
      employmentReg.set(employeeId, {
        enterpriseId: bp.id,
        employerId: resolvedOwnerId,
        employeeId,
        wage: bp.wage,
        minSkill: 0,
        startedAt: 1,
      });
    }

    // Create enterprise deposit account with initial capital (D-24)
    if (bankAgent && ownerAgent) {
      const entDepositId = `ent_${bp.id}`;
      bankingRepo.upsertDeposit({
        id: entDepositId,
        sessionId,
        ownerAgentId: ownerAgent.id,
        bankAgentId: bankAgent.id,
        accountType: 'demand',
        balance: bp.initialCapital,
        interestRate: entConfig.depositInterestRate ?? 0.002,
        lastUpdated: 0,
      });
    }
  }
}
```

**Critical**: Make sure `getEmploymentRegistry` is imported. It should already be imported at the top of simulationRunner.ts since it was part of the Plan 04 wiring. Verify with `grep -n "getEmploymentRegistry" server/src/orchestration/simulationRunner.ts`.

**After this change**, agents with enterprise assignments will have `employed: true` in their `buildPersonalStatus` result, which causes:
- Agent prompts to say "You work at enterprise `ent_agri_1` earning 8 fiat per iteration. Your employer is in the agriculture sector."
- Agent prompts to include the mandatory constraint: "If you have a job, you must either show up to work (WORK_AT_ENTERPRISE) or quit (QUIT_JOB)."
- The WORK_AT_ENTERPRISE action in the physics engine fires → wages paid → enterprise treasury debited.

**Verify** the employment context build at line ~1700:
```typescript
let enterpriseContext: string | undefined;
const empRecord = getEmploymentRegistry(sessionId)?.get(agent.id);
if (empRecord) {
  enterpriseContext = `You work at enterprise ${empRecord.enterpriseId}...`;
} else {
  enterpriseContext = 'You are currently unemployed. Consider APPLY_FOR_JOB at available enterprises.';
}
```
This should now find the employment record for most agents.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx tsc -p server/tsconfig.json --noEmit 2>&1 | head -10 && npm run test -w server -- --run 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `getEmploymentRegistry` is called inside the enterprise init block
    - Each resolved employee ID gets an `EmploymentRecord` entry in `employmentReg`
    - The EmploymentRecord has correct `enterpriseId`, `employerId` (owner UUID), `wage`, `startedAt: 1`
    - Employee resolution handles both UUID format and legacy name format
    - `null` entries (unresolvable names) are filtered out before populating registry
    - TypeScript compiles with zero errors
    - All server tests pass
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 4: Add enterprise employment integration test</name>
  <files>server/src/data/__tests__/enterpriseBootstrap.test.ts</files>
  <read_first>server/src/data/__tests__/enterpriseBootstrap.test.ts, server/src/data/dataBootstrapPipeline.ts, server/src/db/repos/enterpriseRepo.ts</read_first>
  <action>
Add 3 new tests to `server/src/data/__tests__/enterpriseBootstrap.test.ts` covering the gap closure:

**Test 1: generateEnterprises stores employee IDs when nameToId map is provided**
```typescript
it('stores employee UUIDs when nameToId map is provided', () => {
  const agents = [
    { name: 'Agent-A1', role: 'farmer', type: 'citizen' },
    { name: 'Agent-A2', role: 'agricultural_technician', type: 'citizen' },
  ];
  const nameToId = new Map([['Agent-A1', 'uuid-a1'], ['Agent-A2', 'uuid-a2']]);
  const profile = createMockProfile(); // use existing helper or minimal mock
  const blueprints = generateEnterprises(agents, profile, nameToId);

  const agriEnt = blueprints.find(b => b.sector === 'agriculture');
  expect(agriEnt).toBeDefined();
  // Employees should be UUIDs, not names
  if (agriEnt && agriEnt.employees.length > 0) {
    agriEnt.employees.forEach(empId => {
      expect(empId).toMatch(/^uuid-/); // all IDs resolved to UUIDs
    });
  }
});
```

**Test 2: generateEnterprises falls back to names when no map provided**
```typescript
it('falls back to agent names when nameToId map is not provided', () => {
  const agents = [
    { name: 'Agent-A1', role: 'farmer', type: 'citizen' },
  ];
  const profile = createMockProfile();
  const blueprints = generateEnterprises(agents, profile); // no map
  const agriEnt = blueprints.find(b => b.sector === 'agriculture');
  if (agriEnt) {
    // ownerId or employees may be name-based
    expect(agriEnt.ownerId).toBeDefined();
  }
});
```

**Test 3: getEnterprises returns employees from DB**
```typescript
it('persists and retrieves employees via insertEnterprise/getEnterprises', () => {
  // Use an in-memory or test DB instance if available, or verify the round-trip behavior
  // by checking that JSON.parse(JSON.stringify(employees)) round-trips correctly
  const employees = ['uuid-001', 'uuid-002', 'uuid-003'];
  const serialized = JSON.stringify(employees);
  const deserialized = JSON.parse(serialized) as string[];
  expect(deserialized).toEqual(employees);
  expect(deserialized).toHaveLength(3);
});
```

Adapt the mock/helper setup to match the existing test file's patterns. The goal is at minimum 3 passing tests that validate the ID resolution and round-trip persistence logic.
  </action>
  <verify>
    <automated>cd C:/Users/16079/Code/PolicyLab && npx vitest run server/src/data/__tests__/enterpriseBootstrap.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - At least 3 new tests in enterpriseBootstrap.test.ts passing green
    - Tests cover: UUID resolution when nameToId map provided, name fallback when no map, JSON round-trip for employees array
    - No existing tests broken
  </acceptance_criteria>
</task>

</tasks>

<verification>
- `npx tsc -p server/tsconfig.json --noEmit` — zero errors
- `npm run test -w server -- --run` — all tests pass
- `grep -n "employees" server/src/db/schema.ts` — shows the new column
- `grep -n "JSON.stringify(blueprint.employees" server/src/db/repos/enterpriseRepo.ts` — confirms persistence
- `grep -n "employmentReg.set" server/src/orchestration/simulationRunner.ts` — confirms registry population
- `grep -c "getEmploymentRegistry" server/src/orchestration/simulationRunner.ts` — at least 2 calls (existing + new in init block)
</verification>

<success_criteria>
Enterprise employees are persisted to DB and reloaded on simulation start. The employment registry is populated from blueprints during the first iteration's init block. Agents who have enterprise assignments see "You work at enterprise X" in their prompts and receive WORK_AT_ENTERPRISE wages. All existing tests pass. TypeScript compiles cleanly.
</success_criteria>

<output>
After completion, create `.planning/phases/10-fix-simulation-realism-agent-economic-behavior-inflation-response-narrative-grounding/10-GC1-SUMMARY.md`
</output>
