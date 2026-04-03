import type { LLMMessage, ContentBlock } from './types.js';
import type {
  Agent,
  ChatMessage,
  Session,
  ComparisonResult,
  BrainstormChecklist,
  SessionPolicy,
  LocationProfile,
  EconomyConfig,
} from '@policylab/shared';
import type { ActionCode } from '../mechanics/actionCodes.js';
import type { AgentBlueprint } from '../data/dataBootstrapPipeline.js';
import { getSubconsciousDrive } from '../mechanics/historicalRAG.js';

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
      "background": "string - 1-2 sentence background",
      "personalityTraits": ["trait1", "trait2"],
      "initialStats": {
        "wealth": 50,
        "health": 70,
        "happiness": 60,
        "cortisol": 20,
        "dopamine": 50
      }
    }
  ]
}

Rules:
- Generate EXACTLY ${agentCount} agents
- All names must be unique and culturally consistent with the society
- Roles should reflect the society's governance and economic models
- Stats: 'health' and 'happiness' must be integers between 0 and 100. 'wealth' is starting fiat currency (integer, typically 10-100 for initial balance). 'cortisol' is baseline stress (0-100, default 20; higher for oppressed/dangerous roles like prisoners or soldiers). 'dopamine' is baseline satisfaction (0-100, default 50; higher for privileged/creative roles, lower for exploited roles).
- Stats should vary realistically based on role and background
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
/**
 * Rich action schema injected into citizen prompts.
 * Each entry defines the exact actionCode string, a description, and the
 * required JSON parameters — eliminating "action space blindness".
 * NOTE: EAT and CONSUME are intentionally excluded — survival metabolism is automatic.
 */
interface ActionSchema {
  description: string;
  /** Example params object shown verbatim in the prompt. */
  params: string;
}

