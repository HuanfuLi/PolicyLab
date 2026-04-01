# SFC & Physics Bug Fix Plan
**Audit date:** 2026-03-23
**Status:** Ready for implementation
**Source:** Full codebase audit — `physicsEngine.ts`, `simulationRunner.ts`, `allostaticEngine.ts`, `automatedMarketMaker.ts`

---

## Background

A systematic audit found 7 issues across the Neuro-Symbolic Engine. The root cause of SFC drift
(visible as `[SFC] iter=N: drift=...` console warnings) is that AMM economy deltas are merged into
physics deltas *before* the `clampDeltaMax = 30` clamp fires, silently truncating large trades.
All other issues are secondary but compound the drift.

---

## Issues (Priority Order)

### Fix 1 — CRITICAL: Decouple economy deltas from physics clamp
**Files:** `server/src/orchestration/simulationRunner.ts` (lines ~1659–1748)

**Problem:**
`applyEnterpriseAction` returns `economyDelta` (real fiat flows: AMM trades, buy/sell, founding costs).
This is passed as `economyDeltas` into `resolveAction`, which **adds it to `w` then clamps the sum** at ±30.
A PRODUCE_AND_SELL selling 20 food generates ~116 fiat from AMM, but the agent receives only 30.
The AMM reserves drop by 116. **86 fiat is destroyed per PRODUCE action.**
The same mechanism creates fiat on large buys (agent underpays).

**Fix (simulationRunner.ts, inside the action queue loop):**

1. Call `applyEnterpriseAction` as today — store `economyDelta`.
2. Call `resolveAction` with **`economyDeltas: undefined`** (or zero-valued) so physics only
   computes pure stat-change deltas (clamped correctly at ±30).
3. Apply economy and physics deltas **separately** to `weekState`:
   ```typescript
   weekState.wealthDelta  += economyDelta.wealthDelta;   // AMM/enterprise flows — no clamp
   weekState.wealthDelta  += physics.wealthDelta;         // role income, theft, etc — clamped
   weekState.healthDelta  += economyDelta.healthDelta + physics.healthDelta;
   weekState.happinessDelta += economyDelta.happinessDelta + physics.happinessDelta;
   weekState.cortisolDelta  += economyDelta.cortisolDelta + physics.cortisolDelta;
   weekState.dopamineDelta  += economyDelta.dopamineDelta + physics.dopamineDelta;
   ```
4. Update `runningWealth` using both: `runningWealth = clampWealth(runningWealth + economyDelta.wealthDelta + physics.wealthDelta)`.

**Note:** The cortisol/happiness auto-escalation inside `resolveAction` (low wealth, low health)
reads `agent.currentStats` which already uses `runningWealth` — ensure the agent snapshot passed
to `resolveAction` still reflects the running accumulated wealth (it does today; keep this).

**Acceptance:** SFC drift warnings should disappear or drop to <0.5 fiat/agent/iteration.

---

### Fix 2 — HIGH: INVEST has no economy handler (destroys 10 fiat per use)
**Files:** `server/src/orchestration/simulationRunner.ts` (~line 539 switch), `server/src/mechanics/physicsEngine.ts` (~line 230)

**Problem:**
`resolveAction` charges `w = -10` for INVEST. `applyEnterpriseAction` has no `case 'INVEST':`.
The 10 fiat is debited from the agent and goes nowhere — pure fiat destruction.

**Two acceptable fixes (pick one):**

**Option A — Route to treasury (recommended):**
```typescript
// in applyEnterpriseAction switch:
case 'INVEST': {
  const INVEST_COST = 10;
  const currentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
  if (currentWealth >= INVEST_COST) {
    // Physics already charges -10; route it to treasury as a capital formation fee
    const treasury = sessionStateTreasury.get(params.sessionId) ?? 0;
    sessionStateTreasury.set(params.sessionId, treasury + INVEST_COST);
    state.events.push(`Invested ${INVEST_COST} fiat (capital fee recycled into treasury)`);
  }
  break;
}
```
This mirrors the FOUND_ENTERPRISE pattern.

**Option B — Remove from allowed actions until mechanic is designed:**
In `server/src/mechanics/actionCodes.ts`, remove `'INVEST'` from the laborer and specialist
allowed-action arrays until a full investment return mechanic is built.

**Acceptance:** No `INVEST` in any iteration should cause the SFC audit to drift by a multiple of 10.

---

### Fix 3 — HIGH: FOUND_ENTERPRISE physics -8 is unrouted
**Files:** `server/src/mechanics/physicsEngine.ts` (~line 266)

**Problem:**
`resolveAction` assigns `w = -8` as "setup costs" for FOUND_ENTERPRISE.
`applyEnterpriseAction` independently charges `FOUNDING_COST = 40` and correctly routes it to treasury.
After Fix 1, the separation means: agent -8 (physics) + agent -40 (economy) = -48 total.
Treasury receives only +40. Net: **-8 fiat destroyed** per founding.

**Fix:**
Set `w = 0` in the FOUND_ENTERPRISE physics case. The full founding cost (-40 → treasury) is already
handled by the economy layer. The physics layer should not charge an additional unrouted fee.

