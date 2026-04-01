# Phase 1: Banking Foundation - Research

**Researched:** 2026-04-01
**Domain:** Fractional reserve banking layered onto an SFC-conserved LLM-driven multi-agent simulation
**Confidence:** HIGH (SFC accounting, codebase integration), MEDIUM (backward-compat boundary conditions)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | EconomyConfig type in shared types holding all tunable economic parameters | New interface in `shared/src/types.ts`; session `config` JSON column already accepts arbitrary shape |
| CONF-02 | All economic parameters (reserve ratio, interest rates, loan term defaults) stored as session-level config, not hardcoded | `session.config` is already a `Record<string, unknown>`; EconomyConfig is parsed from it per-session |
| CONF-03 | Backward compatibility — existing sessions run legacy mechanics; new economy activates for new sessions | Guard all banking code with `if (session.config?.economyConfig?.bankingEnabled)` or equivalent version flag |
| BANK-01 | Bank agent role with deposit accounts that track individual agent balances | New `deposit_accounts` table; bank agent is a regular agent with `type = 'bank'` |
| BANK-02 | Reserve requirement enforcement — configurable ratio constrains lending capacity | `bankingEngine.ts` checks `reserves / totalDeposits >= reserveRequirement` before any ISSUE_LOAN |
| BANK-03 | LEND action creates loan contracts and expands M1 | `loan_contracts` table; M1 = M0 + `Σ loan principals outstanding` |
| BANK-04 | Loan repayment destroys M1 symmetrically; interest income flows to bank | Balance-sheet model: repayment decrements `loanAssets` + `depositLiabilities` simultaneously |
| BANK-05 | Default triggers after K consecutive missed repayments; bankruptcy seizes collateral | `consecutiveMissed` counter in loan record; `processDefault()` in `bankingEngine.ts` |
| BANK-06 | M1/M2 money supply tracked per iteration in telemetry | `TelemetryLog` extended with `m0`, `m1`, `loansOutstanding`; `macro_snapshots` table |
| BANK-08 | SFC audit extended to validate M0 constant + M1 = M0 + net loans outstanding | `computeSystemFiatTotal` extended with `loansOutstanding` parameter |
</phase_requirements>

---

## Summary

Phase 1 adds fractional reserve banking to PolicyLab's existing SFC-conserved simulation. The existing engine already maintains a strict `totalFiat = Σ(agent.wealth) + ammFiatReserve + treasury` invariant. This phase extends that invariant to the M0/M1 model: M0 (base money) remains constant while M1 expands and contracts as the bank issues and retires loans. No existing files need destructive rewrites — the banking subsystem slots in as a new engine called after the existing resolution phase.

The codebase is TypeScript + Drizzle ORM + better-sqlite3. New financial state goes into three new DB tables (`deposit_accounts`, `loan_contracts`, `bank_balance_sheets`) and one new repo (`bankingRepo.ts`). A new `bankingEngine.ts` handles the deterministic per-iteration banking tick. Shared types get `EconomyConfig`, `LoanContract`, `DepositAccount`, and `BankBalanceSheet`. The single highest-risk step is the extension of `computeSystemFiatTotal` — it must be the first code change, before any bank agent or loan is created.

**Primary recommendation:** Extend `computeSystemFiatTotal` first. Write the SFC unit test that proves M0 stays constant before writing a single line of loan issuance logic. Then build the DB schema, then the engine, then wire into `simulationRunner.ts`.

---

## Project Constraints (from CLAUDE.md)

### Enforced by CLAUDE.md

- **Shared types** — all cross-workspace data structures live in `shared/src/types.ts`. Import as `@policylab/shared`.
- **Prompt changes** — add/modify in `prompts.ts` only. All LLM calls use structured JSON outputs with explicit schemas.
- **New action types** — register in `mechanics/actionCodes.ts` (enum + role-permission table) before referencing in the physics engine.
- **Economy changes** — run the SFC audit assertion after any change that touches wealth/fiat transfers. The invariant is `M0 constant + M1 = M0 + net loans outstanding`.
- **Economic parameters** — all tunable parameters (reserve ratio, interest rates, loan term defaults) must be stored in session-level config via `EconomyConfig` type, never hardcoded.
- **Multi-provider LLM** — LLM gateway in `server/src/llm/` abstracts providers; no hardcoded model references.
- **`asyncLogFlusher`** — always route high-frequency writes (per-loan-repayment, per-iteration interest accrual) through it to prevent `SQLITE_BUSY`.

