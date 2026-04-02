/**
 * SFC Capital Markets Integration Tests — verifies stock-flow consistency invariants
 * for all capital market operations.
 *
 * SFC Model (Capital Markets):
 *
 *  Capital market operations are SFC-neutral within the perimeter:
 *  - Share purchase: buyer.wealth -= cost, enterpriseOwner.wealth += cost (net=0)
 *  - Share sale: seller.wealth += proceeds, buyer.wealth -= proceeds (net=0)
 *  - Dividend: owner.wealth -= total, shareholders.wealth += total (net=0)
 *  - Gov bond purchase: buyer.wealth -= faceValue, treasury += faceValue (net=0)
 *  - Corp bond issuance: buyer.wealth -= faceValue, enterpriseOwner.wealth += faceValue (net=0)
 *  - Coupon: holder.wealth += coupon, issuer -= coupon (net=0)
 *  - Maturity: holder.wealth += faceValue, issuer -= faceValue, holding deleted (net=0)
 *
 * No escrow term needed: all fiat stays within agent wealth + treasury.
 */
import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
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
} from '../mechanics/capitalMarketEngine.js';

// ── Test Helpers ──────────────────────────────────────────────────────────────

const SESSION = 'test-cmkt-session';

function makeAgent(id: string, wealth: number, role = 'farmer'): Agent {
  return {
    id,
    sessionId: SESSION,
    name: `Agent ${id}`,
    role,
    background: '',
    initialStats: { wealth, health: 70, happiness: 60, cortisol: 20, dopamine: 50 },
    currentStats: { wealth, health: 70, happiness: 60, cortisol: 20, dopamine: 50 },
    isAlive: true,
    status: 'alive',
    type: 'citizen',
    bornAtIteration: null,
    diedAtIteration: null,
  };
}

function makeEquityPosition(
  ownerAgentId: string,
  enterpriseOwnerId: string,
  sharesHeld: number,
): EquityPosition {
  return {
    id: uuidv4(),
    sessionId: SESSION,
    ownerAgentId,
    enterpriseOwnerId,
    sharesHeld,
    averageCostBasis: 10,
    lastUpdated: 1,
  };
}

function makeBondHolding(
  ownerAgentId: string,
  issuerId: string,
  bondType: 'government' | 'corporate',
  faceValue: number,
  couponRate: number,
  maturityIteration: number,
  purchaseIteration = 1,
): BondHolding {
  return {
    id: uuidv4(),
    sessionId: SESSION,
    ownerAgentId,
    issuerId,
    bondType,
    faceValue,
    couponRate,
    maturityIteration,
    purchaseIteration,
    status: 'active',
  };
}

const defaultConfig: EconomyConfig = {
  bankingEnabled: false,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
  capitalMarketsEnabled: true,
  dividendPayoutRatio: 0.1,
  govBondCouponRate: 0.008,
  govBondTermIterations: 10,
};

/**
 * Compute total system fiat = sum of all agent wealth + treasury
 */
