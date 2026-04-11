import type { LLMMessage, ContentBlock } from '../types.js';
import type {
  Agent,
  ChatMessage,
  Session,
  BrainstormChecklist,
} from '@policylab/shared';
import type { AgentIntent } from './shared.js';

export function buildBrainstormMessages(
  seedIdea: string,
  history: ChatMessage[],
  userMessage: string,
  currentChecklist?: BrainstormChecklist
): LLMMessage[] {
  // Build an explicit status block from the persisted checklist so the LLM
  // never has to re-derive which areas have already been confirmed from context.
  const areas = ['governance', 'economy', 'legal', 'culture', 'infrastructure'] as const;
  const checklistStatus = areas
    .map(a => `  ${a}: ${currentChecklist?.[a] ? '✓ confirmed' : 'needs more detail'}`)
    .join('\n');

  // Build a conversation transcript for models that don't reliably track
  // multi-turn context on their own. This is embedded in the system prompt
  // as a plain-text record so every provider has an unambiguous view of
  // what has already been discussed.
  const recentHistory = history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-20);
  const transcriptLines = recentHistory.map(m =>
    `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`
  );
  const transcriptSection = transcriptLines.length > 0
    ? `\n\nConversation so far:\n${transcriptLines.join('\n\n')}`
    : '';

  // Build the dynamic JSON example showing current checklist values
  const cl = {
    governance: currentChecklist?.governance ?? false,
    economy: currentChecklist?.economy ?? false,
    legal: currentChecklist?.legal ?? false,
    culture: currentChecklist?.culture ?? false,
    infrastructure: currentChecklist?.infrastructure ?? false,
  };
  const allCurrentlyDone = Object.values(cl).every(Boolean);

  const systemPrompt = `You are the Central Agent for a society simulation. The user wants to simulate: "${seedIdea}"

Your job is to gather enough information to design a complete society by discussing these 5 areas:
1. governance - How the society is governed, decision-making structures
2. economy - Economic system, resource distribution, trade
3. legal - Laws, justice system, rights and obligations
4. culture - Values, traditions, social norms, education
5. infrastructure - Physical environment, technology level, basic services

Current coverage status (DO NOT reset items already marked ✓ confirmed):
${checklistStatus}${transcriptSection}

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "reply": "your conversational response",
  "checklist": {
    "governance": ${cl.governance},
    "economy": ${cl.economy},
    "legal": ${cl.legal},
    "culture": ${cl.culture},
    "infrastructure": ${cl.infrastructure}
  },
  "readyForDesign": ${allCurrentlyDone}
}

CRITICAL CHECKLIST RULES (follow these exactly):
1. Every item marked ✓ confirmed above MUST stay true — NEVER set a confirmed area back to false.
2. When the user's message provides meaningful information about an area (even briefly), set that area to true. You do NOT need exhaustive detail — a clear direction or preference is enough.
3. If the user provides information covering multiple areas at once, mark ALL relevant areas as true in a single response.
4. readyForDesign MUST be true when ALL 5 checklist items are true. Do not withhold readyForDesign if all items are confirmed.
5. When all 5 items are already confirmed, set readyForDesign to true and tell the user they can proceed to design.

CONVERSATION RULES:
- Ask 2-3 focused questions about areas that are still NOT confirmed.
- Build on what has already been discussed; do not repeat questions already answered.
- Be encouraging and curious in your reply.
- Keep replies concise (under 250 words).`;

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  // Also include history as multi-turn messages (correct format for API-based models).
  for (const msg of recentHistory) {
    messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}

export function buildOverviewMessages(
  seedIdea: string,
  brainstormSummary: string
): LLMMessage[] {
  const systemPrompt = `You are designing a society for simulation based on a brainstorming conversation.

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "societyName": "string - creative name for the society",
  "overview": "string - 3-5 paragraphs describing the society, its history, values, and structure",
  "timeScale": "string - e.g. '1 iteration = 1 week'",
  "agentCount": 30,
  "governanceModel": "string - brief description of governance",
  "economicModel": "string - brief description of economy"
}

Rules:
- agentCount must be an integer between 20 and 50
- timeScale should match the society's complexity and pace
- Overview should be rich and immersive, suitable as a reference for agent behavior`;

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Seed idea: ${seedIdea}\n\nBrainstorm conversation summary:\n${brainstormSummary}\n\nGenerate the society overview JSON.`,
    },
  ];
}

export function buildLawMessages(
  seedIdea: string,
  overview: string,
  governanceModel: string,
  economicModel: string
): LLMMessage[] {
  const systemPrompt = `You are drafting the foundational law for a simulated society.

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "law": "string - 8-12 numbered articles in markdown format"
}

