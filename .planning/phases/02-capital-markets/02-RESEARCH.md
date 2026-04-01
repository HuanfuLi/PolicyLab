# Phase 2: Capital Markets — Research

**Researched:** 2026-04-01
**Domain:** Enterprise equity, dividend distribution, government bonds, corporate bonds, SFC-consistent capital instruments
**Confidence:** HIGH (architecture and patterns are well-defined by Phase 1 precedent and existing architecture research)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMKT-01 | Enterprise equity — share issuance at founding or capital raise, ownership table persisted | EnterpriseRecord in sessionEnterpriseRegistry maps enterpriseId → owner; new equity_positions table captures per-agent shareholdings; share issuance is a wealth transfer, not money creation |
| CMKT-02 | Dividend distribution — enterprise profits distributed pro-rata to shareholders | distributeProRata() already exists in simulationRunner.ts; dividend is enterprise retained_earnings → each shareholder.wealth (SFC-neutral transfer); runs end-of-iteration like banking tick |
| CMKT-03 | Government bonds — treasury issues debt with configurable coupon rate and maturity | treasury is already in SFC perimeter (sessionStateTreasury); bond purchase = agent.wealth → treasury (wealth shift, no new money); bond_holdings table persists positions |
| CMKT-04 | Bond coupon payments from treasury to holders each cycle; maturity redeems principal | coupon: treasury -= coupon_total, each holder.wealth += pro_rata; maturity: treasury -= faceValue, holder.wealth += faceValue, holding deleted; all SFC-neutral |
| CMKT-05 | Corporate bonds — enterprises issue debt; reuses government bond instrument schema | same bond_holdings table, issuerId = enterpriseId instead of 'treasury'; coupon/maturity logic identical, sourced from enterprise retained earnings instead of treasury |
| CMKT-06 | Bond/equity holder ledger persisted to DB for pause/resume and export | equity_positions + bond_holdings tables follow deposit_accounts/loan_contracts pattern; importexport.ts extended with same agent-ID-remapping pattern Phase 1 used |
</phase_requirements>

---

## Summary

Phase 2 adds enterprise equity and bond instruments to the deterministic simulation engine. The architecture is fully pre-planned in `.planning/research/ARCHITECTURE.md` and the SFC accounting rules for every instrument are documented in `.planning/research/FEATURES.md`. Phase 1 established the exact code patterns that Phase 2 must replicate: pure engine functions in `mechanics/`, CRUD repo in `db/repos/`, integration via `simulationRunner.ts`, and extension of `computeSystemFiatTotal` for the SFC audit.

The key insight from architecture research: **equity does not create money** — it transfers existing fiat between agents. Bonds are also SFC-neutral at purchase (wealth shifts from holder to issuer) but introduce an ongoing payment obligation (coupon per iteration) and a lump redemption at maturity. The phase must correctly track these obligations without breaking the SFC invariant.

Phase 2 introduces two new DB tables (`equity_positions`, `bond_holdings`), one new engine file (`capitalMarketEngine.ts`), one new repo (`capitalMarketRepo.ts`), 4 new ActionCodes (`BUY_SHARES`, `SELL_SHARES`, `BUY_BOND`, `ISSUE_GOV_BOND`), and extensions to `shared/src/types.ts`, `schema.ts`, `migrate.ts`, `physicsEngine.ts`, `simulationRunner.ts`, `actionCodes.ts`, `skillSystem.ts`, `prompts.ts`, and `importexport.ts`.

**Primary recommendation:** Follow the Banking Foundation pattern exactly — types first (Plan 01), engine + repo (Plan 02), simulation integration + export (Plan 03). The capital market tick runs immediately after the banking tick in `simulationRunner.ts`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | already installed | ORM for `equity_positions` and `bond_holdings` tables | Matches all existing DB tables |
| better-sqlite3 | already installed | Synchronous SQLite driver | Same sync pattern as bankingRepo |
| uuid (v4) | already installed | Primary key generation | Same pattern as bankingRepo, agentRepo |
| vitest | already installed | Unit tests for capitalMarketEngine | Same as banking.test.ts |

No new packages needed. All dependencies are already in `server/package.json`.

**No new npm installs required.**

---

## Architecture Patterns

### Recommended Phase Structure

```
Phase 2 spans 3 plans:
  Plan 01 — Types + Schema + Migration (CMKT-01, CMKT-06 partial)
  Plan 02 — capitalMarketEngine + capitalMarketRepo (CMKT-01..05 logic)
  Plan 03 — SimulationRunner integration + prompts + export (CMKT-06 full)
```

### File Map