```typescript
// physicsEngine.ts ~L265
case 'FOUND_ENTERPRISE':
  w = 0;   // was -8; full cost handled by economy layer (FOUNDING_COST=40 → treasury)
  h = -1;
  hap = 3;
  cor = 5;
  dop = 4;
  trace.push(`  Δwealth: 0 (full founding cost of 40 charged and routed to treasury by economy layer)`);
```

**Acceptance:** An agent with exactly 40 wealth can found an enterprise and end with exactly 0 wealth
(not -8 or -30).

---

### Fix 4 — MEDIUM: Delete `resolveActionQueue` dead export
**Files:** `server/src/mechanics/physicsEngine.ts` (~lines 430–540)

**Problem:**
`resolveActionQueue` is a complete queue executor exported from `physicsEngine.ts` but **never
imported or called** anywhere in the production codebase. The simulation uses its own inline loop
in `simulationRunner.ts` with SFC logic (treasury deductions, HELP redistribution, seizures) that
this function lacks. If a developer accidentally uses `resolveActionQueue`, they bypass all SFC
accounting.

**Fix:**
Delete the `resolveActionQueue` function and its associated `PhysicsQueueInput`/`PhysicsQueueOutput`
interfaces from `physicsEngine.ts`. Also remove from any type-export barrel files if present.

**Acceptance:** `grep -r resolveActionQueue` returns no results.

---

### Fix 5 — LOW: Remove `helperAvailable` dead variable
**Files:** `server/src/orchestration/simulationRunner.ts` (~line 1797)

**Problem:**
```typescript
const helperAvailable = Math.max(0, runningWealth + physics.wealthDelta);  // never used
```
Calculated but never referenced. Dead code.

**Fix:** Delete line 1797.

**Acceptance:** No TypeScript unused-variable warning for `helperAvailable`.

---

### Fix 6 — LOW: Log allostatic dopamine feedback in trace
**Files:** `server/src/mechanics/allostaticEngine.ts` (~lines 316–321)

**Problem:**
The anhedonia feedback (`cortisol + 4` when `dopamine ≤ 30`) is applied silently. Agents gain
allostatic load with no explanation in traces or events, making health decay appear causeless.

**Fix:** Return an optional `anhedoniaBoosted: boolean` flag from `tick()` and have `simulationRunner.ts`
push an event when it fires:

```typescript
// allostaticEngine.ts — add to AllostaticTickOutput:
anhedoniaBoosted: boolean;

// tick() — add to return:
anhedoniaBoosted: dopamine !== undefined && dopamine <= 30,

// simulationRunner.ts — after allostatic tick:
if (alloResult.anhedoniaBoosted) {
  weekState.events.push(
    `Anhedonia feedback: low dopamine (${Math.round(newDopamine)}) amplified cortisol stress (+4 effective) — chronic under-reward accelerates allostatic load`
  );
}
```

**Acceptance:** Agents with dopamine ≤ 30 show anhedonia feedback in their weekly event log.

---

### Fix 7 — LOW: Fix dopamine decay trace sign
**Files:** `server/src/mechanics/physicsEngine.ts` (~line 399)

**Problem:**
```typescript
trace.push(`Hedonic adaptation: Δdopamine ${physicsConfig.dopamineDecay} (decay)`);
```
If `dopamineDecay = -1`, this prints `Δdopamine -1` which looks like it's saying the delta IS -1,
but it's actually showing the raw config value (which is already negative). Inconsistent with all
other trace entries which show the sign-explicit applied delta.

**Fix:**
```typescript
const decayApplied = physicsConfig.dopamineDecay;
trace.push(`Hedonic adaptation: Δdopamine ${decayApplied >= 0 ? '+' : ''}${decayApplied} (hedonic adaptation — weekly decay)`);
```

---

## Implementation Order

```
Fix 1 (critical, standalone change in runner)
  └─► Fix 3 (now that economy/physics are separate, zero out the physics -8)
  └─► Fix 2 (add INVEST treasury routing OR remove from allowed actions)
Fix 4 (safe deletion, no runtime impact)
Fix 5 (safe deletion, no runtime impact)
Fix 6 (additive — new return field + event push)
Fix 7 (trace string only)
```

Fixes 4–7 are safe to do in any order and can be batched into a single commit.
Fixes 1, 2, 3 must be done together (1 first, then 2 & 3 depend on the new separation).

## Testing

After each fix, run:
```bash
npm run test -w server
```

For Fix 1 specifically, run the physics sandbox and verify SFC drift warnings are gone:
```bash
npx vitest run server/src/mechanics/__tests__/physics_sandbox.ts
```

After all fixes, start a short 10-iteration simulation and confirm the console produces no
`[SFC] iter=N: drift=...` warnings above the ±0.5 fiat tolerance.

## Key Files

| Fix | Primary file | Secondary file |
|-----|-------------|----------------|
| 1 | `simulationRunner.ts` L1659–1748 | `physicsEngine.ts` (no change needed) |
| 2 | `simulationRunner.ts` ~L539 switch | `physicsEngine.ts` L230 (keep or remove w=-10) |
| 3 | `physicsEngine.ts` L266 | — |
| 4 | `physicsEngine.ts` L430–540 | remove type exports |
| 5 | `simulationRunner.ts` L1797 | — |
| 6 | `allostaticEngine.ts` L316–321 | `simulationRunner.ts` allostatic tick block |
| 7 | `physicsEngine.ts` L399 | — |
