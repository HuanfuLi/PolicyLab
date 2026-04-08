import type { LLMMessage } from '../types.js';
import type { ChatMessage, ComparisonResult } from '@policylab/shared';

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

export function buildComparisonMessages(
  session1: SessionSummaryInput,
  session2: SessionSummaryInput
): LLMMessage[] {
  const systemPrompt = `You are the Central Agent evaluating two completed society simulations.
Compare them objectively across exactly 8 dimensions: Economic Equality, Citizen Wellbeing, Social Cohesion, Governance Effectiveness, Long-term Stability, Banking Stability, Fiscal Effectiveness, Economic Growth.
For Banking Stability, Fiscal Effectiveness, and Economic Growth: if the economic telemetry data is not available for a session, note this in your analysis and score conservatively based on available indirect evidence.
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

  const userPrompt = `${fmt(session1, 'A')}

${fmt(session2, 'B')}

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

// ── Phase 8: Policy Brief ──────────���───────────────────────────────────────

export interface PolicyBriefScenario {
  label: string;
  title: string;
  societyOverview: string | null;
  agentCount: number;
  deaths: number;
  avgWealth: number;
  avgHealth: number;
  avgHappiness: number;
  verdict: string | null;
  giniCoefficient?: number;
  m1?: number;
  loansOutstanding?: number;
  infrastructureQuality?: number;
  educationQuality?: number;
  configDiffs?: Record<string, { baseline: unknown; scenario: unknown }>;
}

export function buildPolicyBriefPrompt(
  scenarios: PolicyBriefScenario[]
): LLMMessage[] {
  const systemPrompt = `You are a policy analyst reviewing the outcomes of ${scenarios.length} parallel economic simulation scenarios. Generate a comprehensive markdown policy brief.

The brief must include these sections:
1. **Executive Summary** - 2-3 paragraph overview of key findings across all scenarios
2. **Scenario Comparison Table** - markdown table comparing key parameters and outcomes
3. **Key Findings Per Scenario** - brief analysis of each scenario's outcome
4. **Agent Outcome Highlights** - how representative populations fared differently across scenarios
5. **Policy Recommendations** - evidence-based recommendations from the simulation outcomes

Write in professional policy analysis style. Use specific data from the scenarios. Output ONLY the markdown content, no JSON wrapper.`;

  const scenarioDescriptions = scenarios.map((s, i) => {
    let text = `=== SCENARIO ${i + 1}: "${s.label}" (${s.title}) ===
Overview: ${(s.societyOverview ?? '(none)').slice(0, 400)}
Population: ${s.agentCount} agents, Deaths: ${s.deaths}
Final averages -- wealth: ${s.avgWealth.toFixed(1)}, health: ${s.avgHealth.toFixed(1)}/100, happiness: ${s.avgHappiness.toFixed(1)}/100
Evaluation verdict: ${s.verdict ?? '(none)'}`;

    const econ: string[] = [];
    if (s.giniCoefficient !== undefined) econ.push(`Gini: ${s.giniCoefficient.toFixed(3)}`);
    if (s.m1 !== undefined) econ.push(`M1: ${s.m1.toFixed(0)}`);
    if (s.loansOutstanding !== undefined) econ.push(`Loans: ${s.loansOutstanding.toFixed(0)}`);
    if (s.infrastructureQuality !== undefined) econ.push(`Infrastructure: ${s.infrastructureQuality.toFixed(1)}`);
    if (s.educationQuality !== undefined) econ.push(`Education: ${s.educationQuality.toFixed(1)}`);
    if (econ.length > 0) text += `\nEconomic telemetry: ${econ.join(', ')}`;

    if (s.configDiffs && Object.keys(s.configDiffs).length > 0) {
      const diffs = Object.entries(s.configDiffs)
        .map(([key, v]) => `${key}: ${v.baseline} -> ${v.scenario}`)
        .join(', ');
      text += `\nConfig changes from baseline: ${diffs}`;
    }

    return text;
  }).join('\n\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Generate a policy brief comparing these ${scenarios.length} scenarios:\n\n${scenarioDescriptions}` },
  ];
}