```
server/src/
├── mechanics/
│   └── capitalMarketEngine.ts          # NEW: pure engine functions
├── db/
│   └── repos/
│       └── capitalMarketRepo.ts        # NEW: equity + bond CRUD
shared/src/
└── types.ts                            # EXTENDED: EquityPosition, BondHolding, EnterpriseEquity
server/src/db/
├── schema.ts                           # EXTENDED: equityPositions, bondHoldings tables
└── migrate.ts                          # EXTENDED: 2 new CREATE TABLE IF NOT EXISTS blocks
server/src/mechanics/
├── actionCodes.ts                      # EXTENDED: 4 new ActionCodes
└── physicsEngine.ts                    # EXTENDED: 4 new case blocks (wealthDelta=0, deferred)
server/src/orchestration/
└── simulationRunner.ts                 # EXTENDED: capital market tick after banking tick
server/src/llm/prompts.ts               # EXTENDED: equity/bond context, action schemas
server/src/routes/importexport.ts       # EXTENDED: 2 new table export/import with ID remapping
```

### Pattern 1: Capital Market Tick (mirrors Banking Tick)

The capital market tick runs **after** the banking tick, **before** the SFC audit, in the same location in `simulationRunner.ts`:

```typescript
// After banking tick (line ~2673 in current simulationRunner.ts):
let bondEscrowTotal = 0;

if (economyConfig.capitalMarketsEnabled) {
  const equityPositions = capitalMarketRepo.getEquityPositionsBySession(sessionId);
  const bondHoldings = capitalMarketRepo.getBondHoldingsBySession(sessionId);
  const enterprises = [...getEnterpriseRegistry(sessionId).values()];

  const cmktDelta = capitalMarketEngine.processIteration({
    sessionId,
    agents,
    equityPositions,
    bondHoldings,
    enterprises,
    treasury: sessionStateTreasury.get(sessionId) ?? 0,
    iterationNumber: iterNum,
    economyConfig,
  });

  sqlite.transaction(() => {
    for (const pos of cmktDelta.upsertEquityPositions) {
      capitalMarketRepo.upsertEquityPosition(pos);
    }
    for (const holding of cmktDelta.upsertBondHoldings) {
      capitalMarketRepo.upsertBondHolding(holding);
    }
    for (const id of cmktDelta.deleteBondHoldingIds) {
      capitalMarketRepo.deleteBondHolding(id);
    }
  })();

  // Apply wealth deltas in-memory before bulkUpdateStats
  for (const [agentId, delta] of cmktDelta.wealthDeltas) {
    const update = statUpdates.find(u => u.id === agentId);
    if (update) update.wealth += delta;
  }
  // Apply treasury delta
  sessionStateTreasury.set(
    sessionId,
    (sessionStateTreasury.get(sessionId) ?? 0) + cmktDelta.treasuryDelta,
  );

  bondEscrowTotal = capitalMarketRepo.getTotalBondFaceValue(sessionId);
}
```

Then extend `computeSystemFiatTotal` with `bondEscrow` parameter (defaults to 0 for backward compat):

```typescript
function computeSystemFiatTotal(
  agents, primaryAMM, multiAMMs, treasury,
  wealthOverrides?, depositBalances = 0, collateralEscrow = 0,
  bondEscrow = 0,   // NEW Phase 2
): number {
  ...
  return agentFiat + ammFiat + multiAMMFiat + treasury
    + depositBalances + collateralEscrow + bondEscrow;
}
```

**Why bond face value counts in the SFC audit:** When an agent buys a bond, their cash decreases and the issuer's cash increases — the agent's wealth is now split between cash and bond holdings. The bond face value must be counted in the total fiat perimeter or the SFC assertion will false-flag a violation. Bond holdings are the asset side; the cash received by the issuer is the liability side.

### Pattern 2: CapitalMarketDelta Return Type (mirrors BankingDelta)

```typescript
// capitalMarketEngine.ts
export interface CapitalMarketDelta {
  /** Equity positions to upsert (new + updated) */
  upsertEquityPositions: EquityPosition[];
  /** Bond holdings to upsert (new + coupon-updated) */
  upsertBondHoldings: BondHolding[];
  /** Matured or defaulted bond holding IDs to delete */
  deleteBondHoldingIds: string[];
  /** Wealth changes: agentId → Δwealth (dividends, coupons, share purchases) */
  wealthDeltas: Map<string, number>;
  /** Net treasury change (negative = coupon/maturity payments out, positive = bond proceeds in) */
  treasuryDelta: number;
  /** Net enterprise treasury change: enterpriseId → Δ (corporate bond proceeds in / coupon out) */
  enterpriseTreasuryDeltas: Map<string, number>;
  /** Physics trace log entries */
  trace: string[];
}
```

### Pattern 3: Action Resolution in Physics Engine (wealthDelta = 0)

Following the exact pattern established for banking actions — capital market actions are **deferred** to the engine tick, not resolved in `physicsEngine.ts`. Physics adds only a trace message:

