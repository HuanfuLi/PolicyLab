---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: GC1
type: execute
wave: 1
depends_on: []
files_modified:
  - server/src/orchestration/simulationRunner.ts
  - server/src/orchestration/helpers/weekState.ts
  - server/src/orchestration/helpers/sfcAudit.ts
  - server/src/__tests__/sfcUnderflowLedger.test.ts
  - server/src/__tests__/orderBookGhostGuards.test.ts
  - server/src/__tests__/sfcAuditBankExclusion.test.ts
autonomous: true
gap_closure: true
requirements: [D-20, D-21, D-22]
decisions_addressed: [D-20, D-21, D-22]
must_haves:
  truths:
    - "A US bootstrap 5-iteration run shows |sfcDrift| ≤ 0.1 for every iteration (iter 1 included)"
    - "When an agent's wealth + wealthDelta goes negative at commit, the shortfall is routed to treasury — not silently destroyed"
    - "Order-book matches where either buyer or seller is missing from weekStateMap are voided, not half-applied"
    - "computeSystemFiatTotal filters out bank agents from the agent fiat sum (honoring the JSDoc contract)"
  artifacts:
    - path: "server/src/orchestration/simulationRunner.ts"
      provides: "physicsUnderflowPool accumulator inside physicsActions bracket; ghost-side guards on order-book path"
      contains: "physicsUnderflowPool"
    - path: "server/src/orchestration/helpers/sfcAudit.ts"
      provides: "Bank-type exclusion filter matching the JSDoc"
      contains: "agent.type !== 'bank'"
    - path: "server/src/__tests__/sfcUnderflowLedger.test.ts"
      provides: "Regression test — agent overdrawn by MET+VAT cascade does not destroy fiat"
    - path: "server/src/__tests__/orderBookGhostGuards.test.ts"
      provides: "Regression test — ghost seller / ghost buyer trades void cleanly"
    - path: "server/src/__tests__/sfcAuditBankExclusion.test.ts"
      provides: "Regression test — bank-agent wealth not double-counted with depositBalances"
  key_links:
    - from: "server/src/orchestration/simulationRunner.ts:1987 (clampWealth commit)"
      to: "sessionStateTreasury (via physicsUnderflowPool)"
      via: "underflow shortfall ledger accumulated inside physicsActions bracket"
      pattern: "physicsUnderflowPool"
    - from: "server/src/orchestration/simulationRunner.ts:1478-1541 (order-book loop)"
      to: "weekStateMap lookup guards"
      via: "early continue when sellerState or buyerState missing (except SYSTEM_NPC buyer)"
      pattern: "ORDER-BOOK-SKIP"
    - from: "server/src/orchestration/helpers/sfcAudit.ts:25"
      to: "agent.type filter"
      via: "agent.isAlive && agent.type !== 'bank'"
      pattern: "agent.type !== 'bank'"
---

<objective>
Close the physics-subsystem SFC leak that produced −2655.17 fiat drift on iter 1 of the US bootstrap smoke test. Primary cause per forensics-G1 §H3: `clampWealth(value) = Math.max(0, value)` at `server/src/orchestration/helpers/weekState.ts:55-57` silently destroys fiat when an agent's running wealth goes negative after Phase-11's VAT + amm_sell + wage + MET auto-buy cascade. Secondary fix per §H2: order-book path at `simulationRunner.ts:1478-1541` debits buyer unconditionally but only credits seller when seller is in `weekStateMap` — voiding stale cross-iteration orders from evicted agents. Tertiary fix per §H6: `helpers/sfcAudit.ts:25-27` JSDoc claims bank-agent exclusion but the code does NOT implement it.

Purpose: Without this fix, D-20/D-21/D-22 ship as telemetry theater — the dashboard correctly flags drift but the underlying leak is unfixable because it is the product of a hot-path silent-destruction pattern. The LLM smoke test cannot be re-run until G1 is closed.

Output: Three production patches + three TDD regression tests. All 104 pre-existing SFC tests remain green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-CONTEXT.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G1-physics-sfc-leak.md
@.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-07-SUMMARY.md

<interfaces>
<!-- Extracted from codebase. Executor uses these directly — no exploration needed. -->

From server/src/orchestration/helpers/weekState.ts:
```typescript
// CURRENT — destroys fiat silently when value < 0
export function clampWealth(value: number): number {
  return Math.max(0, value);
}
```

