import type { LLMMessage } from '../types.js';
import type { Agent, SessionPolicy } from '@policylab/shared';
import type { GovernancePolicyProposal, GovernanceBallotItem } from './shared.js';

// ── Governance Cycle Prompts ───────────────────────────────────────────────────

/**
 * Asks a citizen agent (politician) to propose ONE economic policy change
 * based on their personal situation and memories.
 *
 * Returns: { proposal: { field, value, reasoning } | null }
 */
export function buildProposalPrompt(
  agent: Agent,
  currentPolicy: SessionPolicy,
  societyContext: string,
  iterationNumber: number,
): LLMMessage[] {
  const policyDesc = `Current laws:
- tax_rate: ${currentPolicy.tax_rate} (wealth demurrage tax per iteration; range 0.0–0.25)
- ubi_allocation: ${currentPolicy.ubi_allocation} (fraction of tax pool redistributed as UBI; range 0.0–1.0)
- enforcement_level: ${currentPolicy.enforcement_level} (theft/crime deterrence multiplier; range 0.1–3.0)`;

  const systemPrompt = `You are ${agent.name}, a ${agent.role} in a society.

${societyContext}

It is iteration ${iterationNumber} — a Governance Session is now open.

Your current situation:
- Wealth: ${agent.currentStats.wealth.toFixed(1)}
- Health: ${agent.currentStats.health.toFixed(1)}
- Happiness: ${agent.currentStats.happiness.toFixed(1)}
- Cortisol (stress): ${(agent.currentStats.cortisol ?? 20).toFixed(1)}

${policyDesc}

You have the right to propose ONE change to these economic laws.
Consider your personal hardships and the society's needs.

Examples of good proposals:
- Low wealth / high stress → propose higher ubi_allocation (0.8 → 1.0) or lower tax_rate
- Crime victim → propose higher enforcement_level (1.0 → 1.5)
- Wealthy merchant → propose lower tax_rate (0.02 → 0.01)
- Starving population → propose higher ubi_allocation

RESPOND WITH ONLY VALID JSON (no markdown):
{"proposal": {"field": "tax_rate", "value": 0.03, "reasoning": "brief reason"}}
OR if you have no urgent concern: {"proposal": null}`;

  return [{ role: 'system', content: systemPrompt }];
}

/**
 * Asks the Central Agent (Speaker of the House) to synthesize raw proposals
 * into a formal Legislative Ballot with at most 3 deduplicated items.
 *
 * Returns: { ballot: [{ field, proposedValue, description }] }
 */
export function buildBallotPrompt(
  proposals: Array<{ name: string; role: string; proposal: GovernancePolicyProposal }>,
  currentPolicy: SessionPolicy,
  societyContext: string,
): LLMMessage[] {
  const proposalLines = proposals
    .map(p => `- ${p.name} (${p.role}): change ${p.proposal.field} to ${p.proposal.value} — "${p.proposal.reasoning}"`)
    .join('\n');

  const systemPrompt = `You are the Speaker of the Legislative Assembly.

${societyContext}

Citizen proposals received this session:
${proposalLines}

Current policy:
- tax_rate: ${currentPolicy.tax_rate}
- ubi_allocation: ${currentPolicy.ubi_allocation}
- enforcement_level: ${currentPolicy.enforcement_level}

Your task: synthesize these proposals into a formal Legislative Ballot.
Rules:
- Deduplicate: if multiple agents propose the same field, average or pick the most common value.
- Maximum 3 ballot items.
- Only include changes that are meaningfully different from current policy.
- Keep proposed values within valid ranges: tax_rate [0.0–0.25], ubi_allocation [0.0–1.0], enforcement_level [0.1–3.0].
- Write a short neutral description for each item.
- Write a one-sentence "impactForecast" for each item: a concrete economic prediction of the likely effect (e.g. "System Projection: Raising the tax rate will increase the UBI pool by ~40% but may reduce merchant reinvestment.").
- If all proposals are trivial or contradictory, return an empty ballot.

RESPOND WITH ONLY VALID JSON (no markdown):
{"ballot": [{"field": "tax_rate", "proposedValue": 0.03, "description": "Raise demurrage tax to fund larger UBI", "impactForecast": "System Projection: Higher tax will widen the redistribution pool but reduce disposable wealth for high earners."}]}`;

  return [{ role: 'system', content: systemPrompt }];
}

/**
 * Asks a citizen agent (politician) to vote YES or NO on a specific ballot item.
 *
 * Returns: { vote: "YES" | "NO", reason: "one sentence" }
 */