```typescript
// physicsEngine.ts resolveAction switch
case 'BUY_SHARES':
  w = 0;
  h = 0; hap = 1; cor = 0; dop = 1;
  trace.push(`  [CMKT] ${agent.name} requested BUY_SHARES — deferred to capitalMarketEngine.processIteration()`);
  break;

case 'SELL_SHARES':
  w = 0;
  h = 0; hap = -1; cor = 1; dop = -1;
  trace.push(`  [CMKT] ${agent.name} requested SELL_SHARES — deferred to capitalMarketEngine.processIteration()`);
  break;

case 'BUY_BOND':
  w = 0;
  h = 0; hap = 1; cor = -1; dop = 1;
  trace.push(`  [CMKT] ${agent.name} requested BUY_BOND — deferred to capitalMarketEngine.processIteration()`);
  break;

case 'ISSUE_GOV_BOND':
  w = 0;
  h = 0; hap = 0; cor = -2; dop = 1;
  trace.push(`  [CMKT] Treasury/enterprise ISSUE_GOV_BOND — deferred to capitalMarketEngine.processIteration()`);
  break;
```

**Why wealthDelta = 0:** The physics engine touch order is: physics deltas computed → capital market tick runs → statUpdates merged. If physics also applied a wealth delta for BUY_SHARES, it would double-count with the engine tick. The deferred pattern is established Phase 1 precedent.

### Pattern 4: ActionCode + skillSystem Exhaustiveness (Phase 1 Lesson)

Phase 1 auto-fixed a blocking TypeScript error: `skillSystem.ACTION_SKILL_MAP` is typed as `Record<ActionCode, ...>`, so every new ActionCode **must** be added to `ACTION_SKILL_MAP` at the same time it's added to the `ActionCode` union. Plan 01 for Phase 2 must include this as an atomic step.

```typescript
// skillSystem.ts ACTION_SKILL_MAP additions required:
BUY_SHARES: { primary: 'trading', secondary: null },
SELL_SHARES: { primary: 'trading', secondary: null },
BUY_BOND: { primary: 'trading', secondary: null },
ISSUE_GOV_BOND: { primary: 'management', secondary: null },
```

### Pattern 5: Export/Import Agent ID Remapping

`importexport.ts` already handles deposit_accounts, loan_contracts, and bank_balance_sheets with agent ID remapping. Phase 2 adds equity_positions and bond_holdings using the same `agentIdMap` pattern:

```typescript
// During import: build agentIdMap (oldId → newId)
// Then for equity_positions:
for (const pos of exportData.equityPositions ?? []) {
  const newOwnerId = agentIdMap.get(pos.ownerAgentId) ?? pos.ownerAgentId;
  db.insert(equityPositions).values({ ...pos, id: uuidv4(), ownerAgentId: newOwnerId }).run();
}
// For bond_holdings:
for (const holding of exportData.bondHoldings ?? []) {
  const newOwnerId = agentIdMap.get(holding.ownerAgentId) ?? holding.ownerAgentId;
  db.insert(bondHoldings).values({ ...holding, id: uuidv4(), ownerAgentId: newOwnerId }).run();
}
```

Bond holdings where `issuerId === 'treasury'` need no remapping (treasury is a session constant). Corporate bond `issuerId` is an `enterpriseId` string (not an agent FK), so it also needs no remapping — enterprises are recreated from the agent FOUND_ENTERPRISE actions at session resume. This is a subtle point: verify this is consistent with how `EnterpriseRecord.id` is generated.

### Recommended EnterpriseRecord ID Pattern

From `simulationRunner.ts` (line ~628): enterprise ID is generated at `FOUND_ENTERPRISE` resolution. The ID must be stable across export/import. Currently enterprises live only in the in-memory `sessionEnterpriseRegistry` — they are not persisted to the DB. This is a **gap**: corporate bonds require `issuerId` = enterpriseId which must survive a session export. If the enterprise is not persisted, the corporate bond issuer is dangling after import.

**Resolution:** Corporate bonds (CMKT-05) should use `issuerId = agent.id` of the enterprise owner, not the ephemeral in-memory enterpriseId. This makes the issuerId a stable DB-persisted FK. The architecture research shows `issuerId: text — 'treasury' | enterpriseId` but given enterprises are in-memory, the safer choice is to use the owner agent's ID as the issuer reference for corporate bonds. This is a design decision the planner should lock in Plan 01.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pro-rata dividend distribution | Custom rounding loop | `distributeProRata()` already in `simulationRunner.ts` (line ~427) | Already handles integer rounding with zero-remainder guarantee; copying to capitalMarketEngine or re-importing it avoids re-implementing the same logic |
| Unique ID generation | Custom ID scheme | `v4 as uuidv4` from uuid package | Same as all other repos |
| DB sync writes | asyncLogFlusher | `sqlite.transaction()` directly | Capital markets tick runs once per iteration — same reasoning as banking tick (Phase 1 decision) |
| SFC validation | New audit function | Extend existing `computeSystemFiatTotal` with `bondEscrow` param | Add one parameter with default 0; all existing call sites unchanged |
| ActionCode validation | Runtime string checks | TypeScript union type enforcement at compile time | Pattern from Phase 1: exhaustiveness errors catch missing entries early |

