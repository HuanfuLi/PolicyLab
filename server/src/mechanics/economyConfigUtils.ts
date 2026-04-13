import type { EconomyConfig, TaxPolicy } from '@policylab/shared';
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

// ── Phase 11 D-13: Tax Policy validation ────────────────────────────────────
// Validates and normalises a TaxPolicy shape (from LLM output OR bootstrap
// derivation) into a guaranteed-valid instance. Any malformed input is
// coerced into the flat 15%/10%/15% baseline so downstream callers
// (computeWithholding, fiscalEngine) never crash on bad data.

/** Default flat baseline — returned when input is malformed or missing. */
const DEFAULT_TAX_POLICY: TaxPolicy = {
  kind: 'flat',
  rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 },
};

/** Clamp a raw numeric rate into [0, 0.5]; non-numeric falls back to 0. */
function clampRate(r: unknown): number {
  const n = typeof r === 'number' && Number.isFinite(r) ? r : 0;
  return Math.max(0, Math.min(0.5, n));
}

/**
 * Validate + normalise a TaxPolicy. Always returns a valid TaxPolicy.
 * Rules:
 * - null / undefined / non-object → flat 15/10/15 (DEFAULT_TAX_POLICY)
 * - kind not 'flat' or 'progressive' → DEFAULT_TAX_POLICY
 * - rates clamped per-field to [0, 0.5] (non-numeric → 0)
 * - progressive without brackets, empty brackets, or non-strictly-increasing
 *   upto → coerce kind to 'flat' (keep validated rates)
 * - progressive bracket rates clamped per-field to [0, 0.5]
 *
 * @see Phase 11 D-13
 */
export function validateTaxPolicy(input: unknown): TaxPolicy {
  if (!input || typeof input !== 'object') return { ...DEFAULT_TAX_POLICY };
  const raw = input as Partial<TaxPolicy>;
  if (raw.kind !== 'flat' && raw.kind !== 'progressive') return { ...DEFAULT_TAX_POLICY };

  const rawRates = (raw.rates ?? {}) as Record<string, unknown>;
  const rates = {
    income: clampRate(rawRates.income),
    vat: clampRate(rawRates.vat),
    capitalGains: clampRate(rawRates.capitalGains),
  };

  if (raw.kind === 'flat') {
    return { kind: 'flat', rates };
  }

  // Progressive — require non-empty strictly-increasing brackets
  const brackets = Array.isArray(raw.brackets) ? raw.brackets : [];
  if (brackets.length === 0) {
    // Empty brackets → invalid progressive → default baseline
    return { ...DEFAULT_TAX_POLICY };
  }
  let prev = -Infinity;
  for (const b of brackets) {
    if (!b || typeof b !== 'object' || typeof (b as { upto?: unknown }).upto !== 'number' || (b as { upto: number }).upto <= prev) {
      // Malformed / non-increasing → coerce to flat, keep rates
      return { kind: 'flat', rates };
    }
    prev = (b as { upto: number }).upto;
  }
  const cleanBrackets = brackets.map(b => ({
    upto: (b as { upto: number }).upto,
    rate: clampRate((b as { rate?: unknown }).rate),
  }));
  return { kind: 'progressive', rates, brackets: cleanBrackets };
}
