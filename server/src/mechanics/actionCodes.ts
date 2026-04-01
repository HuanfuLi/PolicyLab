/**
 * Action codes for the neuro-symbolic engine.
 * LLMs decide *what* to do (action codes); the physics engine decides *how much* stats change.
 *
 * Phase 1 additions:
 *  - PRODUCE_AND_SELL: Independent production routed into the market
 *  - POST_BUY_ORDER: Place a buy order on the global order book
 *  - POST_SELL_ORDER: Place a sell order on the global order book
 *  - Enterprise HR actions: FOUND_ENTERPRISE / POST_JOB_OFFER / APPLY_FOR_JOB /
 *    HIRE_EMPLOYEE / FIRE_EMPLOYEE / WORK_AT_ENTERPRISE / QUIT_JOB
 *
 * Phase 3 additions (elite/governing actions):
 *  - EMBEZZLE: Skim from communal trust — high reward, high legal risk
 *  - ADJUST_TAX: Force wealth redistribution from lower classes
 *  - SUPPRESS: Deploy enforcement to penalise a specific citizen
 *
 * Banking Foundation additions (Phase 1 — BANK-03):
 *  - DEPOSIT: Move cash to bank deposit account
 *  - WITHDRAW: Move deposit balance back to cash
 *  - TAKE_LOAN: Borrow from the bank (creates M1 deposit)
 *  - REPAY_LOAN: Make a loan repayment
 *  - ISSUE_LOAN: Bank agent issues a loan to a requesting citizen
 *  - SET_INTEREST_RATE: Bank agent adjusts the lending rate
 */

export type ActionCode =
  | 'WORK'
  | 'REST'
  | 'STRIKE'
  | 'STEAL'
  | 'HELP'
  | 'INVEST'
  | 'PRODUCE_AND_SELL'
  | 'POST_BUY_ORDER'
  | 'POST_SELL_ORDER'
  | 'FOUND_ENTERPRISE'
  | 'POST_JOB_OFFER'
  | 'APPLY_FOR_JOB'
  | 'HIRE_EMPLOYEE'
  | 'FIRE_EMPLOYEE'
  | 'WORK_AT_ENTERPRISE'
  | 'QUIT_JOB'
  // Phase 2 additions
  | 'SABOTAGE'
  // Phase 3: privileged elite/governing actions
  | 'EMBEZZLE'
  | 'ADJUST_TAX'
  | 'SUPPRESS'
  // Banking Foundation (Phase 1: Banking Foundation)
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'TAKE_LOAN'
  | 'REPAY_LOAN'
  | 'ISSUE_LOAN'         // bank agent only
  | 'SET_INTEREST_RATE'  // bank agent only
  | 'NONE';

const VALID_ACTIONS: Set<string> = new Set([
  'WORK', 'REST', 'STRIKE', 'STEAL', 'HELP', 'INVEST',
  'PRODUCE_AND_SELL', 'POST_BUY_ORDER', 'POST_SELL_ORDER',
  'FOUND_ENTERPRISE', 'POST_JOB_OFFER', 'APPLY_FOR_JOB',
  'HIRE_EMPLOYEE', 'FIRE_EMPLOYEE', 'WORK_AT_ENTERPRISE', 'QUIT_JOB',
  'SABOTAGE',
  'EMBEZZLE', 'ADJUST_TAX', 'SUPPRESS',
  // Banking Foundation (Phase 1: Banking Foundation)
  'DEPOSIT', 'WITHDRAW', 'TAKE_LOAN', 'REPAY_LOAN',
  'ISSUE_LOAN', 'SET_INTEREST_RATE',
  'NONE',
]);

/**
 * Normalise a raw string from LLM output into a valid ActionCode.
 * Case-insensitive match; returns 'NONE' if unrecognised.
 */
