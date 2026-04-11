/**
 * Deterministic physics engine for the neuro-symbolic simulation.
 * Given an agent and their chosen action code, compute exact stat deltas.
 * All values clamped to [-clampDeltaMax, +clampDeltaMax] for deltas, [0, 100] for final stats.
 *
 * Phase 1 Enhancement: Now integrate with the economy engine for
 * skill multipliers, inventory effects, and production bonuses.
 *
 * Phase 3 Enhancement: Asymmetric class actions (EMBEZZLE, ADJUST_TAX, SUPPRESS)
 * and buffed WORK income to break poverty traps.
 *
 * Physics Lab: resolveAction now returns a `trace: string[]` field that
 * explains each calculation step for developer debugging and the Laboratory UI.
 */
import type { Agent, SkillMatrix, Inventory } from '@policylab/shared';
import type { ActionCode } from './actionCodes.js';
import { getActionMultiplier } from './skillSystem.js';
import { getToolMultiplier } from './inventorySystem.js';
import { physicsConfig } from './physicsConfig.js';

export interface PhysicsInput {
  agent: Agent;
  actionCode: ActionCode;
  actionParameters?: Record<string, unknown>;
  actionTarget?: string;    // target agentId for TRADE/STEAL/HELP/SUPPRESS
  allAgents: Agent[];
  /** Phase 1: Agent's skill matrix (optional — backward compatible). */
  skills?: SkillMatrix;
  /** Phase 1: Agent's inventory (optional — backward compatible). */
  inventory?: Inventory;
  /** Phase 1: Economy deltas to layer on top (from economy engine). */
  economyDeltas?: {
    wealthDelta: number;
    healthDelta: number;
    cortisolDelta: number;
    happinessDelta: number;
  };
  /** Phase 2: Whether this agent is currently the victim of a SABOTAGE (-50% productivity). */
  isSabotaged?: boolean;
  /** Phase 3: Whether this agent is under active SUPPRESS enforcement (+cortisol, -happiness). */
  isSuppressed?: boolean;
  isFirstAction?: boolean;
  /**
   * Fiscal Policy: public goods multiplier effects from the previous iteration.
   * Applied to WORK/PRODUCE productivity and SUPPRESS enforcement.
   * Default: all zeroes when not provided (backward compatible).
   */
  fiscalMultipliers?: {
    productivityBonus: number;
    skillGainBonus: number;
    enforcementBonus: number;
    welfarePerAgent: number;
  };
}

export interface PhysicsOutput {
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  cortisolDelta: number;
  policyValue?: number;
  policyKey?: 'reserveRequirement' | 'baseLoanInterestRate';
  /**
   * Step-by-step math explanation for every calculation in this result.
   * Populated by resolveAction — always present, may be empty for queue outputs.
   * Use the /api/settings/trace-physics endpoint to retrieve this for the Lab UI.
   */
  trace: string[];
}

/**
 * Role-based income for WORK action.
 * Buffed so a single WORK generates enough surplus to cover ~3-4 iterations of food costs.
 */
function roleIncome(role: string): number {
  const upper = role.toUpperCase();
  if (/LEADER|GOVERNOR|MERCHANT|CHIEF|KING|QUEEN|MAYOR|MINISTER|COMMISSIONER|DIRECTOR/.test(upper)) return physicsConfig.roleIncomeElite;
  if (/ARTISAN|WORKER|FARMER|BUILDER|MINER|SMITH|CARPENTER/.test(upper)) return physicsConfig.roleIncomeArtisan;
  if (/SCHOLAR|HEALER|PRIEST|TEACHER|MONK|DOCTOR|SAGE|ENGINEER|SCIENTIST|RESEARCHER|PROFESSOR/.test(upper)) return physicsConfig.roleIncomeScholar;
  return physicsConfig.roleIncomeDefault;
}

function roleTierLabel(role: string): string {
  const upper = role.toUpperCase();
  if (/LEADER|GOVERNOR|MERCHANT|CHIEF|KING|QUEEN|MAYOR|MINISTER|COMMISSIONER|DIRECTOR/.test(upper)) return 'elite';
  if (/ARTISAN|WORKER|FARMER|BUILDER|MINER|SMITH|CARPENTER/.test(upper)) return 'artisan';
  if (/SCHOLAR|HEALER|PRIEST|TEACHER|MONK|DOCTOR|SAGE|ENGINEER|SCIENTIST|RESEARCHER|PROFESSOR/.test(upper)) return 'scholar';
  return 'default';
}