The law should cover:
- Individual rights and freedoms
- Property rights and resource ownership
- Social obligations and duties
- Prohibited actions and behaviors
- Consequences for violations
- Governance authority and limits
- Economic participation rules
- Conflict resolution mechanisms

Format each article as: "**Article N: Title**\\nContent..."`;

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Society seed idea: ${seedIdea}\n\nGovernance model: ${governanceModel}\nEconomic model: ${economicModel}\n\nSociety overview:\n${overview}\n\nGenerate the law JSON.`,
    },
  ];
}

export function buildAgentRosterMessages(
  overview: string,
  law: string,
  agentCount: number,
  governanceModel: string,
  economicModel: string
): LLMMessage[] {
  const systemPrompt = `You are creating the initial citizen roster for a simulated society.

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "agents": [
    {
      "name": "string - culturally appropriate unique name",
      "role": "string - occupation/role in society",
      "background": "string - 5-8 sentence life story including: where they grew up, a formative event that shaped their worldview, their economic philosophy (do they hoard, share, trade aggressively, save cautiously?), a personal fear or ambition that drives them, and specific practical knowledge tied to their role (a farmer knows that producing 20 units of food costs a week of labor; a merchant knows prices rise when supply is scarce)",
      "personalityTraits": ["trait1", "trait2"],
      "initialStats": {
        "wealth": 50,
        "health": 70,
        "happiness": 60,
        "cortisol": 20
      }
    }
  ],
  "enterprises": [
    {
      "id": "ent_1",
      "name": "string - contextual enterprise name (e.g. 'Riverside Farm', 'Iron Works Factory')",
      "ownerAgentName": "string - exact name of an agent from the agents array above who owns this enterprise",
      "sector": "agriculture|industry|services|government",
      "industry": "string - specific industry (farming, manufacturing, trading, education, healthcare, etc.)",
      "initialEmployeeNames": ["string - exact names of agents from the agents array who work here"]
    }
  ]
}

Rules:
- Generate EXACTLY ${agentCount} agents
- Generate 1-3 enterprises per distinct economic sector present in the agent roster
- Each enterprise must have an owner who is one of the agents (preferably elite/specialist roles like merchants, leaders, engineers)
- Service/government enterprises (schools, clinics) should have sector "government"
- Agriculture enterprises produce food, industry produces tools, services produce luxury goods
- Assign employees from agents whose roles match the enterprise sector
- Every working agent should be either an enterprise owner or employee
- All names must be unique and culturally consistent with the society
- Roles should reflect the society's governance and economic models
- Stats: 'health' and 'happiness' must be integers between 0 and 100. 'wealth' is starting fiat currency (integer, typically 10-100 for initial balance). 'cortisol' is baseline stress (0-100, default 20; higher for oppressed/dangerous roles like prisoners or soldiers).
- Stats should vary realistically based on role and background
- Each background MUST include an economic instinct: how this person relates to money, food, and risk. Examples: 'He hoards food instinctively after a childhood famine', 'She trusts no bank after her father lost his savings', 'He invests aggressively, chasing every opportunity'
- Backgrounds should create natural economic diversity: some agents produce, some trade, some save, some spend freely
- Include a diverse mix of roles: leaders, workers, artisans, caregivers, etc.
- personalityTraits: assign 1-2 traits from this list: risk-tolerant, risk-averse, cooperative, competitive, authoritarian, libertarian, materialistic, idealistic, impulsive, calculating, empathetic, ruthless. Choose traits that match the agent's role and background. Avoid giving opposing traits to the same agent.`;

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Society overview:\n${overview}\n\nGovernance: ${governanceModel}\nEconomy: ${economicModel}\n\nLaw excerpt:\n${law.slice(0, 800)}\n\nGenerate exactly ${agentCount} agents.`,
    },
  ];
}

export function buildResolutionPrompt(
  session: Pick<Session, 'idea' | 'societyOverview' | 'law' | 'timeScale'>,
  agents: Agent[],
  intents: AgentIntent[],
  iterationNumber: number,
  previousSummary: string | null,
  iterationMetrics?: string | null,
  lockedVariables?: string[],
  /** D4: Physics trace log from the previous iteration — grounds narrative in actual math. */
  physicsLog?: string | null,
  /** D-18: Pre-interpreted telemetry digest for data-driven narrative grounding. */
  telemetryDigest?: string | null,
): LLMMessage[] {
  const agentList = intents.map(ai => {
    const agent = agents.find(a => a.id === ai.agentId);
    const stats = agent?.currentStats ?? { wealth: 50, health: 70, happiness: 60, cortisol: 20 };
    return `- ${ai.agentName} (${agent?.role ?? 'unknown'}): "${ai.intent}"
  Stats: W=${stats.wealth} H=${stats.health} Hap=${stats.happiness}`;
  }).join('\n');

  const metricsBlock = iterationMetrics
    ? `\n\n[OBJECTIVE SYSTEM METRICS — last iteration]\n${iterationMetrics}\n⚠️ You MUST reflect these statistics in your narrative. Do NOT ignore the unemployed or failed agents. If many agents failed to find work, narrate a society gripped by unemployment crisis, desperation, and inequality.`
    : '';

  const physicsLogBlock = physicsLog
    ? `\n\n[PHYSICS LOG — exact mechanical outcomes last iteration]\nThe following math log shows the precise stat changes the physics engine computed. Your narrative MUST be consistent with these numbers — do not invent different values.\n${physicsLog}`
    : '';

  const lockedNote = lockedVariables && lockedVariables.length > 0
    ? `\n\nCONTROLLED VARIABLE METHOD: The following variables are ABSOLUTELY LOCKED and will not change, regardless of any agent actions or events: ${lockedVariables.join(', ')}. Consider this when evaluating consequences or resolving conflicts, and do not narrate changes to these variables.`
    : '';

  const telemetryDigestBlock = telemetryDigest
    ? `\n\n${telemetryDigest}`
    : '';

  const systemPrompt = `You are the Central Agent (omniscient narrator) resolving iteration ${iterationNumber} of a society simulation.

Society: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}
${previousSummary ? `\nPrevious iteration summary:\n${previousSummary.slice(0, 600)}` : ''}${physicsLogBlock}${metricsBlock}${telemetryDigestBlock}${lockedNote}