const ACTION_SCHEMAS: Partial<Record<ActionCode, ActionSchema>> = {
  REST: {
    description: 'Rest for the week — recover health, reduce stress.',
    params: '{}',
  },
  PRODUCE_AND_SELL: {
    description: 'Produce goods and sell to the Global Market AMM for immediate fiat. No buyer needed.',
    params: '{ "itemType": "food" | "raw_materials" | "luxury_goods", "quantity": number, "price": number }',
  },
  POST_BUY_ORDER: {
    description: 'Buy goods from the Global Market AMM. Trade executes immediately.',
    params: '{ "itemType": "food" | "raw_materials" | "luxury_goods" | "tools", "quantity": number, "price": number }',
  },
  POST_SELL_ORDER: {
    description: 'Sell goods on the Global Market.',
    params: '{ "itemType": "food" | "raw_materials" | "luxury_goods" | "tools", "quantity": number, "price": number }',
  },
  WORK_AT_ENTERPRISE: {
    description: 'Work your shift at your current employer and collect your wage.',
    params: '{ "enterprise_id": string }',
  },
  APPLY_FOR_JOB: {
    description: 'Apply to an enterprise on the Employment Board.',
    params: '{ "enterprise_id": string }',
  },
  QUIT_JOB: {
    description: 'Resign from your current employer immediately.',
    params: '{ "enterprise_id": string }',
  },
  FOUND_ENTERPRISE: {
    description: 'Start a new private enterprise (costs 40 Wealth upfront). Hire workers, set wages, and keep all profits.',
    params: '{ "industry": "food" | "raw_materials" | "luxury_goods" | "manufacturing" | "services" }',
  },
  POST_JOB_OFFER: {
    description: 'Publish a job opening at your enterprise.',
    params: '{ "enterprise_id": string, "wage": number, "min_skill": number }',
  },
  HIRE_EMPLOYEE: {
    description: 'Accept an applicant into your enterprise.',
    params: '{ "agent_id": string }',
  },
  FIRE_EMPLOYEE: {
    description: 'Remove an employee from your enterprise.',
    params: '{ "agent_id": string }',
  },
  STEAL: {
    description: 'Attempt to steal wealth from another citizen (illegal — high stress, legal risk).',
    params: '{ "target": string }',
  },
  HELP: {
    description: 'Aid another citizen at personal wealth cost (+happiness, -cortisol).',
    params: '{ "target": string }',
  },
  INVEST: {
    description: 'Save or speculate for future returns (-10 Wealth now, possible future gain).',
    params: '{}',
  },
  STRIKE: {
    description: 'Refuse to work — collective protest or industrial action.',
    params: '{}',
  },
  SABOTAGE: {
    description: 'Disrupt another person\'s enterprise (dangerous — physical health risk).',
    params: '{ "target": string }',
  },
  EMBEZZLE: {
    description: '[ELITE PRIVILEGE ONLY] Skim funds from the communal treasury (+20 Wealth, extreme legal risk).',
    params: '{}',
  },
  ADJUST_TAX: {
    description: '[ELITE PRIVILEGE ONLY] Forcibly extract wealth from lower classes via tax policy.',
    params: '{}',
  },
  SUPPRESS: {
    description: '[ELITE PRIVILEGE ONLY] Deploy enforcement to penalise a specific citizen.',
    params: '{ "target": string }',
  },
  // Capital Markets actions
  BUY_SHARES: {
    description: 'Buy shares in an enterprise to receive dividends and capital gains. Specify the enterprise owner as target.',
    params: '{ "target": string, "quantity": number }',
  },
  SELL_SHARES: {
    description: 'Sell shares you hold in an enterprise back to the market. Specify the enterprise owner as target.',
    params: '{ "target": string, "quantity": number }',
  },
  BUY_BOND: {
    description: 'Buy a government or corporate bond for fixed coupon income. Use target "treasury" for gov bond or enterprise owner name for corp bond.',
    params: '{ "target": string, "amount": number }',
  },
  ISSUE_GOV_BOND: {
    description: '[ELITE PRIVILEGE ONLY] Issue government bonds to raise treasury funding. Sets face value via amount.',
    params: '{ "amount": number }',
  },
  // Banking Foundation actions
  DEPOSIT: {
    description: 'Move cash from your wallet into your bank deposit account for safe-keeping.',
    params: '{ "amount": number }',
  },
  WITHDRAW: {
    description: 'Move fiat from your bank deposit account back into your cash wallet.',
    params: '{ "amount": number }',
  },
  TAKE_LOAN: {
    description: 'Borrow fiat from the bank. Creates a deposit in your name (M1 expansion). Requires collateral.',
    params: '{ "principal": number }',
  },
  REPAY_LOAN: {
    description: 'Make a repayment on your outstanding loan. Reduces M1.',
    params: '{ "loan_id": string, "amount": number }',
  },
  ISSUE_LOAN: {
    description: '[BANK ONLY] Issue a loan to a requesting citizen. Must maintain reserve requirement.',
    params: '{ "borrower_id": string, "principal": number }',
  },
  SET_INTEREST_RATE: {
    description: '[BANK ONLY] Adjust the lending interest rate for new loans.',
    params: '{ "rate": number }',
  },
  NONE: {
    description: 'Do nothing useful this week (-1 Health, +2 Cortisol penalty).',
    params: '{}',
  },
};

/**
 * Build the [AVAILABLE ACTIONS] dictionary block injected into citizen prompts.
 * Filters to the role-allowed action set when provided.
 */
function buildActionDictionary(allowedActions?: readonly ActionCode[]): string {
  const codes = allowedActions ?? (Object.keys(ACTION_SCHEMAS) as ActionCode[]);
  const lines = [
    '[AVAILABLE ACTIONS]',
    'You can ONLY choose up to 3 actions per week from this exact list.',
    'Hallucinated codes not on this list are silently dropped — wasting your turn.',
    '',
  ];
  let idx = 1;
  for (const code of codes) {
    const schema = ACTION_SCHEMAS[code];
    if (!schema) continue;
    lines.push(`${idx}. "${code}"`);
    lines.push(`   ${schema.description}`);
    lines.push(`   Params: ${schema.params}`);
    idx++;
  }
  return lines.join('\n');
}

export interface QueuedActionInstruction {
  actionCode: ActionCode;
  parameters: Record<string, unknown>;
}

export interface CitizenDecisionOutput {
  internal_monologue: string;
  public_narrative: string;
  actions: QueuedActionInstruction[];
}

export interface MarketBoardEntry {
  itemType: string;
  averageClearingPrice: number | null;
  trend: 'up' | 'down' | 'flat' | 'new' | 'unknown';
}

