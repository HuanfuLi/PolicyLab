# Phase 11: Simulation realism — organic stress pressure, fiscal balance, and SFC leak closure - Research

**Researched:** 2026-04-13
**Domain:** Deterministic economic engine — stress dynamics, fiscal accounting, subsystem observability
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cortisol Stress Model**
- **D-01:** Remove **all** per-action cortisol relief in `physicsEngine.ts`. Strip `Δcortisol` from WORK (−3), WORK_AT_ENTERPRISE (−3), REST (−5), PRODUCE_AND_SELL (−2), POST_BUY_ORDER / POST_SELL_ORDER (−1), HELP (−5), DEPOSIT (−2), REPAY_LOAN (−3), BUY_BOND (−1), ISSUE_GOV_BOND (−2), and any other cheap action-reward entries. Keep **outcome-driven** cortisol (STEAL +10, STRIKE +5, unemployment-induced penalties, etc.). Cortisol becomes purely a stress signal.
- **D-02:** Add four continuous per-tick structural cortisol pressures applied to every alive citizen agent (not bank/central):
  - Inflation surprise: `+k_inflation × max(0, actual_CPI_growth − expected)`
  - Inequality stress (bottom quintile only): `+k_gini × max(0, Gini − threshold)`
  - Unemployment / precarity: `+k_unemp` when agent has no `employmentRegistry` entry AND wealth below a configurable threshold
  - Underfunded public goods: `+k_pg × (1 − min(infra, edu, welfare)/50)`
- **D-03:** Cortisol ceiling raised to **95** (from 100). Floor = 3 (existing Phase 10 convention retained).
- **D-04:** Cortisol auto-escalation thresholds raised: `lowWealthThreshold` 20 → **50**, `lowHealthThreshold` 30 → **60**.
- **D-05:** Calibration: ship with **conservative defaults** (low coefficients, e.g., 2–3 cortisol/tick per pressure), exposed as hot-swappable constants in `physicsConfig.ts`.

**Happiness Symmetry**
- **D-06:** Parallel treatment to cortisol: remove per-action happiness rewards (REST +2, POST_ORDER +1, PRODUCE_AND_SELL +1, etc.). Keep outcome-driven happiness (STRIKE +5, HELP +5 altruistic, etc.).
- **D-07:** Add continuous per-tick structural happiness **pressures** (negative deltas):
  - Peer death penalty: `−k_peer_death × deathsThisTick`
  - Inequality (bottom quintile): `−k_gini_hap × max(0, Gini − threshold)`
  - Unemployment: `−k_unemp_hap` when no employment + low wealth
  - Underfunded welfare: `−k_welfare × (1 − welfareQuality/50)`
  - Inflation surprise: `−k_inflation_hap × max(0, CPI_growth − expected)`
- **D-08:** Happiness clamp tightened to **[5, 95]** (from [0, 100]).
- **D-09:** Calibration same as cortisol — conservative defaults in `physicsConfig.ts`.

**Fiscal Loop Closure**
- **D-10:** Only the **welfare** allocation distributes fiat as direct per-agent transfers. Infrastructure, education, and defense fiat moves into a new **public-goods escrow ledger** (per-session, per-category).
- **D-11:** `publicGoodsEscrow: { infrastructure, education, defense }` per-session state; counted in `computeSystemFiatTotal` so M0 stays constant. Quality-score side effects (productivity, skill, enforcement multipliers) remain unchanged.
- **D-12:** Tax base extended beyond WORK tax. Per-tick taxable events: AMM sell revenue from PRODUCE_AND_SELL, enterprise wage income, capital gains on SELL_SHARES, matured bond payouts, AMM consumption VAT.
- **D-13:** `taxPolicy: { kind: 'flat' | 'progressive', rates: {...} }` picked by Central Agent at bootstrap. Fixed menu — flat or progressive only. Runtime amendment deferred.
- **D-14:** Tax collection timing: **inline during each tax-bearing action**. Preserves per-action SFC traceability.
- **D-15:** Fold in bootstrap bug: current session has no `fiscal_budgets` row despite `bootstrap.ts:540` calling `fiscalRepo.createBudget`. Investigate AND add startup assertion: when `fiscalEnabled === true`, a `fiscal_budgets` row must exist before `runSimulation` proceeds. No silent fallback to `DEFAULT_BUDGET_ALLOCATION`.

**Governance Mechanic Extensions**
- **D-16:** Existing franchise-sizing / proposal / ballot / vote / ratify cycle confirmed complete. **No changes** to franchise sizing.
- **D-17:** `economyConfig.governanceEnabled` boolean (default `true`). When `false`, skip `runGovernanceCycle`. Expose as checkbox in Design stage UI.
- **D-18:** Extend governance to **law text amendment** via new ballot item `law_amendment` with `{ oldParagraph, newParagraph, description }`. Ratified amendments apply paragraph-level diff to `session.law` reusing pattern from `centralAgent.ts:410-447`. Silently rejected if `oldParagraph` not found verbatim. Store amendments in history.
- **D-19:** Law amendment scope: paragraph-level text replacement only. No structured JSON law schema.

**SFC Leak Closure**
- **D-20:** Diagnostic approach. Instrument each subsystem with per-iteration balance deltas. Instrumented subsystems: banking, capital markets, fiscal (incl. escrow), enforcement, trade/AMM, physics-action-resolution.
- **D-21:** Add `sfcDrift` and `sfcDriftBySubsystem: { banking, capmkt, fiscal, enforcement, trade, physicsActions }` to `TelemetryLog`. Each subsystem's delta MUST sum to zero within the same iteration.
- **D-22:** Drift warning threshold unchanged: **0.1 absolute** fiat per iteration.
- **D-23:** On drift detection: `console.error` + telemetry record. **No auto-correction**, **no simulation pause**.

### Claude's Discretion
- Exact coefficient defaults (`k_inflation`, `k_gini`, `k_unemp`, `k_pg`, `k_peer_death`, etc.) — planner picks conservative seed values (this research proposes starting values in §Calibration Seed Values).
- Structural pressure application order within each tick (before/after action resolution, before/after allostatic engine).
- Whether cortisol ceiling (95) is enforced on `runningCortisol` accumulator or only at final stat commit.
- Taxable-event hook placement (which file owns withholding logic).
- Escrow ledger persistence format (new DB table vs extension of `public_goods_state` vs in-memory + snapshot).
- Law amendment ballot prompt design — reuse governance proposal prompt pattern.

### Deferred Ideas (OUT OF SCOPE)
- Agent-driven runtime amendment of taxShape — Phase 12+
- Structured JSON law schema — Phase 12+
- Wealth tax / land tax — Phase 12+
- Hedonic adaptation + social-network happiness modeling — separate phase
- Research-backed psychophysics calibration — future phase if empirical defaults prove too noisy
- Per-action SFC bug-hunt audit — follow-up if Phase 11 telemetry surfaces a consistent non-zero subsystem delta
- Full escrow lifecycle (government contracts) — escrow is a static sink this phase
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ-IDs are assigned to Phase 11 in `ROADMAP.md` ("Requirements: TBD"). The phase is scoped entirely by the 23 locked decisions D-01 through D-23 above. Plans should derive requirement coverage directly from CONTEXT.md, grouped into the five subsystems (cortisol, happiness, fiscal loop, governance, SFC telemetry).

Each plan MUST map its tasks back to the specific decisions it addresses (e.g., "Plan 02 addresses D-02, D-03, D-04, D-05"). This is the substitute for the REQ-ID → plan map the planner would normally use.
</phase_requirements>

## Summary

This phase is a **focused corrective pass on an existing deterministic engine**. All five subsystems already exist; none is being invented from scratch. The research confirms that:

1. **Cortisol/happiness rewiring is localized** — every strip target in D-01/D-06 is concentrated in a single 500-line switch block (`physicsEngine.ts:161-498`). No callers inspect specific delta magnitudes; only integration tests check signed direction. Structural pressures already have every input available (Gini, CPI surprise, unemployment, quality scores) — no new computation needed, only wiring.
2. **Fiscal escrow requires one new table (or one new column) plus one signature change** — `fiscalEngine.executeBudget` currently distributes **all** spending equally to agents (`fiscalEngine.ts:371-395`). Only the welfare branch keeps that behaviour; the other three branches redirect to a new `publicGoodsEscrow` map. `computeSystemFiatTotal` (`helpers/sfcAudit.ts`) already accepts additive scalars (`depositBalances`, `collateralEscrow`) so extending it with an `escrow` parameter follows an established pattern.
3. **Tax hooks exist as functions but are wired nowhere** — `computeIncomeTax` lives in `fiscalEngine.ts:39-55` but `grep` shows **zero callers** in `simulationRunner.ts` or `enterpriseActionDispatch.ts`. Phase 10 D-32 was partially implemented: the function exists and is tested, but not invoked. Phase 11 D-12/D-14 must wire it in AND extend it to the new taxable events.
4. **Bootstrap D-15 bug is structurally plausible but unreproduced here** — `bootstrap.ts:540` calls `fiscalRepo.createBudget(createScope(id), budget)` **inside** the same try-block that writes session config. The call is unconditional when `finalConfig.fiscalEnabled`. The most likely failure mode is an **earlier** exception bypassing the call or a legacy bootstrap path writing `session.config.budgetAllocation` without touching `fiscal_budgets` (e.g., `sessions.ts:399` and `sessions.ts:482/573` fork paths also call `createBudget`, so only the non-forked, non-bootstrap creation path — direct `POST /api/sessions` without bootstrap — might skip it). Startup assertion is the right fix regardless of root cause.
5. **SFC subsystem telemetry needs an accumulator pattern, not per-site instrumentation.** Each subsystem tick (banking, capital market, fiscal, inflation, physics action resolution) already runs as a discrete block in `simulationRunner.ts`. Capturing `sum(wealthDelta) + Δtreasury + Δdeposits + Δescrow + Δammreserve` at the entry and exit of each block yields the per-subsystem drift for free.

**Primary recommendation:** Sequence plans as (A) types + config scaffolding (D-03, D-04, D-08, D-11, D-13, D-17, D-21 type additions), (B) cortisol + happiness strip & rewire (D-01, D-02, D-06, D-07), (C) fiscal escrow (D-10, D-11), (D) tax withholding wiring (D-12, D-14), (E) taxPolicy generation (D-13), (F) governance toggle + amendment (D-17, D-18), (G) SFC telemetry instrumentation (D-20, D-21), (H) bootstrap D-15 fix + assertion. Run full SFC test suite at the end of B, C, D, G.

## Project Constraints (from CLAUDE.md)

These directives are **locked** at the same authority level as CONTEXT.md decisions:

