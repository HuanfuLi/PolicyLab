import type { ItemType, SkillMatrix } from '@policylab/shared';

export function normalizeItemType(raw: unknown): ItemType {
  const normalized = String(raw ?? 'food').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'food') return 'food';
  if (normalized === 'tools' || normalized === 'tool' || normalized === 'tech_parts' || normalized === 'tech') return 'tools';
  if (normalized === 'luxury_goods' || normalized === 'luxury' || normalized === 'goods') return 'luxury_goods';
  return 'raw_materials';
}

export function industryToItemType(industry: string): ItemType {
  return normalizeItemType(industry);
}

export function getAgentPeakSkill(skills: SkillMatrix): number {
  return Math.max(...Object.values(skills).map(entry => Math.round(entry.level)));
}

/**
 * Integer-safe pro-rata distribution (BUG-12/14).
 *
 * Divides `total` fiat among participants according to `ratios` using Math.floor,
 * then distributes the integer remainder (total - sum(shares)) to the first N
 * participants. Guarantees: sum(shares) === total exactly, preventing micro-leaks
 * from IEEE-754 float division (e.g., 100 / 3 = 33.33... × 3 = 99.99).
 *
 * @param total  Total integer fiat to distribute.
 * @param ratios Relative weight for each participant (need not sum to any particular value).
 * @returns      Array of integer shares, same length as `ratios`, summing to `total`.
 */
export function distributeProRata(total: number, ratios: number[]): number[] {
  const ratioSum = ratios.reduce((s, r) => s + r, 0);
  if (ratioSum === 0 || ratios.length === 0) return ratios.map(() => 0);
  const shares = ratios.map(r => Math.floor(total * (r / ratioSum)));
  const distributed = shares.reduce((s, v) => s + v, 0);
  let remainder = Math.round(total - distributed); // round to handle float imprecision in sum
  for (let i = 0; i < shares.length && remainder > 0; i++) {
    shares[i]++;
    remainder--;
  }
  return shares;
}
