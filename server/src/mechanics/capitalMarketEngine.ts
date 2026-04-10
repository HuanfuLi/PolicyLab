/**
 * Capital Market Engine — deterministic capital markets mechanics.
 *
 * Design: All functions receive data and return delta objects. No direct DB mutations.
 * The caller (simulationRunner in Plan 03) applies deltas in batch via capitalMarketRepo.
 *
 * SFC Accounting:
 *  - Share purchase: buyer.wealth -= cost, enterpriseOwner.wealth += cost (net=0)
 *  - Share sale: seller.wealth += proceeds, buyer.wealth -= proceeds (net=0)
 *  - Dividend: owner.wealth -= total, shareholders.wealth += shares summing to total (net=0)
 *  - Gov bond purchase: buyer.wealth -= faceValue, treasury += faceValue (net=0)
 *  - Corp bond issuance: buyer.wealth -= faceValue, enterpriseOwner.wealth += faceValue (net=0)
 *  - Coupon: holder.wealth += coupon, issuer balance -= coupon (net=0)
 *  - Maturity: holder.wealth += faceValue, issuer balance -= faceValue, holding deleted (net=0)
 */
import { v4 as uuidv4 } from 'uuid';
import type { Agent, EconomyConfig, EquityPosition, BondHolding } from '@policylab/shared';
import { distributeProRata } from '@policylab/shared';

// ── Return types ─────────────────────────────────────────────────────────────

export interface CapitalMarketDelta {
  /** Equity positions to insert or update */
  upsertEquityPositions: EquityPosition[];
  /** Bond holdings to insert or update */
  upsertBondHoldings: BondHolding[];
  /** Bond holding IDs to delete (matured bonds) */
  deleteBondHoldingIds: string[];
  /** Agent wealth changes: agentId → wealth delta */
  wealthDeltas: Map<string, number>;
  /** Treasury fiat change (gov bond purchases, coupon payments, maturities) */
  treasuryDelta: number;
  /** Per-enterprise treasury changes: enterpriseOwnerId → fiat delta */
  enterpriseTreasuryDeltas: Map<string, number>;
  /** Physics trace log entries for narrative grounding */
  trace: string[];
}

function emptyDelta(): CapitalMarketDelta {
  return {
    upsertEquityPositions: [],
    upsertBondHoldings: [],
    deleteBondHoldingIds: [],
    wealthDeltas: new Map(),
    treasuryDelta: 0,
    enterpriseTreasuryDeltas: new Map(),
    trace: [],
  };
}

function addWealth(delta: CapitalMarketDelta, agentId: string, amount: number): void {
  const prev = delta.wealthDeltas.get(agentId) ?? 0;
  delta.wealthDeltas.set(agentId, prev + amount);
}

function addEnterpriseTreasury(delta: CapitalMarketDelta, enterpriseOwnerId: string, amount: number): void {
  const prev = delta.enterpriseTreasuryDeltas.get(enterpriseOwnerId) ?? 0;
  delta.enterpriseTreasuryDeltas.set(enterpriseOwnerId, prev + amount);
}

// ── Share price formula ────────────────────────────────────────────────────────

/**
 * Calculate share price.
 * - If totalSharesOutstanding > 0: price = enterpriseOwner.wealth / totalSharesOutstanding
 * - If totalSharesOutstanding === 0 (IPO): fixed price of 10 fiat per share
 */
function calcSharePrice(enterpriseOwnerWealth: number, totalSharesOutstanding: number): number {
  if (totalSharesOutstanding === 0) return 10;
  if (enterpriseOwnerWealth <= 0) return 0;
  return enterpriseOwnerWealth / totalSharesOutstanding;
}

// ── processSharePurchase ───────────────────────────────────────────────────────

export type SharePurchaseResult =
  | { delta: CapitalMarketDelta }
  | { rejected: true; reason: string };

/**
 * Process a share purchase from buyer to enterprise owner.
 *
 * Share price = enterpriseOwner.wealth / totalSharesOutstanding (or 10 for IPO).
 * Creates or updates an EquityPosition for the buyer with weighted average cost basis.
 *
 * SFC: buyer.wealth -= totalCost, enterpriseOwner.wealth += totalCost, net=0
 */
