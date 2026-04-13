/**
 * SFC Taxation tests — Phase 11 D-12, D-14.
 *
 * Extended tax base beyond WORK. Withholding is inline at each taxable event
 * so SFC traceability holds per-action.
 *
 * Unit-level: computeWithholding helper dispatch (flat/progressive, 4 kinds).
 * Integration-level: covered in sfcCapitalMarkets.test.ts + inline SFC invariants
 * at each hook site (full runner integration guarded by tsc + grep acceptance).
 */
import { describe, it, expect } from 'vitest';
import type { TaxPolicy } from '@policylab/shared';
import { computeWithholding } from '../orchestration/helpers/taxWithholding.js';

const FLAT: TaxPolicy = {
  kind: 'flat',
  rates: { income: 0.15, vat: 0.1, capitalGains: 0.15 },
};

const PROGRESSIVE: TaxPolicy = {
  kind: 'progressive',
  rates: { income: 0.3, vat: 0.1, capitalGains: 0.15 },
  brackets: [
    { upto: 100, rate: 0.1 },
    { upto: 200, rate: 0.2 },
  ],
};

describe('computeWithholding (Phase 11 D-12, D-14)', () => {
  describe('flat policy dispatch', () => {
    it('wage: 15% of income', () => {
      expect(computeWithholding(100, 'wage', FLAT)).toBeCloseTo(15, 5);
    });

    it('amm_sell: 15% of proceeds (same as wage rate)', () => {
      expect(computeWithholding(100, 'amm_sell', FLAT)).toBeCloseTo(15, 5);
    });

    it('vat: 10% of base price', () => {
      expect(computeWithholding(100, 'vat', FLAT)).toBeCloseTo(10, 5);
    });

    it('capital_gains: 15% of proceeds', () => {
      expect(computeWithholding(100, 'capital_gains', FLAT)).toBeCloseTo(15, 5);
    });
  });

  describe('progressive policy dispatch', () => {
    it('wage under top bracket: piecewise — 150 income → 100×0.1 + 50×0.2 = 20', () => {
      expect(computeWithholding(150, 'wage', PROGRESSIVE)).toBeCloseTo(20, 5);
    });

    it('wage over top bracket: 250 income → 100×0.1 + 100×0.2 + 50×0.3 = 45', () => {
      expect(computeWithholding(250, 'wage', PROGRESSIVE)).toBeCloseTo(45, 5);
    });

    it('amm_sell uses the same piecewise ladder as wage', () => {
      expect(computeWithholding(150, 'amm_sell', PROGRESSIVE)).toBeCloseTo(20, 5);
    });

    it('vat stays at flat rate under progressive policy (brackets do not apply)', () => {
      expect(computeWithholding(150, 'vat', PROGRESSIVE)).toBeCloseTo(15, 5); // 150×0.1
    });

    it('capital_gains stays at flat rate under progressive policy', () => {
      expect(computeWithholding(150, 'capital_gains', PROGRESSIVE)).toBeCloseTo(22.5, 5); // 150×0.15
    });

    it('progressive with no brackets falls back to top income rate', () => {
      const noBrackets: TaxPolicy = {
        kind: 'progressive',
        rates: { income: 0.25, vat: 0.1, capitalGains: 0.15 },
      };
      expect(computeWithholding(100, 'wage', noBrackets)).toBeCloseTo(25, 5);
    });
  });

  describe('edge cases', () => {
    it('zero income: no tax', () => {
      expect(computeWithholding(0, 'wage', FLAT)).toBe(0);
    });

    it('negative income: no tax', () => {
      expect(computeWithholding(-50, 'wage', FLAT)).toBe(0);
    });

    it('undefined policy (legacy session): no tax, returns 0', () => {
      expect(computeWithholding(100, 'wage', undefined)).toBe(0);
    });

    it('rate over 0.5 is clamped to 0.5 (per-rate cap)', () => {
      const abusive: TaxPolicy = {
        kind: 'flat',
        rates: { income: 0.95, vat: 0.1, capitalGains: 0.15 },
      };
      expect(computeWithholding(100, 'wage', abusive)).toBeCloseTo(50, 5); // clamped
    });

    it('negative rate is clamped to 0', () => {
      const negative: TaxPolicy = {
        kind: 'flat',
        rates: { income: -0.1, vat: 0.1, capitalGains: 0.15 },
      };
      expect(computeWithholding(100, 'wage', negative)).toBe(0);
    });
  });
});

// ── Hook-site integration model (mirrors simulationRunner.ts wiring) ─────────
//
// These tests model the per-hook-site arithmetic the runner performs. They use
// computeWithholding directly the same way the runner does so SFC invariants
// hold end-to-end without mounting the full runner.

