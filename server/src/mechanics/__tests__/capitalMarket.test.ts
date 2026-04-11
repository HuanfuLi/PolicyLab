/**
 * Unit tests for capitalMarketEngine.ts — equity positions and bond holdings.
 *
 * Tests cover CMKT-01 through CMKT-05 requirements.
 * All tests use pure functions (no DB). Mock agents and positions are created inline.
 *
 * CMKT-01: Share purchase — buyer wealth → enterprise owner wealth
 * CMKT-02: Share sale — reverse of purchase
 * CMKT-03: Dividend distribution — pro-rata from enterprise owner to shareholders
 * CMKT-04: Government bond purchase and coupon/maturity
 * CMKT-05: Corporate bond issuance and coupon/maturity
 */
import { describe, it, expect } from 'vitest';
import type { Agent, EconomyConfig, EquityPosition, BondHolding } from '@policylab/shared';
import {
  processSharePurchase,
  processShareSale,
  distributeDividends,
  processGovBondPurchase,
  processCorpBondIssuance,
  processCoupons,
  processMaturities,
  processIteration,
} from '../capitalMarketEngine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? 'session-1',
    name: overrides.name ?? 'Agent ' + overrides.id,
    role: overrides.role ?? 'citizen',
    background: '',
    initialStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20 },
    currentStats: {
      wealth: overrides.currentStats?.wealth ?? 100,
      health: overrides.currentStats?.health ?? 70,
      happiness: overrides.currentStats?.happiness ?? 60,
      cortisol: overrides.currentStats?.cortisol ?? 20,
    },
    isAlive: true,
    status: 'alive',
    type: overrides.type ?? 'citizen',
    bornAtIteration: null,
    diedAtIteration: null,
  };
}

const defaultConfig: EconomyConfig = {
  bankingEnabled: true,
  capitalMarketsEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
  dividendPayoutRatio: 0.10,   // 10% of owner wealth per iteration
  govBondCouponRate: 0.008,
  govBondTermIterations: 10,
};

function makeEquityPosition(overrides: Partial<EquityPosition> & { id: string; ownerAgentId: string; enterpriseOwnerId: string }): EquityPosition {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? 'session-1',
    ownerAgentId: overrides.ownerAgentId,
    enterpriseOwnerId: overrides.enterpriseOwnerId,
    sharesHeld: overrides.sharesHeld ?? 0,
    averageCostBasis: overrides.averageCostBasis ?? 0,
    lastUpdated: overrides.lastUpdated ?? 0,
  };
}

function makeBondHolding(overrides: Partial<BondHolding> & { id: string; ownerAgentId: string; issuerId: string }): BondHolding {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? 'session-1',
    ownerAgentId: overrides.ownerAgentId,
    issuerId: overrides.issuerId,
    bondType: overrides.bondType ?? 'government',
    faceValue: overrides.faceValue ?? 100,
    couponRate: overrides.couponRate ?? 0.008,
    maturityIteration: overrides.maturityIteration ?? 10,
    purchaseIteration: overrides.purchaseIteration ?? 1,
    status: overrides.status ?? 'active',
  };
}

// ── CMKT-01: Share Purchase ───────────────────────────────────────────────────

