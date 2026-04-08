import { describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY_CONFIG, type EconomyConfig } from '@policylab/shared';
import { computeInflation, computeTaylorRule, type InflationInput, type TaylorRuleInput } from '../inflationEngine.js';

const basePrices = {
  food: 100,
  tools: 100,
  luxury_goods: 100,
  raw_materials: 100,
};

function makeConfig(overrides: Partial<EconomyConfig> = {}): EconomyConfig {
  return {
    ...DEFAULT_ECONOMY_CONFIG,
    ...overrides,
  };
}

function makeInput(overrides: Partial<InflationInput> = {}): InflationInput {
  return {
    iterationNumber: 2,
    currentPrices: { ...basePrices },
    basePrices: { ...basePrices },
    m1Current: 1000,
    m1Previous: 1000,
    previousCpi: 100,
    recentCpiHistory: [100, 100],
    economyConfig: makeConfig(),
    ...overrides,
  };
}

describe('computeInflation', () => {
  it('returns CPI=100 when current prices equal base prices', () => {
    const result = computeInflation(makeInput());
    expect(result.cpi).toBe(100);
  });

  it('returns CPI=140 when food price doubles and other basket items stay flat', () => {
    const result = computeInflation(makeInput({
      currentPrices: {
        ...basePrices,
        food: 200,
      },
      previousCpi: 140,
      recentCpiHistory: [100, 140],
    }));

    expect(result.cpi).toBe(140);
  });

  it('computes inflationRate from current CPI versus previous CPI', () => {
    const result = computeInflation(makeInput({
      currentPrices: {
        food: 110,
        tools: 110,
        luxury_goods: 110,
        raw_materials: 110,
      },
      previousCpi: 100,
      recentCpiHistory: [100, 110],
    }));

    expect(result.inflationRate).toBeCloseTo(10, 6);
  });

  it('returns inflationRate=0 on iteration 1 when previous CPI is null', () => {
    const result = computeInflation(makeInput({
      iterationNumber: 1,
      previousCpi: null,
      recentCpiHistory: [100],
    }));

    expect(result.inflationRate).toBe(0);
  });

  it('computes inflationExpectations as the rolling mean of recent CPI inflation rates', () => {
    const result = computeInflation(makeInput({
      recentCpiHistory: [100, 110, 132],
    }));

    expect(result.inflationExpectations).toBeCloseTo(15, 6);
  });

  it('returns ammFeedbackFactor=1.0 when inflation expectations stay below threshold', () => {
    const result = computeInflation(makeInput({
      recentCpiHistory: [100, 100.4],
      economyConfig: makeConfig({
        inflationAmmThreshold: 0.5,
      }),
    }));

    expect(result.ammFeedbackFactor).toBe(1);
  });

  it('returns ammFeedbackFactor > 1.0 when inflation expectations exceed threshold', () => {
    const result = computeInflation(makeInput({
      recentCpiHistory: [100, 110],
    }));

    expect(result.ammFeedbackFactor).toBeGreaterThan(1);
  });

  it('caps ammFeedbackFactor at 1 + inflationAmmCap/100', () => {
    const result = computeInflation(makeInput({
      recentCpiHistory: [100, 500],
      economyConfig: makeConfig({
        inflationAmmCap: 2,
      }),
    }));

    expect(result.ammFeedbackFactor).toBeCloseTo(1.02, 6);
  });

  it('subtracts productivityGrowthEstimate from M1 growth to derive the M1 signal', () => {
    const result = computeInflation(makeInput({
      m1Current: 1200,
      m1Previous: 1000,
      economyConfig: makeConfig({
        m1InflationCoeff: 1,
        productivityGrowthEstimate: 0.01,
      }),
      previousCpi: 100,
      recentCpiHistory: [100],
    }));

    expect(result.inflationExpectations).toBeCloseTo(19, 6);
  });

  it('uses blended inflation = (1-alpha)*cpiInflation + alpha*m1Signal*100', () => {
    const result = computeInflation(makeInput({
      currentPrices: {
        food: 110,
        tools: 110,
        luxury_goods: 110,
        raw_materials: 110,
      },
      previousCpi: 100,
      m1Current: 1200,
      m1Previous: 1000,
      recentCpiHistory: [100],
      economyConfig: makeConfig({
        m1InflationCoeff: 0.25,
        productivityGrowthEstimate: 0.01,
      }),
    }));

    expect(result.inflationExpectations).toBeCloseTo(12.25, 6);
  });

  it('returns a human-readable trace of the computation steps', () => {
    const result = computeInflation(makeInput());

    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace.some((line) => /cpi/i.test(line))).toBe(true);
    expect(result.trace.some((line) => /m1/i.test(line))).toBe(true);
    expect(result.trace.some((line) => /amm/i.test(line))).toBe(true);
  });
});

