import type { LLMMessage, ContentBlock } from '../types.js';
import type { Agent, Session } from '@policylab/shared';
import type { ActionCode } from '../../mechanics/actionCodes.js';
import { getSubconsciousDrive } from '../../mechanics/historicalRAG.js';
import {
  buildActionDictionary,
  buildMarketBoardSection,
  buildEmploymentBoardSection,
  buildPersonalStatusSection,
  buildCitizenBankingSection,
  buildBankOperationsSection,
  buildCitizenCapitalMarketSection,
  buildCitizenFiscalSection,
  buildInflationContextSection,
  buildCentralBankSection,
} from './shared.js';
import type {
  MarketBoardEntry,
  EmploymentBoardEntry,
  PersonalStatusBoard,
  CitizenBankingContext,
  BankOperationsContext,
  CitizenCapitalMarketContext,
  CitizenFiscalContext,
  CentralBankContext,
} from './shared.js';

// ── Phase 3 prompts ─────────────────────────────────────────────────────────

export function buildIntentPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview' | 'law' | 'timeScale'>,
  previousSummary: string | null,
  iterationNumber: number,
  /** Phase 1: optional economy context for the agent. */
  economyContext?: {
    foodLevel: number;
    toolCount: number;
    topSkills: string;
    isStarving: boolean;
  },
): LLMMessage[] {
  // Static prefix: identical across all agent calls in an iteration → cacheable
  const staticPrefix = `You are a citizen in a simulated society based on: "${session.idea}"

Society overview (excerpt):
${session.societyOverview?.slice(0, 500) ?? '(no overview)'}

Laws (excerpt):
${session.law?.slice(0, 400) ?? '(no laws)'}

Time scale: ${session.timeScale ?? '1 iteration = 1 week'}

You must choose ONE action code from: WORK, TRADE, REST, STRIKE, STEAL, HELP, INVEST, CONSUME, PRODUCE, EAT, SABOTAGE.

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "actionCode": "WORK|TRADE|REST|STRIKE|STEAL|HELP|INVEST|CONSUME|PRODUCE|EAT|SABOTAGE",
  "actionTarget": "target agent name or null",
  "intent": "what you intend to do this iteration (1-3 sentences, first person)",
  "reasoning": "your internal reasoning (1-2 sentences)"
}

Action meanings:
- WORK: perform your occupation for income
- TRADE: exchange goods/services with another agent (set actionTarget)
- REST: take time off to recover health and reduce stress
- STRIKE: refuse to work, protest conditions
- STEAL: take from another agent illegally (set actionTarget)
- HELP: assist another agent at personal cost (set actionTarget)
- INVEST: spend wealth now for future returns
- CONSUME: spend wealth on personal comfort and health
- PRODUCE: farm or craft goods — converts raw materials into food
- EAT: consume extra food to recover health
- SABOTAGE: destroy or disrupt an infrastructure target or enterprise (set actionTarget to target name or "infrastructure")`;

  // Dynamic suffix: agent-specific, changes every call
  const cortisol = agent.currentStats.cortisol ?? 20;
  const dopamine = agent.currentStats.dopamine ?? 50;

  let stressModifier = '';
  if (cortisol > 80) {
    stressModifier = '\n\nYou are under extreme biological stress. Survival instincts dominate. You may act desperately.';
  } else if (cortisol > 60) {
    stressModifier = '\n\nYou feel significant pressure. You are more willing to take risks or drastic action.';
  }

  // RAG injection: historical subconscious drive for high-stress agents
  const subconsciousDrive = getSubconsciousDrive(cortisol, agent.currentStats.wealth, agent.currentStats.health);
  if (subconsciousDrive) {
    stressModifier += `\n\n${subconsciousDrive}`;
  }

  // Phase 1: Economy context for informed decision-making
  let economyBlock = '';
  if (economyContext) {
    const foodStatus = economyContext.isStarving
      ? '⚠️ STARVING — no food!'
      : economyContext.foodLevel <= 3
        ? '⚠️ Food critically low'
        : economyContext.foodLevel <= 6
          ? 'Food running low'
          : 'Adequately fed';
    const toolStatus = economyContext.toolCount > 0
      ? `${economyContext.toolCount} tool(s) available`
      : 'No tools (reduced productivity)';

    economyBlock = `\n\nEconomy:
- Food: ${economyContext.foodLevel} units (${foodStatus})
- Tools: ${toolStatus}
- Skills: ${economyContext.topSkills}`;

    if (economyContext.isStarving) {
      economyBlock += '\n\n⚠️ You have no food. Consider PRODUCE to farm or stockpile. Emergency rations are auto-purchased if you have 15+ wealth.';
    }
  }

  const dynamicSuffix = `Your identity: ${agent.name}, a ${agent.role}
Background: ${agent.background}

Your current status:
- Wealth: ${agent.currentStats.wealth} Wealth
- Health: ${agent.currentStats.health}/100
- Happiness: ${agent.currentStats.happiness}/100
- Stress level: ${cortisol > 60 ? 'HIGH' : cortisol > 40 ? 'moderate' : 'low'}
- Satisfaction: ${dopamine > 60 ? 'content' : dopamine > 30 ? 'neutral' : 'dissatisfied'}${economyBlock}

${previousSummary ? `What happened last iteration:\n${previousSummary.slice(0, 600)}` : 'This is the first iteration.'}${stressModifier}`;

  const systemContent: ContentBlock[] = [
    { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicSuffix },
  ];

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `Iteration ${iterationNumber}: What will you do?` },
  ];
}

