import type { LLMMessage } from '../types.js';
import type { ChatMessage, ComparisonResult, EconomyParamDiff } from '@policylab/shared';

// ── Phase 5 prompts ─────────────────────────────────────────────────────────

interface SessionSummaryInput {
  title: string;
  societyOverview: string | null;
  law: string | null;
  agentCount: number;
  avgWealth: number;
  avgHealth: number;
  avgHappiness: number;
  deaths: number;
  verdict: string | null;
  // Economic telemetry (Phase 6)
  giniCoefficient?: number;
  m1?: number;
  loansOutstanding?: number;
  infrastructureQuality?: number;
  educationQuality?: number;
  defenseQuality?: number;
  welfareQuality?: number;
}

/** Per-iteration metric snapshot for time-series grounding */
export interface IterationMetricRow {
  iter: number;
  avgWealth: number;
  avgHealth: number;
  avgHappiness: number;
  gini?: number;
  cpi?: number;
  m1?: number;
}

/** Wealth distribution summary for inequality grounding */
export interface WealthDistribution {
  bottom25Avg: number;
  median: number;
  top25Avg: number;
}

export function buildComparisonMessages(
  session1: SessionSummaryInput,
  session2: SessionSummaryInput,
  configDiffs?: EconomyParamDiff[],
  timeSeries1?: IterationMetricRow[],
  timeSeries2?: IterationMetricRow[],
  wealthDist1?: WealthDistribution,
  wealthDist2?: WealthDistribution,
): LLMMessage[] {
  const systemPrompt = `You are the Central Agent evaluating two completed society simulations.
Compare them objectively across exactly 8 dimensions: Economic Equality, Citizen Wellbeing, Social Cohesion, Governance Effectiveness, Long-term Stability, Banking Stability, Fiscal Effectiveness, Economic Growth.
For Banking Stability, Fiscal Effectiveness, and Economic Growth: if the economic telemetry data is not available for a session, note this in your analysis and score conservatively based on available indirect evidence.

CRITICAL RULES:
- If configuration differences are listed below, your narrative MUST explicitly explain how those parameter changes caused or contributed to observed outcome differences.
- If per-iteration time series data is provided, base your trend claims on the ACTUAL numbers. Do NOT invent trends that contradict the data.
- If wealth distribution data is provided, use it to ground inequality claims.

Respond with ONLY valid JSON, no markdown, no preamble.`;

  const fmt = (s: SessionSummaryInput, label: 'A' | 'B') => {
    let text = `=== SOCIETY ${label}: ${s.title} ===
Overview: ${(s.societyOverview ?? '(none)').slice(0, 500)}
Law excerpt: ${(s.law ?? '(none)').slice(0, 400)}
Agents: ${s.agentCount} citizens, Deaths: ${s.deaths}
Final avg — wealth: ${s.avgWealth}, health: ${s.avgHealth}/100, happiness: ${s.avgHappiness}/100
Evaluation verdict: ${s.verdict ?? '(none)'}`;

    // Append economic telemetry if available
    const econ: string[] = [];
    if (s.giniCoefficient !== undefined) econ.push(`Gini: ${s.giniCoefficient.toFixed(3)}`);
    if (s.m1 !== undefined) econ.push(`M1: ${s.m1.toFixed(0)}`);
    if (s.loansOutstanding !== undefined) econ.push(`Loans outstanding: ${s.loansOutstanding.toFixed(0)}`);
    if (s.infrastructureQuality !== undefined) econ.push(`Infrastructure quality: ${s.infrastructureQuality.toFixed(1)}`);
    if (s.educationQuality !== undefined) econ.push(`Education quality: ${s.educationQuality.toFixed(1)}`);
    if (s.defenseQuality !== undefined) econ.push(`Defense quality: ${s.defenseQuality.toFixed(1)}`);
    if (s.welfareQuality !== undefined) econ.push(`Welfare quality: ${s.welfareQuality.toFixed(1)}`);
    if (econ.length > 0) {
      text += `\nEconomic telemetry: ${econ.join(', ')}`;
    }

    return text;
  };

  // Build config diff block
  let configDiffBlock = '';
  if (configDiffs && configDiffs.length > 0) {
    const rows = configDiffs.map(d => {
      const v1 = typeof d.session1Value === 'boolean' ? (d.session1Value ? 'Yes' : 'No') : d.session1Value;
      const v2 = typeof d.session2Value === 'boolean' ? (d.session2Value ? 'Yes' : 'No') : d.session2Value;
      return `  ${d.label}: A=${v1}, B=${v2}`;
    });
    configDiffBlock = `\n\n=== CONFIGURATION DIFFERENCES (policy changes between sessions) ===\nThese parameters were deliberately changed. Your analysis MUST attribute outcome differences to these changes:\n${rows.join('\n')}`;
  }

  // Build time-series blocks (compact format: one line per iteration)
  const fmtTimeSeries = (rows: IterationMetricRow[] | undefined, label: 'A' | 'B') => {
    if (!rows || rows.length === 0) return '';
    const header = `\n\n=== SOCIETY ${label} PER-ITERATION TRAJECTORY ===\niter | wealth | health | happiness | gini | cpi | m1`;
    const lines = rows.map(r => {
      const parts = [
        String(r.iter).padStart(4),
        r.avgWealth.toFixed(0).padStart(7),
        r.avgHealth.toFixed(0).padStart(7),
        r.avgHappiness.toFixed(0).padStart(10),
        (r.gini?.toFixed(3) ?? '  n/a').padStart(6),
        (r.cpi?.toFixed(1) ?? ' n/a').padStart(6),
        (r.m1 !== undefined ? r.m1.toFixed(0) : '  n/a').padStart(8),
      ];
      return parts.join(' |');
    });
    return header + '\n' + lines.join('\n');
  };

  // Build wealth distribution blocks
  const fmtWealthDist = (dist: WealthDistribution | undefined, label: 'A' | 'B') => {
    if (!dist) return '';
    return `\nSociety ${label} wealth distribution: Bottom 25% avg=${dist.bottom25Avg.toFixed(0)}, Median=${dist.median.toFixed(0)}, Top 25% avg=${dist.top25Avg.toFixed(0)}`;
  };

  const userPrompt = `${fmt(session1, 'A')}${fmtWealthDist(wealthDist1, 'A')}

${fmt(session2, 'B')}${fmtWealthDist(wealthDist2, 'B')}${configDiffBlock}${fmtTimeSeries(timeSeries1, 'A')}${fmtTimeSeries(timeSeries2, 'B')}

Compare these two societies. Return JSON:
{
  "narrative": "<3-5 paragraph prose comparison>",
  "dimensions": [
    { "name": "Economic Equality", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Citizen Wellbeing", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Social Cohesion", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Governance Effectiveness", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Long-term Stability", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Banking Stability", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Fiscal Effectiveness", "score1": 0, "score2": 0, "analysis": "..." },
    { "name": "Economic Growth", "score1": 0, "score2": 0, "analysis": "..." }
  ],
  "verdict": "<1-2 sentence overall takeaway>"
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function buildComparisonChatMessages(
  session1Title: string,
  session2Title: string,
  comparison: ComparisonResult,
  history: ChatMessage[],
  userMessage: string
): LLMMessage[] {
  const systemPrompt = `You are the Central Agent who has analysed two society simulations: "${session1Title}" and "${session2Title}".

Your comparison summary:
${comparison.narrative}

Dimensions (Society A score / Society B score):
${comparison.dimensions.map(d => `- ${d.name}: ${d.score1} / ${d.score2} — ${d.analysis}`).join('\n')}

Overall verdict: ${comparison.verdict}

Answer follow-up questions about the comparison. Be specific and analytical. Keep responses under 200 words.`;

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  const recentHistory = history.slice(-20);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}
