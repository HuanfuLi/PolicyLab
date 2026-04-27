/**
 * Prompt Content Verification Tests (Wave 2 scaffolding)
 *
 * These tests document the CURRENT state of prompt content and establish
 * the Nyquist scaffold for Wave 2 rewrites (Plans 02 and 03).
 *
 * - 1 active test verifies barrel exports work
 * - 9 unskipped tests verify Plan 02 content changes (D-02 through D-17)
 * - 2 skipped tests remain for Plan 03 changes (D-11, D-13)
 */
import { describe, it, expect } from 'vitest';
import {
  buildNaturalIntentPrompt,
  buildActionDictionary,
  buildEmploymentBoardSection,
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
  currentStats: { wealth: 50, health: 70, happiness: 60, cortisol: 20 },
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

// ── Plan 02 content tests (unskipped) ──────────────────────────────────────

describe('Prompt content (Plan 02 rewrites)', () => {
  // D-04: MET cost accuracy
  it('(D-04) contains accurate MET cost', () => {
    const messages = buildNaturalIntentPrompt(testAgent, testSession, null, 1);
    const text = extractText(messages);
    expect(text).toContain('5-6');
    expect(text).not.toContain('1 Food is consumed');
  });

  // D-06: No simulation framing
  it('(D-06) no simulation framing', () => {
    const messages = buildNaturalIntentPrompt(testAgent, testSession, null, 1);
    const text = extractText(messages);
    expect(text).not.toContain('simulated society');
  });

  // D-07: No mechanical system tags
  it('(D-07) no mechanical system tags', () => {
    const messages = buildNaturalIntentPrompt(testAgent, testSession, null, 1);
    const text = extractText(messages);
    expect(text).not.toContain('[BIOLOGICAL SUBCONSCIOUS]');
    expect(text).not.toContain('[CAPITALIST IDENTITY]');
    expect(text).not.toContain('[LEGAL RISK ASSESSMENT]');
    expect(text).not.toContain('[MARKET KNOWLEDGE]');
    expect(text).not.toContain('[Previous Action Results]');
    expect(text).not.toContain('[BACKGROUND SYSTEM]');
  });

  // D-08: Biological prose preserved
  it('(D-08) biological prose preserved', () => {
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

  // D-17: Natural action format
  it('(D-17) natural action format', () => {
    const dict = buildActionDictionary();
    expect(dict).toContain('(PRODUCE_AND_SELL)');
  });

  // D-17: No AVAILABLE ACTIONS tag
  it('(D-17) no AVAILABLE ACTIONS tag', () => {
    const dict = buildActionDictionary();
    expect(dict).not.toContain('[AVAILABLE ACTIONS]');
  });

  // D-02: Market data in dashboard (ammMarketData is the last parameter)
  it('(D-02) market data in dashboard', () => {
    const messages = buildNaturalIntentPrompt(
      testAgent, testSession, null, 2,
      undefined, // economyContext
      undefined, // cognitiveContext
      false,     // isFirstIteration
      undefined, // aliveAgentNames
      undefined, // allowedActions
      undefined, // marketBoard
      undefined, // employmentBoard
      undefined, // personalStatus
      undefined, // lastActionResults
      undefined, // enforcementLevel
      undefined, // marketIntelligenceBlock
      undefined, // citizenBankingContext
      undefined, // bankOperationsContext
      undefined, // citizenCapitalMarketContext
      undefined, // citizenFiscalContext
      undefined, // inflationContext
      undefined, // centralBankContext
      { foodSpotPrice: 5.2, foodReserve: 100, fiatReserve: 500 }, // ammMarketData
    );
    const text = extractText(messages);
    expect(text).toContain('fiat per unit');
    expect(text).toContain('5.2');
  });

  // D-05: Iteration 1 price anchoring
  it('(D-05) iteration 1 price anchoring', () => {
    const messages = buildNaturalIntentPrompt(
      testAgent, testSession, null, 1,
      undefined, // economyContext
      undefined, // cognitiveContext
      true,      // isFirstIteration
    );
    const text = extractText(messages);
    expect(text.includes('fair price') || text.includes('3-5 fiat')).toBe(true);
  });

  // D-09: Enterprise owner paragraph present
  it('(D-09) enterprise owner paragraph present', () => {
    const ownerAgent = { ...testAgent, role: 'merchant' };
    const messages = buildNaturalIntentPrompt(
      ownerAgent, testSession, null, 3,
      undefined, // economyContext
      undefined, // cognitiveContext
      false,     // isFirstIteration
      undefined, // aliveAgentNames
      undefined, // allowedActions
      undefined, // marketBoard
      undefined, // employmentBoard
      { employed: true, enterprise_id: 'ent_abc', enterprise_role: 'owner' as const },
    );
    const text = extractText(messages);
    expect(text).not.toContain('[CAPITALIST IDENTITY]');
    expect(text).toContain('business owner');
    expect(text).toContain('POST_SELL_ORDER');
  });
});

// ── Skipped tests for Plan 03 changes ──────────────────────────────────────

describe('Prompt content (Plan 03 scaffolding)', () => {
  // D-13: Central Agent retains mechanical framing
  it('(D-13) Central Agent retains mechanical framing', () => {
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
  it('(D-11) rich life stories in roster', () => {
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
});

describe('Phase 12: Action-dictionary per-agent wage interpolation', () => {
  it('D-17: WORK_AT_ENTERPRISE description contains the agent\'s actual wage via override', () => {
    const out = buildActionDictionary(['WORK_AT_ENTERPRISE'], {
      WORK_AT_ENTERPRISE: {
        description: `Show up at AcmeFarm for this week's 12.5 fiat wage (WORK_AT_ENTERPRISE). Guaranteed -- no market risk. Paid directly to your wealth, withholding taxes automatic.`,
        params: '{ "enterprise_id": string }',
      },
    } as any);
    expect(out).toMatch(/AcmeFarm/);
    expect(out).toMatch(/12\.5 fiat wage/);
  });

  it('D-18: PRODUCE_AND_SELL description reframed to subsistence wording', () => {
    const dict = buildActionDictionary(['PRODUCE_AND_SELL']);
    // Must contain subsistence framing per D-18
    expect(dict).toMatch(/subsistence/i);
    // Must reference ~4 units (actual physics yield, not the old misleading "about 20")
    expect(dict).toMatch(/~4 units/);
    // Old misleading copy must be gone
    expect(dict).not.toMatch(/about 20 units/);
    // Must not frame PAS as entrepreneurship
    expect(dict.toLowerCase()).not.toMatch(/entrepreneur/);
    // Must include the "can't find work" / survival framing
    expect(dict).toMatch(/can.t find (paid )?work|can.t find work/i);
  });

  it('D-19: employment board shows reservation_wage + vacancies + workforce/capacity', () => {
    const section = buildEmploymentBoardSection(
      [{ enterprise_id: 'e1', industry: 'agriculture', wage: 15, min_skill: 0, owner_name: 'farmer', vacancies: 2, workforce: 3, capacity: 5 }],
      8.2, /* reservationWage */
    );
    expect(section).toMatch(/reservation wage.*8\.2/i);
    expect(section).toMatch(/3\/5/i);
    expect(section).toMatch(/2 vacanc/i);
  });
});