describe('processSharePurchase', () => {
  it('transfers wealth from buyer to enterprise owner (SFC neutral)', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 200, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    // Enterprise has 100 shares outstanding, so price = 500 / 100 = 5 fiat/share
    const sharesToBuy = 10;

    const result = processSharePurchase({
      sessionId: 'session-1',
      buyer,
      enterpriseOwner,
      sharesToBuy,
      totalSharesOutstanding: 100,
      existingPosition: undefined,
      iterationNumber: 1,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    const totalCost = result.delta.wealthDeltas.get('buyer') ?? 0;
    const ownerGain = result.delta.wealthDeltas.get('owner') ?? 0;

    // SFC: buyer loses, owner gains equal amount
    expect(totalCost).toBeLessThan(0);
    expect(ownerGain).toBeGreaterThan(0);
    expect(totalCost + ownerGain).toBe(0);

    // Equity position created
    expect(result.delta.upsertEquityPositions).toHaveLength(1);
    expect(result.delta.upsertEquityPositions[0].sharesHeld).toBe(sharesToBuy);
    expect(result.delta.upsertEquityPositions[0].ownerAgentId).toBe('buyer');
    expect(result.delta.upsertEquityPositions[0].enterpriseOwnerId).toBe('owner');
  });

  it('creates position with correct weighted average cost basis', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 400, health: 70, happiness: 60, cortisol: 20 } });
    // First purchase: no existing position, price = 400/100 = 4
    const result = processSharePurchase({
      sessionId: 'session-1',
      buyer,
      enterpriseOwner,
      sharesToBuy: 10,
      totalSharesOutstanding: 100,
      existingPosition: undefined,
      iterationNumber: 1,
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    const pos = result.delta.upsertEquityPositions[0];
    expect(pos.averageCostBasis).toBe(4);
  });

  it('rejects purchase when buyer has insufficient wealth', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 10, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    // price = 500/100 = 5 per share. 50 shares = 250 total. Buyer only has 10.
    const result = processSharePurchase({
      sessionId: 'session-1',
      buyer,
      enterpriseOwner,
      sharesToBuy: 50,
      totalSharesOutstanding: 100,
      existingPosition: undefined,
      iterationNumber: 1,
    });
    expect('rejected' in result).toBe(true);
    if ('rejected' in result) {
      expect(result.rejected).toBe(true);
    }
  });

  it('updates existing position with weighted average cost basis', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 600, health: 70, happiness: 60, cortisol: 20 } });
    const existing = makeEquityPosition({
      id: 'pos-1',
      ownerAgentId: 'buyer',
      enterpriseOwnerId: 'owner',
      sharesHeld: 10,
      averageCostBasis: 4, // previously bought at 4/share
    });
    // Now price = 600/110 ≈ 5.45 per share (100 original + 10 buyer = 110 total). buy 10 more.
    const result = processSharePurchase({
      sessionId: 'session-1',
      buyer,
      enterpriseOwner,
      sharesToBuy: 10,
      totalSharesOutstanding: 110,
      existingPosition: existing,
      iterationNumber: 2,
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    const pos = result.delta.upsertEquityPositions[0];
    expect(pos.sharesHeld).toBe(20); // 10 existing + 10 new
    // The average cost basis should be a weighted average of old and new cost
    expect(pos.averageCostBasis).toBeGreaterThan(4); // should be higher than original 4
  });

  it('uses fixed price of 10 for IPO (zero shares outstanding)', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 200, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 0, health: 70, happiness: 60, cortisol: 20 } });
    const result = processSharePurchase({
      sessionId: 'session-1',
      buyer,
      enterpriseOwner,
      sharesToBuy: 5,
      totalSharesOutstanding: 0,
      existingPosition: undefined,
      iterationNumber: 1,
    });
    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;
    // IPO price = 10 per share, 5 shares = 50 total cost
    expect(result.delta.wealthDeltas.get('buyer')).toBe(-50);
    expect(result.delta.wealthDeltas.get('owner')).toBe(50);
  });
});

// ── CMKT-02: Share Sale ────────────────────────────────────────────────────────

describe('processShareSale', () => {
  it('transfers wealth from buyer to seller (SFC neutral)', () => {
    const seller = makeAgent({ id: 'seller', currentStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20 } });
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 300, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    const sellerPosition = makeEquityPosition({
      id: 'pos-1',
      ownerAgentId: 'seller',
      enterpriseOwnerId: 'owner',
      sharesHeld: 20,
      averageCostBasis: 5,
    });

    const result = processShareSale({
      sessionId: 'session-1',
      seller,
      buyer,
      enterpriseOwner,
      sharesToSell: 10,
      totalSharesOutstanding: 120,
      sellerPosition,
      buyerExistingPosition: undefined,
      iterationNumber: 2,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    const sellerDelta = result.delta.wealthDeltas.get('seller') ?? 0;
    const buyerDelta = result.delta.wealthDeltas.get('buyer') ?? 0;

    // SFC: seller gains, buyer loses equal amount, enterprise owner not affected
    expect(sellerDelta).toBeGreaterThan(0);
    expect(buyerDelta).toBeLessThan(0);
    expect(sellerDelta + buyerDelta).toBe(0);

    // Seller position decreases
    const sellerUpdatedPos = result.delta.upsertEquityPositions.find(p => p.ownerAgentId === 'seller');
    expect(sellerUpdatedPos?.sharesHeld).toBe(10);
  });

  it('rejects sale when seller has insufficient shares', () => {
    const seller = makeAgent({ id: 'seller', currentStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20 } });
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 300, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    const sellerPosition = makeEquityPosition({
      id: 'pos-1',
      ownerAgentId: 'seller',
      enterpriseOwnerId: 'owner',
      sharesHeld: 5, // Only has 5 shares
    });

    const result = processShareSale({
      sessionId: 'session-1',
      seller,
      buyer,
      enterpriseOwner,
      sharesToSell: 10, // Wants to sell 10 but only has 5
      totalSharesOutstanding: 100,
      sellerPosition,
      buyerExistingPosition: undefined,
      iterationNumber: 2,
    });

    expect('rejected' in result).toBe(true);
  });
});