export function processSharePurchase(params: {
  sessionId: string;
  buyer: Agent;
  enterpriseOwner: Agent;
  sharesToBuy: number;
  totalSharesOutstanding: number;
  existingPosition: EquityPosition | undefined;
  iterationNumber: number;
}): SharePurchaseResult {
  const { sessionId, buyer, enterpriseOwner, sharesToBuy, totalSharesOutstanding, existingPosition, iterationNumber } = params;

  const pricePerShare = calcSharePrice(enterpriseOwner.currentStats.wealth, totalSharesOutstanding);
  const totalCost = pricePerShare * sharesToBuy;

  if (buyer.currentStats.wealth < totalCost) {
    return {
      rejected: true,
      reason: `Buyer ${buyer.id} has insufficient wealth (${buyer.currentStats.wealth}) for ${sharesToBuy} shares at ${pricePerShare.toFixed(4)} each (total: ${totalCost.toFixed(4)})`,
    };
  }

  const delta = emptyDelta();

  // SFC: buyer -totalCost, enterpriseOwner +totalCost, net=0
  addWealth(delta, buyer.id, -totalCost);
  addWealth(delta, enterpriseOwner.id, totalCost);

  // Update or create equity position with weighted average cost basis
  const prevShares = existingPosition?.sharesHeld ?? 0;
  const prevCostBasis = existingPosition?.averageCostBasis ?? 0;
  const newShares = prevShares + sharesToBuy;
  const newAvgCostBasis = newShares > 0
    ? (prevShares * prevCostBasis + sharesToBuy * pricePerShare) / newShares
    : pricePerShare;

  const position: EquityPosition = {
    id: existingPosition?.id ?? uuidv4(),
    sessionId,
    ownerAgentId: buyer.id,
    enterpriseOwnerId: enterpriseOwner.id,
    sharesHeld: newShares,
    averageCostBasis: newAvgCostBasis,
    lastUpdated: iterationNumber,
  };

  delta.upsertEquityPositions.push(position);
  delta.trace.push(
    `[CMKT] Share purchase: ${buyer.id} bought ${sharesToBuy} shares of ${enterpriseOwner.id} at ${pricePerShare.toFixed(4)}/share (total: ${totalCost.toFixed(4)})`,
  );

  return { delta };
}

// ── processShareSale ──────────────────────────────────────────────────────────

export type ShareSaleResult =
  | { delta: CapitalMarketDelta }
  | { rejected: true; reason: string };

/**
 * Process a secondary market share sale from seller to buyer.
 *
 * Price is determined by enterpriseOwner.wealth / totalSharesOutstanding.
 * Seller's position decreases; buyer's position increases.
 *
 * SFC: seller.wealth += proceeds, buyer.wealth -= proceeds, net=0
 */
export function processShareSale(params: {
  sessionId: string;
  seller: Agent;
  buyer: Agent;
  enterpriseOwner: Agent;
  sharesToSell: number;
  totalSharesOutstanding: number;
  sellerPosition: EquityPosition;
  buyerExistingPosition: EquityPosition | undefined;
  iterationNumber: number;
}): ShareSaleResult {
  const { sessionId, seller, buyer, enterpriseOwner, sharesToSell, totalSharesOutstanding, sellerPosition, buyerExistingPosition, iterationNumber } = params;

  if (sellerPosition.sharesHeld < sharesToSell) {
    return {
      rejected: true,
      reason: `Seller ${seller.id} has insufficient shares (${sellerPosition.sharesHeld}) to sell ${sharesToSell}`,
    };
  }

  const pricePerShare = calcSharePrice(enterpriseOwner.currentStats.wealth, totalSharesOutstanding);
  const proceeds = pricePerShare * sharesToSell;

  if (buyer.currentStats.wealth < proceeds) {
    return {
      rejected: true,
      reason: `Buyer ${buyer.id} has insufficient wealth (${buyer.currentStats.wealth}) for ${sharesToSell} shares at ${pricePerShare.toFixed(4)} each (total: ${proceeds.toFixed(4)})`,
    };
  }

  const delta = emptyDelta();

  // SFC: seller +proceeds, buyer -proceeds, net=0
  addWealth(delta, seller.id, proceeds);
  addWealth(delta, buyer.id, -proceeds);

  // Update seller position
  const rawSellerShares = sellerPosition.sharesHeld - sharesToSell;
  if (rawSellerShares < 0) {
    console.warn(
      `[CMKT] processShareSale: sharesHeld would go negative for agent ${seller.id} ` +
      `(had ${sellerPosition.sharesHeld}, selling ${sharesToSell}). Clamping to 0.`,
    );
  }
  const updatedSellerPosition: EquityPosition = {
    ...sellerPosition,
    sharesHeld: Math.max(0, rawSellerShares),
    lastUpdated: iterationNumber,
  };
  delta.upsertEquityPositions.push(updatedSellerPosition);

  // Create or update buyer position with weighted average cost basis
  const prevBuyerShares = buyerExistingPosition?.sharesHeld ?? 0;
  const prevBuyerCostBasis = buyerExistingPosition?.averageCostBasis ?? 0;
  const newBuyerShares = prevBuyerShares + sharesToSell;
  const newBuyerAvgCostBasis = newBuyerShares > 0
    ? (prevBuyerShares * prevBuyerCostBasis + sharesToSell * pricePerShare) / newBuyerShares
    : pricePerShare;

  const buyerPosition: EquityPosition = {
    id: buyerExistingPosition?.id ?? uuidv4(),
    sessionId,
    ownerAgentId: buyer.id,
    enterpriseOwnerId: enterpriseOwner.id,
    sharesHeld: newBuyerShares,
    averageCostBasis: newBuyerAvgCostBasis,
    lastUpdated: iterationNumber,
  };
  delta.upsertEquityPositions.push(buyerPosition);

  delta.trace.push(
    `[CMKT] Share sale: ${seller.id} sold ${sharesToSell} shares of ${enterpriseOwner.id} to ${buyer.id} at ${pricePerShare.toFixed(4)}/share (proceeds: ${proceeds.toFixed(4)})`,
  );

  return { delta };
}