---

## Standard Stack

### Core (already in the codebase)

| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| better-sqlite3 | (existing) | SQLite sync DB | All new banking queries use same pattern as existing repos |
| drizzle-orm | (existing) | Schema definition and query builder | New tables follow `sqliteTable()` pattern in `schema.ts` |
| TypeScript | (existing) | Type-safe engine logic | `bankingEngine.ts` exports pure functions, no class instances |
| vitest | (existing) | Unit tests | Config: `server/vitest.config.ts`; include pattern `src/**/*.test.ts` |
| zod | (check in server/package.json) | LLM output schema validation | Must validate ISSUE_LOAN parameters before any loan is recorded |

### Supporting (no new installs expected)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| uuid (v4) | Loan/deposit/balance-sheet record IDs | Already used throughout; `import { v4 as uuidv4 } from 'uuid'` |
| `distributeProRata` (internal) | Interest pro-ration, collateral seizure among multiple depositors | Already in codebase; handles integer remainder correctly |

### New Installs
None expected. All required libraries are already workspace dependencies.

---

## Architecture Patterns

### Recommended New File Structure

```
server/src/
├── mechanics/
│   └── bankingEngine.ts          # NEW: processLoanRequest, processRepayment,
│                                 #   processDefault, accrueInterest,
│                                 #   enforceReserveRequirement, processIteration
├── db/
│   └── repos/
│       └── bankingRepo.ts        # NEW: CRUD for loan_contracts, deposit_accounts,
│                                 #   bank_balance_sheets
└── (modified)
    ├── db/schema.ts              # ADD: 3 new tables
    ├── db/migrate.ts             # ADD: CREATE TABLE IF NOT EXISTS for 3 tables
    ├── mechanics/actionCodes.ts  # ADD: DEPOSIT, WITHDRAW, TAKE_LOAN, REPAY_LOAN,
    │                             #   ISSUE_LOAN, SET_INTEREST_RATE to union + permission tables
    ├── mechanics/physicsEngine.ts # ADD: resolution cases for 6 new action codes
    ├── orchestration/simulationRunner.ts  # ADD: bankingEngine.processIteration() call;
    │                             #   extend computeSystemFiatTotal
    └── llm/prompts.ts            # ADD: bank agent intent prompt; deposit/loan context
                                  #   in personal status board

shared/src/
└── types.ts                      # ADD: EconomyConfig, LoanContract, DepositAccount,
                                  #   BankBalanceSheet, extended TelemetryLog fields
```

### Pattern 1: computeSystemFiatTotal Extension (DO THIS FIRST)

**What:** Before any bank agent code, extend the existing `computeSystemFiatTotal` function in `simulationRunner.ts` to accept a `loansOutstanding` parameter. The new SFC assertion becomes:

```
M0 = Σ(agent.cash_on_hand) + Σ(deposit_balances) + Σ(collateral_escrow)
     + amm_fiat_reserve + treasury
     = CONSTANT

M1 = M0 + loansOutstanding
```

**Current signature (lines 242–259 of simulationRunner.ts):**
```typescript
function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
): number
```

**New signature — add two parameters with defaults of 0 to stay backward-compatible:**
```typescript
function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
  depositBalances?: number,    // sum of all deposit_accounts.balance
  collateralEscrow?: number,   // sum of loan collateral held in escrow
): number
```

The SFC assertion in the runner becomes:
```typescript
const m0 = computeSystemFiatTotal(agents, primaryAMM, multiAMMs, treasury,
                                  wealthOverrides, depositBalances, collateralEscrow);
const loansOutstanding = await bankingRepo.getTotalLoansOutstanding(sessionId);
const m1 = m0 + loansOutstanding;
// Assert m0 === sessionSFCTracking.initialFiat (unchanged)
// Assert drift < 1e-9
```

**CRITICAL:** When a bank issues a loan, `agent.cash_on_hand` does NOT increase. Instead, `borrower.depositBalance` increases. If both are in `computeSystemFiatTotal` the M0 total is unchanged (deposit created, no base money moved). M1 = M0 + loansOutstanding increases by the loan principal.

### Pattern 2: Balance Sheet Model for Loan Lifecycle

The loan lifecycle is modeled as balance sheet events, not wealth transfers:

**Loan issuance (M1 expands):**
```typescript
// bankingEngine.processLoanRequest()
bank.loanAssets      += principal;    // bank's asset grows
bank.depositLiabilities += principal; // bank's liability grows
borrower.depositBalance += principal; // borrower's deposit grows (new M1)
// agent.currentStats.wealth UNCHANGED — deposits are not cash-on-hand
// M0 UNCHANGED, M1 increases by principal
```

