/**
 * Banking Repository — CRUD for fractional reserve banking tables.
 *
 * Handles CRUD for:
 *  - deposit_accounts (per-agent deposit balances at a bank)
 *  - loan_contracts (active and historical loan records)
 *  - bank_balance_sheets (per-iteration bank B/S snapshots)
 */
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../index.js';
import { depositAccounts, loanContracts, bankBalanceSheets } from '../schema.js';
import type { DepositAccount, LoanContract, BankBalanceSheet } from '@policylab/shared';

// ── Deposit Account helpers ──────────────────────────────────────────────────

function rowToDeposit(row: typeof depositAccounts.$inferSelect): DepositAccount {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerAgentId: row.ownerAgentId,
    bankAgentId: row.bankAgentId,
    accountType: row.accountType as 'demand',
    balance: row.balance,
    interestRate: row.interestRate,
    lastUpdated: row.lastUpdated,
  };
}

// ── Deposit operations ───────────────────────────────────────────────────────

/**
 * Insert or update a deposit account by ownerAgentId + bankAgentId.
 * Generates a new id with uuidv4() if not provided.
 */
export function upsertDeposit(
  deposit: Omit<DepositAccount, 'id'> & { id?: string },
): DepositAccount {
  const existing = getDeposit(deposit.ownerAgentId, deposit.bankAgentId);
  const id = deposit.id ?? existing?.id ?? uuidv4();

  if (existing) {
    db.update(depositAccounts)
      .set({
        balance: deposit.balance,
        interestRate: deposit.interestRate,
        lastUpdated: deposit.lastUpdated,
        accountType: deposit.accountType,
      })
      .where(eq(depositAccounts.id, id))
      .run();
  } else {
    db.insert(depositAccounts).values({
      id,
      sessionId: deposit.sessionId,
      ownerAgentId: deposit.ownerAgentId,
      bankAgentId: deposit.bankAgentId,
      accountType: deposit.accountType,
      balance: deposit.balance,
      interestRate: deposit.interestRate,
      lastUpdated: deposit.lastUpdated,
    }).run();
  }

  return { ...deposit, id };
}

/**
 * Get a deposit account by ownerAgentId and bankAgentId.
 */
export function getDeposit(
  ownerAgentId: string,
  bankAgentId: string,
): DepositAccount | undefined {
  const rows = db
    .select()
    .from(depositAccounts)
    .where(
      and(
        eq(depositAccounts.ownerAgentId, ownerAgentId),
        eq(depositAccounts.bankAgentId, bankAgentId),
      ),
    )
    .all();

  return rows.length > 0 ? rowToDeposit(rows[0]) : undefined;
}

/**
 * Get all deposit accounts for a session.
 */
export function getDepositsBySession(sessionId: string): DepositAccount[] {
  const rows = db
    .select()
    .from(depositAccounts)
    .where(eq(depositAccounts.sessionId, sessionId))
    .all();

  return rows.map(rowToDeposit);
}

/**
 * Get the total deposits balance for a session.
 * SELECT COALESCE(SUM(balance), 0) FROM deposit_accounts WHERE session_id = ?
 */
export function getTotalDeposits(sessionId: string): number {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${depositAccounts.balance}), 0)` })
    .from(depositAccounts)
    .where(eq(depositAccounts.sessionId, sessionId))
    .get();

  return result?.total ?? 0;
}

/**
 * Update a deposit account balance and lastUpdated iteration.
 */
export function updateDepositBalance(
  id: string,
  newBalance: number,
  iteration: number,
): void {
  db.update(depositAccounts)
    .set({ balance: newBalance, lastUpdated: iteration })
    .where(eq(depositAccounts.id, id))
    .run();
}

// ── Loan operations ──────────────────────────────────────────────────────────

function rowToLoan(row: typeof loanContracts.$inferSelect): LoanContract {
  return {
    id: row.id,
    sessionId: row.sessionId,
    borrowerAgentId: row.borrowerAgentId,
    lenderAgentId: row.lenderAgentId,
    principal: row.principal,
    interestRate: row.interestRate,
    termIterations: row.termIterations,
    remainingBalance: row.remainingBalance,
    collateralAmount: row.collateralAmount,
    consecutiveMissed: row.consecutiveMissed,
    issuedAtIteration: row.issuedAtIteration,
    dueAtIteration: row.dueAtIteration,
    status: row.status as 'active' | 'repaid' | 'defaulted',
    createdAt: row.createdAt,
  };
}

/**
 * Insert a new loan contract using loan.id as the primary key.
 */
export function insertLoan(loan: LoanContract): void {
  db.insert(loanContracts).values({
    id: loan.id,
    sessionId: loan.sessionId,
    borrowerAgentId: loan.borrowerAgentId,
    lenderAgentId: loan.lenderAgentId,
    principal: loan.principal,
    interestRate: loan.interestRate,
    termIterations: loan.termIterations,
    remainingBalance: loan.remainingBalance,
    collateralAmount: loan.collateralAmount,
    consecutiveMissed: loan.consecutiveMissed,
    issuedAtIteration: loan.issuedAtIteration,
    dueAtIteration: loan.dueAtIteration,
    status: loan.status,
    createdAt: loan.createdAt,
  }).run();
}

/**
 * Get all active loans for a session.
 */
export function getActiveLoans(sessionId: string): LoanContract[] {
  const rows = db
    .select()
    .from(loanContracts)
    .where(
      and(
        eq(loanContracts.sessionId, sessionId),
        eq(loanContracts.status, 'active'),
      ),
    )
    .all();

  return rows.map(rowToLoan);
}

/**
 * Get all loans for a given borrower agent.
 */
export function getLoansByBorrower(borrowerAgentId: string): LoanContract[] {
  const rows = db
    .select()
    .from(loanContracts)
    .where(eq(loanContracts.borrowerAgentId, borrowerAgentId))
    .all();

  return rows.map(rowToLoan);
}

/**
 * Get all active loans for a specific borrower in a session.
 * Used during death liquidation to default phantom debt and keep M1 accurate.
 */
export function getActiveLoansByBorrower(borrowerAgentId: string, sessionId: string): LoanContract[] {
  const rows = db
    .select()
    .from(loanContracts)
    .where(
      and(
        eq(loanContracts.borrowerAgentId, borrowerAgentId),
        eq(loanContracts.sessionId, sessionId),
        eq(loanContracts.status, 'active'),
      ),
    )
    .all();

  return rows.map(rowToLoan);
}

/**
 * Get the total outstanding loan principal for a session.
 * SELECT COALESCE(SUM(remaining_balance), 0) FROM loan_contracts WHERE session_id = ? AND status = 'active'
 */
export function getTotalLoansOutstanding(sessionId: string): number {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${loanContracts.remainingBalance}), 0)` })
    .from(loanContracts)
    .where(
      and(
        eq(loanContracts.sessionId, sessionId),
        eq(loanContracts.status, 'active'),
      ),
    )
    .get();

  return result?.total ?? 0;
}

