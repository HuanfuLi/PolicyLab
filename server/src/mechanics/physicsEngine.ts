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

export interface PhysicsQueuedAction {
  actionCode: ActionCode;
  parameters?: Record<string, unknown>;
}

export interface PhysicsInput {
  agent: Agent;
  actionCode: ActionCode;
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
  /** True only for the first action in the queue — dopamine decay fires once per week, not per action. */
  isFirstAction?: boolean;
}

export interface PhysicsQueueInput {
  agent: Agent;
  actionQueue: PhysicsQueuedAction[];
  allAgents: Agent[];
  skills?: SkillMatrix;
  inventory?: Inventory;
  economyDeltasByAction?: Array<PhysicsInput['economyDeltas'] | undefined>;
  isSabotaged?: boolean;
  isSuppressed?: boolean;
}

export interface PhysicsOutput {
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  cortisolDelta: number;
  dopamineDelta: number;
  /**
   * Step-by-step math explanation for every calculation in this result.
   * Populated by resolveAction — always present, may be empty for queue outputs.
   * Use the /api/settings/trace-physics endpoint to retrieve this for the Lab UI.
   */
  trace: string[];
}

export interface PhysicsQueueOutput extends PhysicsOutput {
  actionsAttempted: number;
  actionsExecuted: number;
  interrupted: boolean;
  interruptedReason: 'starvation' | 'mental_breakdown' | null;
  executedActions: PhysicsQueuedAction[];
  skippedActions: PhysicsQueuedAction[];
  foodConsumed: number;
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
  if (!target || !target.isAlive) return physicsConfig.stealFallback;
  return Math.min(physicsConfig.stealMax, target.currentStats.wealth * physicsConfig.stealRatio);
}