function totalSystemFiat(agents: Agent[], treasury: number): number {
  return agents.reduce((sum, a) => sum + a.currentStats.wealth, 0) + treasury;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SFC Capital Market Invariants', () => {
  it('share purchase SFC invariant: buyer.wealth decreases, owner.wealth increases by same amount', () => {
    const buyer = makeAgent('buyer-1', 200);
    const owner = makeAgent('owner-1', 500);
    const treasury = 0;

    const before = totalSystemFiat([buyer, owner], treasury);

    const result = processSharePurchase({
      sessionId: SESSION,
      buyer,
      enterpriseOwner: owner,
      sharesToBuy: 10,
      totalSharesOutstanding: 0, // IPO: price = 10 per share
      existingPosition: undefined,
      iterationNumber: 1,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    // Apply deltas
    let totalWealthDelta = 0;
    for (const [, delta] of result.delta.wealthDeltas) {
      totalWealthDelta += delta;
    }

    // Net wealth change must be zero (SFC invariant)
    expect(totalWealthDelta).toBeCloseTo(0, 5);

    // Buyer paid, owner received
    expect(result.delta.wealthDeltas.get(buyer.id)).toBeLessThan(0);
    expect(result.delta.wealthDeltas.get(owner.id)).toBeGreaterThan(0);

    // Total system fiat unchanged (no treasury involved)
    const buyerDelta = result.delta.wealthDeltas.get(buyer.id) ?? 0;
    const ownerDelta = result.delta.wealthDeltas.get(owner.id) ?? 0;
    const after = totalSystemFiat(
      [
        { ...buyer, currentStats: { ...buyer.currentStats, wealth: buyer.currentStats.wealth + buyerDelta } },
        { ...owner, currentStats: { ...owner.currentStats, wealth: owner.currentStats.wealth + ownerDelta } },
      ],
      treasury,
    );
    expect(after).toBeCloseTo(before, 5);
  });

  it('dividend distribution SFC invariant: owner.wealth decrease equals total shareholder gains', () => {
    const owner = makeAgent('owner-1', 1000);
    const sh1 = makeAgent('sh-1', 50);
    const sh2 = makeAgent('sh-2', 50);
    const sh3 = makeAgent('sh-3', 50);

    const positions: EquityPosition[] = [
      makeEquityPosition(sh1.id, owner.id, 30),
      makeEquityPosition(sh2.id, owner.id, 20),
      makeEquityPosition(sh3.id, owner.id, 50),
    ];

    const result = distributeDividends({
      enterpriseOwner: owner,
      shareholderPositions: positions,
      economyConfig: defaultConfig,
    });

    // Compute net wealth change
    let totalDelta = 0;
    for (const [, delta] of result.wealthDeltas) {
      totalDelta += delta;
    }

    // Net zero: owner pays out exactly what shareholders receive
    expect(totalDelta).toBeCloseTo(0, 5);

    // Owner's delta must be negative
    expect(result.wealthDeltas.get(owner.id)).toBeLessThan(0);

    // All shareholders gained
    expect(result.wealthDeltas.get(sh1.id)).toBeGreaterThan(0);
    expect(result.wealthDeltas.get(sh2.id)).toBeGreaterThan(0);
    expect(result.wealthDeltas.get(sh3.id)).toBeGreaterThan(0);
  });

  it('gov bond lifecycle SFC: purchase → coupon → maturity, invariant holds at each step', () => {
    const buyer = makeAgent('buyer-1', 500);
    let treasury = 100;

    // Step 1: Purchase
    const purchaseResult = processGovBondPurchase({
      sessionId: SESSION,
      buyer,
      faceValue: 100,
      economyConfig: defaultConfig,
      iterationNumber: 1,
    });

    expect('rejected' in purchaseResult).toBe(false);
    if ('rejected' in purchaseResult) return;

    const buyerAfterPurchase = buyer.currentStats.wealth + (purchaseResult.delta.wealthDeltas.get(buyer.id) ?? 0);
    treasury += purchaseResult.delta.treasuryDelta;
    const beforePurchase = totalSystemFiat([buyer], 100);
    const afterPurchase = buyerAfterPurchase + treasury;
    expect(afterPurchase).toBeCloseTo(beforePurchase, 5);

    // Create the holding
    const holding = purchaseResult.delta.upsertBondHoldings[0];
    expect(holding.issuerId).toBe('treasury');
    expect(holding.bondType).toBe('government');
    expect(holding.faceValue).toBe(100);

    // Step 2: Coupon payment
    const couponResult = processCoupons({
      holdings: [holding],
      currentIteration: 2,
    });

    const couponAmount = holding.faceValue * holding.couponRate;
    expect(couponResult.wealthDeltas.get(holding.ownerAgentId)).toBeCloseTo(couponAmount, 5);
    // Treasury decreases by coupon
    expect(couponResult.treasuryDelta).toBeCloseTo(-couponAmount, 5);
    // Net delta = coupon to holder + (- coupon from treasury) = 0
    let couponNetDelta = couponResult.treasuryDelta;
    for (const [, delta] of couponResult.wealthDeltas) couponNetDelta += delta;
    expect(couponNetDelta).toBeCloseTo(0, 5);

    // Step 3: Maturity
    const maturityResult = processMaturities({
      holdings: [{ ...holding, maturityIteration: 1 }], // due now
      currentIteration: 2,
    });

    expect(maturityResult.wealthDeltas.get(holding.ownerAgentId)).toBeCloseTo(holding.faceValue, 5);
    expect(maturityResult.treasuryDelta).toBeCloseTo(-holding.faceValue, 5);
    expect(maturityResult.deleteBondHoldingIds).toContain(holding.id);

    // Net delta at maturity = 0
    let maturityNetDelta = maturityResult.treasuryDelta;
    for (const [, delta] of maturityResult.wealthDeltas) maturityNetDelta += delta;
    expect(maturityNetDelta).toBeCloseTo(0, 5);
  });

  it('corporate bond SFC: coupon comes from enterprise owner, maturity redeems from owner', () => {
    const buyer = makeAgent('buyer-1', 500);
    const corpOwner = makeAgent('owner-1', 1000);

    const result = processCorpBondIssuance({
      sessionId: SESSION,
      buyer,
      enterpriseOwner: corpOwner,
      faceValue: 200,
      couponRate: 0.01,
      maturityIteration: 10,
      iterationNumber: 1,
    });

    expect('rejected' in result).toBe(false);
    if ('rejected' in result) return;

    // buyer paid, enterprise owner received
    expect(result.delta.wealthDeltas.get(buyer.id)).toBeCloseTo(-200, 5);
    // Enterprise owner receives via enterpriseTreasuryDeltas (not wealthDeltas)
    expect(result.delta.enterpriseTreasuryDeltas.get(corpOwner.id)).toBeCloseTo(200, 5);

    // SFC: sum of wealthDeltas + sum of enterpriseTreasuryDeltas = 0
    let buyerDelta = result.delta.wealthDeltas.get(buyer.id) ?? 0;
    let ownerEntDelta = result.delta.enterpriseTreasuryDeltas.get(corpOwner.id) ?? 0;
    expect(buyerDelta + ownerEntDelta).toBeCloseTo(0, 5);

    // Corp bond coupon: holder receives, issuer (enterprise) pays
    const holding = result.delta.upsertBondHoldings[0];
    const couponResult = processCoupons({ holdings: [holding], currentIteration: 2 });

    const coupon = holding.faceValue * holding.couponRate;
    expect(couponResult.wealthDeltas.get(holding.ownerAgentId)).toBeCloseTo(coupon, 5);
    expect(couponResult.enterpriseTreasuryDeltas.get(holding.issuerId)).toBeCloseTo(-coupon, 5);

    // Net delta = 0 (coupon from enterprise treasury to holder)
    let corpCouponNetDelta = 0;
    for (const [, delta] of couponResult.wealthDeltas) corpCouponNetDelta += delta;
    for (const [, delta] of couponResult.enterpriseTreasuryDeltas) corpCouponNetDelta += delta;
    expect(corpCouponNetDelta).toBeCloseTo(0, 5);
  });

  it('mixed iteration SFC: share purchases + bond coupons + maturity in single processIteration tick', () => {
    const buyer = makeAgent('buyer-1', 500);
    const owner = makeAgent('owner-1', 200);
    const bondHolder = makeAgent('holder-1', 100);
    let treasury = 300;

    const allAgents = [buyer, owner, bondHolder];

    // Pre-existing equity position (owner has 20 shares from a previous iteration)
    const existingEquity: EquityPosition[] = [
      makeEquityPosition(owner.id, owner.id, 20), // owner holds own shares
    ];

    // Pre-existing gov bond with maturity this iteration
    const maturingBond = makeBondHolding('holder-1', 'treasury', 'government', 50, 0.008, 5);
    const activeBond = makeBondHolding('holder-1', 'treasury', 'government', 30, 0.008, 20);
    const bonds: BondHolding[] = [maturingBond, activeBond];

    const beforeTotal = totalSystemFiat(allAgents, treasury);

    const delta = processIteration({
      sessionId: SESSION,
      allAgents,
      equityPositions: existingEquity,
      bondHoldings: bonds,
      economyConfig: defaultConfig,
      iterationNumber: 5,
      pendingSharePurchases: [{
        buyerId: buyer.id,
        enterpriseOwnerId: owner.id,
        sharesToBuy: 5,
        totalSharesOutstanding: 20,
      }],
      pendingShareSales: [],
      pendingGovBondPurchases: [],
      pendingCorpBondIssuances: [],
    });

    // Apply deltas to agents
    let totalAgentDelta = 0;
    for (const [, d] of delta.wealthDeltas) totalAgentDelta += d;
    // Enterprise treasury deltas must also be applied to owner agent wealth in the runner
    for (const [, d] of delta.enterpriseTreasuryDeltas) totalAgentDelta += d;
    // Treasury delta
    const totalTreasuryDelta = delta.treasuryDelta;

    // Total change = agent wealth deltas + enterprise deltas + treasury delta = 0
    expect(totalAgentDelta + totalTreasuryDelta).toBeCloseTo(0, 4);
  });

  it('export/import round-trip: equity positions and bond holdings survive with remapped IDs', () => {
    // Simulate two agents with equity and bond positions
    const oldAgentId1 = 'old-agent-1';
    const oldAgentId2 = 'old-agent-2';
    const newAgentId1 = 'new-agent-1';
    const newAgentId2 = 'new-agent-2';

    const agentIdMap = new Map<string, string>([
      [oldAgentId1, newAgentId1],
      [oldAgentId2, newAgentId2],
    ]);

    // Equity positions to export
    const equityPositions: EquityPosition[] = [
      {
        id: 'pos-1',
        sessionId: 'old-session',
        ownerAgentId: oldAgentId1,
        enterpriseOwnerId: oldAgentId2,
        sharesHeld: 50,
        averageCostBasis: 10,
        lastUpdated: 5,
      },
    ];

    // Bond holdings to export
    const bondHoldings: BondHolding[] = [
      {
        id: 'bond-1',
        sessionId: 'old-session',
        ownerAgentId: oldAgentId1,
        issuerId: 'treasury',
        bondType: 'government',
        faceValue: 100,
        couponRate: 0.008,
        maturityIteration: 15,
        purchaseIteration: 5,
        status: 'active',
      },
      {
        id: 'bond-2',
        sessionId: 'old-session',
        ownerAgentId: oldAgentId1,
        issuerId: oldAgentId2, // corporate bond
        bondType: 'corporate',
        faceValue: 200,
        couponRate: 0.01,
        maturityIteration: 20,
        purchaseIteration: 3,
        status: 'active',
      },
    ];

    // Simulate import remapping
    const newSessionId = 'new-session';
    const importedEquity = equityPositions.map(pos => ({
      ...pos,
      id: uuidv4(),
      ownerAgentId: agentIdMap.get(pos.ownerAgentId) ?? pos.ownerAgentId,
      enterpriseOwnerId: agentIdMap.get(pos.enterpriseOwnerId) ?? pos.enterpriseOwnerId,
      sessionId: newSessionId,
    }));

    const importedBonds = bondHoldings.map(holding => ({
      ...holding,
      id: uuidv4(),
      ownerAgentId: agentIdMap.get(holding.ownerAgentId) ?? holding.ownerAgentId,
      issuerId: holding.issuerId === 'treasury'
        ? 'treasury'
        : (agentIdMap.get(holding.issuerId) ?? holding.issuerId),
      sessionId: newSessionId,
    }));

    // Verify equity remapping
    expect(importedEquity).toHaveLength(1);
    expect(importedEquity[0].ownerAgentId).toBe(newAgentId1);
    expect(importedEquity[0].enterpriseOwnerId).toBe(newAgentId2);
    expect(importedEquity[0].sessionId).toBe(newSessionId);
    expect(importedEquity[0].sharesHeld).toBe(50);
    // New ID generated
    expect(importedEquity[0].id).not.toBe('pos-1');

    // Verify bond remapping
    expect(importedBonds).toHaveLength(2);
    // Gov bond: owner remapped, issuerId stays 'treasury'
    const govBond = importedBonds.find(b => b.bondType === 'government');
    expect(govBond).toBeDefined();
    expect(govBond!.ownerAgentId).toBe(newAgentId1);
    expect(govBond!.issuerId).toBe('treasury');
    expect(govBond!.faceValue).toBe(100);
    expect(govBond!.sessionId).toBe(newSessionId);

    // Corp bond: both ownerAgentId and issuerId remapped
    const corpBond = importedBonds.find(b => b.bondType === 'corporate');
    expect(corpBond).toBeDefined();
    expect(corpBond!.ownerAgentId).toBe(newAgentId1);
    expect(corpBond!.issuerId).toBe(newAgentId2);
    expect(corpBond!.faceValue).toBe(200);
    expect(corpBond!.sessionId).toBe(newSessionId);
  });
});