**Repayment of principal (M1 contracts):**
```typescript
// bankingEngine.processRepayment()
bank.loanAssets      -= principalPaid;
bank.depositLiabilities -= principalPaid;
borrower.depositBalance -= principalPaid;
// M0 UNCHANGED, M1 decreases by principalPaid
```

**Interest payment only (base money transfers):**
```typescript
// Interest moves real base money from borrower to bank
borrower.depositBalance -= interest;   // real fiat leaves borrower
bank.reserves           += interest;   // real fiat enters bank
// Both M0 and M1 unchanged (fiat transferred, not created/destroyed)
```

**Default (M1 contracts, bank takes loss):**
```typescript
bank.loanAssets      -= remainingPrincipal;  // asset written off
bank.depositLiabilities -= remainingPrincipal; // liability written off
borrower.depositBalance = 0;                  // zeroed
bank.equity          -= loss;                 // bank absorbs loss
// M1 decreases, M0 unchanged
```

### Pattern 3: bankingEngine.processIteration() Call Location

Called in `simulationRunner.ts` immediately after the existing action resolution loop, before the SFC audit:

```typescript
// After existing resolveActionQueue() calls for all agents:
const bankingResult = await bankingEngine.processIteration({
  sessionId,
  agents: aliveAgents,
  loans: await bankingRepo.getActiveLoans(sessionId),
  deposits: await bankingRepo.getAllDeposits(sessionId),
  economyConfig: session.economyConfig,    // from EconomyConfig
  iterationNumber,
});
// Merge bankingResult.depositDeltas into agent deposit records (not agent.wealth)
// Append bankingResult.trace[] to physics trace log
// Pass bankingResult.totalDeposits and bankingResult.collateralEscrow to SFC audit
```

### Pattern 4: EconomyConfig as Session-Level Config

**What:** A typed interface stored in `session.config.economyConfig`. Parsed once at simulation start; all banking and future phases read from it.

```typescript
// shared/src/types.ts — new
export interface EconomyConfig {
  // Banking (Phase 1)
  bankingEnabled: boolean;
  reserveRequirement: number;        // 0.0–1.0, e.g., 0.10
  baseLoanInterestRate: number;      // per-iteration rate, e.g., 0.005
  defaultLoanTermIterations: number; // e.g., 20
  defaultThresholdIterations: number;// consecutive missed payments before default, e.g., 3
  depositInterestRate: number;       // per-iteration rate paid on deposits, e.g., 0.002

  // Placeholders for future phases (null until that phase activates)
  capitalMarketsEnabled?: boolean;
  fiscalEnabled?: boolean;
  inflationEnabled?: boolean;
}

// Default for new sessions:
export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  bankingEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
};
```

**Backward compatibility (CONF-03):** Sessions without `session.config.economyConfig` (pre-v1.0) receive `bankingEnabled: false`. Banking code checks `if (!economyConfig?.bankingEnabled) return;` at the top of every new engine function.

### Pattern 5: Bank Agent Type

Bank agents reuse the existing `agents` table. They get `type = 'bank'` (new value alongside existing `'citizen'` and `'central'`). A bank agent's `currentStats.wealth` tracks its operating reserves (base money it can spend). A separate `bank_balance_sheets` record per-iteration tracks the full balance sheet snapshot.

**Role tier for bank agent:** Classified as `'specialist'` in `getRoleTier()` to keep it out of elite-tier actions (EMBEZZLE, SUPPRESS). New action codes ISSUE_LOAN and SET_INTEREST_RATE gated behind a custom `'bank'` type check, not role tier.

### Anti-Patterns to Avoid