export function normalizeActionCode(raw: string): ActionCode {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (VALID_ACTIONS.has(upper)) return upper as ActionCode;
  // Fuzzy matching for common LLM outputs
  if (upper.includes('WORK_AT_ENTERPRISE') || (upper.includes('WORK') && upper.includes('ENTERPRISE'))) return 'WORK_AT_ENTERPRISE';
  if (upper.includes('QUIT') || upper.includes('RESIGN')) return 'QUIT_JOB';
  if (upper.includes('FOUND') && upper.includes('ENTERPRISE')) return 'FOUND_ENTERPRISE';
  if (upper.includes('POST') && upper.includes('JOB')) return 'POST_JOB_OFFER';
  if ((upper.includes('APPLY') && upper.includes('JOB')) || upper.includes('APPLY_FOR_JOB')) return 'APPLY_FOR_JOB';
  if (upper.includes('HIRE')) return 'HIRE_EMPLOYEE';
  if (upper.includes('FIRE') || upper.includes('DISMISS')) return 'FIRE_EMPLOYEE';
  if (upper.includes('PRODUCE') || upper.includes('CRAFT') || upper.includes('FARM') || upper.includes('MANUFACTURE')) return 'PRODUCE_AND_SELL';
  if (upper.includes('BUY')) return 'POST_BUY_ORDER';
  if (upper.includes('SELL')) return 'POST_SELL_ORDER';
  if (upper.includes('SABOTAGE') || upper.includes('DESTROY') || upper.includes('VANDAL') || upper.includes('DISRUPT')) return 'SABOTAGE';
  if (upper.includes('EMBEZZLE') || upper.includes('EMBEZ') || upper.includes('SKIM')) return 'EMBEZZLE';
  if (upper.includes('TAX') || upper.includes('REALLOCATE') || upper.includes('REDISTRIBUTE')) return 'ADJUST_TAX';
  if (upper.includes('SUPPRESS') || upper.includes('POLICE') || upper.includes('ENFORCE') || upper.includes('ARREST')) return 'SUPPRESS';
  if (upper === 'WORK') return 'WORK';
  return 'NONE';
}

// ── Role-tier classification ─────────────────────────────────────────────────

/**
 * Three-tier social hierarchy used to gate privileged ActionCodes.
 *  elite      → governing/command roles (EMBEZZLE, ADJUST_TAX, SUPPRESS)
 *  specialist → professional/skilled roles (enterprise management, sabotage)
 *  laborer    → everyone else (basic survival actions only)
 */
export type RoleTier = 'elite' | 'specialist' | 'laborer';

export function getRoleTier(role: string): RoleTier {
  const upper = role.toUpperCase();
  if (/LEADER|GOVERNOR|PLANNER|MINISTER|COMMISSIONER|DIRECTOR|GENERAL|CHIEF|KING|QUEEN|MAYOR|PRESIDENT|CHAIRMAN|PARTY|SECRETARY|OFFICIAL|COMMANDER|ADMINISTRATOR|JUDGE|MAGISTRATE|OFFICER/.test(upper)) {
    return 'elite';
  }
  if (/MERCHANT|TRADER|SCHOLAR|HEALER|DOCTOR|TEACHER|PRIEST|MONK|SAGE|ENGINEER|SCIENTIST|LAWYER|INSPECTOR|SUPERVISOR|ACCOUNTANT|MANAGER|ARTISAN|SMITH|CARPENTER|BUILDER/.test(upper)) {
    return 'specialist';
  }
  return 'laborer';
}

/** Actions every citizen can choose from.
 * NOTE: EAT and CONSUME are intentionally excluded — survival metabolism is now
 * handled automatically by the Passive Metabolism system each iteration.
 */
const BASE_ACTIONS: readonly ActionCode[] = [
  'WORK', 'REST', 'PRODUCE_AND_SELL',
  'POST_BUY_ORDER', 'POST_SELL_ORDER',
  'APPLY_FOR_JOB', 'WORK_AT_ENTERPRISE', 'QUIT_JOB',
  'STEAL', 'HELP', 'INVEST',
  // Banking actions available to all citizens
  'DEPOSIT', 'WITHDRAW', 'TAKE_LOAN', 'REPAY_LOAN',
  'NONE',
];

/** Bank agent exclusive actions — all of BASE_ACTIONS + bank operations */
const BANK_ACTIONS: readonly ActionCode[] = [
  ...BASE_ACTIONS,
  'ISSUE_LOAN', 'SET_INTEREST_RATE',
];

/** Specialist-tier additions (organised/skilled actors) */
const SPECIALIST_ACTIONS: readonly ActionCode[] = [
  ...BASE_ACTIONS,
  'STRIKE', 'SABOTAGE',
  'FOUND_ENTERPRISE', 'POST_JOB_OFFER', 'HIRE_EMPLOYEE', 'FIRE_EMPLOYEE',
];

/** Elite-tier adds governing privileges on top of specialist set */
const ELITE_ACTIONS: readonly ActionCode[] = [
  ...SPECIALIST_ACTIONS, 'EMBEZZLE', 'ADJUST_TAX', 'SUPPRESS',
];

/**
 * Return the set of ActionCodes legally available to an agent of the given role.
 * Used to construct role-specific prompts so the LLM only picks valid options.
 *
 * Special case: bank agents (role === 'bank') get BANK_ACTIONS which includes
 * ISSUE_LOAN and SET_INTEREST_RATE in addition to the base citizen actions.
 */
export function getAllowedActions(role: string): readonly ActionCode[] {
  if (role.toLowerCase() === 'bank') return BANK_ACTIONS;
  const tier = getRoleTier(role);
  if (tier === 'elite') return ELITE_ACTIONS;
  if (tier === 'specialist') return SPECIALIST_ACTIONS;
  return BASE_ACTIONS;
}
