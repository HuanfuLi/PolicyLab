import type { Agent, IterationStats } from '@policylab/shared';

/** Gini coefficient: 0 = perfect equality, 1 = perfect inequality */
export function gini(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sum += Math.abs(values[i] - values[j]);
    }
  }
  return Math.round((sum / (2 * n * n * mean)) * 1000) / 1000;
}

export function computeStats(agents: Agent[], iterationNumber: number): IterationStats {
  const alive = agents.filter(a => a.isAlive);
  if (alive.length === 0) {
    return {
      iterationNumber,
      avgWealth: 0, avgHealth: 0, avgHappiness: 0,
      minWealth: 0, maxWealth: 0,
      minHealth: 0, maxHealth: 0,
      minHappiness: 0, maxHappiness: 0,
      aliveCount: 0,
      totalCount: agents.length,
      giniWealth: 0,
      giniHappiness: 0,
      avgCortisol: 0,
    };
  }
  const wArr = alive.map(a => a.currentStats.wealth);
  const hArr = alive.map(a => a.currentStats.health);
  const hapArr = alive.map(a => a.currentStats.happiness);
  const cortArr = alive.map(a => a.currentStats.cortisol ?? 0);
  return {
    iterationNumber,
    // Raw precision preserved — rounding is the UI's responsibility.
    avgWealth: wArr.reduce((s, v) => s + v, 0) / alive.length,
    avgHealth: hArr.reduce((s, v) => s + v, 0) / alive.length,
    avgHappiness: hapArr.reduce((s, v) => s + v, 0) / alive.length,
    minWealth: Math.min(...wArr), maxWealth: Math.max(...wArr),
    minHealth: Math.min(...hArr), maxHealth: Math.max(...hArr),
    minHappiness: Math.min(...hapArr), maxHappiness: Math.max(...hapArr),
    aliveCount: alive.length,
    totalCount: agents.length,
    giniWealth: gini(wArr),
    giniHappiness: gini(hapArr),
    avgCortisol: cortArr.reduce((s, v) => s + v, 0) / alive.length,
  };
}
