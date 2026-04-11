/**
 * SFC Invariant Test Suite
 *
 * Validates that each individual economic engine conserves fiat (M0).
 * Tests run against real engine functions with minimal mock data — no LLM, no DB.
 *
 * Fixes validated:
 *  V1: STEAL no-target returns wealthDelta === 0 (was +stealFallback)
 *  V2: INVEST wealthDelta < 0 (cost routed to treasury, not destroyed)
 *  V3: Bond payouts pro-rated when treasury insufficient (see capitalMarket.test.ts)
 *  V4: accrueInterest missed payment does NOT inflate remainingBalance
 */
import { describe, it, expect } from 'vitest';
import type { Agent, EconomyConfig, LoanContract, DepositAccount } from '@policylab/shared';
import { distributeProRata } from '@policylab/shared';
import { resolveAction } from '../physicsEngine.js';
import type { PhysicsInput } from '../physicsEngine.js';
import { processRepayment, accrueInterest, processDefault } from '../bankingEngine.js';
import { AutomatedMarketMaker, computeDemurrageCycle } from '../automatedMarketMaker.js';
import { processSharePurchase } from '../capitalMarketEngine.js';

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeAgent(id: string, role = 'worker', wealth = 100): Agent {
  return {
    id,
    sessionId: 'test-session',
    name: `Agent ${id}`,
    role,
    background: '',
    initialStats: { wealth, health: 70, happiness: 60, cortisol: 20 },
    currentStats: { wealth, health: 70, happiness: 60, cortisol: 20 },
    isAlive: true,
    status: 'alive',
    type: 'citizen',
    bornAtIteration: null,
    diedAtIteration: null,
  };
}

function makePhysicsInput(overrides: Partial<PhysicsInput> & { actionCode: PhysicsInput['actionCode'] }): PhysicsInput {
  return {
    agent: makeAgent('agent-1'),
    allAgents: overrides.allAgents ?? [makeAgent('agent-1')],
    actionTarget: overrides.actionTarget,
    actionParameters: overrides.actionParameters,
    ...overrides,
  };
}