// ── distributeDividends ────────────────────────────────────────────────────────

export interface DividendResult {
  wealthDeltas: Map<string, number>;
  trace: string[];
}

/**
 * Distribute dividends from enterprise owner to all shareholders pro-rata by shares held.
 *
 * Total dividend = floor(enterpriseOwner.wealth * dividendPayoutRatio)
 * Each shareholder receives floor(total * sharesHeld / totalShares) with remainder given left-to-right.
 *
 * SFC: owner.wealth -= totalDividend, sum(shareholder gains) = totalDividend, net=0
 */
export function distributeDividends(params: {
  enterpriseOwner: Agent;
  shareholderPositions: EquityPosition[];
  economyConfig: EconomyConfig;
}): DividendResult {
  const { enterpriseOwner, shareholderPositions, economyConfig } = params;
  const result: DividendResult = { wealthDeltas: new Map(), trace: [] };

  if (!economyConfig.dividendPayoutRatio || economyConfig.dividendPayoutRatio <= 0) {
    return result;
  }

  if (shareholderPositions.length === 0) {
    return result;
  }

  if (enterpriseOwner.currentStats.wealth <= 0) return result;
  const totalDividend = Math.floor(enterpriseOwner.currentStats.wealth * economyConfig.dividendPayoutRatio);
  if (totalDividend <= 0) return result;

  const weights = shareholderPositions.map(p => p.sharesHeld);
  const payouts = distributeProRata(totalDividend, weights);

  // SFC: owner -totalDividend
  result.wealthDeltas.set(enterpriseOwner.id, -totalDividend);

  for (let i = 0; i < shareholderPositions.length; i++) {
    const pos = shareholderPositions[i];
    const payout = payouts[i];
    if (payout <= 0) continue;
    const prev = result.wealthDeltas.get(pos.ownerAgentId) ?? 0;
    result.wealthDeltas.set(pos.ownerAgentId, prev + payout);
  }

  result.trace.push(
    `[CMKT] Dividends: ${enterpriseOwner.id} distributed ${totalDividend} to ${shareholderPositions.length} shareholders`,
  );

  return result;
}

// ── processGovBondPurchase ─────────────────────────────────────────────────────

export type GovBondPurchaseResult =
  | { delta: CapitalMarketDelta }
  | { rejected: true; reason: string };

/**
 * Process a government bond purchase.
 *
 * Buyer pays faceValue, treasury receives faceValue, BondHolding created with status='active'.
 *
 * SFC: buyer.wealth -= faceValue, treasury += faceValue, net=0
 */
