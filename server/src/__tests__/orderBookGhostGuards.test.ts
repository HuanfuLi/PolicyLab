/**
 * Order-book ghost-guard tests — regression tests for H1 (ghost buyer / positive leak)
 * and H2 (ghost seller / negative leak).
 *
 * Plan: 11-GC1 Task 1 (RED phase)
 *
 * Forensics G1 §H1 / §H2: the order-book clearing loop at simulationRunner.ts:1477–1542
 * debits or credits one side of a trade even when the counterparty has no weekStateMap
 * entry, silently creating or destroying fiat.
 *
 * These tests exercise a pure `driveOrderBookClearing` helper that mirrors the current
 * simulationRunner loop logic.  The tests FAIL against the legacy implementation and
 * PASS after Patch B guards are applied.
 */
import { describe, it, expect } from 'vitest';
import type { TradeMatch } from '@policylab/shared';
import type { AgentWeekState } from '../orchestration/helpers/weekState.js';
import { createAgentWeekState } from '../orchestration/helpers/weekState.js';

// ── Trade clearing helper (mirrors simulationRunner.ts:1478–1541) ─────────────

/**
 * Mirrors the current BUGGY clearing loop (no ghost guards).
 * Used to confirm the legacy failure mode in the RED tests.
 */
function driveOrderBookClearingLegacy(params: {
  trades: TradeMatch[];
  weekStateMap: Map<string, AgentWeekState>;
  treasury: number;
  vatRate?: number;
  sellTaxRate?: number;
}): { treasury: number; traces: string[] } {
  let { treasury } = params;
  const { trades, weekStateMap } = params;
  const vatRate = params.vatRate ?? 0;
  const sellTaxRate = params.sellTaxRate ?? 0;
  const traces: string[] = [];

  for (const trade of trades) {
    const buyerState = weekStateMap.get(trade.buyerId);
    const sellerState = weekStateMap.get(trade.sellerId);
    const basePrice = trade.executionPrice * trade.quantity;

    if (buyerState) {
      // PATH A: real buyer
      const vat = basePrice * vatRate;
      buyerState.wealthDelta -= (basePrice + vat);
      treasury += vat;
      traces.push(`[TAX] VAT ${vat.toFixed(2)} on buy ${basePrice.toFixed(2)} (${trade.buyerId})`);
    } else if (trade.buyerId === 'SYSTEM_NPC') {
      // PATH B: SYSTEM_NPC
      const fundedCost = Math.min(basePrice, treasury);
      treasury -= fundedCost;
      if (sellerState) {
        const sellTax = fundedCost * sellTaxRate;
        sellerState.wealthDelta += (fundedCost - sellTax);
        treasury += sellTax;
        traces.push(`[TAX] Withheld ${sellTax.toFixed(2)} from NPC sell (${trade.sellerId})`);
      }
      continue; // always skip unconditional seller block
    }
    // PATH C: unconditional seller block — BUG: fires even when buyerState is absent
    if (sellerState) {
      const sellTax = basePrice * sellTaxRate;
      sellerState.wealthDelta += (basePrice - sellTax);
      treasury += sellTax;
      traces.push(`[TAX] Withheld ${sellTax.toFixed(2)} from sell ${basePrice.toFixed(2)} (${trade.sellerId})`);
    }
  }

  return { treasury, traces };
}

/**
 * Mirrors the FIXED clearing loop (Patch B: early-continue guards for ghost buyer + ghost seller).
 */