describe('wage-family hook sites (Task 2a, Phase 11 D-12/D-14)', () => {
  it('WORK: treasury-backed wage — employee nets 85, treasury gains 15 tax, SFC invariant holds', () => {
    // Model: runner debits treasury for gross wage, then withholds tax from employee, credits treasury.
    let treasury = 1000;
    let employeeWealth = 50;
    const wage = 100;

    const grossPaid = Math.min(wage, treasury);
    treasury -= grossPaid;
    const wageTax = computeWithholding(grossPaid, 'wage', FLAT);
    employeeWealth += (grossPaid - wageTax);
    treasury += wageTax;

    expect(wageTax).toBeCloseTo(15, 5);
    expect(employeeWealth).toBeCloseTo(50 + 85, 5);
    expect(treasury).toBeCloseTo(1000 - 100 + 15, 5);

    // SFC: wealthDelta (+85) + treasury delta (−85) = 0
    const wealthDelta = (grossPaid - wageTax);
    const treasuryDelta = -grossPaid + wageTax;
    expect(wealthDelta + treasuryDelta).toBeCloseTo(0, 5);
  });

  it('WORK with empty treasury: gross clawed back, no tax, no treasury delta', () => {
    let treasury = 0;
    let employeeWealth = 50;
    const wage = 100;

    const grossPaid = Math.min(wage, treasury);
    treasury -= grossPaid;
    const wageTax = computeWithholding(grossPaid, 'wage', FLAT);
    employeeWealth += (grossPaid - wageTax);
    treasury += wageTax;

    expect(grossPaid).toBe(0);
    expect(wageTax).toBe(0);
    expect(employeeWealth).toBe(50);
    expect(treasury).toBe(0);
  });

  it('enterprise wage solvent: owner debits gross 30, employee nets 25.5, treasury +4.5', () => {
    let treasury = 500;
    let ownerWealth = 1000;
    let employeeWealth = 20;
    const wage = 30;

    const wageTax = computeWithholding(wage, 'wage', FLAT);
    ownerWealth -= wage;
    employeeWealth += (wage - wageTax);
    treasury += wageTax;

    expect(wageTax).toBeCloseTo(4.5, 5);
    expect(ownerWealth).toBeCloseTo(970, 5);
    expect(employeeWealth).toBeCloseTo(45.5, 5);
    expect(treasury).toBeCloseTo(504.5, 5);

    // SFC invariant: ownerDelta + employeeDelta + treasuryDelta = 0
    const ownerDelta = -wage;
    const employeeDelta = wage - wageTax;
    const treasuryDelta = wageTax;
    expect(ownerDelta + employeeDelta + treasuryDelta).toBeCloseTo(0, 5);
  });

  it('enterprise wage bankruptcy partial pay: partial=15, tax=2.25, SFC holds on partial amount', () => {
    let treasury = 500;
    let ownerWealth = 15;
    let employeeWealth = 10;
    const partialPay = 15;

    const wageTax = computeWithholding(partialPay, 'wage', FLAT);
    ownerWealth -= partialPay;
    employeeWealth += (partialPay - wageTax);
    treasury += wageTax;

    expect(wageTax).toBeCloseTo(2.25, 5);
    expect(ownerWealth).toBe(0);
    expect(employeeWealth).toBeCloseTo(22.75, 5);
    expect(treasury).toBeCloseTo(502.25, 5);

    // SFC invariant
    const ownerDelta = -partialPay;
    const employeeDelta = partialPay - wageTax;
    const treasuryDelta = wageTax;
    expect(ownerDelta + employeeDelta + treasuryDelta).toBeCloseTo(0, 5);
  });

  it('legacy session (no taxPolicy): wage unchanged, no treasury delta', () => {
    let treasury = 1000;
    let employeeWealth = 50;
    const wage = 100;

    // undefined policy path
    const wageTax = computeWithholding(wage, 'wage', undefined);
    treasury -= wage;
    employeeWealth += (wage - wageTax);
    treasury += wageTax;

    expect(wageTax).toBe(0);
    expect(employeeWealth).toBe(150);
    expect(treasury).toBe(900);
  });

  it('progressive policy wage: 150 wage → 20 tax, employee nets 130', () => {
    let treasury = 1000;
    let employeeWealth = 0;
    const wage = 150;

    const wageTax = computeWithholding(wage, 'wage', PROGRESSIVE);
    treasury -= wage;
    employeeWealth += (wage - wageTax);
    treasury += wageTax;

    expect(wageTax).toBeCloseTo(20, 5);
    expect(employeeWealth).toBeCloseTo(130, 5);
    expect(treasury).toBeCloseTo(870, 5);
  });
});

