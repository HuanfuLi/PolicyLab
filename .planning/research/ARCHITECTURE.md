# Architecture Research

**Domain:** Fractional reserve banking, capital markets, fiscal budget, and inflation integration into an LLM-powered agent-based economic simulation
**Researched:** 2026-04-01
**Confidence:** HIGH (based on deep codebase analysis) / MEDIUM (for novel system interactions)

---

## Standard Architecture

### System Overview

The new systems layer onto the existing Neuro-Symbolic engine without replacing it. The simulation loop's three-phase structure (Cognitive → Intent → Resolution) stays intact. New financial systems are injected as deterministic sub-engines in the Resolution phase, exactly as the AMM and order book were added in v0.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SIMULATION LOOP (per iteration)                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 1: Cognitive Pre-Processing (unchanged)                           │
│    memoryStream → reflectionTree → recursivePlanner                      │
│    NEW: inflationExpectations injected into CognitivePreOutput           │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 2: Intent Generation (minor additions)                            │
│    Citizen LLM calls → Multi-Action Queue                                │
│    NEW action codes: DEPOSIT, WITHDRAW, TAKE_LOAN, REPAY_LOAN,           │
│      BUY_SHARES, SELL_SHARES, BUY_BOND, PROPOSE_BUDGET, VOTE_BUDGET      │
│    Banker agent: ISSUE_LOAN, SET_INTEREST_RATE                           │
│    Central bank: SET_RESERVE_RATIO, ISSUE_GOV_BOND, CONDUCT_OMO          │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 3: Resolution (new sub-engines inserted)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  physicsEng  │  │  bankingEng  │  │  capitalMkt  │  │  fiscalEng  │ │
│  │ (unchanged)  │  │  (NEW)       │  │  (NEW)       │  │  (NEW)      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │                  │        │
│  ┌──────┴─────────────────┴─────────────────┴──────────────────┴──────┐ │
│  │                   SFC Audit Layer (EXTENDED)                        │ │
│  │   M0 (base) = const; M1 = M0 + demand_deposits; M2 = M1 + savings  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  End-of-iteration: CPI Computation (NEW)                                 │
│    priceIndex → moneySupplyRatio → inflationRate → update session state  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                   GOVERNANCE CYCLE (every 5 iterations)                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Existing: politician selection → proposals → ballot → vote → ratify    │
│  Extended: fiscal budget proposals added as a 6th ballot category        │
│    budgetProposal → spending allocations → vote → ratify → fiscalEngine │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `bankingEngine.ts` | Loan issuance, deposit tracking, reserve enforcement, default processing, interest accrual | `server/src/mechanics/` |
| `capitalMarketEngine.ts` | Share issuance/trading, bond issuance/coupon/maturity, dividend distribution, yield curve | `server/src/mechanics/` |
| `fiscalEngine.ts` | Budget execution, spending multiplier application, public goods quality tracking, treasury bond issuance | `server/src/mechanics/` |
| `inflationEngine.ts` | CPI basket computation, money supply ratio, inflation rate, expectation smoothing | `server/src/mechanics/` |
| `bankingRepo.ts` | Loan CRUD, deposit account read/write, bank balance sheet queries | `server/src/db/repos/` |
| `capitalMarketRepo.ts` | Equity positions, bond holdings, price history for securities | `server/src/db/repos/` |
| `fiscalRepo.ts` | Budget proposals, approved allocations, spending execution log, public goods quality state | `server/src/db/repos/` |
| `macroSnapshotRepo.ts` | Per-iteration M0/M1/M2, CPI, inflation rate, public goods quality for charting | `server/src/db/repos/` |
| `governanceManager.ts` | EXTENDED: fiscal budget proposals added as proposal type alongside existing 3 policy levers | `server/src/orchestration/` |

---

## Recommended Project Structure

New files to add (all existing files remain unchanged):

