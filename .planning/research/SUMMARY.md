# Project Research Summary

**Project:** Ideal World — Real Economy Engine (fractional reserve banking, capital markets, fiscal policy, inflation)
**Domain:** Agent-based macroeconomic simulation with LLM-driven cognition and deterministic SFC enforcement
**Researched:** 2026-04-01
**Confidence:** HIGH (stack, architecture, SFC accounting), MEDIUM (fiscal multiplier values, LLM behavioral adaptation)

## Executive Summary

This milestone adds a full real-economy engine to an existing LLM-powered multi-agent simulation that already has AMM commodity markets, an order book, enterprise hiring/production, UBI/demurrage cycles, and three-lever governance. The new systems — fractional reserve banking, equity and bond capital markets, fiscal budget categories, and endogenous inflation — layer cleanly onto the existing Neuro-Symbolic architecture without replacing any current infrastructure. The recommended approach follows academic ABM-SFC models (closest to Godley-Lavoie for accounting rigor and ABBA for agent heterogeneity) and is achievable with zero new server-side runtime dependencies; the only new package is `recharts ^3.8.1` for economic dashboards.

The critical design constraint throughout is Stock-Flow Consistency (SFC): every new financial instrument must preserve M0 (base money) as a constant, and all M1/M2 expansion through lending must be fully traceable on bank balance sheets. The biggest risk in this milestone is subtle SFC drift introduced by treating fractional reserve banking as simple wealth transfers. All four new mechanical sub-engines (banking, capital markets, fiscal, inflation) must be built in strict dependency order: banking first (it underpins M1 measurement), then capital markets, then fiscal, then the inflation feedback loop. Each phase has a clear SFC gate before the next phase begins.

The implementation approach is conservative on scope: the ten P1 features (banking, loans/defaults, M1/M2 tracking, equity, government bonds, fiscal categories, CPI, inflation feedback, and agent cognition injection) form a coherent, internally consistent milestone. Four features (corporate bonds, central bank as active agent, term deposits, persistent public goods quality) are validated P2 additions once the core loop is working. Bank run mechanics and derivatives are explicitly deferred to v2+.

## Key Findings

### Recommended Stack

The existing stack handles every new requirement without any server-side additions. All financial math — bond pricing, CPI Laspeyres index, money multiplier, Fisher equation, dividend yield — is plain TypeScript arithmetic that has been documented in STACK.md and requires no library. The `distributeProRata` utility already in `shared/src/math.ts` handles pro-rata distribution with integer rounding for dividends and coupon payments. The `asyncLogFlusher` pattern must be extended to batch all per-iteration banking writes to avoid SQLite lock contention.

**Core technologies:**
- `recharts ^3.8.1` (web only): React 19-compatible composable chart library for CPI, M1/M2, bond yield, and fiscal budget dashboards — the only new dependency this milestone
- `drizzle-orm ^0.41.0` (existing): handles all new table migrations via the established `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` pattern in `migrate.ts`
- `better-sqlite3` (existing): synchronous SQLite sufficient for all new financial mechanics; no Redis or external cache needed
- Inline TypeScript arithmetic (no `decimal.js`/`big.js`): IEEE 754 with `Math.round` at settlement boundaries is consistent with the existing codebase and adequate for 20–150 agent simulations

**What not to add:** QuantLib/WASM (3-line bond pricing formula suffices), decimal.js (type boundary friction with no precision benefit at this scale), any separate financial microservice (contradicts local-first architecture), or d3/visx (recharts composable API is sufficient for standard time-series dashboards).

### Expected Features

**Must have (P1 — table stakes for a "real economy engine"):**
- Bank agent role with deposit accounts and reserve requirement enforcement — establishes fractional reserve banking as an institution
- LEND action with loan contracts (principal, rate, term) + repayment + default/bankruptcy — enables endogenous money creation with consequences
- M1/M2 money supply tracking per iteration — makes banking measurable and provides inflation input
- Enterprise equity: share issuance, ownership registry, dividend distribution — gives enterprise ownership meaning beyond narrative
- Government bonds: issuance, coupon, maturity, holder ledger — enables fiscal deficit financing without immediate taxation
- Fiscal budget categories (3–4): spending allocation via governance vote + per-category effects on simulation stats — makes fiscal policy an active lever
- CPI calculation from existing market price data (Laspeyres index, food/tools/luxury/raw materials basket) — enables inflation measurement
- Money supply → price level feedback into AMM prices — makes inflation emergent, not narrative-only
- Inflation expectations injected into citizen agent prompt context — enables behavioral response (wage demands, hoarding, accelerated purchases)

