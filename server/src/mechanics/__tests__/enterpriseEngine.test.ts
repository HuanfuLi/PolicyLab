import { describe, it, expect } from 'vitest';
import {
  sectorToCommodity,
  processEnterpriseWages,
  processEnterpriseInsolvency,
  processIdleFallback,
  processEnterpriseProduction,
  processEnterpriseCostPassThrough,
  type EnterpriseDelta,
} from '../enterpriseEngine';
import type { EconomyConfig } from '@policylab/shared';

const baseConfig: Partial<EconomyConfig> = {
  bankingEnabled: false,
  reserveRequirement: 0.1,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
  minimumWage: 5,
  enterpriseInsolvencyThreshold: 3,
  idleFallbackProduction: 5,
  idleFallbackThreshold: 2,
};

describe('sectorToCommodity', () => {
  it('maps agriculture to food', () => {
    expect(sectorToCommodity('agriculture')).toBe('food');
  });

  it('maps industry to tools', () => {
    expect(sectorToCommodity('industry')).toBe('tools');
  });

  it('maps services to luxury_goods', () => {
    expect(sectorToCommodity('services')).toBe('luxury_goods');
  });

  it('maps government to none', () => {
    expect(sectorToCommodity('government')).toBe('none');
  });
});

describe('processEnterpriseWages', () => {
  it('pays full wages when treasury is sufficient', () => {
    const result = processEnterpriseWages({
      enterprises: [
        { id: 'ent1', ownerId: 'owner1', wage: 10, employees: new Set(['w1', 'w2']), treasury: 100 },
      ],
      workedAgents: new Set(['w1', 'w2']),
      config: baseConfig as EconomyConfig,
      insolvencyCounters: new Map(),
    });

    expect(result.wagePayments).toHaveLength(2);
    expect(result.wagePayments[0].amount).toBe(10);
    expect(result.wagePayments[1].amount).toBe(10);
    // insolvency reset to 0
    const update = result.insolvencyUpdates.find(u => u.enterpriseId === 'ent1');
    expect(update?.consecutiveDeficits).toBe(0);
  });

  it('enforces minimum wage floor', () => {
    const result = processEnterpriseWages({
      enterprises: [
        { id: 'ent1', ownerId: 'owner1', wage: 2, employees: new Set(['w1']), treasury: 100 },
      ],
      workedAgents: new Set(['w1']),
      config: { ...baseConfig, minimumWage: 5 } as EconomyConfig,
      insolvencyCounters: new Map(),
    });

    // wage should be bumped to minimumWage=5
    expect(result.wagePayments[0].amount).toBe(5);
  });

  it('pays pro-rata when treasury is insufficient', () => {
    const result = processEnterpriseWages({
      enterprises: [
        { id: 'ent1', ownerId: 'owner1', wage: 10, employees: new Set(['w1', 'w2']), treasury: 10 },
      ],
      workedAgents: new Set(['w1', 'w2']),
      config: baseConfig as EconomyConfig,
      insolvencyCounters: new Map(),
    });

    // treasury=10, totalWages=20, each gets 10/20*10=5
    expect(result.wagePayments[0].amount).toBe(5);
    expect(result.wagePayments[1].amount).toBe(5);
    // insolvency incremented
    const update = result.insolvencyUpdates.find(u => u.enterpriseId === 'ent1');
    expect(update?.consecutiveDeficits).toBe(1);
  });
});

describe('processEnterpriseInsolvency', () => {
  it('does not trigger bankruptcy below threshold', () => {
    const result = processEnterpriseInsolvency({
      insolvencyCounters: new Map([['ent1', 2]]),
      enterprises: [
        { id: 'ent1', ownerId: 'owner1', wage: 10, employees: new Set(['w1']), treasury: 0 },
      ],
      config: { ...baseConfig, enterpriseInsolvencyThreshold: 3 } as EconomyConfig,
    });

    const update = result.insolvencyUpdates.find(u => u.enterpriseId === 'ent1');
    expect(update?.isBankrupt).toBe(false);
  });

  it('triggers bankruptcy at threshold', () => {
    const result = processEnterpriseInsolvency({
      insolvencyCounters: new Map([['ent1', 3]]),
      enterprises: [
        { id: 'ent1', ownerId: 'owner1', wage: 10, employees: new Set(['w1']), treasury: 0 },
      ],
      config: { ...baseConfig, enterpriseInsolvencyThreshold: 3 } as EconomyConfig,
    });

    const update = result.insolvencyUpdates.find(u => u.enterpriseId === 'ent1');
    expect(update?.isBankrupt).toBe(true);
  });
});

describe('processIdleFallback', () => {
  it('increments counter for idle agents', () => {
    const result = processIdleFallback({
      idleCounters: new Map([['agent1', 0]]),
      agentActions: new Map([['agent1', []]]),
      config: baseConfig as EconomyConfig,
    });

    // counter at 1, below threshold 2, no production
    expect(result.idleFallbackProduction).toHaveLength(0);
  });

  it('produces food at threshold', () => {
    const result = processIdleFallback({
      idleCounters: new Map([['agent1', 1]]),
      agentActions: new Map([['agent1', []]]),
      config: baseConfig as EconomyConfig,
    });

    // counter was 1, incremented to 2 >= threshold 2
    expect(result.idleFallbackProduction).toHaveLength(1);
    expect(result.idleFallbackProduction[0].agentId).toBe('agent1');
    expect(result.idleFallbackProduction[0].quantity).toBe(5);
  });

  it('resets counter when agent works', () => {
    const result = processIdleFallback({
      idleCounters: new Map([['agent1', 5]]),
      agentActions: new Map([['agent1', ['WORK']]]),
      config: baseConfig as EconomyConfig,
    });

    expect(result.idleFallbackProduction).toHaveLength(0);
  });
});