export function processGovBondPurchase(params: {
  sessionId: string;
  buyer: Agent;
  faceValue: number;
  economyConfig: EconomyConfig;
  iterationNumber: number;
}): GovBondPurchaseResult {
  const { sessionId, buyer, faceValue, economyConfig, iterationNumber } = params;

  if (buyer.currentStats.wealth < faceValue) {
    return {
      rejected: true,
      reason: `Buyer ${buyer.id} has insufficient wealth (${buyer.currentStats.wealth}) for gov bond with faceValue ${faceValue}`,
    };
  }

  const delta = emptyDelta();

  // SFC: buyer -faceValue, treasury +faceValue, net=0
  addWealth(delta, buyer.id, -faceValue);
  delta.treasuryDelta += faceValue;

  const holding: BondHolding = {
    id: uuidv4(),
    sessionId,
    ownerAgentId: buyer.id,
    issuerId: 'treasury',
    bondType: 'government',
    faceValue,
    couponRate: economyConfig.govBondCouponRate ?? 0.008,
    maturityIteration: iterationNumber + (economyConfig.govBondTermIterations ?? 10),
    purchaseIteration: iterationNumber,
    status: 'active',
  };

  delta.upsertBondHoldings.push(holding);
  delta.trace.push(
    `[CMKT] Gov bond purchase: ${buyer.id} bought bond faceValue=${faceValue}, coupon=${holding.couponRate}, maturity iter=${holding.maturityIteration}`,
  );

  return { delta };
}

// ── processCorpBondIssuance ────────────────────────────────────────────────────

export type CorpBondIssuanceResult =
  | { delta: CapitalMarketDelta }
  | { rejected: true; reason: string };

/**
 * Process a corporate bond issuance purchase.
 *
 * Buyer pays faceValue, enterprise owner receives faceValue, BondHolding created with issuerId=enterpriseOwner.id.
 *
 * SFC: buyer.wealth -= faceValue, enterpriseOwner.wealth += faceValue, net=0
 */
export function processCorpBondIssuance(params: {
  sessionId: string;
  buyer: Agent;
  enterpriseOwner: Agent;
  faceValue: number;
  couponRate: number;
  maturityIteration: number;
  iterationNumber: number;
}): CorpBondIssuanceResult {
  const { sessionId, buyer, enterpriseOwner, faceValue, couponRate, maturityIteration, iterationNumber } = params;

  if (buyer.currentStats.wealth < faceValue) {
    return {
      rejected: true,
      reason: `Buyer ${buyer.id} has insufficient wealth (${buyer.currentStats.wealth}) for corp bond with faceValue ${faceValue}`,
    };
  }

  const delta = emptyDelta();

  // SFC: buyer -faceValue, enterpriseOwner +faceValue (via enterpriseTreasuryDelta), net=0
  addWealth(delta, buyer.id, -faceValue);
  addEnterpriseTreasury(delta, enterpriseOwner.id, faceValue);

  const holding: BondHolding = {
    id: uuidv4(),
    sessionId,
    ownerAgentId: buyer.id,
    issuerId: enterpriseOwner.id,
    bondType: 'corporate',
    faceValue,
    couponRate,
    maturityIteration,
    purchaseIteration: iterationNumber,
    status: 'active',
  };

  delta.upsertBondHoldings.push(holding);
  delta.trace.push(
    `[CMKT] Corp bond issuance: ${buyer.id} bought bond from ${enterpriseOwner.id} faceValue=${faceValue}, coupon=${couponRate}, maturity iter=${maturityIteration}`,
  );

  return { delta };
}

// ── processCoupons ─────────────────────────────────────────────────────────────

export interface CouponResult {
  wealthDeltas: Map<string, number>;
  treasuryDelta: number;
  enterpriseTreasuryDeltas: Map<string, number>;
  trace: string[];
}

/**
 * Process coupon payments for all active bond holdings.
 *
 * For each active holding:
 *   coupon = faceValue * couponRate
 *   holder.wealth += coupon
 *   if gov bond: treasury -= coupon
 *   if corp bond: enterpriseOwner.wealth -= coupon
 *
 * SFC: holder +coupon, issuer -coupon, net=0 per bond
 */