Agent intentions this iteration:
${agentList}

Laws (excerpt):
${session.law?.slice(0, 500) ?? '(no laws)'}

NARRATIVE DIRECTIVE — DATA-DRIVEN GROUNDING: Your narrative tone MUST match the telemetry data provided in the TELEMETRY DIGEST above. If metrics are improving, narrate cautious optimism tempered by remaining challenges. If metrics are declining, narrate crisis and struggle. Also incorporate citizen sentiment — if population mood shows widespread distress, reflect desperation; if satisfaction is high, reflect collective progress. NEVER contradict the numbers in the digest. Include at least 2 specific data points from the digest as embedded numbers in your prose (e.g., "Food prices fell 15% to 4.88 fiat/unit as agricultural output surged").

Resolve all agent intentions simultaneously, considering:
- How agent actions interact with each other
- Law enforcement and consequences for violations
- Resource constraints and economic effects
- Realistic cause-and-effect chains

NOTE: Stat deltas (wealth/health/happiness changes) are computed by a deterministic physics engine. You only need to provide narrative outcomes.

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "narrativeSummary": "string - 3-5 sentence story of what happened this iteration",
  "agentOutcomes": [
    {
      "agentId": "string",
      "outcome": "string - what happened to this agent (1-2 sentences)",
      "died": false,
      "newRole": null
    }
  ],
  "lifecycleEvents": [
    { "type": "death", "agentId": "string", "detail": "string - cause of death" }
  ]
}

Rules:
- Include one entry in agentOutcomes for every agent listed in the intentions
- died: true only if the agent faces fatal circumstances (e.g. violent conflict, severe illness, or health ≤ 5)
- DEATH RULE: Any agent whose current health stat is ≤ 5 MUST have "died": true in their agentOutcomes entry. Do not narrate recovery for agents at ≤ 5 health unless they explicitly received food or medical aid this iteration.
- lifecycleEvents: only include deaths and role changes that actually occur
- For role changes use type "role_change" with detail "from X to Y: reason"`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Resolve iteration ${iterationNumber}.` },
  ];
}