function makeTaylorInput(overrides: Partial<TaylorRuleInput> = {}): TaylorRuleInput {
  return {
    currentInflationRate: 0.00167,
    inflationTarget: 0.00167,
    neutralRate: 0.00167,
    outputGapEstimate: 0,
    rateCeiling: 0.0125,
    inflationCoeff: 0.5,
    outputCoeff: 0.5,
    ...overrides,
  };
}

describe('Taylor Rule (D-14, D-15)', () => {
  it('computes target rate above neutral when inflation exceeds target', () => {
    const result = computeTaylorRule(makeTaylorInput({
      currentInflationRate: 0.05,
      inflationTarget: 0.00167,
      neutralRate: 0.00167,
    }));
    // High inflation should push raw rate well above neutral, hitting the ceiling
    expect(result.targetRate).toBe(0.0125);
    expect(result.ceilingHit).toBe(true);
  });

  it('computes accommodative rate when inflation below target', () => {
    const result = computeTaylorRule(makeTaylorInput({
      currentInflationRate: 0.001,
      inflationTarget: 0.00167,
      neutralRate: 0.00167,
    }));
    // Low inflation should yield rate below ceiling
    expect(result.targetRate).toBeGreaterThan(0.001);
    expect(result.targetRate).toBeLessThan(0.0125);
    expect(result.ceilingHit).toBe(false);
  });

  it('applies reserve ratio adjustment when ceiling hit', () => {
    const result = computeTaylorRule(makeTaylorInput({
      currentInflationRate: 0.05,
    }));
    expect(result.ceilingHit).toBe(true);
    expect(result.reserveRatioAdjustment).toBeGreaterThan(0);
  });

  it('no reserve adjustment when rate below ceiling', () => {
    const result = computeTaylorRule(makeTaylorInput({
      currentInflationRate: 0.001,
    }));
    expect(result.ceilingHit).toBe(false);
    expect(result.reserveRatioAdjustment).toBe(0);
  });

  it('generates trace with rate details', () => {
    const result = computeTaylorRule(makeTaylorInput());
    expect(result.trace.some(l => l.includes('[CB] Taylor Rule:'))).toBe(true);
    expect(result.trace.some(l => l.includes('[CB] Raw rate='))).toBe(true);
  });

  it('never returns negative rate', () => {
    const result = computeTaylorRule(makeTaylorInput({
      currentInflationRate: -0.1,
      outputGapEstimate: -0.5,
    }));
    expect(result.targetRate).toBeGreaterThanOrEqual(0.001);
  });
});

describe('Smoothing Window (D-13)', () => {
  it('uses 2-iteration window by default', () => {
    // DEFAULT_ECONOMY_CONFIG.inflationSmoothingWindow should be 2
    expect(DEFAULT_ECONOMY_CONFIG.inflationSmoothingWindow).toBe(2);
  });

  it('averages last 2 CPI values with smoothingWindow=2', () => {
    // With history [90, 95, 100, 110, 121] and window=2, only last 2 used: [110, 121]
    const result = computeInflation(makeInput({
      recentCpiHistory: [90, 95, 100, 110, 121],
      economyConfig: makeConfig({ inflationSmoothingWindow: 2 }),
    }));
    // From window [110, 121]: rate = ((121/110)-1)*100 = 10.0
    expect(result.inflationExpectations).toBeCloseTo(10, 0);
  });
});