export function processCoupons(params: {
  holdings: BondHolding[];
  currentIteration: number;
}): CouponResult {
  const { holdings } = params;
  const result: CouponResult = {
    wealthDeltas: new Map(),
    treasuryDelta: 0,
    enterpriseTreasuryDeltas: new Map(),
    trace: [],
  };

  for (const holding of holdings) {
    if (holding.status !== 'active') continue;

    const coupon = holding.faceValue * holding.couponRate;

    // SFC: holder +coupon
    const prev = result.wealthDeltas.get(holding.ownerAgentId) ?? 0;
    result.wealthDeltas.set(holding.ownerAgentId, prev + coupon);

    if (holding.bondType === 'government') {
      // SFC: treasury -coupon
      result.treasuryDelta -= coupon;
    } else {
      // SFC: enterprise owner -coupon
      const prevEnt = result.enterpriseTreasuryDeltas.get(holding.issuerId) ?? 0;
      result.enterpriseTreasuryDeltas.set(holding.issuerId, prevEnt - coupon);
    }

    result.trace.push(
      `[CMKT] Coupon: ${holding.ownerAgentId} received ${coupon.toFixed(4)} from ${holding.issuerId} (${holding.bondType} bond ${holding.id})`,
    );
  }

  return result;
}

// ── processMaturities ─────────────────────────────────────────────────────────

export interface MaturityResult {
  wealthDeltas: Map<string, number>;
  treasuryDelta: number;
  enterpriseTreasuryDeltas: Map<string, number>;
  deleteBondHoldingIds: string[];
  trace: string[];
}

/**
 * Process bond maturities for all active holdings due this iteration.
 *
 * For each holding where currentIteration >= maturityIteration:
 *   holder.wealth += faceValue
 *   if gov bond: treasury -= faceValue
 *   if corp bond: enterpriseOwner.wealth -= faceValue
 *   holding scheduled for deletion
 *
 * SFC: holder +faceValue, issuer -faceValue, net=0 per bond
 */
export function processMaturities(params: {
  holdings: BondHolding[];
  currentIteration: number;
}): MaturityResult {
  const { holdings, currentIteration } = params;
  const result: MaturityResult = {
    wealthDeltas: new Map(),
    treasuryDelta: 0,
    enterpriseTreasuryDeltas: new Map(),
    deleteBondHoldingIds: [],
    trace: [],
  };

  for (const holding of holdings) {
    if (holding.status !== 'active') continue;
    if (currentIteration < holding.maturityIteration) continue;

    // SFC: holder +faceValue
    const prev = result.wealthDeltas.get(holding.ownerAgentId) ?? 0;
    result.wealthDeltas.set(holding.ownerAgentId, prev + holding.faceValue);

    if (holding.bondType === 'government') {
      // SFC: treasury -faceValue
      result.treasuryDelta -= holding.faceValue;
    } else {
      // SFC: enterprise owner -faceValue
      const prevEnt = result.enterpriseTreasuryDeltas.get(holding.issuerId) ?? 0;
      result.enterpriseTreasuryDeltas.set(holding.issuerId, prevEnt - holding.faceValue);
    }

    result.deleteBondHoldingIds.push(holding.id);
    result.trace.push(
      `[CMKT] Maturity: ${holding.ownerAgentId} received principal ${holding.faceValue} from ${holding.issuerId} (${holding.bondType} bond ${holding.id})`,
    );
  }

  return result;
}

// ── processIteration ──────────────────────────────────────────────────────────

/**
 * Run the full per-iteration capital markets tick.
 *
 * Order of operations:
 *  1. Process pending share purchases
 *  2. Process pending share sales
 *  3. Process pending gov bond purchases
 *  4. Process pending corp bond issuances
 *  5. Distribute dividends for each enterprise owner
 *  6. Process coupon payments for all active bonds
 *  7. Process bond maturities
 *
 * All mutations collected and returned as a single CapitalMarketDelta.
 * No direct DB writes.
 */
