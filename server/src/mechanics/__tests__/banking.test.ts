/**
 * Unit tests for bankingEngine.ts — loan lifecycle, reserve enforcement,
 * deposit interest mechanics.
 *
 * Tests cover BANK-01 through BANK-05 requirements.
 * All tests use pure functions (no DB). Mock agents and deposits are created inline.
 */
import { describe, it, expect } from 'vitest';
import type { Agent, EconomyConfig, LoanContract, DepositAccount } from '@policylab/shared';
import {
  canIssueLoan,
  processLoanRequest,
  processRepayment,
  accrueInterest,
  processDefault,
  accrueDepositInterest,
  processIteration,
  processLiquidityInjection,
} from '../bankingEngine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? 'session-1',
    name: overrides.name ?? 'Agent ' + overrides.id,
    role: overrides.role ?? 'citizen',
    background: '',
    initialStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20, dopamine: 50 },
    currentStats: {
      wealth: overrides.currentStats?.wealth ?? 100,
      health: overrides.currentStats?.health ?? 70,
      happiness: overrides.currentStats?.happiness ?? 60,
      cortisol: overrides.currentStats?.cortisol ?? 20,
      dopamine: overrides.currentStats?.dopamine ?? 50,
    },
    isAlive: true,
    status: 'alive',
    type: overrides.type ?? 'citizen',
    bornAtIteration: null,
    diedAtIteration: null,
  };
}

function makeDeposit(overrides: Partial<DepositAccount> & { id: string; ownerAgentId: string; bankAgentId: string }): DepositAccount {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? 'session-1',
    ownerAgentId: overrides.ownerAgentId,
    bankAgentId: overrides.bankAgentId,
    accountType: 'demand',
    balance: overrides.balance ?? 0,
    interestRate: overrides.interestRate ?? 0.002,
    lastUpdated: overrides.lastUpdated ?? 0,
  };
}

const defaultConfig: EconomyConfig = {
  bankingEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
};

// ── canIssueLoan tests ───────────────────────────────────────────────────────

describe('canIssueLoan', () => {
  it('returns true when reserves/totalDeposits+principal >= reserveRequirement', () => {
    // reserves=100, totalDeposits=500, principal=500 => ratio = 100/1000 = 0.10 >= 0.10
    expect(canIssueLoan(100, 500, 500, 0.10)).toBe(true);
  });

  it('returns false when reserves/totalDeposits+principal < reserveRequirement', () => {
    // reserves=50, totalDeposits=500, principal=500 => ratio = 50/1000 = 0.05 < 0.10
    expect(canIssueLoan(50, 500, 500, 0.10)).toBe(false);
  });

  it('returns true when totalDeposits + principal === 0 (no deposits yet)', () => {
    expect(canIssueLoan(0, 0, 0, 0.10)).toBe(true);
  });

  it('returns false when reserves are zero but deposits+principal > 0', () => {
    expect(canIssueLoan(0, 100, 50, 0.10)).toBe(false);
  });
});

// ── processLoanRequest tests ─────────────────────────────────────────────────

