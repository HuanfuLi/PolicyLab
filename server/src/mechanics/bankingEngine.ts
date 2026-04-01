/**
 * Banking Engine — deterministic banking mechanics for fractional reserve banking.
 *
 * Design: All functions receive data and return delta objects. No direct DB mutations.
 * The caller (simulationRunner in Plan 03) applies deltas in batch via bankingRepo.
 *
 * SFC Accounting:
 *  - M0 (base money) is constant. Bank reserves are part of M0.
 *  - M1 = M0 + outstanding loan principals.
 *  - Loan issuance: depositLiabilities += principal, loanAssets += principal (M1 expands).
 *  - Loan repayment: depositLiabilities -= principal, loanAssets -= principal (M1 contracts).
 *  - Interest: borrower.depositBalance -= interest; bank.reserves += interest (M0 transfers).
 */
import { v4 as uuidv4 } from 'uuid';
import type { Agent, EconomyConfig, LoanContract, DepositAccount, BankBalanceSheet } from '@policylab/shared';

// ── Return types ─────────────────────────────────────────────────────────────

export interface BankingDelta {
  /** Updated deposit account balances (id, newBalance, iteration) */
  depositUpdates: Array<{ accountId: string; newBalance: number; iteration: number }>;
  /** Updated loan fields (loanId, partial LoanContract updates) */
  loanUpdates: Array<{ loanId: string; updates: Partial<LoanContract> }>;
  /** Base money wealth changes: agentId → wealth change (collateral escrow, interest income) */
  wealthDeltas: Map<string, number>;
  /** New loans created this iteration */
  newLoans: LoanContract[];
  /** New deposit accounts to create this iteration */
  newDeposits: Array<Omit<DepositAccount, 'id'>>;
  /** Balance sheet snapshots for each bank agent */
  balanceSheetSnapshots: BankBalanceSheet[];
  /** Physics trace log entries for narrative grounding */
  trace: string[];
}

// ── canIssueLoan ─────────────────────────────────────────────────────────────

/**
 * Check whether the bank has sufficient reserves to issue a loan of the given principal,
 * respecting the reserve requirement ratio.
 *
 * Formula: bankReserves / (totalDeposits + requestedPrincipal) >= reserveRequirement
 * Edge case: if totalDeposits + requestedPrincipal === 0, return true (no deposits yet).
 */
export function canIssueLoan(
  bankReserves: number,
  totalDeposits: number,
  requestedPrincipal: number,
  reserveRequirement: number,
): boolean {
  const denominator = totalDeposits + requestedPrincipal;
  if (denominator === 0) return true;
  return bankReserves / denominator >= reserveRequirement;
}

// ── processLoanRequest ────────────────────────────────────────────────────────

export type LoanRequestResult =
  | { loan: LoanContract; collateralAmount: number; borrowerWealthDelta: number }
  | { rejected: true; reason: string };

/**
 * Attempt to issue a loan from a bank agent to a borrower.
 *
 * M1 expansion: the borrower receives a deposit equal to the principal (new money).
 * Collateral: min(borrower.wealth * 0.5, principal) is escrowed from borrower's cash.
 *
 * Returns either the new loan + collateralAmount + borrowerWealthDelta, or a rejection.
 */