```
server/src/
├── mechanics/
│   ├── bankingEngine.ts          # Fractional reserve: loans, deposits, reserves, defaults
│   ├── capitalMarketEngine.ts    # Equity + bond issuance, trading, dividends, coupons
│   ├── fiscalEngine.ts           # Budget execution, multipliers, public goods quality
│   └── inflationEngine.ts        # CPI basket, money supply ratio, inflation rate + expectations
├── db/
│   └── repos/
│       ├── bankingRepo.ts        # Loans, deposits, bank balance sheets
│       ├── capitalMarketRepo.ts  # Equity positions, bond holdings, security prices
│       ├── fiscalRepo.ts         # Budget proposals, allocations, public goods state
│       └── macroSnapshotRepo.ts  # Per-iteration macro indicators (M1/M2, CPI, inflation)
└── orchestration/
    └── governanceManager.ts      # MODIFIED: add fiscal budget as governance proposal type

shared/src/
└── types.ts                      # EXTENDED: LoanContract, DepositAccount, EquityPosition,
                                  #   BondHolding, FiscalBudget, PublicGoodsState, MacroIndicators
```

### Structure Rationale

- **`mechanics/`:** All four new sub-engines follow the existing convention exactly — pure deterministic functions, no LLM calls, no DB access, return trace strings. The simulation runner calls them in sequence inside the resolution phase.
- **`db/repos/`:** Each major financial system gets its own repo. This matches the existing pattern (economyRepo, iterationRepo, etc.) and keeps query logic isolated.
- **`shared/src/types.ts`:** New financial instrument types declared here so both server and web can type-check against them.
- **No new routes needed initially:** The SSE stream carries macro snapshot data via extended `TelemetryLog`. New endpoints can be added later for direct banking/market queries from the frontend.

---

## Architectural Patterns

### Pattern 1: Sub-Engine Insertion in Resolution Phase

**What:** New financial engines are called inside `resolveActionQueue()` in `physicsEngine.ts`, or as sibling calls in `simulationRunner.ts` after `resolveActionQueue()`. Each engine receives the full agent array, session state, and returns deltas + a trace array.

**When to use:** For any deterministic financial operation that must be SFC-audited before the end-of-iteration snapshot.

**Trade-offs:** Keeps all deterministic logic out of the orchestration layer. Physics trace log grows, but this is already surfaced in the Lab UI.

**Example:**
```typescript
// In simulationRunner.ts resolution phase (after existing resolveActionQueue calls)
const bankingResult = await bankingEngine.processIteration({
  agents: aliveAgents,
  loans: await bankingRepo.getActiveLoans(sessionId),
  deposits: await bankingRepo.getAllDeposits(sessionId),
  policy: sessionPolicy,
  iterationNumber,
});
// bankingResult.agentWealthDeltas merged into agent state before SFC audit
// bankingResult.trace[] appended to physics trace log
```

### Pattern 2: Extended SFC Invariant (M0/M1/M2)

**What:** The existing SFC invariant `totalFiat = Σ(agent.wealth) + ammFiatReserve` must be extended to track money creation through lending. M0 (base money) is constant. M1 and M2 expand when banks make loans.

**When to use:** This is the core constraint that all banking operations must satisfy. Verify after every banking engine call.

**Trade-offs:** More complex than the single-number audit, but the logic is straightforward once the balance sheet accounting is established.

**Accounting identity (enforced each tick):**
```
M0 = Σ(central_bank_reserve_accounts) = CONSTANT
M1 = M0 + Σ(demand_deposit_balances at commercial banks)
M2 = M1 + Σ(savings_deposit_balances at commercial banks)

Bank Balance Sheet (per bank agent):
  Assets:  reserves_held + loans_outstanding + securities_held
  Liabilities: demand_deposits + savings_deposits + interbank_borrowing
  Equity:  assets - liabilities  (must be >= 0 or bank is insolvent)

SFC audit assertion (replaces current single-line audit):
  Σ(agent.cash_on_hand) + Σ(demand_deposits) + Σ(savings_deposits)
    + Σ(loan_collateral_escrow) + Σ(bond_escrow) + treasury_balance
    + amm_fiat_reserve
  = M0 (constant)
```

### Pattern 3: Governance Extension for Fiscal Budget

**What:** The existing governance cycle already handles proposals and voting. Fiscal budget is added as a new proposal type, not a new cycle. The `GovernancePolicyProposal` discriminated union gets a `'budget_allocation'` variant.

**When to use:** Any time the fiscal budget needs to be updated through the democratic process.

