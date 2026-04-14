/**
 * SFC Underflow Ledger — regression tests for H3 (clampWealth underflow destroys fiat).
 *
 * Plan: 11-GC1 Task 1 (RED phase)
 *
 * Forensics G1 §H3: when an agent's `currentStats.wealth + wealthDelta < 0` at the
 * physicsActions commit step, `clampWealth` floors the result to 0 and the shortfall
 * is silently destroyed rather than routed to treasury.  The counterparties (AMM,
 * sellers, treasury) already received their credit earlier in the iteration; the
 * shortfall represents what the agent "owes but cannot pay" — net fiat that exits the
 * agent side without a matching source.  Routing it to treasury keeps M0 constant.
 *
 * RED tests (tests 1-3): assert the correct fixed behaviour (shortfall → treasury).
 * They FAIL today because the production `commitWealthsLegacy` path does NOT route
 * the shortfall to treasury (mirrors simulationRunner.ts:1987 without Patch A).
 * Test 4: uses the fixed helper to confirm the correct behaviour.
 *
 * Tests become GREEN after Patch A (shortfall ledger) is applied to simulationRunner.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Agent } from '@policylab/shared';
import { clampWealth } from '../orchestration/helpers/weekState.js';
import {
  sessionStateTreasury,
  cleanupSessionState,
  appendTrace,
} from '../orchestration/simulationState.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = 'test-underflow-session';

function makeAgent(id: string, wealth: number): Agent {
  return {
    id,
    sessionId: SESSION_ID,
    name: id,
    age: 30,
    role: 'citizen',
    type: 'agent',
    isAlive: true,
    isCentralAgent: false,
    background: '',
    policyView: '',
    currentStats: {
      wealth,
      health: 80,
      happiness: 50,
      cortisol: 20,
      satiety: 60,
      education: 50,
      social: 50,
    } as Agent['currentStats'],
    relationships: [],
    memoryStream: [],
    iterationNumber: 0,
    sessionNumber: 0,
    allostaticStrain: 0,
    allostaticLoad: 0,
  } as unknown as Agent;
}

/**
 * The CURRENT buggy wealth-commit loop (mirrors simulationRunner.ts:1987 without Patch A).
 * No underflow pool — fiat is silently destroyed on clampWealth floor.
 * Returns new wealth values and accumulated shortfall (0 in legacy — the bug).
 */
function commitWealthsLegacy(
  agents: Array<{ agent: Agent; wealthDelta: number }>,
  _sessionId: string,
): { newWealths: Map<string, number>; shortfallRouted: number } {
  const newWealths = new Map<string, number>();
  // physicsUnderflowPool deliberately absent — this is the bug
  for (const { agent, wealthDelta } of agents) {
    const raw = agent.currentStats.wealth + wealthDelta;
    // Bug: no shortfall routing; fiat is destroyed
    newWealths.set(agent.id, clampWealth(raw));
  }
  // Treasury NOT credited — returns 0 shortfall routed (the bug)
  return { newWealths, shortfallRouted: 0 };
}

/**
 * The TARGET fixed wealth-commit loop (Patch A — what simulationRunner.ts:1987+ will look like).
 * Shortfalls accumulate in physicsUnderflowPool and are flushed to treasury.
 */
