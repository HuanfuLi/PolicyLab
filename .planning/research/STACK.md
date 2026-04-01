# Stack Research

**Domain:** Agent-based macroeconomic simulation — fractional reserve banking, capital markets, fiscal budgets, inflation
**Researched:** 2026-04-01
**Confidence:** HIGH (core stack), MEDIUM (charting), HIGH (no new server libs needed)

---

## Executive Summary

The existing stack (better-sqlite3, Drizzle ORM, Express, TypeScript, React 19, Zustand) handles every new requirement without swapping out any infrastructure. This milestone adds zero new server-side runtime dependencies. All financial math (bond pricing, CPI, money multiplier, reserve accounting) is pure arithmetic implementable in TypeScript — no external financial library is justified. The one genuine gap is a charting library for the frontend: time-series dashboards for CPI, money supply, yield curves, and bond prices require something the current icon-only dependency set cannot provide. Recharts 3.x is the right addition.

---

## New Stack Additions

### Core Technologies

No new server-side runtime dependencies are required. All new capabilities are pure TypeScript implementations built on the existing foundation.

| Technology | Where | Version | Purpose | Why |
|------------|-------|---------|---------|-----|
| recharts | `web/` | `^3.8.1` | Time-series charts for CPI, M1/M2, bond yields, fiscal budgets | React-native composable API; React 19 compatible at 3.x; no canvas setup; works with existing Zustand stores via standard props |

### Supporting Libraries

| Library | Where | Version | Purpose | When to Use |
|---------|-------|---------|---------|-------------|
| None required | — | — | — | All financial math is plain TypeScript |

### Development Tools

No new dev tooling is needed. The existing `drizzle-kit ^0.30.0` handles schema migrations for new tables through the established `runMigrations()` idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` try/catch pattern already in `server/src/db/migrate.ts`.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@quantlib/ql` or `quantlib-wasm` | Massive WASM blob (~50MB) for bond pricing that needs 3 lines of arithmetic: `P = C/r × (1 - (1+r)^-n) + F/(1+r)^n`. No derivatives pricing, no options Greeks needed. | Plain TypeScript functions in `server/src/mechanics/bondPricing.ts` |
| `decimal.js` / `big.js` | The existing codebase uses JavaScript `number` (IEEE 754) throughout — wealth, prices, reserves all `real` columns in SQLite. Introducing arbitrary-precision types mid-simulation creates type boundary friction with no practical benefit; agent wealth is already integer-clamped via `Math.round`. | `Math.round()` at settlement boundaries, same as existing `distributeProRata` in `shared/src/math.ts` |
| `mathjs` | General-purpose symbolic math library; inflation/CPI math is trivial weighted averages | Inline arithmetic |
| Any new ORM or query builder | Drizzle 0.41 already handles all required query patterns including compound indexes; existing `db` and `sqlite` instances are the integration points | `drizzle-orm/better-sqlite3` as-is |
| Redis / any external cache | All in-memory state (bank reserves, loan books, bond ledgers) follows the existing in-memory + DB snapshot pattern established by `OrderBook` and `AutomatedMarketMaker` | In-memory Maps with `asyncLogFlusher` for batch writes |
| A separate "financial engine" microservice | Contradicts local-first architecture; all mechanics are synchronous deterministic computation within the existing simulation tick | Extend `physicsEngine.ts` + new mechanics files |
| `visx` or `d3` directly | Significantly more implementation work; the economic dashboards here are standard line/area/bar charts, not custom SVG primitives | recharts composable API |

---

## Integration Points with Existing Stack

### 1. Schema — New Tables via `migrate.ts`

Add all new tables to `server/src/db/migrate.ts` using the existing `CREATE TABLE IF NOT EXISTS` pattern. New tables needed:

- `bank_accounts` — deposit balances, interest rates, per-agent per-session
- `loans` — principal, interest rate, term, repayment schedule, default status
- `bonds` — issuer (treasury or enterprise), face value, coupon, maturity, holder
- `equity_shares` — enterprise share registry, per-agent holdings
- `dividends` — dividend distributions per iteration
- `fiscal_budgets` — proposals, vote tallies, approved allocations per iteration
- `public_goods` — infrastructure/education/defense/welfare quality scores
- `money_supply_snapshots` — M0/M1/M2 per iteration (replaces total-fiat-only in current SFC audit)
- `cpi_snapshots` — basket-weighted price index per iteration

