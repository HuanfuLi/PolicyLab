---
kind: forensics
phase: 11
finding: G1
subsystem_suspect: physicsActions (most likely), with fiscal escrow persistence as a secondary suspect
status: narrowed-not-decisive
date: 2026-04-13
observed_leak: -2655.17 fiat @ iter 1 (session c8672eee-ab3a-4759-856e-f1d6477381d6; baseline 119638.36 → actual 116983.19)
log_gap: user pasted only the 🚨 total-drift line; the structured `[SFC] iter=1` per-subsystem breakdown (emitted at simulationRunner.ts:2949) was not captured
---

# Phase 11 — G1 Physics SFC Leak Forensics

Read-only attribution pass. Production code was not modified.

## TL;DR

- **Leak magnitude:** −2655.17 fiat (≈ 2.2 % of system fiat) on iter 1.
- **Most likely bucket (without `sfcDriftBySubsystem` breakdown):** `physicsActions` — the huge pre-banking block at `simulationRunner.ts:1197–2208` bundles trade + enforcement + wage settlement + demurrage + seized-wealth redistribution and contains the highest density of per-action fiat mutations guarded by hand-written arithmetic.
- **Highest-probability single root cause:** a hot-path combination bug involving (a) the `clampWealth` floor at 0 on any agent whose running balance goes negative after all three queued actions, compounded by (b) the order-book sell path at `simulationRunner.ts:1478–1541` which credits the seller whenever a trade matches even if the **buyer has no `weekStateMap` entry and isn't `SYSTEM_NPC`** (line 1482 is an `if`, not an `else if`-terminating branch; a missing-buyer ghost trade would credit the seller unilaterally, inflating agent wealth which then gets clamped back down at commit).
- **Secondary suspect:** `fiscal` — the escrow persistence at 2583–2594 races with the inflation persistence at 2648–2658. Both rebuild `session.config.economyConfig` via spread and `await sessionRepo.updateConfig`; **the in-memory escrow map is authoritative either way**, so this is unlikely to be the arithmetic source of the leak, but it is an adjacent structural smell.
- **Cannot decisively attribute without the `[SFC] iter=1` structured lines.** The attribution helper (`reportDriftIfOverThreshold`) emits per-subsystem deltas to stderr on the same iteration that emits the 🚨 line — they were not included in the paste.

---

## 1. Subsystem attribution

### 1.1 What the instrumentation guarantees (and what it can't)

The 6-bucket accumulator (`sfcSubsystemAccounting.ts:13–21`) covers only the **4 wrapped ticks**: `physicsActions` (pair-snapshot at `simulationRunner.ts:1197` / `:2208`), `banking` (closure at `:2339`), `capmkt` (closure at `:2402`), `fiscal` (async closure at `:2538`). `trade` and `enforcement` are intentionally `0` this phase (11-07-SUMMARY.md §Decisions Made).

That means any fiat mutation that happens **outside all four brackets but inside the iteration body** would (a) show up in `iterTelemetry.sfcDrift` at `:2946`, but (b) **not** accumulate into any `sfcDriftBySubsystem.*` bucket — it would be an "invisible" leak the reporter cannot localize.

### 1.2 Inventory of between-bracket gaps (iteration body 540→3075)

| Line range | What runs | Can it mutate fiat? |
|---|---|---|
| 540–1196 | Intent + cognitive + resolution LLM setup, structural registries | No |
| 1197 | `physicsBefore = snapshotTotal()` | snapshot only |
| 1197–2208 | **physicsActions bracket** (trade + enforcement + wage + demurrage + seized-wealth) | Yes — tracked |
| 2209–2326 | cmkt intent collection (read-only scans of `intents`) | No |
| 2327–2390 | banking tick wrapper | Yes — tracked |
| 2391–2520 | capmkt tick wrapper | Yes — tracked |
| 2522–2633 | fiscal tick async wrapper | Yes — tracked |
| 2635–2731 | inflation tick (`applyInflationFeedback` rescales AMM *goods* reserves via `withdrawGoodsReserve` / `injectGoodsReserve`, `helpers/inflationUtils.ts:31–42`) | No fiat mutation — verified |
| 2733–2763 | structural pressures (touches `cortisol` / `happiness` only, `structuralPressures.ts:151–162`) | No fiat mutation — verified |
| 2765–2839 | cognitive post + employment metrics | No |
| 2842–2967 | telemetry build + per-iteration reporter | Read-only for fiat |
| 2970–2989 | `bulkUpdateStats` persistence | Integer floor on wealth (`agentRepo.ts:146` `Math.max(0, u.wealth)` — **no rounding**) |
| 3038 | `agents = listBySession(scope)` reload | No |
| 3049–3075 | SFC audit line | Read-only |