// ── CMKT-03: Dividend Distribution ───────────────────────────────────────────

describe('distributeDividends', () => {
  it('distributes pro-rata to shareholders and reduces enterprise owner wealth (SFC neutral)', () => {
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 1000, health: 70, happiness: 60, cortisol: 20 } });
    const shareholders = [
      makeEquityPosition({ id: 'pos-1', ownerAgentId: 'alice', enterpriseOwnerId: 'owner', sharesHeld: 6 }),
      makeEquityPosition({ id: 'pos-2', ownerAgentId: 'bob', enterpriseOwnerId: 'owner', sharesHeld: 4 }),
    ];

    const result = distributeDividends({
      enterpriseOwner,
      shareholderPositions: shareholders,
      economyConfig: defaultConfig,
    });

    // Total dividend = floor(1000 * 0.10) = 100
    const aliceDelta = result.wealthDeltas.get('alice') ?? 0;
    const bobDelta = result.wealthDeltas.get('bob') ?? 0;
    const ownerDelta = result.wealthDeltas.get('owner') ?? 0;

    expect(aliceDelta).toBe(60); // 60% of 100
    expect(bobDelta).toBe(40);   // 40% of 100
    expect(ownerDelta).toBe(-100);

    // SFC: sum of all deltas = 0
    expect(aliceDelta + bobDelta + ownerDelta).toBe(0);
  });

  it('returns no-op delta when there are zero shareholders', () => {
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 1000, health: 70, happiness: 60, cortisol: 20 } });

    const result = distributeDividends({
      enterpriseOwner,
      shareholderPositions: [],
      economyConfig: defaultConfig,
    });

    expect(result.wealthDeltas.size).toBe(0);
    expect(result.trace).toHaveLength(0);
  });

  it('handles dividendPayoutRatio missing from config (no-op)', () => {
    const configWithout = { ...defaultConfig, dividendPayoutRatio: undefined };
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 1000, health: 70, happiness: 60, cortisol: 20 } });
    const shareholders = [
      makeEquityPosition({ id: 'pos-1', ownerAgentId: 'alice', enterpriseOwnerId: 'owner', sharesHeld: 10 }),
    ];

    const result = distributeDividends({
      enterpriseOwner,
      shareholderPositions: shareholders,
      economyConfig: configWithout,
    });

    // No dividend when ratio not configured
    expect(result.wealthDeltas.size).toBe(0);
  });
});

// ── CMKT-04: Government Bond Purchase ─────────────────────────────────────────

describe('processGovBondPurchase', () => {
  it('transfers wealth from buyer to treasury and creates bond holding (SFC neutral)', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    const faceValue = 100;

    const result = processGovBondPurchase({
      sessionId: 'session-1',
      buyer,
      faceValue,
      economyConfig: defaultConfig,
      iterationNumber: 1,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    const buyerDelta = result.delta.wealthDeltas.get('buyer') ?? 0;
    expect(buyerDelta).toBe(-faceValue);
    expect(result.delta.treasuryDelta).toBe(faceValue);

    // SFC: buyer loses faceValue, treasury gains faceValue
    expect(buyerDelta + result.delta.treasuryDelta).toBe(0);

    // Bond holding created
    expect(result.delta.upsertBondHoldings).toHaveLength(1);
    const holding = result.delta.upsertBondHoldings[0];
    expect(holding.bondType).toBe('government');
    expect(holding.issuerId).toBe('treasury');
    expect(holding.faceValue).toBe(faceValue);
    expect(holding.couponRate).toBe(defaultConfig.govBondCouponRate);
    expect(holding.status).toBe('active');
    expect(holding.ownerAgentId).toBe('buyer');
  });

  it('rejects purchase when buyer wealth < faceValue', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 50, health: 70, happiness: 60, cortisol: 20 } });

    const result = processGovBondPurchase({
      sessionId: 'session-1',
      buyer,
      faceValue: 100,
      economyConfig: defaultConfig,
      iterationNumber: 1,
    });

    expect('rejected' in result).toBe(true);
  });
});