**Trade-offs:** Reuses battle-tested governance infrastructure. Budget proposals use the same LLM prompt/parse pattern as existing proposals, keeping the token budget stable.

**Example:**
```typescript
// In prompts.ts — extend GovernancePolicyProposal
export type GovernancePolicyProposal =
  | { field: 'tax_rate'; value: number }
  | { field: 'ubi_allocation'; value: number }
  | { field: 'enforcement_level'; value: number }
  | { field: 'budget_allocation'; value: BudgetAllocation }; // NEW

export interface BudgetAllocation {
  infrastructure: number;  // 0.0–1.0, must sum to 1.0 with others
  education: number;
  defense: number;
  welfare: number;
  healthcare: number;
}
```

### Pattern 4: Inflation Context Injection into Cognitive Phase

**What:** Inflation expectations are a single structured string injected into `CognitivePreOutput`, which already carries `memoryContext` and `planStep`. This mirrors how market board data is injected — a compact summary, not a data dump.

**When to use:** Every iteration after inflation has been computed (from iteration 2 onward).

**Trade-offs:** Minimal prompt token cost. Agents get one line of economic context that shapes their wage demands, saving behavior, and hoarding decisions through the LLM's in-context reasoning.

**Example injection (in `buildNaturalIntentPrompt`):**
```
Economic Conditions: Inflation is running at 3.2% (above target). 
Prices rose ~3% last period. Consider adjusting wage demands or savings behavior.
```

---

## Data Flow

### Banking System Data Flow

```
Agent (TAKE_LOAN action)
    ↓
physicsEngine.resolveAction() validates action is allowed for role tier
    ↓
bankingEngine.processLoanRequest(agentId, amount, termIterations)
    ↓ reads bank agent's balance sheet
    ↓ checks reserve ratio: (reserves / deposits) >= reserveRequirement
    ↓ if compliant: creates LoanContract, credits agent.wealth, debits bank.reserves
    ↓ returns wealth delta + trace
    ↓
bankingRepo.insertLoan() + update bank agent's balance sheet
    ↓
SFC audit: total fiat unchanged (loan credited to agent = debit from bank reserve,
           but NEW demand deposit created — M1 expands, M0 unchanged)
```

### Capital Market Data Flow

```
Agent (BUY_SHARES action, target = enterprise_id)
    ↓
capitalMarketEngine.processSharePurchase(buyerAgentId, enterpriseId, quantity)
    ↓ looks up enterprise from in-memory sessionEnterpriseRegistry
    ↓ looks up current share price from capitalMarketRepo
    ↓ debits buyer.wealth, credits seller.wealth (or enterprise treasury if IPO)
    ↓ updates equity position record
    ↓ records trade price → market price history
    ↓
capitalMarketRepo.upsertEquityPosition() + insertSecurityPrice()
    ↓
End-of-iteration: capitalMarketEngine.distributeDividends()
    ↓ for each enterprise: enterprise.profit * dividend_payout_ratio / shares_outstanding
    ↓ credited to each shareholder pro-rata
    ↓ SFC-compliant: wealth transferred from enterprise account to shareholders
```

### Fiscal Budget Data Flow

```
Governance cycle (every 5 iterations):
    ↓
governanceManager: politician proposes BudgetAllocation (new proposal type)
    ↓ LLM prompt: "propose budget split across infrastructure/education/defense/welfare/healthcare"
    ↓
Ballot synthesized, politicians vote, majority ratifies
    ↓
session.config.budget_allocation updated (alongside existing tax_rate etc.)
    ↓
simulationRunner: on each iteration, fiscalEngine.executeBudget() called
    ↓ treasury_revenue = Σ(agent.wealth * tax_rate)  (already collected)
    ↓ spending = budget_allocation * treasury_balance
    ↓ infrastructure_spending → publicGoodsState.infrastructure_quality += multiplier
    ↓ education_spending → skill_gain_bonus for WORK/LEARN actions this iteration
    ↓ welfare_spending → direct wealth transfer to lowest-wealth agents (SFC: treasury → agents)
    ↓ healthcare_spending → health regeneration bonus
    ↓
fiscalRepo.logSpending() + update publicGoodsState
    ↓
physicsEngine already reads publicGoodsState multipliers via physicsConfig
```

