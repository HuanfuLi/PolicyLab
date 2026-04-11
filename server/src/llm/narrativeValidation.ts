import type { TelemetryLog } from '@policylab/shared';

export interface NarrativeValidation {
  giniDirectionMatch: boolean;
  deathCountAccurate: boolean;
  wealthTrendMatch: boolean;
  passed: boolean;
  failures: string[]; // human-readable descriptions of each failure
}

/**
 * Builds a pre-interpreted telemetry digest that grounds the LLM's narrative
 * in concrete facts rather than raw numbers. Injected before the resolution prompt.
 *
 * Accepts the last N iterations of telemetry (not just previous + current) so
 * the LLM can see short-term trends instead of single-iteration deltas.
 *
 * @param current  Current iteration's telemetry
 * @param recentHistory  Last 3-5 iterations of telemetry (oldest first), excluding current. Empty for first iteration.
 * @param agentStats Live agent stat snapshots for mood calculation
 * @param agentsAlive Number of alive agents this iteration
 * @param agentsDied Number of agents who died this iteration
 */
export function buildTelemetryDigest(
  current: TelemetryLog,
  recentHistory: TelemetryLog[],
  agentStats: Array<{ health: number; happiness: number; cortisol: number; wealth: number }>,
  agentsAlive: number,
  agentsDied: number,
): string {
  if (recentHistory.length === 0) return 'First iteration -- no trend data available.';

  const previous = recentHistory[recentHistory.length - 1];
  const giniDelta = (current.giniCoefficient ?? 0) - (previous.giniCoefficient ?? 0);
  const avgWealth = agentStats.length > 0
    ? agentStats.reduce((s, a) => s + a.wealth, 0) / agentStats.length
    : 0;
  const prevAvgWealth = previous.totalFiatSupply / Math.max(agentsAlive, 1);
  const satisfiedPct = agentStats.length > 0
    ? Math.round(agentStats.filter(a => a.happiness > 50).length / agentStats.length * 100)
    : 0;
  const distressedPct = agentStats.length > 0
    ? Math.round(agentStats.filter(a => a.health < 30 || a.cortisol > 70).length / agentStats.length * 100)
    : 0;

  const trend = giniDelta > 0.01 ? 'declining (inequality growing)'
    : giniDelta < -0.01 ? 'improving (equality growing)'
    : 'stable';

  // Build compact multi-iteration trend table so the LLM can see trajectory
  const allIters = [...recentHistory, current];
  const trendTable = allIters.map(t => {
    const w = t.totalFiatSupply / Math.max(agentsAlive, 1);
    return `  iter ${t.iterationNumber}: wealth=${w.toFixed(0)}, gini=${(t.giniCoefficient ?? 0).toFixed(3)}, cpi=${(t.cpi ?? 100).toFixed(1)}, food=${(t.ammSpotPrice_Food ?? 0).toFixed(2)}`;
  }).join('\n');

  return `TELEMETRY DIGEST (you MUST ground your narrative in these facts):
- Overall trend: ${trend}
- Gini: ${(current.giniCoefficient ?? 0).toFixed(3)} (${giniDelta > 0 ? '+' : ''}${giniDelta.toFixed(3)} vs last iteration)
- Avg wealth: ${avgWealth.toFixed(0)} fiat (${avgWealth > prevAvgWealth ? 'rising' : avgWealth < prevAvgWealth ? 'falling' : 'stable'})
- CPI: ${(current.cpi ?? 100).toFixed(1)} (inflation ${(current.inflationRate ?? 0).toFixed(1)}%)
- Food price: ${(current.ammSpotPrice_Food ?? 0).toFixed(2)} fiat/unit
- Population mood: ${satisfiedPct}% satisfied, ${distressedPct}% in distress
- Deaths this iteration: ${agentsDied}

Recent trajectory (last ${allIters.length} iterations):
${trendTable}

NARRATIVE RULE: Your prose MUST include at least 2 specific numbers from this digest. Base trend claims on the trajectory table above — do NOT invent trends that contradict the data. If metrics improve, narrate cautious optimism. If they decline, narrate crisis.`;
}

/**
 * Validates a narrative against telemetry data to catch contradictions.
 * Returns pass/fail for 3 assertions: Gini direction, death count accuracy, wealth trend.
 *
 * @param narrative  The LLM-generated narrative text
 * @param current    Current iteration's telemetry
 * @param previous   Previous iteration's telemetry (null for first iteration)
 * @param agentsAlive Number of alive agents this iteration
 * @param agentsDied Number of agents who died this iteration
 */
export function validateNarrative(
  narrative: string,
  current: TelemetryLog,
  previous: TelemetryLog | null,
  agentsAlive: number,
  agentsDied: number,
): NarrativeValidation {
  const failures: string[] = [];
  const lower = narrative.toLowerCase();

  // 1. Death count accuracy (D-20 assertion 2)
  const deathWords = ['starv', 'famine', 'died of hunger', 'starvation', 'perished from hunger'];
  const mentionsDeath = deathWords.some(w => lower.includes(w));
  const deathCountAccurate = !(mentionsDeath && agentsDied === 0);
  if (!deathCountAccurate) {
    failures.push(`Narrative mentions starvation/famine but 0 agents died this iteration`);
  }

  // 2. Wealth trend consistency (D-20 assertion 3)
  let wealthTrendMatch = true;
  if (previous) {
    const currentAvg = current.totalFiatSupply / Math.max(agentsAlive, 1);
    const prevAvg = previous.totalFiatSupply / Math.max(agentsAlive, 1);
    const wealthRising = currentAvg > prevAvg * 1.02; // >2% increase
    const collapseWords = ['wealth collapsed', 'economic ruin', 'wealth plummeted', 'economic collapse', 'wealth destroyed'];
    const mentionsCollapse = collapseWords.some(w => lower.includes(w));
    if (mentionsCollapse && wealthRising) {
      wealthTrendMatch = false;
      failures.push(`Narrative says wealth collapsed but avg wealth rose from ${prevAvg.toFixed(0)} to ${currentAvg.toFixed(0)}`);
    }
  }

  // 3. Gini direction consistency (D-20 assertion 1)
  let giniDirectionMatch = true;
  if (previous) {
    const giniDelta = (current.giniCoefficient ?? 0) - (previous.giniCoefficient ?? 0);
    const equalityWords = ['equality grew', 'inequality narrowed', 'gap narrowed', 'more equal'];
    const mentionsEquality = equalityWords.some(w => lower.includes(w));
    if (mentionsEquality && giniDelta > 0.02) {
      giniDirectionMatch = false;
      failures.push(`Narrative says equality grew but Gini increased by ${giniDelta.toFixed(3)}`);
    }
  }

  return {
    giniDirectionMatch,
    deathCountAccurate,
    wealthTrendMatch,
    passed: giniDirectionMatch && deathCountAccurate && wealthTrendMatch,
    failures,
  };
}