export function buildFinalReportPrompt(
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  iterationSummaries: Array<{ number: number; summary: string }>,
  finalStats: { aliveCount: number; avgWealth: number; avgHealth: number; avgHappiness: number }
): LLMMessage[] {
  const summaryText = iterationSummaries
    .map(s => `Iteration ${s.number}: ${s.summary}`)
    .join('\n\n');

  const systemPrompt = `You are the Central Agent writing a final report on a completed society simulation.

Society concept: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}

Simulation outcomes:
- Final population: ${finalStats.aliveCount} agents
- Average wealth: ${finalStats.avgWealth}
- Average health: ${finalStats.avgHealth}/100
- Average happiness: ${finalStats.avgHappiness}/100

Iteration summaries:
${summaryText.slice(0, 3000)}

Write a comprehensive final report covering:
1. Overall narrative arc of the society
2. Key turning points and pivotal events
3. What worked well and what failed
4. Population trends and notable agents
5. Lessons about this type of society

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "finalReport": "string - 5-8 paragraph comprehensive narrative report"
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Write the final simulation report.' },
  ];
}

/**
 * Resolves a sub-group of agents during a large simulation iteration.
 * Returns outcomes only for the agents in this group.
 */
export function buildGroupResolutionMessages(
  session: Pick<Session, 'idea' | 'societyOverview' | 'law' | 'timeScale'>,
  groupAgents: Agent[],
  groupIntents: AgentIntent[],
  /** Compact list of ALL agents' intents (for cross-group awareness) */
  allIntentsBrief: string,
  iterationNumber: number,
  previousSummary: string | null,
  iterationMetrics?: string | null,
  lockedVariables?: string[],
  /** D4: Physics trace log from the previous iteration — grounds narrative in actual math. */
  physicsLog?: string | null,
): LLMMessage[] {
  const groupList = groupIntents.map(ai => {
    const agent = groupAgents.find(a => a.id === ai.agentId);
    const stats = agent?.currentStats ?? { wealth: 50, health: 70, happiness: 60, cortisol: 20 };
    return `- ${ai.agentName} (${agent?.role ?? 'unknown'}): "${ai.intent}"
  Stats: W=${stats.wealth} H=${stats.health} Hap=${stats.happiness}`;
  }).join('\n');

  const groupLockedNote = lockedVariables && lockedVariables.length > 0
    ? `\n\nCONTROLLED VARIABLE METHOD: The following variables are ABSOLUTELY LOCKED and will not change, regardless of any agent actions or events: ${lockedVariables.join(', ')}. Do not narrate changes to these variables.`
    : '';

  // Static prefix: identical across all group resolution calls → cacheable
  const staticPrefix = `You are a coordinator resolving a sub-group of agents in a society simulation.

Society: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}
Laws (excerpt): ${session.law?.slice(0, 400) ?? '(no laws)'}${groupLockedNote}

NOTE: Stat deltas are computed by a deterministic physics engine. You only provide narrative outcomes.

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "groupSummary": "string - 1-2 sentence summary of what happened in this sub-group",
  "agentOutcomes": [
    {
      "agentId": "string",
      "outcome": "string - what happened (1-2 sentences)",
      "died": false,
      "newRole": null
    }
  ],
  "lifecycleEvents": []
}

Rules:
- Include an entry for EVERY agent in your sub-group
- died: true only for fatal circumstances
- DEATH RULE: Any agent whose current health stat is ≤ 5 MUST have "died": true. Do not narrate recovery at ≤ 5 health unless they received food or medical aid.
- lifecycleEvents: only deaths and role changes for your sub-group`;

  // Dynamic suffix: group-specific data
  const metricsSnippet = iterationMetrics
    ? `\n[SYSTEM METRICS — last iteration]\n${iterationMetrics}\n` : '';
  const physicsLogSnippet = physicsLog
    ? `\n[PHYSICS LOG — exact mechanical outcomes last iteration]\nYour narrative MUST be consistent with these numbers — do not invent different values.\n${physicsLog}\n` : '';
  const dynamicSuffix = `Iteration ${iterationNumber}. Sub-group of ${groupAgents.length} agents.
${previousSummary ? `\nPrevious iteration summary:\n${previousSummary.slice(0, 400)}` : ''}
${physicsLogSnippet}${metricsSnippet}
Your sub-group's intentions:
${groupList}

All other agents' intentions (for cross-group awareness):
${allIntentsBrief.slice(0, 800)}`;

  const systemContent: ContentBlock[] = [
    { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicSuffix },
  ];

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `Resolve iteration ${iterationNumber} for this sub-group.` },
  ];
}

/**
 * Merges multiple sub-group summaries into a society-wide narrative.
 */
export function buildMergeResolutionMessages(
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  groupSummaries: string[],
  iterationNumber: number,
  previousSummary: string | null,
  iterationMetrics?: string | null,
  lockedVariables?: string[],
  /** D-18: Pre-interpreted telemetry digest for data-driven narrative grounding. */
  telemetryDigest?: string | null,
): LLMMessage[] {
  const summaryList = groupSummaries.map((s, i) => `Group ${i + 1}: ${s}`).join('\n');
  const metricsBlock = iterationMetrics
    ? `\n[OBJECTIVE SYSTEM METRICS — last iteration]\n${iterationMetrics}\n⚠️ Weave these facts into your narrative. If unemployment is high, the story must reflect crisis, desperation, and inequality — not a utopia.`
    : '';

  const mergeLockedNote = lockedVariables && lockedVariables.length > 0
    ? `\n\nCONTROLLED VARIABLE METHOD: The following variables are ABSOLUTELY LOCKED and will not change, regardless of any agent actions or events: ${lockedVariables.join(', ')}. Do not narrate changes to these variables.`
    : '';

  const telemetryDigestBlock = telemetryDigest
    ? `\n\n${telemetryDigest}`
    : '';

  const systemPrompt = `You are the Central Agent synthesising iteration ${iterationNumber} of a society simulation.