**Conclusion for section 1:** every fiat-touching block is inside a tracked bracket. If the `[SFC] iter=1` line were pasted, it would decisively attribute the leak. Without it, the attribution must be made by inspecting the densest mutation surface — which is overwhelmingly `physicsActions`.

### 1.3 Why `physicsActions` is the leading suspect

`physicsActions` bundles **all** of:

- Per-action physics resolution loop (`:1237–1476`) — up to `3 × N_agents` invocations
- Order-book clearing + VAT/amm_sell withholding (`:1477–1542`)
- Enterprise wage settlement (solvent + bankrupt) (`:1548–1680`)
- ADJUST_TAX / EMBEZZLE handlers (`:1693–1790` approx)
- Famine-reserve AMM executeSell (`:1800–1819`)
- Inventory depreciation (`:1821+`)
- Metabolism + allostatic (`:1863–1894`)
- Demurrage UBI (`:1896–1927`)
- Statupdate commit loop (`:1982–2061`) — the ONLY site that pushes to `statUpdates`
- Death-seizure + humiliation stripping → `seizedWealthPool`
- Phase Sheriff C redistribution (`:962–1008` approx of that block, bounded before `:2208`)

That's 6+ independent fiat-accounting concerns in one bracket. Each is hand-matched (agent −X, counterparty +X). Any single missed mirror leaks into the `physicsActions` bucket.

---

## 2. Ranked root-cause hypotheses (with file:line evidence)

### H1 — Order-book "ghost buyer" credits seller without a debit *(highest likelihood of a −2655 leak)*

**Location:** `server/src/orchestration/simulationRunner.ts:1478–1541`

```ts
const buyerState = weekStateMap.get(trade.buyerId);   // line 1479
const sellerState = weekStateMap.get(trade.sellerId); // line 1480
const basePrice = trade.executionPrice * trade.quantity;
if (buyerState) {                                     // line 1482 — PATH A (real buyer)
  ...buyerState.wealthDelta -= (basePrice + vat);
  ...treasury += vat;
} else if (trade.buyerId === 'SYSTEM_NPC') {          // line 1499 — PATH B (SYSTEM_NPC)
  ...treasury -= fundedCost; sellerState.wealthDelta += (fundedCost - sellTax); ...treasury += sellTax;
  continue;                                           // line 1522 — skips path C
}
if (sellerState) {                                    // line 1524 — PATH C (runs in cases A + fall-through)
  ...sellerState.wealthDelta += (basePrice - sellTax);
  ...treasury += sellTax;
}
```

**Failure mode:** if `buyerId` is neither a living citizen (no `weekStateMap` entry) nor `SYSTEM_NPC`, **path A is skipped**, path B is skipped, **but path C still fires** and credits the seller `basePrice − sellTax` + credits treasury `sellTax`. Nobody debits the buyer. Net fiat created = `basePrice`. Over many order-book matches this accumulates.

**How could `buyerId` be in the order book but not in `weekStateMap`?** `weekStateMap` is built at `:1147` from `aliveAgents` only. An order-book order persisted from a prior iteration whose placer died in a previous iteration would match here if it was never cleaned up. The cleanup is done per-agent on death at `:2024` `orderBook.removeAgentOrders(agent.id)` — which runs inside the current statUpdate loop at `:1982+`. Orders placed BEFORE iter 1 by agents who were never alive to begin with, OR orders with non-canonical `buyerId` strings (e.g. name typos from an LLM-emitted POST_BUY_ORDER target), would survive.

**Why this matches the observed −2655 sign convention:** wait — this hypothesis produces a **positive** leak (seller credited without buyer debit → total fiat rises). The observed leak is **negative**. So H1 alone does not explain −2655, but a mirror of this bug (see H2) would.

### H2 — Order-book "ghost seller" debits buyer without seller credit *(mirror of H1; produces the negative-sign leak observed)*