---

## SFC Accounting — Capital Markets Rules

This is the most critical section for planning. Every transaction type must satisfy SFC.

### Equity Transactions

| Event | Agent Wealth | Enterprise Account | SFC Status |
|-------|-------------|-------------------|------------|
| Share purchase (IPO) | buyer.wealth -= price | enterprise treasury += price | Neutral — wealth transfers from buyer to enterprise |
| Dividend distribution | shareholder.wealth += pro_rata | enterprise retained_earnings -= total_dividend | Neutral — wealth transfers from enterprise to shareholders |
| Share sale (secondary) | seller.wealth += price, buyer.wealth -= price | unchanged | Neutral — peer-to-peer transfer |

**Key constraint:** Enterprises do not currently have a "retained_earnings" account in the DB — profit is tracked via the EnterpriseLedger's `totalRevenue - totalWages` per iteration, which is then distributed as wages or held as the owner's wealth gain. Phase 2 must decide where enterprise "profit available for dividends" lives:

**Recommended approach:** The `EnterpriseLedger.totalRevenue - totalWages` after wages are paid is the owner's income (already flows to `agent.wealth` of the enterprise owner). Dividends should come from the **owner agent's wealth** pro-rata to shareholders. If the owner wants to distribute dividends, the owner's wealth decreases and shareholders' wealth increases. This is SFC-trivial and requires no new enterprise bank account. It also means CMKT-02 "enterprise distributes dividends" is operationally "enterprise owner distributes from their wealth." The planner should lock this interpretation.

### Bond Transactions

| Event | Holder Wealth | Issuer Cash | Bond Escrow | SFC Status |
|-------|--------------|-------------|-------------|------------|
| Bond purchase | holder.wealth -= faceValue | issuer += faceValue | bondHolding.faceValue added to SFC perimeter | Neutral — wealth redistributes; bond asset replaces cash asset in SFC tally |
| Coupon payment | holder.wealth += coupon | issuer -= coupon | unchanged | Neutral — transfer only |
| Maturity redemption | holder.wealth += faceValue | issuer -= faceValue | bondHolding removed from perimeter | Neutral — bond asset converts back to cash |

**SFC audit extension:** After Phase 2, `computeSystemFiatTotal` gains `bondEscrow = capitalMarketRepo.getTotalBondFaceValue(sessionId)`. This replaces the agent's "missing" wealth that was converted to bond holdings.

**Government bond special case:** `issuerId = 'treasury'` means coupon/maturity payments come from `sessionStateTreasury`. The treasury balance is already in the SFC perimeter. So: treasury decreases, agent wealth increases — SFC stays balanced.

---

## Common Pitfalls

### Pitfall 1: Double-Counting Bond Face Value in SFC

**What goes wrong:** Adding both the bond holder's full wealth (including the cash they spent to buy the bond) AND the bond face value to the SFC total. This would inflate the total above M0.

**Why it happens:** When agent buys a bond, their `agent.wealth` already decreased by `faceValue`. The bond holding is a new asset class. If SFC counts `agent.wealth + bond_face_value`, it effectively counts the bond twice (once as "missing" from agent.wealth, once as bondEscrow).

**How to avoid:** `computeSystemFiatTotal` counts `agent.wealth` (already reflects that cash was spent) PLUS `bondEscrow` (the face value now held as bonds). The bond purchase is: `agent.wealth -= faceValue` and `treasury += faceValue` and `bondHolding created with faceValue`. SFC sum = ... + agent.wealth + ... + treasury + bondEscrow = ... + (wealth - faceValue) + ... + (treasury + faceValue) + faceValue. That's one faceValue too many. The correct approach: bondEscrow is NOT added separately — instead it's already accounted for on the issuer side (treasury received the cash). Carefully re-read ARCHITECTURE.md Phase B SFC note: "Equity does not create money — it transfers existing fiat." Bond purchase is similar: wealth shifts from holder → issuer. The issuer's cash goes up; the holder's cash goes down. No bond_escrow term is needed in the SFC audit IF the issuer's balance is already in the perimeter.