/**
 * Get the total collateral held against active loans for a session.
 * SELECT COALESCE(SUM(collateral_amount), 0) FROM loan_contracts WHERE session_id = ? AND status = 'active'
 */
export function getTotalCollateral(sessionId: string): number {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${loanContracts.collateralAmount}), 0)` })
    .from(loanContracts)
    .where(
      and(
        eq(loanContracts.sessionId, sessionId),
        eq(loanContracts.status, 'active'),
      ),
    )
    .get();

  return result?.total ?? 0;
}

/**
 * Partial update a loan contract (remainingBalance, consecutiveMissed, status, collateralAmount).
 */
export function updateLoan(
  id: string,
  updates: Partial<Pick<LoanContract, 'remainingBalance' | 'consecutiveMissed' | 'status' | 'collateralAmount'>>,
): void {
  const setValues: Record<string, unknown> = {};
  if (updates.remainingBalance !== undefined) setValues.remainingBalance = updates.remainingBalance;
  if (updates.consecutiveMissed !== undefined) setValues.consecutiveMissed = updates.consecutiveMissed;
  if (updates.status !== undefined) setValues.status = updates.status;
  if (updates.collateralAmount !== undefined) setValues.collateralAmount = updates.collateralAmount;

  if (Object.keys(setValues).length === 0) return;

  db.update(loanContracts)
    .set(setValues)
    .where(eq(loanContracts.id, id))
    .run();
}

// ── Balance sheet operations ─────────────────────────────────────────────────

function rowToBalanceSheet(row: typeof bankBalanceSheets.$inferSelect): BankBalanceSheet {
  return {
    id: row.id,
    sessionId: row.sessionId,
    agentId: row.agentId,
    iterationNumber: row.iterationNumber,
    reserves: row.reserves,
    loanAssets: row.loanAssets,
    depositLiabilities: row.depositLiabilities,
    equity: row.equity,
    timestamp: row.timestamp,
  };
}

/**
 * Insert a bank balance sheet snapshot.
 */
export function insertBalanceSheet(sheet: BankBalanceSheet): void {
  db.insert(bankBalanceSheets).values({
    id: sheet.id,
    sessionId: sheet.sessionId,
    agentId: sheet.agentId,
    iterationNumber: sheet.iterationNumber,
    reserves: sheet.reserves,
    loanAssets: sheet.loanAssets,
    depositLiabilities: sheet.depositLiabilities,
    equity: sheet.equity,
    timestamp: sheet.timestamp,
  }).run();
}

/**
 * Get the most recent balance sheet snapshot for a bank agent in a session.
 * ORDER BY iteration_number DESC LIMIT 1
 */
export function getLatestBalanceSheet(
  agentId: string,
  sessionId: string,
): BankBalanceSheet | undefined {
  const rows = db
    .select()
    .from(bankBalanceSheets)
    .where(
      and(
        eq(bankBalanceSheets.agentId, agentId),
        eq(bankBalanceSheets.sessionId, sessionId),
      ),
    )
    .orderBy(sql`${bankBalanceSheets.iterationNumber} DESC`)
    .limit(1)
    .all();

  return rows.length > 0 ? rowToBalanceSheet(rows[0]) : undefined;
}