**Location:** Same block as H1. Look at path A carefully: `buyerState.wealthDelta -= (basePrice + vat)` runs whenever the buyer is alive, **regardless of whether `sellerState` exists**. If `sellerId` is not in `weekStateMap` (dead placer, stale order, typo'd LLM target), the buyer is still debited `basePrice + vat` and treasury gets `vat`. Path C's `if (sellerState)` guard fires false → no seller credit. Net fiat destroyed = `basePrice` (the buyer-side outflow is never matched by a seller-side inflow).

**Quantitative fit:** on a US bootstrap with ~20–50 agents, order-book matches involve basePrice per match typically ~2–5 × quantity × executionPrice. A handful of matches with `basePrice ≈ 500–1000` and no seller in `weekStateMap` is enough to produce −2655.

**Why existing unit tests miss this:** every `sfcTaxation` / `sfcPhase11` test I reviewed builds a closed `weekStateMap` containing every agent it trades with. No test submits an order on behalf of a non-`aliveAgent` ID. The scenario is only reachable through the LLM intent path or through cross-iteration order persistence.

### H3 — `clampWealth(newWealth)` floor at 0 destroys fiat when running wealth goes negative

**Location:** `server/src/orchestration/helpers/weekState.ts:55` + caller at `simulationRunner.ts:1987`

```ts
let newWealth = clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta));
```

`clampWealth` floors at 0 (`weekState.ts:56`). `weekState.wealthDelta` is the accumulator of **all** fiat deltas applied to an agent in this iteration: per-action physics, HELP, STEAL, BUY (VAT + base), INVEST cost, wage receipt, metabolism auto-buy, demurrage tax.

If an agent ends iter 1 with `currentStats.wealth + wealthDelta < 0`, `newWealth = 0`. But the **counterparties that received the transfers** (seller, AMM, treasury) were credited their full amount. **Net fiat destroyed = |currentStats.wealth + wealthDelta|.**

**Quantitative fit:** iter 1 is where agents first face MET metabolism + VAT + enterprise wages with no prior savings buffer. A US bootstrap with Gini-distributed wealth means the bottom-quintile agents have ~50–200 initial fiat. A single 2-action queue (WORK + BUY food via AMM at a high spot price) can drive running wealth past 0. With 20–50 agents, aggregate destroyed ~2000–5000 fiat is plausible.

**Why this is the most likely explanation:** the sign is **negative** (fiat destroyed). The magnitude (−2655) is consistent with "a handful of agents were overdrawn and clamped". This bug pattern is pre-Phase-11 — Phase 11's new taxation hooks (VAT + amm_sell + wage withholding) **increase** the probability of running-wealth underflow because they add new outflow sites without new buffer sites.

**Why existing unit tests miss this:** the `sfcPhase11` integration tests are single-iteration, scripted deltas. They don't run the full MET metabolism + auto-buy + VAT pipeline over agents with Gini-distributed initial wealth.

**Grep verification:**

```
$ grep -n "clampWealth" server/src/orchestration/helpers/weekState.ts
55:export function clampWealth(value: number): number {
56:  return Math.max(0, value);

$ grep -n "clampWealth" server/src/orchestration/simulationRunner.ts
1422:          runningWealth = clampWealth(runningWealth + physics.wealthDelta);
1706:          wealth: clampWealth(agent.currentStats.wealth + (weekStateMap.get(agent.id)?.wealthDelta ?? 0)),
1987:        let newWealth = clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta));
```

Three clamp sites, all in the `physicsActions` bracket. `:1987` is the commit-time clamp; the leak manifests there.

### H4 — Enterprise wage bankruptcy Math.floor truncation

**Location:** `simulationRunner.ts:1620–1631`

```ts
for (const employment of workers) {
  const payment = Math.floor(employment.wage * payRatio);   // 1623 — truncates fraction
  workerPayments.push({ employment, payment });
  totalPaid += payment;
}
let remainder = Math.floor(liquidatable) - totalPaid;       // 1628 — Math.floor on liquidatable
for (let i = 0; i < workerPayments.length && remainder > 0; i++) {
  workerPayments[i].payment++; remainder--;
}
```

`liquidatable` is `Math.max(0, ownerAvailableWealth)` (line 1615) — a float. The truncation at `:1628` is `Math.floor(liquidatable) − totalPaid`. The sub-unit remainder of `liquidatable` (e.g. 0.7 fiat) is then **neither paid to workers nor returned to the owner** — it stays in `ownerState.wealthDelta` because `ownerState.wealthDelta -= partialPay` debits only the integer `partialPay` (`:1640`). Actually rechecking — owner keeps the remainder, so **no leak**. H4 is not a leak source.

### H5 — Escrow persistence race (secondary suspect, not a leak cause)

**Location:** `simulationRunner.ts:2583–2594` (fiscal writes `publicGoodsEscrow`) then `:2648–2658` (inflation writes `cpiBasePrices`)

Both rebuild `session.config.economyConfig` by spread and await `sessionRepo.updateConfig`. If they race, one can overwrite the other's changes. However, **the in-memory `sessionPublicGoodsEscrow` map is authoritative for all downstream `getTotalEscrow(sessionId)` reads within the same run**. Persistence only affects pause/resume. **Not a mid-iteration leak source** — but it is a latent pause/resume hazard for Phase 12.

### H6 — Bank agent `currentStats.wealth` double-counted against `bankingTotalDeposits`

**Location:** `helpers/sfcAudit.ts:25–27`

```ts
const agentFiat = agents
  .filter(agent => agent.isAlive)
  .reduce((sum, agent) => sum + (wealthOverrides?.get(agent.id) ?? agent.currentStats.wealth), 0);
```

The **JSDoc at `:7`** claims *"Bank agents are excluded from the agent fiat sum (their reserves are modeled via depositBalances to prevent SFC double-counting per CLAUDE.md)"* but the **code does NOT filter `type === 'bank'`**. Verified via `git show 43dd413` (refactor commit) — the extracted function matches its pre-refactor inline origin; no bank filter ever existed in `computeSystemFiatTotal`.

**Effect:** bank agent wealth is counted BOTH in `agentFiat` (as bank reserves) AND `depositBalances` (as depositor claims). **This inflates the baseline.** However, if the bank's `currentStats.wealth` is **constant** across iter 1 (no banking tick effects on bank wealth, which only happens if there are zero loans with interest accruing), the over-count cancels across baseline vs audit — not a leak.

**If banking tick DOES mutate bank wealth in iter 1** (e.g. deposit-interest accrual transfers bank wealth → depositors), the mutation is captured by the `banking` bracket snapshot. The over-count in the baseline vs the under-count after the tick creates an **apparent drift in the banking bucket**, not in `physicsActions`.

H6 is a real but SEPARATE bug. It would manifest as persistent positive `sfcDriftBySubsystem.banking` every iteration where a bank mutates reserves. Not the primary −2655 source, but **worth fixing in the same wave** because both the code and the JSDoc currently lie about invariants.

### Ranking

| # | Hypothesis | Sign match? | Magnitude fit? | Confidence |
|---|---|---|---|---|
| **H3** | `clampWealth` floor at 0 destroys fiat on underflow | negative ✓ | 2000–5000 plausible ✓ | **highest** |
| **H2** | Order-book credit-without-seller (ghost seller) | negative ✓ | 500–3000 plausible ✓ | high |
| H1 | Order-book credit-without-buyer (ghost buyer) | positive ✗ | — | low (wrong sign) |
| H5 | Escrow persistence race | — | — | low (cosmetic, not a mid-iter leak) |
| H6 | Bank wealth double-counted with depositBalances | either | constant if no bank mutation | low for −2655; separate bug |
| H4 | Wage bankruptcy Math.floor | — | — | ruled out on re-examination |

---

## 3. Reproduction recipe

### 3.1 Existing unit-test gap

All 104 SFC tests pass because:

1. **Scripted closed-world fixtures.** Tests build a `weekStateMap` with every agent they reference; no dead-placer orders; no LLM-typo `buyerId`.
2. **Initial wealth is always generous.** Fixtures give each agent 1000–10000 fiat. `clampWealth` floor never triggers because scripted deltas never drive any agent negative.
3. **Single-iteration assertions.** No test runs a multi-action queue through the full `physicsActions` block with MET metabolism + auto-buy + VAT cascading through a bottom-quintile agent.
4. **No stale order fixture.** No test places an order with `agentId: 'ghost-uuid'` and then drives the matcher against `weekStateMap` that lacks that id.

### 3.2 Minimum repro for H3 (clampWealth underflow)

Add to `server/src/__tests__/sfcPhase11.test.ts`:

```ts
it('sfcAudit: should not destroy fiat when an agent is overdrawn by iteration end', () => {
  // 1 agent, 50 initial wealth, VAT 20%, AMM food @ 30/unit, MET requires 2 food
  // Auto-buy will cost ~60 fiat → wealth goes to -10 → clampWealth sets it to 0
  // AMM gained 60 but agent only lost 50 → audit reports 10 fiat destroyed.
  const agent = makeAgent({ wealth: 50 });
  const amm = makeAMM({ fiat: 100, food: 10 }); // spot price ~= 10, steep curve
  const baseline = computeSystemFiatTotal([agent], amm, undefined, 0, undefined, 0, 0, 0);

  // Simulate a WORK + BUY + metabolism cascade via the helper or an integration driver
  driveIterationThroughPhysicsActions({ agent, amm, taxPolicy: { flat: { income: 0.15, vat: 0.20 } } });

  const after = computeSystemFiatTotal([agent], amm, undefined, 0, undefined, 0, 0, 0);
  expect(after).toBeCloseTo(baseline, 1); // currently fails: after < baseline
});
```

### 3.3 Minimum repro for H2 (ghost seller)

```ts
it('order-book: should not debit buyer when sellerId has no weekStateMap entry', () => {
  const buyer = makeAgent({ id: 'B', wealth: 100 });
  const ghostSellerId = 'dead-ghost-uuid';
  const orderBook = new OrderBook('session');
  orderBook.submitOrder({ agentId: ghostSellerId, side: 'sell', itemType: 'tools', price: 10, quantity: 5, ... });
  orderBook.submitOrder({ agentId: 'B',           side: 'buy',  itemType: 'tools', price: 10, quantity: 5, ... });

  const weekStateMap = new Map([[buyer.id, createAgentWeekState()]]); // only buyer present

  // Run the simulationRunner order-book-clearing block (lines 1477–1542) against this map
  driveOrderBookClearing({ orderBook, weekStateMap, treasury: 0 });

  // Buyer was debited 50 + VAT. No seller was credited. → 50 fiat destroyed.
  expect(weekStateMap.get('B')!.wealthDelta).toBe(0); // currently fails: -50
});
```

Neither scenario is covered by the existing `sfcTaxation` or `sfcPhase11` suites.

---

## 4. Fix direction (outline, not patch)

### Fix for H3 (highest priority)

**File:** `server/src/orchestration/simulationRunner.ts:1987`

Replace the silent clamp with a **shortfall ledger**. When `newWealth < 0`, compute `shortfall = -newWealth`, add it to a per-iteration `physicsUnderflowPool` accumulator, set `newWealth = 0`, and credit `physicsUnderflowPool` to the state treasury inside the same bracket (before `sfcBySubsystem.physicsActions += …` at `:2208`). Emit a `[PHYSICS-UNDERFLOW]` trace per occurrence so forensic audit can count how often this fires.

Pseudocode:

```ts
let physicsUnderflowPool = 0;
// ... inside the statUpdate loop ...
const raw = agent.currentStats.wealth + r4(weekState.wealthDelta);
if (raw < 0) physicsUnderflowPool += -raw;
let newWealth = clampWealth(raw);
// ... after the loop, before line 2208 ...
if (physicsUnderflowPool > 0) {
  sessionStateTreasury.set(sessionId, (sessionStateTreasury.get(sessionId) ?? 0) + physicsUnderflowPool);
  appendTrace(sessionId, `[PHYSICS-UNDERFLOW] Agents overdrawn by ${physicsUnderflowPool.toFixed(2)} fiat — routed to treasury`);
}
```

This preserves SFC: the fiat that the agent couldn't afford ended up with the counterparty (already credited) **and** the treasury absorbs the resulting deficit on the agent's side. Net: 0. Treasury accepts the overdraft as a "final lender" against which the agent is implicitly in debt (future phase can formalize as a negative-wealth allowance or bailout).

**Alternative:** defensively cap every outflow at the agent's running balance inside the physics loop (`:1422` already tries this with `runningWealth = clampWealth(runningWealth + physics.wealthDelta)`, but clamps after-the-fact rather than refusing the outflow). This is more invasive — the shortfall-ledger fix is preferred because it's bracket-local.

### Fix for H2 (second priority)

**File:** `server/src/orchestration/simulationRunner.ts:1478–1541`

Tighten the guards so that **every trade requires both buyerState and sellerState to exist** before any mutation happens:

```ts
for (const trade of trades) {
  const buyerState  = weekStateMap.get(trade.buyerId);
  const sellerState = weekStateMap.get(trade.sellerId);

  const isSystemNpcBuyer = trade.buyerId === 'SYSTEM_NPC';

  // Require a real counterparty on each side before any fiat moves
  if (!sellerState) {
    appendTrace(sessionId, `[ORDER-BOOK-SKIP] Ghost seller ${trade.sellerId} — trade voided`);
    continue;
  }
  if (!buyerState && !isSystemNpcBuyer) {
    appendTrace(sessionId, `[ORDER-BOOK-SKIP] Ghost buyer ${trade.buyerId} — trade voided`);
    continue;
  }

  // ... existing three-path logic, but now both sides are guaranteed to exist ...
}
```

Also add a `orderBook.removeAgentOrders(id)` sweep at the START of the physics block for every agent NOT in `aliveAgents` (not just those who die mid-iter). Prevents cross-iteration stale orders from ever matching.

### Fix for H6 (same-wave, low priority)

**File:** `server/src/orchestration/helpers/sfcAudit.ts:25`

```ts
const agentFiat = agents
  .filter(agent => agent.isAlive && agent.type !== 'bank')  // honour the JSDoc promise
  .reduce(...);
```

And update all callers of `computeSystemFiatTotal` to pass `bankingTotalDeposits` that already includes bank's operating reserves (currently it's the sum of depositor accounts only — bank wealth would then need to be added separately as a new trailing arg, OR kept folded into the agent sum with a matching subtraction from `bankingTotalDeposits`). **This is the invasive option.** The conservative alternative: leave the code alone and **delete the misleading JSDoc** — document the actual behavior (bank wealth IS in `agentFiat`; `bankingTotalDeposits` is depositor claims which ARE separate M1 liabilities).