**Should have (P2 — after v1 core validated):**
- Corporate bonds (enterprise debt issuance) — reuses government bond schema; enables leveraged enterprise growth and boom/bust cycles
- Central bank as active policy agent — observes CPI and M1; adjusts reserve requirement and discount rate; enables monetary policy experiments
- Savings accounts / term deposits — distinguishes M1 from M2; enables yield curve emergence
- Public goods quality as persistent state — compound investment dynamics; "investment vs. austerity" policy experiments

**Defer (v2+):**
- Bank run cascade mechanics — requires agent trust/communication layer not yet designed
- Wage-price spiral telemetry flag — emerges from v1 features; add detection after behavioral patterns are observable
- Full derivatives market — incompatible with discrete-iteration ABM; anti-feature

### Architecture Approach

All four new sub-engines (`bankingEngine.ts`, `capitalMarketEngine.ts`, `fiscalEngine.ts`, `inflationEngine.ts`) are inserted into the existing simulation loop's Resolution phase exactly as the AMM and order book were added. They follow the established pattern: pure deterministic functions, no LLM calls, no direct DB access, return wealth deltas plus a trace array. The SFC audit runs once at the end of each iteration after all sub-engine deltas are merged — never mid-iteration. The governance cycle is extended by one proposal type (`budget_allocation`) rather than a new cycle. A new `macro_snapshots` table captures M0/M1/M2/CPI/inflation per iteration for charting via the existing SSE telemetry stream.

**Major components:**
1. `bankingEngine.ts` — loan issuance/repayment/default, reserve enforcement, interest accrual, bank balance sheet management; anchors the M0/M1 split
2. `capitalMarketEngine.ts` — share purchase/sale, bond issuance/coupon/maturity, dividend distribution; all SFC-balanced peer-to-peer and treasury-to-agent transfers
3. `fiscalEngine.ts` — budget execution per iteration, multiplier effects on agent stats, public goods quality tracking; reads approved budget from `session.config`
4. `inflationEngine.ts` — CPI basket computation, money supply ratio signal, blended inflation rate, 3-iteration EMA smoothing for expectations; reads `marketPrices` table (already populated)
5. Four new repos (`bankingRepo`, `capitalMarketRepo`, `fiscalRepo`, `macroSnapshotRepo`) — isolated query logic per system, parallel to existing `economyRepo`/`iterationRepo` pattern
6. Extended SFC audit in `simulationRunner.ts` — replaces single-number invariant with M0/M1/M2 three-layer assertion

**7 new database tables:** `bank_balance_sheets`, `loan_contracts`, `deposit_accounts`, `equity_positions`, `bond_holdings`, `fiscal_budget`, `public_goods_state`, `macro_snapshots`

**Key integration modifications** (existing files changed): `actionCodes.ts` (+10 action codes), `physicsEngine.ts` (new resolution cases + public goods multipliers), `simulationRunner.ts` (4 new sub-engine calls + extended SFC audit), `governanceManager.ts` (+`budget_allocation` proposal type), `prompts.ts` (inflation context + bank agent prompts + budget proposal builder), `schema.ts` + `migrate.ts` (7 new tables), `shared/src/types.ts` (8 new financial instrument types).

### Critical Pitfalls

The full PITFALLS.md enumerates 10 critical pitfalls and 10 integration gotchas. The five most likely to cause irrecoverable simulation corruption are:

1. **Treating loan issuance as a wealth transfer instead of balance sheet expansion** — The simplest loan implementation (`bank.wealth -= amount; borrower.wealth += amount`) conserves total fiat but produces no M1 expansion and defeats the purpose of banking. The correct model: `bank.loanAssets += principal; bank.depositLiabilities += principal; borrower.depositBalance += principal`. M0 unchanged, M1 expands. Design the M0/M1 split before writing any banking code.

2. **Running `computeSystemFiatTotal` before including all new fiat locations** — Each new financial instrument (bank reserves, deposit accounts, bond escrow, enterprise equity pools) introduces a new fiat pocket. Extending `computeSystemFiatTotal` must be the first task of every feature that adds a new location — not bookkeeping after the fact. A mid-implementation window where the audit silently passes while fiat leaks will mask bugs that compound across phases.

3. **Bond issuance treated as money creation** — Implementing `treasury += faceValue` without `buyer.wealth -= faceValue` silently mints fiat. Primary bond issuance is an asset swap: the buyer's cash becomes a bond asset; the treasury receives cash and records a bond liability. Central bank bond purchases (QE) are the only path where M0 legitimately expands — and must be explicitly tracked as such.

