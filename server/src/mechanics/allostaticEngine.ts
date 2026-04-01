/**
 * AllostaticEngine — Tasks 1 & 2 of the Tick-Based Architecture
 *
 * TASK 1: Physiological Metabolism (MET System)
 *   Computes per-tick Satiety depletion using Metabolic Equivalent of Task
 *   (MET) values, weighted by body mass (BMR) and age-based biomechanical
 *   inefficiency for physical labour.
 *
 *   Formula chain:
 *     BMR_kcal  = weightKg × 1.0 kcal/hr × TickDuration_hrs
 *     Δ_kcal    = BMR_kcal × MET_Multiplier × AgeModifier
 *     Δ_Satiety = Δ_kcal / SATIETY_KCAL_PER_POINT
 *
 *   Normalisation: SATIETY_KCAL_PER_POINT = 70 (reference 70 kg agent at
 *   REST burns exactly 1.0 satiety point per tick, matching legacy decay).
 *
 * TASK 2: Psychosomatic Decay — Energetic Model of Allostatic Load (EMAL)
 *   Translates transient Cortisol (driven by LLM socio-economic evaluations)
 *   into permanent structural health damage via a 3-step differential pipeline:
 *
 *   Step 1 — Reversible Strain (S_t, IIR filter):
 *     S_t = S_{t-1} + Cortisol - 0.15 × S_{t-1}   ∈ [0, 100]
 *         = 0.85 × S_{t-1} + Cortisol
 *     Equilibrium: S_eq = Cortisol / 0.15 = 6.67 × Cortisol  (capped at 100)
 *
 *   Step 2 — Irreversible Load (L_t) — only accumulates past elasticity limit:
 *     if S_t > 80:  L_t += (S_t - 80) × 0.05
 *
 *   Step 3 — Structural Health Decay (H_t) — only past disease threshold:
 *     if L_t > 500: H -= (L_t - 500) × 0.02
 *
 *   Key property: acute stress (Cortisol spikes → Strain recovers) is harmless.
 *   Only chronic, sustained Cortisol above ~12–15 drives Load past the
 *   elasticity limit and eventually causes irreversible health degradation.
 *
 * MODULE BOUNDARY:
 *   This module is FULLY DETERMINISTIC and LLM-independent (Symbolic layer).
 *   Cortisol input MUST come from the LLM socio-economic pipeline — it is NOT
 *   computed here. This module only applies the biological consequences.
 *
 * STANDALONE: Do NOT import simulationRunner.ts. Integration is deferred.
 */

import type { ActionCode } from './actionCodes.js';
import { physicsConfig } from './physicsConfig.js';

// ── MET Category & Mapping ────────────────────────────────────────────────────

/**
 * Metabolic Equivalent of Task categories.
 * Maps physiological work intensity to a multiplier over resting BMR.
 */
export type MetCategory =
  | 'SLEEP'               // 0.95 — restorative unconscious metabolism
  | 'REST'                // 1.00 — awake but sedentary
  | 'WORK_COGNITIVE'      // 1.40 — mental labour (planning, trading, governance)
  | 'WORK_LIGHT_MANUAL'   // 2.75 — light physical tasks (patrolling, helping)
  | 'WORK_MODERATE_MANUAL'// 4.50 — moderate physical tasks (farming, crafting)
  | 'WORK_HEAVY_MANUAL';  // 7.25 — heavy physical tasks (mining, construction)

/** MET multiplier lookup. Indexed by MetCategory. */
export const MET_VALUES: Record<MetCategory, number> = {
  SLEEP:                0.95,
  REST:                 1.00,
  WORK_COGNITIVE:       1.40,
  WORK_LIGHT_MANUAL:    2.75,
  WORK_MODERATE_MANUAL: 4.50,
  WORK_HEAVY_MANUAL:    7.25,
} as const;

/**
 * Physical-labour categories that incur the age inefficiency modifier.
 * Cognitive and rest categories are excluded per spec.
 */
const PHYSICAL_CATEGORIES = new Set<MetCategory>([
  'WORK_LIGHT_MANUAL',
  'WORK_MODERATE_MANUAL',
  'WORK_HEAVY_MANUAL',
]);