- **Shared types** live in `shared/src/types.ts` only — add `taxPolicy`, `governanceEnabled`, `publicGoodsEscrow` fields here, not in server-local files. Import via `@policylab/shared`.
- **Prompt changes** must happen in `server/src/llm/prompts/**` only — law-amendment prompt template (D-18) goes in `prompts/governance.ts` or a new `prompts/*.ts` file, not inline in `governanceManager.ts`.
- **New action types** (none expected this phase, but confirm) register in `mechanics/actionCodes.ts` first.
- **Economy changes** must keep the SFC invariant intact: `M0 constant + M1 = M0 + loansOutstanding`. Bank agents excluded from `computeSystemFiatTotal` citizen sum (to prevent double-count with `depositBalances`). Any new fiat flow (escrow) must either stay in the perimeter or be audited at a subsystem boundary.
- **Economic parameters** (tax rates, escrow thresholds, ceiling values) must live in `EconomyConfig` session-level config, never hardcoded in engine files.
- **asyncLogFlusher** for high-frequency writes; direct `sqlite.transaction()` for once-per-iteration batch writes (the established pattern in fiscal/banking/cmkt ticks).
- **`type: 'bank'` agents** are excluded from `citizenAgents` filter. Structural pressures (D-02, D-07) must **not** apply to them — the decision text says "every alive citizen agent (not bank/central)". Reuse the `!isCentralAgent && !isBank` filter pattern from `simulationRunner.ts:260`.
- **Bootstrap data mapping** — when adding `taxPolicy` to LocationProfile / config, track confidence + source (`api` / `web` / `llm`) and populate `DataConfidenceBadge` in DesignReview UI.

## Standard Stack

Phase 11 **touches zero new libraries**. Every pattern is reused from existing modules. No npm install required.

### Internal Modules

| Module | Version | Purpose | Why Used |
|---|---|---|---|
| `physicsConfig.ts` | in-repo | Hot-swappable constants | Established pattern for `k_*` coefficients (D-05, D-09). See `physicsConfig.ts:73-98` for DEFAULTS structure. |
| `sessionScope.ts` + branded `SessionScope` | in-repo | Type-safe repo calls | `fiscalRepo.*` already uses this — escrow lookups follow suit. |
| `@policylab/shared` types | in-repo | Cross-workspace contract | `EconomyConfig`, `TelemetryLog`, `BudgetAllocation`, `SessionPolicy` — all extensions go here. |
| `asyncLogFlusher` | in-repo (db/asyncLogFlusher.ts) | Batched writes | Only if escrow emits per-trade journal entries; once-per-iteration persistence should use `sqlite.transaction()` directly. |
| `drizzle-orm` + `better-sqlite3` | existing | DB layer | Used by all repos. New `publicGoodsEscrow` column / table follows `fiscalBudgets` pattern in `schema.ts:267+`. |
| `uuid v4` | existing | Record IDs | Pattern from `fiscalRepo.createBudget` (`fiscalRepo.ts:204`). |
| `vitest` | existing | Test runner | All new tests plug into existing `__tests__/*.test.ts` structure. |

### Verified Versions

Package versions in `server/package.json` and `shared/package.json` are stable. Phase 10 used them successfully. No upgrades needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff — Why Rejected |
|---|---|---|
| Extending `public_goods_state` with escrow columns | New `public_goods_escrow` table | Keeps quality scores (already per-iteration snapshots) physically separate from fiat balances (which must be a running ledger, not per-iteration snapshot). **Research recommendation:** new **dedicated columns on `sessions` table OR a new small table `public_goods_escrow(sessionId, category, balance)`**. Planner picks. |
| Strip deltas via `physicsEngine` rewrite | Leave deltas in place, override via `economyDeltas` | Override path is used for economy engine additions, NOT strips. The existing `economyDeltas` layering wraps around hardcoded values — it cannot zero them out. **Must edit the switch block directly.** |
| Per-event SFC instrumentation (decorator pattern) | Per-subsystem block-level accounting | The runner organizes subsystems into sequential blocks; block-level `preSum → tick → postSum` is simpler and captures the same information. Decorator requires refactoring 15+ call sites. |

## Architecture Patterns

### Recommended Project Structure (no new directories)

```
server/src/mechanics/
├── physicsEngine.ts          # D-01, D-06 strips; structural pressure layer (D-02, D-07)
├── physicsConfig.ts          # k_* coefficients; raised thresholds (D-03, D-04, D-05, D-08, D-09)
├── fiscalEngine.ts           # executeBudget signature change (D-10, D-11);
│                             # extend TaxInput to cover all taxable events (D-12)
├── allostaticEngine.ts       # READ-ONLY; validate ceiling=95 doesn't break strain integrator
server/src/orchestration/
├── simulationRunner.ts       # wire structural pressures; tax withholding hook sites (D-14);
│                             # SFC subsystem accounting (D-20, D-21);
│                             # governance toggle gate (D-17)
├── governanceManager.ts      # new law_amendment ballot type (D-18);
│                             # extend SessionPolicy / ballot field union
├── enterpriseActionDispatch.ts # wage tax hook (D-12)
├── helpers/sfcAudit.ts       # computeSystemFiatTotal +escrow param (D-11)
server/src/db/
├── schema.ts                 # add public_goods_escrow table OR columns on existing
├── repos/fiscalRepo.ts       # escrow CRUD; D-15 bug triage
├── migrate.ts                # ALTER TABLE guard for new escrow columns (ADR pattern P10)
server/src/routes/
├── bootstrap.ts              # D-15 startup assertion; taxPolicy persistence (D-13)
server/src/llm/
├── centralAgent.ts           # taxPolicy selection at design time (D-13)
├── prompts/governance.ts     # law_amendment ballot prompt (D-18)
├── prompts/central-agent.ts  # taxPolicy added to design generation schema (D-13)
server/src/data/
├── dataBootstrapPipeline.ts  # taxPolicy derivation from WB data (D-13 for location mode)
shared/src/types.ts           # taxPolicy, governanceEnabled, publicGoodsEscrow, sfcDrift*
web/src/
├── pages/DesignReview.tsx    # governance toggle wiring (D-17)
├── components/EconomyTab.tsx # governance checkbox (D-17)
```

### Pattern 1: Hot-Swappable Physics Coefficients

**Source:** `server/src/mechanics/physicsConfig.ts:73-127`

```typescript
// DEFAULTS object + live mutable `physicsConfig` + updatePhysicsConfig()
export interface PhysicsConfigValues {
  lowWealthThreshold: number;          // 20 → 50 per D-04
  lowHealthThreshold: number;          // 30 → 60 per D-04
  // ── NEW in Phase 11 ──
  cortisolCeiling: number;             // 100 → 95 per D-03 (applied at clampStat sites)
  cortisolFloor: number;               // 3 (retained per Phase 10 GC3)
  happinessCeiling: number;            // 100 → 95 per D-08
  happinessFloor: number;              // 0 → 5 per D-08
  k_inflation_cor: number;             // inflation surprise → cortisol (D-02)
  k_gini_cor: number;                  // Gini-bottom-quintile → cortisol (D-02)
  k_unemp_cor: number;                 // unemployment → cortisol (D-02)
  k_pg_cor: number;                    // underfunded public goods → cortisol (D-02)
  giniStressThreshold: number;         // threshold for max(0, Gini - threshold)
  k_peer_death_hap: number;            // peer death → -happiness (D-07)
  k_gini_hap: number;                  // Gini → -happiness (D-07)
  k_unemp_hap: number;                 // unemployment → -happiness (D-07)
  k_welfare_hap: number;               // underfunded welfare → -happiness (D-07)
  k_inflation_hap: number;             // inflation surprise → -happiness (D-07)
}

// Pattern: add to DEFAULTS with conservative values; updatePhysicsConfig accepts partial updates
```

### Pattern 2: SFC-Neutral Extension via Additive Sum

**Source:** `server/src/orchestration/helpers/sfcAudit.ts`

```typescript
// Current signature accepts additive scalars that represent fiat held outside agent wallets
// but inside the closed loop. Extend identically for escrow:
export function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM, multiAMMs,
  treasury: number,
  wealthOverrides?,
  depositBalances = 0,
  collateralEscrow = 0,
  publicGoodsEscrow = 0,    // NEW in Phase 11 per D-11
): number {
  // sum agentFiat + AMM fiat reserves + treasury + depositBalances
  //   + collateralEscrow + publicGoodsEscrow
}
```

All call sites in `simulationRunner.ts` (`:471, :2398, :2548, :2741`) must be updated to pass the escrow total.

### Pattern 3: Per-Subsystem Balance Delta Accumulator (D-20, D-21)

**What:** Wrap each subsystem tick block with `before = measureFiatIn(subsystem); ...tick...; after = measureFiatOut(subsystem); drift = after - before;`.

**Where:** `simulationRunner.ts` already has labeled blocks:
- Banking tick: `simulationRunner.ts:~2150-2204`
- Capital market tick: `:2206-2307`
- Fiscal tick: `:2309-2373`
- Inflation tick: `:2375-2475`
- Physics action resolution: inside `weekStateMap` loop `:~1100-1400`
- Trade/AMM execution: `:1373-1397`
- Wage/enterprise: `:1399-1550`
- Enforcement seizure: `:1232-1246` (`seizedWealthPool`)

**Recommended structure — research prescribes this:**

```typescript
// In simulationRunner.ts, outside iteration loop:
type SubsystemKey = 'banking' | 'capmkt' | 'fiscal' | 'enforcement' | 'trade' | 'physicsActions';
const sfcBySubsystem: Record<SubsystemKey, number> = { ...initializeToZero };

// Helper (module-scoped or helper file):
function accountSubsystem<T>(
  subsystem: SubsystemKey,
  snapshot: () => number,  // returns current running system total
  block: () => T,
  sfcBySubsystem: Record<SubsystemKey, number>,
): T {
  const before = snapshot();
  const out = block();
  const after = snapshot();
  sfcBySubsystem[subsystem] += (after - before);
  return out;
}

// Each subsystem must NET to zero: banking loans issued = deposits created;
// wages paid = worker receives; escrow spending = escrow increase.
// Non-zero subsystem delta ≡ leak found in that subsystem.
```

Emit `sfcBySubsystem` into `TelemetryLog.sfcDriftBySubsystem` at telemetry construction site (`simulationRunner.ts:2592-2636`). Reset the accumulator at iteration start.

### Pattern 4: Inline Tax Withholding (D-14)

Each tax-bearing event already has a defined fiat-moving site. Pattern: **compute withheld amount, reduce agent credit by withheld, add to treasury, emit event to ledger AND to physics trace.**

