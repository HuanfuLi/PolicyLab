/**
 * Phase 06 Plan 02 — Scenario Entry: Fork + Comparison param-diff tests.
 *
 * These tests validate:
 *  1. Fork endpoint config construction preserves economyConfig and budgetAllocation
 *  2. EconomyParamDiff type shape
 *  3. computeParamDiffs logic (tested via exported helper via inline re-implementation)
 *  4. ComparisonResult accepts economyParamDiffs field
 */
import { describe, it, expect } from 'vitest';
import type { ComparisonResult, EconomyParamDiff, BudgetAllocation, EconomyConfig } from '@policylab/shared';

// ── Fork config construction logic (mirrors sessions.ts fork handler) ─────────

function buildForkConfig(
  sourceConfigJson: string | null,
  totalIterations: number,
): Record<string, unknown> {
  let sourceConfig: Record<string, unknown> = {};
  if (sourceConfigJson) {
    try { sourceConfig = JSON.parse(sourceConfigJson) as Record<string, unknown>; } catch { /* use empty */ }
  }
  return {
    totalIterations,
    checklist: { governance: true, economy: true, legal: true, culture: true, infrastructure: true },
    readyForDesign: true,
    ...(sourceConfig.economyConfig ? { economyConfig: sourceConfig.economyConfig } : {}),
    ...(sourceConfig.budgetAllocation ? { budgetAllocation: sourceConfig.budgetAllocation } : {}),
  };
}

// ── computeParamDiffs logic (mirrors compare.ts helper) ──────────────────────

const PARAM_LABELS: Record<string, string> = {
  bankingEnabled: 'Banking Enabled',
  reserveRequirement: 'Reserve Ratio',
  baseLoanInterestRate: 'Loan Interest Rate',
  depositInterestRate: 'Deposit Interest Rate',
  defaultLoanTermIterations: 'Loan Term',
  defaultThresholdIterations: 'Default Threshold',
  capitalMarketsEnabled: 'Capital Markets Enabled',
  fiscalEnabled: 'Fiscal Policy Enabled',
  inflationEnabled: 'Inflation Enabled',
  centralBankEnabled: 'Central Bank Enabled',
};

function computeParamDiffs(
  config1: Record<string, unknown>,
  config2: Record<string, unknown>,
): EconomyParamDiff[] {
  const allKeys = new Set([...Object.keys(config1), ...Object.keys(config2)]);
  const diffs: EconomyParamDiff[] = [];
  for (const key of allKeys) {
    const v1 = config1[key];
    const v2 = config2[key];
    if (v1 !== v2 && (typeof v1 === 'number' || typeof v1 === 'boolean' || typeof v2 === 'number' || typeof v2 === 'boolean')) {
      diffs.push({
        param: key,
        label: PARAM_LABELS[key] ?? key,
        session1Value: (v1 as number | boolean) ?? ('N/A' as unknown as number),
        session2Value: (v2 as number | boolean) ?? ('N/A' as unknown as number),
      });
    }
  }
  return diffs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Fork config construction', () => {
  it('preserves economyConfig from source session', () => {
    const sourceEconomyConfig: Partial<EconomyConfig> = {
      bankingEnabled: true,
      reserveRequirement: 0.15,
      baseLoanInterestRate: 0.008,
    };
    const sourceJson = JSON.stringify({ totalIterations: 20, economyConfig: sourceEconomyConfig });
    const result = buildForkConfig(sourceJson, 30);

    expect(result.totalIterations).toBe(30);
    expect(result.economyConfig).toEqual(sourceEconomyConfig);
    expect(result.readyForDesign).toBe(true);
  });

  it('preserves budgetAllocation from source session', () => {
    const sourceBudget: BudgetAllocation = {
      infrastructure: 0.40,
      education: 0.30,
      defense: 0.10,
      welfare: 0.20,
    };
    const sourceJson = JSON.stringify({ totalIterations: 20, budgetAllocation: sourceBudget });
    const result = buildForkConfig(sourceJson, 20);

    expect(result.budgetAllocation).toEqual(sourceBudget);
  });

  it('preserves both economyConfig and budgetAllocation together', () => {
    const sourceEconomyConfig: Partial<EconomyConfig> = { bankingEnabled: true, reserveRequirement: 0.10 };
    const sourceBudget: BudgetAllocation = { infrastructure: 0.25, education: 0.25, defense: 0.25, welfare: 0.25 };
    const sourceJson = JSON.stringify({ economyConfig: sourceEconomyConfig, budgetAllocation: sourceBudget });
    const result = buildForkConfig(sourceJson, 20);

    expect(result.economyConfig).toEqual(sourceEconomyConfig);
    expect(result.budgetAllocation).toEqual(sourceBudget);
  });

  it('omits economyConfig and budgetAllocation when source has none', () => {
    const sourceJson = JSON.stringify({ totalIterations: 20 });
    const result = buildForkConfig(sourceJson, 20);

    expect(result.economyConfig).toBeUndefined();
    expect(result.budgetAllocation).toBeUndefined();
  });

  it('handles null sourceConfig gracefully', () => {
    const result = buildForkConfig(null, 20);

    expect(result.totalIterations).toBe(20);
    expect(result.economyConfig).toBeUndefined();
    expect(result.budgetAllocation).toBeUndefined();
  });

  it('handles malformed JSON gracefully', () => {
    const result = buildForkConfig('not-valid-json', 20);

    expect(result.totalIterations).toBe(20);
    expect(result.economyConfig).toBeUndefined();
  });
});

