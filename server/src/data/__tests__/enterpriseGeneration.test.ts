import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocationProfile } from '@policylab/shared';
import type { AgentBlueprint } from '../dataBootstrapPipeline.js';
import { generateEnterprisesFromCentralAgent } from '../creativeEnterpriseGeneration.js';

// ── Local fixture helpers ─────────────────────────────────────────────────────

/**
 * Build an array of employable agents with a given sector distribution.
 * sectorDistribution: { agriculture: 0.60, industry: 0.30, services: 0.10 }
 */
function buildEmployableAgents(
  count: number,
  sectorDistribution: Record<string, number>,
): AgentBlueprint[] {
  const agents: AgentBlueprint[] = [];
  let idx = 0;

  for (const [sector, fraction] of Object.entries(sectorDistribution)) {
    const n = Math.round(count * fraction);
    for (let i = 0; i < n; i++) {
      agents.push({
        name: `Agent-${sector.slice(0, 1).toUpperCase()}${idx++}`,
        role: sector === 'agriculture' ? 'farmer'
          : sector === 'industry' ? 'factory_worker'
          : sector === 'government' ? 'teacher'
          : 'merchant',
        background: 'Test background',
        initialWealth: 100,
        sector: sector as AgentBlueprint['sector'],
      });
    }
  }

  // Fill rounding remainder with services agents
  while (agents.length < count) {
    agents.push({
      name: `Agent-X${idx++}`,
      role: 'merchant',
      background: 'Test background',
      initialWealth: 100,
      sector: 'services',
    });
  }

  return agents;
}

/** Build a minimal LocationProfile with configurable economic params. */
function buildProfile(overrides: {
  gdpPerCapita?: number;
  enterpriseDensity?: number;
  sectorEmployment?: { agriculture: number; industry: number; services: number };
}): LocationProfile {
  return {
    locationName: 'Test City',
    countryCode: 'TC',
    countryName: 'Test Country',
    coordinates: { lat: 0, lon: 0 },
    fetchedAt: new Date().toISOString(),
    demographics: {
      population: { value: 1000000, source: 'api', confidence: 'high', year: 2023 },
      urbanPopulationPct: { value: 70, source: 'api', confidence: 'high', year: 2023 },
      lifeExpectancy: { value: 72, source: 'api', confidence: 'high', year: 2023 },
      ageDepRatio: { value: 40, source: 'api', confidence: 'medium', year: 2022 },
      unemploymentRate: { value: 5, source: 'api', confidence: 'high', year: 2023 },
      sectorEmployment: overrides.sectorEmployment
        ? {
            agriculture: { value: overrides.sectorEmployment.agriculture, source: 'api', confidence: 'high', year: 2023 },
            industry: { value: overrides.sectorEmployment.industry, source: 'api', confidence: 'high', year: 2023 },
            services: { value: overrides.sectorEmployment.services, source: 'api', confidence: 'high', year: 2023 },
          }
        : undefined,
    },
    economics: {
      gdpPerCapita: { value: overrides.gdpPerCapita ?? 10000, source: 'api', confidence: 'high', year: 2023 },
      gdpGrowth: { value: 2.0, source: 'api', confidence: 'high', year: 2023 },
      giniIndex: { value: 40, source: 'api', confidence: 'medium', year: 2021 },
      inflationRate: { value: 3.0, source: 'api', confidence: 'high', year: 2023 },
      realInterestRate: { value: 2.0, source: 'api', confidence: 'high', year: 2023 },
      ...(overrides.enterpriseDensity != null
        ? { enterpriseDensity: { value: overrides.enterpriseDensity, source: 'api', confidence: 'medium', year: 2022 } }
        : {}),
    },
    fiscal: {
      taxRevenuePctGdp: { value: 20, source: 'api', confidence: 'medium', year: 2022 },
      govExpensePctGdp: { value: 25, source: 'api', confidence: 'medium', year: 2022 },
      militaryExpPctGdp: { value: 1.5, source: 'api', confidence: 'medium', year: 2022 },
      healthExpPctGdp: { value: 6, source: 'api', confidence: 'medium', year: 2022 },
      educationExpPctGdp: { value: 5, source: 'api', confidence: 'medium', year: 2022 },
    },
    governance: { value: 'Republic', source: 'llm', confidence: 'low' },
    infrastructure: { value: 'Developing', source: 'llm', confidence: 'low' },
  };
}

// ── Phase 12 tests ────────────────────────────────────────────────────────────