```typescript
// At wage settlement (simulationRunner.ts:1432-1441 inside ownerAvailableWealth >= totalWageObligation branch):
for (const employment of workers) {
  const employeeState = weekStateMap.get(employment.employeeId);
  if (!employeeState) continue;
  const gross = employment.wage;
  const tax = computeWithholding(gross, economyConfig.taxPolicy, 'wage');
  const net = gross - tax;
  ownerState.wealthDelta -= gross;                    // employer debit unchanged (gross)
  employeeState.wealthDelta += net;                   // employee receives net
  sessionStateTreasury.set(sessionId,
    (sessionStateTreasury.get(sessionId) ?? 0) + tax);
  employeeState.events.push(`Received net wage ${net} (${tax} withheld) from ${enterpriseId}`);
}
```

Analogous sites:
- **PRODUCE_AND_SELL sell revenue:** `simulationRunner.ts:1393-1395` (sellerState.wealthDelta += executionPrice × quantity) — wrap in withholding.
- **AMM buy (VAT):** `simulationRunner.ts:1377-1380` (buyerState.wealthDelta -= executionPrice × quantity) — VAT is **added** to the buyer's cost beyond the AMM price. `(priceWithVat = price × (1 + vatRate))` then buyer pays `priceWithVat`, seller receives `price`, delta routes to treasury.
- **SELL_SHARES capital gain:** in `capitalMarketEngine.processShareSale` (`:155-`) — the engine returns a `wealthDeltas` map; extend to return `taxDeltas` OR wire tax in the runner just after `cmktDelta.wealthDeltas` application (`simulationRunner.ts:2260-2274`).
- **Matured bond payout:** same pattern — `capitalMarketEngine.processMaturities` (`:481-`) returns positive wealthDeltas for bond holders; tax applied in the runner before applying delta.

**Research recommendation:** Create a new helper `taxWithholding.ts` in `orchestration/helpers/` that exposes `computeWithholding(income, taxPolicy, kind)`. Keep the engine modules pure (delta-return pattern); the runner applies tax as a follow-on deduction. This keeps `capitalMarketEngine.ts` and `automatedMarketMaker.ts` untouched except at their callers.

### Pattern 5: Law-Amendment Paragraph Diff (D-18, D-19)

**Source:** `server/src/llm/centralAgent.ts:410-447` (refine-law diff-based branch)

```typescript
// Existing pattern for lawChanges.modify:
let currentLaw = session.law ?? '';
for (const m of lc.modify) {
  if (m.original && m.replacement && currentLaw.includes(m.original)) {
    currentLaw = currentLaw.replace(m.original, m.replacement);
    changed = true;
  } else {
    console.warn(`[refine] lawChanges.modify: could not find exact match for: "${m.original?.slice(0, 80)}..."`);
  }
}
```

**Reuse strategy for D-18:** Extract this block into a helper `applyParagraphDiff(law: string, oldParagraph: string, newParagraph: string): { law: string; applied: boolean }` living in a new file `server/src/orchestration/helpers/lawDiff.ts`. Both `centralAgent.ts` (for refine) and `governanceManager.ts` (for ratified `law_amendment` ballots) import it.

Add amendment history: new column or new row to an `amendment_history` table — planner decides. Simplest approach: JSON array on `session.config.lawAmendmentHistory` (append-only); no new table needed.

### Anti-Patterns to Avoid

- **Don't strip cortisol/happiness via additive deltas.** The current engine returns absolute values per action. A "nullifying layer" would still persist the old values in the trace log (`trace.push` calls literal strings) and confuse verification. **Edit the switch block directly.**
- **Don't instrument SFC per fiat-moving statement.** There are hundreds of `weekState.wealthDelta += ...` and `treasury - amount` sites. Subsystem-boundary accounting is coarser-grained and sufficient per D-20 ("diagnostic, NOT bug-hunt").
- **Don't couple taxPolicy to SessionPolicy.** `SessionPolicy` (`governanceManager.ts:38-45`) is the three-scalar policy (tax_rate, ubi_allocation, enforcement_level) used by the legacy demurrage tax and governance scalar amendments. D-13 `taxPolicy` is a separate config object with a different shape (kind + rates) and lives in `EconomyConfig`. Keep them distinct.
- **Don't auto-correct SFC drift.** D-23 explicitly forbids it. Record, warn, continue. Fix in next phase based on telemetry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Gini coefficient computation for inequality stress | A new Gini helper | `gini()` from `orchestration/helpers/statsUtils.ts` — already imported in the runner at line 106 | Already computed per tick as `giniCoefficient` (`simulationRunner.ts:2566`). Reuse the same value. |
| CPI surprise signal | New inflation-surprise calculation | `InflationOutput.inflationExpectations` vs `inflationRate` from `inflationEngine.computeInflation` | Both fields already exist on the output (`inflationEngine.ts:18-24`). Surprise = `inflationRate - inflationExpectations`. |
| Unemployment detection | New employment lookup | `employmentRegistry.has(agentId)` — `simulationRunner.ts:2492` already uses this pattern | Registry is per-session in-memory Map from `simulationState.ts`. Lookup is O(1). |
| Public goods quality access | Re-fetch from DB | `fiscalDelta.updatedPublicGoods` (post-fiscal-tick) persisted to `sessionFiscalMultipliers` | Already computed and cached per iteration for multiplier lookahead. |
| Peer-death count | New death event accumulator | `resolution.lifecycleEvents.filter(e => e.type === 'death').length` — pattern at `:2581-2583` | Lifecycle events already carry death type. No new plumbing needed. |
| Tax percentage application | New rate formula | Extend `fiscalEngine.computeIncomeTax` (`fiscalEngine.ts:39-55`) to accept a `taxPolicy` object | Pure function, tested, zero-import, delta-return pattern. |
| Branded session ID for repo calls | `string` everywhere | `createScope(sessionId)` + `SessionScope` type from `db/sessionScope.ts` | Compile-time safety; all repos already use it. |
| New hot-swappable constant singleton | Custom settings system | `physicsConfig` mutable object + `updatePhysicsConfig` | Existing pattern; exposed via `GET/PUT /api/settings/physics-config` automatically. |
| DB migration for new escrow columns | Drizzle migration framework | ALTER TABLE guard in `db/migrate.ts` | Phase 10 P10-fix-simulation-realism established "ALTER TABLE guard pattern for additive SQLite column additions (no migration runner)" (STATE.md). |

**Key insight:** Every single input needed by Phase 11's new behaviors already flows through the simulation loop. This is a **wiring phase**, not a computation phase. Resist the temptation to add new analytical modules.

## Runtime State Inventory

Phase 11 is **not a rename or migration phase** — it is a behaviour change. Runtime state implications are limited to:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | Existing sessions have `fiscal_budgets` rows with old budget shape (no escrow columns/table); existing `public_goods_state` rows still hold pre-escrow quality scores | **Additive only** — new escrow columns/table start at zero for existing sessions. Quality scores unchanged. Session re-bootstrap recommended for users wanting taxPolicy (D-13). |
| Live service config | None — no external services register Phase 11 state | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | `shared/dist/` compiled output must be regenerated when `shared/src/types.ts` changes (existing workspace build does this via `npm run build`) | Standard `npm run build` covers this |

**Existing-session migration note:** When D-17 `governanceEnabled` defaults to `true`, in-flight paused sessions that lack the field will implicitly opt in via `EconomyConfig` default merge (see STATE.md: "[Phase 10]: All 16 new EconomyConfig fields are optional with backward-compatible defaults"). Follow the same pattern for `taxPolicy`, `governanceEnabled`, `publicGoodsEscrow`.

## Detailed Findings by Focus Area

### 1. physicsEngine.ts Action-Code Delta Inventory (D-01, D-06)

Complete inventory of current deltas extracted from `physicsEngine.ts:161-498`:

| Action | w | h | hap | cor | **D-01 strip cor?** | **D-06 strip hap?** | Keep (outcome-driven)? |
|---|---|---|---|---|---|---|---|
| `WORK` | roleIncome × mults | −2 | −1 | **−3** | **YES — strip to 0** | **YES — strip to 0** | h=−2 kept (labor cost; structural) |
| `WORK_AT_ENTERPRISE` | 0 | −2 | −1 | **−3** | **YES — strip to 0** | **YES — strip to 0** | h=−2 kept |
| `REST` | 0 | +5 | **+2** | **−5** | **YES — strip to 0** | **YES — strip to 0** | h=+5 kept (physiological recovery) |
| `STRIKE` | 0 | 0 | +5 | +5 | NO (outcome) | NO (outcome) | Collective solidarity / confrontation — keep |
| `STEAL` | stolen | −5 | −3 | +10 | NO (outcome) | NO (outcome) | Keep entirely |
| `HELP` | −5 | 0 | +5 | **−5** | **YES — strip to 0** | NO (altruistic outcome) | hap=+5 retained |
| `INVEST` | −10 | 0 | −2 | +3 | NO (risk — outcome) | NO (outcome) | Keep (stake commitment stress) |
| `PRODUCE_AND_SELL` | 0 | −3 | **+1** | **−2** | **YES — strip to 0** | **YES — strip to 0** | h=−3 kept |
| `POST_BUY_ORDER` | 0 | 0 | **+1** | **−1** | **YES — strip to 0** | **YES — strip to 0** | No structural retention |
| `POST_SELL_ORDER` | 0 | 0 | **+1** | **−1** | **YES — strip to 0** | **YES — strip to 0** | — |
| `FOUND_ENTERPRISE` | 0 | −1 | +3 | +5 | NO (outcome) | NO (outcome) | Ambition + risk — keep |
| `POST_JOB_OFFER`, `HIRE_EMPLOYEE`, `FIRE_EMPLOYEE` | 0 | 0 | +2 | +2 | NO | NO | Management events — keep |
| `APPLY_FOR_JOB` | 0 | 0 | +1 | +1 | Borderline — keep (application anxiety outcome) | keep | — |
| `QUIT_JOB` | 0 | 0 | −1 | +4 | NO (outcome — unemployment uncertainty) | NO | Keep (test `edgeCases.test.ts:56` asserts cortisolDelta === 4) |
| `SABOTAGE` | 0 | −8 | +5 | +18 | NO | NO | Keep |
| `EMBEZZLE` | 0 | 0 | +2 | +20 | NO | NO | Keep |
| `ADJUST_TAX` | 0 | 0 | +3 | +5 | NO | NO | Keep |
| `SUPPRESS` | 0 | 0 | 4+scaled | +8 | NO | NO | Keep |
| `DEPOSIT` | 0 | 0 | **+1** | **−2** | **YES — strip to 0** | **YES — strip to 0** | — |
| `WITHDRAW` | 0 | 0 | 0 | +1 | NO (liquidity-need outcome) | NO | Keep |
| `TAKE_LOAN` | 0 | 0 | +2 | +5 | NO (debt obligation outcome) | NO | Keep |
| `REPAY_LOAN` | 0 | 0 | **+3** | **−3** | **YES — strip to 0** | **YES — strip to 0** | — |
| `ISSUE_LOAN` | 0 | 0 | +2 | +3 | NO (bank agent — excluded from D-02 anyway) | NO | Keep (irrelevant to citizen pool) |
| `SET_INTEREST_RATE`, `SET_RESERVE_RATIO`, `SET_BASE_RATE` | 0 | 0 | +1 | +2 | NO (bank/central only) | NO | Keep — institutional agents not subject to D-02 |
| `BUY_SHARES` | 0 | 0 | +1 | 0 | — | **YES — strip to 0** | — |
| `SELL_SHARES` | 0 | 0 | −1 | +1 | NO (exit anxiety outcome) | NO | Keep |
| `BUY_BOND` | 0 | 0 | **+1** | **−1** | **YES — strip to 0** | **YES — strip to 0** | — |
| `ISSUE_GOV_BOND` | 0 | 0 | 0 | **−2** | **YES — strip to 0** | — | — |
| `NONE` (idle, citizen) | 0 | −1 | −1 | +2 | NO (purposelessness outcome) | NO | Keep |