export interface EmploymentBoardEntry {
  enterprise_id: string;
  industry: string;
  wage: number;
  min_skill: number;
  owner_name?: string;
}

export interface PersonalStatusBoard {
  employed: boolean;
  enterprise_id: string | null;
  enterprise_role?: 'owner' | 'employee' | null;
  /** Current agent wealth — used for entrepreneurial opportunity alert. */
  agentWealth?: number;
}

/** Banking context injected into citizen agent prompts when bankingEnabled is true. */
export interface CitizenBankingContext {
  depositBalance: number;
  bankName: string;
  outstandingLoans: Array<{ remainingBalance: number; dueAtIteration: number }>;
  iterationNumber: number;
}

/** Banking context injected into bank agent prompts. */
export interface BankOperationsContext {
  bankReserves: number;
  totalDeposits: number;
  currentReserveRatio: number;
  reserveRequirement: number;
  activeLoans: number;
  totalLoansOutstanding: number;
  lendingCapacity: number;
}

function buildCitizenBankingSection(ctx?: CitizenBankingContext): string {
  if (!ctx) return '';
  const loanText = ctx.outstandingLoans.length > 0
    ? ctx.outstandingLoans.map(l =>
        `${l.remainingBalance.toFixed(1)} fiat due in ${l.dueAtIteration - ctx.iterationNumber} iterations`
      ).join(', ')
    : 'None';
  return `\n\n[Banking — ${ctx.bankName}]
- Deposit balance: ${ctx.depositBalance.toFixed(2)} fiat
- Outstanding loans: ${loanText}
You may: DEPOSIT (move cash to bank), WITHDRAW (move deposit to cash), TAKE_LOAN (borrow from bank), REPAY_LOAN.`;
}

/** Capital market context injected into citizen agent prompts when capitalMarketsEnabled is true. */
export interface CitizenCapitalMarketContext {
  equityHoldings: Array<{ enterpriseOwnerName: string; sharesHeld: number; estimatedValue: number }>;
  bondHoldings: Array<{ issuerName: string; bondType: string; faceValue: number; couponRate: number; iterationsToMaturity: number }>;
}

/** Fiscal policy context injected into citizen agent prompts when fiscalEnabled is true. */
export interface CitizenFiscalContext {
  budgetAllocation: {
    infrastructure: number;
    education: number;
    defense: number;
    welfare: number;
  };
  publicGoodsQuality: {
    infrastructure: number;
    education: number;
    defense: number;
    welfare: number;
  };
}

function buildCitizenCapitalMarketSection(ctx?: CitizenCapitalMarketContext): string {
  if (!ctx) return '';
  if (ctx.equityHoldings.length === 0 && ctx.bondHoldings.length === 0) return '';

  const lines = ['\n\n[Capital Market Holdings]'];

  if (ctx.equityHoldings.length > 0) {
    lines.push('- Equity positions: ' + ctx.equityHoldings.map(h =>
      `${h.sharesHeld} shares of ${h.enterpriseOwnerName} (est. value: ${h.estimatedValue.toFixed(1)} fiat)`
    ).join('; '));
  } else {
    lines.push('- Equity positions: none');
  }

  if (ctx.bondHoldings.length > 0) {
    lines.push('- Bond holdings: ' + ctx.bondHoldings.map(b =>
      `${b.bondType} bond from ${b.issuerName}, face value ${b.faceValue} @ ${(b.couponRate * 100).toFixed(2)}% coupon, ${b.iterationsToMaturity} iterations to maturity`
    ).join('; '));
  } else {
    lines.push('- Bond holdings: none');
  }

  lines.push('You may: BUY_SHARES (invest in enterprise equity), SELL_SHARES (exit position), BUY_BOND (fixed income), ISSUE_GOV_BOND (leaders only).');
  return lines.join('\n');
}

