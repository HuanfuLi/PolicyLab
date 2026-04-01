/**
 * Math utilities for stock-flow consistent operations.
 * Ensures integer-safe distribution with no fractional loss.
 */

/**
 * Distribute an integer total across recipients in proportion to `weights`.
 *
 * Each recipient first receives the floored weighted share, then any remainder
 * is distributed one unit at a time from left to right. This guarantees:
 *   1. sum(shares) === total
 *   2. no recipient receives more than one unit above its floored weighted share
 *
 * Example: distributeProRata(100, [3, 1, 1]) returns [60, 20, 20]
 *
 * @param total - Total fiat to distribute (must be a non-negative integer)
 * @param weights - Array of non-negative numeric weights
 * @returns Array of integer shares, one per weight, summing to total
 */
export function distributeProRata(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('distributeProRata total must be a non-negative finite number');
  }
  if (!Number.isInteger(total)) {
    throw new Error('distributeProRata total must be an integer');
  }
  if (total === 0) return weights.map(() => 0);

  const sanitizedWeights = weights.map(weight => {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error('distributeProRata weights must be non-negative finite numbers');
    }
    return weight;
  });

  const weightSum = sanitizedWeights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) return weights.map(() => 0);

  const shares = sanitizedWeights.map(weight => Math.floor(total * (weight / weightSum)));
  let remainder = total - shares.reduce((sum, share) => sum + share, 0);

  for (let i = 0; i < shares.length && remainder > 0; i++) {
    shares[i]++;
    remainder--;
  }

  return shares;
}