**Removal table summary (strips):**
- Cortisol relief to strip: **WORK, WORK_AT_ENTERPRISE, REST, PRODUCE_AND_SELL, POST_BUY_ORDER, POST_SELL_ORDER, HELP, DEPOSIT, REPAY_LOAN, BUY_BOND, ISSUE_GOV_BOND** — 11 actions.
- Happiness reward to strip: **REST, POST_BUY_ORDER, POST_SELL_ORDER, PRODUCE_AND_SELL, DEPOSIT, REPAY_LOAN, BUY_SHARES, BUY_BOND** — 8 actions.

**Test impact:**
- `edgeCases.test.ts:49-57` asserts `QUIT_JOB cortisolDelta === 4` — UNCHANGED (outcome-driven).
- `edgeCases.test.ts:39-47` asserts `QUIT_JOB happinessDelta === -1` — UNCHANGED.
- **No other test in `__tests__/`** directly asserts cortisol/happiness magnitudes on the stripped actions (grep returned zero matches for `cortisolDelta: -3` / `happinessDelta: +2` etc.). Strips are safe.
- Trace-string tests (e.g., `expect(traceText).toContain('productive relief')`) — search for literal "relief" / "decompression" / "bonding relief" / "obligation decreasing" in test files:

**Confidence:** HIGH — grep-verified; trace strings have no test assertions.

### 2. Structural Pressure Wiring Points (D-02, D-07)

| Signal | Source (already computed) | Injection Point | Cost |
|---|---|---|---|
| Inflation surprise | `InflationOutput.inflationRate - InflationOutput.inflationExpectations` — `inflationEngine.ts:18-24`, computed in runner at `:2410+` | Apply **after** inflation tick (`:2375-2475`), loop over `aliveAgents` and add to each agent's `weekState.cortisolDelta` / `.happinessDelta` | Zero new computation |
| Gini (bottom quintile) | `giniCoefficient` computed at `:2566` from `statUpdates.map(u => u.wealth)`; bottom quintile = sort wealth asc, take first 20% | Apply **after** Gini computed (late in tick); must run before final stat commit at `:1820`. **Or** restructure so pressures are applied alongside fiscal tick before telemetry. | Small — one sort + slice |
| Unemployment / precarity | `!employmentRegistry.has(agent.id) && agent.wealth < threshold` — pattern at `:2492` | Same loop as above | O(n) |
| Underfunded public goods | `fiscalDelta.updatedPublicGoods.{infrastructureQuality, educationQuality, welfareQuality}` from `:2343` | Same loop as above; `min(infra, edu, welfare) / 50` formula | Trivial |
| Peer deaths | `resolution.lifecycleEvents.filter(e => e.type === 'death').length` — pattern at `:2581-2583` | Apply in same pressure loop; broadcast to **all** alive citizens equally (not just bottom quintile) | Trivial |

