/**
 * GC2 regression test: groupResolution prompt size stays within LLM budget.
 *
 * Forensics-G2: the physics trace buffer accumulated across iterations
 * (appendTrace never resets between iterations), causing prompt sizes of
 * ~13,800 tokens — brushing a 20k-context model's ceiling. This test
 * guards against prompt-size regressions.
 *
 * Tests:
 *   1. groupResolution prompt stays under 32KB after 5 iterations of trace accumulation
 *   2. Steady-state prompt is stable AND within budget across iterations
 *   3. physicsLog embed is tail-sliced to 8KB max at the prompt boundary
 *
 * Expected RED state (before fix):
 *   - Tests 1 + 2 fail: 50KB cap × multi-iteration accumulation → ~55KB ≈ 13.8k tokens, over 32KB
 *   - Test 3 fails: physicsLog embed has no slice, so 40KB payload passes through verbatim
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Agent } from '@policylab/shared';
import { buildGroupResolutionMessages } from '../llm/prompts/central-agent.js';
import type { AgentIntent } from '../llm/prompts/shared.js';
import {
  appendTrace,
  sessionLastPhysicsTraces,
} from '../orchestration/simulationState.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

const SESSION_ID = 'gc2-test-session';

/**
 * Build a synthetic physics trace string mimicking realistic per-iteration volume.
 * Mixes banking, capmkt, fiscal, and tax trace lines as described in forensics-G2 §1b.
 * @param sizeKB target size in kilobytes
 */
function buildSyntheticTrace(sizeKB: number): string {
  const lines: string[] = [];
  // Banking trace lines (~200 chars each)
  lines.push('[BANKING] Agent Alice deposited 500 fiat. Balance: 1500. Bank reserves: 45000. Reserve ratio: 0.30.');
  lines.push('[BANKING] Agent Bob repaid 200 fiat on loan #loan-003. Remaining: 800. Interest accrued: 12.5.');
  lines.push('[BANKING] Interest accrued: 3 loans × 2.5% = 75 fiat total this iteration.');
  // Capital market trace lines
  lines.push('[CAPMKT] Agent Carol bought 10 shares of Enterprise-Alpha at 15.20/share. Total: 152 fiat.');
  lines.push('[CAPMKT] Dividend payout: Enterprise-Alpha distributed 0.5 fiat/share × 50 shares = 25 fiat.');
  lines.push('[CAPMKT] Gov bond matured: 1000 fiat principal returned to Agent Dave. Coupon: 30 fiat.');
  // Fiscal trace lines
  lines.push('[FISCAL] Treasury spent 120 fiat on healthcare. 10 agents received 12 fiat welfare each.');
  lines.push('[FISCAL] Education spending: 80 fiat. Quality gain: 0.8 pts. Current quality: 42.5.');
  lines.push('[FISCAL] Infrastructure escrow: +200 fiat. Total escrow: 850 fiat.');
  // Tax lines (8 new sites from 11-04)
  lines.push('[TAX] Withheld 15.5 fiat from Agent Eve (WORK income: 103.3 fiat, rate: 0.15).');
  lines.push('[TAX] Withheld 8.2 fiat from Agent Frank (AMM sale: 82 fiat, rate: 0.10).');
  lines.push('[TAX] VAT collected: 3.5 fiat on purchase by Agent Grace (base: 70 fiat, VAT: 5%).');
  lines.push('[TAX] Capital gains withheld: 12.0 fiat from Agent Henry (cmktDelta: 80 fiat, rate: 0.15).');
  // Per-agent D4 summary lines (~400 chars each, 15 agents in group)
  for (let i = 0; i < 15; i++) {
    lines.push(`[AGENT-${i}] Agent-${i} (Laborer): WORK executed — earned 85 fiat gross (employer: Enterprise-Beta). Tax withheld: 12.75 fiat. Net: 72.25 fiat. Satiety -4.2. Cortisol +0.5. Health stable. Allostatic strain: 12.3. Total wealth: ${500 + i * 20}.`);
  }
  // Inflation trace
  lines.push('[INFLATION] CPI this iteration: 102.4. M1 blend contribution: 0.003. AMM goods feedback: -0.001. Net inflation: 0.4%.');

  const baseContent = lines.join('\n');
  // Repeat to reach desired size
  const targetBytes = sizeKB * 1024;
  let result = '';
  while (result.length < targetBytes) {
    result += baseContent + '\n';
  }
  return result.slice(0, targetBytes);
}

/** Minimal Session fixture satisfying Pick<Session, 'idea' | 'societyOverview' | 'law' | 'timeScale'> */
const SESSION_FIXTURE = {
  idea: 'A test society for GC2 regression validation',
  societyOverview: 'A synthetic 15-agent society used in unit tests.',
  law: 'Citizens must pay taxes. Enterprises must employ at least one worker. Banking reserves must stay above 20%.',
  timeScale: '1 iteration = 1 week',
};

