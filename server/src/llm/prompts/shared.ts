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
    description: 'Take it easy this week -- rest your body, let the stress drain away (REST).',
    params: '{}',
  },
  PRODUCE_AND_SELL: {
    description: 'Farm your land and sell the harvest directly to the market (PRODUCE_AND_SELL). You produce about 20 units -- enough to feed yourself for 3-4 weeks and pocket the profits.',
    params: '{ "itemType": "food" | "raw_materials" | "luxury_goods", "quantity": number, "price": number }',
  },
  POST_BUY_ORDER: {
    description: 'Go to the market and buy what you need (POST_BUY_ORDER). Goods change hands immediately at market price.',
    params: '{ "itemType": "food" | "raw_materials" | "luxury_goods" | "tools", "quantity": number, "price": number }',
  },
  POST_SELL_ORDER: {
    description: 'List your goods for sale on the market at the price you set (POST_SELL_ORDER).',
    params: '{ "itemType": "food" | "raw_materials" | "luxury_goods" | "tools", "quantity": number, "price": number }',
  },
  WORK_AT_ENTERPRISE: {
    description: 'Show up for your shift at work and collect your wage (WORK_AT_ENTERPRISE).',
    params: '{ "enterprise_id": string }',
  },
  APPLY_FOR_JOB: {
    description: 'Walk up to a business and ask for a job (APPLY_FOR_JOB). Check the employment board first.',
    params: '{ "enterprise_id": string }',
  },
  QUIT_JOB: {
    description: 'Walk away from your job -- hand in your resignation and leave (QUIT_JOB).',
    params: '{ "enterprise_id": string }',
  },
  FOUND_ENTERPRISE: {
    description: 'Put up 40 fiat to start your own business -- hire workers, set wages, keep the profits (FOUND_ENTERPRISE).',
    params: '{ "industry": "food" | "raw_materials" | "luxury_goods" | "manufacturing" | "services" }',
  },
  POST_JOB_OFFER: {
    description: 'Put the word out that your enterprise is hiring (POST_JOB_OFFER). Set the wage and minimum skill level.',
    params: '{ "enterprise_id": string, "wage": number, "min_skill": number }',
  },
  HIRE_EMPLOYEE: {
    description: 'Bring someone on board at your enterprise -- accept their application (HIRE_EMPLOYEE).',
    params: '{ "agent_id": string }',
  },
  FIRE_EMPLOYEE: {
    description: 'Let someone go from your enterprise (FIRE_EMPLOYEE).',
    params: '{ "agent_id": string }',
  },
  STEAL: {
    description: 'Try to rob another citizen -- risky, illegal, and the stress alone might kill you (STEAL).',
    params: '{ "target": string }',
  },
  HELP: {
    description: 'Lend a hand to someone in need -- costs you money, but eases your conscience (HELP).',
    params: '{ "target": string }',
  },
  INVEST: {
    description: 'Set aside 10 fiat as a speculative investment -- might pay off down the road (INVEST).',
    params: '{}',
  },
  STRIKE: {
    description: 'Refuse to work this week -- a collective protest against the way things are (STRIKE).',
    params: '{}',
  },
  SABOTAGE: {
    description: 'Wreck someone else\'s enterprise -- dangerous, and your body pays the price too (SABOTAGE).',
    params: '{ "target": string }',
  },
  EMBEZZLE: {
    description: 'Skim funds from the communal treasury -- only those with political power can get away with this (EMBEZZLE). Extreme legal risk.',
    params: '{}',
  },
  ADJUST_TAX: {
    description: 'Use your political authority to extract wealth from the lower classes through tax policy (ADJUST_TAX). Only those in power can do this.',
    params: '{}',
  },
  SUPPRESS: {
    description: 'Deploy enforcement against a specific citizen -- a tool of the powerful (SUPPRESS).',
    params: '{ "target": string }',
  },
  // Capital Markets actions
  BUY_SHARES: {
    description: 'Invest in an enterprise by purchasing shares (BUY_SHARES). BENEFIT: You receive dividend payments proportional to your ownership whenever the enterprise profits. Specify the enterprise owner.',
    params: '{ "target": string, "quantity": number }',
  },
  SELL_SHARES: {
    description: 'Sell off your shares in an enterprise and cash out (SELL_SHARES). Specify the enterprise owner.',
    params: '{ "target": string, "quantity": number }',
  },
  BUY_BOND: {
    description: 'Buy a bond for steady coupon income (BUY_BOND). Use target "treasury" for government bonds or the enterprise owner name for corporate bonds.',
    params: '{ "target": string, "amount": number }',
  },
  ISSUE_GOV_BOND: {
    description: 'Issue government bonds to raise funds for the treasury (ISSUE_GOV_BOND). Only those in power can do this.',
    params: '{ "amount": number }',
  },
  // Banking Foundation actions
  DEPOSIT: {
    description: 'Deposit fiat into your bank account (DEPOSIT). BENEFIT: Earns passive income every iteration through interest while keeping your money safe and available for future WITHDRAW.',
    params: '{ "amount": number }',
  },
  WITHDRAW: {
    description: 'Withdraw fiat from your bank deposit for immediate spending (WITHDRAW). NOTE: This reduces your passive income stream, so only pull out what you need.',
    params: '{ "amount": number }',
  },
  TAKE_LOAN: {
    description: 'Borrow fiat from the bank for investment or urgent needs (TAKE_LOAN). BENEFIT: Loans let you buy tools, inventory, or food now and pay over time, potentially multiplying future earnings if used well.',
    params: '{ "principal": number }',
  },
  REPAY_LOAN: {
    description: 'Repay part of your outstanding loan (REPAY_LOAN). BENEFIT: Reduces debt, cuts future interest burden, and improves your creditworthiness for later borrowing.',
    params: '{ "loan_id": string, "amount": number }',
  },
  ISSUE_LOAN: {
    description: 'Issue a loan to a requesting citizen -- only the bank can do this (ISSUE_LOAN). Must maintain reserve requirements.',
    params: '{ "borrower_id": string, "principal": number }',
  },
  SET_INTEREST_RATE: {
    description: 'Adjust the lending interest rate for new loans -- only the bank can do this (SET_INTEREST_RATE).',
    params: '{ "rate": number }',
  },
  NONE: {
    description: 'Do nothing. Sitting idle eats at you -- your body weakens and anxiety builds (NONE).',
    params: '{}',
  },
};