### Inflation Computation Data Flow

```
End of each iteration (after all action resolution):
    ↓
inflationEngine.computeCPI(sessionId, iterationNumber)
    ↓ reads marketPrices table for current iteration (food, tools, luxury, raw_materials)
    ↓ computes weighted price index: CPI = Σ(weight_i * price_i / basePrice_i)
    ↓ weights: food 40%, tools 25%, luxury 20%, raw_materials 15% (configurable)
    ↓
inflationEngine.computeMoneySupplyEffect(M1_current, M1_previous, GDP_proxy)
    ↓ inflation_signal = (M1_delta / M1_prev) - productivity_growth_estimate
    ↓ blended_inflation = 0.6 * cpi_inflation + 0.4 * money_supply_signal
    ↓
macroSnapshotRepo.insertSnapshot(iterationNumber, { M0, M1, M2, CPI, inflationRate })
    ↓
Session state updated: session.config.inflation_rate, session.config.inflation_expectations
    ↓
Next iteration Phase 1: cognitiveEngine reads inflation_expectations from session.config
    ↓ injects single-line economic context into every agent's intent prompt
```

### Key Data Flows Summary

1. **Loan issuance:** Agent action → bankingEngine → LoanContract created, M1 expands, M0 unchanged, SFC audit passes.
2. **Loan repayment/default:** Per-iteration bankingEngine tick → checks overdue loans → applies penalty or forgives (destroys M1, M0 unchanged), updates bank equity.
3. **Share trading:** BUY_SHARES/SELL_SHARES → capitalMarketEngine → wealth transferred peer-to-peer, price recorded, dividends distributed end-of-iteration.
4. **Bond lifecycle:** ISSUE_GOV_BOND → treasury borrows from agents → coupon payments each iteration from treasury → maturity → principal returned (all SFC-balanced).
5. **Fiscal spending:** Governance ratifies budget → fiscalEngine executes per-iteration → public goods quality updated → physicsConfig multipliers apply to all WORK/PRODUCE actions.
6. **Inflation loop:** Market prices → CPI → money supply comparison → inflation rate → injected into agent cognition → agents adjust behavior (higher wage demands, hoarding) → affects prices next iteration.

---

## New Database Tables

### `bank_balance_sheets`
Tracks each bank agent's balance sheet snapshot per iteration.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  agentId: text FK → agents,       // the bank agent
  iterationNumber: integer,
  reserves: real,                   // cash held at central bank
  loansOutstanding: real,           // sum of active loan principals
  securitiesHeld: real,             // bonds held as assets
  demandDeposits: real,             // M1 liabilities
  savingsDeposits: real,            // M2 liabilities
  equity: real,                     // assets - liabilities
  timestamp: text
}
```

### `loan_contracts`
Active and historical loan records.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  borrowerAgentId: text FK → agents,
  lenderAgentId: text FK → agents,  // bank agent
  principal: real,
  interestRate: real,                // per-iteration rate
  termIterations: integer,
  remainingBalance: real,
  issuedAtIteration: integer,
  dueAtIteration: integer,
  status: text,                      // 'active' | 'repaid' | 'defaulted'
  createdAt: text
}
```

### `deposit_accounts`
Per-agent deposit balances at each bank.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  ownerAgentId: text FK → agents,
  bankAgentId: text FK → agents,
  accountType: text,                 // 'demand' | 'savings'
  balance: real,
  interestRate: real,
  lastUpdated: integer               // iteration number
}
```

### `equity_positions`
Per-agent shareholdings in enterprises.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  ownerAgentId: text FK → agents,
  enterpriseId: text,                // enterprise registry ID (not agentId)
  sharesHeld: integer,
  averageCostBasis: real,
  lastUpdated: integer
}
```

### `bond_holdings`
Per-agent bond positions (government and corporate).

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  ownerAgentId: text FK → agents,
  issuerId: text,                    // 'treasury' | enterpriseId
  bondType: text,                    // 'government' | 'corporate'
  faceValue: real,
  couponRate: real,                  // per-iteration
  maturityIteration: integer,
  purchasePrice: real,
  status: text                       // 'active' | 'matured' | 'defaulted'
}
```

### `fiscal_budget`
Approved budget allocations per governance cycle.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  approvedAtIteration: integer,
  infrastructure: real,              // 0.0–1.0 fraction of spending
  education: real,
  defense: real,
  welfare: real,
  healthcare: real,
  totalBudget: real,                 // treasury balance at time of approval
  isActive: integer                  // 0|1 — only one active at a time
}
```

