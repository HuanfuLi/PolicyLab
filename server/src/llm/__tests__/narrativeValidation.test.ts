import { describe, it, expect } from 'vitest';
import { validateNarrative, buildTelemetryDigest } from '../narrativeValidation.js';
import type { TelemetryLog } from '@policylab/shared';

// Helper to create minimal TelemetryLog
function makeTelemetry(overrides: Partial<TelemetryLog> = {}): TelemetryLog {
  return {
    iterationNumber: 1,
    totalFiatSupply: 10000,
    ammFoodReserve_Y: 100,
    ammFiatReserve_X: 500,
    ammSpotPrice_Food: 5,
    totalCaloriesBurned: 200,
    totalCaloriesProduced: 250,
    actionFailureRate: 0.1,
    giniCoefficient: 0.35,
    cpi: 100,
    inflationRate: 0,
    ...overrides,
  } as TelemetryLog;
}

describe('buildTelemetryDigest', () => {
  it('returns first-iteration message when no previous', () => {
    const current = makeTelemetry();
    const result = buildTelemetryDigest(current, null, [], 20, 0);
    expect(result).toContain('First iteration');
  });

  it('includes Gini, avg wealth, CPI, food price, mood percentages', () => {
    const prev = makeTelemetry({ giniCoefficient: 0.35 });
    const current = makeTelemetry({ giniCoefficient: 0.34, cpi: 102, ammSpotPrice_Food: 4.88 });
    const agents = [
      { health: 80, happiness: 60, cortisol: 20, wealth: 500 },
      { health: 40, happiness: 30, cortisol: 80, wealth: 300 },
    ];
    const result = buildTelemetryDigest(current, prev, agents, 2, 0);
    expect(result).toContain('TELEMETRY DIGEST');
    expect(result).toContain('Gini');
    expect(result).toContain('Avg wealth');
    expect(result).toContain('CPI');
    expect(result).toContain('Food price');
    expect(result).toContain('NARRATIVE RULE');
    expect(result).toContain('satisfied');
    expect(result).toContain('distress');
  });

  it('shows "improving" trend when Gini decreases by >0.01', () => {
    const prev = makeTelemetry({ giniCoefficient: 0.40 });
    const current = makeTelemetry({ giniCoefficient: 0.38 });
    const result = buildTelemetryDigest(current, prev, [], 2, 0);
    expect(result).toContain('improving');
  });

  it('shows "declining" trend when Gini increases by >0.01', () => {
    const prev = makeTelemetry({ giniCoefficient: 0.35 });
    const current = makeTelemetry({ giniCoefficient: 0.37 });
    const result = buildTelemetryDigest(current, prev, [], 2, 0);
    expect(result).toContain('declining');
  });
});

describe('validateNarrative (D-20)', () => {
  it('passes when narrative matches telemetry', () => {
    const current = makeTelemetry({ giniCoefficient: 0.35 });
    const prev = makeTelemetry({ giniCoefficient: 0.35 });
    const result = validateNarrative('The society remained stable this iteration.', current, prev, 20, 0);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('fails deathCountAccurate when narrative mentions starvation but 0 deaths', () => {
    const current = makeTelemetry();
    const result = validateNarrative('Many citizens starved in the streets as famine gripped the nation.', current, null, 20, 0);
    expect(result.deathCountAccurate).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('fails wealthTrendMatch when narrative says collapse but wealth rose', () => {
    const prev = makeTelemetry({ totalFiatSupply: 10000 });
    const current = makeTelemetry({ totalFiatSupply: 12000 });
    const result = validateNarrative('Wealth collapsed as the economy crumbled.', current, prev, 20, 0);
    expect(result.wealthTrendMatch).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails giniDirectionMatch when narrative says equality but Gini increased by >0.02', () => {
    const prev = makeTelemetry({ giniCoefficient: 0.30 });
    const current = makeTelemetry({ giniCoefficient: 0.35 });
    const result = validateNarrative('The gap narrowed as resources were shared more equitably.', current, prev, 20, 0);
    expect(result.giniDirectionMatch).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('returns all failures in failures array', () => {
    const prev = makeTelemetry({ totalFiatSupply: 10000, giniCoefficient: 0.30 });
    const current = makeTelemetry({ totalFiatSupply: 12000, giniCoefficient: 0.35 });
    const result = validateNarrative(
      'Wealth collapsed and the gap narrowed as citizens starved.',
      current, prev, 20, 0,
    );
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(2);
  });
});
