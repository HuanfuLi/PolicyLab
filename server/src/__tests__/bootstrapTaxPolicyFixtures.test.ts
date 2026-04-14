import { describe, it, expect } from 'vitest';
import { profileToEconomyConfig } from '../data/dataBootstrapPipeline.js';
import type { LocationProfile } from '@policylab/shared';

// Phase 11 GC3 — 7-country bootstrap taxPolicy fixture suite.
// Validates that profileToEconomyConfig produces the correct flat/progressive
// taxPolicy for representative countries, and that the bootstrap path always
// tags sources.taxPolicy === 'api' when derived from real WB data.
//
// Country reference table (forensics-G3 §1):
// | Country | gdpPerCapita | govExpensePct | taxRevenuePct | govDebtPct | Expected   |
// |---------|--------------|---------------|---------------|------------|------------|
// | US      | 84534        | 24.9          | 10.97         | 117.97     | progressive|
// | DE      | 52000        | 26            | 11            | 66         | progressive|
// | UK      | 48000        | 39            | 24            | 100        | progressive|
// | JP      | 34000        | 21            | 12            | 260        | progressive|
// | IN      | 2500         | 15            | 12            | 83         | flat       |
// | BR      | 9000         | 22            | 13            | 86         | flat       |
// | NG      | 2100         | 8             | 7             | 46         | flat       |

/** Build a minimal LocationProfile with only the fields profileToEconomyConfig reads. */
function buildProfile(overrides: {
  gdpPerCapita?: number;
  lendingInterestRate?: number;
  depositInterestRate?: number;
  inflationRate?: number;
  gdpGrowth?: number;
  stockMarketCap?: number;
  govExpensePctGdp?: number;
  taxRevenuePctGdp?: number;
  govDebtPctGdp?: number;
  militaryExpPctGdp?: number;
  healthExpPctGdp?: number;
  educationExpPctGdp?: number;
} = {}): LocationProfile {
  const dp = (value: number) => ({
    value,
    year: 2023,
    source: 'api' as const,
    confidence: 'high' as const,
  });

  return {
    countryCode: 'TT',
    countryName: 'Testland',
    locationName: 'Testville',
    coordinates: { lat: 0, lon: 0 },
    fetchedAt: new Date().toISOString(),
    demographics: {
      sectorEmployment: {
        agriculture: dp(10),
        industry: dp(25),
        services: dp(65),
      },
    },
    economics: {
      gdpPerCapita: dp(overrides.gdpPerCapita ?? 10000),
      ...(overrides.lendingInterestRate != null
        ? { lendingInterestRate: dp(overrides.lendingInterestRate) }
        : {}),
      ...(overrides.depositInterestRate != null
        ? { depositInterestRate: dp(overrides.depositInterestRate) }
        : {}),
      ...(overrides.inflationRate != null
        ? { inflationRate: dp(overrides.inflationRate) }
        : {}),
      ...(overrides.gdpGrowth != null
        ? { gdpGrowth: dp(overrides.gdpGrowth) }
        : {}),
      ...(overrides.stockMarketCap != null
        ? { stockMarketCap: dp(overrides.stockMarketCap) }
        : {}),
    },
    fiscal: {
      ...(overrides.govExpensePctGdp != null
        ? { govExpensePctGdp: dp(overrides.govExpensePctGdp) }
        : {}),
      ...(overrides.taxRevenuePctGdp != null
        ? { taxRevenuePctGdp: dp(overrides.taxRevenuePctGdp) }
        : {}),
      ...(overrides.govDebtPctGdp != null
        ? { govDebtPctGdp: dp(overrides.govDebtPctGdp) }
        : {}),
      ...(overrides.militaryExpPctGdp != null
        ? { militaryExpPctGdp: dp(overrides.militaryExpPctGdp) }
        : {}),
      ...(overrides.healthExpPctGdp != null
        ? { healthExpPctGdp: dp(overrides.healthExpPctGdp) }
        : {}),
      ...(overrides.educationExpPctGdp != null
        ? { educationExpPctGdp: dp(overrides.educationExpPctGdp) }
        : {}),
    },
  } as unknown as LocationProfile;
}