### `public_goods_state`
Current quality levels of public goods categories.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  iterationNumber: integer,
  infrastructureQuality: real,       // 0.0–2.0 (multiplier on PRODUCE productivity)
  educationQuality: real,            // 0.0–2.0 (multiplier on skill gain rate)
  defenseLevel: real,                // 0.0–2.0 (multiplier on SUPPRESS/STEAL resistance)
  welfareLevel: real,                // 0.0–2.0 (direct UBI supplement)
  healthcareQuality: real            // 0.0–2.0 (multiplier on health regeneration)
}
```

### `macro_snapshots`
Per-iteration macroeconomic indicators for charting.

```typescript
{
  id: text PK,
  sessionId: text FK → sessions,
  iterationNumber: integer,
  m0: real,                          // base money (should be constant)
  m1: real,                          // M0 + demand deposits
  m2: real,                          // M1 + savings deposits
  cpi: real,                         // price index (base = 100)
  inflationRate: real,               // % change in CPI vs prior iteration
  inflationExpectations: real,       // smoothed 3-iteration EMA of inflation
  totalLoansOutstanding: real,
  totalBondDebt: real,
  treasuryBalance: real,
  timestamp: text
}
```

---

## Integration Points with Existing Code

### Existing Files — Modified

| File | Modification |
|------|-------------|
| `server/src/mechanics/actionCodes.ts` | Add new ActionCodes: `DEPOSIT`, `WITHDRAW`, `TAKE_LOAN`, `REPAY_LOAN`, `BUY_SHARES`, `SELL_SHARES`, `BUY_BOND`, `PROPOSE_BUDGET`, `VOTE_BUDGET`, `ISSUE_LOAN`, `SET_INTEREST_RATE`, `ISSUE_GOV_BOND` |
| `server/src/mechanics/physicsEngine.ts` | Add resolution cases for new action codes; read `publicGoodsState` multipliers from session config |
| `server/src/orchestration/simulationRunner.ts` | Call `bankingEngine.processIteration()`, `capitalMarketEngine.processIteration()`, `fiscalEngine.executeBudget()`, `inflationEngine.computeCPI()` in sequence after existing resolution; extend SFC audit |
| `server/src/orchestration/governanceManager.ts` | Add `budget_allocation` as a valid proposal field; inject current budget context into politician prompts |
| `server/src/llm/prompts.ts` | Add budget proposal prompt builder; add inflation context to `buildNaturalIntentPrompt()`; add bank agent intent prompt variant |
| `server/src/db/schema.ts` | Add 7 new table definitions |
| `server/src/db/migrate.ts` | Add migration SQL for all 7 new tables |
| `shared/src/types.ts` | Add `LoanContract`, `DepositAccount`, `EquityPosition`, `BondHolding`, `FiscalBudget`, `PublicGoodsState`, `MacroIndicators`, `BudgetAllocation` types |
| `server/src/mechanics/physicsConfig.ts` | Add banking constants: `reserveRequirement`, `defaultPenalty`, `baseLoanInterestRate`; CPI basket weights; fiscal multipliers |

### Existing Files — Unchanged

`cognitiveEngine.ts`, `allostaticEngine.ts`, `automatedMarketMaker.ts`, `orderBook.ts`, `inventorySystem.ts`, `skillSystem.ts`, `reflectionRunner.ts`, `simulationManager.ts`, all route files, all frontend files (initially).

---

## Build Order (Considering Dependencies)

The four systems have a clear dependency chain that determines build order:

```
Phase A: Banking Foundation
  (no dependencies on capital markets, fiscal, or inflation)
         ↓
Phase B: Capital Markets
  (depends on: enterprise registry from simulationRunner, banking for margin/collateral)
         ↓
Phase C: Fiscal Budget
  (depends on: governance cycle extension, public goods multipliers in physicsEngine)
         ↓
