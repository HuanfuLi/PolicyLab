import type { ActionCode } from '../../mechanics/actionCodes.js';

// ── Action Schemas ──────────────────────────────────────────────────────────

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

export const ACTION_SCHEMAS: Partial<Record<ActionCode, ActionSchema>> = {
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
export function buildActionDictionary(allowedActions?: readonly ActionCode[]): string {
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

// ── Exported Interfaces ─────────────────────────────────────────────────────

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

export interface CentralBankContext {
  cpi: number;
  inflationRate: number;
  inflationExpectations: number;
  m1Current: number;
  m1GrowthRate: number;
  currentReserveRatio: number;
  currentBaseRate: number;
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

export interface PostMortemInput {
  agent: import('@policylab/shared').Agent;
  diedAtIteration: number;
  deathReason: string;
  frozenMemoryContext: string;
}

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

// ── Helper Builder Functions ────────────────────────────────────────────────

export function buildCitizenBankingSection(ctx?: CitizenBankingContext): string {
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

export function buildCitizenCapitalMarketSection(ctx?: CitizenCapitalMarketContext): string {
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

export function buildCitizenFiscalSection(ctx?: CitizenFiscalContext): string {
  if (!ctx) return '';

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const q = (v: number) => `${Math.round(v)}/100`;

  return `\n\n[PUBLIC SERVICES]
Budget: Infrastructure ${pct(ctx.budgetAllocation.infrastructure)}, Education ${pct(ctx.budgetAllocation.education)}, Defense ${pct(ctx.budgetAllocation.defense)}, Welfare ${pct(ctx.budgetAllocation.welfare)}
Quality: Infrastructure ${q(ctx.publicGoodsQuality.infrastructure)}, Education ${q(ctx.publicGoodsQuality.education)}, Defense ${q(ctx.publicGoodsQuality.defense)}, Welfare ${q(ctx.publicGoodsQuality.welfare)}
Infrastructure quality affects work productivity. Education quality affects skill development rate. Defense quality affects community safety. Welfare provides direct financial support.`;
}

export function buildBankOperationsSection(ctx?: BankOperationsContext): string {
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

export function buildInflationContextSection(inflationContext?: string): string {
  if (!inflationContext?.trim()) return '';
  return `\n\n[Economic Conditions]\n${inflationContext.trim()}`;
}

export function buildCentralBankSection(ctx?: CentralBankContext): string {
  if (!ctx) return '';
  return `\n\n[CENTRAL BANK DASHBOARD]
CPI ${ctx.cpi.toFixed(1)}, Inflation ${ctx.inflationRate.toFixed(1)}%/iter (trend: ${ctx.inflationExpectations.toFixed(1)}%), M1 ${ctx.m1Current.toFixed(1)}, M1 growth ${(ctx.m1GrowthRate * 100).toFixed(1)}%.
Current policy: reserve ratio ${ctx.currentReserveRatio.toFixed(3)}, base rate ${ctx.currentBaseRate.toFixed(3)}.
You may SET_RESERVE_RATIO (0.05-0.50) or SET_BASE_RATE (0.001-0.05).`;
}

export function buildMarketBoardSection(entries?: readonly MarketBoardEntry[]): string {
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

export function buildEmploymentBoardSection(entries?: readonly EmploymentBoardEntry[]): string {
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

export function buildPersonalStatusSection(status?: PersonalStatusBoard): string {
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