Add corresponding Drizzle schema definitions to `server/src/db/schema.ts`.

### 2. Shared Types — `shared/src/economyTypes.ts`

Extend (do not replace) `economyTypes.ts` with new interfaces:

- `LoanContract`, `BondInstrument`, `EquityPosition`, `FiscalBudget`, `PublicGoodsState`, `MoneySupplySnapshot`, `CPISnapshot`
- These join the existing `EmploymentContract`, `MarketState`, `EconomySnapshot`

The `EconomySnapshot` interface gains new optional fields so old sessions remain deserializable.

### 3. Action Codes — `server/src/mechanics/actionCodes.ts`

Add new `ActionCode` values:

```typescript
| 'DEPOSIT'          // agent → bank: move fiat to deposit account
| 'WITHDRAW'         // agent → bank: retrieve fiat
| 'TAKE_LOAN'        // agent → bank: borrow fiat, creates LoanContract
| 'REPAY_LOAN'       // agent → bank: reduce principal
| 'BUY_SHARES'       // agent → enterprise: equity purchase
| 'SELL_SHARES'      // agent → market: equity sale
| 'BUY_BOND'         // agent → bond market: bond purchase
| 'ISSUE_BOND'       // enterprise/treasury → bond market: issuance
| 'PROPOSE_BUDGET'   // politician: submit fiscal allocation proposal
| 'VOTE_BUDGET'      // voter: vote on active budget proposal
```

Follow the existing `VALID_ACTIONS` Set + `normalizeActionCode` fuzzy pattern.

### 4. Physics Engine — `server/src/mechanics/physicsEngine.ts`

Each new action code maps to a deterministic delta calculator following the existing `resolveAction()` pattern. The `PhysicsInput.economyDeltas` field already supports injecting external wealth changes — banking operations (interest income, dividend payments) flow through this channel.

New mechanics files (parallel to `automatedMarketMaker.ts`, `orderBook.ts`):
- `server/src/mechanics/bankingSystem.ts` — reserve accounting, loan origination, deposit interest
- `server/src/mechanics/capitalMarkets.ts` — equity share registry, bond issuance/redemption, secondary market
- `server/src/mechanics/fiscalEngine.ts` — budget proposal processing, vote tallying, spending multiplier application
- `server/src/mechanics/inflationEngine.ts` — CPI calculation, M1/M2 computation, expectation injection

### 5. SFC Audit — Updated Invariant

The current audit asserts `Σ agent_wealth + AMM_reserves + treasury + escrow = constant`. With fractional reserve banking, the invariant becomes:

```
M0 (base money) = constant
M1 = Σ agent_cash + Σ bank_deposit_balances
M2 = M1 + Σ loan_principal_outstanding
Audit: Σ bank_assets (loans + reserves) = Σ bank_liabilities (deposits + equity)
```

The `sfcSandbox.ts` file is the existing reference for testing invariant logic before integration.

### 6. Agent Cognition — LLM Prompt Context

Inflation awareness injects a compact context block into each agent's system prompt. The existing prompt architecture in `server/src/llm/prompts.ts` already injects `economyContext`. Extend with:

```
Current CPI: {value} ({delta}% vs last iteration)
M1 money supply: {value} ({delta}% growth)
Your deposit rate: {rate}%  |  Loan rate: {rate}%
```

Fits within the existing token budget by replacing the `marketSummary` field (same slot, more information density).

### 7. Frontend — Economic Dashboard

New Simulation tab "Economy" displaying:
- `<LineChart>` — CPI over iterations (recharts)
- `<AreaChart>` — M1 vs M2 money supply (recharts)
- `<BarChart>` — Fiscal budget allocation breakdown (recharts)
- `<LineChart>` — Average bond yield over time (recharts)

Data flows via the existing SSE stream from `server/src/routes/simulate.ts`. Add `economicMetrics` field to the iteration SSE event payload; the frontend `simulationStore.ts` accumulates per-iteration snapshots for chart data.

---

## Installation

```bash
# Web only — one new production dependency
npm install recharts -w web
```