export function buildVotePrompt(
  agent: Agent,
  ballotItem: GovernanceBallotItem,
  currentPolicy: SessionPolicy,
): LLMMessage[] {
  const fieldLabels: Record<string, string> = {
    tax_rate: 'wealth demurrage tax rate',
    ubi_allocation: 'fraction of tax redistributed as Universal Basic Income',
    enforcement_level: 'law enforcement / theft deterrence multiplier',
  };
  const label = fieldLabels[ballotItem.field] ?? ballotItem.field;
  const direction = ballotItem.proposedValue > (currentPolicy[ballotItem.field] ?? 0) ? 'INCREASE' : 'DECREASE';

  const forecastBlock = ballotItem.impactForecast
    ? `\n\n${ballotItem.impactForecast}`
    : '';

  const systemPrompt = `You are ${agent.name}, a ${agent.role} voting in a Legislative Session.

Ballot item: "${ballotItem.description}"
Proposal: ${direction} the ${label} from ${currentPolicy[ballotItem.field]} to ${ballotItem.proposedValue}.${forecastBlock}

Your current situation:
- Wealth: ${agent.currentStats.wealth.toFixed(1)}
- Health: ${agent.currentStats.health.toFixed(1)}
- Stress (cortisol): ${(agent.currentStats.cortisol ?? 20).toFixed(1)}

Vote based on self-interest AND what you believe is best for the society. The impact forecast above shows the likely economic consequence — weigh it carefully before deciding.

RESPOND WITH ONLY VALID JSON (no markdown):
{"vote": "YES", "reason": "one sentence explaining your vote"}`;

  return [{ role: 'system', content: systemPrompt }];
}

// ── Governance: Franchise Size Prompt ────────────────────────────────────────

/**
 * Asks the Central Agent to determine how many citizens should have the right
 * to vote in a Legislative Session, based on the society's constitution and
 * power structure — replacing the hardcoded dictatorship/democracy regex.
 *
 * Phase C of the Physics Fidelity & Emergent Governance plan.
 *
 * Returns: { franchiseSize: number, reasoning: string }
 */
export function buildFranchiseSizePrompt(
  populationCount: number,
  societyContext: string,
): LLMMessage[] {
  const systemPrompt = `You are a constitutional scholar analysing a simulated society.
Based on the society's structure and laws, determine how many citizens should have the right to vote in a Legislative Session this iteration.

${societyContext}

Total living citizens: ${populationCount}

FRANCHISE SIZE GUIDE:
- 1       → Absolute monarchy / dictatorship: a single ruler decrees all policy.
- 2–3     → Oligarchy / junta: a small council controls the state.
- ~10–30% → Representative democracy: elected officials vote on behalf of the people.
- 50–75%  → Broad participatory democracy: most adults have a voice.
- 100%    → Direct democracy / consensus: every citizen votes.

Read the society overview and founding law excerpt carefully.
If the law mentions a specific governance structure (Sun King, Soviet Council, People's Assembly, etc.), let that guide your answer.

RESPOND WITH ONLY VALID JSON (no markdown, no preamble):
{"franchiseSize": <integer between 1 and ${populationCount}>, "reasoning": "one sentence"}`;

  return [{ role: 'system', content: systemPrompt }];
}

// ── Sheriff: Legality Check Prompt ───────────────────────────────────────────

/**
 * Asks the Central Agent (Law Enforcement AI) to identify which agents'
 * actions violate the active laws this iteration.
 *
 * Phase A of the Neuro-Symbolic Sheriff system.
 * Non-fatal: on parse failure, caller defaults to an empty illegal set.
 *
 * Returns: { illegalAgents: [{ agentId, actionCode, reason }] }
 */
export function buildLegalityCheckPrompt(
  agentIntents: Array<{ agentId: string; agentName: string; actionCodes: string[]; intent: string }>,
  law: string | null,
  societyOverview: string | null,
): LLMMessage[] {
  // Fix: Use full agent IDs so the LLM can return them for enforcement matching.
  // Truncated IDs caused legality enforcement to silently fail.
  const agentList = agentIntents
    .map(a =>
      `- ${a.agentName} [id:${a.agentId}]: actions=[${a.actionCodes.join(', ')}] intent="${a.intent.slice(0, 120)}"`
    )
    .join('\n');

  const systemPrompt = `You are the Law Enforcement AI for a society simulation.
Your only job is to identify which agents' chosen actions violate the society's active laws this iteration.

Society overview (excerpt):
${(societyOverview ?? '(none)').slice(0, 300)}

Active laws:
${(law ?? '(no laws defined)').slice(0, 600)}

Agent actions this iteration:
${agentList}

RULES FOR FLAGGING ILLEGALITY — be conservative, not aggressive:
- Only flag actions that CLEARLY violate a specific law article.
- STEAL is illegal in almost all societies unless a law article explicitly permits it.
- SABOTAGE and EMBEZZLE are typically illegal unless the law permits them.
- PRODUCE_AND_SELL is illegal in a fully collectivised society that forbids private commerce.
- FOUND_ENTERPRISE is illegal if the law explicitly bans private enterprise.
- Standard actions (WORK_AT_ENTERPRISE, REST, INVEST, HELP, POST_BUY_ORDER, POST_SELL_ORDER, APPLY_FOR_JOB) are almost never illegal.
- If a law is vague or absent, do NOT flag an action as illegal.
- Each agent can have at most ONE action flagged per iteration.

RESPOND WITH ONLY VALID JSON (no markdown, no preamble):
{"illegalAgents": [{"agentId": "full-uuid-string", "actionCode": "STEAL", "reason": "Violates Article 3: private theft of another citizen's property is prohibited."}]}

If no actions are clearly illegal, respond: {"illegalAgents": []}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Identify illegal actions this iteration.' },
  ];
}
