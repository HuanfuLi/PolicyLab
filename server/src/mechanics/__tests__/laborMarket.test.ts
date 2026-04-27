import { describe, it, expect } from 'vitest';
import { processWageAdjustment } from '../enterpriseEngine.js';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

const baseConfig = { ...DEFAULT_ECONOMY_CONFIG, laborWageNudgeK: 0.03, laborWageProfitShareAlpha: 0.15, defaultPerWorkerInputCost: 2, minimumWage: 5 };

describe('Phase 12: Labor market — wage adjustment + reservation wage + telemetry', () => {

  // ── L-05: Labor-market nudge ──────────────────────────────────────────────

  it('L-05: surplus applicants → wage decreases by k × surplus_ratio (D-01 step 2)', () => {
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 100, lastApplicants: 10, lastVacancies: 5 };
    const res = processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map(),
      previousLedgers: new Map(),
    });
    // surplus_ratio = min(0.5, (10-5)/max(5,1)) = min(0.5, 1.0) = 0.5
    // wage = 100 × (1 − 0.03 × 0.5) = 100 × 0.985 = 98.5
    expect(ent.wage).toBeCloseTo(98.5, 2);
    expect(res.wageChanges[0].nudgeFactor).toBeCloseTo(0.985, 3);
  });

  it('L-05: shortage (vacancies > applicants) → wage increases by k × shortage_ratio', () => {
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 100, lastApplicants: 2, lastVacancies: 10 };
    processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map(),
      previousLedgers: new Map(),
    });
    // shortage_ratio = min(0.5, (10-2)/max(2,1)) = min(0.5, 4.0) = 0.5
    // wage = 100 × (1 + 0.03 × 0.5) = 100 × 1.015 = 101.5
    expect(ent.wage).toBeCloseTo(101.5, 2);
  });

  it('L-05: profit-share top-up adds α × P&L / workforce when P&L > 0', () => {
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 50, lastApplicants: 0, lastVacancies: 0 };
    processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map(),
      previousLedgers: new Map([['e1', { totalRevenue: 120, totalWages: 30, workerCount: 3 }]]),
    });
    // pnl = 120-30 = 90; topup = 0.15 × (90/3) = 0.15 × 30 = 4.5
    // no nudge (v=0), no MRP (no prices), wage = 50 + 4.5 = 54.5
    expect(ent.wage).toBeCloseTo(54.5, 2);
  });

  it('L-05: profit-share top-up is zero when P&L ≤ 0', () => {
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 50, lastApplicants: 0, lastVacancies: 0 };
    const res = processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map(),
      previousLedgers: new Map([['e1', { totalRevenue: 20, totalWages: 30, workerCount: 3 }]]),
    });
    // pnl = 20-30 = -10 ≤ 0 → no top-up
    expect(ent.wage).toBeCloseTo(50, 2);
    expect(res.wageChanges[0].profitTopup).toBe(0);
  });

  it('L-05: minimum-wage floor enforced after all adjustments', () => {
    // Surplus nudge pushes wage below min floor
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 5.1, lastApplicants: 100, lastVacancies: 1 };
    processWageAdjustment({
      enterprises: [ent],
      config: { ...baseConfig, laborWageNudgeK: 0.5, minimumWage: 5 },
      ammSpotPrices: new Map(),
      previousLedgers: new Map(),
    });
    // surplus_ratio = min(0.5, 99/1) = 0.5 → nudgeFactor = 1 - 0.5×0.5 = 0.75
    // raw wage = 5.1 × 0.75 = 3.825, below minimumWage=5
    // floor applied → wage = 5
    expect(ent.wage).toBeCloseTo(5, 2);
    expect(ent.wage).toBeGreaterThanOrEqual(5);
  });

  // ── L-06: MRP ceiling ─────────────────────────────────────────────────────

  it('L-06: MRP ceiling clamps wage above output_price × output_per_worker − per_worker_input_cost', () => {
    // spot=3, productionPerWorker=10, perWorkerInputCost=2 → MRP = 3×10-2 = 28
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 40, lastApplicants: 0, lastVacancies: 0 };
    const res = processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map([['food', 3]]),
      previousLedgers: new Map(),
    });
    // wage=40 > mrp=28 → clamped to 28
    expect(ent.wage).toBeCloseTo(28, 2);
    expect(res.wageChanges[0].mrpClampApplied).toBe(true);
  });

  it('L-06: MRP ceiling is skipped when commodity spot price is 0 (12-RESEARCH §8 mitigation)', () => {
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 40, lastApplicants: 0, lastVacancies: 0 };
    const res = processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map([['food', 0]]),  // spot = 0 → skip MRP ceiling
      previousLedgers: new Map(),
    });
    // No nudge, no P&L topup, MRP skipped → wage unchanged at 40
    expect(ent.wage).toBeCloseTo(40, 2);
    expect(res.wageChanges[0].mrpClampApplied).toBe(false);
  });

  it('L-06: MRP ceiling is skipped when commodity spot price is NaN (12-RESEARCH §8 mitigation)', () => {
    const ent = { id: 'e1', sector: 'agriculture' as const, wage: 40, lastApplicants: 0, lastVacancies: 0 };
    const res = processWageAdjustment({
      enterprises: [ent],
      config: baseConfig,
      ammSpotPrices: new Map([['food', NaN]]),
      previousLedgers: new Map(),
    });
    expect(ent.wage).toBeCloseTo(40, 2);
    expect(res.wageChanges[0].mrpClampApplied).toBe(false);
  });

  // ── L-04: Reservation wage (these tests assert processWageAdjustment does not touch reservation wage state) ──

  it.todo('L-04: reservation wage = last PAS net proceeds when agent used PRODUCE_AND_SELL last iter');
  it.todo('L-04: reservation wage falls back to max(minimumWage × 0.5, small_constant) otherwise');

  // ── L-07: Net proceeds from PAS ──────────────────────────────────────────

  it.todo('L-07: net proceeds from PRODUCE_AND_SELL ≈ 0 at steady state over 10 iterations (medians within ±0.5 fiat)');

  // ── L-11: Telemetry fields ────────────────────────────────────────────────

  it.todo('L-11: avgPostedWage is workforce-weighted across surviving enterprises');
  it.todo('L-11: unemploymentRate = employable_without_employer / employable_total');
  it.todo('L-11: reservationWageP25/P50/P75 emitted per D-20');
});