/** Calculate steal wealth gain */
function stealCalc(agent: Agent, allAgents: Agent[], targetId?: string): number {
  const target = targetId ? allAgents.find(a => a.id === targetId) : undefined;
  // SFC fix V1: Without a live victim there is no wealth transfer — return 0 instead
  // of stealFallback so no fiat is created from nothing.
  if (!target || !target.isAlive) return 0;
  return Math.min(physicsConfig.stealMax, target.currentStats.wealth * physicsConfig.stealRatio);
}

const clampDelta = (v: number): number =>
  Math.max(-physicsConfig.clampDeltaMax, Math.min(physicsConfig.clampDeltaMax, v));

function getNumericActionValue(parameters?: Record<string, unknown>): number | null {
  const value = Number(parameters?.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Psychological clamping — prevents LLM hallucinations of high Happiness
 * during extreme physiological distress.
 *
 * Formula:  maxAllowedHappiness = health − cortisol × 0.5
 */
export function clampHappinessByPhysiology(
  happiness: number,
  health: number,
  cortisol: number,
): number {
  const maxAllowed = Math.max(0, health - cortisol * 0.5);
  return Math.min(happiness, maxAllowed);
}

/**
 * Resolve an agent's action into deterministic stat deltas.
 * Returns a full math trace in result.trace for debugging and the Physics Laboratory UI.
 */
export function resolveAction(input: PhysicsInput): PhysicsOutput {
  const {
    agent,
    actionCode,
    actionParameters,
    actionTarget,
    allAgents,
    skills,
    inventory,
    economyDeltas,
    isSabotaged,
    isSuppressed,
    isFirstAction,
    fiscalMultipliers,
  } = input;
  let w = 0, h = 0, hap = 0, cor = 0;
  let policyValue: PhysicsOutput['policyValue'];
  let policyKey: PhysicsOutput['policyKey'];
  const trace: string[] = [];

  // Fiscal public goods multipliers (default to 0 when not provided — backward compatible)
  const productivityBonus = fiscalMultipliers?.productivityBonus ?? 0;
  const enforcementBonus = fiscalMultipliers?.enforcementBonus ?? 0;

  // Compute skill and tool multipliers if available
  const skillMult = skills ? getActionMultiplier(skills, actionCode) : 1.0;
  const toolMult = inventory ? getToolMultiplier(inventory) : 1.0;
  const sabotageMult = isSabotaged ? 0.5 : 1.0;
  const productionMult = skillMult * toolMult * sabotageMult;

  trace.push(`Action: ${actionCode}`);
  if (skills) trace.push(`  Multipliers: skill=${skillMult.toFixed(2)}, tool=${toolMult.toFixed(2)}, sabotage=${sabotageMult}`);
  trace.push(`  productionMult = ${productionMult.toFixed(3)}`);

  switch (actionCode) {
    case 'WORK': {
      const base = roleIncome(agent.role);
      const infraBoost = 1 + productivityBonus;
      w = base * productionMult * infraBoost;
      h = -2;
      hap = -1;
      cor = -3;
      trace.push(`  Δwealth: roleIncome(${agent.role} = ${roleTierLabel(agent.role)}) = ${base} × productionMult(${productionMult.toFixed(3)}) × infraBoost(${infraBoost.toFixed(3)}) = ${w.toFixed(3)} (funded from state treasury)`);
      if (productivityBonus > 0) trace.push(`  [Fiscal] Infrastructure quality boost: +${(productivityBonus * 100).toFixed(2)}% productivity`);
      trace.push(`  Δhealth: -2 (labor cost)`);
      trace.push(`  Δhappiness: -1 (moderate work satisfaction)`);
      trace.push(`  Δcortisol: -3 (productive relief)`);
      break;
    }
    case 'WORK_AT_ENTERPRISE': {
      // Enterprise income flows through the runner: goods produced → AMM → owner, wages → worker.
      // Physics must NOT add additional wealth here — that would be double income on top of wages.
      w = 0;
      h = -2;
      hap = -1;
      cor = -3;
      trace.push(`  Δwealth: 0 (wages settled by runner's enterprise system — roleIncome suppressed to prevent double income)`);
      trace.push(`  Δhealth: -2 (labor cost)`);
      trace.push(`  Δhappiness: -1 (moderate work satisfaction)`);
      trace.push(`  Δcortisol: -3 (productive relief)`);
      break;
    }
    case 'REST':
      w = 0;
      h = 5;
      hap = 2;
      cor = -5;
      trace.push(`  Δhealth: +5 (physical recovery)`);
      trace.push(`  Δhappiness: +2 (rest satisfaction)`);
      trace.push(`  Δcortisol: -5 (decompression)`);
      break;
    case 'STRIKE':
      w = 0;
      h = 0;
      hap = 5;
      cor = 5;
      trace.push(`  Δhappiness: +5 (collective solidarity)`);
      trace.push(`  Δcortisol: +5 (tension from confrontation)`);
      break;
    case 'STEAL': {
      const stolen = stealCalc(agent, allAgents, actionTarget);
      const target = actionTarget ? allAgents.find(a => a.id === actionTarget) : undefined;
      w = stolen;
      h = -5;
      hap = -3;
      cor = 10;
      if (target) {
        trace.push(`  Δwealth: min(stealMax=${physicsConfig.stealMax}, ${target.currentStats.wealth} × ratio=${physicsConfig.stealRatio}) = ${stolen.toFixed(3)}`);
      } else {
        trace.push(`  Δwealth: no target → 0 (SFC: no victim, no fiat created)`);
      }
      trace.push(`  Δhealth: -5 (physical risk)`);
      trace.push(`  Δhappiness: -3 (moral cost)`);
      trace.push(`  Δcortisol: +10 (legal anxiety)`);
      break;
    }
    case 'HELP':
      w = -5;
      h = 0;
      hap = 5;
      cor = -5;
      trace.push(`  Δwealth: -5 (resources given)`);
      trace.push(`  Δhappiness: +5 (altruistic satisfaction)`);
      trace.push(`  Δcortisol: -5 (social bonding relief)`);
      break;
    case 'INVEST':
      w = -10;
      h = 0;
      hap = -2;
      cor = 3;
      trace.push(`  Δwealth: -10 (capital deployed)`);
      trace.push(`  Δhappiness: -2 (deferred gratification)`);
      trace.push(`  Δcortisol: +3 (investment risk anxiety)`);
      break;
    case 'PRODUCE_AND_SELL':
      w = 0;
      h = -3;
      hap = 1;
      cor = -2;
      trace.push(`  Δwealth: 0 (real revenue flows through economy engine / AMM)`);
      trace.push(`  Δhealth: -3 (physical labor cost)`);
      trace.push(`  Δhappiness: +1 (self-sufficiency satisfaction)`);
      trace.push(`  Δcortisol: -2 (productive activity)`);
      break;
    case 'POST_BUY_ORDER':
    case 'POST_SELL_ORDER':
      w = 0;
      h = 0;
      hap = 1;
      cor = -1;
      trace.push(`  Δwealth: 0 (real flows through AMM / order book)`);
      trace.push(`  Δhappiness: +1 (market participation)`);
      trace.push(`  Δcortisol: -1 (economic agency)`);
      break;
    case 'FOUND_ENTERPRISE':
      // Fix: Founding cost is handled entirely by the economy engine (40 fiat → treasury).
      // The extra -8 here was an SFC violation — 8 fiat destroyed per founding.
      w = 0;
      h = -1;
      hap = 3;
      cor = 5;
      trace.push(`  Δwealth: 0 (founding cost handled by economy engine)`);
      trace.push(`  Δhappiness: +3 (entrepreneurial ambition)`);
      trace.push(`  Δcortisol: +5 (business risk)`);
      break;
    case 'POST_JOB_OFFER':
    case 'HIRE_EMPLOYEE':
    case 'FIRE_EMPLOYEE':
      w = 0;
      h = 0;
      hap = 2;
      cor = 2;
      trace.push(`  Δhappiness: +2 (management action satisfaction)`);
      trace.push(`  Δcortisol: +2 (decision-making stress)`);
      break;
    case 'APPLY_FOR_JOB':
      w = 0;
      h = 0;
      hap = 1;
      cor = 1;
      trace.push(`  Δhappiness: +1 (hopeful)`);
      trace.push(`  Δcortisol: +1 (application anxiety)`);
      break;
    case 'QUIT_JOB':
      w = 0;
      h = 0;
      hap = -1;
      cor = 4;
      trace.push(`  Δhappiness: -1 (loss of security)`);
      trace.push(`  Δcortisol: +4 (uncertainty of unemployment)`);
      break;
    case 'SABOTAGE':
      w = 0;
      h = -8;
      hap = 5;
      cor = 18;
      trace.push(`  Δhealth: -8 (physical risk — injuries, confrontation)`);
      trace.push(`  Δhappiness: +5 (ideological satisfaction)`);
      trace.push(`  Δcortisol: +18 (high danger and legal anxiety)`);
      break;
    case 'EMBEZZLE':
      w = 0; // SFC fix: no phantom fiat — wealth gain handled by runner from communal treasury pool
      h = 0;
      hap = 2;
      cor = 20;
      trace.push(`  Δwealth: 0 (treasury deduction applied separately in runner)`);
      trace.push(`  Δhappiness: +2 (fleeting power satisfaction)`);
      trace.push(`  Δcortisol: +20 (extreme legal anxiety)`);
      break;
    case 'ADJUST_TAX':
      w = 0; // SFC fix: no phantom fiat — wealth comes only from actual tax collected in runner
      h = 0;
      hap = 3;
      cor = 5;
      trace.push(`  Δwealth: 0 (actual tax collected applied separately in runner)`);
      trace.push(`  Δhappiness: +3 (satisfaction from exercising control)`);
      trace.push(`  Δcortisol: +5 (fear of backlash)`);
      break;
    case 'SUPPRESS': {
      // Defense quality (enforcementBonus) increases suppression effectiveness.
      // The suppressor feels more confident with higher enforcement capability.
      const defenseConfidenceBonus = enforcementBonus;
      w = 0;
      h = 0;
      hap = 4 + defenseConfidenceBonus * 10;  // defense quality amplifies domination satisfaction
      cor = 8;
      trace.push(`  Note: target's penalty (+cortisol, -happiness) applied separately in runner`);
      trace.push(`  Δhappiness: +4 (satisfaction from domination)${defenseConfidenceBonus > 0 ? ` + ${(defenseConfidenceBonus * 10).toFixed(2)} (defense quality confidence boost)` : ''}`);
      trace.push(`  Δcortisol: +8 (stress from wielding coercive power)`);
      if (enforcementBonus > 0) trace.push(`  [Fiscal] Defense quality enforcement bonus: +${(enforcementBonus * 100).toFixed(2)}%`);
      break;
    }
    // ── Banking actions ─────────────────────────────────────────────────────
    // These produce NO direct wealth delta in the physics engine.
    // All financial effects come from bankingEngine.processIteration() in simulationRunner.
    // The physics engine only validates, records trace, and provides emotional effects.
    case 'DEPOSIT':
      w = 0;
      h = 0;
      hap = 1;
      cor = -2;
      trace.push(`  Δwealth: 0 (deposit processed by bankingEngine — M1 accounting)`);
      trace.push(`  Δhappiness: +1 (financial security)`);
      trace.push(`  Δcortisol: -2 (savings provide stability)`);
      trace.push(`  [BANK] ${agent.name} requested DEPOSIT`);
      break;
    case 'WITHDRAW':
      w = 0;
      h = 0;
      hap = 0;
      cor = 1;
      trace.push(`  Δwealth: 0 (withdrawal processed by bankingEngine)`);
      trace.push(`  Δcortisol: +1 (liquidity need signal)`);
      trace.push(`  [BANK] ${agent.name} requested WITHDRAW`);
      break;
    case 'TAKE_LOAN':
      w = 0;
      h = 0;
      hap = 2;
      cor = 5;
      trace.push(`  Δwealth: 0 (loan principal credited as deposit by bankingEngine — M1 expansion)`);
      trace.push(`  Δhappiness: +2 (capital access)`);
      trace.push(`  Δcortisol: +5 (debt obligation anxiety)`);
      trace.push(`  [BANK] ${agent.name} requested TAKE_LOAN`);
      break;
    case 'REPAY_LOAN':
      w = 0;
      h = 0;
      hap = 3;
      cor = -3;
      trace.push(`  Δwealth: 0 (repayment debited from deposit by bankingEngine — M1 contraction)`);
      trace.push(`  Δhappiness: +3 (debt reduction relief)`);
      trace.push(`  Δcortisol: -3 (obligation decreasing)`);
      trace.push(`  [BANK] ${agent.name} requested REPAY_LOAN`);
      break;
    case 'ISSUE_LOAN':
      w = 0;
      h = 0;
      hap = 2;
      cor = 3;
      trace.push(`  Δwealth: 0 (loan issuance handled by bankingEngine — M1 expansion)`);
      trace.push(`  Δhappiness: +2 (banking purpose fulfillment)`);
      trace.push(`  Δcortisol: +3 (credit risk exposure)`);
      trace.push(`  [BANK] ${agent.name} (bank agent) issued a loan`);
      break;
    case 'SET_INTEREST_RATE':
      w = 0;
      h = 0;
      hap = 1;
      cor = 2;
      trace.push(`  Δwealth: 0 (rate adjustment — no immediate fiat change)`);
      trace.push(`  Δhappiness: +1 (monetary policy agency)`);
      trace.push(`  Δcortisol: +2 (policy decision stress)`);
      trace.push(`  [BANK] ${agent.name} (bank agent) set interest rate`);
      break;
    case 'SET_RESERVE_RATIO': {
      const requestedValue = getNumericActionValue(actionParameters);
      if (agent.role.toLowerCase() !== 'central_bank') {
        trace.push(`  [CENTRAL_BANK] Only central_bank agents can set reserve ratio`);
        break;
      }
      if (requestedValue === null) {
        trace.push(`  [CENTRAL_BANK] SET_RESERVE_RATIO rejected: numeric "value" parameter required`);
        break;
      }
      const clamped = Math.max(0.05, Math.min(0.50, requestedValue));
      hap = 1;
      cor = 2;
      policyKey = 'reserveRequirement';
      policyValue = clamped;
      trace.push(`  Δwealth: 0 (reserve ratio change is a config update, not immediate fiat movement)`);
      trace.push(`  Δhappiness: +1 (monetary policy agency)`);
      trace.push(`  Δcortisol: +2 (policy decision stress)`);
      trace.push(`  Central bank set reserve ratio to ${clamped} (requested ${requestedValue})`);
      break;
    }
    case 'SET_BASE_RATE': {
      const requestedValue = getNumericActionValue(actionParameters);
      if (agent.role.toLowerCase() !== 'central_bank') {
        trace.push(`  [CENTRAL_BANK] Only central_bank agents can set base rate`);
        break;
      }
      if (requestedValue === null) {
        trace.push(`  [CENTRAL_BANK] SET_BASE_RATE rejected: numeric "value" parameter required`);
        break;
      }
      const clamped = Math.max(0.001, Math.min(0.05, requestedValue));
      hap = 1;
      cor = 2;
      policyKey = 'baseLoanInterestRate';
      policyValue = clamped;
      trace.push(`  Δwealth: 0 (base rate change is a config update, not immediate fiat movement)`);
      trace.push(`  Δhappiness: +1 (monetary policy agency)`);
      trace.push(`  Δcortisol: +2 (policy decision stress)`);
      trace.push(`  Central bank set base rate to ${clamped} (requested ${requestedValue})`);
      break;
    }
    // ── Capital Market actions ───────────────────────────────────────────────
    // These produce NO direct wealth delta in the physics engine.
    // All financial effects come from capitalMarketEngine.processIteration() in simulationRunner.
    // The physics engine only records trace and provides emotional effects.
    case 'BUY_SHARES':
      w = 0;
      h = 0; hap = 1; cor = 0;
      trace.push(`  Δwealth: 0 (share purchase deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δhappiness: +1 (investment optimism)`);
      trace.push(`  [CMKT] ${agent.name} requested BUY_SHARES - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'SELL_SHARES':
      w = 0;
      h = 0; hap = -1; cor = 1;
      trace.push(`  Δwealth: 0 (share sale deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δhappiness: -1 (liquidation reluctance)`);
      trace.push(`  Δcortisol: +1 (exit anxiety)`);
      trace.push(`  [CMKT] ${agent.name} requested SELL_SHARES - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'BUY_BOND':
      w = 0;
      h = 0; hap = 1; cor = -1;
      trace.push(`  Δwealth: 0 (bond purchase deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δhappiness: +1 (financial security via fixed income)`);
      trace.push(`  Δcortisol: -1 (guaranteed return reduces anxiety)`);
      trace.push(`  [CMKT] ${agent.name} requested BUY_BOND - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'ISSUE_GOV_BOND':
      w = 0;
      h = 0; hap = 0; cor = -2;
      trace.push(`  Δwealth: 0 (government bond issuance deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δcortisol: -2 (treasury financing provides fiscal stability)`);
      trace.push(`  [CMKT] Treasury/enterprise ISSUE_GOV_BOND - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'NONE':
    default: {
      // Institutional agents (bank/central_bank) don't suffer personal idle penalties
      const isInstitutionalAgent = agent.type?.toLowerCase() === 'bank' ||
        ['bank', 'central_bank'].includes(agent.role?.toLowerCase() ?? '');
      if (isInstitutionalAgent) {
        w = 0; h = 0; hap = 0; cor = 0;
        trace.push(`  Institutional idle — no personal stat changes`);
      } else {
        w = 0; h = -1; hap = -1; cor = 2;
        trace.push(`  Δhealth: -1 (idle deterioration)`);
        trace.push(`  Δhappiness: -1 (purposelessness)`);
        trace.push(`  Δcortisol: +2 (unfulfilled potential anxiety)`);
      }
      break;
    }
  }

  // ── Layer economy deltas on top ──────────────────────────────────────
  if (economyDeltas) {
    const prev = { w, h, hap, cor };
    w += economyDeltas.wealthDelta;
    h += economyDeltas.healthDelta;
    cor += economyDeltas.cortisolDelta;
    hap += economyDeltas.happinessDelta;
    if (economyDeltas.wealthDelta !== 0 || economyDeltas.healthDelta !== 0) {
      trace.push(`Economy deltas layered: Δwealth ${prev.w.toFixed(3)}→${w.toFixed(3)}, Δhealth ${prev.h.toFixed(3)}→${h.toFixed(3)}, Δcortisol ${prev.cor.toFixed(3)}→${cor.toFixed(3)}, Δhappiness ${prev.hap.toFixed(3)}→${hap.toFixed(3)}`);
    }
  }

  // ── Cortisol auto-escalation for low resources ────────────────────────
  const stats = agent.currentStats;
  if (stats.wealth < physicsConfig.lowWealthThreshold) {
    cor += physicsConfig.lowWealthCortisolPenalty;
    trace.push(`⚠ Low wealth (${stats.wealth} < ${physicsConfig.lowWealthThreshold}): Δcortisol +${physicsConfig.lowWealthCortisolPenalty} (survival anxiety)`);
  }
  if (stats.health < physicsConfig.lowHealthThreshold) {
    cor += physicsConfig.lowHealthCortisolPenalty;
    trace.push(`⚠ Low health (${stats.health} < ${physicsConfig.lowHealthThreshold}): Δcortisol +${physicsConfig.lowHealthCortisolPenalty} (pain response)`);
  }

  // ── Suppression victim ────────────────────────────────────────────────
  if (isSuppressed) {
    cor += physicsConfig.suppressionCortisolPenalty;
    hap += physicsConfig.suppressionHappinessPenalty;
    trace.push(`⚠ Suppression active: Δcortisol +${physicsConfig.suppressionCortisolPenalty}, Δhappiness ${physicsConfig.suppressionHappinessPenalty}`);
  }

  // ── Pre-clamp summary ────────────────────────────────────────────────
  trace.push(`Pre-clamp: Δwealth=${w.toFixed(3)}, Δhealth=${h.toFixed(3)}, Δhappiness=${hap.toFixed(3)}, Δcortisol=${cor.toFixed(3)}`);

  // ── Clamp and report ─────────────────────────────────────────────────
  const cw = clampDelta(w);
  const ch = clampDelta(h);
  const chap = clampDelta(hap);
  const ccor = clampDelta(cor);
  const max = physicsConfig.clampDeltaMax;
  if (cw !== w)   trace.push(`⚠ Δwealth clamped: ${w.toFixed(3)} → ${cw.toFixed(3)} (limit ±${max})`);
  if (ch !== h)   trace.push(`⚠ Δhealth clamped: ${h.toFixed(3)} → ${ch.toFixed(3)} (limit ±${max})`);
  if (chap !== hap) trace.push(`⚠ Δhappiness clamped: ${hap.toFixed(3)} → ${chap.toFixed(3)} (limit ±${max})`);
  if (ccor !== cor) trace.push(`⚠ Δcortisol clamped: ${cor.toFixed(3)} → ${ccor.toFixed(3)} (limit ±${max})`);

  trace.push(`→ Final: Δwealth=${cw.toFixed(3)}, Δhealth=${ch.toFixed(3)}, Δhappiness=${chap.toFixed(3)}, Δcortisol=${ccor.toFixed(3)}`);

  return {
    wealthDelta: cw,
    healthDelta: ch,
    happinessDelta: chap,
    cortisolDelta: ccor,
    policyValue,
    policyKey,
    trace,
  };
}