describe('profileToEconomyConfig country-fixture suite', () => {
  it('US → progressive taxPolicy (gdpPC=84534, govExpense=24.9, govDebt=117.97)', () => {
    // FAILS with old 30% heuristic: 24.9 ≤ 30 → flat
    // PASSES with new composite: govDebtPct=117.97 > 60 → isWelfareState=true
    const profile = buildProfile({
      gdpPerCapita: 84534,
      lendingInterestRate: 3.25,
      govExpensePctGdp: 24.9,
      taxRevenuePctGdp: 10.97,
      govDebtPctGdp: 117.97,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('progressive');
    expect(config.taxPolicy!.brackets).toBeDefined();
    expect(config.taxPolicy!.brackets!.length).toBe(3);
  });

  it('Germany → progressive taxPolicy (gdpPC=52000, govExpense=26, govDebt=66)', () => {
    // FAILS with old 30% heuristic: 26 ≤ 30 → flat
    // PASSES with new composite: govDebtPct=66 > 60 → isWelfareState=true
    const profile = buildProfile({
      gdpPerCapita: 52000,
      lendingInterestRate: 4.0,
      govExpensePctGdp: 26,
      taxRevenuePctGdp: 11,
      govDebtPctGdp: 66,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('progressive');
    expect(config.taxPolicy!.brackets).toBeDefined();
  });

  it('UK → progressive taxPolicy (gdpPC=48000, govExpense=39, govDebt=100)', () => {
    // Passes today AND after: 39 > 30 AND 39 > 18 → progressive either way
    // Sanity regression guard for the high-expense path
    const profile = buildProfile({
      gdpPerCapita: 48000,
      lendingInterestRate: 5.25,
      govExpensePctGdp: 39,
      taxRevenuePctGdp: 24,
      govDebtPctGdp: 100,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('progressive');
    expect(config.taxPolicy!.brackets).toBeDefined();
  });

  it('Japan → progressive taxPolicy (gdpPC=34000, govExpense=21, govDebt=260)', () => {
    // FAILS with old 30% heuristic: 21 ≤ 30 → flat
    // PASSES with new composite: govDebtPct=260 > 60 → isWelfareState=true
    const profile = buildProfile({
      gdpPerCapita: 34000,
      lendingInterestRate: 1.5,
      govExpensePctGdp: 21,
      taxRevenuePctGdp: 12,
      govDebtPctGdp: 260,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('progressive');
    expect(config.taxPolicy!.brackets).toBeDefined();
  });

  it('India → flat taxPolicy (gdpPC=2500, govExpense=15, govDebt=83)', () => {
    // Passes today AND after: gdpPC=2500 < 25000 → flat (GDP gate excludes)
    // Regression guard for the emerging-market path
    const profile = buildProfile({
      gdpPerCapita: 2500,
      lendingInterestRate: 9.0,
      govExpensePctGdp: 15,
      taxRevenuePctGdp: 12,
      govDebtPctGdp: 83,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('flat');
    expect(config.taxPolicy!.brackets).toBeUndefined();
  });

  it('Brazil → flat taxPolicy (gdpPC=9000, govExpense=22, govDebt=86)', () => {
    // Passes today AND after: gdpPC=9000 < 25000 → flat (GDP gate excludes)
    // Regression guard for the middle-income path
    const profile = buildProfile({
      gdpPerCapita: 9000,
      lendingInterestRate: 10,
      govExpensePctGdp: 22,
      taxRevenuePctGdp: 13,
      govDebtPctGdp: 86,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('flat');
    expect(config.taxPolicy!.brackets).toBeUndefined();
  });

  it('Nigeria → flat taxPolicy (gdpPC=2100, govExpense=8, govDebt=46)', () => {
    // Passes today AND after: gdpPC=2100 < 25000 → flat (GDP gate excludes)
    // Regression guard for the low-income path
    const profile = buildProfile({
      gdpPerCapita: 2100,
      lendingInterestRate: 12,
      govExpensePctGdp: 8,
      taxRevenuePctGdp: 7,
      govDebtPctGdp: 46,
    });
    const { config } = profileToEconomyConfig(profile);
    expect(config.taxPolicy).toBeDefined();
    expect(config.taxPolicy!.kind).toBe('flat');
    expect(config.taxPolicy!.brackets).toBeUndefined();
  });

  it('invariant: locationProfile present → sources.taxPolicy === "api" (bootstrap-source tagging)', () => {
    // Regression guard: any profileToEconomyConfig call always tags taxPolicy as 'api'.
    // When a bootstrap session has locationProfile set, sources.taxPolicy must be 'api'.
    // This is the contract enforced by the route-level assertion added in GC3 Task 2.
    const profile = buildProfile({
      gdpPerCapita: 84534,
      lendingInterestRate: 3.25,
      govExpensePctGdp: 24.9,
      taxRevenuePctGdp: 10.97,
      govDebtPctGdp: 117.97,
    });
    const { sources } = profileToEconomyConfig(profile);
    expect(sources['taxPolicy']).toBe('api');
  });
});