4. **Inflation implemented as pure narrative with no physics-layer hooks** — CPI injected into agent prompts without a corresponding physics parameter change (AMM price floor, wage delta modifier, or allostatic cost adjustment) produces LLM agents that narrate "wage demands" and "hoarding" while the simulation's actual wealth dynamics are unchanged. Define physics-layer hooks before any prompt injection.

5. **Per-action banking writes inside the resolution hot loop** — Writing a loan record or updating a deposit balance for each of 50 agents per iteration creates 50 individual DB writes inside the tight loop, causing SQLITE_BUSY lock contention with the asyncLogFlusher. Collect all banking deltas in memory during resolution; flush in a single batch transaction at the end of the iteration.

## Implications for Roadmap

Based on the feature dependency chain and architecture build order confirmed by research, the milestone has a clear four-phase dependency structure. Each phase has an SFC gate before the next phase begins.

### Phase 1: Banking Foundation
**Rationale:** M1/M2 tracking is meaningless without real loan creation; CPI and inflation require M1 data; capital markets pricing is more credible when agents can borrow. Banking is the foundation every other system depends on.
**Delivers:** Bank agent role, deposit accounts, LEND/REPAY/DEFAULT action codes, reserve enforcement, bank balance sheet tracking, M0/M1 SFC audit extension, 3 new DB tables (`loan_contracts`, `deposit_accounts`, `bank_balance_sheets`).
**Addresses:** "Bank agent + deposit accounts + reserve requirement" (P1), "LEND action + loan contract + repayment" (P1), "Default + bankruptcy mechanics" (P1), "M1/M2 money supply tracking" (P1).
**Avoids:** Pitfalls 1–4 (M0/M1 invariant, loan repayment accounting, interest SFC drift, bank agent perimeter gap). Must be the first code written.
**Gate:** SFC audit passes for 10 consecutive iterations with a bank agent present; M1 expands correctly on loan issuance, contracts on repayment/default.

### Phase 2: Capital Markets
**Rationale:** Enterprise equity and government bonds share bond instrument schema; build government bonds first to establish the pattern, then extend to corporate. Equity dividends reuse `distributeProRata` already proven in the banking phase.
**Delivers:** Share issuance/trading, equity ownership registry, government bond issuance/coupon/maturity, bond holder ledger, dividend distribution, 2 new DB tables (`equity_positions`, `bond_holdings`).
**Addresses:** "Enterprise equity + dividends" (P1), "Government bonds" (P1).
**Avoids:** Pitfall 5 (bond issuance money creation), Pitfall 6 (dividend/coupon fiat creation), integration gotcha: equity mark-to-market as wealth delta vs. realized gains only.
**Gate:** Share prices and dividend payouts SFC-consistent; bond coupon payments clear correctly from treasury; `Σ buyer.wealth` decreases by exactly `Σ treasury proceeds` on bond issuance.

### Phase 3: Fiscal Budget
**Rationale:** Fiscal multipliers require physics-layer hooks in `physicsEngine.ts`; those hooks are simpler to add before the inflation loop reads them. Fiscal spending effects (skill multiplier, health regen bonus, welfare UBI supplement) are independent of CPI and can be tested without inflation data.
**Delivers:** Budget allocation governance proposal type, `fiscalEngine.ts` per-iteration spending execution, public goods quality state, 2 new DB tables (`fiscal_budget`, `public_goods_state`), governance manager extension.
**Addresses:** "Fiscal budget categories (3–4)" (P1), groundwork for "public goods quality as persistent state" (P2).
**Avoids:** Pitfall 9 (fiscal multiplier applied before revenue collected — treasury debit before multiplier is enforced), Anti-Pattern 5 (fiscal execution logic kept in `fiscalEngine`, not `governanceManager`).
**Gate:** Treasury never negative after budget execution; public goods quality decays without spending; multiplier effects are per-iteration re-application, not permanent stat accumulation.