function buildCitizenFiscalSection(ctx?: CitizenFiscalContext): string {
  if (!ctx) return '';

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const q = (v: number) => `${Math.round(v)}/100`;

  return `\n\n[PUBLIC SERVICES]
Budget: Infrastructure ${pct(ctx.budgetAllocation.infrastructure)}, Education ${pct(ctx.budgetAllocation.education)}, Defense ${pct(ctx.budgetAllocation.defense)}, Welfare ${pct(ctx.budgetAllocation.welfare)}
Quality: Infrastructure ${q(ctx.publicGoodsQuality.infrastructure)}, Education ${q(ctx.publicGoodsQuality.education)}, Defense ${q(ctx.publicGoodsQuality.defense)}, Welfare ${q(ctx.publicGoodsQuality.welfare)}
Infrastructure quality affects work productivity. Education quality affects skill development rate. Defense quality affects community safety. Welfare provides direct financial support.`;
}

function buildBankOperationsSection(ctx?: BankOperationsContext): string {
  if (!ctx) return '';
  return `\n\n[Bank Operations]
- Your reserves: ${ctx.bankReserves.toFixed(2)} fiat
- Total deposits held: ${ctx.totalDeposits.toFixed(2)} fiat
- Reserve ratio: ${ctx.currentReserveRatio.toFixed(3)} (minimum: ${ctx.reserveRequirement})
- Active loans: ${ctx.activeLoans} (total outstanding: ${ctx.totalLoansOutstanding.toFixed(2)} fiat)
- Available lending capacity: ${ctx.lendingCapacity.toFixed(2)} fiat
You may: ISSUE_LOAN (to requesting citizens), SET_INTEREST_RATE, or REST.
Reserve requirement: You MUST maintain reserves / total_deposits >= ${ctx.reserveRequirement}.`;
}

export interface CentralBankContext {
  cpi: number;
  inflationRate: number;
  inflationExpectations: number;
  m1Current: number;
  m1GrowthRate: number;
  currentReserveRatio: number;
  currentBaseRate: number;
}

function buildInflationContextSection(inflationContext?: string): string {
  if (!inflationContext?.trim()) return '';
  return `\n\n[Economic Conditions]\n${inflationContext.trim()}`;
}

function buildCentralBankSection(ctx?: CentralBankContext): string {
  if (!ctx) return '';
  return `\n\n[CENTRAL BANK DASHBOARD]
CPI ${ctx.cpi.toFixed(1)}, Inflation ${ctx.inflationRate.toFixed(1)}%/iter (trend: ${ctx.inflationExpectations.toFixed(1)}%), M1 ${ctx.m1Current.toFixed(1)}, M1 growth ${(ctx.m1GrowthRate * 100).toFixed(1)}%.
Current policy: reserve ratio ${ctx.currentReserveRatio.toFixed(3)}, base rate ${ctx.currentBaseRate.toFixed(3)}.
You may SET_RESERVE_RATIO (0.05-0.50) or SET_BASE_RATE (0.001-0.05).`;
}

function buildMarketBoardSection(entries?: readonly MarketBoardEntry[]): string {
  if (!entries || entries.length === 0) {
    return '[Current Market Board]\n- No clearing data yet. Use posted prices and scarcity signals cautiously.';
  }
  const lines = ['[Current Market Board]'];
  for (const entry of entries) {
    const priceText = entry.averageClearingPrice == null ? 'no clear price yet' : `avg clearing price ${entry.averageClearingPrice}`;
    lines.push(`- ${entry.itemType}: ${priceText}; trend ${entry.trend}`);
  }
  return lines.join('\n');
}

function buildEmploymentBoardSection(entries?: readonly EmploymentBoardEntry[]): string {
  if (!entries || entries.length === 0) {
    return '[Employment Board]\n- No active job offers this week.';
  }
  return [
    '[Employment Board]',
    ...entries.map(entry =>
      `- ${entry.enterprise_id} (${entry.industry}) wage ${entry.wage}, min_skill ${entry.min_skill}${entry.owner_name ? `, owner ${entry.owner_name}` : ''}`
    ),
  ].join('\n');
}