describe('AMM/capital-family hook sites (Task 2b, Phase 11 D-12/D-14)', () => {
  it('PRODUCE_AND_SELL AMM sell: gross 20, tax 3, seller nets 17, treasury +3', () => {
    let treasury = 100;
    let sellerWealth = 10;
    const executionPrice = 4;
    const quantity = 5;
    const gross = executionPrice * quantity; // 20

    const sellTax = computeWithholding(gross, 'amm_sell', FLAT);
    sellerWealth += (gross - sellTax);
    treasury += sellTax;

    expect(sellTax).toBeCloseTo(3, 5);
    expect(sellerWealth).toBeCloseTo(27, 5);
    expect(treasury).toBeCloseTo(103, 5);

    // SFC: fiat moved from buyer → seller; tax routed from seller's share → treasury.
    // Seller+treasury delta = gross (incoming from buyer); net perimeter unchanged.
    const sellerDelta = gross - sellTax;
    const treasuryDelta = sellTax;
    expect(sellerDelta + treasuryDelta).toBeCloseTo(gross, 5);
  });

  it('AMM buy with VAT: 50 base price × 10% = 5 VAT. Buyer pays 55, seller gets 50, treasury +5', () => {
    let buyerWealth = 100;
    let sellerWealth = 20;
    let treasury = 200;
    const basePrice = 50;

    const vat = computeWithholding(basePrice, 'vat', FLAT);
    buyerWealth -= (basePrice + vat);
    // Seller still gets full base (VAT is buyer-side). Income tax on sell is separate.
    sellerWealth += basePrice;
    treasury += vat;

    expect(vat).toBeCloseTo(5, 5);
    expect(buyerWealth).toBeCloseTo(45, 5);
    expect(sellerWealth).toBeCloseTo(70, 5);
    expect(treasury).toBeCloseTo(205, 5);

    // SFC: buyerDelta + sellerDelta + treasuryDelta = 0
    const buyerDelta = -(basePrice + vat);
    const sellerDelta = basePrice;
    const treasuryDelta = vat;
    expect(buyerDelta + sellerDelta + treasuryDelta).toBeCloseTo(0, 5);
  });

  it('AMM trade with both VAT (on buy) and sell-income tax (on seller): full SFC chain', () => {
    // Model the runner's trade loop: buyer pays (base + vat), seller receives (base − sellTax),
    // treasury collects (vat + sellTax).
    let buyerWealth = 200;
    let sellerWealth = 50;
    let treasury = 300;
    const basePrice = 100;

    const vat = computeWithholding(basePrice, 'vat', FLAT); // 10
    const sellTax = computeWithholding(basePrice, 'amm_sell', FLAT); // 15
    buyerWealth -= (basePrice + vat);
    sellerWealth += (basePrice - sellTax);
    treasury += (vat + sellTax);

    expect(vat).toBeCloseTo(10, 5);
    expect(sellTax).toBeCloseTo(15, 5);
    expect(buyerWealth).toBeCloseTo(90, 5);
    expect(sellerWealth).toBeCloseTo(135, 5);
    expect(treasury).toBeCloseTo(325, 5);

    // SFC: buyer(−110) + seller(+85) + treasury(+25) = 0
    const buyerDelta = -(basePrice + vat);
    const sellerDelta = basePrice - sellTax;
    const treasuryDelta = vat + sellTax;
    expect(buyerDelta + sellerDelta + treasuryDelta).toBeCloseTo(0, 5);
  });

  it('SELL_SHARES capital gains: proceeds 100, 15% tax, holder nets 85, treasury +15', () => {
    let treasury = 200;
    let holderWealth = 500;
    const proceeds = 100; // positive cmktDelta.wealthDeltas entry

    const tax = computeWithholding(proceeds, 'capital_gains', FLAT);
    holderWealth += (proceeds - tax);
    treasury += tax;

    expect(tax).toBeCloseTo(15, 5);
    expect(holderWealth).toBeCloseTo(585, 5);
    expect(treasury).toBeCloseTo(215, 5);
  });

  it('matured bond payout: principal 100, 15% tax, holder nets 85, treasury +15', () => {
    // Model: cmktDelta.wealthDeltas positive entry for bond holder at maturity.
    let treasury = 500;
    let holderWealth = 0;
    const payout = 100;

    const tax = computeWithholding(payout, 'capital_gains', FLAT);
    holderWealth += (payout - tax);
    treasury += tax;

    expect(tax).toBeCloseTo(15, 5);
    expect(holderWealth).toBeCloseTo(85, 5);
    expect(treasury).toBeCloseTo(515, 5);
  });

  it('negative cmkt delta (share purchase): no withholding applied', () => {
    // Model: buyer's cmktDelta.wealthDeltas entry is negative (paying for shares).
    let treasury = 100;
    let buyerWealth = 200;
    const cost = -50; // negative delta

    if (cost > 0) {
      const tax = computeWithholding(cost, 'capital_gains', FLAT);
      buyerWealth += (cost - tax);
      treasury += tax;
    } else {
      buyerWealth += cost;
    }

    expect(buyerWealth).toBe(150);
    expect(treasury).toBe(100); // unchanged
  });

  it('legacy session (undefined taxPolicy): no VAT, no sell-tax, no capital-gains tax', () => {
    let buyerWealth = 200;
    let sellerWealth = 50;
    let treasury = 300;
    const basePrice = 100;

    const vat = computeWithholding(basePrice, 'vat', undefined);
    const sellTax = computeWithholding(basePrice, 'amm_sell', undefined);
    buyerWealth -= (basePrice + vat);
    sellerWealth += (basePrice - sellTax);
    treasury += (vat + sellTax);

    expect(vat).toBe(0);
    expect(sellTax).toBe(0);
    expect(buyerWealth).toBe(100);
    expect(sellerWealth).toBe(150);
    expect(treasury).toBe(300); // unchanged
  });
});