Phase D: Inflation Loop
  (depends on: marketPrices data from v0, M1/M2 from banking, CPI basket from fiscal)
```

### Phase A: Banking Foundation

1. `shared/src/types.ts` — Add `LoanContract`, `DepositAccount`, `BankBalanceSheet` types
2. `server/src/db/schema.ts` + `migrate.ts` — Add `loan_contracts`, `deposit_accounts`, `bank_balance_sheets` tables
3. `server/src/db/repos/bankingRepo.ts` — CRUD for loans, deposits, bank balance sheets
4. `server/src/mechanics/bankingEngine.ts` — Core: `processLoanRequest()`, `processRepayment()`, `processDefault()`, `accrueInterest()`, `enforceReserveRequirement()`; extends SFC audit to M0/M1/M2
5. `server/src/mechanics/actionCodes.ts` — Add `DEPOSIT`, `WITHDRAW`, `TAKE_LOAN`, `REPAY_LOAN`, `ISSUE_LOAN`, `SET_INTEREST_RATE` to ActionCode union and role permission tables
6. `server/src/mechanics/physicsEngine.ts` — Add resolution cases for banking actions
7. `server/src/orchestration/simulationRunner.ts` — Call `bankingEngine.processIteration()` in resolution phase; extend SFC audit
8. `server/src/llm/prompts.ts` — Add bank agent intent prompt; add deposit/loan context to personal status board

**Gate before Phase B:** Banking SFC audit passes for 10 consecutive iterations with a bank agent present. M1 expands correctly when loans are issued; contracts when repaid/defaulted.

### Phase B: Capital Markets

1. `shared/src/types.ts` — Add `EquityPosition`, `BondHolding`, `EnterpriseEquity` types
2. `server/src/db/schema.ts` + `migrate.ts` — Add `equity_positions`, `bond_holdings` tables
3. `server/src/db/repos/capitalMarketRepo.ts` — Equity position CRUD, bond holding CRUD, security price inserts
4. `server/src/mechanics/capitalMarketEngine.ts` — `processSharePurchase()`, `processShareSale()`, `processBondPurchase()`, `distributeDividends()`, `processBondCoupon()`, `processBondMaturity()`
5. `server/src/mechanics/actionCodes.ts` — Add `BUY_SHARES`, `SELL_SHARES`, `BUY_BOND`, `ISSUE_GOV_BOND`
6. `server/src/mechanics/physicsEngine.ts` — Add resolution cases for capital market actions
7. `server/src/orchestration/simulationRunner.ts` — Call `capitalMarketEngine.processIteration()` after banking engine; dividend/coupon distributions before SFC audit
8. `server/src/llm/prompts.ts` — Add equity/bond ownership context to personal status board; add INVEST action description to point at BUY_SHARES/BUY_BOND

**Gate before Phase C:** Share prices and dividend payouts are SFC-consistent. Bond coupon payments clear correctly from treasury.

### Phase C: Fiscal Budget

1. `shared/src/types.ts` — Add `FiscalBudget`, `BudgetAllocation`, `PublicGoodsState` types
2. `server/src/db/schema.ts` + `migrate.ts` — Add `fiscal_budget`, `public_goods_state` tables
3. `server/src/db/repos/fiscalRepo.ts` — Budget proposal CRUD, public goods state read/write, spending log
4. `server/src/mechanics/fiscalEngine.ts` — `executeBudget()`, `computeMultiplierEffects()`, `updatePublicGoods()`, `applySpendingToAgents()`
5. `server/src/mechanics/physicsEngine.ts` — Read `publicGoodsState` multipliers from session config; apply to WORK, PRODUCE_AND_SELL, health recovery
6. `server/src/orchestration/governanceManager.ts` — Extend `GovernancePolicyProposal` with `budget_allocation` variant; add budget context to politician prompts; ratified budget stored in `session.config.budget_allocation`
7. `server/src/orchestration/simulationRunner.ts` — Call `fiscalEngine.executeBudget()` each iteration; pass current `publicGoodsState` to physics engine
8. `server/src/llm/prompts.ts` — Add budget proposal prompt builder; add public goods quality to personal status board context

**Gate before Phase D:** Budget spending correctly flows from treasury to agents (welfare) and to multiplier tables. Public goods quality degrades without spending (decay rate configurable in physicsConfig).

### Phase D: Inflation Loop

1. `shared/src/types.ts` — Add `MacroIndicators`, `InflationState` types
2. `server/src/db/schema.ts` + `migrate.ts` — Add `macro_snapshots` table
3. `server/src/db/repos/macroSnapshotRepo.ts` — Insert per-iteration macro snapshot; read recent snapshots for trend
4. `server/src/mechanics/inflationEngine.ts` — `computeCPI()`, `computeMoneySupplyEffect()`, `blendInflationSignal()`, `smoothExpectations()`; reads `marketPrices` and `macro_snapshots`
5. `server/src/orchestration/simulationRunner.ts` — Call `inflationEngine.computeCPI()` at end of each iteration; store result in session state
6. `server/src/cognition/cognitiveEngine.ts` — Read `session.config.inflation_expectations` in `runCognitivePreProcessing()`; inject one-line economic context into `CognitivePreOutput`
7. `server/src/llm/prompts.ts` — Add inflation context field to `buildNaturalIntentPrompt()`; add inflation-reactive personality guidance (risk-averse agents hoard when inflation > 5%)

**Gate (complete):** Wage-price spiral can emerge: high inflation → agents demand higher wages in WORK bargaining → higher costs → higher prices → higher CPI.

---

## Scaling Considerations

This is a local single-user simulation. The relevant scale dimension is agents-per-session and iterations-per-session, not user concurrency.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 20–50 agents | All engines run synchronously in the iteration loop. No batching needed. |
| 50–150 agents | Bank engine processes all loan accruals in a single SQLite batch transaction. Capital market dividends computed in one pass. HMAS map-reduce already handles the intent phase. |
| 150+ agents | Per-iteration banking tick must use `asyncLogFlusher` for high-frequency writes (loan accrual records). Consider in-memory ledger with end-of-iteration flush rather than per-action DB writes. |

### Performance Constraints

The four new engines must not add more than ~200ms to the per-iteration wall time (existing iteration time is ~3–8s dominated by LLM calls). All four engines are pure TypeScript with synchronous SQLite — this is achievable if:
- Banking interest accrual is batched (one UPDATE per loan, not one transaction)
- Dividend distribution uses `distributeProRata` already in shared (O(n) not O(n²))
- CPI computation reads only the latest market price row per item type (indexed query)
- Public goods multipliers are cached in memory for the iteration, not re-queried per agent action

---

## Anti-Patterns

### Anti-Pattern 1: Per-Action Banking DB Writes

**What people do:** Write a loan record or update a deposit balance on every agent action inside the resolution loop.

**Why it's wrong:** The resolution loop runs once per agent per iteration. With 50 agents, that is 50 banking writes per iteration inside the hot loop, causing lock contention with the asyncLogFlusher.

**Do this instead:** Collect banking deltas in memory during the resolution phase. Flush all loan/deposit updates in a single batch transaction at the end of the iteration, after all agent actions are resolved. Same pattern as asyncLogFlusher.

### Anti-Pattern 2: Separate SFC Audits per Sub-Engine

**What people do:** Each new engine runs its own `totalFiat` assertion immediately after its operations.

**Why it's wrong:** During a single iteration, wealth flows through multiple engines (banking → capital markets → fiscal → inflation adjustment). Running the audit mid-iteration will see partial states and false-flag violations.

**Do this instead:** Run the extended SFC audit once at the end of the iteration, after all sub-engine deltas are applied to agent state. The single audit catches any net violation.

### Anti-Pattern 3: Loan Interest as New Money

**What people do:** When computing interest payments, credit interest to the bank's income without debiting it from the borrower — creating new fiat.

**Why it's wrong:** Interest is a transfer, not money creation. The borrower loses `interestAmount`; the bank gains `interestAmount`. M0 is unchanged.

**Do this instead:** Interest accrual is always a debit from `borrower.wealth` and a credit to `bankAgent.wealth`. If the borrower cannot pay interest, that is a partial default — bank takes a loss, borrower wealth floors at 0. The SFC invariant must hold both ways.

### Anti-Pattern 4: Inflation Rate Applied Directly to Agent Wealth

**What people do:** When inflation is 5%, subtract 5% from all agent wealth each iteration to "simulate" purchasing power loss.

**Why it's wrong:** Inflation is a price level change, not a direct wealth destruction. Agent wealth in nominal terms is fine — the AMM and market prices already rise with inflation through the price discovery mechanism. Directly destroying wealth violates SFC.

**Do this instead:** Inflation affects the *real value* of goods (AMM spot prices rise), not the *nominal quantity* of fiat. Agent cognition sees inflation and adjusts behavior. Real purchasing power falls through the price mechanism, not through wealth deletion.

### Anti-Pattern 5: Monolithic Fiscal Engine Called from Governance Manager

**What people do:** Put budget execution logic inside `governanceManager.ts` because that is where the budget is voted on.

**Why it's wrong:** The governance cycle fires every 5 iterations to update the *policy* (the budget allocation percentages). The budget *execution* happens every iteration. Mixing these creates a timing dependency and pollutes the governance module with per-tick logic.

**Do this instead:** Governance manager only updates `session.config.budget_allocation` (the policy). The `fiscalEngine` reads that policy and executes spending every iteration, independently of the governance cycle.

---

## SFC Evolution Summary

### Current (v0)

```
Invariant: Σ(agent.wealth) + amm_fiat_reserve = CONSTANT (M0)
```

### After Banking (Phase A)

```
M0 = Σ(bank.reserves) = CONSTANT (base money, never changes)
M1 = Σ(agent.cash_on_hand) + Σ(demand_deposits at banks)
M2 = M1 + Σ(savings_deposits at banks)