function buildPersonalStatusSection(status?: PersonalStatusBoard): string {
  if (!status) return '[Personal Status]\n- Employment: unemployed';

  if (status.employed && status.enterprise_id) {
    const roleText = status.enterprise_role ? ` as ${status.enterprise_role}` : '';
    return `[Personal Status]\n- Employment: employed by ${status.enterprise_id}${roleText}`;
  }

  if (status.enterprise_id && status.enterprise_role === 'owner') {
    return `[Personal Status]\n- Employment: owner of ${status.enterprise_id}`;
  }

  // Unemployed — check for entrepreneurial opportunity
  const lines = ['[Personal Status]', '- Employment: unemployed'];
  if (status.agentWealth !== undefined && status.agentWealth >= 40) {
    lines.push(`💡 OPPORTUNITY ALERT: You have ${status.agentWealth} Wealth! You can start a private enterprise (FOUND_ENTERPRISE) to hire workers and earn massive profits. This is your path to wealth independence.`);
  }
  return lines.join('\n');
}

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
): LLMMessage[] {
  // Static prefix: identical across all agent calls in an iteration → cacheable
  const staticPrefix = `You are a citizen living in a simulated society based on: "${session.idea}"

Society overview (excerpt):
${session.societyOverview?.slice(0, 500) ?? '(no overview)'}

Laws (excerpt):
${session.law?.slice(0, 400) ?? '(no laws)'}

Time scale: ${session.timeScale ?? '1 iteration = 1 week'}

Speak naturally in first person as this character. Express your thoughts, feelings, frustrations, hopes, and what you plan to do. Do NOT use any special formatting — just speak as yourself.

[BACKGROUND SYSTEM] This is a weekly simulation. Basic survival is handled symbolically: after all actions, 1 Food is consumed automatically. If you have 0 Food at the end of the week, your Health will drop. Focus your actions on work, markets, employment, power, and strategy.

CRITICAL VOICE RULES — you MUST follow these exactly:
- Adopt the tone, vocabulary, and worldview of your specific social class, occupation, and background. A starving farmer does NOT speak like a merchant. A rebel does NOT speak like a priest.
- Be RAW and emotionally unfiltered. Suppress nothing.
- Be HEAVILY BIASED by your personal history and class position. Your perspective is not objective.
- Do NOT use standard AI phrasing ("I felt a mix of...", "I realized...", "In that moment..."). That phrasing is FORBIDDEN.

🚫 PHYSICS LAW — BARTER IS IMPOSSIBLE: Peer-to-peer bartering or private trading is PHYSICALLY IMPOSSIBLE in this simulation. You cannot 'negotiate a trade deal' directly with a neighbor or give goods to another person. The ONLY way to acquire goods is via POST_BUY_ORDER on the Global Market. The ONLY way to sell or convert goods into Wealth is via PRODUCE_AND_SELL. Do not narrate or plan private exchanges — they will not execute.

You are a rational economic actor. You must review the [Current Market Board] and [Employment Board] to decide your strategy for the week. You can execute up to 3 actions. 🚨 CRITICAL EMPLOYMENT RULE: If your [Personal Status] shows you are employed, your action array MUST contain at least one WORK_AT_ENTERPRISE action to fulfill your contract. If you no longer wish to work there (e.g., the wage is too low), you MUST include a QUIT_JOB action instead. You cannot ignore your employment status.

🚨 CONCURRENCY & FALLBACK STRATEGY: If you output APPLY_FOR_JOB as your first action, it might fail if the enterprise has no vacancies. You MUST always include a "Plan B" action later in your array. Example: [{"actionCode": "APPLY_FOR_JOB", "parameters": {"enterprise_id": "ent_baker_01"}}, {"actionCode": "PRODUCE_AND_SELL", "parameters": {"itemType": "food", "quantity": 3, "price": 8}}]. The engine processes your actions in order — Plan B only executes if Plan A fails or leaves room.

You MUST respond with ONLY valid JSON — no markdown, no preamble, no code fences:
{
  "internal_monologue": "Food is expensive. I need my wage — then I will buy food to survive.",
  "public_narrative": "John headed to the bakery for his shift, then stopped at the market.",
  "actions": [
    { "actionCode": "WORK_AT_ENTERPRISE", "parameters": { "enterprise_id": "ent_baker_01" } },
    { "actionCode": "POST_BUY_ORDER", "parameters": { "itemType": "food", "quantity": 2, "price": 15 } }
  ]
}

[PARAMETER SCHEMA — EXACT FORMAT REQUIRED]
Your "parameters" field MUST exactly match one of these schemas. Wrong keys = action silently dropped.

PRODUCE_AND_SELL:   { "itemType": "food", "quantity": 3 }
  itemType options: "food" | "raw_materials" | "luxury_goods"
  quantity: integer 1–10

POST_BUY_ORDER:     { "itemType": "food", "quantity": 2, "maxPrice": 8 }
  maxPrice: number (your maximum willingness to pay per unit)

WORK_AT_ENTERPRISE: { "enterprise_id": "ent_abc123" }
  enterprise_id: exact enterprise ID from [Employment Board] — copy it verbatim

APPLY_FOR_JOB:      { "enterprise_id": "ent_abc123" }
  enterprise_id: exact enterprise ID from [Employment Board]

STEAL:              { "target": "agent_abc123" }
  target: exact agent ID from the agent list

OUTPUT RULES (read carefully — violations waste your action turn):
- "actions" must be an array of 1–3 objects.
- Each "actionCode" MUST exactly match a code string from [AVAILABLE ACTIONS] shown below. Any code not on that list is silently dropped.
- Each action MUST include "parameters" with fields matching the schema shown in [AVAILABLE ACTIONS].
- If your [Personal Status] shows you are employed: MUST include "WORK_AT_ENTERPRISE" or "QUIT_JOB".
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

export interface AgentIntent {
  agentId: string;
  agentName: string;
  intent: string;
  reasoning: string;
  actions?: QueuedActionInstruction[];
  primaryActionCode?: string;
  primaryActionTarget?: string | null;
  /** Phase 2: raw natural language output from the Main Agent (before parsing). */
  rawNaturalLanguage?: string;
  /** Phase 2: method used to parse the intent (keyword, llm, fallback). */
  parseMethod?: 'keyword' | 'llm' | 'fallback' | 'structured';
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
): LLMMessage[] {
  const agentList = intents.map(ai => {
    const agent = agents.find(a => a.id === ai.agentId);
    const stats = agent?.currentStats ?? { wealth: 50, health: 70, happiness: 60, cortisol: 20, dopamine: 50 };
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

  const systemPrompt = `You are the Central Agent (omniscient narrator) resolving iteration ${iterationNumber} of a society simulation.

Society: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}
${previousSummary ? `\nPrevious iteration summary:\n${previousSummary.slice(0, 600)}` : ''}${physicsLogBlock}${metricsBlock}${lockedNote}