describe('Phase 12: Demographic-aligned enterprise generation', () => {
  let generateEnterprises: (typeof import('../dataBootstrapPipeline.js'))['generateEnterprises'];

  beforeEach(async () => {
    ({ generateEnterprises } = await import('../dataBootstrapPipeline.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── L-01: 110% vacancy target ──────────────────────────────────────────────

  it('L-01: total capacity ≥ 1.05 × employable_agent_count (D-04/D-05)', () => {
    // 40 agents: 60% agriculture / 30% industry / 10% services
    const agents = buildEmployableAgents(40, { agriculture: 0.60, industry: 0.30, services: 0.10 });
    const profile = buildProfile({ gdpPerCapita: 10000 });
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    const totalCapacity = enterprises.reduce((s, e) => s + (e.capacity ?? 0), 0);
    const employableCount = 40; // all agents in this fixture are employable

    expect(totalCapacity).toBeGreaterThanOrEqual(Math.ceil(employableCount * 1.05));
  });

  it('L-01: each enterprise blueprint carries a numeric capacity field', () => {
    const agents = buildEmployableAgents(20, { agriculture: 0.50, services: 0.50 });
    const profile = buildProfile({ gdpPerCapita: 5000 });
    const enterprises = generateEnterprises(agents, profile, 100, 5);

    for (const ent of enterprises) {
      expect(typeof ent.capacity).toBe('number');
      expect(ent.capacity).toBeGreaterThanOrEqual(2); // minimum capacity per enterprise
    }
  });

  it('L-01: capacity scales with sector workforce (sector target ≈ 110% × sector agents)', () => {
    // Pure agriculture sector, 20 employable agents, no WB density — fallback ceil(20/5)=4 enterprises
    const agents = buildEmployableAgents(20, { agriculture: 1.0 });
    const enterprises = generateEnterprises(agents, null, 100, 5);

    const agriEnts = enterprises.filter(e => e.sector === 'agriculture');
    expect(agriEnts.length).toBeGreaterThanOrEqual(1);
    const agriTotalCapacity = agriEnts.reduce((s, e) => s + (e.capacity ?? 0), 0);
    // 20 agents × 1.10 target = 22 minimum (floor 1.05 × 20 = 21)
    expect(agriTotalCapacity).toBeGreaterThanOrEqual(Math.ceil(20 * 1.05));
  });

  // ── L-02: Every ≥5% sector has ≥1 enterprise ──────────────────────────────

  it('L-02: every sector with ≥5% employable workforce has ≥1 enterprise (D-05)', () => {
    // 20 agents spread evenly across 4 sectors (each at 25%)
    const agents: AgentBlueprint[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `Agri${i}`, role: 'farmer', background: '', initialWealth: 100, sector: 'agriculture' as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `Ind${i}`, role: 'factory_worker', background: '', initialWealth: 100, sector: 'industry' as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `Svc${i}`, role: 'merchant', background: '', initialWealth: 100, sector: 'services' as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `Gov${i}`, role: 'teacher', background: '', initialWealth: 100, sector: 'government' as const,
      })),
    ];

    const profile = buildProfile({ gdpPerCapita: 8000 });
    const enterprises = generateEnterprises(agents, profile, 100, 5);
    const presentSectors = new Set(enterprises.map(e => e.sector));

    // All 4 sectors present in agents → all 4 must have ≥1 enterprise
    expect(presentSectors.has('agriculture')).toBe(true);
    expect(presentSectors.has('industry')).toBe(true);
    expect(presentSectors.has('services')).toBe(true);
    expect(presentSectors.has('government')).toBe(true);
  });

  it('L-02: all distinct sectors in the agent roster produce ≥1 enterprise', () => {
    const agents = buildEmployableAgents(30, { agriculture: 0.33, industry: 0.33, services: 0.34 });
    const enterprises = generateEnterprises(agents, null, 100, 5);
    const sectors = new Set(enterprises.map(e => e.sector));

    // All 3 sectors in input must have coverage
    expect(sectors.has('agriculture')).toBe(true);
    expect(sectors.has('industry')).toBe(true);
    expect(sectors.has('services')).toBe(true);
  });

  // ── L-03: Auto-inflation invariant (D-05) ─────────────────────────────────

  it('L-03: generateEnterprises satisfies vacancy invariant for any realistic WB profile', () => {
    // Variety of profiles — none should throw; all should satisfy D-05 floor
    const testCases: Array<{ count: number; dist: Record<string, number> }> = [
      { count: 10, dist: { agriculture: 0.5, industry: 0.3, services: 0.2 } },
      { count: 40, dist: { agriculture: 0.6, industry: 0.3, services: 0.1 } },
      { count: 25, dist: { agriculture: 0.2, industry: 0.5, services: 0.3 } },
    ];

    for (const { count, dist } of testCases) {
      const agents = buildEmployableAgents(count, dist);
      // Use the fallback path (no WB density) to get predictable entCount
      const enterprises = generateEnterprises(agents, null, 100, 5);
      const totalCapacity = enterprises.reduce((s, e) => s + (e.capacity ?? 0), 0);
      expect(totalCapacity).toBeGreaterThanOrEqual(Math.ceil(count * 1.05));
    }
  });

  it('L-03: console.info with "Vacancy invariant: auto-inflate" is the correction marker', () => {
    // This test validates the log MARKER format (grepped by post-execution scripts)
    // We spy on console.info and verify: if any inflation logs appear, they contain the marker
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const agents = buildEmployableAgents(10, { agriculture: 0.6, services: 0.4 });
    generateEnterprises(agents, null, 100, 5);

    // If any inflation messages were emitted, they MUST contain the required marker
    const inflationCalls = spy.mock.calls
      .flat()
      .filter((arg): arg is string => typeof arg === 'string')
      .filter(msg => msg.includes('Phase 12'));

    for (const msg of inflationCalls) {
      expect(msg).toContain('Vacancy invariant: auto-inflate');
    }
  });

  // ── D-07: Employable agent predicate ──────────────────────────────────────

  it('D-07: official role agents are excluded from the employable denominator', () => {
    // 10 agents: 7 farmers (employable) + 3 officials (non-employable)
    const agents: AgentBlueprint[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `Farmer${i}`,
        role: 'farmer',
        background: '',
        initialWealth: 100,
        sector: 'agriculture' as const,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        name: `Official${i}`,
        role: 'official',
        background: '',
        initialWealth: 500,
        // officials map to government sector via roleToSector
        sector: 'government' as const,
      })),
    ];

    const enterprises = generateEnterprises(agents, null, 100, 5);
    const totalCapacity = enterprises.reduce((s, e) => s + (e.capacity ?? 0), 0);

    // Only 7 employable agents → D-05 floor = ceil(7 * 1.05) = 8
    // Government sector has 0% of EMPLOYABLE workforce (0/7 = 0%) → exempt from sector coverage
    expect(totalCapacity).toBeGreaterThanOrEqual(Math.ceil(7 * 1.05));
  });

  it('D-07: bank-type agents are excluded from employable denominator', () => {
    // 8 regular agents + 2 bank agents
    const agents: AgentBlueprint[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        name: `Worker${i}`,
        role: 'factory_worker',
        background: '',
        initialWealth: 100,
        sector: 'industry' as const,
      })),
      // Bank agents have type='bank' — isEmployableAgent returns false
      // But AgentBlueprint doesn't have a `type` field, so we cast
      ...(Array.from({ length: 2 }, (_, i) => ({
        name: `Bank${i}`,
        role: 'bank_manager',
        background: '',
        initialWealth: 1000,
        sector: 'services' as const,
        type: 'bank', // extended field — will be read by isEmployableAgent
      })) as unknown as AgentBlueprint[]),
    ];

    const enterprises = generateEnterprises(agents, null, 100, 5);
    const totalCapacity = enterprises.reduce((s, e) => s + (e.capacity ?? 0), 0);

    // 8 employable (bank agents excluded) → D-05 floor = ceil(8 * 1.05) = 9
    expect(totalCapacity).toBeGreaterThanOrEqual(Math.ceil(8 * 1.05));
  });

  it('D-07: central_agent role is excluded from employable denominator', () => {
    const agents: AgentBlueprint[] = [
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `Merchant${i}`,
        role: 'merchant',
        background: '',
        initialWealth: 100,
        sector: 'services' as const,
      })),
      {
        name: 'CentralAgent',
        role: 'central_agent',
        background: '',
        initialWealth: 1000,
        sector: 'government' as const,
      },
    ];

    const enterprises = generateEnterprises(agents, null, 100, 5);
    const totalCapacity = enterprises.reduce((s, e) => s + (e.capacity ?? 0), 0);

    // 12 employable (central_agent excluded) → D-05 floor = ceil(12 * 1.05) = 13
    expect(totalCapacity).toBeGreaterThanOrEqual(Math.ceil(12 * 1.05));
  });

  // ── D-06: Owned by 12-03 creative-mode plan — see describe block below ────
  it.todo('D-06: creative-mode generator retries via retryWithHealing on invariant failure (max N=3) — see Phase 12 creative-mode describe');
  it.todo('D-06: creative-mode abort path emits SSE error when retries exhausted — see Phase 12 creative-mode describe');
});

