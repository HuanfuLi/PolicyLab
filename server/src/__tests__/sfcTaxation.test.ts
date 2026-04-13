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
