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
    {"name": "string - culturally appropriate full name", "background": "string - 5-8 sentence life story including: where they grew up, a formative event that shaped their worldview, their economic philosophy (do they hoard, share, trade aggressively, save cautiously?), a personal fear or ambition that drives them, and specific practical knowledge tied to their role and sector"}
  ]
}

Rules:
- Names should be culturally appropriate for ${locationProfile.countryName}
- Backgrounds should reflect real economic conditions and the agent's sector/role
- Each background should be unique and specific
- Each background MUST include an economic instinct: how this person relates to money, food, and risk. Examples: 'He hoards food instinctively after a childhood famine', 'She trusts no bank after her father lost his savings', 'He invests aggressively, chasing every opportunity'
- Backgrounds should create natural economic diversity: some agents produce, some trade, some save, some spend freely
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

Available parameters you can override. IMPORTANT: interest rates are PER-ITERATION (1 iteration ≈ 1 month). To convert annual rates to per-iteration, divide by 12.

- reserveRequirement: 0.0-1.0 (bank reserve ratio, e.g., 0.10 = 10%)
- baseLoanInterestRate: per-iteration rate (current value shown above; multiply by 12 for annual equivalent. Example: 0.00435/iter ≈ 5.2%/year. To set 20% annual → 0.0167/iter)
- depositInterestRate: per-iteration rate (same conversion as loan rate)
- baseTaxRate: 0.0-1.0 (per-iteration tax rate, e.g., 0.02 = 2% per iteration)
- budgetSpendingRate: 0.0-1.0 (fraction of treasury spent per iteration)
- infrastructureMultiplier: productivity bonus per quality point (default ~0.002)
- educationMultiplier: skill gain bonus per quality point (default ~0.003)
- defenseMultiplier: enforcement bonus per quality point (default ~0.001)
- welfareMultiplier: UBI supplement per quality point (default ~0.005)

When the user says "raise X by Y%", apply the percentage change to the CURRENT value shown above. For example, if current baseLoanInterestRate is 0.00435 and user says "raise by 20%", the new value is 0.00435 * 1.20 = 0.00522. But if user says "set interest rate TO 20%", convert: 20% annual / 12 = 0.0167 per iteration.

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