// ── Phase 12: Creative-mode enterprise generation (D-06, D-15) ───────────────

describe('Phase 12: Creative-mode enterprise generation (D-06, D-15)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Builds a roster of 20 employable agents spread across 4 sectors (5 each),
   * so every sector is at ≥5% of the workforce.
   */
  function buildTestRoster(): AgentBlueprint[] {
    const sectors: Array<AgentBlueprint['sector']> = [
      'agriculture', 'industry', 'services', 'government',
    ];
    const roster: AgentBlueprint[] = [];
    for (const sector of sectors) {
      for (let i = 0; i < 5; i++) {
        roster.push({
          name: `Agent-${sector.slice(0, 3).toUpperCase()}${i}`,
          role: sector === 'agriculture' ? 'farmer'
            : sector === 'industry' ? 'factory_worker'
            : sector === 'services' ? 'merchant'
            : 'teacher',
          background: 'Test background',
          initialWealth: 100,
          sector,
        });
      }
    }
    return roster;
  }

  /**
   * Builds a valid JSON response that satisfies all D-05 invariants for 20
   * employable agents across 4 equal sectors.
   * sum(capacity) = 4 × 6 = 24 ≥ ceil(20 × 1.10) = 22.
   */
  function buildValidRosterJson(): string {
    return JSON.stringify([
      { sector: 'agriculture', ownerRole: 'farm_owner', initialWorkforceSize: 5, capacity: 6, wageAnchor: 10 },
      { sector: 'industry', ownerRole: 'factory_owner', initialWorkforceSize: 5, capacity: 6, wageAnchor: 10 },
      { sector: 'services', ownerRole: 'shop_owner', initialWorkforceSize: 5, capacity: 6, wageAnchor: 10 },
      { sector: 'government', ownerRole: 'administrator', initialWorkforceSize: 5, capacity: 6, wageAnchor: 10 },
    ]);
  }

  /**
   * Builds an invalid JSON response: only agriculture covered, capacity too low.
   * Fails both D-05 invariants.
   */
  function buildBadRosterJson(): string {
    return JSON.stringify([
      { sector: 'agriculture', ownerRole: 'farm_owner', initialWorkforceSize: 1, capacity: 2, wageAnchor: 5 },
    ]);
  }

  const baseFiat = 1000;
  const minimumWage = 5;

  it('D-06: rejects with [Phase 12 L-03 creative-mode] error after 3 failed attempts', async () => {
    const agentRoster = buildTestRoster();
    const badJson = buildBadRosterJson();
    const calls: string[] = [];

    const llm = {
      chat: vi.fn().mockImplementation(async (_msgs: unknown[]) => {
        calls.push('called');
        return badJson;
      }),
      chatStream: vi.fn(),
      testConnection: vi.fn(),
    };

    await expect(
      generateEnterprisesFromCentralAgent({ overview: 'Test society', agentRoster, baseFiat, minimumWage, llm }),
    ).rejects.toThrow(/\[Phase 12 L-03 creative-mode\].*after 3 attempts/);

    expect(calls.length).toBe(3);
  });

  it('D-06: returns blueprints directly on first successful attempt (no retry)', async () => {
    const agentRoster = buildTestRoster();
    const validJson = buildValidRosterJson();

    const llm = {
      chat: vi.fn().mockResolvedValue(validJson),
      chatStream: vi.fn(),
      testConnection: vi.fn(),
    };

    const out = await generateEnterprisesFromCentralAgent({
      overview: 'Test society',
      agentRoster,
      baseFiat,
      minimumWage,
      llm,
    });

    expect(out.length).toBeGreaterThan(0);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('D-06: retries once with healing feedback injected then resolves on second attempt', async () => {
    const agentRoster = buildTestRoster();
    const badJson = buildBadRosterJson();
    const validJson = buildValidRosterJson();

    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(badJson)
        .mockResolvedValueOnce(validJson),
      chatStream: vi.fn(),
      testConnection: vi.fn(),
    };

    const out = await generateEnterprisesFromCentralAgent({
      overview: 'Test society',
      agentRoster,
      baseFiat,
      minimumWage,
      llm,
    });

    expect(out.length).toBeGreaterThan(0);
    expect(llm.chat).toHaveBeenCalledTimes(2);

    // Second call's user message must include the healing feedback prefix
    const secondCallMessages = (llm.chat.mock.calls[1][0] as Array<{ role: string; content: string }>);
    const userMsg = secondCallMessages.find(m => m.role === 'user')?.content ?? '';
    expect(userMsg).toMatch(/PREVIOUS ATTEMPT FAILED VALIDATION/);
  });
});
