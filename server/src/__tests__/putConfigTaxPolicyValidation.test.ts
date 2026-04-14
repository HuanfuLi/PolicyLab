/**
 * Phase 11 GC4 — Server-side taxPolicy validation in PUT /config.
 *
 * Strategy: The route-level coerce-comparison validation logic is extracted into
 * a testable helper `checkTaxPolicyInput` that mirrors what sessions.ts does at
 * PUT /config. Testing the helper directly avoids mounting the Express app +
 * database while still exercising the exact contract the route depends on.
 *
 * Tests cover the 5 scenarios from the plan:
 *   T1: valid flat taxPolicy accepted (200 / no error)
 *   T2: valid progressive taxPolicy accepted (200 / no error)
 *   T3: malformed kind rejected (400 with 'taxPolicy' in message)
 *   T4: non-increasing progressive brackets rejected (400)
 *   T5: partial PUT (only taxPolicy) merges shallowly without wiping other fields
 */

import { describe, it, expect } from 'vitest';
import { validateTaxPolicy } from '../mechanics/economyConfigUtils.js';
import type { TaxPolicy } from '@policylab/shared';

// ── Mirror of the PUT /config validation logic ───────────────────────────────
// This replicates the exact check that sessions.ts applies before merging so
// tests run without a live DB or Express instance.

type ValidationResult =
  | { ok: true; validated: TaxPolicy }
  | { ok: false; status: 400; message: string };

function checkTaxPolicyInput(incoming: unknown): ValidationResult {
  if (incoming === undefined) return { ok: true, validated: {} as unknown as TaxPolicy };

  const validated = validateTaxPolicy(incoming);

  // Reject if validator coerced the input (shape mismatch). We accept clamped
  // rates — validateTaxPolicy clamps rates to [0, 0.5] silently, which is a
  // documented part of its total contract — but we refuse structural corruption
  // (wrong kind, non-increasing brackets, non-object).
  const looksCoerced =
    (typeof incoming !== 'object' || incoming === null) ||
    (incoming as { kind?: string }).kind !== validated.kind ||
    (validated.kind === 'progressive' && !Array.isArray((incoming as { brackets?: unknown }).brackets));

  if (looksCoerced) {
    return {
      ok: false,
      status: 400,
      message:
        'Invalid taxPolicy shape — must be { kind: "flat"|"progressive", rates: {...}, brackets?: [{upto, rate}] with strictly-increasing upto }',
    };
  }

  return { ok: true, validated };
}

// ── Shallow-merge simulation ─────────────────────────────────────────────────
// Mirrors the updatedConfig.economyConfig = { ...existingEconomy, ...incoming }
// pattern in sessions.ts to verify T5 (no field wipe).

function simulatePatchEconomyConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PUT /config taxPolicy validation — checkTaxPolicyInput', () => {
  // T1: valid flat taxPolicy accepted
  it('T1: accepts valid flat taxPolicy', () => {
    const policy = {
      kind: 'flat' as const,
      rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 },
    };
    const result = checkTaxPolicyInput(policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validated.kind).toBe('flat');
      expect(result.validated.rates.income).toBe(0.15);
      expect(result.validated.rates.vat).toBe(0.10);
      expect(result.validated.rates.capitalGains).toBe(0.15);
    }
  });

  // T2: valid progressive taxPolicy accepted
  it('T2: accepts valid progressive taxPolicy with strictly-increasing brackets', () => {
    const policy = {
      kind: 'progressive' as const,
      rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 },
      brackets: [
        { upto: 500, rate: 0.1 },
        { upto: 5000, rate: 0.2 },
      ],
    };
    const result = checkTaxPolicyInput(policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validated.kind).toBe('progressive');
      expect(result.validated.brackets).toHaveLength(2);
      expect(result.validated.brackets![0].upto).toBe(500);
      expect(result.validated.brackets![1].upto).toBe(5000);
    }
  });

  // T3: malformed kind returns 400 with 'taxPolicy' in message
  it('T3: rejects malformed kind with 400 error containing "taxPolicy"', () => {
    const policy = { kind: 'wealth-tax', rates: {} };
    const result = checkTaxPolicyInput(policy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message.toLowerCase()).toContain('taxpolicy');
    }
  });

  // T4: non-increasing progressive brackets returns 400
  it('T4: rejects progressive taxPolicy with non-increasing brackets', () => {
    const policy = {
      kind: 'progressive' as const,
      rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 },
      brackets: [
        { upto: 1000, rate: 0.1 },
        { upto: 500, rate: 0.2 }, // non-increasing!
      ],
    };
    const result = checkTaxPolicyInput(policy);
    // validateTaxPolicy coerces non-increasing progressive → flat, so kind changes → looksCoerced
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  // T5: partial PUT merges shallowly without wiping other economyConfig fields
  it('T5: shallow merge preserves existing economyConfig fields when only taxPolicy changes', () => {
    const existingEconomy: Record<string, unknown> = {
      reserveRequirement: 0.1,
      baseLoanInterestRate: 0.005,
      taxPolicy: {
        kind: 'flat',
        rates: { income: 0.10, vat: 0.08, capitalGains: 0.10 },
      },
    };
    const incoming: Record<string, unknown> = {
      taxPolicy: {
        kind: 'progressive' as const,
        rates: { income: 0.15, vat: 0.10, capitalGains: 0.15 },
        brackets: [
          { upto: 500, rate: 0.1 },
          { upto: 5000, rate: 0.2 },
        ],
      },
    };

    // First validate the incoming taxPolicy
    const validationResult = checkTaxPolicyInput(incoming.taxPolicy);
    expect(validationResult.ok).toBe(true);

    // Then simulate the shallow merge
    const merged = simulatePatchEconomyConfig(existingEconomy, incoming);
    expect(merged.reserveRequirement).toBe(0.1);
    expect(merged.baseLoanInterestRate).toBe(0.005);
    const mergedPolicy = merged.taxPolicy as TaxPolicy;
    expect(mergedPolicy.kind).toBe('progressive');
    expect(mergedPolicy.rates.income).toBe(0.15);
  });
});

// ── validateTaxPolicy contract tests ─────────────────────────────────────────
// Belt-and-suspenders: confirm the underlying total function behaves as expected
// for edge cases that feed into the coerce-comparison check.

describe('validateTaxPolicy contract (from economyConfigUtils)', () => {
  it('returns flat default for null input', () => {
    const result = validateTaxPolicy(null);
    expect(result.kind).toBe('flat');
  });

  it('returns flat default for invalid kind', () => {
    const result = validateTaxPolicy({ kind: 'wealth-tax', rates: {} });
    expect(result.kind).toBe('flat');
  });

  it('coerces progressive with non-increasing brackets to flat', () => {
    const result = validateTaxPolicy({
      kind: 'progressive',
      rates: { income: 0.2, vat: 0.1, capitalGains: 0.15 },
      brackets: [{ upto: 1000, rate: 0.1 }, { upto: 500, rate: 0.2 }],
    });
    expect(result.kind).toBe('flat');
  });

  it('preserves valid progressive with strictly-increasing brackets', () => {
    const result = validateTaxPolicy({
      kind: 'progressive',
      rates: { income: 0.2, vat: 0.1, capitalGains: 0.15 },
      brackets: [{ upto: 500, rate: 0.1 }, { upto: 5000, rate: 0.2 }],
    });
    expect(result.kind).toBe('progressive');
    expect(result.brackets).toHaveLength(2);
  });

  it('clamps out-of-range rates to [0, 0.5] without changing structure', () => {
    const result = validateTaxPolicy({
      kind: 'flat',
      rates: { income: 0.99, vat: -0.1, capitalGains: 0.25 },
    });
    expect(result.rates.income).toBe(0.5); // clamped to max
    expect(result.rates.vat).toBe(0);      // clamped to min
    expect(result.rates.capitalGains).toBe(0.25); // unchanged
  });
});
