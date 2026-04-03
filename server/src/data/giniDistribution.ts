/**
 * Gini-based wealth distribution algorithm.
 *
 * Uses Pareto distribution to generate agent wealth values that approximate
 * a target Gini coefficient. For Gini G, Pareto shape alpha = (1+G)/(2*G).
 *
 * @module
 */

/**
 * Simple seeded pseudo-random number generator (Mulberry32).
 * Returns a function that produces uniform random values in (0, 1).
 */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Distribute total wealth among N agents to approximate a target Gini coefficient.
 * Uses Pareto distribution: for Gini G, alpha = (1+G)/(2*G).
 *
 * **IMPORTANT: `gini` is on 0-1 scale (NOT 0-100 World Bank scale).**
 * World Bank reports Gini as 0-100 (e.g., Brazil = 48.9). Callers must divide
 * by 100 before passing to this function (e.g., 48.9 / 100 = 0.489).
 * See Pitfall 4 in 07-RESEARCH.md.
 *
 * @param agentCount - Number of agents
 * @param baseFiat - Base fiat per agent (total = agentCount * baseFiat)
 * @param gini - Target Gini coefficient on 0-1 scale
 * @param seed - Optional seed for reproducible results (default: use Math.random)
 * @returns Array of wealth values, sorted descending, summing to agentCount * baseFiat
 */
export function distributeWealth(
  agentCount: number,
  baseFiat: number,
  gini: number,
  seed?: number,
): number[] {
  const totalWealth = agentCount * baseFiat;

  // Edge case: perfect equality
  if (gini <= 0.01) {
    return Array(agentCount).fill(baseFiat);
  }

  // Clamp gini to avoid degenerate alpha values
  const clampedGini = Math.max(0.01, Math.min(0.95, gini));

  // Pareto shape parameter: for Gini G, alpha = (1 + G) / (2 * G)
  const alpha = (1 + clampedGini) / (2 * clampedGini);

  // Random number generator
  const random = seed !== undefined ? createRng(seed) : Math.random;

  // Generate Pareto-distributed samples using stratified quantiles for better
  // approximation of the target Gini with small sample sizes.
  // Instead of pure random samples, use evenly-spaced quantiles with jitter.
  const raw: number[] = [];
  for (let i = 0; i < agentCount; i++) {
    // Stratified sampling: divide [0,1] into N strata, sample within each
    const base = i / agentCount;
    const jitter = random() / agentCount;
    const u = base + jitter;
    // Pareto inverse CDF: x = (1 - u)^(-1/alpha)
    raw.push(Math.pow(1 - u, -1 / alpha));
  }

  // Normalize to total wealth
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const normalized = raw.map((v) => (v / rawSum) * totalWealth);

  // Round to integers
  const rounded = normalized.map((v) => Math.round(v));

  // Ensure all values are at least 1 (no zero or negative wealth)
  // Steal from the richest to fund the minimum
  for (let i = 0; i < rounded.length; i++) {
    if (rounded[i] < 1) {
      const deficit = 1 - rounded[i];
      rounded[i] = 1;
      // Find the richest agent and subtract the deficit
      let maxIdx = 0;
      for (let j = 1; j < rounded.length; j++) {
        if (rounded[j] > rounded[maxIdx]) maxIdx = j;
      }
      rounded[maxIdx] -= deficit;
    }
  }

  // Adjust rounding remainder onto the median agent to preserve exact total
  const roundedSum = rounded.reduce((a, b) => a + b, 0);
  const remainder = totalWealth - roundedSum;
  if (remainder !== 0) {
    const medianIdx = Math.floor(agentCount / 2);
    rounded[medianIdx] += remainder;
  }

  // Sort descending
  rounded.sort((a, b) => b - a);

  return rounded;
}

/**
 * Compute the Gini coefficient of a wealth array (0-1 scale).
 * For unit test verification.
 *
 * Uses the relative mean absolute difference formula:
 * G = (sum of |xi - xj| for all i,j) / (2 * n * sum(xi))
 *
 * @param values - Array of wealth values
 * @returns Gini coefficient between 0 (perfect equality) and 1 (perfect inequality)
 */
export function computeGini(values: number[]): number {
  const n = values.length;
  if (n <= 1) return 0;

  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;

  let diffSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      diffSum += Math.abs(values[i] - values[j]);
    }
  }

  return diffSum / (2 * n * sum);
}