- **Loan as wealth transfer:** `bank.wealth -= principal; borrower.wealth += principal` is economically wrong. Never transfer wealth for loan issuance.
- **Interest accrual without atomic double-entry:** Accrue interest only as an atomic `{debit: borrower, credit: bank}` pair. Partial execution mints or destroys fiat.
- **Bank reserves in `agent.wealth` AND a separate map:** Choose one representation. The existing pattern is `agent.currentStats.wealth` = all base money for that agent. Bank's base money stays in `agent.currentStats.wealth` (its operating reserves). Deposit liabilities are tracked in `deposit_accounts` table only.
- **Running SFC audit mid-iteration:** Run once at iteration end after all banking deltas are merged. Mid-iteration audits fire false positives during partial state.
- **Per-action banking DB writes inside the resolution loop:** Collect deltas in-memory during the iteration; flush once via `asyncLogFlusher` at iteration end.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pro-rata distribution of collateral among depositors | Custom proportional loop | `distributeProRata` (already in codebase) | Handles integer remainder correctly; SFC-tested |
| LLM output schema validation for loan parameters | Ad-hoc `typeof` checks | Zod schema at `physicsEngine.ts` boundary | Malformed `interestRate: "high"` or negative maturity must be caught before any DB write |
| Per-iteration interest math | Custom amortization | Simple per-iteration rate: `interest = remainingBalance * perIterationRate` | Amortization schedules are overkill for discrete-tick ABM; flat rate is transparent and auditable |
| Concurrent withdrawal queue | Custom first-come-first-served | Pro-rata settlement via `distributeProRata` | Sequential settlement causes bank run cascade deaths; pro-ration prevents single-iteration population collapse |

**Key insight:** The hardest part of this phase is not the math — it is correctly tracking which money layer (M0 vs M1) each value belongs to. All decisions about data structures must be made before writing engine logic.

---

## New Database Tables

### `deposit_accounts`
```typescript
// schema.ts addition
export const depositAccounts = sqliteTable('deposit_accounts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  ownerAgentId: text('owner_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  bankAgentId: text('bank_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  accountType: text('account_type').notNull().default('demand'), // 'demand' only in Phase 1
  balance: real('balance').notNull().default(0),
  interestRate: real('interest_rate').notNull().default(0.002),
  lastUpdated: integer('last_updated').notNull().default(0), // iteration number
});
```

### `loan_contracts`
```typescript
export const loanContracts = sqliteTable('loan_contracts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  borrowerAgentId: text('borrower_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  lenderAgentId: text('lender_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  principal: real('principal').notNull(),
  interestRate: real('interest_rate').notNull(),       // per-iteration rate
  termIterations: integer('term_iterations').notNull(),
  remainingBalance: real('remaining_balance').notNull(),
  collateralAmount: real('collateral_amount').notNull().default(0),
  consecutiveMissed: integer('consecutive_missed').notNull().default(0),
  issuedAtIteration: integer('issued_at_iteration').notNull(),
  dueAtIteration: integer('due_at_iteration').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'repaid' | 'defaulted'
  createdAt: text('created_at').notNull(),
});
```

### `bank_balance_sheets`
```typescript
export const bankBalanceSheets = sqliteTable('bank_balance_sheets', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  iterationNumber: integer('iteration_number').notNull(),
  reserves: real('reserves').notNull(),          // = bank agent.currentStats.wealth
  loanAssets: real('loan_assets').notNull(),      // sum of active loan principals
  depositLiabilities: real('deposit_liabilities').notNull(), // sum of deposit balances
  equity: real('equity').notNull(),              // reserves + loanAssets - depositLiabilities
  timestamp: text('timestamp').notNull(),
});
```

---

## New Shared Types

### EconomyConfig and Banking Types (in `shared/src/types.ts`)

```typescript
// ── v1.0 Economy Types ────────────────────────────────────────────────────

export interface EconomyConfig {
  bankingEnabled: boolean;
  reserveRequirement: number;
  baseLoanInterestRate: number;
  defaultLoanTermIterations: number;
  defaultThresholdIterations: number;
  depositInterestRate: number;
  capitalMarketsEnabled?: boolean;
  fiscalEnabled?: boolean;
  inflationEnabled?: boolean;
}

export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  bankingEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
};

export interface LoanContract {
  id: string;
  sessionId: string;
  borrowerAgentId: string;
  lenderAgentId: string;
  principal: number;
  interestRate: number;        // per-iteration
  termIterations: number;
  remainingBalance: number;
  collateralAmount: number;
  consecutiveMissed: number;
  issuedAtIteration: number;
  dueAtIteration: number;
  status: 'active' | 'repaid' | 'defaulted';
  createdAt: string;
}

export interface DepositAccount {
  id: string;
  sessionId: string;
  ownerAgentId: string;
  bankAgentId: string;
  accountType: 'demand';
  balance: number;
  interestRate: number;
  lastUpdated: number;  // iteration number
}

export interface BankBalanceSheet {
  id: string;
  sessionId: string;
  agentId: string;
  iterationNumber: number;
  reserves: number;
  loanAssets: number;
  depositLiabilities: number;
  equity: number;
  timestamp: string;
}

// Extended TelemetryLog fields (add to existing TelemetryLog interface):
// m0: number;                    // base money (constant line)
// m1: number;                    // M0 + demand deposits
// loansOutstanding: number;      // total active loan principals
// bankEquity?: number;           // sum of all bank equity positions
```