export function processIteration(params: {
  sessionId: string;
  allAgents: Agent[];
  equityPositions: EquityPosition[];
  bondHoldings: BondHolding[];
  economyConfig: EconomyConfig;
  iterationNumber: number;
  pendingSharePurchases: Array<{
    buyerId: string;
    enterpriseOwnerId: string;
    sharesToBuy: number;
    totalSharesOutstanding: number;
  }>;
  pendingShareSales: Array<{
    sellerId: string;
    buyerId: string;
    enterpriseOwnerId: string;
    sharesToSell: number;
    totalSharesOutstanding: number;
  }>;
  pendingGovBondPurchases: Array<{
    buyerId: string;
    faceValue: number;
  }>;
  pendingCorpBondIssuances: Array<{
    buyerId: string;
    enterpriseOwnerId: string;
    faceValue: number;
    couponRate: number;
    maturityIteration: number;
  }>;
}): CapitalMarketDelta {
  const { sessionId, allAgents, equityPositions, bondHoldings, economyConfig, iterationNumber } = params;

  const delta = emptyDelta();

  // Build running agent wealth map for intra-iteration updates (living agents only)
  const livingAgents = allAgents.filter(a => a.isAlive);
  const agentWealth = new Map<string, number>(
    livingAgents.map(a => [a.id, a.currentStats.wealth]),
  );

  // Helper: get current agent (with running wealth)
  function getAgent(id: string): Agent | undefined {
    const base = livingAgents.find(a => a.id === id);
    if (!base) return undefined;
    return {
      ...base,
      currentStats: { ...base.currentStats, wealth: agentWealth.get(id) ?? base.currentStats.wealth },
    };
  }

  function applyWealthDelta(agentId: string, amount: number): void {
    // Skip dead agents — they should not receive dividends, coupons, or maturities
    if (!agentWealth.has(agentId)) return;
    const prev = agentWealth.get(agentId) ?? 0;
    agentWealth.set(agentId, prev + amount);
    addWealth(delta, agentId, amount);
  }

  // Build running equity positions map (keyed by "ownerAgentId:enterpriseOwnerId")
  const positionMap = new Map<string, EquityPosition>(
    equityPositions.map(p => [`${p.ownerAgentId}:${p.enterpriseOwnerId}`, p]),
  );

  // ── Step 1: Pending share purchases ────────────────────────────────────────
  for (const req of params.pendingSharePurchases) {
    const buyer = getAgent(req.buyerId);
    const owner = getAgent(req.enterpriseOwnerId);
    if (!buyer || !owner) continue;

    const existing = positionMap.get(`${req.buyerId}:${req.enterpriseOwnerId}`);
    const result = processSharePurchase({
      sessionId,
      buyer,
      enterpriseOwner: owner,
      sharesToBuy: req.sharesToBuy,
      totalSharesOutstanding: req.totalSharesOutstanding,
      existingPosition: existing,
      iterationNumber,
    });

    if ('rejected' in result) {
      delta.trace.push(`[CMKT] Share purchase rejected: ${result.reason}`);
      continue;
    }

    // Merge result into main delta
    for (const [id, amount] of result.delta.wealthDeltas) {
      applyWealthDelta(id, amount);
    }
    for (const pos of result.delta.upsertEquityPositions) {
      positionMap.set(`${pos.ownerAgentId}:${pos.enterpriseOwnerId}`, pos);
      // Only add if not already in the list (merge by id)
      const idx = delta.upsertEquityPositions.findIndex(p => p.id === pos.id);
      if (idx >= 0) delta.upsertEquityPositions[idx] = pos;
      else delta.upsertEquityPositions.push(pos);
    }
    delta.trace.push(...result.delta.trace);
  }

  // ── Step 2: Pending share sales ─────────────────────────────────────────────
  for (const req of params.pendingShareSales) {
    const seller = getAgent(req.sellerId);
    const buyer = getAgent(req.buyerId);
    const owner = getAgent(req.enterpriseOwnerId);
    if (!seller || !buyer || !owner) continue;

    const sellerPos = positionMap.get(`${req.sellerId}:${req.enterpriseOwnerId}`);
    if (!sellerPos) {
      delta.trace.push(`[CMKT] Share sale rejected: no position for ${req.sellerId} in ${req.enterpriseOwnerId}`);
      continue;
    }

    const buyerPos = positionMap.get(`${req.buyerId}:${req.enterpriseOwnerId}`);
    const result = processShareSale({
      sessionId,
      seller,
      buyer,
      enterpriseOwner: owner,
      sharesToSell: req.sharesToSell,
      totalSharesOutstanding: req.totalSharesOutstanding,
      sellerPosition: sellerPos,
      buyerExistingPosition: buyerPos,
      iterationNumber,
    });

    if ('rejected' in result) {
      delta.trace.push(`[CMKT] Share sale rejected: ${result.reason}`);
      continue;
    }

    for (const [id, amount] of result.delta.wealthDeltas) {
      applyWealthDelta(id, amount);
    }
    for (const pos of result.delta.upsertEquityPositions) {
      positionMap.set(`${pos.ownerAgentId}:${pos.enterpriseOwnerId}`, pos);
      const idx = delta.upsertEquityPositions.findIndex(p => p.id === pos.id);
      if (idx >= 0) delta.upsertEquityPositions[idx] = pos;
      else delta.upsertEquityPositions.push(pos);
    }
    delta.trace.push(...result.delta.trace);
  }

  // ── Step 3: Pending gov bond purchases ─────────────────────────────────────
  for (const req of params.pendingGovBondPurchases) {
    const buyer = getAgent(req.buyerId);
    if (!buyer) continue;

    const result = processGovBondPurchase({
      sessionId,
      buyer,
      faceValue: req.faceValue,
      economyConfig,
      iterationNumber,
    });

    if ('rejected' in result) {
      delta.trace.push(`[CMKT] Gov bond purchase rejected: ${result.reason}`);
      continue;
    }

    for (const [id, amount] of result.delta.wealthDeltas) {
      applyWealthDelta(id, amount);
    }
    delta.treasuryDelta += result.delta.treasuryDelta;
    delta.upsertBondHoldings.push(...result.delta.upsertBondHoldings);
    delta.trace.push(...result.delta.trace);
  }

  // ── Step 4: Pending corp bond issuances ────────────────────────────────────
  for (const req of params.pendingCorpBondIssuances) {
    const buyer = getAgent(req.buyerId);
    const owner = getAgent(req.enterpriseOwnerId);
    if (!buyer || !owner) continue;

    const result = processCorpBondIssuance({
      sessionId,
      buyer,
      enterpriseOwner: owner,
      faceValue: req.faceValue,
      couponRate: req.couponRate,
      maturityIteration: req.maturityIteration,
      iterationNumber,
    });

    if ('rejected' in result) {
      delta.trace.push(`[CMKT] Corp bond issuance rejected: ${result.reason}`);
      continue;
    }

    for (const [id, amount] of result.delta.wealthDeltas) {
      applyWealthDelta(id, amount);
    }
    for (const [eid, amount] of result.delta.enterpriseTreasuryDeltas) {
      addEnterpriseTreasury(delta, eid, amount);
    }
    delta.upsertBondHoldings.push(...result.delta.upsertBondHoldings);
    delta.trace.push(...result.delta.trace);
  }

  // ── Step 5: Distribute dividends for each enterprise owner ─────────────────
  // S3 fix: Use positionMap (updated by Steps 1-2) instead of the original
  // equityPositions array so dividends reflect same-iteration trades.
  const currentPositions = [...positionMap.values()];
  const enterpriseOwnerIds = [...new Set(currentPositions.map(p => p.enterpriseOwnerId))];
  for (const ownerId of enterpriseOwnerIds) {
    const owner = getAgent(ownerId);
    if (!owner) continue;

    // Filter out owner's own shares — dividend represents profit redistribution
    // to OTHER shareholders, not a self-payment loop.
    const externalPositions = currentPositions.filter(
      p => p.enterpriseOwnerId === ownerId && p.ownerAgentId !== ownerId,
    );
    if (externalPositions.length === 0) continue;

    const dividendResult = distributeDividends({
      enterpriseOwner: owner,
      shareholderPositions: externalPositions,
      economyConfig,
    });

    for (const [id, amount] of dividendResult.wealthDeltas) {
      applyWealthDelta(id, amount);
    }
    delta.trace.push(...dividendResult.trace);
  }

  // ── Step 6: Process coupon payments ────────────────────────────────────────
  const couponResult = processCoupons({ holdings: bondHoldings, currentIteration: iterationNumber });
  for (const [id, amount] of couponResult.wealthDeltas) {
    applyWealthDelta(id, amount);
  }
  delta.treasuryDelta += couponResult.treasuryDelta;
  for (const [eid, amount] of couponResult.enterpriseTreasuryDeltas) {
    addEnterpriseTreasury(delta, eid, amount);
  }
  delta.trace.push(...couponResult.trace);

  // ── Step 7: Process bond maturities ────────────────────────────────────────
  const maturityResult = processMaturities({ holdings: bondHoldings, currentIteration: iterationNumber });
  for (const [id, amount] of maturityResult.wealthDeltas) {
    applyWealthDelta(id, amount);
  }
  delta.treasuryDelta += maturityResult.treasuryDelta;
  for (const [eid, amount] of maturityResult.enterpriseTreasuryDeltas) {
    addEnterpriseTreasury(delta, eid, amount);
  }
  delta.deleteBondHoldingIds.push(...maturityResult.deleteBondHoldingIds);
  delta.trace.push(...maturityResult.trace);

  return delta;
}