**Resolution:** Do NOT add `bondEscrow` as a separate term. Verify the total by tracing a purchase: before bond: sum = (holder.wealth=100) + (treasury=50) = 150. After bond faceValue=30: sum = (holder.wealth=70) + (treasury=80) = 150. SFC holds without any escrow term. The "escrow" concept from ARCHITECTURE.md is only relevant if you model bonds as a separate escrow account distinct from the issuer — which this codebase does not. The bond face value lives as `issuer cash` (treasury balance or enterprise owner wealth), not in a separate escrow.

**Warning signs:** SFC audit throws after a bond purchase with "total mismatch = faceValue". That means bondEscrow was added when it shouldn't have been.

### Pitfall 2: Dividend Source Not Tracked

**What goes wrong:** `capitalMarketEngine.distributeDividends()` reads "enterprise profit" but there is no `enterprise.retainedEarnings` field in any DB table or in-memory registry.

**Why it happens:** Enterprise profit is computed per-iteration in `EnterpriseLedger` and flows into the owner's `agent.wealth`. After the iteration completes, there is no record of "this iteration's profit."

**How to avoid:** Pass the per-iteration enterprise revenue figure into `processIteration()` from the enterprise ledger, or use a fixed `dividendPayoutRatio * owner.wealthDelta_this_iteration` approximation. Alternatively, the simplest approach: dividends are only issued when the enterprise owner explicitly INVEST-actions into the enterprise, and the amount comes from their own wealth. Lock the approach in Plan 01 before writing any engine code.

### Pitfall 3: Matured Bonds Not Deleted

**What goes wrong:** Bond holdings with `status = 'matured'` accumulate in the `bond_holdings` table. The SFC audit double-counts if the matured holding's face value is still being counted.

**How to avoid:** On maturity: (1) pay the principal, (2) mark status = 'matured', (3) in the same transaction, delete the record OR ensure the SFC count only includes `status = 'active'` holdings. The safest approach: delete on maturity rather than marking — consistent with `status = 'active' | 'matured' | 'defaulted'` but avoids any risk of stale records accumulating. `capitalMarketRepo.getTotalBondFaceValue` must filter `WHERE status = 'active'`.

### Pitfall 4: BUY_SHARES/BUY_BOND Action Not in Agent's Action Queue Intent

**What goes wrong:** The agent emits `BUY_SHARES` in their Multi-Action Queue, the physicsEngine processes it with wealthDelta=0 (deferred), but the `capitalMarketEngine` has no way to know which agent made which share purchase request and at what quantity/price.

**Why it happens:** The deferred pattern works for banking because the banking engine runs autonomously (interest, defaults) without needing the agent's specific intent. Share purchases and bond buys are *agent-initiated* — the engine needs to know the agent's intent to process them.

**How to avoid:** During the resolution phase, when `actionCode === 'BUY_SHARES'` or `'BUY_BOND'`, store the intent in a per-session pending queue (similar to how ISSUE_LOAN requests are queued). Then `capitalMarketEngine.processIteration()` receives this queue and executes them. Alternatively, capture the intent in `weekState.events[]` and parse it in the runner. **Recommended:** Add a `capitalMarketRequests` array to `AgentWeekState` (analogous to how `workedEnterpriseId` and `quitEnterpriseId` are tracked) that accumulates the capital market action intents during the resolution phase.

### Pitfall 5: skillSystem ACTION_SKILL_MAP Exhaustiveness Error

**What goes wrong:** TypeScript build fails with "Property 'BUY_SHARES' is missing in type 'Record<ActionCode, ...>'" because `skillSystem.ts` uses a `Record<ActionCode, SkillEntry>` exhaustive map.

**Why it happens:** Confirmed from Phase 1 Plan 03 "Auto-fixed Issues" — this exact error occurred when banking actions were added.

**How to avoid:** In Plan 01 (types + schema step), add all 4 new ActionCodes to BOTH `actionCodes.ts` AND `skillSystem.ts` in the same commit. Include this in the plan's explicit task list.

### Pitfall 6: Corporate Bond Issuer ID Is Ephemeral

**What goes wrong:** Enterprise IDs are generated at `FOUND_ENTERPRISE` resolution and stored only in the in-memory `sessionEnterpriseRegistry`. If a session is paused/resumed or exported/imported, the enterprise registry is rebuilt from events — but a corporate bond's `issuerId` pointing to an in-memory enterprise ID will be a dangling reference after rebuild.

**How to avoid:** For corporate bonds, use the enterprise owner's **agent ID** as the `issuerId`. Agent IDs are DB-persisted and survive all lifecycle events. Document this in the shared type: `issuerId: string // 'treasury' | agentId of enterprise owner`.

---

## Code Examples

### Enterprise Equity Share Issuance (SFC-safe)