/**
 * Resolve the MET category for a given ActionCode and agent role.
 *
 * Role-based disambiguation for WORK and WORK_AT_ENTERPRISE:
 *   - Elite/specialist roles → WORK_COGNITIVE (administrative, professional)
 *   - Laborer roles          → WORK_LIGHT_MANUAL (physical service work)
 *
 * Enterprise industry override for WORK_AT_ENTERPRISE:
 *   - Pass enterpriseIndustry to get the correct physical intensity.
 */
export function getMetCategory(
  actionCode: ActionCode,
  role: string,
  enterpriseIndustry?: string,
): MetCategory {
  const upper = actionCode.toUpperCase();
  const roleUpper = role.toUpperCase();

  // Determine role tier for WORK disambiguation
  const COGNITIVE_ROLE_RE = /LEADER|GOVERNOR|MINISTER|COMMISSIONER|DIRECTOR|GENERAL|CHIEF|KING|QUEEN|MAYOR|PRESIDENT|CHAIRMAN|SECRETARY|OFFICIAL|COMMANDER|ADMINISTRATOR|JUDGE|MAGISTRATE|OFFICER|MERCHANT|TRADER|SCHOLAR|HEALER|DOCTOR|TEACHER|PRIEST|MONK|SAGE|ENGINEER|SCIENTIST|LAWYER|INSPECTOR|SUPERVISOR|ACCOUNTANT|MANAGER/;
  const isCognitiveRole = COGNITIVE_ROLE_RE.test(roleUpper);

  switch (upper) {
    // ── Rest / Recovery ───────────────────────────────────────────────────
    case 'REST':
      return 'REST';
    case 'SLEEP': // If SLEEP is ever added as an action code
      return 'SLEEP';
    case 'NONE':
      return 'REST'; // Idle agents rest

    // ── Cognitive / Administrative ────────────────────────────────────────
    case 'WORK':
      return isCognitiveRole ? 'WORK_COGNITIVE' : 'WORK_LIGHT_MANUAL';
    case 'INVEST':
    case 'POST_BUY_ORDER':
    case 'POST_SELL_ORDER':
    case 'SET_WAGE':
    case 'EMBEZZLE':
    case 'ADJUST_TAX':
    case 'APPLY_FOR_JOB':
    case 'POST_JOB_OFFER':
    case 'HIRE_EMPLOYEE':
    case 'FIRE_EMPLOYEE':
    case 'FOUND_ENTERPRISE':
      return 'WORK_COGNITIVE';

    case 'SUPPRESS':
      return 'WORK_LIGHT_MANUAL'; // Physical enforcement patrol

    // ── Light Manual ──────────────────────────────────────────────────────
    case 'HELP':
    case 'STRIKE':
    case 'STEAL':
      return 'WORK_LIGHT_MANUAL';

    // ── Moderate Manual ───────────────────────────────────────────────────
    case 'PRODUCE':
    case 'PRODUCE_AND_SELL':
    case 'SABOTAGE':
      return 'WORK_MODERATE_MANUAL';

    // ── Enterprise Work (industry-dependent) ─────────────────────────────
    case 'WORK_AT_ENTERPRISE': {
      if (!enterpriseIndustry) return 'WORK_MODERATE_MANUAL'; // Safe default
      const ind = enterpriseIndustry.toUpperCase();
      if (/EXTRACT|MINING|QUARRY|LUMBER/.test(ind)) return 'WORK_HEAVY_MANUAL';
      if (/MANUFACTUR|TECH|ASSEMBLY|CONSTRUCT/.test(ind)) return 'WORK_MODERATE_MANUAL';
      if (/AGRICULTUR|FARM/.test(ind)) return 'WORK_MODERATE_MANUAL';
      if (/SERVICE|HOSPITALITY|ENTERTAIN|LUXURY/.test(ind)) return isCognitiveRole
        ? 'WORK_COGNITIVE'
        : 'WORK_LIGHT_MANUAL';
      return 'WORK_MODERATE_MANUAL';
    }

    default:
      return 'WORK_COGNITIVE'; // Unknown → assume cognitive, no age penalty
  }
}

// ── MET Calculation ───────────────────────────────────────────────────────────