---

## SFC Evolution: Phase 1

### Current Invariant (pre-Phase 1)
```
computeSystemFiatTotal = Σ(agent.wealth) + primaryAMM.fiatReserve
                        + Σ(multiAMMs fiat) + treasury
                       = CONSTANT (M0)
```

### Phase 1 Extended Invariant
```
M0 = Σ(agent.cash_on_hand)    // agent.currentStats.wealth (excludes deposit balances)
   + Σ(deposit_accounts.balance)
   + Σ(loan_collateral_escrow)
   + primaryAMM.fiatReserve
   + Σ(multiAMMs fiat)
   + treasury
   = CONSTANT

M1 = M0 + Σ(loan_contracts.principal WHERE status = 'active')
   (equivalently: M1 = M0 + loansOutstanding)
```

**Key implementation note:** `agent.currentStats.wealth` for a bank agent equals its `reserves` (base money held). When a bank issues a loan, its `agent.wealth` (reserves) does NOT change — only `loanAssets` and `depositLiabilities` on the balance sheet change. This is what makes M0 stay constant.

**CAUTION on agent.wealth vs depositBalance:** The current codebase tracks all agent fiat in `agent.currentStats.wealth`. Phase 1 introduces a split: citizen agents will have both `cash_on_hand` (in `currentStats.wealth`) and a `depositBalance` (in the `deposit_accounts` table). These are different things. When computing `computeSystemFiatTotal`, both must be counted — but `currentStats.wealth` must NOT include the deposit balance (risk of double-counting). Decision: `agent.currentStats.wealth` remains cash-on-hand only; deposits live only in `deposit_accounts` table. This is a breaking change for agents who deposit — plan accordingly.

---

## Common Pitfalls

### Pitfall 1: Loan Issuance as Simple Wealth Transfer
**What goes wrong:** `bank.wealth -= principal; borrower.wealth += principal` passes the current SFC audit but is economically wrong — no M1 expansion occurs.
**How to avoid:** Use balance sheet model (Pattern 2 above). The borrower's deposit balance increases; no base money moves.
**Warning signs:** SFC audit passes but `Σ(agent.wealth)` did not increase after a loan; no boom dynamics emerge.

### Pitfall 2: Repayment That Double-Credits the Bank
**What goes wrong:** `bank.wealth += principal; borrower.wealth -= principal` on repayment causes the bank to accumulate wealth it never had, drifting M0 upward.
**How to avoid:** Repayment decrements `bank.loanAssets` AND `bank.depositLiabilities` simultaneously. Only interest payment moves real base money.
**Warning signs:** Bank `agent.wealth` grows monotonically with no corresponding agent deductions.

### Pitfall 3: Interest Accrual Without Atomic Double-Entry
**What goes wrong:** Accrue interest to loan balance without simultaneously debiting borrower → fiat appears from nowhere.
**How to avoid:** Treat every interest transaction as `{debit borrower.deposit, credit bank.wealth}` atomically. If borrower cannot pay, trigger capitalization (add to loan balance) or default — never leave the transaction half-executed.
**Warning signs:** SFC drift proportional to loan volume × interest rate.

### Pitfall 4: Bank Reserves Double-Counted in SFC Perimeter
**What goes wrong:** Bank `agent.wealth` counted in `Σ(agent.wealth)` AND a separate bank reserve map — double-counted in M0.
**How to avoid:** Bank's base money lives ONLY in `agent.currentStats.wealth`. No separate reserve map. `computeSystemFiatTotal` uses the same agent wealth sum for bank agents as for citizen agents.
**Warning signs:** `computeSystemFiatTotal` jumps when a bank agent is initialized.

### Pitfall 5: Bank Run Cascade Kills Too Many Agents in One Tick
**What goes wrong:** Sequential withdrawal processing starves late-queue agents; 20 agents die in one iteration.
**How to avoid:** If bank reserves < withdrawal requests, pro-rate using `distributeProRata`. Enter "bank stress" state and resolve over multiple iterations.
**Warning signs:** Population drops >20% in a single iteration with no food shortage.