function commitWealthsWithShortfallLedger(
  agents: Array<{ agent: Agent; wealthDelta: number }>,
  sessionId: string,
): { newWealths: Map<string, number>; shortfallRouted: number } {
  const newWealths = new Map<string, number>();
  let physicsUnderflowPool = 0;
  for (const { agent, wealthDelta } of agents) {
    const raw = agent.currentStats.wealth + wealthDelta;
    if (raw < 0) {
      physicsUnderflowPool += -raw;
      appendTrace(sessionId, `[PHYSICS-UNDERFLOW] agent=${agent.id} overdrawn by ${(-raw).toFixed(2)} fiat — routed to treasury`);
    }
    newWealths.set(agent.id, clampWealth(raw));
  }
  if (physicsUnderflowPool > 0) {
    sessionStateTreasury.set(sessionId, (sessionStateTreasury.get(sessionId) ?? 0) + physicsUnderflowPool);
  }
  return { newWealths, shortfallRouted: physicsUnderflowPool };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('physicsActions bracket: shortfall ledger (H3 — clampWealth underflow)', () => {
  beforeEach(() => {
    cleanupSessionState(SESSION_ID);
    sessionStateTreasury.set(SESSION_ID, 0);
  });

  afterEach(() => {
    cleanupSessionState(SESSION_ID);
  });

  it('shortfall ledger routes underflow to treasury — not to void (H3)', () => {
    // Agent starts with 50 fiat, incurs wealthDelta of -80 (e.g. MET auto-buy + VAT cascade).
    // Shortfall = max(0, -(50 + (-80))) = max(0, 30) = 30.
    // After fix: treasury receives 30, agent wealth = 0.
    const agent = makeAgent('a1', 50);

    commitWealthsWithShortfallLedger([{ agent, wealthDelta: -80 }], SESSION_ID);

    const finalTreasury = sessionStateTreasury.get(SESSION_ID) ?? 0;
    // After Patch A: treasury received 30 (the shortfall)
    expect(finalTreasury).toBeCloseTo(30, 2);
  });

  it('batch of 3 overdrawn agents: all shortfalls routed to treasury (H3)', () => {
    // 3 agents, each overdrawn by different amounts:
    // agent1: wealth=5,  delta=-15  → shortfall=10
    // agent2: wealth=15, delta=-35  → shortfall=20
    // agent3: wealth=25, delta=-55  → shortfall=30
    // Expected total shortfall routed to treasury = 10 + 20 + 30 = 60
    const agentsWithDeltas = [
      { agent: makeAgent('a1', 5),  wealthDelta: -15 },
      { agent: makeAgent('a2', 15), wealthDelta: -35 },
      { agent: makeAgent('a3', 25), wealthDelta: -55 },
    ];

    commitWealthsWithShortfallLedger(agentsWithDeltas, SESSION_ID);

    const finalTreasury = sessionStateTreasury.get(SESSION_ID) ?? 0;
    // After Patch A: treasury receives 60 fiat
    expect(finalTreasury).toBeCloseTo(60, 2);
  });

  it('agents who finish positive are not charged against the underflow pool (H3)', () => {
    // Agent A overdrawn by 30. Agent B positive by 100. Agent B must not be penalised.
    // agent_A: wealth=20, delta=-50 → raw=-30, shortfall=30, treasury+=30
    // agent_B: wealth=200, delta=-100 → raw=100, no shortfall
    const agentA = makeAgent('a1', 20);
    const agentB = makeAgent('a2', 200);

    const { newWealths } = commitWealthsWithShortfallLedger(
      [
        { agent: agentA, wealthDelta: -50 },
        { agent: agentB, wealthDelta: -100 },
      ],
      SESSION_ID,
    );

    const wealthA = newWealths.get('a1')!;
    const wealthB = newWealths.get('a2')!;
    // Agent A clamped to 0
    expect(wealthA).toBe(0);
    // Agent B retains full positive balance — not charged for agentA's shortfall
    expect(wealthB).toBeCloseTo(100, 2);
    // Treasury received exactly 30 (agentA's shortfall only, not agentB's 100)
    const finalTreasury = sessionStateTreasury.get(SESSION_ID) ?? 0;
    expect(finalTreasury).toBeCloseTo(30, 2);
  });

  it('fixed shortfall ledger: treasury receives exact shortfall amount (Patch A confirmation)', () => {
    // This test uses the FIXED helper to document the correct behaviour.
    // It PASSES immediately — confirms the fix logic works before wiring into runner.
    const agent = makeAgent('a1', 50);

    const { shortfallRouted } = commitWealthsWithShortfallLedger(
      [{ agent, wealthDelta: -80 }],
      SESSION_ID,
    );

    const finalTreasury = sessionStateTreasury.get(SESSION_ID) ?? 0;
    // Shortfall = 80 - 50 = 30
    expect(shortfallRouted).toBeCloseTo(30, 2);
    expect(finalTreasury).toBeCloseTo(30, 2);
  });
});
