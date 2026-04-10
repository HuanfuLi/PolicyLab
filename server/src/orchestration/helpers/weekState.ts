import type { SkillMatrix, Inventory } from '@policylab/shared';
import { DEFAULT_SKILL_MATRIX, DEFAULT_INVENTORY } from '@policylab/shared';
import type { QueuedActionInstruction } from '../../llm/prompts/index.js';
import type { AgentEconomyState } from '../../db/repos/economyRepo.js';

export interface AgentWeekState {
  skills: SkillMatrix;
  inventory: Inventory;
  events: string[];
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  cortisolDelta: number;
  dopamineDelta: number;
  executedActions: QueuedActionInstruction[];
  interrupted: boolean;
  interruptedReason: 'starvation' | 'mental_breakdown' | null;
  workedEnterpriseId: string | null;
  quitEnterpriseId: string | null;
  /** Authoritative employer: the ONLY enterprise this agent may WORK_AT_ENTERPRISE in. */
  employer_id: string | null;
  /** MET satiety units consumed this tick (for telemetry). */
  caloriesBurned: number;
  /** Food units produced via PRODUCE_AND_SELL this tick (for telemetry). */
  caloriesProduced: number;
  /** Count of explicitly failed/rejected actions this tick (for telemetry). */
  failedActionCount: number;
}

export function createAgentWeekState(econState?: AgentEconomyState): AgentWeekState {
  return {
    skills: structuredClone(econState?.skills ?? DEFAULT_SKILL_MATRIX),
    inventory: structuredClone(econState?.inventory ?? DEFAULT_INVENTORY),
    events: [],
    wealthDelta: 0,
    healthDelta: 0,
    happinessDelta: 0,
    cortisolDelta: 0,
    dopamineDelta: 0,
    executedActions: [],
    interrupted: false,
    interruptedReason: null,
    workedEnterpriseId: null,
    quitEnterpriseId: null,
    employer_id: null,
    caloriesBurned: 0,
    caloriesProduced: 0,
    failedActionCount: 0,
  };
}

export function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// Wealth has no upper bound — only floored at 0. No rounding: rounding destroys fractional fiat.
export function clampWealth(value: number): number {
  return Math.max(0, value);
}