```typescript
// capitalMarketEngine.ts — processSharePurchase
export function processSharePurchase(params: {
  buyer: Agent;
  enterpriseOwnerId: string;  // agent.id of the enterprise owner
  sharesRequested: number;
  pricePerShare: number;
  existingPosition?: EquityPosition;
  sessionId: string;
  iterationNumber: number;
}): { position: EquityPosition; wealthDeltas: Map<string, number>; trace: string[] } | { rejected: true; reason: string } {
  const { buyer, enterpriseOwnerId, sharesRequested, pricePerShare } = params;
  const totalCost = sharesRequested * pricePerShare;

  if (buyer.currentStats.wealth < totalCost) {
    return { rejected: true, reason: `Insufficient wealth: ${buyer.currentStats.wealth} < ${totalCost}` };
  }

  const wealthDeltas = new Map<string, number>();
  wealthDeltas.set(buyer.id, -totalCost);
  wealthDeltas.set(enterpriseOwnerId, +totalCost);
  // SFC: buyer loses totalCost, enterprise owner gains totalCost — net zero

  const newSharesHeld = (params.existingPosition?.sharesHeld ?? 0) + sharesRequested;
  const prevCostBasis = (params.existingPosition?.averageCostBasis ?? 0) * (params.existingPosition?.sharesHeld ?? 0);
  const newCostBasis = (prevCostBasis + totalCost) / newSharesHeld;

  const position: EquityPosition = {
    id: params.existingPosition?.id ?? uuidv4(),
    sessionId: params.sessionId,
    ownerAgentId: buyer.id,
    enterpriseOwnerId,
    sharesHeld: newSharesHeld,
    averageCostBasis: newCostBasis,
    lastUpdated: params.iterationNumber,
  };

  return { position, wealthDeltas, trace: [`[CMKT] ${buyer.name} bought ${sharesRequested} shares at ${pricePerShare} each (total=${totalCost})`] };
}
```

### Dividend Distribution (using distributeProRata)

```typescript
// capitalMarketEngine.ts — distributeDividends
export function distributeDividends(params: {
  enterpriseOwnerId: string;
  ownerWealth: number;
  dividendPayoutRatio: number;   // e.g. 0.1 = 10% of owner wealth per iteration
  positions: EquityPosition[];   // all positions for this enterprise
  iterationNumber: number;
}): { wealthDeltas: Map<string, number>; trace: string[] } {
  const { enterpriseOwnerId, ownerWealth, dividendPayoutRatio, positions } = params;

  if (positions.length === 0) return { wealthDeltas: new Map(), trace: [] };

  const totalShares = positions.reduce((s, p) => s + p.sharesHeld, 0);
  if (totalShares === 0) return { wealthDeltas: new Map(), trace: [] };

  const totalDividend = Math.floor(ownerWealth * dividendPayoutRatio);
  if (totalDividend === 0) return { wealthDeltas: new Map(), trace: [] };

  const ratios = positions.map(p => p.sharesHeld / totalShares);
  const shares = distributeProRata(totalDividend, ratios);
  // distributeProRata is already in simulationRunner — copy or extract to shared utility

  const wealthDeltas = new Map<string, number>();
  wealthDeltas.set(enterpriseOwnerId, -totalDividend);
  for (let i = 0; i < positions.length; i++) {
    wealthDeltas.set(positions[i].ownerAgentId, shares[i]);
  }
  // SFC: owner loses totalDividend, shareholders gain totalDividend — net zero

  return {
    wealthDeltas,
    trace: [`[CMKT] Enterprise owner ${enterpriseOwnerId} distributed ${totalDividend} in dividends across ${positions.length} shareholders`],
  };
}
```

### Bond Issuance (Government)

```typescript
// capitalMarketEngine.ts — processGovBondPurchase
export function processGovBondPurchase(params: {
  buyer: Agent;
  faceValue: number;
  couponRate: number;      // per-iteration rate, e.g. 0.01
  maturityIteration: number;
  currentIteration: number;
  sessionId: string;
}): { holding: BondHolding; wealthDeltas: Map<string, number>; treasuryDelta: number; trace: string[] } | { rejected: true; reason: string } {
  const { buyer, faceValue, couponRate, maturityIteration, currentIteration } = params;

  if (buyer.currentStats.wealth < faceValue) {
    return { rejected: true, reason: `Insufficient wealth to purchase bond: ${buyer.currentStats.wealth} < ${faceValue}` };
  }

  const holding: BondHolding = {
    id: uuidv4(),
    sessionId: params.sessionId,
    ownerAgentId: buyer.id,
    issuerId: 'treasury',
    bondType: 'government',
    faceValue,
    couponRate,
    maturityIteration,
    purchaseIteration: currentIteration,
    status: 'active',
  };

  const wealthDeltas = new Map([[buyer.id, -faceValue]]);
  const treasuryDelta = +faceValue;
  // SFC: buyer.wealth -= faceValue; treasury += faceValue — net zero

  return {
    holding, wealthDeltas, treasuryDelta,
    trace: [`[CMKT] ${buyer.name} purchased gov bond faceValue=${faceValue} coupon=${couponRate} matures@iter${maturityIteration}`],
  };
}
```

