import { describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY_CONFIG, type EconomyConfig } from '@policylab/shared';
import { computeInflation, type InflationInput } from '../inflationEngine.js';

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