### Phase 4: Inflation Loop
**Rationale:** All data sources are now in place: `marketPrices` (iteration 1+), M1/M2 from banking phase, fiscal spending patterns from fiscal phase. Inflation is the synthesis layer that ties monetary expansion to real price dynamics.
**Delivers:** CPI Laspeyres basket calculation, M1 growth signal, blended inflation rate, 3-iteration EMA expectation smoothing, agent cognition injection, AMM price-level feedback, `macro_snapshots` DB table.
**Addresses:** "CPI calculation" (P1), "Money supply → price level feedback" (P1), "Inflation expectations in agent cognition" (P1).
**Avoids:** Pitfall 7 (inflation as pure narrative — physics hooks must exist before prompt injection), technical debt: CPI must be computed from actual transaction prices not AMM spot price alone, smoothed over 3–5 iterations.
**Gate:** CPI > threshold produces a measurable change in at least one physics parameter; wage-price spiral can emerge within a 50-iteration test session.

### Phase 5: Economic Dashboard (Frontend)
**Rationale:** Charts require all four backend systems to be producing data. Single frontend phase after all engines are stable avoids iterating on charts against incomplete data.
**Delivers:** Four recharts panels (CPI line chart, M1/M2 area chart, fiscal budget bar chart, bond yield line chart), `economicMetrics` field in SSE iteration event, `simulationStore` accumulation of per-iteration macro snapshots.
**Addresses:** UX pitfalls (M0/M1 separation in UI, nominal vs. real wealth display, bank stress event surfacing, CPI smoothed trend visualization).
**Uses:** `recharts ^3.8.1` (sole new production dependency), existing SSE stream infrastructure.

### Phase Ordering Rationale

- Banking must precede all other phases because M1 data is a required input for capital markets pricing, CPI calculation, and the inflation feedback loop.
- Capital markets precede fiscal because government bonds are a key fiscal financing instrument and the bond schema must exist before the fiscal engine can issue deficit-financing bonds.
- Fiscal precedes inflation because public goods multipliers (which affect productivity) are part of the "real GDP proxy" used by the inflation engine to distinguish demand-pull from cost-push inflation.
- The frontend dashboard is last because it consumes all four data streams and benefits from being built against stable, complete data rather than incrementally alongside each engine.
- The SFC audit extension (`computeSystemFiatTotal` with M0/M1/M2 layers) is a precondition for Phase 1, not a phase itself — it must be the first code change made.

### Research Flags

Phases likely needing `/gsd:research-phase` during planning:
- **Phase 1 (Banking Foundation):** Bank run cascade resolution mechanics, central bank emergency liquidity path, and the exact data structure for separating `agent.wealth` cash-on-hand from `depositBalance` require careful design before coding. The academic SFC literature is clear on accounting rules but the translation to the existing `agentRepo`/`physicsEngine` patterns needs deliberate mapping.
- **Phase 3 (Fiscal Budget):** Fiscal multiplier magnitudes (infrastructure → productivity, education → skill gain, welfare → UBI supplement) need calibration against the existing simulation's parameter ranges. The values matter for playability — too small and fiscal policy feels inert; too large and it dominates other dynamics.
- **Phase 4 (Inflation Loop):** The CPI basket weights (food 40%, tools 25%, luxury 20%, raw materials 15%) and the blending coefficient between CPI-inflation and M1-growth signals (0.6/0.4 suggested in ARCHITECTURE.md) are initial estimates that may need tuning against observed simulation dynamics.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Capital Markets):** Equity and bond mechanics are well-documented in ABM-SFC literature; the data structures are fully specified in ARCHITECTURE.md; `distributeProRata` handles all pro-rata distributions. Standard implementation work.
- **Phase 5 (Dashboard):** recharts composable API with standard line/area/bar chart types; data flows via existing SSE stream; no novel integration challenges.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero server-side dependency changes; recharts React 19 compatibility confirmed via GitHub issue tracking; all financial math formulas documented and verified as plain arithmetic |
| Features | HIGH (P1 list), MEDIUM (P2 list) | P1 features are derived from foundational ABM-SFC models (Godley-Lavoie, ABBA, Threadneedle); P2 features are extensions with less direct academic precedent for LLM integration |
| Architecture | HIGH (structure), MEDIUM (novel interactions) | Build order and component boundaries confirmed by direct codebase analysis; novel interactions (LLM cognition + inflation feedback, HMAS map-reduce + bank agents) have no direct precedent to validate against |
| Pitfalls | HIGH (SFC/banking accounting), MEDIUM (LLM integration specifics) | SFC accounting pitfalls are grounded in peer-reviewed SFC modeling literature; LLM behavioral pitfalls are extrapolated from EconAgent (ACL 2024) with medium source confidence |

**Overall confidence:** HIGH for the engineering approach; MEDIUM for the emergent simulation dynamics (whether the wage-price spiral, boom/bust cycles, and policy experiments will produce interesting behavior requires empirical testing in the simulation itself).