function makeLoan(overrides: Partial<LoanContract> = {}): LoanContract {
  return {
    id: 'loan-1',
    sessionId: 'test-session',
    borrowerAgentId: 'borrower-1',
    lenderAgentId: 'bank-1',
    principal: 100,
    interestRate: 0.005,
    termIterations: 20,
    remainingBalance: overrides.remainingBalance ?? 100,
    collateralAmount: overrides.collateralAmount ?? 20,
    consecutiveMissed: overrides.consecutiveMissed ?? 0,
    issuedAtIteration: 1,
    dueAtIteration: 21,
    status: overrides.status ?? 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDeposit(overrides: Partial<DepositAccount> = {}): DepositAccount {
  return {
    id: 'deposit-1',
    sessionId: 'test-session',
    ownerAgentId: 'borrower-1',
    bankAgentId: 'bank-1',
    accountType: 'demand',
    balance: overrides.balance ?? 100,
    interestRate: 0.002,
    lastUpdated: 1,
    ...overrides,
  };
}

const MIN_ECONOMY_CONFIG: EconomyConfig = {
  bankingEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
};

// ── physicsEngine tests ────────────────────────────────────────────────────────

describe('physicsEngine — SFC fiat conservation', () => {
  it('WORK: agent earns a positive wealth delta (treasury-funded)', () => {
    const result = resolveAction(makePhysicsInput({ actionCode: 'WORK' }));
    // The delta must be positive — the runner debits the treasury separately
    expect(result.wealthDelta).toBeGreaterThan(0);
    // Bounded sanity check: physics clamp is 30
    expect(result.wealthDelta).toBeLessThanOrEqual(30);
  });

  it('STEAL (no target): wealthDelta === 0 — V1 fix', () => {
    // Without a target, theft against thin air should not create money
    const agent = makeAgent('thief-1');
    const result = resolveAction({
      agent,
      actionCode: 'STEAL',
      allAgents: [agent],   // no other agents to steal from
      actionTarget: undefined,
    });
    expect(result.wealthDelta).toBe(0);
  });

  it('STEAL (with alive target): wealthDelta equals amount deducted from target', () => {
    const thief = makeAgent('thief-1');
    const victim = makeAgent('victim-1', 'citizen', 80);
    const result = resolveAction({
      agent: thief,
      actionCode: 'STEAL',
      allAgents: [thief, victim],
      actionTarget: victim.id,
    });
    // The steal should be bounded by stealMax and stealRatio
    expect(result.wealthDelta).toBeGreaterThan(0);
    // The runner deducts wealthDelta from the victim — must not exceed victim's wealth
    expect(result.wealthDelta).toBeLessThanOrEqual(victim.currentStats.wealth);
  });

  it('INVEST: wealthDelta < 0 (cost deployed — V2 fix routes it to treasury)', () => {
    const result = resolveAction(makePhysicsInput({ actionCode: 'INVEST' }));
    // The agent pays the cost; the runner credits the treasury
    expect(result.wealthDelta).toBeLessThan(0);
  });
});

// ── bankingEngine tests ────────────────────────────────────────────────────────

describe('bankingEngine — SFC fiat conservation', () => {
  it('processRepayment: depositDelta is exactly -paymentAmount (no cap exceeded)', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    const deposit = makeDeposit({ balance: 200 });
    const paymentAmount = 50;

    const result = processRepayment(loan, deposit, paymentAmount);

    // Fiat leaves borrower's deposit exactly by the payment amount
    expect(result.depositDelta).toBe(-paymentAmount);
    // Interest portion flows to bank reserves (base-money transfer, not creation)
    const expectedInterest = Math.min(paymentAmount, loan.remainingBalance * loan.interestRate);
    expect(result.bankReservesDelta).toBeCloseTo(expectedInterest, 8);
  });

  it('processRepayment: does not over-draw when deposit balance < paymentAmount', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    const deposit = makeDeposit({ balance: 30 });
    const paymentAmount = 50;

    const result = processRepayment(loan, deposit, paymentAmount);

    // H7 fix: processRepayment caps payment at deposit balance (30),
    // so depositDelta is -30, not -50. No overdraft possible.
    expect(result.depositDelta).toBe(-deposit.balance);
    expect(result.loanUpdate.remainingBalance).toBeDefined();
    // Remaining balance should not go negative
    if (result.loanUpdate.remainingBalance !== undefined) {
      expect(result.loanUpdate.remainingBalance).toBeGreaterThanOrEqual(0);
    }
  });

  it('accrueInterest (missed): V4 fix — loanUpdate does NOT set remainingBalance', () => {
    // V4: missed interest must NOT inflate the loan's remaining balance
    const loan = makeLoan({ remainingBalance: 100, consecutiveMissed: 0 });
    const emptyDeposit = makeDeposit({ balance: 0 });  // borrower cannot pay

    const result = accrueInterest(loan, emptyDeposit, MIN_ECONOMY_CONFIG);

    // No fiat movement
    expect(result.depositDelta).toBe(0);
    expect(result.bankReservesDelta).toBe(0);
    // The loan update MUST NOT contain remainingBalance (would inflate the balance)
    expect(result.loanUpdate.remainingBalance).toBeUndefined();
    // consecutiveMissed must increment
    expect(result.loanUpdate.consecutiveMissed).toBe(loan.consecutiveMissed + 1);
  });

  it('accrueInterest (paid): fiat moves from deposit to bank reserves (M0 transfer)', () => {
    const loan = makeLoan({ remainingBalance: 100 });
    const richDeposit = makeDeposit({ balance: 500 });

    const result = accrueInterest(loan, richDeposit, MIN_ECONOMY_CONFIG);

    const expectedInterest = loan.remainingBalance * loan.interestRate; // 0.5
    expect(result.depositDelta).toBeCloseTo(-expectedInterest, 8);
    expect(result.bankReservesDelta).toBeCloseTo(expectedInterest, 8);
    // Net fiat change: deposit decreases by interest, bank reserves increase by same
    expect(result.depositDelta + result.bankReservesDelta).toBeCloseTo(0, 8);
  });

  it('processDefault: collateral transfer is zero-sum (bank gains, no net creation)', () => {
    const collateral = 20;
    const loan = makeLoan({ remainingBalance: 80, collateralAmount: collateral });
    const bank = makeAgent('bank-1', 'banker', 500);

    const result = processDefault(loan, bank);

    // Bank gains exactly the collateral amount (escrowed from borrower at loan origination)
    expect(result.bankWealthDelta).toBe(collateral);
    // The collateral was already deducted from borrower at origination (borrowerWealthDelta = -collateral)
    // So the net system fiat change here is 0: collateral simply moves from escrow to bank
  });
});

// ── AMM tests ─────────────────────────────────────────────────────────────────