### Pitfall 6: EconomyConfig Applied to Old Sessions (CONF-03 Violation)
**What goes wrong:** Banking code runs for pre-v1.0 sessions that have no `economyConfig` in their `session.config`, breaking old simulations.
**How to avoid:** All banking code paths guarded by `if (!getEconomyConfig(session).bankingEnabled) return;`. Pre-v1.0 sessions return `bankingEnabled: false` from the getter.

### Pitfall 7: agent.wealth Includes Deposit Balance (Double-Count)
**What goes wrong:** When agents deposit fiat, if `agent.currentStats.wealth` is not reduced and `deposit_accounts.balance` is added to the SFC total, M0 appears to grow.
**How to avoid:** Depositing fiat moves it OUT of `agent.currentStats.wealth` INTO `deposit_accounts.balance`. It is still in M0 — just in a different pocket. The SFC total must count it exactly once.

---

## Code Examples

### Verified Pattern: Reserve Ratio Check Before Loan Issuance
```typescript
// Source: derived from ARCHITECTURE.md Pattern 1 + PITFALLS.md Pitfall 1
// In bankingEngine.ts
function canIssueLoan(
  bankReserves: number,
  totalDeposits: number,
  requestedPrincipal: number,
  reserveRequirement: number,
): boolean {
  // After issuing the loan, deposits will increase by principal
  // Reserves stay unchanged (loan is an asset, deposit is a liability)
  // Check: reserves / (totalDeposits + principal) >= reserveRequirement
  const postLoanDeposits = totalDeposits + requestedPrincipal;
  return bankReserves / postLoanDeposits >= reserveRequirement;
}
```

### Verified Pattern: SFC Assertion with M0/M1 Split
```typescript
// Source: derived from ARCHITECTURE.md Pattern 2 + existing simulationRunner.ts
// In simulationRunner.ts per-iteration audit block
const totalDeposits = await bankingRepo.getTotalDeposits(sessionId);
const collateralEscrow = await bankingRepo.getTotalCollateral(sessionId);
const loansOutstanding = await bankingRepo.getTotalLoansOutstanding(sessionId);

const m0 = computeSystemFiatTotal(
  aliveAgents, primaryAMM, multiAMMs, treasury,
  wealthOverrides,
  totalDeposits,    // new param
  collateralEscrow, // new param
);
const m1 = m0 + loansOutstanding;

const drift = Math.abs(m0 - sessionSFCTracking.get(sessionId)!.initialFiat);
if (drift > 1e-9) {
  throw new Error(`SFC M0 violation: drift=${drift.toFixed(6)}, expected ${initialFiat}`);
}
// M1 is informational — not an invariant assertion, but stored in telemetry
```

### Verified Pattern: Backward-Compatible EconomyConfig Getter
```typescript
// In a new server/src/mechanics/economyConfigUtils.ts (or inline in simulationRunner)
import type { EconomyConfig } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

export function getEconomyConfig(sessionConfig: Record<string, unknown> | null): EconomyConfig {
  if (!sessionConfig?.economyConfig) {
    // Pre-v1.0 session — banking disabled
    return { ...DEFAULT_ECONOMY_CONFIG, bankingEnabled: false };
  }
  return { ...DEFAULT_ECONOMY_CONFIG, ...(sessionConfig.economyConfig as Partial<EconomyConfig>) };
}
```

### Verified Pattern: Action Code Registration
```typescript
// In actionCodes.ts — add to ActionCode union and VALID_ACTIONS set
export type ActionCode =
  // ... existing codes ...
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'TAKE_LOAN'
  | 'REPAY_LOAN'
  | 'ISSUE_LOAN'       // bank agent only
  | 'SET_INTEREST_RATE' // bank agent only
  | 'NONE';

// DEPOSIT/WITHDRAW/TAKE_LOAN/REPAY_LOAN added to BASE_ACTIONS (all agents)
// ISSUE_LOAN/SET_INTEREST_RATE gated by agent.type === 'bank' check in physicsEngine
```

---

## Build Order (Within Phase 1)

The ordering below is mandatory — each step has a compile or test gate before proceeding:

1. **`shared/src/types.ts`** — Add `EconomyConfig`, `DEFAULT_ECONOMY_CONFIG`, `LoanContract`, `DepositAccount`, `BankBalanceSheet`; extend `TelemetryLog` with `m0`, `m1`, `loansOutstanding`.
2. **`server/src/db/schema.ts`** — Add `depositAccounts`, `loanContracts`, `bankBalanceSheets` table definitions.
3. **`server/src/db/migrate.ts`** — Add `CREATE TABLE IF NOT EXISTS` for all three tables.
4. **`server/src/orchestration/simulationRunner.ts`** — Extend `computeSystemFiatTotal` with `depositBalances` and `collateralEscrow` parameters (backward compatible, defaulting to 0). Write/update the M0 SFC assertion. **Run existing SFC tests — they must still pass before any banking code is added.**
5. **`server/src/db/repos/bankingRepo.ts`** — NEW: CRUD for all three tables. `getActiveLoans()`, `getAllDeposits()`, `getTotalLoansOutstanding()`, `getTotalDeposits()`, `getTotalCollateral()`, `insertLoan()`, `updateLoan()`, `upsertDeposit()`, `insertBalanceSheet()`.
6. **`server/src/mechanics/bankingEngine.ts`** — NEW: `processLoanRequest()`, `processRepayment()`, `processDefault()`, `accrueInterest()`, `accrueDepositInterest()`, `enforceReserveRequirement()`, `processIteration()`.
7. **`server/src/mechanics/actionCodes.ts`** — Add 6 new action codes; add to BASE_ACTIONS (DEPOSIT, WITHDRAW, TAKE_LOAN, REPAY_LOAN) and bank-only gate.
8. **`server/src/mechanics/physicsEngine.ts`** — Add `case 'DEPOSIT': case 'WITHDRAW': case 'TAKE_LOAN': case 'REPAY_LOAN':` resolution blocks. These return `wealthDelta: 0` (physics layer) and queue a banking engine delta.
9. **`server/src/orchestration/simulationRunner.ts`** — Wire `bankingEngine.processIteration()` call after the existing resolution loop; pass banking totals to extended SFC audit; emit `m0`/`m1`/`loansOutstanding` in `TelemetryLog`.
10. **`server/src/llm/prompts.ts`** — Add bank agent intent prompt variant; add deposit balance + outstanding loan context to citizen personal status board.

**Gate before moving to Phase 2:** SFC audit passes for 10 consecutive iterations with a bank agent present. M1 expands on ISSUE_LOAN; contracts on REPAY_LOAN and processDefault. M0 never changes.

---

## Import/Export Compatibility

The existing `importexport.ts` exports only the tables it knows about (sessions, agents, iterations, reflections, chatMessages, roleChanges). Phase 1 adds three new tables with agent ID references.

**Required:** Add `loanContracts`, `depositAccounts`, and `bankBalanceSheets` to the `SessionExport` type and to both the export query and the import remap logic. Loan contracts contain `borrowerAgentId` and `lenderAgentId` that must be remapped when importing into a new session with new UUIDs.

---

## Validation Architecture

