import { apiFetch } from './client';
import type { AppSettings, SettingsResponse, TestResult } from '@policylab/shared';

export const settingsApi = {
  get: () => apiFetch<SettingsResponse>('/settings'),

  update: (s: Partial<AppSettings>) =>
    apiFetch<SettingsResponse>('/settings', 'PUT', s),

  // Pass the current form state so the server can test with the live key
  // even before the user has clicked Save.
  test: (overrides?: Partial<AppSettings>) =>
    apiFetch<TestResult>('/settings/test', 'POST', overrides ?? {}),

  // Test a specific extra provider slot by index
  testProviderSlot: (index: number, overrides?: Record<string, string>) =>
    apiFetch<TestResult>(`/settings/test-provider/${index}`, 'POST', overrides ?? {}),

  // ── Physics Laboratory API ──────────────────────────────────────────────

  /** Fetch the current live physics configuration (all numerical constants). */
  getPhysicsConfig: () =>
    apiFetch<PhysicsConfigValues>('/settings/physics-config'),

  /** Hot-swap physics constants. Returns the updated full config. */
  updatePhysicsConfig: (updates: Partial<PhysicsConfigValues>) =>
    apiFetch<PhysicsConfigValues>('/settings/physics-config', 'PUT', updates),

  /** Reset all constants to factory defaults. */
  resetPhysicsConfig: () =>
    apiFetch<PhysicsConfigValues>('/settings/physics-config/reset', 'POST'),

  /** Stateless "What-If" trace: run an action on a mock agent, get full math trace. */
  tracePhysics: (input: TracePhysicsInput) =>
    apiFetch<TracePhysicsOutput>('/settings/trace-physics', 'POST', input),

  /** Run the deterministic physics sandbox in --json mode; returns 100-iteration time-series. */
  runSandboxJson: () =>
    apiFetch<SandboxJsonOutput>('/settings/sandbox-json', 'POST'),
};

// ── Physics Lab types (mirrors server/src/mechanics/physicsConfig.ts) ─────────

export interface PhysicsConfigValues {
  passiveStarvationHealthPenalty: number;
  clampDeltaMax: number;
  roleIncomeElite: number;
  roleIncomeArtisan: number;
  roleIncomeScholar: number;
  roleIncomeDefault: number;
  stealRatio: number;
  stealMax: number;
  stealFallback: number;
  lowWealthThreshold: number;
  lowWealthCortisolPenalty: number;
  lowHealthThreshold: number;
  lowHealthCortisolPenalty: number;
  suppressionCortisolPenalty: number;
  suppressionHappinessPenalty: number;
  dopamineDecay: number;
  starvationHealthInterrupt: number;
  mentalBreakdownCortisolInterrupt: number;
  satietyKcalPerPoint: number;
  tickDurationHrs: number;
  strainElasticityLimit: number;
  loadDiseaseThreshold: number;
  strainDecay: number;
  loadAccumulationRate: number;
  healthDecayRate: number;
}

export interface TracePhysicsInput {
  role: string;
  stats: { wealth: number; health: number; happiness: number; cortisol: number; dopamine: number };
  skills?: Record<string, { level: number; experience: number }>;
  actionCode: string;
  isSabotaged?: boolean;
  isSuppressed?: boolean;
}

export interface TracePhysicsOutput {
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  cortisolDelta: number;
  dopamineDelta: number;
  trace: string[];
  finalHappiness: number;
  happinessClamped: boolean;
  clampedHappiness: number;
}

export interface SandboxIterStat {
  avgWealth: number;
  avgHealth: number;
  avgHappiness: number;
  avgCortisol: number;
  avgAllostaticLoad: number;
  spotPrice: number;
}

export interface SandboxJsonOutput {
  iterations: SandboxIterStat[];
  passed: number;
  failed: number;
  allPassed: boolean;
  firstDeathIteration: number | null;
  surplusViolationIteration: number | null;
  exitCode: number;
  error?: string;
}