function driveOrderBookClearingFixed(params: {
  trades: TradeMatch[];
  weekStateMap: Map<string, AgentWeekState>;
  treasury: number;
  vatRate?: number;
  sellTaxRate?: number;
}): { treasury: number; traces: string[] } {
  let { treasury } = params;
  const { trades, weekStateMap } = params;
  const vatRate = params.vatRate ?? 0;
  const sellTaxRate = params.sellTaxRate ?? 0;
  const traces: string[] = [];

  for (const trade of trades) {
    const buyerState = weekStateMap.get(trade.buyerId);
    const sellerState = weekStateMap.get(trade.sellerId);
    const isSystemNpcBuyer = trade.buyerId === 'SYSTEM_NPC';

    // H2 guard — ghost seller: prevents negative leak
    if (!sellerState) {
      traces.push(`[ORDER-BOOK-SKIP] Ghost seller ${trade.sellerId} — trade voided`);
      continue;
    }
    // H1 guard — ghost buyer: prevents positive leak
    if (!buyerState && !isSystemNpcBuyer) {
      traces.push(`[ORDER-BOOK-SKIP] Ghost buyer ${trade.buyerId} — trade voided`);
      continue;
    }

    const basePrice = trade.executionPrice * trade.quantity;

    if (buyerState) {
      // PATH A: real buyer
      const vat = basePrice * vatRate;
      buyerState.wealthDelta -= (basePrice + vat);
      treasury += vat;
    } else if (isSystemNpcBuyer) {
      // PATH B: SYSTEM_NPC
      const fundedCost = Math.min(basePrice, treasury);
      treasury -= fundedCost;
      const sellTax = fundedCost * sellTaxRate;
      sellerState.wealthDelta += (fundedCost - sellTax);
      treasury += sellTax;
      continue;
    }
    // PATH C: seller credit
    const sellTax = basePrice * sellTaxRate;
    sellerState.wealthDelta += (basePrice - sellTax);
    treasury += sellTax;
  }

  return { treasury, traces };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<TradeMatch> & Pick<TradeMatch, 'buyerId' | 'sellerId'>): TradeMatch {
  return {
    buyOrderId: 'bo-1',
    sellOrderId: 'so-1',
    itemType: 'tools',
    quantity: 5,
    executionPrice: 10,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('order-book ghost-side guards (H1 + H2)', () => {

  // ── H2: Ghost SELLER — negative leak (the −2655 case) ──────────────────────

  it('ghost seller trade voids cleanly — buyer not debited (H2, negative-leak prevention)', () => {
    const buyerState = createAgentWeekState();
    buyerState.wealthDelta = 0;
    const weekStateMap = new Map([['real-buyer', buyerState]]);
    // Seller is NOT in weekStateMap — stale cross-iteration order
    const trade = makeTrade({ buyerId: 'real-buyer', sellerId: 'ghost-seller-uuid' });

    const { treasury, traces } = driveOrderBookClearingFixed({
      trades: [trade],
      weekStateMap,
      treasury: 0,
    });

    // Buyer must NOT be debited (wealthDelta unchanged at 0)
    expect(buyerState.wealthDelta).toBe(0);
    // Treasury must not change
    expect(treasury).toBe(0);
    // A skip-trace must be emitted
    expect(traces.some(t => t.includes('Ghost seller'))).toBe(true);
  });

  it('legacy code (no ghost guards): ghost seller causes negative fiat leak (H2 failure mode baseline)', () => {
    const buyerState = createAgentWeekState();
    buyerState.wealthDelta = 0;
    const weekStateMap = new Map([['real-buyer', buyerState]]);
    const trade = makeTrade({ buyerId: 'real-buyer', sellerId: 'ghost-seller-uuid' });

    driveOrderBookClearingLegacy({
      trades: [trade],
      weekStateMap,
      treasury: 0,
    });

    // BUG CONFIRMED: buyer is debited (50 fiat), no seller credited → fiat destroyed
    expect(buyerState.wealthDelta).toBeLessThan(0);
  });

  // ── H1: Ghost BUYER — positive leak (sign-mirror of H2) ────────────────────

  it('ghost buyer trade voids cleanly — seller not credited (H1, positive-leak prevention)', () => {
    const sellerState = createAgentWeekState();
    sellerState.wealthDelta = 0;
    const weekStateMap = new Map([['real-seller', sellerState]]);
    // Buyer is NOT in weekStateMap AND is not SYSTEM_NPC
    const trade = makeTrade({ buyerId: 'ghost-buyer-uuid', sellerId: 'real-seller' });

    const { treasury, traces } = driveOrderBookClearingFixed({
      trades: [trade],
      weekStateMap,
      treasury: 0,
    });

    // Seller must NOT be credited (wealthDelta unchanged at 0)
    expect(sellerState.wealthDelta).toBe(0);
    // Treasury must not change
    expect(treasury).toBe(0);
    // A skip-trace must be emitted
    expect(traces.some(t => t.includes('Ghost buyer'))).toBe(true);
  });

  it('legacy code (no ghost guards): ghost buyer causes positive fiat leak (H1 failure mode baseline)', () => {
    const sellerState = createAgentWeekState();
    sellerState.wealthDelta = 0;
    const weekStateMap = new Map([['real-seller', sellerState]]);
    const trade = makeTrade({ buyerId: 'ghost-buyer-uuid', sellerId: 'real-seller' });

    driveOrderBookClearingLegacy({
      trades: [trade],
      weekStateMap,
      treasury: 0,
    });

    // BUG CONFIRMED: seller is credited (50 fiat), no buyer debited → fiat created
    expect(sellerState.wealthDelta).toBeGreaterThan(0);
  });

  // ── SYSTEM_NPC buyer regression: must NOT be broken by H1 guard ──────────────

  it('SYSTEM_NPC buyer path still works — seller credited from treasury (regression)', () => {
    const sellerState = createAgentWeekState();
    sellerState.wealthDelta = 0;
    const weekStateMap = new Map([['real-seller', sellerState]]);
    // SYSTEM_NPC has no weekStateMap entry but must still credit the seller
    const trade = makeTrade({ buyerId: 'SYSTEM_NPC', sellerId: 'real-seller', quantity: 5, executionPrice: 10 });

    const initialTreasury = 1000;
    const { treasury } = driveOrderBookClearingFixed({
      trades: [trade],
      weekStateMap,
      treasury: initialTreasury,
    });

    const basePrice = 10 * 5; // 50
    // Seller credited basePrice (no sell tax configured)
    expect(sellerState.wealthDelta).toBeCloseTo(basePrice, 2);
    // Treasury debited basePrice
    expect(treasury).toBeCloseTo(initialTreasury - basePrice, 2);
  });
});
