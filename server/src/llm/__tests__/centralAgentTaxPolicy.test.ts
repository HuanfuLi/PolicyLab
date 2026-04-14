import { describe, it, expect } from 'vitest';
import { validateTaxPolicy } from '../../mechanics/economyConfigUtils.js';
import { profileToEconomyConfig } from '../../data/dataBootstrapPipeline.js';
import { buildLawMessages } from '../prompts/central-agent.js';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';
import type { LocationProfile, TaxPolicy } from '@policylab/shared';

// Phase 11 D-13 — Central Agent selects tax shape (flat | progressive) at
// bootstrap / society generation. Persisted into EconomyConfig.taxPolicy.
// Fixed menu — flat or progressive only. Runtime amendment deferred.

// Minimal LocationProfile fixture builder — only fields profileToEconomyConfig reads.
function makeProfile(overrides: {
  gdpPerCapita?: number;
  govExpensePctGdp?: number;
  lendingInterestRate?: number;
  inflationRate?: number;
  gdpGrowth?: number;
  stockMarketCap?: number;
  govDebtPctGdp?: number;
  depositInterestRate?: number;
} = {}): LocationProfile {
  const dp = (value: number) => ({
    value,
    year: 2024,
    source: 'api' as const,
    confidence: 'high' as const,
  });
  return {
    countryCode: 'TT',
    countryName: 'Testland',
    locationName: 'Testville',
    coordinates: { lat: 0, lon: 0 },
    demographics: {
      sectorEmployment: {
        agriculture: dp(10),
        industry: dp(25),
        services: dp(65),
      },
    },
    economics: {
      gdpPerCapita: dp(overrides.gdpPerCapita ?? 10000),
      ...(overrides.gdpGrowth != null ? { gdpGrowth: dp(overrides.gdpGrowth) } : {}),
      ...(overrides.lendingInterestRate != null
        ? { lendingInterestRate: dp(overrides.lendingInterestRate) }
        : {}),
      ...(overrides.depositInterestRate != null
        ? { depositInterestRate: dp(overrides.depositInterestRate) }
        : {}),
      ...(overrides.inflationRate != null ? { inflationRate: dp(overrides.inflationRate) } : {}),
      ...(overrides.stockMarketCap != null ? { stockMarketCap: dp(overrides.stockMarketCap) } : {}),
    },
    fiscal: {
      ...(overrides.govExpensePctGdp != null
        ? { govExpensePctGdp: dp(overrides.govExpensePctGdp) }
        : {}),
      ...(overrides.govDebtPctGdp != null ? { govDebtPctGdp: dp(overrides.govDebtPctGdp) } : {}),
    },
    fetchedAt: new Date().toISOString(),
  } as unknown as LocationProfile;
}