No server-side packages to install.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| recharts 3.x | visx | When you need custom SVG-level chart primitives or the charts must match a bespoke design system pixel-for-pixel. For standard time-series dashboards, recharts composable API is sufficient and faster to implement. |
| recharts 3.x | react-financial-charts | When building a dedicated trading terminal with candlestick charts, order flow visualization, 60+ technical indicators. Overkill for macro-economic trend lines. |
| Inline TypeScript math | decimal.js | When simulating high-frequency electronic trading where rounding errors compound across millions of ticks. For 20–150 agent simulations running ~100 iterations, IEEE 754 with `Math.round` at settlement is accurate enough and consistent with the existing codebase. |
| bankingSystem.ts in-process | External financial engine | When simulation scale exceeds single-process performance (>10K agents). Not a current constraint. |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| recharts ^3.8.1 | react ^19.2.0 | React 19 compatible as of recharts 3.x. Install may show peer dependency warning about `react-is`; use `--legacy-peer-deps` if needed or check recharts 3.x peer dep declaration at install time. |
| recharts ^3.8.1 | zustand ^5.0.0 | No coupling; recharts takes plain data arrays via props |
| New Drizzle schema tables | drizzle-orm ^0.41.0 | Fully compatible; existing `sqliteTable` + `index` patterns apply unchanged |
| New ActionCodes | vitest ^1.0.4 | Existing test runner handles new mechanic unit tests; add tests in `server/src/mechanics/__tests__/` |

---

## Financial Math Reference (No Library Needed)

All formulas below are self-contained TypeScript arithmetic. Documenting here to confirm no library is warranted.

**Bond Price (fixed coupon):**
```
P = (C / r) × (1 - (1 + r)^-n) + F / (1 + r)^n
// C = coupon per period, r = yield per period, n = periods to maturity, F = face value
```

**Money Multiplier:**
```
multiplier = 1 / reserveRatio
M1 = M0 × multiplier  // theoretical max; actual M1 < theoretical due to excess reserves
```

**CPI (Laspeyres index):**
```
CPI_t = Σ(P_t,i × Q_base,i) / Σ(P_base,i × Q_base,i) × 100
// Basket: food, tools, luxury_goods, raw_materials — all already in marketPrices table
// Base iteration: first iteration of each session
```

**Inflation Rate:**
```
inflationRate = (CPI_t - CPI_{t-1}) / CPI_{t-1}
```

**Fisher Equation (nominal vs real interest):**
```
realRate ≈ nominalRate - inflationRate
// Used by agent cognition to evaluate whether saving is worthwhile
```

**Dividend Yield:**
```
yield = annualDividend / sharePrice
```

All of these operate on the existing `number` type. The `distributeProRata` utility in `shared/src/math.ts` already handles the integer rounding concern for distributing sums across agents.

---

## Sources

- [recharts npm — version 3.8.1, React 19 compatibility](https://www.npmjs.com/package/recharts)
- [Recharts GitHub — React 19 support issue #4558](https://github.com/recharts/recharts/issues/4558)
- [Drizzle ORM — Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints)
- [Drizzle ORM — Migrations](https://orm.drizzle.team/docs/migrations)
- [SQLite JSON1 Extension](https://sqlite.org/json1.html) — confirms no json extraction library needed
- [Fractional-reserve banking — Wikipedia](https://en.wikipedia.org/wiki/Fractional-reserve_banking) — reserve ratio / money multiplier formula
- [Money multiplier — Wikipedia](https://en.wikipedia.org/wiki/Money_multiplier) — M1/M2 derivation
- [Stock-flow consistent model — Wikipedia](https://en.wikipedia.org/wiki/Stock-flow_consistent_model) — SFC invariant extension approach
- [BLS CPI Calculation Handbook](https://www.bls.gov/opub/hom/cpi/calculation.htm) — Laspeyres index formula
- [decimal.js vs big.js comparison — DEV Community](https://dev.to/fvictorio/a-comparison-of-bignumber-libraries-in-javascript-2gc5) — confirmed arbitrary-precision not needed here
- [Best React chart libraries 2025 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2025/) — recharts vs visx trade-offs

---

*Stack research for: Ideal World v1.0 Real Economy Engine (banking, capital markets, fiscal policy, inflation)*
*Researched: 2026-04-01*
