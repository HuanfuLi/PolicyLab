import type { LLMMessage } from '../types.js';
import type { LocationProfile, EconomyConfig } from '@policylab/shared';
import type { AgentBlueprint } from '../../data/dataBootstrapPipeline.js';

// ── Phase 7: Real-World Scenario Bootstrap Prompts ──────────────────────────

/**
 * Build messages for LLM-generated agent roster names and backgrounds
 * based on real-world location data.
 */
export function buildLocationAgentRosterMessages(
  locationProfile: LocationProfile,
  agentBlueprints: AgentBlueprint[],
  scenario?: string,
): LLMMessage[] {
  const locationSummary = [
    `Location: ${locationProfile.locationName} (${locationProfile.countryCode})`,
    locationProfile.demographics.population ? `Population: ${locationProfile.demographics.population.value.toLocaleString()}` : '',
    locationProfile.economics.gdpPerCapita ? `GDP/capita: $${locationProfile.economics.gdpPerCapita.value.toFixed(0)}` : '',
    locationProfile.economics.giniIndex ? `Gini: ${locationProfile.economics.giniIndex.value.toFixed(1)}` : '',
    locationProfile.demographics.unemploymentRate ? `Unemployment: ${locationProfile.demographics.unemploymentRate.value.toFixed(1)}%` : '',
  ].filter(Boolean).join('\n');

  const agentList = agentBlueprints
    .map((bp, i) => `${i + 1}. Role: ${bp.role}, Sector: ${bp.sector}, Initial wealth: ${bp.initialWealth}`)
    .join('\n');

  const systemPrompt = `You are generating citizen agent profiles for an economic simulation based on real-world data from ${locationProfile.locationName}. Each agent needs a unique name and detailed background reflecting their role and the local context.

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "agents": [
    {"name": "string - culturally appropriate full name", "background": "string - 2-3 sentences describing their life, skills, and economic situation"}
  ]
}

Rules:
- Names should be culturally appropriate for ${locationProfile.countryName}
- Backgrounds should reflect real economic conditions and the agent's sector/role
- Each background should be unique and specific
- Generate exactly ${agentBlueprints.length} agents in the same order as the input list`;

  let userContent = `Location data:\n${locationSummary}\n\nAgent roster (${agentBlueprints.length} agents):\n${agentList}`;
  if (scenario) {
    userContent += `\n\nPolicy scenario being tested: ${scenario}`;
  }
  userContent += '\n\nGenerate names and backgrounds for each agent.';

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

/**
 * Build messages for LLM-generated foundational law document
 * based on real-world governance data.
 */
export function buildLocationLawMessages(
  locationProfile: LocationProfile,
  lawContext: string,
  scenario?: string,
): LLMMessage[] {
  const systemPrompt = `You are generating the foundational law document for an economic simulation based on real-world governance data.

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "law": "string - 8-12 numbered articles in markdown format"
}

The law should cover:
- Individual rights and freedoms (reflecting ${locationProfile.countryName}'s legal tradition)
- Property rights and resource ownership
- Social obligations and duties
- Prohibited actions and behaviors
- Consequences for violations
- Governance authority and limits
- Economic participation rules (trade, enterprise, banking)
- Conflict resolution mechanisms

Format each article as: "**Article N: Title**\\nContent..."`;

  let userContent = `Governance context:\n${lawContext}`;
  if (scenario) {
    userContent += `\n\nPolicy scenario being tested: ${scenario}\nIncorporate relevant policy provisions into the law.`;
  }
  userContent += '\n\nGenerate the foundational law document JSON.';

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

/**
 * Build messages for interpreting a policy scenario description into
 * specific economic parameter changes (D-12).
 */
export function buildScenarioInterpretationMessages(
  scenario: string,
  currentConfig: Partial<EconomyConfig>,
  locationProfile: LocationProfile,
): LLMMessage[] {
  const configSummary = Object.entries(currentConfig)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const systemPrompt = `You are interpreting a policy scenario description into specific economic parameter changes for a simulation.

Current economic configuration:
${configSummary}

Available parameters you can override (all numeric values are per-iteration rates unless noted):
- reserveRequirement: 0.0-1.0 (bank reserve ratio)
- baseLoanInterestRate: per-iteration (e.g., 0.005 = ~6% annual)
- depositInterestRate: per-iteration
- budgetSpendingRate: 0.0-1.0 (fraction of treasury spent per iteration)
- infrastructureMultiplier: productivity bonus per quality point
- educationMultiplier: skill gain bonus per quality point
- defenseMultiplier: enforcement bonus per quality point
- welfareMultiplier: UBI supplement per quality point

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "parameterOverrides": {
    "paramName": newValue
  },
  "reasoning": "string - brief explanation of why these changes reflect the scenario"
}

Only include parameters that the scenario explicitly or strongly implies should change. Do not change parameters that are unrelated to the scenario.`;

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Location: ${locationProfile.locationName} (${locationProfile.countryCode})\n\nPolicy scenario:\n${scenario}\n\nWhat economic parameter changes does this scenario imply?`,
    },
  ];
}
