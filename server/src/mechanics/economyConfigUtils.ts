import type { EconomyConfig } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

export function getEconomyConfig(
  sessionConfig: Record<string, unknown> | null | undefined,
): EconomyConfig {
  if (!sessionConfig?.economyConfig) {
    return { ...DEFAULT_ECONOMY_CONFIG, bankingEnabled: false };
  }
  const merged = {
    ...DEFAULT_ECONOMY_CONFIG,
    ...(sessionConfig.economyConfig as Partial<EconomyConfig>),
  };

  // Validate critical numeric fields — replace NaN/Infinity/negative with defaults
  const numericValidations: Array<{ key: keyof EconomyConfig; min?: number; max?: number }> = [
    // R3 fix: Minimum 0.03 prevents unlimited lending at reserveRequirement=0
    { key: 'reserveRequirement', min: 0.03, max: 1 },
    { key: 'baseLoanInterestRate', min: 0 },
    { key: 'depositInterestRate', min: 0 },
    { key: 'defaultLoanTermIterations', min: 1 },
    { key: 'defaultThresholdIterations', min: 1 },
    { key: 'budgetSpendingRate', min: 0, max: 1 },
    { key: 'inflationAmmThreshold', min: 0 },
    { key: 'inflationAmmCap', min: 0 },
    { key: 'govBondCouponRate', min: 0 },
    { key: 'dividendPayoutRatio', min: 0, max: 1 },
  ];

  for (const { key, min, max } of numericValidations) {
    const val = merged[key] as number;
    if (!Number.isFinite(val) || (min !== undefined && val < min) || (max !== undefined && val > max)) {
      (merged as Record<string, unknown>)[key] = DEFAULT_ECONOMY_CONFIG[key];
    }
  }

  return merged;
}