describe('validateTaxPolicy (Phase 11 D-13)', () => {
  it('returns valid flat policy unchanged', () => {
    const input: TaxPolicy = {
      kind: 'flat',
      rates: { income: 0.15, vat: 0.1, capitalGains: 0.15 },
    };
    const result = validateTaxPolicy(input);
    expect(result.kind).toBe('flat');
    expect(result.rates.income).toBe(0.15);
    expect(result.rates.vat).toBe(0.1);
    expect(result.rates.capitalGains).toBe(0.15);
  });

  it('clamps income rate above 0.5 down to 0.5', () => {
    const result = validateTaxPolicy({
      kind: 'flat',
      rates: { income: 0.7, vat: 0.1, capitalGains: 0.15 },
    });
    expect(result.rates.income).toBe(0.5);
  });

  it('clamps negative income rate up to 0', () => {
    const result = validateTaxPolicy({
      kind: 'flat',
      rates: { income: -0.1, vat: 0.1, capitalGains: 0.15 },
    });
    expect(result.rates.income).toBe(0);
  });

  it('falls back to flat 15/10/15 for invalid kind', () => {
    const result = validateTaxPolicy({ kind: 'weird' });
    expect(result.kind).toBe('flat');
    expect(result.rates.income).toBe(0.15);
    expect(result.rates.vat).toBe(0.1);
    expect(result.rates.capitalGains).toBe(0.15);
    expect(result.brackets).toBeUndefined();
  });

  it('coerces progressive with empty brackets to flat (keeping rates)', () => {
    const result = validateTaxPolicy({
      kind: 'progressive',
      rates: { income: 0.3, vat: 0.1, capitalGains: 0.15 },
      brackets: [],
    });
    expect(result.kind).toBe('flat');
    // Empty brackets → invalid progressive → default flat 15/10/15 fallback
    expect(result.rates.income).toBe(0.15);
    expect(result.rates.vat).toBe(0.1);
    expect(result.rates.capitalGains).toBe(0.15);
  });

  it('coerces progressive with non-increasing upto to flat (keeping rates)', () => {
    const result = validateTaxPolicy({
      kind: 'progressive',
      rates: { income: 0.3, vat: 0.1, capitalGains: 0.15 },
      brackets: [
        { upto: 200, rate: 0.2 },
        { upto: 100, rate: 0.1 },
      ],
    });
    expect(result.kind).toBe('flat');
    // Malformed brackets → coerce to flat but keep validated rates
    expect(result.rates.income).toBe(0.3);
    expect(result.rates.vat).toBe(0.1);
    expect(result.rates.capitalGains).toBe(0.15);
  });

  it('returns default flat for null input', () => {
    const result = validateTaxPolicy(null);
    expect(result.kind).toBe('flat');
    expect(result.rates.income).toBe(0.15);
    expect(result.rates.vat).toBe(0.1);
    expect(result.rates.capitalGains).toBe(0.15);
  });

  it('returns default flat for undefined input', () => {
    const result = validateTaxPolicy(undefined);
    expect(result.kind).toBe('flat');
    expect(result.rates.income).toBe(0.15);
  });

  it('accepts valid progressive with strictly increasing brackets', () => {
    const result = validateTaxPolicy({
      kind: 'progressive',
      rates: { income: 0.25, vat: 0.1, capitalGains: 0.2 },
      brackets: [
        { upto: 500, rate: 0.1 },
        { upto: 2000, rate: 0.2 },
        { upto: 10000, rate: 0.25 },
      ],
    });
    expect(result.kind).toBe('progressive');
    expect(result.brackets).toHaveLength(3);
    expect(result.brackets![0].upto).toBe(500);
    expect(result.brackets![2].rate).toBe(0.25);
  });

  it('clamps bracket rates above 0.5', () => {
    const result = validateTaxPolicy({
      kind: 'progressive',
      rates: { income: 0.3, vat: 0.1, capitalGains: 0.15 },
      brackets: [
        { upto: 500, rate: 0.1 },
        { upto: 2000, rate: 0.9 }, // clamp to 0.5
      ],
    });
    expect(result.kind).toBe('progressive');
    expect(result.brackets![1].rate).toBe(0.5);
  });
});