### Gaps to Address

- **LLM behavioral calibration for inflation:** How strongly LLM agents respond to an inflation signal depends on the prompt framing and the model's economic reasoning. The research identifies the injection mechanism but cannot predict whether agents will exhibit realistic wage-demand behavior without empirical testing in a live simulation session. Treat this as a tuning task during Phase 4.
- **Fiscal multiplier magnitudes:** The ARCHITECTURE.md suggests multiplier values (e.g., `0.0–2.0` quality score ranges), but calibrating these to produce meaningful (but not simulation-dominating) effects requires testing against the existing agent wealth and productivity parameter ranges. Flag for design review during Phase 3 planning.
- **M1 expansion rate bounds:** At what loan volume does M1 expansion create observable inflation? With 20–50 agents, the money multiplier effect may be too small to generate interesting dynamics without tuning reserve ratios and loan term defaults. This is a calibration gap, not an architectural one.
- **Session import/export coverage:** All new tables containing agent ID references (`loan_contracts`, `deposit_accounts`, `equity_positions`, `bond_holdings`) must be added to the `SessionExport` schema and `remapSnapshotAgentIds`. This is noted in PITFALLS.md but the exact implementation details of the export remapping for financial instruments have not been fully designed.

## Sources

### Primary (HIGH confidence)
- Codebase analysis of `simulationRunner.ts`, `physicsEngine.ts`, `automatedMarketMaker.ts`, `governanceManager.ts`, `schema.ts`, `actionCodes.ts` — direct architecture validation
- [Money Creation under Full-reserve Banking: A Stock-flow Consistent Analysis (Levy Institute WP-851)](https://www.levyinstitute.org/pubs/wp_851.pdf) — M0/M1 accounting rules
- [Fiscal Policy in a Stock-Flow Consistent (SFC) Model — Levy Institute](https://www.levyinstitute.org/publications/fiscal-policy-in-a-stock-flow-consistent-sfc-model/) — fiscal multiplier accounting
- [DIY Macroeconomic Model Simulation: SFC Model of the Monetary Circuit](https://macrosimulation.org/an_sfc_model) — balance sheet accounting rules
- [Fractional-reserve banking — Wikipedia](https://en.wikipedia.org/wiki/Fractional-reserve_banking) — reserve ratio / money multiplier formulas
- [BLS CPI Calculation Handbook](https://www.bls.gov/opub/hom/cpi/calculation.htm) — Laspeyres index formula
- [recharts npm — version 3.8.1, React 19 compatibility](https://www.npmjs.com/package/recharts)

### Secondary (MEDIUM confidence)
- [Agent Based-Stock Flow Consistent Macroeconomics: Towards a Benchmark Model](https://sfc-models.net/publications/articles/agent-based-stock-flow-consistent-macroeconomics-towards-a-benchmark-model/) — benchmark model design
- [ABBA: An Agent-Based Model of the Banking System (IMF WP/17/136)](https://www.imf.org/-/media/Files/Publications/WP/2017/wp17136.ashx) — bank agent balance sheet patterns
- [EconAgent: LLM-Empowered Agents for Simulating Macroeconomic Activities (ACL 2024)](https://aclanthology.org/2024.acl-long.829.pdf) — LLM macro-simulation pitfalls, inflation expectations
- [Agent-Based Simulation of a Financial Market with Large Language Models (2024)](https://arxiv.org/pdf/2510.12189) — LLM agents + deterministic market engine architecture
- [Stock-Flow Consistent Macroeconomic Models: A Survey (Levy Institute WP 891)](https://www.levyinstitute.org/pubs/wp_891.pdf) — SFC invariant extension approach
- [Fiscal Multipliers in Agent-Based Models (IDEAS/RepEc 2025)](https://ideas.repec.org/p/ssa/lemwps/2025-10.html) — multiplier values reference
- [On the Instability of Fractional Reserve Banking (ScienceDirect 2025)](https://www.sciencedirect.com/science/article/abs/pii/S0014292125001618) — reserve ratio instability thresholds
- [Recharts GitHub — React 19 support issue #4558](https://github.com/recharts/recharts/issues/4558) — version compatibility

### Tertiary (LOW confidence)
- LLM behavioral adaptation to inflation signals in an ABM context — extrapolated from EconAgent paper; requires empirical validation in live simulation sessions
- Optimal fiscal multiplier magnitudes for 20–150 agent simulations — no direct precedent found; requires calibration during Phase 3

---
*Research completed: 2026-04-01*
*Ready for roadmap: yes*