---

## New Shared Types Required

```typescript
// shared/src/types.ts additions

export interface EquityPosition {
  id: string;
  sessionId: string;
  ownerAgentId: string;
  /** agent.id of the enterprise owner (not an in-memory enterpriseId) */
  enterpriseOwnerId: string;
  sharesHeld: number;
  averageCostBasis: number;
  lastUpdated: number;  // iteration number
}

export interface BondHolding {
  id: string;
  sessionId: string;
  ownerAgentId: string;
  /** 'treasury' for government bonds; agent.id of enterprise owner for corporate bonds */
  issuerId: string;
  bondType: 'government' | 'corporate';
  faceValue: number;
  couponRate: number;       // per-iteration rate
  maturityIteration: number;
  purchaseIteration: number;
  status: 'active' | 'matured' | 'defaulted';
}

// EconomyConfig additions (capitalMarketsEnabled already exists as optional flag)
// Add these new fields:
export interface EconomyConfig {
  // ... existing fields ...
  // capitalMarketsEnabled?: boolean; // already present
  dividendPayoutRatio?: number;    // fraction of enterprise owner wealth distributed per iteration, e.g. 0.05
  govBondCouponRate?: number;      // per-iteration coupon rate for gov bonds, e.g. 0.008
  govBondTermIterations?: number;  // default bond maturity term, e.g. 10
}

// SessionExport additions
export interface SessionExport {
  // ... existing fields ...
  equityPositions?: EquityPosition[];
  bondHoldings?: BondHolding[];
}
```

---

## New DB Schema Tables

```typescript
// schema.ts additions

export const equityPositions = sqliteTable('equity_positions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  ownerAgentId: text('owner_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  enterpriseOwnerId: text('enterprise_owner_id').notNull(),  // agent.id of enterprise owner
  sharesHeld: integer('shares_held').notNull().default(0),
  averageCostBasis: real('average_cost_basis').notNull().default(0),
  lastUpdated: integer('last_updated').notNull().default(0),
});

export const bondHoldings = sqliteTable('bond_holdings', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  ownerAgentId: text('owner_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  issuerId: text('issuer_id').notNull(),  // 'treasury' | agentId of enterprise owner
  bondType: text('bond_type').notNull(),  // 'government' | 'corporate'
  faceValue: real('face_value').notNull(),
  couponRate: real('coupon_rate').notNull(),
  maturityIteration: integer('maturity_iteration').notNull(),
  purchaseIteration: integer('purchase_iteration').notNull(),
  status: text('status').notNull().default('active'),
});
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Equity not tracked (Phase 1) | equity_positions table, BUY_SHARES/SELL_SHARES actions | Agents gain shareholder role; enterprises become capital-raising entities |
| Bonds not in SFC perimeter | bond_holdings tracked; coupon/maturity flows through treasury | Fiscal deficit spending enabled; government can issue debt without immediate tax increase |
| Enterprise profit flows entirely to owner | dividendPayoutRatio distributes fraction pro-rata to shareholders | Wealth inequality dynamics change — shareholders of profitable enterprises accumulate; pure workers do not |

---

## Open Questions

1. **Where does enterprise profit live for dividends?**
   - What we know: EnterpriseLedger tracks per-iteration revenue and wages. After wages are paid, net flows to the enterprise owner's wealth.
   - What's unclear: Should dividends come from owner.wealth directly (easy, SFC-trivial) or should there be an enterprise retained_earnings account in the DB (more realistic but adds schema complexity)?
   - Recommendation: Use owner.wealth directly for v1.0. `dividendPayoutRatio * owner.wealthGainThisIteration`. Lock this in Plan 01.

2. **How does an agent decide HOW MANY shares to request or at what price?**
   - What we know: The LLM emits `BUY_SHARES` as an ActionCode. The physicsEngine currently passes `actionTarget` (a string target ID).
   - What's unclear: How does the engine know quantity and price? The intent prompt must specify these or the engine must use defaults.
   - Recommendation: Use a fixed default (e.g., buy 1 share at the last-known price from the enterprise owner's wealth as implicit valuation). Add share quantity/price to the `actionTarget` field as a JSON string, consistent with how other parameterized actions work. This avoids a new prompt schema.

3. **Share price discovery — how is a share valued?**
   - What we know: There is no exchange or order book for shares in scope. Secondary trading is out of scope at this scale.
   - What's unclear: What price does BUY_SHARES use?
   - Recommendation: Price per share = `enterpriseOwner.wealth / totalSharesOutstanding`. This makes price endogenous. For IPO (first issuance at founding), price = fixed constant from physicsConfig (e.g., 10 fiat per share). Lock this formula in Plan 01.

4. **processIteration ordering: dividends before or after banking tick?**
   - What we know: Banking tick runs at line ~2613 in simulationRunner. Capital market tick follows.
   - Recommendation: Capital market tick runs AFTER banking tick. Dividends and coupons use settled agent wealth from banking.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 has no external dependencies. All libraries (drizzle-orm, better-sqlite3, uuid, vitest) are already installed. No new packages required.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (already installed) |
| Config file | `server/vitest.config.ts` |
| Quick run command | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` |
| Full suite command | `npm run test -w server` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CMKT-01 | Share purchase transfers wealth buyer → seller, equity position recorded | unit | `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts` | ❌ Wave 0 |
| CMKT-02 | Dividend distribution is pro-rata, sum(dividends) = total_distributed, SFC neutral | unit | same | ❌ Wave 0 |
| CMKT-03 | Gov bond purchase decreases buyer.wealth, increases treasury, holding created | unit | same | ❌ Wave 0 |
| CMKT-04 | Coupon payment: treasury decreases, holder increases; maturity: holding deleted | unit | same | ❌ Wave 0 |
| CMKT-05 | Corporate bond: identical coupon/maturity logic, issuerId = enterpriseOwner agentId | unit | same | ❌ Wave 0 |
| CMKT-06 | Export includes equityPositions + bondHoldings; import recreates with remapped IDs | integration | `npx vitest run server/src/__tests__/sfcCapitalMarkets.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run server/src/mechanics/__tests__/capitalMarket.test.ts`
- **Per wave merge:** `npm run test -w server`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `server/src/mechanics/__tests__/capitalMarket.test.ts` — covers CMKT-01 through CMKT-05 (pure engine unit tests)
- [ ] `server/src/__tests__/sfcCapitalMarkets.test.ts` — covers CMKT-06 (integration: export/import, SFC audit with bonds)