export interface MetInput {
  /** Agent body weight in kilograms (default 70 if unknown). */
  weightKg: number;
  /** Agent age in years (default 35 if unknown). */
  age: number;
  /** Resolved MET category for this tick. */
  metCategory: MetCategory;
}

export interface MetOutput {
  /** Satiety points to deduct this tick (always ≥ 0). */
  satietyCost: number;
  /** Raw kcal burned this tick (before normalisation). For logging only. */
  kcalBurned: number;
  /** MET multiplier applied. */
  metMultiplier: number;
  /** Age modifier applied (1.0 if not physical or age ≤ 60). */
  ageModifier: number;
  /** Whether the agent is in a physical category subject to age penalty. */
  isPhysical: boolean;
}

/**
 * Compute per-tick satiety cost using the MET system.
 *
 * Age Inefficiency Modifier (physical actions only, age > 60):
 *   modifier = 1.0 + min(((age - 60) / 100) × 0.25, 0.25)
 *   This caps the penalty at +25% for age ≥ 160 (practical max ~100 → +10%).
 *
 * Satiety Normalisation:
 *   Δ_Satiety = (weightKg × MET × AgeModifier) / SATIETY_KCAL_PER_POINT
 *
 *   At 70 kg / REST (MET 1.0): (70 × 1.0 × 1.0) / 70 = 1.0 pt/tick ✓
 *   At 70 kg / HEAVY (MET 7.25): (70 × 7.25 × 1.0) / 70 = 7.25 pt/tick
 *   At 90 kg / COGNITIVE (MET 1.4): (90 × 1.4 × 1.0) / 70 = 1.8 pt/tick
 *
 * PURE FUNCTION — no side effects.
 */
export function computeMetSatietyCost(input: MetInput): MetOutput {
  const { weightKg, age, metCategory } = input;

  const metMultiplier = MET_VALUES[metCategory];
  const isPhysical = PHYSICAL_CATEGORIES.has(metCategory);

  // Age inefficiency modifier (physical actions only, age > 60)
  let ageModifier = 1.0;
  if (isPhysical && age > 60) {
    const rawPenalty = ((age - 60) / 100) * 0.25;
    ageModifier = 1.0 + Math.min(rawPenalty, 0.25);
  }

  // BMR per tick: weightKg × 1.0 kcal/hr × TICK_DURATION_HRS
  const bmrKcal = weightKg * 1.0 * physicsConfig.tickDurationHrs;

  // Total kcal burned this tick
  const kcalBurned = bmrKcal * metMultiplier * ageModifier;

  // Convert kcal to satiety points
  const satietyCost = kcalBurned / physicsConfig.satietyKcalPerPoint;

  return {
    satietyCost,
    kcalBurned,
    metMultiplier,
    ageModifier,
    isPhysical,
  };
}

// ── Allostatic Engine Class ───────────────────────────────────────────────────

/**
 * Persisted state for a single agent's allostatic pipeline.
 * Must be stored in DB and restored each tick (see agent_tick_state table).
 */
export interface AllostaticState {
  /** Reversible physiological strain (S_t). Range [0, 100]. */
  allostaticStrain: number;
  /**
   * Irreversible cumulative allostatic load (L_t). Unbounded above 0.
   * Past 500 it begins destroying structural health.
   */
  allostaticLoad: number;
}

export interface AllostaticTickInput {
  /**
   * Current Cortisol from the agent's stats (0–100).
   * MUST be the value set by the LLM's socio-economic evaluation pipeline —
   * this engine does NOT generate Cortisol, only responds to it.
   */
  cortisol: number;
  /**
   * D2: Current dopamine level (0–100).
   * When ≤ 30, adds +4 cortisol feedback (anhedonia→anxiety loop):
   * chronic low-reward state amplifies stress, modelling poverty/disengagement.
   */
  dopamine?: number;
  /**
   * Guard flag: set to true if dopamine feedback was already applied this iteration
   * (e.g., in a retry scenario). Prevents indefinite stacking of the cortisol bonus.
   */
  dopamineFeedbackApplied?: boolean;
}

