# IDEAL WORLD: SFC AUDIT & FIAT LEAK FIXES (March 22, 2026)

This document tracks all mathematical issues, logic bugs, and fiat leaks identified and fixed during a comprehensive audit of the neuro-symbolic engine's economic systems.

---

## 1. Critical Fiat Leaks (Money Created from Nothing)

* **SYSTEM_NPC Raw Materials Purchases Minting Fiat:** The SYSTEM_NPC submitted buy orders for raw_materials to provide market liquidity, but had no `weekState` entry. When matched, the seller received `executionPrice × quantity` fiat, while the buyer side was silently skipped — creating fiat from nothing every iteration. **Fix:** SYSTEM_NPC purchases are now funded from the state treasury. If the treasury can't cover the full cost, the seller's payment is capped to the funded amount. (`simulationRunner.ts:1853-1865`)

* **AMM Famine Reserve Injection Inflating `k`:** `injectGoodsReserve()` added food to the AMM and recalculated `k = fiatReserve × foodReserve`, permanently inflating the AMM's total asset value. Agents who later sold food extracted more fiat than originally existed. **Fix:** Replaced `injectGoodsReserve` with `executeSell()` which adds food at market rate while keeping `k` constant. The fiat withdrawn from the AMM is routed to the treasury. (`simulationRunner.ts:2017-2043`)

* **Wealth Floor Top-Ups Minting Fiat:** At session start, agents below 20 wealth were topped up to 20 with unbacked fiat — no deduction from any pool. **Fix:** Top-ups are now funded from the state treasury. If the treasury can't cover all top-ups, the amounts are proportionally reduced. (`simulationRunner.ts:1032-1047`)

* **Enterprise Founding Fee Mutating AMM Constant Product:** `injectFiatReserve(FOUNDING_COST)` recycled the 40-fiat founding fee into the AMM, but this mutated `k`, permanently altering the trading curve. **Fix:** Founding fees now go to the state treasury instead, preserving the AMM's constant product invariant. (`simulationRunner.ts:562-566`)

---

## 2. Fiat Destruction (Money Silently Vanishing)

* **`Math.floor` on AMM Sell Payouts Truncating Fiat:** All 8 AMM sell operations used `Math.floor(fiatOut)`, but the AMM's fiat reserve already decreased by the full untruncated amount. The fractional remainder (up to 0.99 fiat per trade) was destroyed every trade. Since wealth supports fractional values (`clampWealth` doesn't round), this truncation was unnecessary. **Fix:** Removed all `Math.floor` wrappers on AMM sell payouts. (`simulationRunner.ts:674,692,734,751,865,882`)

* **HELP Action Destroying Fiat:** The HELP action returned `wealthDelta = -5` for the helper, but there was no corresponding wealth transfer to the target agent. The 5 fiat was permanently removed from the economy. **Fix:** Added zero-sum HELP transfer logic (mirroring the existing STEAL fix) that routes the helper's loss to the beneficiary, capped at the helper's available wealth. (`simulationRunner.ts:1791-1803`)

* **Demurrage UBI with `ubiAllocation < 1.0` Destroying Fiat:** When `sessionPolicy.ubi_allocation` was set below 1.0, only a fraction of the tax pool was redistributed. The remainder (`taxPoolCollected × (1 - ubiAllocation)`) vanished from the economy. **Fix:** The unreturned portion is now routed to the state treasury. (`simulationRunner.ts:2167-2175`)

* **Bankruptcy Wage Truncation Destroying Fiat:** During enterprise bankruptcy, `Math.floor(wage × payRatio)` for each worker could leave 1-3 fiat unaccounted for between the owner's liquidated balance and the total paid out. **Fix:** Implemented remainder distribution that gives the leftover 1-fiat units to the first workers in the queue, ensuring total paid equals total liquidated. (`simulationRunner.ts:1931-1964`)

---

## 3. Logic Bugs & Wrong Calculations

* **STEAL Using Stale Target Wealth:** `stealCalc()` in `physicsEngine.ts` used `target.currentStats.wealth` from the start-of-iteration `allAgents` snapshot. If the victim had already been drained by taxes, other steals, or purchases within the same iteration, the thief calculated their gain from wealth the victim no longer had. **Fix:** For STEAL actions, the target's wealth in the `allAgents` snapshot is patched with their running wealth (`currentStats.wealth + weekState.wealthDelta`) before passing to `resolveAction`. (`simulationRunner.ts:1700-1710`)