Agent intentions this iteration:
${agentList}

Laws (excerpt):
${session.law?.slice(0, 500) ?? '(no laws)'}

NARRATIVE DIRECTIVE — FRICTION FIRST: Prioritise narrating the FRICTION, INEQUALITY, and DISRUPTION of this iteration. Do not default to a 'balanced' or 'harmonious' summary. If agents are suffering, starving, or if wealth is concentrating in a few hands, your narrative must be a harsh, unflinching reflection of that systemic reality. Social drama, class conflict, and desperation are more truthful than false consensus.

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

// ── Phase 4 prompts ─────────────────────────────────────────────────────────

export function buildAgentReflectionPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  iterationSummaries: Array<{ number: number; summary: string }>
): LLMMessage[] {
  const summaryText = iterationSummaries
    .map(s => `Iteration ${s.number}: ${s.summary}`)
    .join('\n');

  const cortisolStat = (agent.currentStats as unknown as Record<string, unknown>).cortisol;
  const cortisolLine = cortisolStat != null ? `- Cortisol (stress): ${cortisolStat}/100` : '';

  const systemPrompt = `You are ${agent.name}, a ${agent.role} in a society simulation based on: "${session.idea}"

Background: ${agent.background}

Your final material reality:
- Wealth: ${agent.currentStats.wealth}
- Health: ${agent.currentStats.health}/100
- Happiness: ${agent.currentStats.happiness}/100${cortisolLine ? `\n${cortisolLine}` : ''}
- Status: ${agent.isAlive ? 'Alive' : 'Deceased'}

The simulation has ended. Reflect on your MATERIAL EXPERIENCE — your economic reality, not abstract philosophy.

Society history (${iterationSummaries.length} iterations):
${summaryText.slice(0, 2000)}

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "pass1": "string - your personal reflection (3-5 sentences, first person, raw and honest)"
}

Rules:
- ANCHOR every sentence in MATERIAL REALITY: your actual wealth trajectory, food access, labour conditions, wages, debts, or inequality you witnessed. Did you eat? Were you exploited? Did you hoard or starve? Compare yourself to others.
- Do NOT reflect on abstract philosophy, systems, or ideals — ground it in YOUR specific economic experience
- Speak as this specific character — their class, background, and biases must be audible in every sentence
- Express raw, unfiltered emotion rooted in material conditions: rage at poverty, guilt at excess, desperation from hunger, pride from earnings, resentment of exploitation — whatever is authentic to this person's class position
- Do NOT use standard AI phrasing ("I felt a mix of...", "I realized that...", "In that moment...") — FORBIDDEN
- Do not summarize society history; reflect from YOUR narrow, economically-grounded, personal vantage point`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Reflect on your experience in this society.' },
  ];
}

