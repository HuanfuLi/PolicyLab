import { describe, it, expect } from 'vitest';
import type { LocationProfile } from '@policylab/shared';

// Reuse mock profile builder from dataBootstrapPipeline tests
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
        agriculture: { value: 30, source: 'api', confidence: 'medium', year: 2022 },
        industry: { value: 30, source: 'api', confidence: 'medium', year: 2022 },
        services: { value: 40, source: 'api', confidence: 'medium', year: 2022 },
      },
    },
    economics: {
      gdpPerCapita: { value: 8920, source: 'api', confidence: 'high', year: 2023 },
      gdpGrowth: { value: 2.9, source: 'api', confidence: 'high', year: 2023 },
      giniIndex: { value: 48.9, source: 'api', confidence: 'medium', year: 2021 },
      inflationRate: { value: 4.6, source: 'api', confidence: 'high', year: 2023 },
      realInterestRate: { value: 6.0, source: 'api', confidence: 'high', year: 2023 },
      enterpriseDensity: { value: 5.2, source: 'api', confidence: 'medium', year: 2022 },
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

describe('generateEnterprises', () => {
  it('creates enterprises for each sector present in agent roster', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    expect(enterprises.length).toBeGreaterThanOrEqual(3);
    // Should have enterprises in multiple sectors
    const sectors = new Set(enterprises.map(e => e.sector));
    expect(sectors.size).toBeGreaterThanOrEqual(2);
  });

  it('prefers elite/specialist agents as owners when available', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const { getRoleTier } = await import('../../mechanics/actionCodes.js');
    const profile = makeMockProfile();
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    // In sectors that have elite/specialist agents, owners should be elite/specialist
    // Industry has 'engineer' and 'foreman' (specialist via ENGINEER match)
    // Services has 'merchant' (specialist via MERCHANT match)
    const industryEnts = enterprises.filter(e => e.sector === 'industry');
    for (const ent of industryEnts) {
      const owner = agents.find(a => a.name === ent.ownerId);
      if (owner) {
        const tier = getRoleTier(owner.role);
        // Industry sector has engineers (specialist) -- prefer them
        expect(['elite', 'specialist']).toContain(tier);
      }
    }
  });

  it('sets enterprise capital proportional to GDP per capita', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    const expectedCapital = 8920 * 0.3; // GDP per capita * 0.3
    for (const ent of enterprises) {
      expect(ent.initialCapital).toBeCloseTo(expectedCapital, 0);
    }
  });

  it('maps agriculture to food, industry to tools, services to luxury_goods', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    const agriEnterprises = enterprises.filter(e => e.sector === 'agriculture');
    const industryEnterprises = enterprises.filter(e => e.sector === 'industry');
    const serviceEnterprises = enterprises.filter(e => e.sector === 'services');

    for (const e of agriEnterprises) expect(e.commodityOutput).toBe('food');
    for (const e of industryEnterprises) expect(e.commodityOutput).toBe('tools');
    for (const e of serviceEnterprises) expect(e.commodityOutput).toBe('luxury_goods');
  });

  it('falls back to ceil(sectorAgents.length / 5) when no WB enterprise density data', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    delete (profile.economics as any).enterpriseDensity;
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, null, 100, 5);

    // With null profile, should use fallback heuristic
    expect(enterprises.length).toBeGreaterThanOrEqual(3);
  });

  it('sets government enterprises as service enterprises with commodityOutput none', async () => {
    const { generateEnterprises } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    // Create agents with government roles
    const agents = [
      { name: 'Gov1', role: 'teacher', background: '', initialWealth: 100, sector: 'government' as const },
      { name: 'Gov2', role: 'healthcare_worker', background: '', initialWealth: 100, sector: 'government' as const },
      { name: 'W1', role: 'farmer', background: '', initialWealth: 50, sector: 'agriculture' as const },
      { name: 'W2', role: 'farmer', background: '', initialWealth: 50, sector: 'agriculture' as const },
    ];
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    const govEnts = enterprises.filter(e => e.sector === 'government');
    for (const e of govEnts) {
      expect(e.isServiceEnterprise).toBe(true);
      expect(e.commodityOutput).toBe('none');
    }
  });

  it('generates enterprises with valid EnterpriseBlueprint shape', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    for (const ent of enterprises) {
      expect(ent.id).toBeDefined();
      expect(ent.name).toBeDefined();
      expect(ent.ownerId).toBeDefined();
      expect(ent.sector).toBeDefined();
      expect(ent.commodityOutput).toBeDefined();
      expect(typeof ent.initialCapital).toBe('number');
      expect(Array.isArray(ent.employees)).toBe(true);
      expect(typeof ent.wage).toBe('number');
      expect(typeof ent.isServiceEnterprise).toBe('boolean');
    }
  });

  it('sets wage to at least minimumWage or baseFiat * 0.05', async () => {
    const { generateEnterprises, generateAgentRoster } = await import('../dataBootstrapPipeline.js');
    const profile = makeMockProfile();
    const agents = generateAgentRoster(profile, 10, 100);
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    for (const ent of enterprises) {
      expect(ent.wage).toBeGreaterThanOrEqual(5); // max(minimumWage=5, baseFiat*0.05=5)
    }
  });
});