describe('processEnterpriseProduction', () => {
  it('maps enterprise sector to commodity output', () => {
    const result = processEnterpriseProduction({
      enterprises: [
        { id: 'ent1', sector: 'agriculture', productionQuantity: 10 },
        { id: 'ent2', sector: 'industry', productionQuantity: 8 },
      ],
    });

    expect(result.productionOutput).toContainEqual(
      expect.objectContaining({ enterpriseId: 'ent1', commodity: 'food', quantity: 10 }),
    );
    expect(result.productionOutput).toContainEqual(
      expect.objectContaining({ enterpriseId: 'ent2', commodity: 'tools', quantity: 8 }),
    );
  });

  it('includes secondary output for industry (raw_materials at 50%)', () => {
    const result = processEnterpriseProduction({
      enterprises: [
        { id: 'ent1', sector: 'industry', productionQuantity: 10 },
      ],
    });

    const secondary = result.productionOutput.find(
      p => p.enterpriseId === 'ent1' && p.commodity === 'raw_materials',
    );
    expect(secondary).toBeDefined();
    expect(secondary!.quantity).toBe(5); // 50% of 10
  });
});

describe('processEnterpriseCostPassThrough', () => {
  it('computes markup when wage costs rise', () => {
    const result = processEnterpriseCostPassThrough({
      currentWageCosts: new Map([['ent1', 120]]),
      previousWageCosts: new Map([['ent1', 100]]),
    });

    // markup = 1 + (20/100) * 0.5 = 1.10
    expect(result.costPassThroughMarkup.get('ent1')).toBeCloseTo(1.10);
  });

  it('returns markup of 1.0 when costs unchanged', () => {
    const result = processEnterpriseCostPassThrough({
      currentWageCosts: new Map([['ent1', 100]]),
      previousWageCosts: new Map([['ent1', 100]]),
    });

    expect(result.costPassThroughMarkup.get('ent1')).toBeCloseTo(1.0);
  });
});

// ── Phase 12: processWageAdjustment tests ─────────────────────────────────────

import { processWageAdjustment } from '../enterpriseEngine.js';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

describe('Phase 12: processWageAdjustment (D-01 hybrid wage rule)', () => {
  const baseEnt = {
    id: 'e1',
    sector: 'agriculture' as const,
    wage: 50,
    lastApplicants: 0,
    lastVacancies: 0,
  };

  it('Baseline: no applicants, no vacancies, no P&L → wage unchanged (only min-floor)', () => {
    const ent = { ...baseEnt, wage: 50, lastApplicants: 0, lastVacancies: 0 };
    processWageAdjustment({
      enterprises: [ent],
      config: { ...DEFAULT_ECONOMY_CONFIG, laborWageNudgeK: 0.03, minimumWage: 5 },
      ammSpotPrices: new Map(),
      previousLedgers: new Map(),
    });
    // No nudge (no vacancies), no profit-share (no ledger), no MRP (no price), min floor irrelevant at 50
    expect(ent.wage).toBeCloseTo(50, 2);
  });

  it('Shortage (vacancies > applicants) → wage rises by k × shortage_ratio', () => {
    const ent = { ...baseEnt, wage: 100, lastApplicants: 0, lastVacancies: 5 };
    processWageAdjustment({
      enterprises: [ent],
      config: { ...DEFAULT_ECONOMY_CONFIG, laborWageNudgeK: 0.03, minimumWage: 5 },
      ammSpotPrices: new Map(),
      previousLedgers: new Map(),
    });
    // shortage_ratio = min(0.5, (5-0)/max(0,1)) = min(0.5, 5) = 0.5
    // wage = 100 × (1 + 0.03 × 0.5) = 100 × 1.015 = 101.5
    expect(ent.wage).toBeCloseTo(101.5, 2);
  });

  it('Integration: all five steps compose correctly — shortage nudge, profit topup, MRP clamp, min floor', () => {
    // applicants=0, vacancies=5 → shortage nudge up
    // previousLedger: pnl=100-30=70, workerCount=3 → profitTopup = 0.15×(70/3) ≈ 3.5
    // spot=20, productionPerWorker=10, perWorkerInputCost=2 → mrp=20×10-2=198 (no clamp at low wages)
    // min floor = 5 (no effect at high wages)
    const ent = { ...baseEnt, sector: 'agriculture' as const, wage: 50, lastApplicants: 0, lastVacancies: 5 };
    const result = processWageAdjustment({
      enterprises: [ent],
      config: { ...DEFAULT_ECONOMY_CONFIG, laborWageNudgeK: 0.03, laborWageProfitShareAlpha: 0.15, defaultPerWorkerInputCost: 2, minimumWage: 5 },
      ammSpotPrices: new Map([['food', 20]]),
      previousLedgers: new Map([['e1', { totalRevenue: 100, totalWages: 30, workerCount: 3 }]]),
    });
    // shortage_ratio = min(0.5, (5-0)/max(0,1)) = 0.5
    // after nudge: 50 × (1 + 0.03 × 0.5) = 50 × 1.015 = 50.75
    // after profitTopup: 50.75 + 0.15 × (70/3) = 50.75 + 3.5 = 54.25
    // mrp = 20×10−2 = 198, wage=54.25 < 198 → no clamp
    // min floor = 5, 54.25 > 5 → unchanged
    expect(ent.wage).toBeCloseTo(54.25, 1);
    expect(result.wageChanges[0].mrpClampApplied).toBe(false);
  });
});
