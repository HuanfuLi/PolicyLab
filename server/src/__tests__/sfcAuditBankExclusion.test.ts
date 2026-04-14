/**
 * SFC audit bank-exclusion tests — regression tests for H6 (bank-agent wealth
 * double-counted with depositBalances in computeSystemFiatTotal).
 *
 * Plan: 11-GC1 Task 1 (RED phase)
 *
 * Forensics G1 §H6: the JSDoc at helpers/sfcAudit.ts:7 promises bank agents are
 * excluded from the agent fiat sum (their reserves modelled via depositBalances).
 * The current code does NOT filter by `agent.type !== 'bank'`, causing bank wealth
 * to be counted twice: once in agentFiat and once in the depositBalances argument.
 * These tests fail against the current code and must pass after Patch C is applied.
 */
import { describe, it, expect } from 'vitest';
import type { Agent } from '@policylab/shared';
import { computeSystemFiatTotal } from '../orchestration/helpers/sfcAudit.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(id: string, wealth: number, type: 'agent' | 'bank' = 'agent', isAlive = true): Agent {
  return {
    id,
    sessionId: 'sess-sfc-bank-exclusion',
    name: id,
    age: 30,
    role: 'citizen',
    type,
    isAlive,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeSystemFiatTotal bank-exclusion filter (H6)', () => {

  it('computeSystemFiatTotal excludes bank-agent wealth (H6)', () => {
    // Scenario: citizen wealth=100, bank wealth=500.
    // depositBalances=500 represents depositor claims (same money as bank reserves).
    // Correct total = citizen(100) + depositBalances(500) = 600.
    // Buggy total  = citizen(100) + bank(500) + depositBalances(500) = 1100.
    const citizen = makeAgent('citizen-1', 100, 'agent');
    const bank    = makeAgent('bank-1',   500, 'bank');

    const total = computeSystemFiatTotal(
      [citizen, bank],
      undefined,
      undefined,
      /*treasury=*/ 0,
      /*wealthOverrides=*/ undefined,
      /*depositBalances=*/ 500,
      /*collateralEscrow=*/ 0,
      /*publicGoodsEscrow=*/ 0,
    );

    // Must equal 600, NOT 1100
    expect(total).toBeCloseTo(600, 2);
  });

  it('isAlive filter still applied after bank filter (H6 regression)', () => {
    // Dead citizen and dead bank should both be excluded.
    // Alive citizen wealth=200, dead citizen wealth=999, dead bank wealth=5000.
    // Only alive non-bank agent contributes to agentFiat.
    const aliveCitizen = makeAgent('citizen-alive', 200, 'agent', true);
    const deadCitizen  = makeAgent('citizen-dead',  999, 'agent', false);
    const deadBank     = makeAgent('bank-dead',    5000, 'bank',  false);

    const total = computeSystemFiatTotal(
      [aliveCitizen, deadCitizen, deadBank],
      undefined,
      undefined,
      /*treasury=*/ 50,
      undefined,
      /*depositBalances=*/ 0,
      /*collateralEscrow=*/ 0,
      /*publicGoodsEscrow=*/ 0,
    );

    // Should be alive citizen (200) + treasury (50) = 250
    expect(total).toBeCloseTo(250, 2);
  });

  it('alive bank agent is excluded even when depositBalances is zero (H6 edge case)', () => {
    // Without depositBalances, bank wealth is still not part of M0 if the
    // JSDoc contract holds — it is separate from the citizen-fiat accounting.
    const citizen = makeAgent('citizen-1', 300, 'agent');
    const bank    = makeAgent('bank-1',    700, 'bank');

    const total = computeSystemFiatTotal(
      [citizen, bank],
      undefined,
      undefined,
      /*treasury=*/ 100,
      undefined,
      /*depositBalances=*/ 0,
    );

    // Only citizen (300) + treasury (100) = 400 — NOT 1100
    expect(total).toBeCloseTo(400, 2);
  });
});