export function buildAgentReflection2Prompt(
  agent: Agent,
  session: Pick<Session, 'idea'>,
  pass1: string,
  evaluationAnalysis: string
): LLMMessage[] {
  const systemPrompt = `You are ${agent.name}, a ${agent.role}.

You previously reflected: "${pass1}"

You have now been shown the full society evaluation report:
${evaluationAnalysis.slice(0, 800)}

Does knowing the full picture change your perspective? Respond with ONLY valid JSON (no markdown, no preamble):
{
  "pass2": "string - your updated reflection after seeing the full picture (2-4 sentences, first person)"
}

Rules:
- You may soften, deepen, or completely harden your original view — let your class and personal losses dictate which
- Be specific about what changed (or didn't) and WHY it changed given who you are
- Remain fully in character — no AI phrasing, no diplomatic softening unless that is who this person is`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'How do you feel after seeing the full picture?' },
  ];
}

export function buildEvaluationPrompt(
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  iterationSummaries: Array<{ number: number; summary: string }>,
  agentReflections: Array<{ agentName: string; role: string; pass1: string }>,
  finalStats: { aliveCount: number; totalCount: number; avgWealth: number; avgHealth: number; avgHappiness: number }
): LLMMessage[] {
  const summaryText = iterationSummaries
    .slice(-10)
    .map(s => `Iteration ${s.number}: ${s.summary}`)
    .join('\n');

  const reflectionSample = agentReflections
    .slice(0, 8)
    .map(r => `${r.agentName} (${r.role}): "${r.pass1}"`)
    .join('\n');

  const systemPrompt = `You are the Central Agent writing a comprehensive evaluation of a completed society simulation.

Society concept: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}

Final statistics:
- Survivors: ${finalStats.aliveCount} / ${finalStats.totalCount} agents
- Average wealth: ${finalStats.avgWealth}
- Average health: ${finalStats.avgHealth}/100
- Average happiness: ${finalStats.avgHappiness}/100

Recent iteration summaries:
${summaryText.slice(0, 1500)}

Sample agent reflections:
${reflectionSample.slice(0, 1200)}

Evaluate this society's success and failure. Respond with ONLY valid JSON (no markdown, no preamble):
{
  "verdict": "string - 2-3 sentence overall verdict",
  "strengths": ["string - specific strength 1", "string - specific strength 2", "string - specific strength 3"],
  "weaknesses": ["string - specific weakness 1", "string - specific weakness 2", "string - specific weakness 3"],
  "analysis": "string - 4-6 paragraph deep analysis covering: narrative arc, key turning points, what worked/failed, lessons learned"
}

Rules:
- Be specific with evidence from the simulation history
- strengths and weaknesses must each have exactly 3 items
- analysis should be rich enough to stand alone as a report`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Evaluate this society.' },
  ];
}