export function processLoanRequest(params: {
  bank: Agent;
  borrower: Agent;
  principal: number;
  economyConfig: EconomyConfig;
  currentDeposits: DepositAccount[];
  iterationNumber: number;
}): LoanRequestResult {
  const { bank, borrower, principal, economyConfig, currentDeposits, iterationNumber } = params;

  // Calculate total deposits at this bank
  const bankDeposits = currentDeposits.filter(d => d.bankAgentId === bank.id);
  const totalDeposits = bankDeposits.reduce((sum, d) => sum + d.balance, 0);

  // Reserve check — bank's wealth represents its M0 reserves
  const bankReserves = bank.currentStats.wealth;
  if (!canIssueLoan(bankReserves, totalDeposits, principal, economyConfig.reserveRequirement)) {
    return {
      rejected: true,
      reason: `Reserve requirement not met. Reserves: ${bankReserves}, totalDeposits+principal: ${totalDeposits + principal}, required ratio: ${economyConfig.reserveRequirement}`,
    };
  }

  // Collateral: min(borrower.wealth * 0.5, principal)
  const collateralAmount = Math.min(borrower.currentStats.wealth * 0.5, principal);

  // Create loan contract
  const loan: LoanContract = {
    id: uuidv4(),
    sessionId: borrower.sessionId,
    borrowerAgentId: borrower.id,
    lenderAgentId: bank.id,
    principal,
    interestRate: economyConfig.baseLoanInterestRate,
    termIterations: economyConfig.defaultLoanTermIterations,
    remainingBalance: principal,
    collateralAmount,
    consecutiveMissed: 0,
    issuedAtIteration: iterationNumber,
    dueAtIteration: iterationNumber + economyConfig.defaultLoanTermIterations,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  // Borrower wealth decreases by collateral (escrowed from cash-on-hand)
  const borrowerWealthDelta = -collateralAmount;

  return { loan, collateralAmount, borrowerWealthDelta };
}

// ── processRepayment ─────────────────────────────────────────────────────────

/**
 * Process a repayment payment on an active loan.
 *
 * Payment split:
 *  - interest = remainingBalance * interestRate (base money income to bank)
 *  - principalPaid = paymentAmount - interest (reduces M1)
 *
 * SFC:
 *  - depositDelta = -paymentAmount (borrower's M1 deposit decreases)
 *  - bankReservesDelta = +interest (bank gains base money)
 *  - loanAssets implicitly decrease by principalPaid (tracked via loanUpdate.remainingBalance)
 */
export function processRepayment(
  loan: LoanContract,
  borrowerDeposit: DepositAccount,
  paymentAmount: number,
): { loanUpdate: Partial<LoanContract>; depositDelta: number; bankReservesDelta: number } {
  const interest = loan.remainingBalance * loan.interestRate;
  const principalPaid = Math.max(0, paymentAmount - interest);
  const interestPaid = Math.min(paymentAmount, interest);

  const newRemainingBalance = Math.max(0, loan.remainingBalance - principalPaid);

  const loanUpdate: Partial<LoanContract> = {
    remainingBalance: newRemainingBalance,
    consecutiveMissed: 0,
  };

  if (newRemainingBalance <= 0) {
    loanUpdate.status = 'repaid';
    loanUpdate.remainingBalance = 0;
  }

  return {
    loanUpdate,
    depositDelta: -paymentAmount,
    bankReservesDelta: interestPaid,
  };
}

// ── accrueInterest ────────────────────────────────────────────────────────────

/**
 * Accrue interest on a loan for one iteration.
 *
 * If the borrower has sufficient deposit balance to pay interest:
 *  - depositDelta = -interest (M1 decreases)
 *  - bankReservesDelta = +interest (M0 transfers to bank)
 *  - consecutiveMissed resets to 0
 *
 * If borrower cannot pay:
 *  - depositDelta = 0, bankReservesDelta = 0 (no SFC movement)
 *  - consecutiveMissed increments
 */
export function accrueInterest(
  loan: LoanContract,
  borrowerDeposit: DepositAccount,
  _economyConfig: EconomyConfig,
): { depositDelta: number; bankReservesDelta: number; loanUpdate: Partial<LoanContract> } {
  const interest = loan.remainingBalance * loan.interestRate;

  if (borrowerDeposit.balance >= interest) {
    return {
      depositDelta: -interest,
      bankReservesDelta: interest,
      loanUpdate: { consecutiveMissed: 0 },
    };
  }

  // Borrower cannot pay interest
  return {
    depositDelta: 0,
    bankReservesDelta: 0,
    loanUpdate: { consecutiveMissed: loan.consecutiveMissed + 1 },
  };
}

// ── processDefault ────────────────────────────────────────────────────────────

/**
 * Process a loan default event.
 *
 * Sets loan status = 'defaulted'.
 * Transfers collateral from escrow to bank reserves.
 * Bank absorbs any remaining balance beyond collateral as a loss.
 */
export function processDefault(
  loan: LoanContract,
  _bankAgent: Agent,
): { loanUpdate: Partial<LoanContract>; bankWealthDelta: number; trace: string } {
  const loss = loan.remainingBalance - loan.collateralAmount;

  const trace = `[BANK] Loan ${loan.id} defaulted. Collateral ${loan.collateralAmount} seized. Bank loss: ${loss.toFixed(4)}`;

  return {
    loanUpdate: { status: 'defaulted' },
    bankWealthDelta: loan.collateralAmount,
    trace,
  };
}

// ── accrueDepositInterest ─────────────────────────────────────────────────────

/**
 * Pay deposit interest to all deposit account holders from bank reserves.
 *
 * If bank reserves are insufficient, pro-rate interest across all depositors
 * proportional to their balance share.
 *
 * SFC: bankReservesDelta = -totalInterestPaid (M0 transfers from bank to depositors).
 */
export function accrueDepositInterest(
  deposits: DepositAccount[],
  bankAgent: Agent,
  economyConfig: EconomyConfig,
): { depositUpdates: Array<{ id: string; newBalance: number }>; bankReservesDelta: number } {
  if (deposits.length === 0) {
    return { depositUpdates: [], bankReservesDelta: 0 };
  }

  const interestAmounts = deposits.map(d => d.balance * economyConfig.depositInterestRate);
  const totalInterest = interestAmounts.reduce((sum, i) => sum + i, 0);

  const bankReserves = bankAgent.currentStats.wealth;
  let totalInterestPaid: number;
  let scaleFactor: number;

  if (bankReserves >= totalInterest) {
    totalInterestPaid = totalInterest;
    scaleFactor = 1;
  } else {
    // Pro-rate: pay what we have
    totalInterestPaid = bankReserves;
    scaleFactor = totalInterest > 0 ? bankReserves / totalInterest : 0;
  }

  const depositUpdates = deposits.map((d, i) => ({
    id: d.id,
    newBalance: d.balance + interestAmounts[i] * scaleFactor,
  }));

  return {
    depositUpdates,
    bankReservesDelta: -totalInterestPaid,
  };
}

// ── processIteration ─────────────────────────────────────────────────────────

/**
 * Run the full per-iteration banking tick.
 *
 * Order of operations:
 *  1. Accrue interest on each active loan
 *  2. Check for defaults (consecutiveMissed >= defaultThresholdIterations)
 *  3. Accrue deposit interest
 *  4. Snapshot balance sheets for each bank agent
 *
 * All mutations are collected and returned as a BankingDelta. No direct DB writes.
 */
export function processIteration(params: {
  sessionId: string;
  bankAgents: Agent[];
  allAgents: Agent[];
  loans: LoanContract[];
  deposits: DepositAccount[];
  economyConfig: EconomyConfig;
  iterationNumber: number;
}): BankingDelta {
  const { sessionId, bankAgents, allAgents, loans, deposits, economyConfig, iterationNumber } = params;

  const delta: BankingDelta = {
    depositUpdates: [],
    loanUpdates: [],
    wealthDeltas: new Map(),
    newLoans: [],
    newDeposits: [],
    balanceSheetSnapshots: [],
    trace: [],
  };

  // Track running deposit balances for interest accrual (updated as we process)
  const depositBalances = new Map<string, number>(deposits.map(d => [d.id, d.balance]));
  // Track running bank wealth (reserves) for each bank
  const bankReserves = new Map<string, number>(
    bankAgents.map(b => [b.id, b.currentStats.wealth]),
  );

  // ── Step 1: Accrue interest on active loans ───────────────────────────────
  for (const loan of loans) {
    if (loan.status !== 'active') continue;

    const borrowerDeposit = deposits.find(d => d.ownerAgentId === loan.borrowerAgentId && d.bankAgentId === loan.lenderAgentId);
    if (!borrowerDeposit) continue;

    // Use running balance for this deposit
    const currentBalance = depositBalances.get(borrowerDeposit.id) ?? borrowerDeposit.balance;
    const interestResult = accrueInterest(
      loan,
      { ...borrowerDeposit, balance: currentBalance },
      economyConfig,
    );

    // Apply deposit delta
    if (interestResult.depositDelta !== 0) {
      const newBalance = currentBalance + interestResult.depositDelta;
      depositBalances.set(borrowerDeposit.id, newBalance);
      delta.depositUpdates.push({
        accountId: borrowerDeposit.id,
        newBalance,
        iteration: iterationNumber,
      });
    }

    // Apply bank reserves delta (interest income)
    if (interestResult.bankReservesDelta !== 0) {
      const prevReserves = bankReserves.get(loan.lenderAgentId) ?? 0;
      bankReserves.set(loan.lenderAgentId, prevReserves + interestResult.bankReservesDelta);
      // Also record as wealth delta for the bank agent
      const prev = delta.wealthDeltas.get(loan.lenderAgentId) ?? 0;
      delta.wealthDeltas.set(loan.lenderAgentId, prev + interestResult.bankReservesDelta);
    }

    delta.loanUpdates.push({ loanId: loan.id, updates: interestResult.loanUpdate });

    if (interestResult.loanUpdate.consecutiveMissed !== undefined && interestResult.loanUpdate.consecutiveMissed > 0) {
      delta.trace.push(`[BANK] Loan ${loan.id}: borrower ${loan.borrowerAgentId} missed interest payment (missed=${interestResult.loanUpdate.consecutiveMissed})`);
    }
  }

  // ── Step 2: Check for defaults ─────────────────────────────────────────────
  // Use updated consecutiveMissed values from step 1
  const updatedLoans = loans.map(loan => {
    const update = delta.loanUpdates.find(u => u.loanId === loan.id);
    if (!update) return loan;
    return { ...loan, ...update.updates };
  });

  for (const loan of updatedLoans) {
    if (loan.status !== 'active') continue;
    if ((loan.consecutiveMissed ?? 0) < economyConfig.defaultThresholdIterations) continue;

    const bankAgent = bankAgents.find(b => b.id === loan.lenderAgentId);
    if (!bankAgent) continue;

    const defaultResult = processDefault(loan, bankAgent);

    // Merge into existing loanUpdate or add new one
    const existingUpdate = delta.loanUpdates.find(u => u.loanId === loan.id);
    if (existingUpdate) {
      existingUpdate.updates = { ...existingUpdate.updates, ...defaultResult.loanUpdate };
    } else {
      delta.loanUpdates.push({ loanId: loan.id, updates: defaultResult.loanUpdate });
    }

    // Bank gains collateral
    if (defaultResult.bankWealthDelta !== 0) {
      const prevBankWealth = delta.wealthDeltas.get(loan.lenderAgentId) ?? 0;
      delta.wealthDeltas.set(loan.lenderAgentId, prevBankWealth + defaultResult.bankWealthDelta);
      bankReserves.set(loan.lenderAgentId, (bankReserves.get(loan.lenderAgentId) ?? 0) + defaultResult.bankWealthDelta);
    }

    delta.trace.push(defaultResult.trace);
  }

  // ── Step 3: Accrue deposit interest for each bank ─────────────────────────
  for (const bank of bankAgents) {
    const bankDeposits = deposits.filter(d => d.bankAgentId === bank.id);
    if (bankDeposits.length === 0) continue;

    // Use running balances
    const bankDepositsWithCurrentBalances = bankDeposits.map(d => ({
      ...d,
      balance: depositBalances.get(d.id) ?? d.balance,
    }));

    const currentBankReserves = bankReserves.get(bank.id) ?? bank.currentStats.wealth;
    const bankForInterest = { ...bank, currentStats: { ...bank.currentStats, wealth: currentBankReserves } };

    const depositInterestResult = accrueDepositInterest(bankDepositsWithCurrentBalances, bankForInterest, economyConfig);

    for (const update of depositInterestResult.depositUpdates) {
      depositBalances.set(update.id, update.newBalance);
      // Merge or add to depositUpdates
      const existing = delta.depositUpdates.find(u => u.accountId === update.id);
      if (existing) {
        existing.newBalance = update.newBalance;
      } else {
        delta.depositUpdates.push({ accountId: update.id, newBalance: update.newBalance, iteration: iterationNumber });
      }
    }

    if (depositInterestResult.bankReservesDelta !== 0) {
      const prevBankWealth = delta.wealthDeltas.get(bank.id) ?? 0;
      delta.wealthDeltas.set(bank.id, prevBankWealth + depositInterestResult.bankReservesDelta);
    }
  }

  // ── Step 4: Snapshot balance sheets ──────────────────────────────────────
  for (const bank of bankAgents) {
    const bankLoans = updatedLoans.filter(l => l.lenderAgentId === bank.id && l.status === 'active');
    const bankDepositAccounts = deposits.filter(d => d.bankAgentId === bank.id);

    const loanAssets = bankLoans.reduce((sum, l) => sum + l.remainingBalance, 0);
    const depositLiabilities = bankDepositAccounts.reduce((sum, d) => {
      const current = depositBalances.get(d.id) ?? d.balance;
      return sum + current;
    }, 0);

    const currentReserves = bankReserves.get(bank.id) ?? bank.currentStats.wealth;
    const equity = currentReserves + loanAssets - depositLiabilities;

    const sheet: BankBalanceSheet = {
      id: uuidv4(),
      sessionId,
      agentId: bank.id,
      iterationNumber,
      reserves: currentReserves,
      loanAssets,
      depositLiabilities,
      equity,
      timestamp: new Date().toISOString(),
    };

    delta.balanceSheetSnapshots.push(sheet);
    delta.trace.push(
      `[BANK] ${bank.id} B/S iter=${iterationNumber}: reserves=${currentReserves.toFixed(2)}, loanAssets=${loanAssets.toFixed(2)}, depositLiabilities=${depositLiabilities.toFixed(2)}, equity=${equity.toFixed(2)}`,
    );
  }

  return delta;
}
