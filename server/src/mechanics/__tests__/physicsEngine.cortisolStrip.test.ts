import { describe, it, expect } from 'vitest';
import type { Agent } from '@policylab/shared';
import { resolveAction } from '../physicsEngine.js';
import type { ActionCode } from '../actionCodes.js';

// Phase 11 D-01 — strip all per-action cortisol relief from physicsEngine.ts.
// See .planning/phases/11-*/11-RESEARCH.md §1 for the full table of stripped actions.

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent1',
    sessionId: 'session1',
    name: 'Test Agent',
    role: 'farmer',
    background: '',
    initialStats: { wealth: 100, health: 100, happiness: 50, cortisol: 10 },
    currentStats: { wealth: 100, health: 100, happiness: 50, cortisol: 10 },
    isAlive: true,
    status: 'alive',
    type: 'citizen',
    bornAtIteration: 0,
    diedAtIteration: null,
    ...overrides,
  };
}

function resolve(actionCode: ActionCode, overrides: Partial<Agent> = {}) {
  return resolveAction({
    agent: makeAgent(overrides),
    actionCode,
    allAgents: [],
    isFirstAction: true,
  });
}

describe('physicsEngine cortisol-strip (Phase 11 D-01)', () => {
  it('WORK cortisolDelta === 0 (per-action relief removed)', () => {
    expect(resolve('WORK').cortisolDelta).toBe(0);
  });
  it('WORK_AT_ENTERPRISE cortisolDelta === 0', () => {
    expect(resolve('WORK_AT_ENTERPRISE').cortisolDelta).toBe(0);
  });
  it('REST cortisolDelta === 0', () => {
    expect(resolve('REST').cortisolDelta).toBe(0);
  });
  it('PRODUCE_AND_SELL cortisolDelta === 0', () => {
    expect(resolve('PRODUCE_AND_SELL').cortisolDelta).toBe(0);
  });
  it('POST_BUY_ORDER cortisolDelta === 0', () => {
    expect(resolve('POST_BUY_ORDER').cortisolDelta).toBe(0);
  });
  it('POST_SELL_ORDER cortisolDelta === 0', () => {
    expect(resolve('POST_SELL_ORDER').cortisolDelta).toBe(0);
  });
  it('HELP cortisolDelta === 0 (per-action relief removed, altruistic hap retained)', () => {
    const result = resolve('HELP');
    expect(result.cortisolDelta).toBe(0);
    expect(result.happinessDelta).toBe(5); // retained
  });
  it('DEPOSIT cortisolDelta === 0', () => {
    expect(resolve('DEPOSIT').cortisolDelta).toBe(0);
  });
  it('REPAY_LOAN cortisolDelta === 0', () => {
    expect(resolve('REPAY_LOAN').cortisolDelta).toBe(0);
  });
  it('BUY_BOND cortisolDelta === 0', () => {
    expect(resolve('BUY_BOND').cortisolDelta).toBe(0);
  });
  it('ISSUE_GOV_BOND cortisolDelta === 0', () => {
    expect(resolve('ISSUE_GOV_BOND').cortisolDelta).toBe(0);
  });

  // ── Regression guards: outcome-driven actions retained ─────────────────
  it('STEAL retains outcome-driven +10 cortisol (not stripped)', () => {
    expect(resolve('STEAL').cortisolDelta).toBe(10);
  });
  it('STRIKE retains outcome-driven +5 cortisol (not stripped)', () => {
    expect(resolve('STRIKE').cortisolDelta).toBe(5);
  });
  it('QUIT_JOB retains outcome-driven +4 cortisol (edgeCases regression)', () => {
    expect(resolve('QUIT_JOB').cortisolDelta).toBe(4);
  });
  // WARNING 11 fix: BUY_SHARES cortisol baseline is 0 — must not regress upward
  it('BUY_SHARES cortisolDelta === 0 (baseline preserved)', () => {
    expect(resolve('BUY_SHARES').cortisolDelta).toBe(0);
  });

  it('trace.push lines still fire with structural-pressure descriptions for WORK', () => {
    const result = resolve('WORK');
    const traceText = result.trace.join('\n');
    // Trace for cortisol line still present (not deleted) but reworded
    expect(traceText).toMatch(/per-action relief removed/i);
  });
});
