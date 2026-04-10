/**
 * Shared module-level session state for the simulation runner and its helper modules.
 *
 * Extracted so helper modules (marketBoard.ts, metabolismRunner.ts, etc.) can reference
 * the same Map instances without circular imports.
 */
import type { ItemType, TelemetryLog, InflationState } from '@policylab/shared';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../mechanics/automatedMarketMaker.js';
import type { AllostaticState } from '../mechanics/allostaticEngine.js';
import type * as fiscalEngine from '../mechanics/fiscalEngine.js';

// ── Enterprise / Employment registries ───────────────────────────────────────

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

/** Per-enterprise ledger: tracks revenue from labor sales vs. wage obligations this iteration. */
export interface EnterpriseLedger {
  totalRevenue: number;
  totalWages: number;
  workerCount: number;
}

export const sessionEnterpriseRegistry = new Map<string, Map<string, EnterpriseRecord>>();
export const sessionEmploymentRegistry = new Map<string, Map<string, EmploymentRecord>>();
export const sessionPriceHistory = new Map<string, Map<ItemType, number>>();

// AMM: one AutomatedMarketMaker instance per session, persisted across iterations
export const sessionAMMRegistry = new Map<string, AutomatedMarketMaker>();
// Multi-commodity AMM pools for non-food items (raw_materials, luxury_goods)
export const sessionMultiAMMRegistry = new Map<string, Map<MultiAMMItemType, AutomatedMarketMaker>>();
// Allostatic states: per-agent strain/load, persisted across iterations
export const sessionAllostaticStates = new Map<string, Map<string, AllostaticState>>();
// Task 4: last iteration's resolved action events per agent, used for feedback injection
export const sessionLastActionResults = new Map<string, Map<string, string>>();
// Macro-level employment metrics from the previous iteration (for survivorship bias fix)
export const sessionIterationMetrics = new Map<string, string>();
// Per-session telemetry snapshots (one per completed iteration)
export const sessionTelemetryLogs = new Map<string, TelemetryLog[]>();
export const sessionInflationState = new Map<string, InflationState>();
// Stock-Flow Consistency (SFC) tracking: detect fiat leaks/minting between iterations.
export const sessionSFCTracking = new Map<string, { initialFiat: number }>();
// D1: State Treasury — funds standalone WORK income. Initialized at session start.
export const sessionStateTreasury = new Map<string, number>();
// D4: Last iteration's physics trace log — injected into next iteration's resolution prompt.
export const sessionLastPhysicsTraces = new Map<string, string>();
// Fiscal Policy: multiplier effects from the previous iteration's public goods state.
export const sessionFiscalMultipliers = new Map<string, fiscalEngine.MultiplierEffects>();

// ── Registry accessors ───────────────────────────────────────────────────────

export function getEnterpriseRegistry(sessionId: string): Map<string, EnterpriseRecord> {
  let registry = sessionEnterpriseRegistry.get(sessionId);
  if (!registry) {
    registry = new Map();
    sessionEnterpriseRegistry.set(sessionId, registry);
  }
  return registry;
}

export function getEmploymentRegistry(sessionId: string): Map<string, EmploymentRecord> {
  let registry = sessionEmploymentRegistry.get(sessionId);
  if (!registry) {
    registry = new Map();
    sessionEmploymentRegistry.set(sessionId, registry);
  }
  return registry;
}