Full audit:
  Σ(agent.cash_on_hand) + Σ(all_deposit_balances) + Σ(loan_collateral_escrow)
  + amm_fiat_reserve + treasury_balance = M0
```

When a bank issues a loan: reserves decrease, loan asset increases, demand deposit liability increases. Net M0 change: zero. M1 expands by the deposit amount.

### After Capital Markets (Phase B)

```
+ Σ(bond_escrow)  // government bonds held as treasury liabilities
// Equity does not create money — it transfers existing fiat between agents
```

### After Fiscal (Phase C)

```
treasury_balance replaces the simple "treasury" line — now explicitly tracked
as the sum of tax revenue minus spending, plus bond proceeds minus repayments.
```

### After Inflation (Phase D)

No change to the SFC invariant — CPI and inflation are computed from price data, not from wealth flows. The invariant is unchanged; inflation is observable in the macro_snapshots table.

---

## Sources

- [sfctools: A toolbox for stock-flow consistent, agent-based models](https://www.theoj.org/joss-papers/joss.04980/10.21105.joss.04980.pdf) — MEDIUM confidence (peer-reviewed, directly relevant)
- [Agent Based-Stock Flow Consistent Macroeconomics: Towards a Benchmark Model](https://sfc-models.net/publications/articles/agent-based-stock-flow-consistent-macroeconomics-towards-a-benchmark-model/) — HIGH confidence (foundational academic reference)
- [Fractional-reserve banking — Wikipedia](https://en.wikipedia.org/wiki/Fractional-reserve_banking) — HIGH confidence (definitional)
- [DSK-SFC Stock-Flow Consistent Agent-Based Model (2024)](https://ideas.repec.org/p/ssa/lemwps/2024-09.html) — MEDIUM confidence (current year research, SFC+ABM integration)
- [Agent-Based Simulation of a Financial Market with Large Language Models (2024)](https://arxiv.org/pdf/2510.12189) — MEDIUM confidence (directly analogous architecture: LLM agents + deterministic market engine)
- [Fiscal Multipliers — Institute for Government (2024)](https://www.instituteforgovernment.org.uk/sites/default/files/2024-10/Fiscal-modifiers-obr-demand.pdf) — MEDIUM confidence (multiplier values for infrastructure/education/defense/welfare)
- Codebase analysis of `simulationRunner.ts`, `physicsEngine.ts`, `automatedMarketMaker.ts`, `governanceManager.ts`, `schema.ts`, `actionCodes.ts` — HIGH confidence (direct source inspection)

---

*Architecture research for: Ideal World v1.0 Real Economy Engine*
*Researched: 2026-04-01*