const clampDelta = (v: number): number =>
  Math.max(-physicsConfig.clampDeltaMax, Math.min(physicsConfig.clampDeltaMax, v));

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
  const { agent, actionCode, actionTarget, allAgents, skills, inventory, economyDeltas, isSabotaged, isSuppressed, isFirstAction } = input;
  let w = 0, h = 0, hap = 0, cor = 0, dop = 0;
  const trace: string[] = [];

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
      w = base * productionMult;
      h = -2;
      hap = -1;
      cor = -3;
      dop = 2;
      trace.push(`  Δwealth: roleIncome(${agent.role} = ${roleTierLabel(agent.role)}) = ${base} × productionMult(${productionMult.toFixed(3)}) = ${w.toFixed(3)} (funded from state treasury)`);
      trace.push(`  Δhealth: -2 (labor cost)`);
      trace.push(`  Δhappiness: -1 (moderate work satisfaction)`);
      trace.push(`  Δcortisol: -3 (productive relief)`);
      trace.push(`  Δdopamine: +2 (effort reward)`);
      break;
    }
    case 'WORK_AT_ENTERPRISE': {
      // Enterprise income flows through the runner: goods produced → AMM → owner, wages → worker.
      // Physics must NOT add additional wealth here — that would be double income on top of wages.
      w = 0;
      h = -2;
      hap = -1;
      cor = -3;
      dop = 2;
      trace.push(`  Δwealth: 0 (wages settled by runner's enterprise system — roleIncome suppressed to prevent double income)`);
      trace.push(`  Δhealth: -2 (labor cost)`);
      trace.push(`  Δhappiness: -1 (moderate work satisfaction)`);
      trace.push(`  Δcortisol: -3 (productive relief)`);
      trace.push(`  Δdopamine: +2 (effort reward)`);
      break;
    }
    case 'REST':
      w = 0;
      h = 5;
      hap = 2;
      cor = -5;
      dop = 1;
      trace.push(`  Δhealth: +5 (physical recovery)`);
      trace.push(`  Δhappiness: +2 (rest satisfaction)`);
      trace.push(`  Δcortisol: -5 (decompression)`);
      trace.push(`  Δdopamine: +1 (calm reward)`);
      break;
    case 'STRIKE':
      w = 0;
      h = 0;
      hap = 5;
      cor = 5;
      dop = 4;
      trace.push(`  Δhappiness: +5 (collective solidarity)`);
      trace.push(`  Δcortisol: +5 (tension from confrontation)`);
      trace.push(`  Δdopamine: +4 (ideological energy)`);
      break;
    case 'STEAL': {
      const stolen = stealCalc(agent, allAgents, actionTarget);
      const target = actionTarget ? allAgents.find(a => a.id === actionTarget) : undefined;
      w = stolen;
      h = -5;
      hap = -3;
      cor = 10;
      dop = 5;
      if (target) {
        trace.push(`  Δwealth: min(stealMax=${physicsConfig.stealMax}, ${target.currentStats.wealth} × ratio=${physicsConfig.stealRatio}) = ${stolen.toFixed(3)}`);
      } else {
        trace.push(`  Δwealth: no target → fallback=${physicsConfig.stealFallback}`);
      }
      trace.push(`  Δhealth: -5 (physical risk)`);
      trace.push(`  Δhappiness: -3 (moral cost)`);
      trace.push(`  Δcortisol: +10 (legal anxiety)`);
      trace.push(`  Δdopamine: +5 (adrenaline)`);
      break;
    }
    case 'HELP':
      w = -5;
      h = 0;
      hap = 5;
      cor = -5;
      dop = 5;
      trace.push(`  Δwealth: -5 (resources given)`);
      trace.push(`  Δhappiness: +5 (altruistic satisfaction)`);
      trace.push(`  Δcortisol: -5 (social bonding relief)`);
      trace.push(`  Δdopamine: +5 (prosocial reward)`);
      break;
    case 'INVEST':
      w = -10;
      h = 0;
      hap = -2;
      cor = 3;
      dop = 2;
      trace.push(`  Δwealth: -10 (capital deployed)`);
      trace.push(`  Δhappiness: -2 (deferred gratification)`);
      trace.push(`  Δcortisol: +3 (investment risk anxiety)`);
      trace.push(`  Δdopamine: +2 (future-oriented reward)`);
      break;
    case 'PRODUCE_AND_SELL':
      w = 0;
      h = -3;
      hap = 1;
      cor = -2;
      dop = 2;
      trace.push(`  Δwealth: 0 (real revenue flows through economy engine / AMM)`);
      trace.push(`  Δhealth: -3 (physical labor cost)`);
      trace.push(`  Δhappiness: +1 (self-sufficiency satisfaction)`);
      trace.push(`  Δcortisol: -2 (productive activity)`);
      trace.push(`  Δdopamine: +2 (creative effort reward)`);
      break;
    case 'POST_BUY_ORDER':
    case 'POST_SELL_ORDER':
      w = 0;
      h = 0;
      hap = 1;
      cor = -1;
      dop = 1;
      trace.push(`  Δwealth: 0 (real flows through AMM / order book)`);
      trace.push(`  Δhappiness: +1 (market participation)`);
      trace.push(`  Δcortisol: -1 (economic agency)`);
      trace.push(`  Δdopamine: +1 (market interaction)`);
      break;
    case 'FOUND_ENTERPRISE':
      w = -8;
      h = -1;
      hap = 3;
      cor = 5;
      dop = 4;
      trace.push(`  Δwealth: -8 (setup costs — main founding cost via economy engine)`);
      trace.push(`  Δhappiness: +3 (entrepreneurial ambition)`);
      trace.push(`  Δcortisol: +5 (business risk)`);
      trace.push(`  Δdopamine: +4 (ownership excitement)`);
      break;
    case 'POST_JOB_OFFER':
    case 'HIRE_EMPLOYEE':
    case 'FIRE_EMPLOYEE':
      w = 0;
      h = 0;
      hap = 2;
      cor = 2;
      dop = 2;
      trace.push(`  Δhappiness: +2 (management action satisfaction)`);
      trace.push(`  Δcortisol: +2 (decision-making stress)`);
      trace.push(`  Δdopamine: +2 (control reward)`);
      break;
    case 'APPLY_FOR_JOB':
      w = 0;
      h = 0;
      hap = 1;
      cor = 1;
      dop = 1;
      trace.push(`  Δhappiness: +1 (hopeful)`);
      trace.push(`  Δcortisol: +1 (application anxiety)`);
      trace.push(`  Δdopamine: +1 (anticipation)`);
      break;
    case 'QUIT_JOB':
      w = 0;
      h = 0;
      hap = -1;
      cor = 4;
      dop = 0;
      trace.push(`  Δhappiness: -1 (loss of security)`);
      trace.push(`  Δcortisol: +4 (uncertainty of unemployment)`);
      break;
    case 'SABOTAGE':
      w = 0;
      h = -8;
      hap = 5;
      cor = 18;
      dop = 7;
      trace.push(`  Δhealth: -8 (physical risk — injuries, confrontation)`);
      trace.push(`  Δhappiness: +5 (ideological satisfaction)`);
      trace.push(`  Δcortisol: +18 (high danger and legal anxiety)`);
      trace.push(`  Δdopamine: +7 (adrenaline rush)`);
      break;
    case 'EMBEZZLE':
      w = 0; // SFC fix: no phantom fiat — wealth gain handled by runner from communal treasury pool
      h = 0;
      hap = 2;
      cor = 20;
      dop = 8;
      trace.push(`  Δwealth: 0 (treasury deduction applied separately in runner)`);
      trace.push(`  Δhappiness: +2 (fleeting power satisfaction)`);
      trace.push(`  Δcortisol: +20 (extreme legal anxiety)`);
      trace.push(`  Δdopamine: +8 (adrenaline of corruption)`);
      break;
    case 'ADJUST_TAX':
      w = 0; // SFC fix: no phantom fiat — wealth comes only from actual tax collected in runner
      h = 0;
      hap = 3;
      cor = 5;
      dop = 4;
      trace.push(`  Δwealth: 0 (actual tax collected applied separately in runner)`);
      trace.push(`  Δhappiness: +3 (satisfaction from exercising control)`);
      trace.push(`  Δcortisol: +5 (fear of backlash)`);
      trace.push(`  Δdopamine: +4 (political power reward)`);
      break;
    case 'SUPPRESS':
      w = 0;
      h = 0;
      hap = 4;
      cor = 8;
      dop = 6;
      trace.push(`  Note: target's penalty (+cortisol, -happiness) applied separately in runner`);
      trace.push(`  Δhappiness: +4 (satisfaction from domination)`);
      trace.push(`  Δcortisol: +8 (stress from wielding coercive power)`);
      trace.push(`  Δdopamine: +6 (domination reward)`);
      break;
    // ── Banking actions ─────────────────────────────────────────────────────
    // These produce NO direct wealth delta in the physics engine.
    // All financial effects come from bankingEngine.processIteration() in simulationRunner.
    // The physics engine only validates, records trace, and provides emotional effects.
    case 'DEPOSIT':
      w = 0;
      h = 0;
      hap = 1;
      cor = -2;
      dop = 1;
      trace.push(`  Δwealth: 0 (deposit processed by bankingEngine — M1 accounting)`);
      trace.push(`  Δhappiness: +1 (financial security)`);
      trace.push(`  Δcortisol: -2 (savings provide stability)`);
      trace.push(`  Δdopamine: +1 (prudent saving reward)`);
      trace.push(`  [BANK] ${agent.name} requested DEPOSIT`);
      break;
    case 'WITHDRAW':
      w = 0;
      h = 0;
      hap = 0;
      cor = 1;
      dop = 0;
      trace.push(`  Δwealth: 0 (withdrawal processed by bankingEngine)`);
      trace.push(`  Δcortisol: +1 (liquidity need signal)`);
      trace.push(`  [BANK] ${agent.name} requested WITHDRAW`);
      break;
    case 'TAKE_LOAN':
      w = 0;
      h = 0;
      hap = 2;
      cor = 5;
      dop = 3;
      trace.push(`  Δwealth: 0 (loan principal credited as deposit by bankingEngine — M1 expansion)`);
      trace.push(`  Δhappiness: +2 (capital access)`);
      trace.push(`  Δcortisol: +5 (debt obligation anxiety)`);
      trace.push(`  Δdopamine: +3 (investment opportunity reward)`);
      trace.push(`  [BANK] ${agent.name} requested TAKE_LOAN`);
      break;
    case 'REPAY_LOAN':
      w = 0;
      h = 0;
      hap = 3;
      cor = -3;
      dop = 2;
      trace.push(`  Δwealth: 0 (repayment debited from deposit by bankingEngine — M1 contraction)`);
      trace.push(`  Δhappiness: +3 (debt reduction relief)`);
      trace.push(`  Δcortisol: -3 (obligation decreasing)`);
      trace.push(`  Δdopamine: +2 (progress reward)`);
      trace.push(`  [BANK] ${agent.name} requested REPAY_LOAN`);
      break;
    case 'ISSUE_LOAN':
      w = 0;
      h = 0;
      hap = 2;
      cor = 3;
      dop = 3;
      trace.push(`  Δwealth: 0 (loan issuance handled by bankingEngine — M1 expansion)`);
      trace.push(`  Δhappiness: +2 (banking purpose fulfillment)`);
      trace.push(`  Δcortisol: +3 (credit risk exposure)`);
      trace.push(`  Δdopamine: +3 (lending business reward)`);
      trace.push(`  [BANK] ${agent.name} (bank agent) issued a loan`);
      break;
    case 'SET_INTEREST_RATE':
      w = 0;
      h = 0;
      hap = 1;
      cor = 2;
      dop = 2;
      trace.push(`  Δwealth: 0 (rate adjustment — no immediate fiat change)`);
      trace.push(`  Δhappiness: +1 (monetary policy agency)`);
      trace.push(`  Δcortisol: +2 (policy decision stress)`);
      trace.push(`  Δdopamine: +2 (control reward)`);
      trace.push(`  [BANK] ${agent.name} (bank agent) set interest rate`);
      break;
    // ── Capital Market actions ───────────────────────────────────────────────
    // These produce NO direct wealth delta in the physics engine.
    // All financial effects come from capitalMarketEngine.processIteration() in simulationRunner.
    // The physics engine only records trace and provides emotional effects.
    case 'BUY_SHARES':
      w = 0;
      h = 0; hap = 1; cor = 0; dop = 1;
      trace.push(`  Δwealth: 0 (share purchase deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δhappiness: +1 (investment optimism)`);
      trace.push(`  Δdopamine: +1 (ownership anticipation)`);
      trace.push(`  [CMKT] ${agent.name} requested BUY_SHARES - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'SELL_SHARES':
      w = 0;
      h = 0; hap = -1; cor = 1; dop = -1;
      trace.push(`  Δwealth: 0 (share sale deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δhappiness: -1 (liquidation reluctance)`);
      trace.push(`  Δcortisol: +1 (exit anxiety)`);
      trace.push(`  Δdopamine: -1 (relinquishing ownership)`);
      trace.push(`  [CMKT] ${agent.name} requested SELL_SHARES - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'BUY_BOND':
      w = 0;
      h = 0; hap = 1; cor = -1; dop = 1;
      trace.push(`  Δwealth: 0 (bond purchase deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δhappiness: +1 (financial security via fixed income)`);
      trace.push(`  Δcortisol: -1 (guaranteed return reduces anxiety)`);
      trace.push(`  Δdopamine: +1 (prudent investment reward)`);
      trace.push(`  [CMKT] ${agent.name} requested BUY_BOND - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'ISSUE_GOV_BOND':
      w = 0;
      h = 0; hap = 0; cor = -2; dop = 1;
      trace.push(`  Δwealth: 0 (government bond issuance deferred to capitalMarketEngine.processIteration())`);
      trace.push(`  Δcortisol: -2 (treasury financing provides fiscal stability)`);
      trace.push(`  Δdopamine: +1 (fiscal policy agency)`);
      trace.push(`  [CMKT] Treasury/enterprise ISSUE_GOV_BOND - deferred to capitalMarketEngine.processIteration()`);
      break;

    case 'NONE':
    default:
      w = 0;
      h = -1;
      hap = -1;
      cor = 2;
      dop = -2;
      trace.push(`  Δhealth: -1 (idle deterioration)`);
      trace.push(`  Δhappiness: -1 (purposelessness)`);
      trace.push(`  Δcortisol: +2 (unfulfilled potential anxiety)`);
      trace.push(`  Δdopamine: -2 (lack of stimulation)`);
      break;
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

  // ── Dopamine decay (hedonic adaptation) — once per week, not per action ─
  // isFirstAction guards this so multi-action queues don't multiply the decay.
  if (isFirstAction !== false) {
    dop += physicsConfig.dopamineDecay;
    trace.push(`Hedonic adaptation: Δdopamine ${physicsConfig.dopamineDecay} (decay)`);
  }

  // ── Pre-clamp summary ────────────────────────────────────────────────
  trace.push(`Pre-clamp: Δwealth=${w.toFixed(3)}, Δhealth=${h.toFixed(3)}, Δhappiness=${hap.toFixed(3)}, Δcortisol=${cor.toFixed(3)}, Δdopamine=${dop.toFixed(3)}`);

  // ── Clamp and report ─────────────────────────────────────────────────
  const cw = clampDelta(w);
  const ch = clampDelta(h);
  const chap = clampDelta(hap);
  const ccor = clampDelta(cor);
  const cdop = clampDelta(dop);
  const max = physicsConfig.clampDeltaMax;
  if (cw !== w)   trace.push(`⚠ Δwealth clamped: ${w.toFixed(3)} → ${cw.toFixed(3)} (limit ±${max})`);
  if (ch !== h)   trace.push(`⚠ Δhealth clamped: ${h.toFixed(3)} → ${ch.toFixed(3)} (limit ±${max})`);
  if (chap !== hap) trace.push(`⚠ Δhappiness clamped: ${hap.toFixed(3)} → ${chap.toFixed(3)} (limit ±${max})`);
  if (ccor !== cor) trace.push(`⚠ Δcortisol clamped: ${cor.toFixed(3)} → ${ccor.toFixed(3)} (limit ±${max})`);
  if (cdop !== dop) trace.push(`⚠ Δdopamine clamped: ${dop.toFixed(3)} → ${cdop.toFixed(3)} (limit ±${max})`);

  trace.push(`→ Final: Δwealth=${cw.toFixed(3)}, Δhealth=${ch.toFixed(3)}, Δhappiness=${chap.toFixed(3)}, Δcortisol=${ccor.toFixed(3)}, Δdopamine=${cdop.toFixed(3)}`);

  return {
    wealthDelta: cw,
    healthDelta: ch,
    happinessDelta: chap,
    cortisolDelta: ccor,
    dopamineDelta: cdop,
    trace,
  };
}

export function resolveActionQueue(input: PhysicsQueueInput): PhysicsQueueOutput {
  const {
    agent,
    actionQueue,
    allAgents,
    skills,
    inventory,
    economyDeltasByAction,
    isSabotaged,
    isSuppressed,
  } = input;

  const queue = actionQueue.slice(0, 3);
  const runningStats = {
    wealth: agent.currentStats.wealth,
    health: agent.currentStats.health,
    happiness: agent.currentStats.happiness,
    cortisol: agent.currentStats.cortisol ?? 20,
    dopamine: agent.currentStats.dopamine ?? 50,
  };

  let wealthDelta = 0;
  let healthDelta = 0;
  let happinessDelta = 0;
  let cortisolDelta = 0;
  let dopamineDelta = 0;
  let interrupted = false;
  let interruptedReason: PhysicsQueueOutput['interruptedReason'] = null;

  const executedActions: PhysicsQueuedAction[] = [];
  const skippedActions: PhysicsQueuedAction[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const queued = queue[index];
    const targetCandidate = queued.parameters?.target ?? queued.parameters?.agent_id;
    const targetId = typeof targetCandidate === 'string' ? targetCandidate : undefined;

    const effect = resolveAction({
      agent: {
        ...agent,
        currentStats: {
          ...agent.currentStats,
          wealth: runningStats.wealth,
          health: runningStats.health,
          happiness: runningStats.happiness,
          cortisol: runningStats.cortisol,
          dopamine: runningStats.dopamine,
        },
      },
      actionCode: queued.actionCode,
      actionTarget: targetId,
      allAgents,
      skills,
      inventory,
      economyDeltas: economyDeltasByAction?.[index],
      isSabotaged,
      isSuppressed,
    });

    wealthDelta += effect.wealthDelta;
    healthDelta += effect.healthDelta;
    happinessDelta += effect.happinessDelta;
    cortisolDelta += effect.cortisolDelta;
    dopamineDelta += effect.dopamineDelta;

    runningStats.wealth = Math.max(0, runningStats.wealth + effect.wealthDelta);
    runningStats.health = Math.max(0, Math.min(100, runningStats.health + effect.healthDelta));
    runningStats.happiness = Math.max(0, Math.min(100, runningStats.happiness + effect.happinessDelta));
    runningStats.cortisol = Math.max(0, Math.min(100, runningStats.cortisol + effect.cortisolDelta));
    runningStats.dopamine = Math.max(0, Math.min(100, runningStats.dopamine + effect.dopamineDelta));

    executedActions.push(queued);

    if (runningStats.health < physicsConfig.starvationHealthInterrupt) {
      interrupted = true;
      interruptedReason = 'starvation';
    } else if (runningStats.cortisol > physicsConfig.mentalBreakdownCortisolInterrupt) {
      interrupted = true;
      interruptedReason = 'mental_breakdown';
    }

    if (interrupted) {
      skippedActions.push(...queue.slice(index + 1));
      break;
    }
  }

  // NOTE: Food consumption and starvation penalties are handled exclusively by
  // applyMETMetabolism in simulationRunner.ts (MET-based physiology). This function
  // must NOT apply its own starvation penalty — that would cause double-counting.
  const foodConsumed = 0;

  // NOTE: Individual resolveAction calls already clamp each delta to ±clampDeltaMax.
  // Do NOT re-clamp the sum here — that would cap a 3-action queue to the same range
  // as a single action, making multi-action queues pointless for stat accumulation.
  return {
    wealthDelta,
    healthDelta,
    happinessDelta,
    cortisolDelta,
    dopamineDelta,
    actionsAttempted: queue.length,
    actionsExecuted: executedActions.length,
    interrupted,
    interruptedReason,
    executedActions,
    skippedActions,
    foodConsumed,
    trace: [], // queue-level aggregation: see individual resolveAction calls for per-action traces
  };
}