* **WORK Not in BASE_ACTIONS:** Laborers (the `BASE_ACTIONS` tier) — the most work-oriented roles — could not select the WORK action. Only specialists and elites had it. **Fix:** Added `'WORK'` to `BASE_ACTIONS`. (`actionCodes.ts:104`)

* **`resolveActionQueue` Double-Clamping Deltas:** Each `resolveAction` call already clamped its output to `±clampDeltaMax`. Then `resolveActionQueue` summed the already-clamped deltas and clamped the sum *again*, making a 3-action queue no more effective than a single action. **Fix:** Removed the outer clamp from `resolveActionQueue`. (Dead code path, but fixed for correctness.) (`physicsEngine.ts:522-527`)

* **Dead Agent Stale Orders in Order Book:** Dead agents' unfilled orders persisted in the order book as good-till-cancelled. When matched in future iterations, the dead agent's `weekState` was undefined, causing the counterparty's fiat to vanish (if selling to a dead buyer) or goods to materialize without payment (if buying from a dead seller). **Fix:** Added `orderBook.removeAgentOrders(agent.id)` when an agent dies. (`simulationRunner.ts:2223`)

---

## 4. Disconnected Systems & Dead Code

* **Tool Depreciation & Food Spoilage Never Applied:** `processInventory()` in `inventorySystem.ts` was completely disconnected from the simulation loop — never imported or called. Tools never broke and food never spoiled, giving tools a permanent free productivity buff. **Fix:** Integrated depreciation directly into the simulation loop: food quality decays 15%/iter (spoils at quality < 10), tools lose 5 durability per work action (break at < 5), raw materials decay 1%/iter. (`simulationRunner.ts:2075-2116`)

* **Vestigial `state` Parameter in `AllostaticTickInput`:** The `state` field was declared in the interface but never read inside `tick()` — the engine used its own `this.strain` and `this.load` from the constructor. **Fix:** Removed from interface and all 3 call sites. (`allostaticEngine.ts:249-260`, `simulationRunner.ts:2139`, `physics_sandbox.ts:239`)

---

## 5. Files Modified

| File | Changes |
|---|---|
| `server/src/orchestration/simulationRunner.ts` | SYSTEM_NPC treasury funding, AMM famine reserve k-preservation, wealth floor treasury funding, enterprise founding treasury routing, Math.floor removal on AMM sells, STEAL stale wealth fix, HELP zero-sum transfer, demurrage unreturned tax treasury routing, bankruptcy wage remainder distribution, dead agent order cleanup, tool/food depreciation integration, allostatic state cleanup |
| `server/src/mechanics/physicsEngine.ts` | Removed double-clamp in `resolveActionQueue` |
| `server/src/mechanics/actionCodes.ts` | Added WORK to BASE_ACTIONS |
| `server/src/mechanics/allostaticEngine.ts` | Removed vestigial `state` from `AllostaticTickInput` interface and `runFullMetabolicTick` |
| `server/src/mechanics/__tests__/physics_sandbox.ts` | Updated `AllostaticTickInput` call site |

---

## 6. Fiat Flow Summary (Before vs After)

| Source | Before | After |
|---|---|---|
| SYSTEM_NPC purchases | Minted fiat from nothing | Funded from treasury |
| AMM famine injection | Inflated k, slow fiat inflation | k-preserving sell, fiat to treasury |
| Wealth floor top-ups | Minted fiat from nothing | Funded from treasury |
| Enterprise founding fee | Mutated AMM k | Routed to treasury |
| AMM sell Math.floor | ~0.5 fiat destroyed per trade | Exact fractional payout |
| HELP action | 5 fiat destroyed per HELP | Transferred to target |
| Demurrage UBI < 100% | Untaxed portion destroyed | Routed to treasury |
| Bankruptcy wages | 1-3 fiat destroyed per event | Remainder distributed to workers |
| Dead agent orders | Fiat vanished on match | Orders removed on death |