From server/src/orchestration/helpers/sfcAudit.ts:
```typescript
// JSDoc CLAIMS bank exclusion but implementation does NOT filter by type:
export function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
  depositBalances: number = 0,
  collateralEscrow: number = 0,
  publicGoodsEscrow: number = 0,
): number
// agentFiat at line 25-27 filters only .isAlive, NOT .type !== 'bank'
```

From server/src/orchestration/simulationState.ts:
```typescript
export const sessionStateTreasury = new Map<string, number>();
export const sessionLastPhysicsTraces = new Map<string, string>();
export function appendTrace(sessionId: string, newContent: string): void;
```

From simulationRunner.ts physicsActions bracket:
- Opens at line 1197: `const physicsBefore = snapshotTotal();`
- Closes at line 2208: `sfcBySubsystem.physicsActions += (snapshotTotal() - physicsBefore);`
- Wealth commit clamp inside bracket at line 1987: `let newWealth = clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta));`
- Order-book loop at lines 1478-1541 (see forensics-G1 §H2 for exact code)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — failing regression tests for H3 (clampWealth underflow) + H2 (order-book ghost sides) + H6 (sfcAudit bank double-count)</name>
  <files>server/src/__tests__/sfcUnderflowLedger.test.ts, server/src/__tests__/orderBookGhostGuards.test.ts, server/src/__tests__/sfcAuditBankExclusion.test.ts</files>
  <read_first>
    - server/src/__tests__/sfcUnderflowLedger.test.ts (new — will not exist, confirm)
    - server/src/__tests__/orderBookGhostGuards.test.ts (new — will not exist, confirm)
    - server/src/__tests__/sfcAuditBankExclusion.test.ts (new — will not exist, confirm)
    - server/src/__tests__/sfcPhase11.test.ts (read existing patterns; steal fixture helpers)
    - server/src/__tests__/sfcTaxation.test.ts (read existing patterns)
    - server/src/orchestration/helpers/weekState.ts (full — understand clampWealth contract)
    - server/src/orchestration/helpers/sfcAudit.ts (full)
    - server/src/mechanics/orderBook.ts (understand submitOrder + matchOrders API; look at default export and class methods)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G1-physics-sfc-leak.md §3.2, §3.3 (minimum repro templates)
  </read_first>
  <behavior>
    sfcUnderflowLedger.test.ts:
    - Test 1 (H3): "physicsActions bracket: fiat is preserved when an agent's wealthDelta exceeds their starting wealth"
      - Given an agent with initialWealth=50, simulate a wealthDelta=-80 being committed through the clampWealth pipeline
      - Assert: after commit, the total fiat in the system (agent wealth + treasury + AMM reserves) equals the pre-commit baseline within 0.01 fiat
      - Expected failure mode today: test currently fails because 30 fiat is silently destroyed
    - Test 2 (H3): "shortfall ledger routes underflow to treasury — not to void"
      - Given a batch of 3 agents with wealthDeltas [-10, -20, -30] starting from wealth [5, 15, 25]
      - Assert: after commit, sessionStateTreasury gained exactly (5 + 5 + 5) = 15 fiat from the 3 shortfalls
    - Test 3 (H3): "agents who finish positive are not charged against the underflow pool"
      - Given one agent overdrawn by 30, one agent positive by 100, run commit
      - Assert: the positive agent's final wealth is NOT reduced by the overdrawn agent's 30

    orderBookGhostGuards.test.ts:
    - Test 1 (H2): "ghost seller trade voids cleanly — buyer not debited"
      - Submit sell order from agentId='ghost-uuid-not-in-weekStateMap' and matching buy from real buyer
      - Assert: after clearing, buyer's wealthDelta is unchanged (0), no [TAX] VAT trace emitted, no treasury credit
    - Test 2 (H1, sign-mirror sanity): "ghost buyer trade voids cleanly — seller not credited"
      - Submit buy order from agentId='ghost-buyer-uuid' (not SYSTEM_NPC) and matching sell from real seller
      - Assert: after clearing, seller's wealthDelta is unchanged (0)
    - Test 3 (regression): "SYSTEM_NPC buyer path still works (not broken by guards)"
      - Submit buy from SYSTEM_NPC + sell from real seller, with treasury=1000
      - Assert: seller credited (fundedCost - sellTax), treasury debited fundedCost then credited sellTax

    sfcAuditBankExclusion.test.ts:
    - Test 1 (H6): "computeSystemFiatTotal excludes bank-agent wealth"
      - Create 2 agents: one citizen with wealth=100, one bank-agent with wealth=500
      - Call computeSystemFiatTotal([citizen, bank], undefined, undefined, 0, undefined, 500 /* depositBalances */)
      - Assert: returned total = 100 (citizen) + 500 (depositBalances) = 600 — NOT 1100 (which would double-count bank wealth)
    - Test 2 (H6 regression): "isAlive filter still applied after bank filter"
      - Bank agent marked isAlive=false should not appear anyway; citizen agent isAlive=false also excluded
      - Assert: only alive non-bank agents contribute to agentFiat
  </behavior>
  <action>
    Create three new test files matching existing sfcPhase11.test.ts import + scaffolding style. Use vitest describe/it/expect. Import `computeSystemFiatTotal` from `../orchestration/helpers/sfcAudit.ts` for test 3. For orderBook tests, import `OrderBook` from `../mechanics/orderBook.ts` and test via a helper function `driveOrderBookClearing` that YOU MUST extract from simulationRunner.ts:1477-1542 as a pure helper (see Task 2). Until the helper exists, mark orderBookGhostGuards.test.ts tests with a clear TODO note — they will go GREEN after Task 2. For underflow tests, use a small helper that applies the clampWealth+shortfall pattern to a batch of agents.

    **Commit message:** `test(11-GC1): add failing tests for physics underflow ledger + order-book ghost guards + sfcAudit bank exclusion`

    **Run after writing:** `npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts server/src/__tests__/orderBookGhostGuards.test.ts server/src/__tests__/sfcAuditBankExclusion.test.ts`
    Expected: all tests FAIL (RED).
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts server/src/__tests__/orderBookGhostGuards.test.ts server/src/__tests__/sfcAuditBankExclusion.test.ts 2>&1 | grep -E "FAIL|failed"</automated>
  </verify>
  <acceptance_criteria>
    - grep `test.*shortfall ledger routes underflow to treasury` in server/src/__tests__/sfcUnderflowLedger.test.ts returns 1+ match
    - grep `ghost seller trade voids cleanly` in server/src/__tests__/orderBookGhostGuards.test.ts returns 1+ match
    - grep `computeSystemFiatTotal excludes bank-agent wealth` in server/src/__tests__/sfcAuditBankExclusion.test.ts returns 1+ match
    - `npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts` output contains "FAIL" or "failed"
    - git log -1 --format=%s contains `test(11-GC1)`
  </acceptance_criteria>
  <done>Three test files committed RED; each has ≥2 explicit assertions; all fail for the reason the forensics predicts (not for import errors or typos).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — H3 shortfall ledger, H2 ghost-side guards, H6 bank-type filter</name>
  <files>server/src/orchestration/simulationRunner.ts, server/src/orchestration/helpers/sfcAudit.ts, server/src/__tests__/sfcUnderflowLedger.test.ts, server/src/__tests__/orderBookGhostGuards.test.ts, server/src/__tests__/sfcAuditBankExclusion.test.ts</files>
  <read_first>
    - server/src/orchestration/simulationRunner.ts (read lines 1190-1210, 1475-1545, 1980-2010, 2200-2215 — physicsActions bracket boundaries + commit loop + order-book loop)
    - server/src/orchestration/helpers/sfcAudit.ts (full — 38 lines)
    - server/src/orchestration/helpers/weekState.ts (full — understand existing clampWealth contract)
    - server/src/orchestration/simulationState.ts (confirm sessionStateTreasury + appendTrace APIs)
    - .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/forensics-G1-physics-sfc-leak.md §4 (fix direction pseudocode for all three hypotheses)
    - server/src/__tests__/sfcUnderflowLedger.test.ts (just written in Task 1)
    - server/src/__tests__/orderBookGhostGuards.test.ts (just written in Task 1)
    - server/src/__tests__/sfcAuditBankExclusion.test.ts (just written in Task 1)
  </read_first>
  <behavior>
    After this task:
    - sfcUnderflowLedger.test.ts: all 3 tests GREEN
    - orderBookGhostGuards.test.ts: all 3 tests GREEN
    - sfcAuditBankExclusion.test.ts: all 2 tests GREEN
    - Pre-existing sfcPhase11.test.ts + sfcTaxation.test.ts + sfcEscrow.test.ts + all other Phase-11 tests remain GREEN
    - `npm run test -w server` shows 485+ passing (baseline was 485 per 11-VALIDATION.md; exactly 485 + 8 new GC1 tests = 493; 5 pre-existing failures unchanged)
  </behavior>
  <action>
    Three atomic patches in order:

    **Patch A — H3 shortfall ledger (simulationRunner.ts):**
    1. Inside the physicsActions bracket (between `:1197` `const physicsBefore = snapshotTotal();` and `:2208` `sfcBySubsystem.physicsActions += ...`), declare `let physicsUnderflowPool = 0;` at the top of the block (near line 1200, before the Ghost Enterprise Cleanup sub-block).
    2. Modify the statUpdate commit loop at `:1987`. Replace:
       ```ts
       let newWealth = clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta));
       ```
       with:
       ```ts
       const raw = agent.currentStats.wealth + r4(weekState.wealthDelta);
       if (raw < 0) {
         physicsUnderflowPool += -raw;
         appendTrace(sessionId, `[PHYSICS-UNDERFLOW] agent=${agent.id} overdrawn by ${(-raw).toFixed(2)} fiat — routed to treasury`);
       }
       let newWealth = clampWealth(raw);
       ```
    3. AFTER the commit loop closes and BEFORE `sfcBySubsystem.physicsActions += (snapshotTotal() - physicsBefore);` at `:2208`, flush the pool:
       ```ts
       if (physicsUnderflowPool > 0) {
         sessionStateTreasury.set(sessionId, (sessionStateTreasury.get(sessionId) ?? 0) + physicsUnderflowPool);
       }
       ```
       This keeps the shortfall inside the physicsActions bracket so snapshotTotal() after sees treasury credited — net zero drift.

    **Patch B — H2 order-book ghost guards (simulationRunner.ts):**
    At `simulationRunner.ts:1478-1482`, restructure the loop header. Forensics §4 "Fix for H2" pseudocode:
    ```ts
    for (const trade of trades) {
      const buyerState  = weekStateMap.get(trade.buyerId);
      const sellerState = weekStateMap.get(trade.sellerId);
      const isSystemNpcBuyer = trade.buyerId === 'SYSTEM_NPC';
      if (!sellerState) {
        appendTrace(sessionId, `[ORDER-BOOK-SKIP] Ghost seller ${trade.sellerId} — trade voided`);
        continue;
      }
      if (!buyerState && !isSystemNpcBuyer) {
        appendTrace(sessionId, `[ORDER-BOOK-SKIP] Ghost buyer ${trade.buyerId} — trade voided`);
        continue;
      }
      const basePrice = trade.executionPrice * trade.quantity;
      // ... existing path A / B / C logic unchanged ...
    }
    ```
    The SYSTEM_NPC-buyer path (existing `else if (trade.buyerId === 'SYSTEM_NPC')` at `:1499`) already `continue`s, so keep its body as-is. The early-continue guards above PRE-EMPT path A from firing when sellerState is absent (which was the observed leak).

    **Patch C — H6 sfcAudit bank filter (helpers/sfcAudit.ts):**
    At `server/src/orchestration/helpers/sfcAudit.ts:25-27`, replace:
    ```ts
    const agentFiat = agents
      .filter(agent => agent.isAlive)
      .reduce(...);
    ```
    with:
    ```ts
    const agentFiat = agents
      .filter(agent => agent.isAlive && agent.type !== 'bank')  // honour the JSDoc contract — bank reserves counted via depositBalances
      .reduce(...);
    ```
    No JSDoc change needed — it already says the right thing; code now matches it.

    **Extract orderBook helper for testability (if needed by Task 1 tests):**
    If orderBookGhostGuards.test.ts in Task 1 needs a pure `driveOrderBookClearing` helper to isolate the loop, extract lines 1477-1542 (the `for (const trade of trades)` loop body) into `server/src/orchestration/helpers/orderBookClearing.ts` as an exported pure function taking `{ trades, weekStateMap, sessionId, iterEconomyConfig, appendTraceFn, getTreasuryFn, setTreasuryFn }`. Call it from simulationRunner.ts where the loop used to be. If the tests can verify via integration-style state manipulation instead, skip the extraction and keep the loop inline. Prefer extraction ONLY if the tests cannot be written against the inline loop — decide per test feasibility.

    **Commit messages (atomic):**
    1. `fix(11-GC1): shortfall ledger preserves fiat when wealth underflows at commit`
    2. `fix(11-GC1): order-book requires both buyer and seller states before mutation`
    3. `fix(11-GC1): sfcAudit excludes bank agents from agent fiat sum per JSDoc`

    **Run after each patch:** `npm run test -w server -- --reporter=default` — verify the target test turns GREEN and no regressions in other Phase-11 tests.
  </action>
  <verify>
    <automated>npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts server/src/__tests__/orderBookGhostGuards.test.ts server/src/__tests__/sfcAuditBankExclusion.test.ts server/src/__tests__/sfcPhase11.test.ts server/src/__tests__/sfcTaxation.test.ts server/src/__tests__/sfcEscrow.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - grep `physicsUnderflowPool` in server/src/orchestration/simulationRunner.ts returns ≥ 3 matches (declaration + accumulation + flush)
    - grep `\[PHYSICS-UNDERFLOW\]` in server/src/orchestration/simulationRunner.ts returns 1 match (the appendTrace call)
    - grep `ORDER-BOOK-SKIP` in server/src/orchestration/simulationRunner.ts returns 2 matches (ghost seller + ghost buyer)
    - grep `agent.type !== 'bank'` in server/src/orchestration/helpers/sfcAudit.ts returns 1 match
    - grep `\.filter\(agent => agent.isAlive\)\.reduce` in server/src/orchestration/helpers/sfcAudit.ts returns 0 matches (old pattern removed)
    - `npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts` shows 3 passed, 0 failed
    - `npx vitest run server/src/__tests__/orderBookGhostGuards.test.ts` shows 3 passed, 0 failed
    - `npx vitest run server/src/__tests__/sfcAuditBankExclusion.test.ts` shows 2 passed, 0 failed
    - `npm run test -w server` shows ≥ 493 passed (485 baseline + 8 new), ≤ 5 failed (pre-existing only)
    - git log -3 --format=%s contains three `fix(11-GC1):` commits
  </acceptance_criteria>
  <done>All 3 hypotheses' regression tests GREEN. Full server suite passes 493+/498 (pre-existing 5 failures unchanged). No new TypeScript errors (`tsc --noEmit -p server/tsconfig.json` diff vs base: flat).</done>