// ── CMKT-05: Corporate Bond Issuance ──────────────────────────────────────────

describe('processCorpBondIssuance', () => {
  it('transfers wealth from buyer to enterprise owner and creates bond holding (SFC neutral)', () => {
    const buyer = makeAgent({ id: 'buyer', currentStats: { wealth: 500, health: 70, happiness: 60, cortisol: 20 } });
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 200, health: 70, happiness: 60, cortisol: 20 } });
    const faceValue = 100;
    const couponRate = 0.01;
    const maturityIteration = 20;

    const result = processCorpBondIssuance({
      sessionId: 'session-1',
      buyer,
      enterpriseOwner,
      faceValue,
      couponRate,
      maturityIteration,
      iterationNumber: 5,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    const buyerDelta = result.delta.wealthDeltas.get('buyer') ?? 0;
    const ownerDelta = result.delta.enterpriseTreasuryDeltas.get('owner') ?? 0;

    expect(buyerDelta).toBe(-faceValue);
    expect(ownerDelta).toBe(faceValue);
    expect(buyerDelta + ownerDelta).toBe(0);

    // Bond holding has correct attributes
    const holding = result.delta.upsertBondHoldings[0];
    expect(holding.bondType).toBe('corporate');
    expect(holding.issuerId).toBe('owner');
    expect(holding.faceValue).toBe(faceValue);
    expect(holding.couponRate).toBe(couponRate);
  });
});

// ── Coupon Payments ────────────────────────────────────────────────────────────

describe('processCoupons', () => {
  it('pays coupon from treasury to gov bond holder (SFC neutral)', () => {
    const holdings = [
      makeBondHolding({
        id: 'bond-1',
        ownerAgentId: 'holder',
        issuerId: 'treasury',
        bondType: 'government',
        faceValue: 100,
        couponRate: 0.008,
        maturityIteration: 10,
        purchaseIteration: 1,
        status: 'active',
      }),
    ];

    const result = processCoupons({ holdings, currentIteration: 3 });

    const holderDelta = result.wealthDeltas.get('holder') ?? 0;
    const treasuryDelta = result.treasuryDelta;

    // Coupon = 100 * 0.008 = 0.8 (fractional — engine uses raw math)
    expect(holderDelta).toBeCloseTo(0.8);
    expect(treasuryDelta).toBeCloseTo(-0.8);

    // SFC: holder gains, treasury loses equal
    expect(holderDelta + treasuryDelta).toBeCloseTo(0);
  });

  it('pays coupon from enterprise owner (not treasury) for corporate bonds', () => {
    const holdings = [
      makeBondHolding({
        id: 'bond-2',
        ownerAgentId: 'holder',
        issuerId: 'enterprise-owner-1',
        bondType: 'corporate',
        faceValue: 100,
        couponRate: 0.01,
        maturityIteration: 20,
        purchaseIteration: 5,
        status: 'active',
      }),
    ];

    const result = processCoupons({ holdings, currentIteration: 8 });

    const holderDelta = result.wealthDeltas.get('holder') ?? 0;
    const enterpriseDelta = result.enterpriseTreasuryDeltas.get('enterprise-owner-1') ?? 0;

    expect(holderDelta).toBeCloseTo(1.0); // 100 * 0.01
    expect(enterpriseDelta).toBeCloseTo(-1.0);
    expect(result.treasuryDelta).toBe(0); // treasury not involved
    expect(holderDelta + enterpriseDelta).toBeCloseTo(0);
  });

  it('skips matured/defaulted bonds', () => {
    const holdings = [
      makeBondHolding({
        id: 'bond-3',
        ownerAgentId: 'holder',
        issuerId: 'treasury',
        bondType: 'government',
        status: 'matured',
        faceValue: 100,
        couponRate: 0.008,
        maturityIteration: 5,
        purchaseIteration: 1,
      }),
    ];

    const result = processCoupons({ holdings, currentIteration: 6 });

    expect(result.wealthDeltas.size).toBe(0);
    expect(result.treasuryDelta).toBe(0);
  });
});

// ── Bond Maturities ────────────────────────────────────────────────────────────