export interface AllostaticTickOutput {
  /** Updated allostatic state to persist. */
  updatedState: AllostaticState;
  /** Health delta to apply this tick (≤ 0, or 0 if below disease threshold). */
  healthDelta: number;
  /** Whether strain has crossed the elasticity limit (for logging/debug). */
  strainOverElasticityLimit: boolean;
  /** Whether load has crossed the disease threshold (for logging/debug). */
  loadOverDiseaseThreshold: boolean;
}

/**
 * EMAL — Energetic Model of Allostatic Load.
 *
 * Implements the 3-step psychosomatic decay pipeline per tick.
 *
 * Design invariants:
 *  - A single acute stress spike (Cortisol=80 for 1 tick) only raises Strain
 *    by ~80 points. Strain decays at 15%/tick, so it fully recovers in ~20 ticks
 *    with Cortisol back at 0. No Load accumulates — acute stress is safe.
 *  - Chronic moderate stress (Cortisol=15/tick) drives Strain equilibrium to 100.
 *    Every tick Strain exceeds 80, Load accumulates: (100-80)×0.05 = 1.0/tick.
 *    After 500 ticks of sustained stress, Load crosses 500 → health decays.
 *  - This models poverty/chronic workplace stress correctly: the agent looks
 *    fine for months, then health collapses irreversibly.
 */
export class AllostaticEngine {
  private strain: number;
  private load: number;

  constructor(initialState: AllostaticState = { allostaticStrain: 0, allostaticLoad: 0 }) {
    this.strain = initialState.allostaticStrain;
    this.load = initialState.allostaticLoad;
  }

  /**
   * Execute one tick of the 3-step allostatic pipeline.
   *
   * Step 1 — Reversible Strain (leaky integrator):
   *   S_t = S_{t-1} + Cortisol − (0.15 × S_{t-1})
   *       = 0.85 × S_{t-1} + Cortisol     ∈ [0, 100]
   *
   * Step 2 — Irreversible Load (past elasticity limit):
   *   if S_t > 80:  L_t += (S_t − 80) × 0.05
   *
   * Step 3 — Structural Health Decay (past disease threshold):
   *   if L_t > 500: ΔH = −(L_t − 500) × 0.02
   *
   * PURE COMPUTATION per call — mutation is isolated to this instance.
   */
  tick(input: AllostaticTickInput): AllostaticTickOutput {
    const { cortisol, dopamine, dopamineFeedbackApplied } = input;

    // D2: Dopamine anhedonia feedback — low drive amplifies cortisol.
    // When an agent is chronically under-rewarded (dopamine ≤ 30), their
    // stress system remains elevated even without external stressors.
    // Guard: skip if already applied this iteration to prevent stacking in retries.
    const effectiveCortisol = (
      !dopamineFeedbackApplied &&
      dopamine !== undefined &&
      dopamine <= 30
    )
      ? Math.min(100, cortisol + 4)
      : cortisol;

    // ── Step 1: Reversible Strain ──────────────────────────────────────────
    // Leaky integrator: effectiveCortisol is the forcing signal, 0.15 is the decay rate.
    // Equilibrium reached when dS/dt = 0: S_eq = Cortisol / 0.15 = 6.67 × Cortisol
    // At Cortisol = 15 → S_eq = 100 (cap). At Cortisol = 12 → S_eq = 80 (elasticity limit).
    this.strain = this.strain + effectiveCortisol - (physicsConfig.strainDecay * this.strain);
    this.strain = Math.max(0, Math.min(100, this.strain));

    const strainOverElasticityLimit = this.strain > physicsConfig.strainElasticityLimit;

    // ── Step 2: Irreversible Load ──────────────────────────────────────────
    // Load only accumulates when Strain exceeds the elasticity limit.
    // This is the body's "allostatic overload" — resources are depleted faster
    // than they can be restored, leaving permanent structural damage.
    if (strainOverElasticityLimit) {
      this.load += (this.strain - physicsConfig.strainElasticityLimit) * physicsConfig.loadAccumulationRate;
    }

    const loadOverDiseaseThreshold = this.load > physicsConfig.loadDiseaseThreshold;

    // ── Step 3: Structural Health Decay ───────────────────────────────────
    // Health decay only begins after the disease threshold is breached.
    // Below 500 Load, the body can fully compensate. Above it, structural
    // damage (organ stress, immune dysfunction) is irreversible.
    let healthDelta = 0;
    if (loadOverDiseaseThreshold) {
      healthDelta = -((this.load - physicsConfig.loadDiseaseThreshold) * physicsConfig.healthDecayRate);
      // Clamp to [-100, 0]: upper bound prevents positive healing from stress,
      // lower bound prevents single-tick death even at extreme allostatic load
      healthDelta = Math.max(-100, Math.min(0, healthDelta));
    }

    return {
      updatedState: {
        allostaticStrain: this.strain,
        allostaticLoad: this.load,
      },
      healthDelta,
      strainOverElasticityLimit,
      loadOverDiseaseThreshold,
    };
  }