No `nyquist_validation: false` in config (key absent — treat as enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | `server/vitest.config.ts` |
| Quick run command | `npm run test -w server` |
| Full suite command | `npm run test -w server` |
| Single file command | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | `EconomyConfig` type exported from `@policylab/shared` | unit | `npx vitest run server/src/__tests__/economyConfig.test.ts` | ❌ Wave 0 |
| CONF-02 | Session-level EconomyConfig read/written to `session.config` column | unit | `npx vitest run server/src/__tests__/economyConfig.test.ts` | ❌ Wave 0 |
| CONF-03 | Pre-v1.0 session (no economyConfig) returns `bankingEnabled: false`; banking skipped | unit | `npx vitest run server/src/__tests__/economyConfig.test.ts` | ❌ Wave 0 |
| BANK-01 | Deposit account created; balance tracked separately from `agent.wealth` | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ❌ Wave 0 |
| BANK-02 | Reserve ratio check rejects loan when `reserves / (deposits + principal) < reserveRequirement` | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ❌ Wave 0 |
| BANK-03 | ISSUE_LOAN increases `loansOutstanding` by principal; `m1` in telemetry increases by same | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ❌ Wave 0 |
| BANK-04 | REPAY_LOAN decreases `loansOutstanding` by principal; interest credit to bank.wealth is exact | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ❌ Wave 0 |
| BANK-05 | After K consecutive missed repayments, loan status = 'defaulted'; collateral credited to bank | unit | `npx vitest run server/src/mechanics/__tests__/banking.test.ts` | ❌ Wave 0 |
| BANK-06 | `TelemetryLog.m0`, `m1`, `loansOutstanding` emitted each iteration | unit | `npx vitest run server/src/__tests__/sfcBanking.test.ts` | ❌ Wave 0 |
| BANK-08 | M0 constant over 10 iterations with active lending; M1 = M0 + loansOutstanding asserted each iteration | unit | `npx vitest run server/src/__tests__/sfcBanking.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -w server` (full suite, ~seconds)
- **Per wave merge:** Full suite green
- **Phase gate:** All 11 tests above passing before closing Phase 1

### Wave 0 Gaps
- [ ] `server/src/mechanics/__tests__/banking.test.ts` — covers BANK-01 through BANK-05
- [ ] `server/src/__tests__/sfcBanking.test.ts` — covers BANK-06, BANK-08 (SFC drift over 10 iterations with active bank)
- [ ] `server/src/__tests__/economyConfig.test.ts` — covers CONF-01, CONF-02, CONF-03

---

## Environment Availability

Step 2.6: No external dependencies beyond the existing workspace. Banking logic is pure TypeScript + SQLite.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All server code | ✓ | v22.19.0 | — |
| better-sqlite3 | Banking DB writes | ✓ | (existing) | — |
| vitest | Test suite | ✓ | (existing) | — |
| TypeScript | bankingEngine.ts | ✓ | (existing) | — |

---

## Open Questions

1. **`agent.currentStats.wealth` semantic change for depositing agents**
   - What we know: Currently `wealth` = all fiat the agent owns. After Phase 1, deposits are split into a separate table.
   - What's unclear: When an agent deposits 50 fiat, does `wealth` decrease by 50 (so the SFC total counts both pockets separately), or does `wealth` remain unchanged and deposits are "virtual"?
   - Recommendation: `wealth` decreases when fiat is deposited (real transfer). `wealth` + `depositBalance` = agent's total fiat. This preserves the SFC structure. The UI may need to show "total assets" = wealth + deposits.

2. **Bank agent initialization and SFC baseline**
   - What we know: The SFC baseline is established on the first iteration from the sum of all agent wealth + AMM + treasury.
   - What's unclear: When a bank agent is created with initial wealth (its seed capital), that wealth is already in `agent.currentStats.wealth` — so M0 already includes it. No special handling needed. But the bank's initial deposits (agents moving fiat into the bank) will be set up in the same iteration. The baseline must be captured AFTER initial deposits are processed.
   - Recommendation: Set the SFC baseline AFTER the first iteration's banking tick runs, not before. Or, initialize deposits at 0 and let agents deposit in iteration 1.

3. **Collateral mechanics for Phase 1**
   - What we know: BANK-05 requires collateral seizure on default. The Architecture doc specifies `Σ(loan_collateral_escrow)` in the SFC perimeter.
   - What's unclear: What exactly constitutes collateral in a society without real estate? Options: (a) a fraction of the borrower's current wealth locked at loan issuance, (b) inventory items, (c) abstract "credit" (no real collateral).
   - Recommendation: Simplest SFC-safe option: at loan issuance, lock `min(borrower.wealth * 0.5, principal)` as collateral in an escrow column of the loan record. On default, transfer to bank wealth. This is a pure wealth transfer — SFC-neutral, no new accounting layer.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `server/src/orchestration/simulationRunner.ts` lines 233–259 — exact `computeSystemFiatTotal` signature and SFC tracking structure
- Direct codebase inspection: `server/src/mechanics/actionCodes.ts` — full action code union and role tier gates
- Direct codebase inspection: `server/src/mechanics/physicsConfig.ts` — `PhysicsConfigValues` pattern for session-level config
- Direct codebase inspection: `server/src/db/schema.ts` — all existing table definitions and FK patterns
- `.planning/research/ARCHITECTURE.md` — SFC accounting identities, M0/M1 split formulas, build order
- `.planning/research/PITFALLS.md` — verified pitfall patterns specific to this codebase
- `.planning/research/FEATURES.md` — SFC accounting constraints per feature table

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — Phase 1 requirement IDs and success criteria (project-defined)
- `.planning/STATE.md` — current blocker note on M0/M1 data structure mapping
- `CLAUDE.md` — enforced conventions (EconomyConfig in session config, asyncLogFlusher, prompts.ts only)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all patterns exist in codebase
- Architecture: HIGH — SFC formulas and build order verified against existing `computeSystemFiatTotal` and Drizzle schema patterns
- Pitfalls: HIGH — pitfalls sourced from project's own PITFALLS.md which was pre-researched against the specific codebase structure
- EconomyConfig backward compat: MEDIUM — the "guard with bankingEnabled flag" pattern is sound, but the exact placement of the guard (session config parsing) needs to be verified against how `session.config` is currently deserialized in `simulationRunner.ts`

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable codebase; no fast-moving dependencies)