describe('processMaturities', () => {
  it('returns principal to holder and removes holding when maturityIteration is reached', () => {
    const holdings = [
      makeBondHolding({
        id: 'bond-1',
        ownerAgentId: 'holder',
        issuerId: 'treasury',
        bondType: 'government',
        faceValue: 100,
        couponRate: 0.008,
        maturityIteration: 10,
        purchaseIteration: 1,
        status: 'active',
      }),
    ];

    const result = processMaturities({ holdings, currentIteration: 10 });

    const holderDelta = result.wealthDeltas.get('holder') ?? 0;
    expect(holderDelta).toBe(100); // faceValue returned to holder
    expect(result.treasuryDelta).toBe(-100);
    expect(result.deleteBondHoldingIds).toContain('bond-1');
    expect(holderDelta + result.treasuryDelta).toBe(0); // SFC neutral
  });

  it('does not mature bonds before their maturityIteration', () => {
    const holdings = [
      makeBondHolding({
        id: 'bond-1',
        ownerAgentId: 'holder',
        issuerId: 'treasury',
        bondType: 'government',
        faceValue: 100,
        maturityIteration: 10,
        purchaseIteration: 1,
        couponRate: 0.008,
        status: 'active',
      }),
    ];

    const result = processMaturities({ holdings, currentIteration: 9 });

    expect(result.wealthDeltas.size).toBe(0);
    expect(result.deleteBondHoldingIds).toHaveLength(0);
  });

  it('matures corporate bond: enterprise owner pays back principal', () => {
    const holdings = [
      makeBondHolding({
        id: 'bond-2',
        ownerAgentId: 'holder',
        issuerId: 'corp-owner-1',
        bondType: 'corporate',
        faceValue: 200,
        couponRate: 0.01,
        maturityIteration: 15,
        purchaseIteration: 5,
        status: 'active',
      }),
    ];

    const result = processMaturities({ holdings, currentIteration: 15 });

    const holderDelta = result.wealthDeltas.get('holder') ?? 0;
    const corpDelta = result.enterpriseTreasuryDeltas.get('corp-owner-1') ?? 0;

    expect(holderDelta).toBe(200);
    expect(corpDelta).toBe(-200);
    expect(result.treasuryDelta).toBe(0);
    expect(result.deleteBondHoldingIds).toContain('bond-2');
    expect(holderDelta + corpDelta).toBe(0);
  });
});

// ── processIteration ────────────────────────────────────────────────────────────

describe('processIteration', () => {
  it('orchestrates dividends + coupons + maturities in one call', () => {
    const enterpriseOwner = makeAgent({ id: 'owner', currentStats: { wealth: 1000, health: 70, happiness: 60, cortisol: 20 } });
    const shareholder = makeAgent({ id: 'shareholder', currentStats: { wealth: 200, health: 70, happiness: 60, cortisol: 20 } });
    const bondHolder = makeAgent({ id: 'bondholder', currentStats: { wealth: 100, health: 70, happiness: 60, cortisol: 20 } });

    const equityPositions = [
      makeEquityPosition({ id: 'pos-1', ownerAgentId: 'shareholder', enterpriseOwnerId: 'owner', sharesHeld: 10 }),
    ];
    const bondHoldings = [
      makeBondHolding({
        id: 'bond-1',
        ownerAgentId: 'bondholder',
        issuerId: 'treasury',
        bondType: 'government',
        faceValue: 100,
        couponRate: 0.008,
        maturityIteration: 20,
        purchaseIteration: 1,
        status: 'active',
      }),
    ];

    const delta = processIteration({
      sessionId: 'session-1',
      allAgents: [enterpriseOwner, shareholder, bondHolder],
      equityPositions,
      bondHoldings,
      economyConfig: defaultConfig,
      iterationNumber: 5,
      pendingSharePurchases: [],
      pendingShareSales: [],
      pendingGovBondPurchases: [],
      pendingCorpBondIssuances: [],
    });

    // Dividends distributed (owner had 1000 wealth, 10% = 100, all to shareholder since only one)
    const shareholderDelta = delta.wealthDeltas.get('shareholder') ?? 0;
    const ownerDelta = delta.wealthDeltas.get('owner') ?? 0;
    expect(shareholderDelta).toBeGreaterThan(0);
    expect(ownerDelta).toBeLessThan(0);

    // Coupon paid on gov bond: 100 * 0.008 = 0.8
    const bondHolderDelta = delta.wealthDeltas.get('bondholder') ?? 0;
    expect(bondHolderDelta).toBeCloseTo(0.8);

    // Should return traces
    expect(delta.trace.length).toBeGreaterThan(0);
  });
});
