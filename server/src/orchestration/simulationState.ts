/**
 * SimulationState — per-session in-memory state registries for active simulations.
 *
 * Extracted from simulationRunner.ts (Phase B2) to isolate mutable session state
 * from the simulation loop logic. Each Map holds state for one active session.
 *
 * All Maps are keyed by sessionId. Cleanup must be called when a session finishes.
 */
import type { AllostaticState } from '../mechanics/allostaticEngine.js';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../mechanics/automatedMarketMaker.js';
import type { ItemType, TelemetryLog, InflationState } from '@policylab/shared';
import type { MultiplierEffects } from '../mechanics/fiscalEngine.js';

// ── Enterprise & Employment ─────────────────────────────────────────────────

export interface EnterpriseRecord {
  id: string;
  ownerId: string;
  ownerName: string;
  industry: string;
  employees: Set<string>;
  applicants: Set<string>;
  wage: number;
  minSkill: number;
}

export interface EmploymentRecord {
  enterpriseId: string;
  employerId: string;
  employeeId: string;
  wage: number;
  minSkill: number;
  startedAt: number;
}

// ── Session State Registries ────────────────────────────────────────────────

export const sessionEnterpriseRegistry = new Map<string, Map<string, EnterpriseRecord>>();
export const sessionEmploymentRegistry = new Map<string, Map<string, EmploymentRecord>>();
export const sessionPriceHistory = new Map<string, Map<ItemType, number>>();

/** One AutomatedMarketMaker instance per session, persisted across iterations. */
export const sessionAMMRegistry = new Map<string, AutomatedMarketMaker>();

/** Multi-commodity AMM pools for non-food items (raw_materials, luxury_goods). */
export const sessionMultiAMMRegistry = new Map<string, Map<MultiAMMItemType, AutomatedMarketMaker>>();

/** Per-agent allostatic strain/load, persisted across iterations. */
export const sessionAllostaticStates = new Map<string, Map<string, AllostaticState>>();

/** Last iteration's resolved action events per agent, used for feedback injection. */
export const sessionLastActionResults = new Map<string, Map<string, string>>();

/** Macro-level employment metrics from the previous iteration (for survivorship bias fix). */
export const sessionIterationMetrics = new Map<string, string>();

/** Per-session telemetry snapshots (one per completed iteration). */
export const sessionTelemetryLogs = new Map<string, TelemetryLog[]>();

/** Per-session inflation engine state. */
export const sessionInflationState = new Map<string, InflationState>();

/**
 * Stock-Flow Consistency (SFC) tracking: detect fiat leaks/minting between iterations.
 * The economy is fully closed-loop — no state fiat injection. Total must remain constant.
 */
export const sessionSFCTracking = new Map<string, { initialFiat: number }>();

/**
 * State Treasury — funds standalone WORK income. Initialized at session start.
 * Treasury is SFC-compliant: included in the SFC assertion so total fiat is conserved.
 */
export const sessionStateTreasury = new Map<string, number>();

/** Last iteration's physics trace log — injected into next iteration's resolution prompt. */
export const sessionLastPhysicsTraces = new Map<string, string>();

/** Fiscal Policy: multiplier effects from the previous iteration's public goods state. */
export const sessionFiscalMultipliers = new Map<string, MultiplierEffects>();

/** Per-enterprise consecutive insolvency counter (per D-06). Reset on successful payroll. */
export const sessionEnterpriseInsolvency = new Map<string, Map<string, number>>();

/** Per-agent consecutive idle iterations counter (per D-09). Reset on WORK/PRODUCE action. */
export const sessionAgentIdleCounter = new Map<string, Map<string, number>>();

/** Per-enterprise previous wage costs for cost pass-through calculation (per D-07). */
export const sessionPreviousWageCosts = new Map<string, Map<string, number>>();

// ── Trace Helper ────────────────────────────────────────────────────────────

const MAX_TRACE_SIZE = 50_000; // 50 KB cap per session to prevent unbounded growth

/** Append trace content with size cap (keeps most recent data). */
export function appendTrace(sessionId: string, newContent: string): void {
  const existing = sessionLastPhysicsTraces.get(sessionId) ?? '';
  const combined = existing + '\n' + newContent;
  sessionLastPhysicsTraces.set(
    sessionId,
    combined.length > MAX_TRACE_SIZE ? combined.slice(combined.length - MAX_TRACE_SIZE) : combined,
  );
}

// ── Registry Accessors ──────────────────────────────────────────────────────

export function getEnterpriseRegistry(sessionId: string): Map<string, EnterpriseRecord> {
  let reg = sessionEnterpriseRegistry.get(sessionId);
  if (!reg) {
    reg = new Map();
    sessionEnterpriseRegistry.set(sessionId, reg);
  }
  return reg;
}

export function getEmploymentRegistry(sessionId: string): Map<string, EmploymentRecord> {
  let reg = sessionEmploymentRegistry.get(sessionId);
  if (!reg) {
    reg = new Map();
    sessionEmploymentRegistry.set(sessionId, reg);
  }
  return reg;
}

export function getEnterpriseInsolvency(sessionId: string): Map<string, number> {
  let m = sessionEnterpriseInsolvency.get(sessionId);
  if (!m) { m = new Map(); sessionEnterpriseInsolvency.set(sessionId, m); }
  return m;
}

export function getAgentIdleCounter(sessionId: string): Map<string, number> {
  let m = sessionAgentIdleCounter.get(sessionId);
  if (!m) { m = new Map(); sessionAgentIdleCounter.set(sessionId, m); }
  return m;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/** Clean up all in-memory state for a finished/aborted session. */
export function cleanupSessionState(sessionId: string): void {
  sessionAMMRegistry.delete(sessionId);
  sessionMultiAMMRegistry.delete(sessionId);
  sessionAllostaticStates.delete(sessionId);
  sessionLastActionResults.delete(sessionId);
  sessionIterationMetrics.delete(sessionId);
  sessionTelemetryLogs.delete(sessionId);
  sessionInflationState.delete(sessionId);
  sessionSFCTracking.delete(sessionId);
  sessionStateTreasury.delete(sessionId);
  sessionLastPhysicsTraces.delete(sessionId);
  sessionFiscalMultipliers.delete(sessionId);
  sessionPriceHistory.delete(sessionId);
  sessionEnterpriseRegistry.delete(sessionId);
  sessionEmploymentRegistry.delete(sessionId);
  sessionEnterpriseInsolvency.delete(sessionId);
  sessionAgentIdleCounter.delete(sessionId);
  sessionPreviousWageCosts.delete(sessionId);
}