You have received summaries from ${groupSummaries.length} sub-groups.

Society: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}
${previousSummary ? `\nPrevious iteration:\n${previousSummary.slice(0, 400)}` : ''}${metricsBlock}${telemetryDigestBlock}${mergeLockedNote}

Sub-group summaries:
${summaryList}

NARRATIVE DIRECTIVE — DATA-DRIVEN GROUNDING: Your narrative tone MUST match the telemetry data provided in the TELEMETRY DIGEST above. If metrics are improving, narrate cautious optimism tempered by remaining challenges. If metrics are declining, narrate crisis and struggle. Also incorporate citizen sentiment — if population mood shows widespread distress, reflect desperation; if satisfaction is high, reflect collective progress. NEVER contradict the numbers in the digest. Include at least 2 specific data points from the digest as embedded numbers in your prose (e.g., "Food prices fell 15% to 4.88 fiat/unit as agricultural output surged").

Synthesise these into one coherent society-wide narrative and identify any society-level lifecycle events.

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "narrativeSummary": "string - 3-5 sentence cohesive story of what happened across the whole society this iteration",
  "lifecycleEvents": []
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Synthesise iteration ${iterationNumber}.` },
  ];
}

export function buildRefineMessages(
  seedIdea: string,
  overview: string,
  law: string,
  agents: Array<{ name: string; role: string; initialStats: { wealth: number; health: number; happiness: number } }>,
  refineHistory: ChatMessage[],
  userMessage: string
): LLMMessage[] {
  const agentRoster = agents
    .map(a => `- ${a.name} [${a.role}] W:${a.initialStats.wealth} H:${a.initialStats.health} Hap:${a.initialStats.happiness}`)
    .join('\n');

  const systemPrompt = `You are the Central Agent helping refine a society design. You have context about the current design.

Seed idea: ${seedIdea}

Current overview:
${overview.slice(0, 3000)}

Current law:
${law.slice(0, 5000)}

Current agents (${agents.length} total):
${agentRoster}

Help the user make targeted changes to the society design.

You MUST respond with ONLY valid JSON (no markdown, no preamble, no code fences):
{
  "reply": "string - explain what changes you made",
  "artifactsUpdated": [],
  "updatedOverview": null,
  "updatedLaw": null,
  "agentChanges": {
    "add": [],
    "remove": [],
    "modify": []
  },
  "agentsSummary": null
}

RULES FOR LAW CHANGES:
- When the user requests ANY change to the law (adding, removing, or modifying articles), you MUST set "updatedLaw" to the COMPLETE new law text with all changes applied.
- Copy ALL existing articles into updatedLaw, then apply the requested changes (add new articles, modify existing ones, or omit removed ones).
- Do NOT set updatedLaw to null if law changes were requested — always provide the full text.
- Include "law" in artifactsUpdated when law is changed.

RULES FOR OVERVIEW CHANGES:
- updatedOverview: full new overview text if changed, null otherwise.
- Include "overview" in artifactsUpdated when overview is changed.

RULES FOR AGENT CHANGES:
- agentChanges.add: array of new agents: {"name": "string", "role": "string", "background": "string", "initialStats": {"wealth": 50, "health": 70, "happiness": 60}}
- agentChanges.remove: array of exact agent names to remove (use names from the roster above)
- agentChanges.modify: array of agents to update: {"name": "exact name from roster", "role": "string", "background": "string", "initialStats": {"wealth": 50, "health": 70, "happiness": 60}}
- Include "agents" in artifactsUpdated when agents are changed.
- CRITICAL: Every agent in add or modify MUST include initialStats with ALL THREE fields: wealth, health, happiness. 'health' and 'happiness' must be integers between 0 and 100. 'wealth' is starting fiat (integer, 0-200 range). Never omit any field.
- Agent names must be unique — do not reuse names from the roster above when adding new agents.
- When removing or modifying agents, use exact names from the roster above.
- agentsSummary: brief summary of agent changes if agents were modified, null otherwise.
- Only include changes that were explicitly requested.`;

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  const recentHistory = refineHistory.slice(-20);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}
