/**
 * Tax withholding helper — Phase 11 D-12, D-14.
 *
 * Dispatches to flat or progressive rates based on TaxPolicy.kind. Called inline
 * at each tax-bearing event site in simulationRunner (wage settlement, AMM sell,
 * AMM buy VAT, SELL_SHARES capital gains, matured bond payout) so per-action SFC
 * traceability is preserved and M0 stays constant.
 *
 * Kind dispatch:
 *  - 'wage' and 'amm_sell' use rates.income (piecewise-progressive when policy.kind === 'progressive')
 *  - 'vat' uses rates.vat (flat rate always — no brackets)
 *  - 'capital_gains' uses rates.capitalGains (flat rate always — no brackets)
 *
 * Safety: if policy is undefined (legacy session) or income is non-positive, returns 0.
 * Per-rate clamp [0, 0.5] prevents runaway confiscation.
 */
import type { TaxPolicy } from '@policylab/shared';

export type TaxKind = 'wage' | 'amm_sell' | 'vat' | 'capital_gains';

/**
 * Compute tax to withhold from a fiat-bearing event.
 *
 * @param income Gross amount subject to tax (positive fiat). Caller has already
 *               determined the taxable base (e.g. trade proceeds, wage gross).
 * @param kind   Which tax rate applies.
 * @param policy Session's TaxPolicy. If undefined, returns 0 (legacy safety).
 * @returns      Tax amount to withhold. Always >= 0.
 */
export function computeWithholding(
  income: number,
  kind: TaxKind,
  policy: TaxPolicy | undefined,
): number {
  if (!policy || income <= 0) return 0;

  const pickFlatRate = (): number => {
    switch (kind) {
      case 'wage':
      case 'amm_sell':
        return policy.rates.income;
      case 'vat':
        return policy.rates.vat;
      case 'capital_gains':
        return policy.rates.capitalGains;
    }
  };

  if (policy.kind === 'flat') {
    return income * clampRate(pickFlatRate());
  }

  // progressive: VAT and capital gains keep a flat rate; only income-style
  // events (wage, amm_sell) walk the brackets.
  if (kind === 'vat' || kind === 'capital_gains') {
    return income * clampRate(pickFlatRate());
  }

  const brackets = policy.brackets ?? [];
  if (brackets.length === 0) {
    // No brackets configured — fall back to top income rate
    return income * clampRate(policy.rates.income);
  }

  let tax = 0;
  let remaining = income;
  let prevUpto = 0;
  for (const b of brackets) {
    if (remaining <= 0) break;
    const bracketWidth = Math.max(0, b.upto - prevUpto);
    const portion = Math.min(remaining, bracketWidth);
    tax += portion * clampRate(b.rate);
    remaining -= portion;
    prevUpto = b.upto;
  }
  if (remaining > 0) {
    // Over the top bracket — use policy.rates.income as the top marginal rate
    tax += remaining * clampRate(policy.rates.income);
  }
  return tax;
}

/** Per-rate clamp [0, 0.5] — prevents confiscatory rates. */
function clampRate(r: number): number {
  return Math.max(0, Math.min(0.5, r));
}