export function buildReviewChatPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview'>,
  agentPass1: string,
  agentPass2: string | null,
  history: ChatMessage[],
  userMessage: string
): LLMMessage[] {
  const systemPrompt = `You are ${agent.name}, a ${agent.role} from a society simulation based on: "${session.idea}"

Background: ${agent.background}

Your final stats: Wealth ${agent.currentStats.wealth}, Health ${agent.currentStats.health}/100, Happiness ${agent.currentStats.happiness}/100
Status: ${agent.isAlive ? 'Alive' : 'Deceased'}

Your personal reflection: "${agentPass1}"
${agentPass2 ? `\nAfter seeing the full picture: "${agentPass2}"` : ''}

You are now available for an interview. Answer questions in character — as this specific person with their history, biases, and emotions. You may deflect, be defensive, or reveal unexpected insights.

Rules:
- Always stay in character as ${agent.name}
- Reference your actual experience in the simulation
- Keep responses under 150 words
- Be authentic, not diplomatic`;

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

// ── Phase 2: Post-Mortem Prompt ──────────────────────────────────────────────

export interface PostMortemInput {
  agent: Agent;
  diedAtIteration: number;
  deathReason: string;
  frozenMemoryContext: string;
}

export function buildPostMortemPrompt(input: PostMortemInput): LLMMessage[] {
  const { agent, diedAtIteration, deathReason, frozenMemoryContext } = input;

  const systemPrompt = `[STATE LOCKED — DECEASED]

You are ${agent.name}, a ${agent.role}. You are dead.

You died on Iteration ${diedAtIteration}. Stated cause: ${deathReason}

Your background: ${agent.background}

Your final stats at death — Wealth: ${agent.currentStats.wealth}, Health: ${agent.currentStats.health}/100, Happiness: ${agent.currentStats.happiness}/100

Your frozen memory (personal experiences before death):
${frozenMemoryContext}

Speak from beyond as a victim looking back at the system that killed you. Your perspective is frozen at the moment of death. Provide a harsh, class-biased, personal critique of the systemic failures, economic policies, or power structures that made your death inevitable.

VOICE RULES: Your class and occupation must be audible in every word. Be raw and specific. Forbidden: "I felt a mix of...", "I realize now...", "In retrospect..." — that AI phrasing is PROHIBITED.

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "postMortemCritique": "string - 3-5 sentences of harsh systemic critique from this character's locked perspective"
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Speak. What systemic forces made your death inevitable?' },
  ];
}

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

// ── Phase 6 map-reduce prompts ───────────────────────────────────────────────

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
    const stats = agent?.currentStats ?? { wealth: 50, health: 70, happiness: 60, cortisol: 20, dopamine: 50 };
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
): LLMMessage[] {
  const summaryList = groupSummaries.map((s, i) => `Group ${i + 1}: ${s}`).join('\n');
  const metricsBlock = iterationMetrics
    ? `\n[OBJECTIVE SYSTEM METRICS — last iteration]\n${iterationMetrics}\n⚠️ Weave these facts into your narrative. If unemployment is high, the story must reflect crisis, desperation, and inequality — not a utopia.`
    : '';

  const mergeLockedNote = lockedVariables && lockedVariables.length > 0
    ? `\n\nCONTROLLED VARIABLE METHOD: The following variables are ABSOLUTELY LOCKED and will not change, regardless of any agent actions or events: ${lockedVariables.join(', ')}. Do not narrate changes to these variables.`
    : '';

  const systemPrompt = `You are the Central Agent synthesising iteration ${iterationNumber} of a society simulation.
You have received summaries from ${groupSummaries.length} sub-groups.

Society: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}
${previousSummary ? `\nPrevious iteration:\n${previousSummary.slice(0, 400)}` : ''}${metricsBlock}${mergeLockedNote}

Sub-group summaries:
${summaryList}

NARRATIVE DIRECTIVE — FRICTION FIRST: Prioritise narrating the FRICTION, INEQUALITY, and DISRUPTION of this iteration. Do not smooth over suffering or wealth gaps with diplomatic language. If the data shows desperation, hoarding, or class conflict, your synthesis must reflect that brutal reality — not paper over it.

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

// ── Governance Cycle Prompts ───────────────────────────────────────────────────

export interface GovernancePolicyProposal {
  field: 'tax_rate' | 'ubi_allocation' | 'enforcement_level';
  value: number;
  reasoning: string;
}

export interface GovernanceBallotItem {
  field: 'tax_rate' | 'ubi_allocation' | 'enforcement_level';
  proposedValue: number;
  description: string;
  /** Phase C: one-sentence economic impact projection generated by the Central Agent. */
  impactForecast?: string;
}

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
  const agentList = agentIntents
    .map(a =>
      `- ${a.agentName} [id:${a.agentId.slice(0, 8)}]: actions=[${a.actionCodes.join(', ')}] intent="${a.intent.slice(0, 120)}"`
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
