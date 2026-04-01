/**
 * PhysicsConfig — Centralized "Laws of Nature"
 *
 * All numerical constants that govern the simulation's deterministic physics
 * are defined here. This enables hot-swapping the world's physics at runtime
 * without recompiling or diving into complex engine logic.
 *
 * Used by: physicsEngine.ts, allostaticEngine.ts
 * Exposed via: GET/PUT /api/settings/physics-config
 */

export interface PhysicsConfigValues {
  // ── Economy & Income ──────────────────────────────────────────────────
  /** Health penalty applied per tick when the agent has zero food (starvation). */
  passiveStarvationHealthPenalty: number;
  /** Maximum absolute value for any single stat delta (hard clamp). */
  clampDeltaMax: number;
  /** Base WORK income for Elite roles (Leaders, Governors, Merchants, etc.). */
  roleIncomeElite: number;
  /** Base WORK income for Artisan roles (Farmers, Miners, Smiths, etc.). */
  roleIncomeArtisan: number;
  /** Base WORK income for Scholar roles (Healers, Priests, Teachers, etc.). */
  roleIncomeScholar: number;
  /** Base WORK income for all other roles. */
  roleIncomeDefault: number;

  // ── Steal Mechanic ────────────────────────────────────────────────────
  /** Fraction of target's wealth taken per STEAL action (0–1). */
  stealRatio: number;
  /** Maximum wealth that can be stolen in a single action. */
  stealMax: number;
  /** Steal yield when no valid target exists (untargeted theft). */
  stealFallback: number;

  // ── Stress / Cortisol Auto-Escalation ────────────────────────────────
  /** Wealth floor below which cortisol is automatically escalated. */
  lowWealthThreshold: number;
  /** Cortisol added per tick when agent wealth < lowWealthThreshold. */
  lowWealthCortisolPenalty: number;
  /** Health floor below which cortisol is automatically escalated. */
  lowHealthThreshold: number;
  /** Cortisol added per tick when agent health < lowHealthThreshold. */
  lowHealthCortisolPenalty: number;

  // ── Suppression & Hedonic Adaptation ─────────────────────────────────
  /** Cortisol added per tick to an agent under active SUPPRESS enforcement. */
  suppressionCortisolPenalty: number;
  /** Happiness removed per tick from an agent under active SUPPRESS enforcement. */
  suppressionHappinessPenalty: number;
  /** Hedonic adaptation: dopamine decays by this amount at the end of every tick. */
  dopamineDecay: number;

  // ── Interrupt Thresholds ─────────────────────────────────────────────
  /** Health threshold below which the starvation action-queue interrupt fires. */
  starvationHealthInterrupt: number;
  /** Cortisol threshold above which the mental-breakdown interrupt fires. */
  mentalBreakdownCortisolInterrupt: number;

  // ── Allostatic / Metabolic Engine ────────────────────────────────────
  /** kcal equivalent of one satiety point (normalisation constant for MET system). */
  satietyKcalPerPoint: number;
  /** Duration of one simulation tick in hours (for BMR calculation). */
  tickDurationHrs: number;
  /** Allostatic strain level above which irreversible load starts accumulating. */
  strainElasticityLimit: number;
  /** Cumulative allostatic load above which structural health decay begins. */
  loadDiseaseThreshold: number;
  /** Leaky-integrator decay rate for allostatic strain per tick (fraction recovered). */
  strainDecay: number;
  /** Rate at which surplus strain (above elasticity limit) converts to irreversible load. */
  loadAccumulationRate: number;
  /** Rate at which surplus load (above disease threshold) decays structural health per tick. */
  healthDecayRate: number;
}

const DEFAULTS: PhysicsConfigValues = {
  passiveStarvationHealthPenalty: 10,
  clampDeltaMax: 30,
  roleIncomeElite: 14,
  roleIncomeArtisan: 10,
  roleIncomeScholar: 8,
  roleIncomeDefault: 6,
  stealRatio: 0.15,
  stealMax: 15,
  stealFallback: 3,
  lowWealthThreshold: 20,
  lowWealthCortisolPenalty: 10,
  lowHealthThreshold: 30,
  lowHealthCortisolPenalty: 8,
  suppressionCortisolPenalty: 15,
  suppressionHappinessPenalty: -8,
  dopamineDecay: -3,
  starvationHealthInterrupt: 20,
  mentalBreakdownCortisolInterrupt: 90,
  satietyKcalPerPoint: 70,
  tickDurationHrs: 1,
  strainElasticityLimit: 80.0,
  loadDiseaseThreshold: 500.0,
  strainDecay: 0.15,
  loadAccumulationRate: 0.05,
  healthDecayRate: 0.02,
};

/** Live physics configuration — mutated by updatePhysicsConfig at runtime. */
export const physicsConfig: PhysicsConfigValues = { ...DEFAULTS };

/** Read the current physics configuration (read-only view). */
export function getPhysicsConfig(): Readonly<PhysicsConfigValues> {
  return physicsConfig;
}

/**
 * Hot-swap one or more physics constants at runtime.
 * Changes take effect immediately on the next resolveAction / allostatic tick call.
 */
export function updatePhysicsConfig(updates: Partial<PhysicsConfigValues>): PhysicsConfigValues {
  // Validate that only known keys are updated and values are finite numbers
  for (const [key, value] of Object.entries(updates)) {
    if (!(key in DEFAULTS)) continue; // silently ignore unknown keys
    if (typeof value === 'number' && Number.isFinite(value)) {
      (physicsConfig as unknown as Record<string, number>)[key] = value;
    }
  }
  return physicsConfig;
}

/** Reset all physics constants to factory defaults. */
export function resetPhysicsConfig(): PhysicsConfigValues {
  Object.assign(physicsConfig, DEFAULTS);
  return physicsConfig;
}