/**
 * Build the action dictionary block injected into citizen prompts.
 * Filters to the role-allowed action set when provided.
 */
export function buildActionDictionary(allowedActions?: readonly ActionCode[]): string {
  const codes = allowedActions ?? (Object.keys(ACTION_SCHEMAS) as ActionCode[]);
  const lines = [
    'What you can do this week:',
    'Choose up to 3 of these actions. Each costs you time and energy -- choose wisely.',
    'Hallucinated codes not on this list are silently dropped -- wasting your turn.',
    '',
  ];
  let idx = 1;
  for (const code of codes) {
    const schema = ACTION_SCHEMAS[code];
    if (!schema) continue;
    lines.push(`${idx}. ${schema.description}`);
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
  enterprise_industry?: string | null;
  enterprise_wage?: number | null;
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
    const details = [
      `- Employment: employed by ${status.enterprise_id}${roleText}`,
      status.enterprise_wage != null ? `- Wage: ${status.enterprise_wage} fiat per iteration` : null,
      status.enterprise_industry ? `- Enterprise sector: ${status.enterprise_industry}` : null,
      '- Showing up for WORK_AT_ENTERPRISE protects your income. Missing work means losing wages.',
    ].filter(Boolean);
    return ['[Personal Status]', ...details].join('\n');
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