  /** Restore state (e.g., after loading from DB at simulation resume). */
  restore(state: AllostaticState): void {
    this.strain = state.allostaticStrain;
    this.load = state.allostaticLoad;
  }

  /** Snapshot current state for DB persistence. */
  snapshot(): AllostaticState {
    return {
      allostaticStrain: this.strain,
      allostaticLoad: this.load,
    };
  }

  // ── Diagnostic helpers (for logging / SSE events) ──────────────────────

  /** Estimated ticks until Load crosses the disease threshold at current Strain. */
  ticksUntilDisease(): number | null {
    if (this.load >= physicsConfig.loadDiseaseThreshold) return 0;
    if (!this.strain || this.strain <= physicsConfig.strainElasticityLimit) return null;
    const loadRatePerTick = (this.strain - physicsConfig.strainElasticityLimit) * physicsConfig.loadAccumulationRate;
    if (loadRatePerTick <= 0) return null;
    return Math.ceil((physicsConfig.loadDiseaseThreshold - this.load) / loadRatePerTick);
  }

  /**
   * Cortisol level required to hold Strain at the elasticity limit.
   * If current Cortisol is above this value, Load is accumulating.
   *   S_eq = Cortisol / strainDecay = strainElasticityLimit  →  Cortisol = 80 × 0.15 = 12
   */
  static get CORTISOL_ELASTICITY_THRESHOLD(): number {
    return physicsConfig.strainElasticityLimit * physicsConfig.strainDecay;
  }
}

// ── Compound Per-Tick Function (convenience) ──────────────────────────────────

export interface FullMetabolicTickInput {
  /** Cortisol from LLM evaluation (0–100). */
  cortisol: number;
  /** Agent body weight (kg). Default 70 if not set. */
  weightKg: number;
  /** Agent age (years). Default 35 if not set. */
  age: number;
  /** MET category for this tick's action. */
  metCategory: MetCategory;
  /** Prior allostatic state from DB. */
  allostaticState: AllostaticState;
}

export interface FullMetabolicTickOutput {
  /** Satiety points to deduct (from MET system). */
  satietyCost: number;
  /** Health delta from allostatic load (0 or negative). */
  allostaticHealthDelta: number;
  /** Updated allostatic state to persist. */
  updatedAllostaticState: AllostaticState;
  /** MET diagnostics for logging. */
  met: MetOutput;
  /** Allostatic diagnostics for logging. */
  allostatic: AllostaticTickOutput;
}

/**
 * Convenience function: run both MET metabolism and allostatic pipeline in one call.
 * Suitable for direct use in the tick loop once integration begins.
 *
 * The AllostaticEngine instance is created transiently — for a stateful instance
 * approach, manage one AllostaticEngine per agent in the tick state store.
 */
export function runFullMetabolicTick(input: FullMetabolicTickInput): FullMetabolicTickOutput {
  // Task 1: MET satiety cost
  const met = computeMetSatietyCost({
    weightKg: input.weightKg,
    age: input.age,
    metCategory: input.metCategory,
  });

  // Task 2: Allostatic load pipeline
  const engine = new AllostaticEngine(input.allostaticState);
  const allostatic = engine.tick({ cortisol: input.cortisol });

  return {
    satietyCost: met.satietyCost,
    allostaticHealthDelta: allostatic.healthDelta,
    updatedAllostaticState: allostatic.updatedState,
    met,
    allostatic,
  };
}
