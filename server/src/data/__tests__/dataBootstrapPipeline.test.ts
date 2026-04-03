import { describe, it, expect, vi } from 'vitest';
import type { LocationProfile, BudgetAllocation, ConfidenceLevel } from '@policylab/shared';

// Full mock profile with known values for deterministic assertions
function makeMockProfile(): LocationProfile {
  return {
    locationName: 'Brasilia',
    countryCode: 'BR',
    countryName: 'Brazil',
    coordinates: { lat: -15.78, lon: -47.93 },
    fetchedAt: new Date().toISOString(),
    demographics: {
      population: { value: 214000000, source: 'api', confidence: 'high', year: 2023 },
      urbanPopulationPct: { value: 87.6, source: 'api', confidence: 'high', year: 2023 },
      lifeExpectancy: { value: 75.9, source: 'api', confidence: 'high', year: 2023 },
      ageDepRatio: { value: 43.5, source: 'api', confidence: 'medium', year: 2022 },
      unemploymentRate: { value: 9.3, source: 'api', confidence: 'high', year: 2023 },
      sectorEmployment: {
        agriculture: { value: 9.0, source: 'api', confidence: 'medium', year: 2022 },
        industry: { value: 20.0, source: 'api', confidence: 'medium', year: 2022 },
        services: { value: 71.0, source: 'api', confidence: 'medium', year: 2022 },
      },
    },
    economics: {
      gdpPerCapita: { value: 8920, source: 'api', confidence: 'high', year: 2023 },
      gdpGrowth: { value: 2.9, source: 'api', confidence: 'high', year: 2023 },
      giniIndex: { value: 48.9, source: 'api', confidence: 'medium', year: 2021 },
      inflationRate: { value: 4.6, source: 'api', confidence: 'high', year: 2023 },
      realInterestRate: { value: 6.0, source: 'api', confidence: 'high', year: 2023 },
    },
    fiscal: {
      taxRevenuePctGdp: { value: 14.3, source: 'api', confidence: 'medium', year: 2022 },
      govExpensePctGdp: { value: 19.5, source: 'api', confidence: 'medium', year: 2022 },
      militaryExpPctGdp: { value: 1.3, source: 'api', confidence: 'medium', year: 2022 },
      healthExpPctGdp: { value: 10.3, source: 'api', confidence: 'medium', year: 2022 },
      educationExpPctGdp: { value: 6.3, source: 'api', confidence: 'medium', year: 2022 },
    },
    governance: { value: 'Federal presidential republic', source: 'llm', confidence: 'low' },
    infrastructure: { value: 'Developing infrastructure', source: 'llm', confidence: 'low' },
  };
}

describe('profileToEconomyConfig', () => {
  it('returns all four enabled toggles set to true', async () => {
    const { profileToEconomyConfig } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const result = profileToEconomyConfig(profile);

    expect(result.config.bankingEnabled).toBe(true);
    expect(result.config.capitalMarketsEnabled).toBe(true);
    expect(result.config.fiscalEnabled).toBe(true);
    expect(result.config.inflationEnabled).toBe(true);
  });

  it('converts annual interest rate 6% to per-iteration rate 0.005 (6/100/12)', async () => {
    const { profileToEconomyConfig } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    // realInterestRate = 6.0 => 6/100/12 = 0.005
    const result = profileToEconomyConfig(profile);

    expect(result.config.baseLoanInterestRate).toBeCloseTo(0.005, 4);
  });

  it('maps fiscal spending data to BudgetAllocation fractions summing to 1.0', async () => {
    const { profileToEconomyConfig } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const result = profileToEconomyConfig(profile);

    const budget = result.budget;
    const sum = budget.infrastructure + budget.education + budget.defense + budget.welfare;
    expect(sum).toBeCloseTo(1.0, 4);
    // Each fraction should be > 0
    expect(budget.infrastructure).toBeGreaterThan(0);
    expect(budget.education).toBeGreaterThan(0);
    expect(budget.defense).toBeGreaterThan(0);
    expect(budget.welfare).toBeGreaterThan(0);
  });

  it('returns confidence metadata keyed by parameter name', async () => {
    const { profileToEconomyConfig } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const result = profileToEconomyConfig(profile);

    expect(result.confidence).toBeDefined();
    expect(typeof result.confidence).toBe('object');
    // Should have entries for key mapped parameters
    expect(result.confidence['baseLoanInterestRate']).toBeDefined();
    expect(result.confidence['reserveRequirement']).toBeDefined();
    expect(result.confidence['budgetSpendingRate']).toBeDefined();
  });

  it('falls back to default 0.005 when realInterestRate is missing', async () => {
    const { profileToEconomyConfig } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    delete profile.economics.realInterestRate;
    const result = profileToEconomyConfig(profile);

    expect(result.config.baseLoanInterestRate).toBeCloseTo(0.005, 4);
  });
});

describe('generateAgentRoster', () => {
  it('creates agents proportional to sector employment (30% agri / 40% services / 30% industry -> ~9/12/9 for 30)', async () => {
    const { generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    // Override sector employment to exact values for test
    profile.demographics.sectorEmployment = {
      agriculture: { value: 30, source: 'api', confidence: 'medium', year: 2022 },
      industry: { value: 30, source: 'api', confidence: 'medium', year: 2022 },
      services: { value: 40, source: 'api', confidence: 'medium', year: 2022 },
    };

    const roster = generateAgentRoster(profile, 30, 100);

    const agriCount = roster.filter(a => a.sector === 'agriculture').length;
    const industryCount = roster.filter(a => a.sector === 'industry').length;
    const servicesCount = roster.filter(a => a.sector === 'services').length;

    expect(agriCount).toBe(9);
    expect(industryCount).toBe(9);
    expect(servicesCount).toBe(12);
    expect(roster.length).toBe(30);
  });

  it('distributes wealth using Gini from profile (divides by 100)', async () => {
    const { generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const { computeGini } = await import('../giniDistribution.js');
    const profile = makeMockProfile();
    // giniIndex = 48.9 (World Bank scale)

    const roster = generateAgentRoster(profile, 30, 100);

    const wealthValues = roster.map(a => a.initialWealth);
    const totalWealth = wealthValues.reduce((a, b) => a + b, 0);
    // Total should be agentCount * baseFiat
    expect(totalWealth).toBe(30 * 100);

    // Gini should approximate 0.489 (within tolerance for small sample)
    const actualGini = computeGini(wealthValues);
    expect(actualGini).toBeGreaterThan(0.3);
    expect(actualGini).toBeLessThan(0.7);
  });
});