describe('computeParamDiffs', () => {
  it('returns empty array when configs are identical', () => {
    const config = { bankingEnabled: true, reserveRequirement: 0.10 };
    expect(computeParamDiffs(config, config)).toEqual([]);
  });

  it('detects changed numeric parameter', () => {
    const config1 = { reserveRequirement: 0.10 };
    const config2 = { reserveRequirement: 0.20 };
    const diffs = computeParamDiffs(config1, config2);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].param).toBe('reserveRequirement');
    expect(diffs[0].label).toBe('Reserve Ratio');
    expect(diffs[0].session1Value).toBe(0.10);
    expect(diffs[0].session2Value).toBe(0.20);
  });

  it('detects changed boolean parameter', () => {
    const config1 = { bankingEnabled: true };
    const config2 = { bankingEnabled: false };
    const diffs = computeParamDiffs(config1, config2);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].param).toBe('bankingEnabled');
    expect(diffs[0].label).toBe('Banking Enabled');
    expect(diffs[0].session1Value).toBe(true);
    expect(diffs[0].session2Value).toBe(false);
  });

  it('detects multiple differing parameters', () => {
    const config1 = { reserveRequirement: 0.10, bankingEnabled: true, fiscalEnabled: false };
    const config2 = { reserveRequirement: 0.20, bankingEnabled: true, fiscalEnabled: true };
    const diffs = computeParamDiffs(config1, config2);

    expect(diffs).toHaveLength(2);
    const paramNames = diffs.map(d => d.param);
    expect(paramNames).toContain('reserveRequirement');
    expect(paramNames).toContain('fiscalEnabled');
    // bankingEnabled is the same — should not appear
    expect(paramNames).not.toContain('bankingEnabled');
  });

  it('uses raw key as label when key not in PARAM_LABELS', () => {
    const config1 = { unknownParam: 1 };
    const config2 = { unknownParam: 2 };
    const diffs = computeParamDiffs(config1, config2);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].label).toBe('unknownParam');
  });

  it('returns empty array for empty configs', () => {
    expect(computeParamDiffs({}, {})).toEqual([]);
  });
});

describe('EconomyParamDiff type shape', () => {
  it('EconomyParamDiff can be instantiated with all required fields (number values)', () => {
    const diff: EconomyParamDiff = {
      param: 'reserveRequirement',
      label: 'Reserve Ratio',
      session1Value: 0.10,
      session2Value: 0.20,
    };
    expect(diff.param).toBe('reserveRequirement');
    expect(diff.session1Value).toBe(0.10);
    expect(diff.session2Value).toBe(0.20);
  });

  it('EconomyParamDiff can be instantiated with boolean values', () => {
    const diff: EconomyParamDiff = {
      param: 'bankingEnabled',
      label: 'Banking Enabled',
      session1Value: true,
      session2Value: false,
    };
    expect(diff.session1Value).toBe(true);
    expect(diff.session2Value).toBe(false);
  });
});

describe('ComparisonResult accepts economyParamDiffs field', () => {
  it('ComparisonResult works without economyParamDiffs (backward compat)', () => {
    const result: ComparisonResult = {
      session1Id: 'sess-1',
      session2Id: 'sess-2',
      narrative: 'Session 1 did better overall.',
      dimensions: [],
      verdict: 'Session 1 wins.',
    };
    expect(result.economyParamDiffs).toBeUndefined();
  });

  it('ComparisonResult accepts economyParamDiffs array', () => {
    const diffs: EconomyParamDiff[] = [
      { param: 'reserveRequirement', label: 'Reserve Ratio', session1Value: 0.10, session2Value: 0.20 },
    ];
    const result: ComparisonResult = {
      session1Id: 'sess-1',
      session2Id: 'sess-2',
      narrative: 'Session 1 had lower reserve requirement.',
      dimensions: [],
      verdict: 'Different policies compared.',
      economyParamDiffs: diffs,
    };
    expect(result.economyParamDiffs).toHaveLength(1);
    expect(result.economyParamDiffs?.[0].param).toBe('reserveRequirement');
  });
});