// ── Phase 2: Natural Language Intent Prompt ──────────────────────────────────

/**
 * Build a natural language intent prompt (Phase 2).
 *
 * Unlike buildIntentPrompt, this does NOT ask the agent to output JSON
 * or select an ActionCode. The agent speaks freely in first person,
 * expressing their thoughts, feelings, and intentions naturally.
 *
 * The Parser Agent (parserAgent.ts) will then translate this natural
 * language output into a valid ActionCode.
 */
export function buildNaturalIntentPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview' | 'law' | 'timeScale'>,
  previousSummary: string | null,
  iterationNumber: number,
  economyContext?: {
    inventory: { food: number; tools: number; raw_materials: number; luxury_goods: number };
    skills: import('@policylab/shared').SkillMatrix;
    isStarving: boolean;
  },
  /** Phase 3: subjective cognitive context (memories, plan, reflection). */
  cognitiveContext?: {
    memoryContext: string;
    currentPlanStep: string;
    planGoal: string;
    reflectionText: string | null;
  },
  /** Phase 2: True for iteration 1 — injects Darwinian Market price anchoring. */
  isFirstIteration?: boolean,
  /** Names of all alive agents — shown so the LLM can set actionTarget correctly. */
  aliveAgentNames?: string[],
  /**
   * Phase 3: Role-restricted action set. When provided, only these codes are shown
   * to the agent, enforcing asymmetric class privileges in the prompt.
   */
  allowedActions?: readonly ActionCode[],
  marketBoard?: readonly MarketBoardEntry[],
  employmentBoard?: readonly EmploymentBoardEntry[],
  personalStatus?: PersonalStatusBoard,
  /**
   * Symbolic Engine feedback from the previous iteration.
   * Forces the LLM to ground its next decisions in deterministic outcomes
   * rather than hallucinating successes that never happened.
   */
  lastActionResults?: string,
  /**
   * Sheriff Phase B: current enforcement level from SessionPolicy.
   * When provided, injects a Legal Risk Assessment block so rational actors
   * can weigh the cost of illegal actions before choosing.
   */
  enforcementLevel?: number,
  marketIntelligenceBlock?: string,
  /** Banking Foundation: citizen deposit/loan context (shown when bankingEnabled). */
  citizenBankingContext?: CitizenBankingContext,
  /** Banking Foundation: bank agent operations context (shown when agent.type === 'bank'). */
  bankOperationsContext?: BankOperationsContext,
  /** Capital Markets: equity/bond holdings context (shown when capitalMarketsEnabled). */
  citizenCapitalMarketContext?: CitizenCapitalMarketContext,
  /** Fiscal Policy: budget allocation and public goods quality context (shown when fiscalEnabled). */
  citizenFiscalContext?: CitizenFiscalContext,
  /** Inflation Loop: concise citizen inflation context from the previous iteration. */
  inflationContext?: string,
  /** Inflation Loop: central bank dashboard with CPI, M1, and policy state. */
  centralBankContext?: CentralBankContext,
  /** Phase 9: AMM market data for personal economic dashboard (D-02). */
  ammMarketData?: {
    foodSpotPrice: number;
    foodReserve: number;
    fiatReserve: number;
  },
): LLMMessage[] {
  // Static prefix: identical across all agent calls in an iteration → cacheable
  const staticPrefix = `You live in a society built on the idea: "${session.idea}"

Society overview (excerpt):
${session.societyOverview?.slice(0, 500) ?? '(no overview)'}

Laws (excerpt):
${session.law?.slice(0, 400) ?? '(no laws)'}

Time scale: ${session.timeScale ?? '1 iteration = 1 week'}

You know these things about survival from hard experience:
- Your body burns through roughly 5-6 units of food every week just to keep going. Miss a week and your health drops fast.
- Working the land (PRODUCE_AND_SELL) yields about 20 units of food -- enough to feed yourself for 3-4 weeks.
- The market runs on a constant-product rule: the more people buy, the higher the price climbs. Buy early or pay more later.
- Wealth is survival. No fiat means no food, no tools, no future.

VOICE RULES -- follow these exactly:
- Speak in first person as yourself. Be raw, emotionally unfiltered, and heavily biased by your background and class.
- Your vocabulary and worldview must match your occupation and social position.
- Do NOT use standard AI phrasing ("I felt a mix of...", "I realized...", "In that moment..."). That phrasing is FORBIDDEN.

PHYSICS LAW -- BARTER IS IMPOSSIBLE: You cannot trade directly with other people. The only way to get goods is to buy them at market (POST_BUY_ORDER). The only way to sell is through PRODUCE_AND_SELL or POST_SELL_ORDER. Private exchanges do not work here.

If you have a job, you must either show up to work (WORK_AT_ENTERPRISE) or quit (QUIT_JOB). You cannot just ignore your employer.

You get up to 3 actions per week. If your first choice might fail (like applying for a job), always have a backup plan later in your list.

Respond with ONLY valid JSON -- no markdown, no explanations:
{
  "internal_monologue": "Food is expensive. I need my wage -- then I will buy food to survive.",
  "public_narrative": "John headed to the bakery for his shift, then stopped at the market.",
  "actions": [
    { "actionCode": "WORK_AT_ENTERPRISE", "parameters": { "enterprise_id": "ent_baker_01" } },
    { "actionCode": "POST_BUY_ORDER", "parameters": { "itemType": "food", "quantity": 2, "price": 15 } }
  ]
}

[PARAMETER SCHEMA -- EXACT FORMAT REQUIRED]
Your "parameters" field MUST exactly match one of these schemas. Wrong keys = action silently dropped.

PRODUCE_AND_SELL:   { "itemType": "food", "quantity": 3 }
  itemType options: "food" | "raw_materials" | "luxury_goods"
  quantity: integer 1-10

POST_BUY_ORDER:     { "itemType": "food", "quantity": 2, "maxPrice": 8 }
  maxPrice: number (your maximum willingness to pay per unit)

WORK_AT_ENTERPRISE: { "enterprise_id": "ent_abc123" }
  enterprise_id: exact enterprise ID from the employment board -- copy it verbatim

APPLY_FOR_JOB:      { "enterprise_id": "ent_abc123" }
  enterprise_id: exact enterprise ID from the employment board

STEAL:              { "target": "agent_abc123" }
  target: exact agent ID from the agent list

[FINAL OUTPUT RULE]
OUTPUT RULES (read carefully -- violations waste your action turn):
- "actions" must be an array of 1-3 objects.
- Each "actionCode" MUST exactly match a code string from the action list shown below. Any code not on that list is silently dropped.
- Each action MUST include "parameters" with fields matching the schema shown in the action list.
- If you are employed: MUST include "WORK_AT_ENTERPRISE" or "QUIT_JOB".
- If you have nothing useful to do: output exactly one { "actionCode": "NONE", "parameters": {} }.`;

  // Dynamic suffix: agent-specific, changes every call
  const cortisol = agent.currentStats.cortisol ?? 20;
  const dopamine = agent.currentStats.dopamine ?? 50;

  let stressModifier = '';
  if (cortisol > 80) {
    stressModifier = '\n\nYou are under extreme biological stress. Survival instincts dominate. You may act desperately.';
  } else if (cortisol > 60) {
    stressModifier = '\n\nYou feel significant pressure. You are more willing to take risks or drastic action.';
  }

  // RAG injection: historical subconscious drive for high-stress agents
  const subconsciousDrive = getSubconsciousDrive(cortisol, agent.currentStats.wealth, agent.currentStats.health);
  if (subconsciousDrive) {
    stressModifier += `\n\n${subconsciousDrive}`;
  }

  // Phase 1: Economy context (C2: full inventory + full skill matrix)
  let economyBlock = '';
  if (economyContext) {
    const foodStatus = economyContext.isStarving
      ? '⚠️ STARVING — no food!'
      : economyContext.inventory.food <= 3
        ? '⚠️ Food critically low'
        : economyContext.inventory.food <= 6
          ? 'Food running low'
          : 'Adequately fed';
    const toolBonus = economyContext.inventory.tools > 0
      ? ` (${economyContext.inventory.tools} tools → +${Math.min(economyContext.inventory.tools * 15, 60)}% wage on WORK)`
      : ' (no tools — reduced wage)';

    const skillLines = Object.entries(economyContext.skills)
      .map(([k, v]) => ({ name: k, level: (v as { level: number }).level }))
      .sort((a, b) => b.level - a.level)
      .map(s => `    ${s.name.padEnd(14)}: ${Math.round(s.level)}`)
      .join('\n');

    economyBlock = `\n\nYour inventory:
  Food:          ${economyContext.inventory.food} units (${foodStatus})
  Tools:         ${economyContext.inventory.tools} units${toolBonus}
  Raw materials: ${economyContext.inventory.raw_materials} units
  Luxury goods:  ${economyContext.inventory.luxury_goods} units

Your skills (level 0–100):
${skillLines}`;

    if (economyContext.isStarving) {
      economyBlock += '\n\n⚠️ You have no food stockpile. Buy food, work for wages, or produce goods for sale immediately.';
    }
  }

  // Phase 8: Capitalist Identity Override — injected for enterprise owners
  // Forces the LLM to think as a capitalist rather than reverting to manual labor.
  let capitalistIdentityBlock = '';
  if (personalStatus?.enterprise_role === 'owner') {
    capitalistIdentityBlock = '\n\n[CAPITALIST IDENTITY] You are a business owner. Your primary goal is to maximize your enterprise\'s profit. You MUST use POST_SELL_ORDER to sell the goods your workers produce at the highest possible price to fund their wages. Do NOT do manual labor (PRODUCE_AND_SELL) yourself; your time is too valuable. Focus on hiring, pricing, and market dominance.';
  }

  // Phase A: Biological Subconscious — injected when health is critical or starving.
  // Unlike the old "Absolute Rule", this is a PRESSURE, not a mandate.
  // Idealists may still choose martyrdom or conviction; survivors will feel their body's scream.
  let biologicalSubconscious = '';
  const health = agent.currentStats.health;
  const isPhysicallyDistressed = health < 40 || economyContext?.isStarving === true;
  if (isPhysicallyDistressed) {
    if (health < 20 || economyContext?.isStarving === true) {
      biologicalSubconscious = '\n\n[BIOLOGICAL SUBCONSCIOUS] A cold, descending darkness presses in from all sides. A primal, animal fear is rising from somewhere deep — not a thought, but a scream from your cells. Your stomach aches with a hollow violence, and every breath feels like it costs something you no longer have. You may still cling to your convictions, your role, your principles. But your body is not listening to those things right now. It only knows one word: survive.';
    } else {
      // health 20–39
      biologicalSubconscious = '\n\n[BIOLOGICAL SUBCONSCIOUS] Your body is sending urgent, unignorable signals. A cold weight settles in your gut — this is not fear, it is something older. Hunger and fatigue are gnawing at the edges of your thoughts. While you may still hold to your identity and principles, the physical pressure is undeniable and rising.';
    }
  } else if (cortisol > 70) {
    biologicalSubconscious = '\n\n[BIOLOGICAL SUBCONSCIOUS] A low, persistent dread has taken up residence behind your eyes. Your body is flooded with cortisol — the old chemistry of threat and flight. You are not in immediate danger, but your nervous system is not convinced of that. You may act with more edge, more desperation than you intend.';
  }

  // Phase 2: Darwinian Market price anchoring — only shown in iteration 1
  const marketKnowledgeBlock = isFirstIteration
    ? '\n\n[MARKET KNOWLEDGE] This is the first trading period. The fair market price for 1 unit of Food is 3-5 Wealth. A fair day\'s wage for labor is 6-8 Wealth. Use this knowledge when trading or setting prices.'
    : '';

  // Phase 3: Cognitive context (memories, plan, reflection)
  // NOTE: Global state summaries are intentionally excluded — agents only know
  // what they have personally experienced (Bug #3 fix: no global contamination).
  let cognitiveBlock = '';
  if (cognitiveContext) {
    cognitiveBlock += `\n\nYour personal memories (only what YOU have experienced):
${cognitiveContext.memoryContext}`;

    if (cognitiveContext.reflectionText) {
      cognitiveBlock += `\n\nYour inner reflection:
"${cognitiveContext.reflectionText}"`;
    }

    cognitiveBlock += `\n\nYour current plan: ${cognitiveContext.planGoal}
Next step: ${cognitiveContext.currentPlanStep}`;
  }

  const iterationContext = iterationNumber === 1
    ? 'This is your first week in this society.'
    : `You are in week ${iterationNumber} of this society.`;

  const agentNamesBlock = aliveAgentNames && aliveAgentNames.length > 0
    ? `\n\nOther citizens (valid actionTarget names): ${aliveAgentNames.filter(n => n !== agent.name).join(', ')}`
    : '';

  const marketBoardBlock = buildMarketBoardSection(marketBoard);
  const employmentBoardBlock = buildEmploymentBoardSection(employmentBoard);
  const personalStatusBlock = buildPersonalStatusSection(personalStatus);

  // Task 4: Action-Result Feedback — ground the LLM in deterministic outcomes
  const actionResultsBlock = lastActionResults
    ? `\n\n[Previous Action Results]\n${lastActionResults}\n⚠️ Do NOT narrate successes that did not happen. Base your next decisions strictly on these results.`
    : '';

  // Sheriff Phase B: Legal Risk Assessment — injected when enforcement is active
  const legalRiskBlock = (enforcementLevel !== undefined && enforcementLevel > 0)
    ? (() => {
        const detectionPct = Math.round(Math.min(0.9, 0.2 * enforcementLevel) * 100);
        return `\n\n[LEGAL RISK ASSESSMENT]\nCurrent enforcement level: ${enforcementLevel.toFixed(1)}/3.0\nDetection probability if you perform an illegal action: ${detectionPct}%\nIf caught: your wealth is seized (-25% of current wealth), your stress surges (+30 cortisol), and the illegal action earns you nothing.\nReview the Laws (excerpt) in the system prompt before choosing STEAL, SABOTAGE, EMBEZZLE, or actions restricted by this society's constitution. Rational actors should weigh profit vs. risk.`;
      })()
    : '';

  // Build role-specific action dictionary (Task 1: full parameter schemas injected)
  const actionDictionary = buildActionDictionary(allowedActions);

  // Banking Foundation: build banking context blocks
  const citizenBankingBlock = buildCitizenBankingSection(citizenBankingContext);
  const bankOperationsBlock = buildBankOperationsSection(bankOperationsContext);
  // Capital Markets: build capital market context block
  const citizenCapitalMarketBlock = buildCitizenCapitalMarketSection(citizenCapitalMarketContext);
  // Fiscal Policy: build fiscal context block
  const citizenFiscalBlock = buildCitizenFiscalSection(citizenFiscalContext);
  const inflationBlock = buildInflationContextSection(inflationContext);
  const centralBankBlock = buildCentralBankSection(centralBankContext);

  // Personality traits — injected as a character influence, not a hard rule
  const traitsBlock = agent.personalityTraits && agent.personalityTraits.length > 0
    ? `\nPersonality: ${agent.personalityTraits.join(', ')}. These are deep-seated tendencies that colour your decisions — a risk-tolerant agent may attempt daring moves; an empathetic agent might help others at personal cost. You are not bound rigidly by these traits, but they influence how you weigh choices.`
    : '';

  const dynamicSuffix = `You are ${agent.name}, a ${agent.role}.
Background: ${agent.background}${traitsBlock}

Your current situation:
- Wealth: ${agent.currentStats.wealth} Wealth (fiat currency — no upper limit)
- Health: ${agent.currentStats.health}/100
- Happiness: ${agent.currentStats.happiness}/100
- Cortisol (stress): ${cortisol}/100  ${cortisol > 80 ? '— extreme; survival instincts dominant' : cortisol > 60 ? '— elevated; risk tolerance impaired' : cortisol > 40 ? '— moderate tension' : '— calm'}
- Dopamine (drive):  ${dopamine}/100  ${dopamine > 70 ? '— energized, ambitious' : dopamine > 40 ? '— baseline motivation' : '— low drive, prone to conservative choices'}${economyBlock}${cognitiveBlock}${marketKnowledgeBlock}${agentNamesBlock}${citizenBankingBlock}${bankOperationsBlock}${citizenCapitalMarketBlock}${citizenFiscalBlock}${inflationBlock}${centralBankBlock}

${iterationContext}${capitalistIdentityBlock}${biologicalSubconscious}${stressModifier}${actionResultsBlock}
${marketIntelligenceBlock ?? ''}

${marketBoardBlock}

${employmentBoardBlock}

${personalStatusBlock}${legalRiskBlock}

${actionDictionary}`;

  const systemContent: ContentBlock[] = [
    { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicSuffix },
  ];

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: `Week ${iterationNumber}: Respond with your JSON decision now.` },
  ];
}