</task>

</tasks>

<verification>
- grep `physicsUnderflowPool` server/src/orchestration/simulationRunner.ts: ≥ 3 matches
- grep `ORDER-BOOK-SKIP` server/src/orchestration/simulationRunner.ts: 2 matches
- grep `agent.type !== 'bank'` server/src/orchestration/helpers/sfcAudit.ts: 1 match
- `npx vitest run server/src/__tests__/sfcUnderflowLedger.test.ts server/src/__tests__/orderBookGhostGuards.test.ts server/src/__tests__/sfcAuditBankExclusion.test.ts`: 8 passed, 0 failed
- `npm run test -w server`: ≥ 493 passed
- Phase 11 existing tests (sfcPhase11, sfcTaxation, sfcEscrow, structuralPressures, etc.): no regressions
- `tsc --noEmit -p server/tsconfig.json`: same 3 pre-existing errors, no new errors
</verification>

<success_criteria>
- H3 fix: when any citizen agent's `currentStats.wealth + wealthDelta < 0`, the shortfall routes to treasury; net M0 unchanged.
- H2 fix: stale cross-iteration or typo'd-buyerId order-book orders void cleanly with no half-applied wealth mutation.
- H6 fix: `computeSystemFiatTotal` no longer double-counts bank-agent wealth alongside `depositBalances`.
- Live smoke test (executed in 11-GC5) shows |sfcDrift| ≤ 0.1 on every iteration of a US bootstrap.
</success_criteria>

<output>
After completion, create `.planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/11-GC1-SUMMARY.md` with:
- Commits list (expected: 1 test commit + 3 fix commits)
- Confirmation that all 3 hypotheses' regression tests are GREEN
- Confirmation of full-suite test count (expected 493/498 passing; 5 pre-existing failures unchanged)
- Any deviations from the plan pseudocode (e.g., orderBookClearing helper extracted or not)
- Hand-off note: ready for 11-GC5 verification plan to execute the live US smoke test
</output>