describe('profileToEconomyConfig taxPolicy derivation (Phase 11 D-13)', () => {
  it('emits progressive taxPolicy for high-GDP + high-gov-expense countries', () => {
    const profile = makeProfile({
      gdpPerCapita: 30000,
      govExpensePctGdp: 35,
      lendingInterestRate: 6,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('progressive');
    expect(config.taxPolicy!.brackets).toBeDefined();
    expect(config.taxPolicy!.brackets!.length).toBe(3);
    // Strictly increasing upto
    const ups = config.taxPolicy!.brackets!.map(b => b.upto);
    expect(ups[0]).toBeLessThan(ups[1]);
    expect(ups[1]).toBeLessThan(ups[2]);
  });

  it('emits flat taxPolicy for low-GDP + low-gov-expense countries', () => {
    const profile = makeProfile({
      gdpPerCapita: 5000,
      govExpensePctGdp: 15,
      lendingInterestRate: 10,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('flat');
    expect(config.taxPolicy!.brackets).toBeUndefined();
  });

  it('tracks taxPolicy source as api and confidence as medium', () => {
    const profile = makeProfile({
      gdpPerCapita: 30000,
      govExpensePctGdp: 35,
      lendingInterestRate: 6,
    });
    const { confidence, sources } = profileToEconomyConfig(profile);
    expect(sources['taxPolicy']).toBe('api');
    expect(confidence['taxPolicy']).toBe('medium');
  });

  it('emits progressive via taxRevenuePct > 15 composite gate (low govExpense, high revenue)', () => {
    // Phase 11 GC3: explicitly exercise the taxRevenuePct > 15 composite arm.
    // govExpensePctGdp=10 would fail the old 30% gate AND the new 18% single threshold,
    // but taxRevenuePctGdp=20 > 15 triggers isWelfareState=true → progressive.
    const profile = makeProfile({
      gdpPerCapita: 40000,
      govExpensePctGdp: 10,
      lendingInterestRate: 4.0,
    } as Parameters<typeof makeProfile>[0] & { taxRevenuePctGdp?: number });
    // Build a profile with taxRevenuePctGdp manually since makeProfile doesn't have that field:
    const profileWithRevenue = {
      ...profile,
      fiscal: {
        ...profile.fiscal,
        taxRevenuePctGdp: { value: 20, year: 2023, source: 'api' as const, confidence: 'high' as const },
      },
    };
    const { config } = profileToEconomyConfig(profileWithRevenue as typeof profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('progressive');
    expect(config.taxPolicy!.brackets).toBeDefined();
  });
});

describe('Central Agent design-generation prompt extension (Phase 11 D-13)', () => {
  it('law prompt mentions taxPolicy, kind/rates/brackets, and both flat + progressive examples', () => {
    const messages = buildLawMessages('A peaceful village', 'Overview...', 'Council', 'Mixed');
    const systemText = (messages[0].content as string);
    expect(systemText).toContain('taxPolicy');
    // Both kinds must appear as choices
    expect(systemText).toMatch(/flat/);
    expect(systemText).toMatch(/progressive/);
    // Rate structure must be explained
    expect(systemText).toMatch(/income/);
    expect(systemText).toMatch(/vat/);
    expect(systemText).toMatch(/capitalGains/);
    // Brackets explanation
    expect(systemText).toMatch(/brackets/);
  });

  it('taxPolicy parsing flow: valid LLM output lands in economyConfig.taxPolicy', () => {
    // Simulates the parse path in generateDesign: parsed.taxPolicy → validateTaxPolicy → economyConfig.taxPolicy
    const parsedFromLlm = {
      law: 'Article 1: ...',
      taxPolicy: {
        kind: 'flat',
        rates: { income: 0.2, vat: 0.08, capitalGains: 0.2 },
      },
    };
    const taxPolicy = validateTaxPolicy(parsedFromLlm.taxPolicy);
    expect(taxPolicy.kind).toBe('flat');
    expect(taxPolicy.rates.income).toBe(0.2);
    expect(taxPolicy.rates.vat).toBe(0.08);
    expect(taxPolicy.rates.capitalGains).toBe(0.2);
  });

  it('taxPolicy parsing flow: missing taxPolicy field falls back to DEFAULT_ECONOMY_CONFIG.taxPolicy', () => {
    const parsedFromLlm: Record<string, unknown> = { law: 'Article 1: ...' };
    // Code under test: validateTaxPolicy(parsed.taxPolicy) on undefined → flat defaults
    const taxPolicy = validateTaxPolicy(parsedFromLlm.taxPolicy);
    expect(taxPolicy.kind).toBe('flat');
    expect(taxPolicy.rates.income).toBe(DEFAULT_ECONOMY_CONFIG.taxPolicy!.rates.income);
    expect(taxPolicy.rates.vat).toBe(DEFAULT_ECONOMY_CONFIG.taxPolicy!.rates.vat);
    expect(taxPolicy.rates.capitalGains).toBe(DEFAULT_ECONOMY_CONFIG.taxPolicy!.rates.capitalGains);
  });

  it('taxPolicy parsing flow: malformed kind coerces to flat 15/10/15', () => {
    const parsedFromLlm = {
      law: 'Article 1: ...',
      taxPolicy: { kind: 'wealth', rates: { income: 0.9, vat: -1, capitalGains: 'oops' } },
    };
    const taxPolicy = validateTaxPolicy(parsedFromLlm.taxPolicy);
    expect(taxPolicy.kind).toBe('flat');
    expect(taxPolicy.rates.income).toBe(0.15);
    expect(taxPolicy.rates.vat).toBe(0.10);
    expect(taxPolicy.rates.capitalGains).toBe(0.15);
  });

  it('law prompt JSON schema example includes taxPolicy as a top-level key', () => {
    const messages = buildLawMessages('Peaceful village', 'Overview...', 'Council', 'Mixed');
    const systemText = (messages[0].content as string);
    // The prompt's JSON response schema must list taxPolicy alongside law
    expect(systemText).toMatch(/"taxPolicy"/);
  });
});
