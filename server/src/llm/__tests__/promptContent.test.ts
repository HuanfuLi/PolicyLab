/**
 * Prompt Content Verification Tests (Wave 2 scaffolding)
 *
 * These tests document the CURRENT state of prompt content and establish
 * the Nyquist scaffold for Wave 2 rewrites (Plans 02 and 03).
 *
 * - 1 active test verifies barrel exports work
 * - 11 skipped tests will be unskipped and assertions flipped after content rewrites
 *
 * Each skipped test references a specific design decision (D-XX) from 09-CONTEXT.md.
 */
import { describe, it, expect } from 'vitest';
import {
  buildNaturalIntentPrompt,
  buildActionDictionary,
  buildResolutionPrompt,
  buildAgentRosterMessages,
} from '../prompts/index.js';

// ── Minimal test fixtures ───────────────────────────────────────────────────

const testAgent = {
  id: 'test-agent-1',
  name: 'Tomas',
  role: 'farmer',
  background: 'A simple farmer from the eastern ridge.',
  personalityTraits: ['risk-averse'],
  currentStats: { wealth: 50, health: 70, happiness: 60, cortisol: 20, dopamine: 50 },
  type: 'citizen',
} as any;

const testSession = {
  idea: 'A medieval farming village',
  societyOverview: 'A small village with farmers and merchants.',
  law: 'Basic property rights are enforced.',
  timeScale: '1 iteration = 1 week',
};

// ── Helper to extract text from LLMMessage arrays ───────────────────────────

function extractText(messages: any[]): string {
  return messages.map(m => {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((b: any) => b.text || '').join('\n');
    return '';
  }).join('\n');
}

// ── Active test: barrel exports ─────────────────────────────────────────────

describe('Prompt barrel exports', () => {
  it('barrel exports all prompt builders', () => {
    expect(typeof buildNaturalIntentPrompt).toBe('function');
    expect(typeof buildActionDictionary).toBe('function');
    expect(typeof buildResolutionPrompt).toBe('function');
    expect(typeof buildAgentRosterMessages).toBe('function');
  });
});

// ── Skipped test stubs for Wave 2 rewrites ──────────────────────────────────

describe('Prompt content (Wave 2 scaffolding)', () => {
  // D-04: MET cost accuracy — after rewrite, prompt will show "5-6" MET cost
  // and remove "1 Food is consumed" phrasing
  it.skip('(D-04) contains accurate MET cost', () => {
    const messages = buildNaturalIntentPrompt(testAgent, testSession, null, 1);
    const text = extractText(messages);
    expect(text).toContain('5-6');
    expect(text).not.toContain('1 Food is consumed');
  });

  // D-06: No simulation framing — after rewrite, "simulated society" phrasing removed
  it.skip('(D-06) no simulation framing', () => {
    const messages = buildNaturalIntentPrompt(testAgent, testSession, null, 1);
    const text = extractText(messages);
    expect(text).not.toContain('simulated society');
  });

  // D-07: No mechanical system tags — after rewrite, bracketed tags removed
  it.skip('(D-07) no mechanical system tags', () => {
    const messages = buildNaturalIntentPrompt(testAgent, testSession, null, 1);
    const text = extractText(messages);
    expect(text).not.toContain('[BIOLOGICAL SUBCONSCIOUS]');
    expect(text).not.toContain('[CAPITALIST IDENTITY]');
  });

  // D-08: Biological prose preserved — after rewrite, prose still present for low-health agents
  it.skip('(D-08) biological prose preserved', () => {
    const lowHealthAgent = {
      ...testAgent,
      currentStats: { ...testAgent.currentStats, health: 15 },
    };
    const messages = buildNaturalIntentPrompt(lowHealthAgent, testSession, null, 2, {
      inventory: { food: 0, tools: 0, raw_materials: 0, luxury_goods: 0 },
      skills: {} as any,
      isStarving: true,
    });
    const text = extractText(messages);
    expect(text).toContain('cold');
    expect(text).toContain('darkness');
  });

  // D-17: Natural action format — after rewrite, actions shown as "(PRODUCE_AND_SELL)"
  it.skip('(D-17) natural action format', () => {
    const dict = buildActionDictionary();
    expect(dict).toContain('(PRODUCE_AND_SELL)');
  });

  // D-17: No AVAILABLE ACTIONS tag — after rewrite, bracketed header removed
  it.skip('(D-17) no AVAILABLE ACTIONS tag', () => {
    const dict = buildActionDictionary();
    expect(dict).not.toContain('[AVAILABLE ACTIONS]');
  });

  // D-13: Central Agent retains mechanical framing
  it.skip('(D-13) Central Agent retains mechanical framing', () => {
    const messages = buildResolutionPrompt(
      testSession,
      [testAgent],
      [{ agentId: 'test-agent-1', agentName: 'Tomas', intent: 'Work the fields', reasoning: 'Need income' }],
      1,
      null,
    );
    const text = extractText(messages);
    expect(text).toContain('Central Agent');
  });

  // D-11: Rich life stories in roster
  it.skip('(D-11) rich life stories in roster', () => {
    const messages = buildAgentRosterMessages(
      'A medieval farming village overview.',
      'Basic property rights.',
      5,
      'Village council',
      'Agrarian barter economy',
    );
    const text = extractText(messages);
    expect(text).toContain('5-8 sentence');
  });

  // D-02: Market data in dashboard
  it.skip('(D-02) market data in dashboard', () => {
    const messages = buildNaturalIntentPrompt(
      testAgent, testSession, null, 2,
      undefined, undefined, false, undefined, undefined,
      [{ itemType: 'food', averageClearingPrice: 5, trend: 'up' as const }],
    );
    const text = extractText(messages);
    expect(text).toContain('fiat per unit');
  });

  // D-05: Iteration 1 price anchoring
  it.skip('(D-05) iteration 1 price anchoring', () => {
    const messages = buildNaturalIntentPrompt(
      testAgent, testSession, null, 1,
      undefined, undefined, true,
    );
    const text = extractText(messages);
    expect(text.includes('fair price') || text.includes('3-5 fiat')).toBe(true);
  });

  // D-09: Enterprise owner paragraph present (not [CAPITALIST IDENTITY] block)
  it.skip('(D-09) enterprise owner paragraph present', () => {
    const ownerAgent = { ...testAgent, role: 'merchant' };
    const messages = buildNaturalIntentPrompt(
      ownerAgent, testSession, null, 3,
      undefined, undefined, false, undefined, undefined,
      undefined, undefined,
      { employed: true, enterprise_id: 'ent_abc', enterprise_role: 'owner' as const },
    );
    const text = extractText(messages);
    // After rewrite: character-driven paragraph, not mechanical tag
    expect(text).not.toContain('[CAPITALIST IDENTITY]');
    expect(text).toContain('enterprise');
  });
});