---

## Project Constraints (from CLAUDE.md)

Directives the planner must verify compliance with:

| Constraint | Source | Implication for Phase 2 |
|------------|--------|------------------------|
| Shared types in `shared/src/types.ts`, import as `@policylab/shared` | CLAUDE.md | `EquityPosition`, `BondHolding` go in shared/src/types.ts; never in server-only files |
| All LLM prompts in `prompts.ts` only | CLAUDE.md | Capital market action schemas and equity/bond context injected in prompts.ts, not in simulationRunner |
| New action types registered in `actionCodes.ts` before referenced in physics engine | CLAUDE.md | Plan 01 must include actionCodes.ts + skillSystem.ts additions; Plan 03 adds physicsEngine cases |
| SFC audit assertion after any wealth/fiat change | CLAUDE.md | computeSystemFiatTotal called after capital market tick; no escrow term needed (see Pitfall 1) |
| Route high-frequency writes through asyncLogFlusher | CLAUDE.md | Capital markets tick runs once per iteration — use sqlite.transaction() directly (same as banking tick) |
| Database at `~/.policylab/policylab.db` | CLAUDE.md | migrate.ts CREATE TABLE IF NOT EXISTS blocks; no hardcoded paths |

---

## Sources

### Primary (HIGH confidence)
- Codebase direct analysis — `simulationRunner.ts`, `bankingEngine.ts`, `bankingRepo.ts`, `schema.ts`, `actionCodes.ts`, `physicsEngine.ts`, `skillSystem.ts`, `importexport.ts`, `shared/src/types.ts` — definitive ground truth for patterns
- `.planning/research/ARCHITECTURE.md` — pre-researched Phase B (Capital Markets) architecture, data flow, table definitions
- `.planning/research/FEATURES.md` — SFC accounting constraints per instrument; feature dependency graph
- Phase 1 summaries (01-01, 01-02, 01-03) — exact patterns Phase 2 must replicate; documented pitfalls and decisions

### Secondary (MEDIUM confidence)
- Godley-Lavoie Monetary Economics SFC Models — accounting framework for bond/equity instruments
- ABBA (IMF WP/17/136) — agent-based banking model with capital markets precedent

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all patterns from Phase 1 codebase analysis
- Architecture: HIGH — ARCHITECTURE.md pre-researched; Phase 1 established exact template
- SFC accounting: HIGH — traced every instrument transaction type against existing computeSystemFiatTotal
- Pitfalls: HIGH — three from direct codebase analysis (enterprise registry ephemeral, double-count risk, skillSystem exhaustiveness); two from Phase 1 lessons learned
- Open questions: MEDIUM — design choices, not unknowns; all have recommended resolutions

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable codebase; no fast-moving external dependencies)