**Recommended injection order** (planner's discretion per CONTEXT.md but this research recommends):

```text
[physics action resolution loop] → weekState.{cortisolDelta, happinessDelta} accumulated per action
[fiscal tick]         → fiscalDelta.updatedPublicGoods available
[inflation tick]      → inflationOutput.{inflationRate, inflationExpectations} available
[NEW: structural pressure injection loop]
   for each alive citizen (excluding bank, central_bank):
     weekState.cortisolDelta += k_inflation_cor × max(0, surprise)
     weekState.cortisolDelta += inBottomQuintile ? k_gini_cor × max(0, Gini - threshold) : 0
     weekState.cortisolDelta += (isUnemployed && lowWealth) ? k_unemp_cor : 0
     weekState.cortisolDelta += k_pg_cor × (1 - min(infra, edu, welfare) / 50)
     weekState.happinessDelta -= k_peer_death_hap × deathsThisIter
     ...same pattern for hap...
[final stat commit loop at :1812+]  → apply clamps with new ceiling=95, floor=3 (cortisol),
                                        ceiling=95, floor=5 (happiness)
[telemetry construction]
```

This places pressures **after** all inputs exist but **before** stat commit, matching the "deltas accumulate, then commit" convention of the rest of the runner.

**Confidence:** HIGH — every signal already flows through the runner; no new DB reads needed.

### 3. Fiscal Escrow Architecture (D-10, D-11)

**Current behavior** (`fiscalEngine.ts:371-395`):
```typescript
const paymentPerAgent = totalSpending / agentCount;
welfarePerAgent = welfareSpend / agentCount;
for (const agentId of aliveAgentIds) {
  agentPayments.set(agentId, paymentPerAgent);    // ALL spending to agents
}
```

**Target behavior per D-10:** Only welfare distributes; infra/edu/def go to escrow.

**Escrow persistence — three options, planner picks:**

| Option | Pros | Cons |
|---|---|---|
| **A. New dedicated columns on `sessions` table**: `publicGoodsEscrowInfra`, `publicGoodsEscrowEdu`, `publicGoodsEscrowDef` | Simplest; one row per session; ALTER TABLE pattern established (STATE.md Phase 10) | Columns on session row that many non-fiscal queries touch; adds schema noise |
| **B. New `public_goods_escrow` table** (sessionId, category, balance, updatedAt) | Clean separation; matches `fiscal_budgets` / `public_goods_state` pattern | Extra migration; extra repo; 3 rows per session |
| **C. In-memory `sessionPublicGoodsEscrow: Map<sessionId, {infra, edu, def}>` + AMM-style snapshot to `session.config.publicGoodsEscrow`** | No schema change; follows `sessionStateTreasury` pattern (`simulationRunner.ts` — treasury is in-memory per-session map, persisted via AMM snapshot JSON) | Still requires config JSON persistence; restart-recovery from `session.config` |

**Research recommendation:** **Option C** (in-memory + session.config snapshot). Matches the existing `sessionStateTreasury` pattern — treasury is already held as a per-session in-memory map, initialized from `session.config.treasury` on resume, and snapshotted into `ammSnapshotValues.snapshotData` at `:2800`. Escrow fits the same mold. Zero schema changes. Restart-safe.

**`fiscalEngine.executeBudget` signature change:**

```typescript
// NEW return shape:
export interface FiscalDelta {
  treasuryDelta: number;                           // same
  agentPayments: Map<string, number>;              // now ONLY welfare portion (SFC-neutral for welfare)
  escrowDeltas: {                                  // NEW — infra/edu/def go here
    infrastructure: number;
    education: number;
    defense: number;
  };
  updatedPublicGoods: ...;                         // same (quality scores)
  multiplierEffects: MultiplierEffects;            // UNCHANGED — quality scores still drive multipliers
  categorySpending: ...;                           // same (telemetry)
  trace: string[];
}
```

**SFC verification:**
- Before: `treasuryDelta + sum(agentPayments) = 0`
- After: `treasuryDelta + sum(agentPayments) + sum(escrowDeltas) = 0` ⟺ `M0 constant`
- `computeSystemFiatTotal(..., publicGoodsEscrow)` includes the escrow sum.

**Multiplier pathway:** UNCHANGED. `getMultiplierEffects` depends only on `publicGoods` quality scores and `economyConfig` multipliers — spending mode (escrow vs transfer) has no effect on quality or on downstream `productivityBonus` / `skillGainBonus` / `enforcementBonus`. Verified by reading `fiscalEngine.ts:153-181`.

**Existing "government-held fiat" precedent:** YES — `sessionStateTreasury` is modeled identically. `collateralEscrow` in SFC audit is another (banking-side) parallel. Escrow is a third instance of the same pattern.

**Confidence:** HIGH

### 4. Tax-Withholding Hook Points (D-12, D-14)

Per-event hook site inventory:

| Taxable Event | File | Line Range | Current Behavior | Withholding Placement |
|---|---|---|---|---|
| **WORK income** (standalone) | `simulationRunner.ts` | 1252-1265 | Physics `w = roleIncome` added to `weekState.wealthDelta`; treasury already debited (D1 fix, Phase 10) | Already treasury-backed. Apply tax **reduction to `weekState.wealthDelta`** here. Net: employee receives `w - tax`, treasury retains `tax` (instead of debiting the full `w`). **Note:** `computeIncomeTax` function exists but is NOT wired in. D-32 was partially landed. |
| **Enterprise wage** | `simulationRunner.ts` | 1432-1441 (solvent) and 1464-1493 (bankruptcy partial pay) | `ownerState.wealthDelta -= wage; employeeState.wealthDelta += wage;` | Employee-side deduction: `employeeState.wealthDelta += wage - tax`; `sessionStateTreasury += tax` |
| **PRODUCE_AND_SELL AMM sell** | `simulationRunner.ts` | 1393-1395 | `sellerState.wealthDelta += executionPrice × qty` | `sellerState.wealthDelta += (price × qty) - tax`; `sessionStateTreasury += tax` |
| **AMM buy (VAT)** | `simulationRunner.ts` | 1377-1380 | `buyerState.wealthDelta -= executionPrice × qty` | VAT ADDED on top: `buyerState.wealthDelta -= price × qty × (1 + vatRate)`; `sessionStateTreasury += price × qty × vatRate`. Seller unchanged. |
| **SELL_SHARES profit** | `capitalMarketEngine.ts` | 155- (`processShareSale`) invoked from runner at `:2224+` | Returns `wealthDeltas` map with positive proceeds for seller | Tax applied in runner at `:2271-2274` when `cmktDelta.wealthDeltas` are applied. Extend `CmktDelta` with `taxCollected: number` OR wrap the wealth-delta-application loop with a withholding step. |
| **Matured bond payout** | `capitalMarketEngine.ts` | 481- (`processMaturities`) | Returns positive wealthDeltas for bond holders | Same as SELL_SHARES — withhold at runner-side application. |
| **Bond coupon income** | `capitalMarketEngine.ts` | 422- (`processCoupons`) | Returns positive wealthDeltas | Optional — D-12 says "matured bond payouts"; coupons are recurring income. Research recommendation: **include coupons** for symmetry with wage income; CONTEXT.md phrasing covers "capital gains" broadly. Planner should confirm. |
| **Dividend income** | `capitalMarketEngine.distributeDividends` | called in processIteration | Positive wealthDelta for shareholder | Not explicitly in D-12. Research recommendation: **include for symmetry**; exclude only if planner confirms CONTEXT.md scope. |

**`enterpriseActionDispatch.ts` involvement:** Only tangentially — it dispatches enterprise-scoped intents (hire, fire, wage change). Wage **payment** happens in the runner post-intent-resolution. Tax hooks live in the runner, not the dispatcher.

**Recommended helper:**
```typescript
// server/src/orchestration/helpers/taxWithholding.ts
export type TaxKind = 'flat' | 'progressive';
export interface TaxPolicy {
  kind: TaxKind;
  rates: {
    income: number;                // flat: single rate; progressive: top-bracket marginal
    vat: number;                   // AMM buy consumption tax
    capitalGains: number;          // SELL_SHARES, matured bonds
    // progressive only:
    brackets?: Array<{ upto: number; rate: number }>;
  };
}
export function computeWithholding(
  income: number,
  kind: 'wage' | 'amm_sell' | 'vat' | 'capital_gains',
  policy: TaxPolicy,
): number { /* ... */ }
```

**Traceability preservation (D-14):** Each withholding emits a physics trace entry like `[TAX] Withheld 1.20 fiat (8%) from wage 15.00 at enterprise ent_X` via `appendTrace(sessionId, ...)`. Preserves per-action SFC traceability.

**Confidence:** HIGH — every hook site located and validated.

### 5. Central Agent taxPolicy Generation (D-13)

**Current design-time config generation paths:**

| Mode | Entry Point | taxPolicy Injection |
|---|---|---|
| **Location bootstrap** | `server/src/data/dataBootstrapPipeline.ts:profileToEconomyConfig` | Add `taxPolicy` to returned `Partial<EconomyConfig>`. Derive from WB data: `profile.fiscal.taxRevenuePctGdp` (if available) → choose `kind: 'progressive'` if country has high GDP per capita + high gov expense; else `flat`. Specific rates: flat = 0.10-0.20 scaled from lending rate; progressive brackets derive from Gini + GDP tier. |
| **Creative mode** | `server/src/llm/centralAgent.ts` design generation | Extend the design-generation JSON schema in `server/src/llm/prompts/central-agent.ts` (or the relevant prompt module — see MODULE_MAP M3 / CLAUDE.md `prompts.ts` is the single source of truth but has been split per Phase 9 into `prompts/*.ts`). Ask the Central Agent to output `taxPolicy: { kind, rates }` alongside `budgetAllocation` and `law`. |

**Schema addition in `shared/src/types.ts`:**
```typescript
export interface TaxPolicy {
  kind: 'flat' | 'progressive';
  rates: {
    income: number;          // wage + AMM sell
    vat: number;             // AMM buy
    capitalGains: number;    // SELL_SHARES + matured bonds
  };
  // progressive only:
  brackets?: Array<{ upto: number; rate: number }>;
}
// EconomyConfig addition:
taxPolicy?: TaxPolicy;       // D-13
```

**DEFAULT_ECONOMY_CONFIG** gets `taxPolicy: { kind: 'flat', rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 } }` — matches Phase 10 D-32 default (`incomeTaxRate: 0.15`).

**Validation/clamping:**
- `kind ∈ {'flat', 'progressive'}` else default to `'flat'`.
- `rates.*` each clamped to `[0, 0.5]`.
- If `kind === 'progressive'`, `brackets` must be non-empty and strictly increasing in `upto`; else fall back to `flat`.
- Place validator in `economyConfigUtils.ts` alongside existing `getEconomyConfig`.

**DesignReview UI surface:**
- `web/src/components/EconomyTab.tsx` already renders flag toggles (`bankingEnabled`, `fiscalEnabled`, etc.) and scalar fields. Add a new "Tax Policy" section with radio selector (flat/progressive) and numeric inputs per rate. Show `DataConfidenceBadge` when source is `api` or `llm`.

**Backward compat:** Optional field on `EconomyConfig` → existing sessions default to `flat @ 15%`. Matches STATE.md Phase 10 convention.

**Confidence:** HIGH — design generation path well understood; LLM schema extension follows Phase 9 patterns.

### 6. Bootstrap fiscal_budgets Bug Investigation (D-15)

**Facts:**
- `bootstrap.ts:540` unconditionally calls `fiscalRepo.createBudget(createScope(id), budget)` when `finalConfig.fiscalEnabled` is true.
- `fiscalRepo.createBudget` (`fiscalRepo.ts:200-212`) generates a UUID and calls `upsertBudget` which does INSERT or UPDATE on `fiscal_budgets`.
- `upsertBudget` (`fiscalRepo.ts:50-88`) checks for existing row; if none, INSERTs. Pure sync call.
- `sessions.ts:399, :482, :573` also call `createBudget` for (a) non-bootstrap session creation, (b) fork, (c) fork-simulation.
- `simulate.ts:54` calls `db.delete(fiscalBudgets).where(eq(fiscalBudgets.sessionId, sessionId)).run()` during **abort-reset**.

**Candidate root causes — ordered by likelihood:**

1. **Abort-reset wipes budgets; user hits abort-reset then starts fresh simulation without re-bootstrapping.** Most likely cause per `simulate.ts:54`. **Fix**: during abort-reset, if `fiscalEnabled`, re-create from `session.config.budgetAllocation`. OR: startup assertion forces user to re-bootstrap.
2. **Direct `POST /api/sessions` (not bootstrap) with `fiscalEnabled: true` but no `budgetAllocation` in body.** `sessions.ts:399` only calls `createBudget` if `body.budgetAllocation` is present. If user creates session directly with `fiscalEnabled=true` but omits budget, no row is created.
3. **Race condition: bootstrap throws between schema-level creation and row insertion.** The bootstrap block at `:530-541` wraps agent deletes and re-inserts in a transaction, but `fiscalRepo.createBudget` is OUTSIDE that transaction. An exception in the enterprise creation loop (`:553-555`) after `createBudget` succeeds would NOT roll back fiscal_budgets — so this is the OPPOSITE direction (fiscal row persists but other state is missing). Low likelihood.
4. **Session created before Phase 3** (when fiscal_budgets didn't exist) and later `fiscalEnabled` flipped to true via `PUT /:id/config`. `routes/sessions.ts` `PUT /config` does NOT call `createBudget`. **Likely**. Fix: in `PUT /config` handler, if `fiscalEnabled` flips true and no budget row exists, create one from payload's `budgetAllocation` or reject.
5. **FK constraint on sessions / transaction rollback suppressing INSERT.** Unlikely — `upsertBudget` runs without wrapper; errors would throw.

**Startup assertion (D-15) — recommended placement:**

```typescript
// server/src/orchestration/simulationLifecycle.ts (or simulationRunner.ts near iteration start)
if (economyConfig.fiscalEnabled) {
  const budget = fiscalRepo.getActiveBudget(scope);
  if (!budget) {
    throw new Error(
      `[FISCAL] Session ${sessionId} has fiscalEnabled=true but no fiscal_budgets row. ` +
      `This indicates either (a) an abort-reset wiped the budget and bootstrap was not re-run, ` +
      `(b) fiscalEnabled was flipped via PUT /config without providing budgetAllocation, or ` +
      `(c) a bootstrap regression. Re-bootstrap the session or set budgetAllocation via PUT /config.`
    );
  }
}
```

Throws before the first iteration runs. SSE broadcaster should catch this and surface to the UI — pattern established by bootstrap error handling per Phase 10 D-28.

**NO silent fallback to `DEFAULT_BUDGET_ALLOCATION`** per D-15 explicit instruction. Existing `fiscalRepo.getActiveBudget(scope) ?? DEFAULT_BUDGET_ALLOCATION` fallback at `:601` and `:2316` of `simulationRunner.ts` must be removed when `fiscalEnabled=true` (the assertion handles it upstream).

**Test impact:** `fiscal.test.ts` tests `executeBudget` with explicit allocations — unaffected. `scenarioEntry.test.ts` creates sessions via test helpers — needs a helper update to always call `createBudget` when `fiscalEnabled`.

**Confidence:** MEDIUM (root cause #1 and #4 are plausible but unconfirmed without reproduction); assertion fix is HIGH confidence regardless.

### 7. Governance Toggle (D-17) + Law Amendment (D-18)

**Toggle (D-17):**

- Site: `simulationRunner.ts:2835` — `if (iterNum % 5 === 0 && aliveAgents.length >= 2)`.
- Change to: `if (iterNum % 5 === 0 && aliveAgents.length >= 2 && (economyConfig.governanceEnabled !== false))`.
- Default: `governanceEnabled: true` in `DEFAULT_ECONOMY_CONFIG`.
- UI: checkbox in `EconomyTab.tsx` alongside existing `bankingEnabled`/`fiscalEnabled` flags (`EconomyTab.tsx:393-400` shows the pattern).

**Law amendment (D-18):**

- Ballot schema extension: `GovernanceBallotItem` currently has `{ field, proposedValue, description, impactForecast? }` where `field: 'tax_rate' | 'ubi_allocation' | 'enforcement_level'`.
- Add discriminator:
  ```typescript
  // shared/src/types.ts or server-local types
  export type GovernanceBallotItem =
    | { kind: 'policy'; field: 'tax_rate' | 'ubi_allocation' | 'enforcement_level';
        proposedValue: number; description: string; impactForecast?: string }
    | { kind: 'law_amendment'; oldParagraph: string; newParagraph: string;
        description: string; impactForecast?: string };
  ```
- In `governanceManager.ts:183-215` (ballot synthesis), allow the LLM to emit either shape. Parsing loop must filter by `kind` (or infer from which keys are present).
- In `governanceManager.ts:242-257` (ratification loop), add:
  ```typescript
  if (item.kind === 'law_amendment') {
    const { law: newLaw, applied } = applyParagraphDiff(session.law ?? '',
      item.oldParagraph, item.newParagraph);
    if (applied) {
      await sessionRepo.updateLaw(sessionId, newLaw);
      amendmentHistory.push({ iteration: iterNum, old: item.oldParagraph,
        new: item.newParagraph, description: item.description });
      ratifiedItems.push(item);
    } else {
      console.warn(`[GOVERNANCE] Law amendment not applied: oldParagraph not found verbatim`);
      rejectedItems.push(item);
    }
  }
  ```

**Amendment history persistence:**

- Simplest: append to `session.config.lawAmendmentHistory: Array<{iteration, old, new, description}>`.
- No new table.
- Exposed via standard `session.config` JSON serialization.

**Proposal prompt (D-18):** extend `buildProposalPrompt` in `prompts/governance.ts` to mention law-amendment as an allowed proposal kind. Example directive:

> "Politicians may propose one of: (a) a scalar policy change (tax_rate, ubi_allocation, enforcement_level), OR (b) a law_amendment proposing to replace a specific paragraph in the existing law text with new wording. Law amendments must specify the exact existing paragraph verbatim. Use law amendments for governance innovations that scalars cannot capture (e.g., changing franchise rules, property rights)."

Return JSON structure extended to optionally include `{ kind: 'law_amendment', oldParagraph, newParagraph, ... }`.

**`refineLawDocument` sharing:** Extract the paragraph-diff logic from `centralAgent.ts:420-429` into `orchestration/helpers/lawDiff.ts`. Both refine path and governance path import it.

**Confidence:** HIGH

### 8. SFC Per-Subsystem Telemetry (D-20, D-21)

**Unit definition:** A subsystem's per-iteration delta = `(totalFiatAfter - totalFiatBefore)` where both measurements include all agents + AMMs + treasury + deposits + collateral + escrow. Within a single iteration, the ORDER of subsystem ticks means:

```
[before banking]   → snapshot_A
[banking tick]
[after banking]    → snapshot_B       →  sfcBySubsystem.banking = B - A   (should = 0)
[capital market tick]
[after cmkt]       → snapshot_C       →  sfcBySubsystem.capmkt  = C - B   (should = 0)
[fiscal tick]
[after fiscal]     → snapshot_D       →  sfcBySubsystem.fiscal  = D - C   (should = 0)
[inflation feedback on AMM]           →  sfcBySubsystem.inflation (merged with AMM feedback)
... etc.
```

**Important:** Physics action resolution runs at the START of the iteration (before banking) and captures trade execution, wage settlement, enforcement seizures, etc. Trade/AMM, enforcement, and physicsActions are **sub-subsystems** within the same resolution block. Separating them requires finer-grained snapshotting.

**Recommended snapshot sites in `simulationRunner.ts`:**

1. Start of iteration (physicsActions-preceding)
2. After trade execution loop (`:1397`)
3. After wage settlement (`:1550`)
4. After enforcement seizures (handled inline with physics; bundle with physicsActions)
5. After banking tick (`:2204`)
6. After capital market tick (`:2307`)
7. After fiscal tick (`:2373`) — includes escrow flow
8. After inflation tick (`:2475`) — includes AMM feedback adjustment

**TelemetryLog additions:**

```typescript
// shared/src/types.ts
export interface TelemetryLog {
  // ... existing
  sfcDrift?: number;                                   // iteration total drift (= sum of subsystem drifts)
  sfcDriftBySubsystem?: {
    physicsActions: number;
    trade: number;
    enforcement: number;
    banking: number;
    capmkt: number;
    fiscal: number;                                    // includes escrow flow
  };
}
```

**Relation to existing `sfcPrevTotalFiat` drift check at `:2640-2647`:** That check already computes `sfcDrift = totalFiatSupply - sfcPrevTotalFiat`. Keep it as the TOP-LEVEL drift (`sfcDrift`). Subsystem drifts DECOMPOSE the top-level drift: `sfcDrift === sum(subsystem drifts)`.

**Relation to `appendTrace(sessionId, content)` physics trace log:** Independent. Trace log is prose for LLM narrative; `sfcDriftBySubsystem` is numeric telemetry. Don't conflate. Optionally, emit a trace line `[SFC] fiscal subsystem drift: +0.0003` when drift is non-trivial but sub-threshold.

**Warning/telemetry emission (D-23):**
```typescript
if (Math.abs(sfcDrift) > 0.1) {
  console.error(`[SFC] iter=${iterNum} total drift=${sfcDrift.toFixed(4)}`);
  for (const [subsys, delta] of Object.entries(sfcBySubsystem)) {
    if (Math.abs(delta) > 0.1) {
      console.error(`[SFC]   ${subsys}: ${delta > 0 ? '+' : ''}${delta.toFixed(4)}`);
    }
  }
}
// Record to telemetry unconditionally:
iterTelemetry.sfcDrift = sfcDrift;
iterTelemetry.sfcDriftBySubsystem = { ...sfcBySubsystem };
```

No auto-correction. No pause.

**Confidence:** HIGH

### 9. Tests and SFC Test Suite Impact

| Test File | Touches Cortisol/Happiness? | Touches Escrow/Tax? | Phase 11 Impact |
|---|---|---|---|
| `sfcBanking.test.ts` | No | No | **Must still pass** — banking SFC invariant unchanged. Subsystem drift should always be 0. |
| `sfcCapitalMarkets.test.ts` | No | Yes (SELL_SHARES tax adds new flow) | UPDATE — SFC includes tax-to-treasury on sale. Treasury delta symmetric. |
| `sfcInflation.test.ts` | No | No | **Must still pass** — inflation is a price-level change, not a fiat flow. |
| `sfcFiscal.test.ts` | No | Yes — escrow changes the SFC arithmetic | UPDATE — spending split: welfare → agents, other three → escrow. `computeSystemFiatTotal` includes escrow. |
| `sfcInvariant.test.ts` (16-scenario suite) | No | Yes (any scenario with fiscalEnabled + taxation) | UPDATE — extend scenarios to exercise escrow + tax withholding paths. |
| `sfc-unrounded.test.ts` | No | Indirect | Likely still passes; verify. |
| `banking.test.ts` (24) | No | No | **Unchanged.** |
| `capitalMarket.test.ts` (20) | No | Indirect (tax happens at runner, not engine) | **Unchanged** (engine signatures don't include tax). Tax lives in runner hooks. |
| `fiscal.test.ts` (18) | No | Yes — `executeBudget` signature change | UPDATE — assertions on agentPayments must split between welfare-only agent transfers and escrow deltas. `computeIncomeTax` tests unchanged. |
| `inflationEngine.test.ts` (11) | No | No | **Unchanged.** |
| `edgeCases.test.ts` | **YES — `QUIT_JOB cortisolDelta=4, happinessDelta=-1`** | No | **Unchanged** — QUIT_JOB is outcome-driven; keep values. Grep confirmed no other cortisol/happiness magnitude assertions. |
| `enterpriseEngine.test.ts` | No | Indirect (wage tax at runner) | **Unchanged.** |
| `economyConfig.test.ts` (16) | No | No (adds validation for new fields) | UPDATE — tests for new `taxPolicy`, `governanceEnabled`, `publicGoodsEscrow` validation. |
| `scenarioEntry.test.ts` | No | Indirect | Verify new config flags serialize; probably passes unchanged. |

**New Phase 11 test files required:**
- `server/src/mechanics/__tests__/structuralPressures.test.ts` — unit tests for each of the 4 cortisol + 5 happiness pressures (pure function tests).
- `server/src/__tests__/sfcEscrow.test.ts` — end-to-end: fiscal tick with escrow, assert `M0 = M0_initial`, assert escrow monotonically grows, assert quality scores still update.
- `server/src/__tests__/sfcTaxation.test.ts` — integration: wage payment with withholding, AMM buy with VAT, SELL_SHARES with capital gains tax. Assert `M0` constant, treasury grows by sum of tax withheld.
- `server/src/orchestration/__tests__/governanceAmendment.test.ts` — law amendment diff applies when exact match; rejected when no match; history persists.
- `server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts` — per-subsystem drift == 0 across a 5-iteration run. Forces a manual leak; verifies it shows up in the correct subsystem field.

**Confidence:** HIGH — grep-validated test dependencies.

### 10. Calibration Seed Values (D-05, D-09)

**Anchoring context:**
- Per-action deltas in the current engine are typically ±1 to ±10 per action, with extremes at STEAL (+10), SABOTAGE (+18), EMBEZZLE (+20).
- Allostatic engine equilibrium: `Strain_eq = Cortisol × 6.67`, elasticity limit 80 → equilibrium cortisol of ~12 keeps strain just at the irreversible-load boundary.
- Desired behavior: structural pressures produce **measurable daily fluctuation** (visible on charts, driving narrative) but **not instant saturation** (ceiling 95 reached in <5 iterations).
- With 4 cortisol pressures, max combined per-tick cortisol pressure should land at ≈ 6-10 when all triggers fire simultaneously in a bad society, and ≈ 0.5-2 in a baseline society.
- Current per-action penalty range for WORK is `cor = -3`; removing it saves ~3 cortisol/tick for working agents. Net zero is the target: pressures should replace relief with an average magnitude comparable to what was stripped (≈ 3/tick).

**Recommended conservative seed values for `physicsConfig.ts`:**

```typescript
// ── Structural pressures — cortisol (D-02) ──
k_inflation_cor: 0.3,             // inflation surprise in % × 0.3; e.g., 5% surprise → +1.5 cortisol
k_gini_cor: 8.0,                  // max(0, Gini - threshold) × 8; Gini=0.5 vs threshold=0.35 → +1.2 cortisol
giniStressThreshold: 0.35,        // above this, inequality stress kicks in for bottom quintile
k_unemp_cor: 3.0,                 // fixed +3 cortisol/tick when unemployed + low wealth
k_pg_cor: 2.0,                    // max ~2 when min(quality)/50 = 0; scales down as quality rises

// Sum when all pressures fire in a terrible society:
// 0.3 × 10%surprise + 8 × 0.3giniExcess + 3 + 2 × 1.0 = 3 + 2.4 + 3 + 2 = 10.4 cortisol/tick
// → dangerous but not instant-death (ceiling 95 reached in ~9 iterations of chronic misery)

// ── Structural pressures — happiness (D-07) ──
k_peer_death_hap: 2.0,            // 2 deaths in one tick → -4 happiness
k_gini_hap: 6.0,                  // Gini=0.5 vs threshold → -0.9 happiness for bottom quintile
k_unemp_hap: 2.5,                 // unemployed + low wealth → -2.5 happiness/tick
k_welfare_hap: 2.5,               // max 2.5 when welfareQuality=0; 0 when quality=50
k_inflation_hap: 0.25,            // 5% surprise → -1.25 happiness

// Max combined when bad: 2 × 2deaths + 6 × 0.15gini + 2.5 + 2.5 × 1.0 + 0.25 × 10 = 4 + 0.9 + 2.5 + 2.5 + 2.5 = ~12
// → floor (5) reached in ~8 iterations of chronic bad

// ── Ceiling / floor ──
cortisolCeiling: 95,
cortisolFloor: 3,
happinessCeiling: 95,
happinessFloor: 5,

// ── Raised auto-escalation thresholds (D-04) ──
lowWealthThreshold: 50,           // was 20
lowHealthThreshold: 60,           // was 30
```

**Calibration philosophy (D-05, D-09):** These are **conservative seeds**, not literature-grounded. Post-Phase-11 empirical observation informs tuning. Expect a second pass based on `Results/session-united-states.json` comparison.

**Confidence:** MEDIUM — arithmetic is sound but "conservative" is subjective. Planner may choose lower values (halve all k_*) for first rollout to avoid over-compression. The settings-endpoint hot-swap pattern allows in-simulation tuning.

## Common Pitfalls

### Pitfall 1: Stripping trace strings accidentally
**What goes wrong:** Removing `trace.push('...decompression')` along with the delta, breaking debugger UI / Lab view.
**Why:** The `trace` array is also consumed by the Physics Laboratory frontend (`web/src/pages/PhysicsLaboratory.tsx`).
**How to avoid:** Keep trace.push lines, but change them to describe the structural model: `trace.push('Δcortisol: 0 (per-action relief removed; structural pressures apply at tick end)')`.

### Pitfall 2: Applying structural pressures to bank agents
**What goes wrong:** Bank agents inherit structural cortisol → their wealth stops moving → SFC checks fail silently due to reserves decoupling.
**Why:** `aliveAgents` includes bank agents; the pressure loop must filter them.
**How to avoid:** `for (const agent of aliveAgents.filter(a => a.type !== 'bank' && a.role?.toLowerCase() !== 'central_bank'))` — matches existing exclusion at `simulationRunner.ts:2775` (`computeStats(agents.filter(a => a.type !== 'bank'))`).

### Pitfall 3: Escrow double-counted or excluded from M0
**What goes wrong:** Add escrow ledger but forget to include it in `computeSystemFiatTotal` → M0 shows a phantom drop each iteration.
**Why:** SFC audit sums all fiat holders. Missing one creates a false leak.
**How to avoid:** (a) extend `computeSystemFiatTotal` signature with `publicGoodsEscrow` parameter, (b) update **all** 4 call sites in runner (`:471, :2398, :2548, :2741`), (c) add test asserting `M0 = M0_init` after fiscal tick with escrow.

### Pitfall 4: Tax withholding creates fiat when applied to gross after it's already credited
**What goes wrong:** `employeeState.wealthDelta += wage; ... employeeState.wealthDelta -= tax; treasury += tax;` is safe IF they compile into the same delta. But `ownerState.wealthDelta -= wage;` (the employer side) is already gross. Net effect: `wage - tax` to employee, `tax` to treasury, `wage` from employer. Zero-sum OK.
BUT if the second-pass tax deduction is placed outside the weekState loop (e.g., in a separate pass over statUpdates) and the code re-reads `agent.currentStats.wealth`, the deduction silently destroys fiat.
**How to avoid:** Apply all tax deductions **inline** at the same site as the gross credit, in the same weekState delta. Never split across passes.

### Pitfall 5: `economyConfig.governanceEnabled !== false` vs `=== true`
**What goes wrong:** Using `if (economyConfig.governanceEnabled)` evaluates undefined (older sessions) as falsy → governance disappears on backward-compat sessions.
**Why:** Phase 10 precedent "All 16 new EconomyConfig fields are optional with backward-compatible defaults".
**How to avoid:** `(economyConfig.governanceEnabled !== false)` — undefined defaults to enabled.

### Pitfall 6: Law amendment exact-match fragility
**What goes wrong:** LLM proposes `oldParagraph` with an extra trailing space or smart quote; `String.prototype.includes` returns false; amendment silently rejected.
**How to avoid:** Normalize whitespace and smart quotes before matching: `oldParagraph.trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')`. Log rejection reason prominently. Optionally: fuzzy-match fallback (substring containment after normalization).

### Pitfall 7: SFC subsystem snapshots taken while weekState deltas are pending
**What goes wrong:** `sessionStateTreasury.get()` reflects treasury state AFTER a write, but individual agent wealth updates are still pending in `statUpdates[]` or `weekStateMap` — snapshot under-reports real fiat total.
**How to avoid:** When snapshotting for subsystem SFC, use `computeSystemFiatTotal(agents, ..., wealthOverrides=finalWealthByAgentId)` after each tick with current `statUpdates` folded in. The runner already does this at `:2547-2556` for the main telemetry computation. Reuse the same pattern at each subsystem boundary.

### Pitfall 8: Ratified law_amendment affects LLM context mid-iteration
**What goes wrong:** Law amendment applied at iteration N, but the resolution prompt for iteration N has already been assembled with the old law.
**How to avoid:** Apply amendment effects starting iteration N+1. Governance cycle runs AFTER resolution at `:2834` — amendment persists for next tick. Matches existing pattern for scalar policy changes.

## Code Examples

### Example 1: Structural Pressure Loop

```typescript
// server/src/orchestration/simulationRunner.ts — NEW block after inflation tick (~line 2475)
// Source: research.md §2
if (inflationOutput) {
  const surprise = Math.max(0, inflationOutput.inflationRate - inflationOutput.inflationExpectations);
  const giniExcess = Math.max(0, giniCoefficient - physicsConfig.giniStressThreshold);
  const deathsThisTick = resolution.lifecycleEvents?.filter(e => e.type === 'death').length ?? 0;

  const sortedWealth = [...statUpdates].sort((a, b) => a.wealth - b.wealth);
  const bottomQuintileCutoff = sortedWealth[Math.floor(sortedWealth.length * 0.2)]?.wealth ?? 0;

  const pg = fiscalPublicGoodsQuality;
  const pgPressure = pg
    ? (1 - Math.min(pg.infrastructureQuality, pg.educationQuality, pg.welfareQuality) / 50)
    : 1;

  for (const agent of aliveAgents) {
    if (agent.type === 'bank' || agent.role?.toLowerCase() === 'central_bank') continue;
    const weekState = weekStateMap.get(agent.id);
    if (!weekState) continue;

    const isBottomQuintile = agent.currentStats.wealth <= bottomQuintileCutoff;
    const isUnemployed = !employmentRegistry.has(agent.id);
    const lowWealth = agent.currentStats.wealth < physicsConfig.lowWealthThreshold;

    // Cortisol pressures (D-02)
    weekState.cortisolDelta += physicsConfig.k_inflation_cor * surprise;
    if (isBottomQuintile) weekState.cortisolDelta += physicsConfig.k_gini_cor * giniExcess;
    if (isUnemployed && lowWealth) weekState.cortisolDelta += physicsConfig.k_unemp_cor;
    weekState.cortisolDelta += physicsConfig.k_pg_cor * pgPressure;

    // Happiness pressures (D-07)
    weekState.happinessDelta -= physicsConfig.k_peer_death_hap * deathsThisTick;
    if (isBottomQuintile) weekState.happinessDelta -= physicsConfig.k_gini_hap * giniExcess;
    if (isUnemployed && lowWealth) weekState.happinessDelta -= physicsConfig.k_unemp_hap;
    if (pg) weekState.happinessDelta -= physicsConfig.k_welfare_hap * (1 - pg.welfareQuality / 50);
    weekState.happinessDelta -= physicsConfig.k_inflation_hap * surprise;
  }
}
```

### Example 2: Escrow-aware executeBudget

```typescript
// server/src/mechanics/fiscalEngine.ts — UPDATED signature
export interface FiscalDelta {
  treasuryDelta: number;
  agentPayments: Map<string, number>;          // now ONLY welfare portion
  escrowDeltas: { infrastructure: number; education: number; defense: number };
  updatedPublicGoods: Omit<PublicGoodsState, 'id' | 'sessionId'>;
  multiplierEffects: MultiplierEffects;
  categorySpending: ...;
  trace: string[];
}

// In executeBudget:
let welfarePerAgent = 0;
if (agentCount > 0) {
  welfarePerAgent = welfareSpend / agentCount;           // only welfare distributes
  for (const agentId of aliveAgentIds) {
    agentPayments.set(agentId, welfarePerAgent);
  }
}

// Escrow — infra/edu/def parked in public-goods escrow (SFC-neutral)
const escrowDeltas = {
  infrastructure: infraSpend,
  education: educSpend,
  defense: defSpend,
};

// Treasury debit = ALL spending (welfare → agents + infra/edu/def → escrow)
// Conservation: treasuryDelta + sum(agentPayments) + sum(escrowDeltas) = 0
const treasuryDelta = -totalSpending;
```

### Example 3: SFC Subsystem Accounting

```typescript
// server/src/orchestration/simulationRunner.ts — wrap each subsystem tick
// Source: research.md §8

const snapshotTotal = () => computeSystemFiatTotal(
  agents, sessionAMMRegistry.get(sessionId), sessionMultiAMMRegistry.get(sessionId),
  sessionStateTreasury.get(sessionId) ?? 0,
  new Map(statUpdates.map(u => [u.id, u.wealth])),
  bankingRepo.getTotalDeposits(scope),
  bankingRepo.getTotalCollateral(scope),
  getTotalEscrow(sessionId),                    // NEW for Phase 11
);

const sfcBySubsystem: Record<SubsystemKey, number> = {
  physicsActions: 0, trade: 0, enforcement: 0,
  banking: 0, capmkt: 0, fiscal: 0,
};

// at the START of iteration
let sfcCheckpoint = snapshotTotal();

// after banking tick:
let afterBanking = snapshotTotal();
sfcBySubsystem.banking = afterBanking - sfcCheckpoint;
sfcCheckpoint = afterBanking;

// repeat for capmkt, fiscal, ...

// Emit into telemetry
iterTelemetry.sfcDrift = afterFinal - baselineFiat;
iterTelemetry.sfcDriftBySubsystem = { ...sfcBySubsystem };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Per-action cortisol/happiness deltas mixed with outcome rewards | Outcome-driven only; structural pressures layered separately | Phase 11 | Removes asymmetric bias toward agent improvement |
| `totalSpending / agentCount` to all agents | Welfare → agents; infra/edu/def → escrow | Phase 11 | Preserves SFC without destroying spending-effect mechanics |
| Tax collected only on WORK income (partially implemented; function exists, not wired) | Tax collected on wages, AMM sells, AMM buys (VAT), SELL_SHARES, bond maturities | Phase 11 | Closes fiscal loop; makes treasury sustainable |
| Scalar-only ballot items (tax_rate, ubi_allocation, enforcement_level) | Scalar + law_amendment ballot discriminator | Phase 11 | Emergent governance can evolve institutional rules, not just numbers |
| Single top-level SFC drift warning | Per-subsystem drift breakdown in telemetry | Phase 11 | Users can localize leaks during policy A/B comparison |

**Deprecated/outdated:**
- Legacy cortisol-relief design (D-01): rewarded actions for being executed at all, produced utopia bias documented in `Results/session-united-states.json`.
- `DEFAULT_BUDGET_ALLOCATION` silent fallback when `fiscal_budgets` row missing: deceptive because it masked the bootstrap bug (D-15).

## Open Questions

1. **Escrow persistence choice (schema vs column vs in-memory).**
   - What we know: three viable patterns exist (new table, columns on sessions, in-memory + config snapshot).
   - What's unclear: user preference (schema impact vs retrieval speed).
   - Recommendation: default to **in-memory map + `session.config.publicGoodsEscrow` snapshot** (matches `sessionStateTreasury` pattern). Raise for planner confirmation.

2. **Progressive tax bracket structure for design-stage generation (D-13).**
   - What we know: CONTEXT.md says "flat | progressive" with "rates: {...}".
   - What's unclear: exact bracket schema. Single rate + top-marginal? Or full piecewise with N brackets?
   - Recommendation: Plan for **max 3 brackets** (low/mid/high by wealth percentile). Keeps LLM generation simple. Planner to confirm.

3. **Dividend and bond-coupon income taxation scope.**
   - What we know: D-12 explicitly lists "profit on SELL_SHARES, matured bond payouts" but NOT coupons or dividends.
   - What's unclear: is coupon income taxable for symmetry or out of scope?
   - Recommendation: ask planner. Research leans **include** both for symmetry; structural consistency matters more than CONTEXT.md's finite list.

4. **Structural pressure application frequency for bank/central agents.**
   - What we know: D-02 says "every alive citizen agent (not bank/central)".
   - What's unclear: what about `citizenAgents` that have `role === 'central_bank'` but `type === 'citizen'`? `simulationRunner.ts:486` treats institutional agents as any `type === 'bank' OR role IN [bank, central_bank]`.
   - Recommendation: use the same filter: `type !== 'bank' && !['bank','central_bank'].includes(role.toLowerCase())`.

5. **Law amendment rate-limiting.**
   - What we know: governance runs every 5 iterations. An amendment changes session.law text.
   - What's unclear: if 4 consecutive governance cycles each ratify amendments, law text churns rapidly — LLM narrative consistency may suffer.
   - Recommendation: no rate-limit this phase; defer to empirical observation. Raise in post-phase review if churn is a problem.

## Environment Availability

Phase 11 is a code-only change. Probe for required tooling:

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js + npm | Build / run | Available (existing monorepo) | v20+ | — |
| `better-sqlite3` | Repos | Installed | existing | — |
| `vitest` | Tests | Installed | existing | — |
| LLM provider keys (at least one) | Central Agent design generation (D-13), governance prompts (D-18) | Environmental (`~/.policylab/config.json`) | user-configured | Tests can mock provider |

**No missing dependencies.** Phase 11 is pure engine/types/tests.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest (existing per `server/package.json`) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run server/src/mechanics/__tests__/structuralPressures.test.ts -x` |
| Full suite command | `npm run test -w server` |

### Phase Requirements → Test Map

Decisions map to automated tests as follows (requirements derived from CONTEXT.md since no REQ-IDs assigned):

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| D-01 | WORK/REST/HELP/DEPOSIT/etc. cortisol delta == 0 | unit | `npx vitest run server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts -x` | ❌ Wave 0 |
| D-02 | Structural cortisol pressures apply to citizens only; not to bank agents | unit | `npx vitest run server/src/mechanics/__tests__/structuralPressures.test.ts -x` | ❌ Wave 0 |
| D-03 | Cortisol clamped to [3, 95] at final stat commit | unit | `npx vitest run server/src/orchestration/__tests__/statClamping.test.ts -x` | ❌ Wave 0 |
| D-04 | lowWealthThreshold / lowHealthThreshold raised | unit | `npx vitest run server/src/mechanics/__tests__/physicsConfig.thresholds.test.ts -x` | ❌ Wave 0 |
| D-05 | Coefficients present in physicsConfig DEFAULTS; updatable | unit | same as D-02 / D-04 | — |
| D-06 | WORK/REST/HELP/DEPOSIT/BUY_BOND happiness delta == 0 | unit | `npx vitest run server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts -x` | ❌ Wave 0 |
| D-07 | Structural happiness pressures apply | unit | same file as D-02 | — |
| D-08 | Happiness clamped to [5, 95] | unit | same as D-03 | — |
| D-09 | Coefficients present | unit | — | — |
| D-10, D-11 | Escrow ledger grows with infra/edu/def spending; welfare distributes to agents; M0 constant | integration | `npx vitest run server/src/__tests__/sfcEscrow.test.ts -x` | ❌ Wave 0 |
| D-12, D-14 | Tax withheld at each hook site; treasury receives tax; SFC intact | integration | `npx vitest run server/src/__tests__/sfcTaxation.test.ts -x` | ❌ Wave 0 |
| D-13 | Central Agent output schema includes taxPolicy; validation clamps invalid values | unit | `npx vitest run server/src/llm/__tests__/centralAgentTaxPolicy.test.ts -x` | ❌ Wave 0 |
| D-15 | Missing fiscal_budgets row on fiscalEnabled=true throws at simulation start | integration | `npx vitest run server/src/__tests__/fiscalBudgetAssertion.test.ts -x` | ❌ Wave 0 |
| D-17 | runGovernanceCycle skipped when governanceEnabled=false | integration | `npx vitest run server/src/orchestration/__tests__/governanceToggle.test.ts -x` | ❌ Wave 0 |
| D-18 | law_amendment ballot applies paragraph diff; rejects when oldParagraph not found; history persists | integration | `npx vitest run server/src/orchestration/__tests__/governanceAmendment.test.ts -x` | ❌ Wave 0 |
| D-19 | paragraph-level only — no JSON schema validation | tested via D-18 | — | — |
| D-20, D-21 | sfcDriftBySubsystem field populated in TelemetryLog each iteration; subsystem sums equal top-level sfcDrift | integration | `npx vitest run server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts -x` | ❌ Wave 0 |
| D-22 | Threshold unchanged — verify absolute |drift| > 0.1 triggers console.error | unit | same as D-20 | — |
| D-23 | No auto-correction — after drift detected, simulation continues; drift recorded to TelemetryLog | integration | same as D-20 | — |

### Sampling Rate
- **Per task commit:** `npx vitest run server/src/mechanics/__tests__/<affected-file>.test.ts -x`
- **Per wave merge:** `npm run test -w server`
- **Phase gate:** Full suite green + manual smoke run of `POST /api/sessions/:id/bootstrap` + 5-iteration simulation on United States profile; compare cortisol/wealth trajectories to `Results/session-united-states.json` (expect non-monotonic curves).

### Wave 0 Gaps
- [ ] `server/src/mechanics/__tests__/physicsEngine.cortisolStrip.test.ts` — covers D-01
- [ ] `server/src/mechanics/__tests__/physicsEngine.happinessStrip.test.ts` — covers D-06
- [ ] `server/src/mechanics/__tests__/structuralPressures.test.ts` — covers D-02, D-07
- [ ] `server/src/mechanics/__tests__/physicsConfig.thresholds.test.ts` — covers D-03, D-04, D-08
- [ ] `server/src/__tests__/sfcEscrow.test.ts` — covers D-10, D-11
- [ ] `server/src/__tests__/sfcTaxation.test.ts` — covers D-12, D-14
- [ ] `server/src/llm/__tests__/centralAgentTaxPolicy.test.ts` — covers D-13
- [ ] `server/src/__tests__/fiscalBudgetAssertion.test.ts` — covers D-15
- [ ] `server/src/orchestration/__tests__/governanceToggle.test.ts` — covers D-17
- [ ] `server/src/orchestration/__tests__/governanceAmendment.test.ts` — covers D-18
- [ ] `server/src/orchestration/__tests__/sfcSubsystemDrift.test.ts` — covers D-20, D-21, D-22, D-23
- [ ] `server/src/orchestration/__tests__/statClamping.test.ts` — covers D-03, D-08
- [ ] Shared test helpers: agent fixture factories already exist in `physics_sandbox.ts`; reuse.

No framework install required — vitest is present.

## Sources

### Primary (HIGH confidence)
- `server/src/mechanics/physicsEngine.ts:161-498` — action delta inventory (read directly)
- `server/src/mechanics/physicsConfig.ts:73-127` — hot-swap pattern (read directly)
- `server/src/mechanics/fiscalEngine.ts:39-428` — executeBudget + computeIncomeTax (read directly)
- `server/src/orchestration/helpers/sfcAudit.ts` — SFC accounting extension point (read directly)
- `server/src/orchestration/simulationRunner.ts:1100-2900` — all subsystem ticks, tax hook sites (read directly)
- `server/src/orchestration/governanceManager.ts:38-294` — ballot schema, ratification flow (read directly)
- `server/src/llm/centralAgent.ts:410-447` — paragraph-diff pattern (read directly)
- `server/src/routes/bootstrap.ts:538-541` — fiscalRepo.createBudget invocation (read directly)
- `server/src/db/repos/fiscalRepo.ts:50-212` — upsertBudget / createBudget implementation (read directly)
- `shared/src/types.ts:243-720` — TelemetryLog, EconomyConfig, DEFAULT_ECONOMY_CONFIG (read directly)
- `.planning/phases/10-*/10-CONTEXT.md` — Phase 10 D-31/D-32 continuity (read directly)
- `.planning/STATE.md` — accumulated decisions + Phase 10 calibration history (read directly)
- `MODULE_MAP.md` §M1, M7 — engine + orchestration boundaries (read directly)
- `CLAUDE.md` — project conventions (read directly)

### Secondary (MEDIUM confidence)
- Phase 10 tax implementation status — inferred from `grep computeIncomeTax` → zero callers (grep-verified)
- Bootstrap D-15 root-cause candidates — inferred from cross-file call-site analysis (`simulate.ts:54` abort-reset, `sessions.ts` fork paths) — not reproduced with a failing session

### Tertiary (LOW confidence) — flagged for validation
- Calibration seed values in §Calibration Seed Values — derived arithmetically from existing delta magnitudes and allostatic thresholds, NOT empirically measured. Expect tuning post-Phase-11.
- Specific bracket structure for `progressive` taxPolicy — inferred; planner should confirm

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all patterns already present in codebase; zero new libraries.
- Architecture: HIGH — every delta, hook site, and subsystem boundary located and read.
- Pitfalls: HIGH — derived from Phase 10 STATE.md + direct code reading.
- Calibration values: MEDIUM — arithmetically plausible, empirically unvalidated.
- Bootstrap D-15 root cause: MEDIUM — assertion fix is HIGH confidence; diagnosis is candidate-list only.

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days; stable codebase, no external dependencies)