Pick the conservative path unless 11-GC1 owner wants to re-architect bank reserve semantics.

---

## 5. Blast radius — adjacent suspect sites

Grep these during 11-GC1 for the same "outflow without counterparty guard" pattern:

- **HELP / STEAL with target absent from weekStateMap** — `simulationRunner.ts:1385–1395` (STEAL) and `:1408–1419` (HELP). Current guards `if (victimState)` / `if (beneficiaryState)` protect most paths, but lack a clawback `else` branch. If a living target is absent from the map, STEAL mints fiat (thief +N, no victim debit). Add symmetric clawback.
- **Capital-market payout scaling truncation** — `simulationRunner.ts:2452` `Math.floor(delta * scaleFactor)` discards sub-unit gov-bond payout remainders when treasury underflows. Sub-cent destruction per iteration; compounds over long runs.
- **AMM food-reserve asymptotic floor fiat bump** — `automatedMarketMaker.ts:324–326`: `executeBuy` depleting food below 0.01 sets `fiatReserve = this.k / 0.01`, **minting fiat** to preserve k. Produces positive drift in `sfcDriftBySubsystem.physicsActions` under low-food conditions; not the cause of −2655 but will contaminate diagnostics.
- **`ubi_allocation > 1` edge case** — `governanceManager.ts:49` defaults to 1.0 but doesn't cap. If a governance proposal sets it above 1.0, the demurrage residual routing at `simulationRunner.ts:1920–1925` goes negative and debits treasury without a counterparty credit.

---

## 6. What I need to go from "narrowed" to "decisive"

Paste the **stderr lines from the iter=1 console** that follow the 🚨 CRITICAL line. Specifically the lines matching:

```
[SFC] iter=1 total drift=-2655.1700
[SFC]   physicsActions: ±N.NNNN
[SFC]   banking: ±N.NNNN
[SFC]   capmkt: ±N.NNNN
[SFC]   fiscal: ±N.NNNN
```

If `physicsActions` carries the bulk of −2655, H3 is confirmed as primary (the clampWealth floor on underflow). If `banking` is non-zero and `physicsActions` is small, H6 is primary (bank wealth double-count mutated during banking tick). If `capmkt` is large negative, look at the `Math.floor(delta * scaleFactor)` branch instead.

Until then, **11-GC1 should patch H3 (shortfall ledger) and H2 (ghost-side guards) together** — they are the two highest-confidence negative-sign leaks and both land in the `physicsActions` bracket, so a single commit can close them and the next run's `[SFC]` telemetry will confirm the attribution.

---

*Evidence-only; no production files modified.*