/** Build 15 minimal Agent fixtures for a group */
function buildAgentFixtures(count = 15): Agent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i}`,
    sessionId: SESSION_ID,
    name: `Agent-${i}`,
    role: i === 0 ? 'Elite' : 'Laborer',
    background: `Background for agent ${i}.`,
    initialStats: { wealth: 500, health: 80, happiness: 65, cortisol: 15, satiety: 70 },
    currentStats: { wealth: 500 + i * 20, health: 80, happiness: 65, cortisol: 15, satiety: 70 },
    isAlive: true,
    isCentralAgent: false,
    status: 'alive',
    type: 'citizen',
    bornAtIteration: 0,
    diedAtIteration: null,
  } as Agent));
}

/** Build 15 minimal AgentIntent fixtures */
function buildIntentFixtures(agents: Agent[]): AgentIntent[] {
  return agents.map(a => ({
    agentId: a.id,
    agentName: a.name,
    intent: `${a.name} wants to work this week and contribute to the local economy.`,
    reasoning: 'Standard work intent for testing.',
    primaryActionCode: 'WORK',
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('groupResolution prompt size (GC2 regression)', () => {
  beforeEach(() => {
    // Clear physics trace buffer before each test
    sessionLastPhysicsTraces.delete(SESSION_ID);
  });

  it('groupResolution prompt stays under 32KB after 5 iterations of trace accumulation', () => {
    // Simulate 5 iterations of trace accumulation (~25KB per iteration, mimicking Phase 11 volume)
    for (let iter = 1; iter <= 5; iter++) {
      appendTrace(SESSION_ID, buildSyntheticTrace(25));
    }

    const prevPhysicsLog = sessionLastPhysicsTraces.get(SESSION_ID) ?? null;
    const agents = buildAgentFixtures(15);
    const intents = buildIntentFixtures(agents);
    const allIntentsBrief = intents.map(i => `- ${i.agentName}: ${i.intent.slice(0, 80)}`).join('\n');

    const messages = buildGroupResolutionMessages(
      SESSION_FIXTURE,
      agents,
      intents,
      allIntentsBrief,
      5, // iterationNumber
      'Previous iteration: citizens worked and traded goods.',
      '[METRICS] employment=85% gini=0.35',
      [],
      prevPhysicsLog,
    );

    const totalSize = JSON.stringify(messages).length;
    // Assert: ≤ 32,000 chars ≈ 8,000 tokens
    expect(totalSize).toBeLessThan(32_000);
  });

  it('steady-state prompt size is stable AND within budget across iterations', () => {
    const agents = buildAgentFixtures(15);
    const intents = buildIntentFixtures(agents);
    const allIntentsBrief = intents.map(i => `- ${i.agentName}: ${i.intent.slice(0, 80)}`).join('\n');

    // Build iter-2 prompt: simulate 2 iterations of accumulation
    sessionLastPhysicsTraces.delete(SESSION_ID);
    for (let iter = 1; iter <= 2; iter++) {
      appendTrace(SESSION_ID, buildSyntheticTrace(25));
    }
    const prevPhysicsLogIter2 = sessionLastPhysicsTraces.get(SESSION_ID) ?? null;
    const messagesIter2 = buildGroupResolutionMessages(
      SESSION_FIXTURE, agents, intents, allIntentsBrief, 2,
      'Previous iteration: some trade activity.', '[METRICS] employment=80%', [], prevPhysicsLogIter2,
    );
    const lenIter2 = JSON.stringify(messagesIter2).length;

    // Build iter-5 prompt: simulate 5 iterations of accumulation (fresh buffer)
    sessionLastPhysicsTraces.delete(SESSION_ID);
    for (let iter = 1; iter <= 5; iter++) {
      appendTrace(SESSION_ID, buildSyntheticTrace(25));
    }
    const prevPhysicsLogIter5 = sessionLastPhysicsTraces.get(SESSION_ID) ?? null;
    const messagesIter5 = buildGroupResolutionMessages(
      SESSION_FIXTURE, agents, intents, allIntentsBrief, 5,
      'Previous iteration: agents traded goods.', '[METRICS] employment=85%', [], prevPhysicsLogIter5,
    );
    const lenIter5 = JSON.stringify(messagesIter5).length;

    // All three clauses must pass: both ≤ 32KB and within 10% of each other
    const stabilityRatio = Math.abs(lenIter5 - lenIter2) / lenIter2;
    expect(lenIter2, `iter2 prompt (${lenIter2} chars) must be ≤ 32000`).toBeLessThan(32_000);
    expect(lenIter5, `iter5 prompt (${lenIter5} chars) must be ≤ 32000`).toBeLessThan(32_000);
    expect(stabilityRatio, `iter5 must be within 10% of iter2 (ratio: ${stabilityRatio.toFixed(3)})`).toBeLessThan(0.10);
  });

  it('physicsLog embed is tail-sliced to 8KB max at the prompt boundary', () => {
    const agents = buildAgentFixtures(15);
    const intents = buildIntentFixtures(agents);
    const allIntentsBrief = intents.map(i => `- ${i.agentName}: ${i.intent.slice(0, 80)}`).join('\n');

    // Build a controlled 40KB physicsLog with a known unique prefix and suffix
    // Use ASCII-only strings to avoid JSON-escaping issues in assertions.
    const uniquePrefix = 'GC2-UNIQUE-PREFIX-BEGIN ';
    const uniqueSuffix = ' GC2-UNIQUE-SUFFIX-END';
    const filler = 'x'.repeat(1024); // 1KB repeated filler
    // Build: uniquePrefix + 39KB filler + uniqueSuffix → total ~40KB
    const largeLog = uniquePrefix + filler.repeat(38) + uniqueSuffix;
    // largeLog.length ~ 24 + 38*1024 + 22 = ~38934 chars — well over 8KB

    const messages = buildGroupResolutionMessages(
      SESSION_FIXTURE, agents, intents, allIntentsBrief, 3,
      null, null, [], largeLog,
    );

    const composed = JSON.stringify(messages);

    // The PHYSICS LOG header should be present (embed rendered)
    expect(composed).toContain('[PHYSICS LOG');

    // The unique suffix (last few chars of the log) should be present
    expect(composed).toContain(uniqueSuffix);

    // The unique prefix (first chars — in the first 32KB which gets sliced off) must NOT appear
    // if .slice(-8000) is applied: a ~40KB log sliced to 8KB drops the first ~32KB including uniquePrefix.
    expect(composed).not.toContain(uniquePrefix);
  });
});
