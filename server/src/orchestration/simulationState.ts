/**
 * simulationState.ts — module-level singleton Maps shared across the simulation subsystem.
 *
 * These Maps hold per-session in-memory state that must persist across iteration boundaries
 * (AMM pools, allostatic states, employment registries, telemetry, etc.).
 *
 * Extracted from simulationRunner.ts so that phase modules can import them directly
 * without receiving them as function parameters.
 */
import type { TelemetryLog, InflationState, ItemType } from '@policylab/shared';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../mechanics/automatedMarketMaker.js';
import type { AllostaticState } from '../mechanics/allostaticEngine.js';
import type * as fiscalEngine from '../mechanics/fiscalEngine.js';

// ── Enterprise & Employment ───────────────────────────────────────────────────
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

export interface EnterpriseLedger {
  totalRevenue: number;
  totalWages: number;
  workerCount: number;
}

export const sessionEnterpriseRegistry = new Map<string, Map<string, EnterpriseRecord>>();
export const sessionEmploymentRegistry = new Map<string, Map<string, EmploymentRecord>>();
export const sessionPriceHistory = new Map<string, Map<ItemType, number>>();
export const sessionEnterpriseInsolvency = new Map<string, Map<string, number>>();
export const sessionAgentIdleCounter = new Map<string, Map<string, number>>();
export const sessionPreviousWageCosts = new Map<string, Map<string, number>>();

export function getEnterpriseRegistry(sessionId: string): Map<string, EnterpriseRecord> {
  let m = sessionEnterpriseRegistry.get(sessionId);
  if (!m) { m = new Map(); sessionEnterpriseRegistry.set(sessionId, m); }
  return m;
}

export function getEmploymentRegistry(sessionId: string): Map<string, EmploymentRecord> {
  let m = sessionEmploymentRegistry.get(sessionId);
  if (!m) { m = new Map(); sessionEmploymentRegistry.set(sessionId, m); }
  return m;
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

/** Append to the physics trace log for a session, capping at 50KB. */
export function appendTrace(sessionId: string, newContent: string): void {
  const existing = sessionLastPhysicsTraces.get(sessionId) ?? '';
  const combined = existing + '\n' + newContent;
  sessionLastPhysicsTraces.set(sessionId, combined.length > 50_000 ? combined.slice(-50_000) : combined);
}

// ── AMM ───────────────────────────────────────────────────────────────────────
export const sessionAMMRegistry = new Map<string, AutomatedMarketMaker>();
export const sessionMultiAMMRegistry = new Map<string, Map<MultiAMMItemType, AutomatedMarketMaker>>();

// ── Physiological State ───────────────────────────────────────────────────────
export const sessionAllostaticStates = new Map<string, Map<string, AllostaticState>>();

// ── Action Feedback ───────────────────────────────────────────────────────────
export const sessionLastActionResults = new Map<string, Map<string, string>>();

// ── Telemetry & Metrics ───────────────────────────────────────────────────────
// Macro-level employment metrics from the previous iteration (for survivorship bias fix)
export const sessionIterationMetrics = new Map<string, string>();
// Per-session telemetry snapshots (one per completed iteration)
export const sessionTelemetryLogs = new Map<string, TelemetryLog[]>();
export const sessionInflationState = new Map<string, InflationState>();

// ── SFC Accounting ────────────────────────────────────────────────────────────
// Stock-Flow Consistency tracking: detect fiat leaks/minting between iterations.
export const sessionSFCTracking = new Map<string, { initialFiat: number }>();

// ── Treasury ──────────────────────────────────────────────────────────────────
// State Treasury — funds standalone WORK income. SFC-compliant: included in SFC assertion.
export const sessionStateTreasury = new Map<string, number>();

// ── Physics Trace ─────────────────────────────────────────────────────────────
// Last iteration's physics trace log — injected into next iteration's resolution prompt.
export const sessionLastPhysicsTraces = new Map<string, string>();

// ── Fiscal Multipliers ────────────────────────────────────────────────────────
// Multiplier effects from the previous iteration's public goods state (1-iteration lag).
export const sessionFiscalMultipliers = new Map<string, fiscalEngine.MultiplierEffects>();

// ── Cleanup helper ────────────────────────────────────────────────────────────
/**
 * Remove all session-scoped in-memory state for `sessionId`.
 * Called after simulation completes, errors, or aborts.
 */
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
  sessionEnterpriseRegistry.delete(sessionId);
  sessionEmploymentRegistry.delete(sessionId);
  sessionPriceHistory.delete(sessionId);
  sessionEnterpriseInsolvency.delete(sessionId);
  sessionAgentIdleCounter.delete(sessionId);
  sessionPreviousWageCosts.delete(sessionId);
}
