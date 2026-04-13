import { describe, it, expect } from 'vitest';
import type { Agent } from '@policylab/shared';
import { resolveAction } from '../physicsEngine.js';
import type { ActionCode } from '../actionCodes.js';

// Phase 11 D-06 — strip per-action happiness rewards from physicsEngine.ts.
// Parallel treatment to D-01 cortisol strip. Keep outcome-driven happiness
// (STRIKE +5, HELP +5 altruistic, etc.).

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent1',
    sessionId: 'session1',
    name: 'Test Agent',
    role: 'farmer',
    background: '',
    initialStats: { wealth: 100, health: 100, happiness: 50, cortisol: 10, satiety: 80 },
    currentStats: { wealth: 100, health: 100, happiness: 50, cortisol: 10, satiety: 80 },
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

describe('physicsEngine happiness-strip (Phase 11 D-06)', () => {
  it('REST happinessDelta === 0 (per-action reward removed)', () => {
    expect(resolve('REST').happinessDelta).toBe(0);
  });
  it('POST_BUY_ORDER happinessDelta === 0', () => {
    expect(resolve('POST_BUY_ORDER').happinessDelta).toBe(0);
  });
  it('POST_SELL_ORDER happinessDelta === 0', () => {
    expect(resolve('POST_SELL_ORDER').happinessDelta).toBe(0);
  });
  it('PRODUCE_AND_SELL happinessDelta === 0', () => {
    expect(resolve('PRODUCE_AND_SELL').happinessDelta).toBe(0);
  });
  it('DEPOSIT happinessDelta === 0', () => {
    expect(resolve('DEPOSIT').happinessDelta).toBe(0);
  });
  it('REPAY_LOAN happinessDelta === 0', () => {
    expect(resolve('REPAY_LOAN').happinessDelta).toBe(0);
  });
  // WARNING 11 fix: BUY_SHARES was +1 pre-Phase-11 — now stripped
  it('BUY_SHARES happinessDelta === 0 (WARNING 11 fix: was +1, stripped per D-06)', () => {
    expect(resolve('BUY_SHARES').happinessDelta).toBe(0);
  });
  it('BUY_BOND happinessDelta === 0', () => {
    expect(resolve('BUY_BOND').happinessDelta).toBe(0);
  });

  // ── Regression guards: outcome-driven actions retained ─────────────────
  it('STRIKE retains outcome-driven +5 happiness (not stripped)', () => {
    expect(resolve('STRIKE').happinessDelta).toBe(5);
  });
  it('HELP retains outcome-driven altruistic happiness +5 (not stripped)', () => {
    expect(resolve('HELP').happinessDelta).toBe(5);
  });
  it('FOUND_ENTERPRISE retains +3 happiness (entrepreneurial ambition)', () => {
    expect(resolve('FOUND_ENTERPRISE').happinessDelta).toBe(3);
  });
  it('QUIT_JOB retains -1 happiness (edgeCases regression)', () => {
    expect(resolve('QUIT_JOB').happinessDelta).toBe(-1);
  });
});