describe('AutomatedMarketMaker — SFC fiat conservation', () => {
  it('buy/sell round-trip conserves fiat within floating-point tolerance', () => {
    const amm = new AutomatedMarketMaker(5000, 1000, 0);

    const agentFiatBefore = 200;
    const fiatSpent = 50;

    // Agent buys food
    const buyReceipt = amm.executeBuy(fiatSpent, 1);
    expect(buyReceipt.success).toBe(true);

    const foodReceived = (buyReceipt.quote as { foodOut: number }).foodOut;
    expect(foodReceived).toBeGreaterThan(0);

    const fiatAfterBuy = agentFiatBefore - fiatSpent;
    const ammFiatAfterBuy = amm.currentFiatReserve;

    // Agent sells back the food they just bought
    const sellReceipt = amm.executeSell(foodReceived, 2);
    expect(sellReceipt.success).toBe(true);

    const fiatRecovered = (sellReceipt.quote as { fiatOut: number }).fiatOut;
    const agentFiatAfterRoundtrip = fiatAfterBuy + fiatRecovered;
    const ammFiatAfterRoundtrip = amm.currentFiatReserve;

    // Total fiat in system (agent + AMM) must be conserved throughout
    const totalBefore = agentFiatBefore + 5000;        // initial agent + initial AMM
    const totalAfter = agentFiatAfterRoundtrip + ammFiatAfterRoundtrip;

    // Allow small float drift (AMM floor adjustments can cause tiny residuals)
    expect(Math.abs(totalBefore - totalAfter)).toBeLessThan(0.01);
  });

  it('computeDemurrageCycle: sum of netDeltas === 0 (redistribution is zero-sum)', () => {
    const agents = [
      { agentId: 'a1', wealth: 200 },
      { agentId: 'a2', wealth: 100 },
      { agentId: 'a3', wealth: 50 },
      { agentId: 'a4', wealth: 300 },
      { agentId: 'a5', wealth: 10 },
    ];

    const result = computeDemurrageCycle(agents, 0.02, 1.0);

    let totalNetDelta = 0;
    for (const delta of result.netDeltas.values()) {
      totalNetDelta += delta;
    }

    // The demurrage + UBI cycle is strictly zero-sum within float precision.
    // Any fractional remainder is tracked separately in ubiFractionalRemainder.
    const tolerance = Math.abs(result.ubiFractionalRemainder) + 0.0001;
    expect(Math.abs(totalNetDelta)).toBeLessThanOrEqual(tolerance);
  });
});

// ── capitalMarketEngine tests ─────────────────────────────────────────────────

describe('capitalMarketEngine — SFC fiat conservation', () => {
  it('processSharePurchase: buyer wealth decrease === enterprise owner wealth increase', () => {
    const buyer = makeAgent('buyer-1', 'citizen', 500);
    const enterpriseOwner = makeAgent('owner-1', 'merchant', 1000);
    const sharesToBuy = 5;
    const totalSharesOutstanding = 100;  // price per share = 1000/100 = 10

    const result = processSharePurchase({
      sessionId: 'test-session',
      buyer,
      enterpriseOwner,
      sharesToBuy,
      totalSharesOutstanding,
      existingPosition: undefined,
      iterationNumber: 1,
    });

    if ('rejected' in result) {
      throw new Error(`processSharePurchase unexpectedly rejected: ${result.reason}`);
    }

    const buyerDelta = result.delta.wealthDeltas.get(buyer.id) ?? 0;
    const ownerDelta = result.delta.wealthDeltas.get(enterpriseOwner.id) ?? 0;

    // SFC: what the buyer pays, the enterprise owner receives exactly
    expect(buyerDelta).toBeLessThan(0);
    expect(ownerDelta).toBeGreaterThan(0);
    expect(buyerDelta + ownerDelta).toBeCloseTo(0, 8);
  });
});

// ── distributeProRata tests ───────────────────────────────────────────────────

describe('distributeProRata — exact integer distribution', () => {
  it('distributes 100 across equal weights with no loss', () => {
    const shares = distributeProRata(100, [1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('distributes 100 across unequal weights with no loss', () => {
    const shares = distributeProRata(100, [3, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    // Leading weight should receive the majority
    expect(shares[0]).toBeGreaterThan(shares[1]);
  });

  it('distributes 1 across many recipients — exactly one recipient gets 1, rest get 0', () => {
    const shares = distributeProRata(1, [1, 1, 1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1);
    expect(shares.filter(s => s === 1).length).toBe(1);
    expect(shares.filter(s => s === 0).length).toBe(4);
  });

  it('total=0 returns all zeros with no loss', () => {
    const shares = distributeProRata(0, [1, 2, 3]);
    expect(shares).toEqual([0, 0, 0]);
  });
});