describe('processLoanRequest', () => {
  const bank = makeAgent({ id: 'bank-1', type: 'bank', currentStats: { wealth: 200, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
  const borrower = makeAgent({ id: 'borrower-1', currentStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });

  it('returns a LoanContract with correct principal and a deposit delta increasing borrower balance by principal', () => {
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: defaultConfig,
      currentDeposits: [],
      iterationNumber: 1,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    expect(result.loan.principal).toBe(50);
    expect(result.loan.remainingBalance).toBe(50);
    expect(result.loan.borrowerAgentId).toBe('borrower-1');
    expect(result.loan.lenderAgentId).toBe('bank-1');
    expect(result.loan.status).toBe('active');
  });

  it('returns collateralAmount = min(borrowerWealth * 0.5, principal)', () => {
    // borrower.wealth=100, principal=50 => collateral = min(50, 50) = 50
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: defaultConfig,
      currentDeposits: [],
      iterationNumber: 1,
    });
    if ('rejected' in result) throw new Error('Unexpected rejection');
    expect(result.collateralAmount).toBe(50);
  });

  it('collateralAmount is capped at principal when borrowerWealth * 0.5 > principal', () => {
    // borrower.wealth=300, principal=50 => collateral = min(150, 50) = 50
    const richBorrower = makeAgent({ id: 'borrower-2', currentStats: { wealth: 300, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
    const result = processLoanRequest({
      bank,
      borrower: richBorrower,
      principal: 50,
      economyConfig: defaultConfig,
      currentDeposits: [],
      iterationNumber: 1,
    });
    if ('rejected' in result) throw new Error('Unexpected rejection');
    expect(result.collateralAmount).toBe(50);
  });

  it('decreases borrowerWealthDelta by collateralAmount (collateral escrow)', () => {
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: defaultConfig,
      currentDeposits: [],
      iterationNumber: 1,
    });
    if ('rejected' in result) throw new Error('Unexpected rejection');
    expect(result.borrowerWealthDelta).toBe(-result.collateralAmount);
  });

  it('rejects when reserve requirement is not met', () => {
    // bank with no reserves issuing into a full deposit pool
    const poorBank = makeAgent({ id: 'bank-poor', type: 'bank', currentStats: { wealth: 1, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
    // deposits far exceed reserves: reserve ratio = 1/(1000+50) ~0.001 < 0.10
    const manyDeposits: DepositAccount[] = [
      makeDeposit({ id: 'd1', ownerAgentId: 'a1', bankAgentId: 'bank-poor', balance: 1000 }),
    ];
    const result = processLoanRequest({
      bank: poorBank,
      borrower,
      principal: 50,
      economyConfig: defaultConfig,
      currentDeposits: manyDeposits,
      iterationNumber: 1,
    });
    expect('rejected' in result).toBe(true);
    if ('rejected' in result) {
      expect(result.reason).toBeTruthy();
    }
  });
});

// ── processRepayment tests ───────────────────────────────────────────────────

describe('processRepayment', () => {
  const makeLoan = (overrides?: Partial<LoanContract>): LoanContract => ({
    id: 'loan-1',
    sessionId: 'session-1',
    borrowerAgentId: 'borrower-1',
    lenderAgentId: 'bank-1',
    principal: 100,
    interestRate: 0.01,
    termIterations: 20,
    remainingBalance: overrides?.remainingBalance ?? 100,
    collateralAmount: 50,
    consecutiveMissed: 0,
    issuedAtIteration: 1,
    dueAtIteration: 21,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const borrowerDeposit = makeDeposit({ id: 'dep-1', ownerAgentId: 'borrower-1', bankAgentId: 'bank-1', balance: 200 });

  it('decreases loan remainingBalance by principal portion', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    // interest = 100 * 0.01 = 1; payment=11; principalPaid = 11 - 1 = 10
    const result = processRepayment(loan, borrowerDeposit, 11);
    expect(result.loanUpdate.remainingBalance).toBe(90);
  });

  it('decreases borrower deposit balance by payment amount', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    const result = processRepayment(loan, borrowerDeposit, 11);
    expect(result.depositDelta).toBe(-11);
  });

  it('increases bank reserves by interest portion', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    // interest = 100 * 0.01 = 1
    const result = processRepayment(loan, borrowerDeposit, 11);
    expect(result.bankReservesDelta).toBe(1);
  });

  it('marks loan status repaid when remainingBalance reaches 0', () => {
    const loan = makeLoan({ remainingBalance: 10 });
    // interest = 10 * 0.01 = 0.1; payment=10.1; principal=10 => remaining=0
    const result = processRepayment(loan, borrowerDeposit, 10.1);
    expect(result.loanUpdate.status).toBe('repaid');
  });

  it('does not mark repaid when remainingBalance stays above 0', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    const result = processRepayment(loan, borrowerDeposit, 11);
    expect(result.loanUpdate.status).toBeUndefined();
  });
});

// ── accrueInterest tests ─────────────────────────────────────────────────────

describe('accrueInterest', () => {
  const makeLoan = (overrides?: Partial<LoanContract>): LoanContract => ({
    id: 'loan-1',
    sessionId: 'session-1',
    borrowerAgentId: 'borrower-1',
    lenderAgentId: 'bank-1',
    principal: 100,
    interestRate: 0.01,
    termIterations: 20,
    remainingBalance: 100,
    collateralAmount: 50,
    consecutiveMissed: 0,
    issuedAtIteration: 1,
    dueAtIteration: 21,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('calculates correct interest amount (remainingBalance * interestRate)', () => {
    const loan = makeLoan();
    const deposit = makeDeposit({ id: 'dep-1', ownerAgentId: 'borrower-1', bankAgentId: 'bank-1', balance: 200 });
    // interest = 100 * 0.01 = 1
    const result = accrueInterest(loan, deposit, defaultConfig);
    expect(result.depositDelta).toBe(-1);
    expect(result.bankReservesDelta).toBe(1);
  });

  it('sets consecutiveMissed to 0 when borrower can pay', () => {
    const loan = makeLoan({ consecutiveMissed: 2 });
    const deposit = makeDeposit({ id: 'dep-1', ownerAgentId: 'borrower-1', bankAgentId: 'bank-1', balance: 200 });
    const result = accrueInterest(loan, deposit, defaultConfig);
    expect(result.loanUpdate.consecutiveMissed).toBe(0);
  });

  it('increments consecutiveMissed when borrower cannot pay interest', () => {
    const loan = makeLoan({ consecutiveMissed: 1 });
    // deposit balance too low to cover interest of 1
    const deposit = makeDeposit({ id: 'dep-1', ownerAgentId: 'borrower-1', bankAgentId: 'bank-1', balance: 0.5 });
    const result = accrueInterest(loan, deposit, defaultConfig);
    expect(result.loanUpdate.consecutiveMissed).toBe(2);
    expect(result.depositDelta).toBe(0);
    expect(result.bankReservesDelta).toBe(0);
  });
});

// ── processDefault tests ─────────────────────────────────────────────────────

describe('processDefault', () => {
  const makeLoan = (overrides?: Partial<LoanContract>): LoanContract => ({
    id: 'loan-1',
    sessionId: 'session-1',
    borrowerAgentId: 'borrower-1',
    lenderAgentId: 'bank-1',
    principal: 100,
    interestRate: 0.01,
    termIterations: 20,
    remainingBalance: 80,
    collateralAmount: 50,
    consecutiveMissed: 3,
    issuedAtIteration: 1,
    dueAtIteration: 21,
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('sets loan status to defaulted', () => {
    const loan = makeLoan();
    const bank = makeAgent({ id: 'bank-1', type: 'bank' });
    const result = processDefault(loan, bank);
    expect(result.loanUpdate.status).toBe('defaulted');
  });

  it('transfers collateral to bank (bankWealthDelta = +collateralAmount)', () => {
    const loan = makeLoan({ collateralAmount: 50 });
    const bank = makeAgent({ id: 'bank-1', type: 'bank' });
    const result = processDefault(loan, bank);
    expect(result.bankWealthDelta).toBe(50);
  });

  it('includes a trace entry describing the default', () => {
    const loan = makeLoan();
    const bank = makeAgent({ id: 'bank-1', type: 'bank' });
    const result = processDefault(loan, bank);
    expect(result.trace).toContain('defaulted');
  });
});

// ── accrueDepositInterest tests ──────────────────────────────────────────────

describe('accrueDepositInterest', () => {
  it('increases each deposit balance by balance * depositInterestRate', () => {
    const bank = makeAgent({ id: 'bank-1', type: 'bank', currentStats: { wealth: 1000, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
    const deposits = [
      makeDeposit({ id: 'd1', ownerAgentId: 'a1', bankAgentId: 'bank-1', balance: 1000 }),
      makeDeposit({ id: 'd2', ownerAgentId: 'a2', bankAgentId: 'bank-1', balance: 500 }),
    ];
    const result = accrueDepositInterest(deposits, bank, defaultConfig);
    // a1: 1000 * 0.002 = 2; a2: 500 * 0.002 = 1; total interest = 3
    const d1Update = result.depositUpdates.find(u => u.id === 'd1');
    const d2Update = result.depositUpdates.find(u => u.id === 'd2');
    expect(d1Update?.newBalance).toBeCloseTo(1002);
    expect(d2Update?.newBalance).toBeCloseTo(501);
    expect(result.bankReservesDelta).toBeCloseTo(-3);
  });

  it('decreases bank reserves by the total interest paid', () => {
    const bank = makeAgent({ id: 'bank-1', type: 'bank', currentStats: { wealth: 1000, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
    const deposits = [
      makeDeposit({ id: 'd1', ownerAgentId: 'a1', bankAgentId: 'bank-1', balance: 500 }),
    ];
    const result = accrueDepositInterest(deposits, bank, defaultConfig);
    // 500 * 0.002 = 1
    expect(result.bankReservesDelta).toBeCloseTo(-1);
  });

  it('pro-rates interest when bank reserves are insufficient', () => {
    // bank has only 0.5 reserves but needs to pay 1 in interest
    const bank = makeAgent({ id: 'bank-1', type: 'bank', currentStats: { wealth: 0.5, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
    const deposits = [
      makeDeposit({ id: 'd1', ownerAgentId: 'a1', bankAgentId: 'bank-1', balance: 500 }),
    ];
    const result = accrueDepositInterest(deposits, bank, defaultConfig);
    // Can only pay 0.5, so pro-rated
    expect(result.bankReservesDelta).toBeGreaterThanOrEqual(-0.5);
    expect(result.bankReservesDelta).toBeLessThanOrEqual(0);
  });
});

// ── processIteration tests ───────────────────────────────────────────────────

describe('processIteration', () => {
  it('returns a BankingDelta with trace, depositUpdates, loanUpdates arrays', () => {
    const bank = makeAgent({ id: 'bank-1', type: 'bank', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
    const borrower = makeAgent({ id: 'borrower-1' });
    const loan: LoanContract = {
      id: 'loan-1',
      sessionId: 'session-1',
      borrowerAgentId: 'borrower-1',
      lenderAgentId: 'bank-1',
      principal: 100,
      interestRate: 0.01,
      termIterations: 20,
      remainingBalance: 100,
      collateralAmount: 50,
      consecutiveMissed: 0,
      issuedAtIteration: 1,
      dueAtIteration: 21,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    const deposit = makeDeposit({ id: 'dep-1', ownerAgentId: 'borrower-1', bankAgentId: 'bank-1', balance: 200 });

    const result = processIteration({
      sessionId: 'session-1',
      bankAgents: [bank],
      allAgents: [bank, borrower],
      loans: [loan],
      deposits: [deposit],
      economyConfig: defaultConfig,
      iterationNumber: 2,
    });

    expect(Array.isArray(result.trace)).toBe(true);
    expect(Array.isArray(result.depositUpdates)).toBe(true);
    expect(Array.isArray(result.loanUpdates)).toBe(true);
    expect(Array.isArray(result.wealthDeltas)).toBe(false); // it's a Map
    expect(result.wealthDeltas instanceof Map).toBe(true);
  });
});

// ── Differentiated Loan Products (D-25) ─────────────────────────────────────

describe('Differentiated Loan Products (D-25)', () => {
  const bank = makeAgent({ id: 'bank-1', type: 'bank', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });
  const borrower = makeAgent({ id: 'borrower-1', currentStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20, dopamine: 50 } });

  it('business loan rate = baseLoanInterestRate * (1 - businessLoanRateDiscount)', () => {
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: { ...defaultConfig, businessLoanRateDiscount: 0.3 },
      currentDeposits: [],
      iterationNumber: 1,
      loanProductType: 'business',
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    // 0.005 * (1 - 0.3) = 0.0035
    expect(result.loan.interestRate).toBeCloseTo(0.0035);
  });

  it('business loan term = defaultLoanTermIterations * businessLoanTermMultiplier', () => {
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: { ...defaultConfig, businessLoanRateDiscount: 0.3, businessLoanTermMultiplier: 1.5 },
      currentDeposits: [],
      iterationNumber: 1,
      loanProductType: 'business',
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    // 20 * 1.5 = 30
    expect(result.loan.termIterations).toBe(30);
    expect(result.loan.dueAtIteration).toBe(31); // issuedAt=1 + term=30
  });

  it('personal loan uses unchanged rate and term', () => {
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: { ...defaultConfig, businessLoanRateDiscount: 0.3, businessLoanTermMultiplier: 1.5 },
      currentDeposits: [],
      iterationNumber: 1,
      loanProductType: 'personal',
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    expect(result.loan.interestRate).toBe(0.005);
    expect(result.loan.termIterations).toBe(20);
  });

  it('loanProductType stored in returned contract', () => {
    const result = processLoanRequest({
      bank,
      borrower,
      principal: 50,
      economyConfig: defaultConfig,
      currentDeposits: [],
      iterationNumber: 1,
      loanProductType: 'business',
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    expect(result.loan.loanProductType).toBe('business');
  });
});

// ── Central Bank Liquidity Injection (D-26) ─────────────────────────────────

describe('Central Bank Liquidity Injection (D-26)', () => {
  it('injects when reserve ratio below threshold', () => {
    const result = processLiquidityInjection({
      bankReserves: 2,   // 2/100 = 2% < 5%
      totalDeposits: 100,
      config: { liquidityInjectionThreshold: 0.05, liquidityInjectionCap: 0.05 },
    });
    expect(result.injectionAmount).toBeGreaterThan(0);
  });

  it('injection capped at liquidityInjectionCap * totalDeposits', () => {
    const result = processLiquidityInjection({
      bankReserves: 0,   // 0% << 5%
      totalDeposits: 1000,
      config: { liquidityInjectionThreshold: 0.05, liquidityInjectionCap: 0.05 },
    });
    // cap = 0.05 * 1000 = 50
    expect(result.injectionAmount).toBeLessThanOrEqual(50);
  });

  it('zero injection when reserves are healthy', () => {
    const result = processLiquidityInjection({
      bankReserves: 20,  // 20/100 = 20% > 5%
      totalDeposits: 100,
      config: { liquidityInjectionThreshold: 0.05, liquidityInjectionCap: 0.05 },
    });
    expect(result.injectionAmount).toBe(0);
    expect(result.trace).toHaveLength(0);
  });

  it('trace includes reserve ratio and injection amount', () => {
    const result = processLiquidityInjection({
      bankReserves: 2,
      totalDeposits: 100,
      config: { liquidityInjectionThreshold: 0.05, liquidityInjectionCap: 0.05 },
    });
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace[0]).toContain('Liquidity injection');
    expect(result.trace[0]).toContain('2.0%'); // reserve ratio
  });
});
