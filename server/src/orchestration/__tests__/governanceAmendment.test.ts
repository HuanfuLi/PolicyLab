import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, Session, SessionPolicy } from '@policylab/shared';
import type { LLMMessage, LLMOptions, LLMProvider, TestConnectionResult } from '../../llm/types.js';

// Phase 11 D-18, D-19 — law_amendment ballot applies paragraph-level diff
// using the shared applyParagraphDiff helper. Silently rejected when
// oldParagraph not found verbatim. History persists to session.config.

// ── Mock sessionRepo so tests don't touch the real SQLite DB ──────────────
const updateConfigMock = vi.fn(async (_id: string, _cfg: Record<string, unknown>) => {});
const updateLawMock = vi.fn(async (_id: string, _law: string) => {});

vi.mock('../../db/repos/sessionRepo.js', () => ({
  sessionRepo: {
    updateConfig: updateConfigMock,
    updateLaw: updateLawMock,
  },
}));

// Dynamic import AFTER mocks are registered.
const { runGovernanceCycle } = await import('../governanceManager.js');

// ── Test helpers ──────────────────────────────────────────────────────────

function makeAgent(name: string, role = 'Citizen', wealth = 100): Agent {
  return {
    id: `agent-${name}`,
    sessionId: 'sess-1',
    name,
    role,
    isAlive: true,
    status: 'alive',
    type: 'citizen',
    background: '',
    personalityTraits: [],
    deathReason: null,
    deathIterationNumber: null,
    diedAtIteration: null,
    bornAtIteration: 0,
    joinedIterationNumber: 1,
    currentStats: {
      wealth,
      health: 70,
      happiness: 60,
      cortisol: 20,
    } as Agent['currentStats'],
    initialStats: { wealth, health: 70, happiness: 60, cortisol: 20 } as Agent['initialStats'],
  } as unknown as Agent;
}

function makeSession(law: string, config: Record<string, unknown> = {}): Pick<Session, 'id' | 'societyOverview' | 'idea' | 'config' | 'law'> {
  return {
    id: 'sess-1',
    societyOverview: 'Test society with three citizens.',
    idea: 'test society',
    config: config as Session['config'],
    law,
  };
}

/**
 * Build a mock LLM provider whose `chat` consults a script queue keyed by
 * substring match against the first system message. Used to script the
 * multi-step governance pipeline deterministically.
 */
function makeScriptedProvider(
  script: Array<{ match: RegExp; reply: string }>,
  fallback: string = '{}',
): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn<[LLMMessage[], LLMOptions?], Promise<string>>(
      async (messages: LLMMessage[], _opts?: LLMOptions) => {
        const sys = (messages[0]?.content ?? '').toString();
        for (const rule of script) {
          if (rule.match.test(sys)) return rule.reply;
        }
        callIndex++;
        return fallback;
      },
    ),
    chatStream: vi.fn<[LLMMessage[], LLMOptions?], AsyncIterable<string>>(async function* () {
      yield '';
    }),
    testConnection: vi.fn<[], Promise<TestConnectionResult>>(async () => ({
      ok: true,
      model: 'mock',
      latencyMs: 0,
    })),
  };
}

const currentPolicy: SessionPolicy = {
  tax_rate: 0.02,
  ubi_allocation: 1.0,
  enforcement_level: 1.0,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('law amendment ballot (Phase 11 D-18, D-19)', () => {
  beforeEach(() => {
    updateConfigMock.mockClear();
    updateLawMock.mockClear();
  });

  it('law_amendment ballot applies paragraph diff when oldParagraph matches verbatim', async () => {
    const law = 'Article 1. Rights.\n\nArticle 2. Duties.\n\nArticle 3. Justice.';
    const session = makeSession(law);
    const agents = [makeAgent('Alice'), makeAgent('Bob'), makeAgent('Carol')];

    const script: Array<{ match: RegExp; reply: string }> = [
      // Franchise-size prompt (Central Agent — provider)
      { match: /constitutional scholar|FRANCHISE SIZE GUIDE/, reply: '{"franchiseSize": 3, "reasoning": "democracy"}' },
      // Proposal prompts (citizens) — emit a law_amendment proposal
      {
        match: /You have the right to propose/,
        reply: JSON.stringify({
          proposal: {
            oldParagraph: 'Article 2. Duties.',
            newParagraph: 'Article 2. Civic obligations and service.',
            reasoning: 'clarify civic duty',
          },
        }),
      },
      // Ballot synthesis (provider — Speaker of the House)
      {
        match: /Speaker of the Legislative Assembly/,
        reply: JSON.stringify({
          ballot: [
            {
              oldParagraph: 'Article 2. Duties.',
              newParagraph: 'Article 2. Civic obligations and service.',
              description: 'Clarify Article 2',
              impactForecast: 'Tightens civic responsibility.',
            },
          ],
        }),
      },
      // Vote prompts (citizens)
      { match: /voting in a Legislative Session/, reply: '{"vote": "YES", "reason": "agreed"}' },
    ];

    const provider = makeScriptedProvider(script);
    const citizenProv = makeScriptedProvider(script);

    const result = await runGovernanceCycle({
      sessionId: session.id,
      agents,
      session,
      currentPolicy,
      iterNum: 5,
      provider,
      citizenProv,
      model: 'mock',
      citizenModel: 'mock',
    });

    expect(result.policyChanged).toBe(true);
    expect(result.ratifiedItems).toHaveLength(1);
    expect(result.ratifiedItems[0].kind).toBe('law_amendment');
    // session.law mutated in-memory
    expect(session.law).toContain('Article 2. Civic obligations and service.');
    expect(session.law).not.toContain('Article 2. Duties.');
    // Persistence called
    expect(updateLawMock).toHaveBeenCalledOnce();
    expect(updateLawMock.mock.calls[0]![1]).toContain('Article 2. Civic obligations and service.');
  });

  it('amendment silently rejected when oldParagraph not found in session.law', async () => {
    const law = 'Article 1. Rights.\n\nArticle 2. Duties.';
    const session = makeSession(law);
    const agents = [makeAgent('Alice'), makeAgent('Bob'), makeAgent('Carol')];

    const script: Array<{ match: RegExp; reply: string }> = [
      { match: /constitutional scholar|FRANCHISE SIZE GUIDE/, reply: '{"franchiseSize": 3, "reasoning": "democracy"}' },
      {
        match: /You have the right to propose/,
        reply: JSON.stringify({
          proposal: {
            oldParagraph: 'Article 99. Nonexistent.',
            newParagraph: 'Article 99. Replacement.',
            reasoning: 'ghost clause',
          },
        }),
      },
      {
        match: /Speaker of the Legislative Assembly/,
        reply: JSON.stringify({
          ballot: [
            {
              oldParagraph: 'Article 99. Nonexistent.',
              newParagraph: 'Article 99. Replacement.',
              description: 'Add phantom article',
              impactForecast: 'No effect.',
            },
          ],
        }),
      },
      { match: /voting in a Legislative Session/, reply: '{"vote": "YES", "reason": "agreed"}' },
    ];

    const provider = makeScriptedProvider(script);
    const citizenProv = makeScriptedProvider(script);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(String(args[0])); };

    let result;
    try {
      result = await runGovernanceCycle({
        sessionId: session.id,
        agents,
        session,
        currentPolicy,
        iterNum: 5,
        provider,
        citizenProv,
        model: 'mock',
        citizenModel: 'mock',
      });
    } finally {
      console.warn = originalWarn;
    }

    // Amendment not applied — went into rejectedItems
    expect(result.ratifiedItems).toHaveLength(0);
    expect(result.rejectedItems).toHaveLength(1);
    expect(result.rejectedItems[0].kind).toBe('law_amendment');
    // session.law unchanged
    expect(session.law).toBe(law);
    // No DB updates
    expect(updateLawMock).not.toHaveBeenCalled();
    // Warning logged
    expect(warnings.some(w => w.includes('Law amendment not applied'))).toBe(true);
  });

  it('lawAmendmentHistory persists to session.config on ratification', async () => {
    const law = 'Article 1. Rights.\n\nArticle 2. Duties.';
    const session = makeSession(law, { policy: currentPolicy });
    const agents = [makeAgent('Alice'), makeAgent('Bob'), makeAgent('Carol')];

    const script: Array<{ match: RegExp; reply: string }> = [
      { match: /constitutional scholar/, reply: '{"franchiseSize": 3, "reasoning": "democracy"}' },
      {
        match: /You have the right to propose/,
        reply: JSON.stringify({
          proposal: {
            oldParagraph: 'Article 1. Rights.',
            newParagraph: 'Article 1. Expanded rights.',
            reasoning: 'expand rights',
          },
        }),
      },
      {
        match: /Speaker of the Legislative Assembly/,
        reply: JSON.stringify({
          ballot: [
            {
              oldParagraph: 'Article 1. Rights.',
              newParagraph: 'Article 1. Expanded rights.',
              description: 'Expand rights',
              impactForecast: 'Broader protections.',
            },
          ],
        }),
      },
      { match: /voting in a Legislative Session/, reply: '{"vote": "YES", "reason": "agreed"}' },
    ];

    const provider = makeScriptedProvider(script);
    const citizenProv = makeScriptedProvider(script);

    await runGovernanceCycle({
      sessionId: session.id,
      agents,
      session,
      currentPolicy,
      iterNum: 10,
      provider,
      citizenProv,
      model: 'mock',
      citizenModel: 'mock',
    });

    expect(updateConfigMock).toHaveBeenCalled();
    const persistedConfig = updateConfigMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(Array.isArray(persistedConfig.lawAmendmentHistory)).toBe(true);
    const history = persistedConfig.lawAmendmentHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      iteration: 10,
      old: 'Article 1. Rights.',
      new: 'Article 1. Expanded rights.',
      description: 'Expand rights',
    });
  });

  it('amendment scope is paragraph-level text only — applied via shared applyParagraphDiff', async () => {
    // Verify that the governanceManager uses the shared helper (not a local
    // find-and-replace). Assertion: a smart-quote oldParagraph still matches
    // a straight-quote paragraph in the law — the behavior contract that
    // applyParagraphDiff provides via normalization.
    const law = "Article 1. The citizen's right to vote.\n\nArticle 2. Duties.";
    const session = makeSession(law);
    const agents = [makeAgent('Alice'), makeAgent('Bob'), makeAgent('Carol')];

    const script: Array<{ match: RegExp; reply: string }> = [
      { match: /constitutional scholar/, reply: '{"franchiseSize": 3, "reasoning": "democracy"}' },
      {
        match: /You have the right to propose/,
        reply: JSON.stringify({
          proposal: {
            // Curly apostrophe — must normalize to straight for match
            oldParagraph: "Article 1. The citizen\u2019s right to vote.",
            newParagraph: 'Article 1. Universal suffrage.',
            reasoning: 'broaden franchise',
          },
        }),
      },
      {
        match: /Speaker of the Legislative Assembly/,
        reply: JSON.stringify({
          ballot: [
            {
              oldParagraph: "Article 1. The citizen\u2019s right to vote.",
              newParagraph: 'Article 1. Universal suffrage.',
              description: 'Universal suffrage',
              impactForecast: 'Wider franchise.',
            },
          ],
        }),
      },
      { match: /voting in a Legislative Session/, reply: '{"vote": "YES", "reason": "agreed"}' },
    ];

    const provider = makeScriptedProvider(script);
    const citizenProv = makeScriptedProvider(script);

    const result = await runGovernanceCycle({
      sessionId: session.id,
      agents,
      session,
      currentPolicy,
      iterNum: 5,
      provider,
      citizenProv,
      model: 'mock',
      citizenModel: 'mock',
    });

    expect(result.ratifiedItems).toHaveLength(1);
    expect(session.law).toContain('Article 1. Universal suffrage.');
    // Non-target paragraph preserved byte-for-byte
    expect(session.law).toContain('Article 2. Duties.');
  });

  it('mixed ballot applies policy and law_amendment items independently', async () => {
    const law = 'Article 1. Rights.\n\nArticle 2. Duties.';
    const session = makeSession(law);
    const agents = [makeAgent('Alice'), makeAgent('Bob'), makeAgent('Carol')];

    const script: Array<{ match: RegExp; reply: string }> = [
      { match: /constitutional scholar/, reply: '{"franchiseSize": 3, "reasoning": "democracy"}' },
      // Mixed proposals (citizen LLM returns one; irrelevant — ballot drives the mix)
      {
        match: /You have the right to propose/,
        reply: JSON.stringify({
          proposal: { field: 'tax_rate', value: 0.05, reasoning: 'raise tax' },
        }),
      },
      {
        match: /Speaker of the Legislative Assembly/,
        reply: JSON.stringify({
          ballot: [
            // Policy item
            {
              field: 'tax_rate',
              proposedValue: 0.05,
              description: 'Raise tax',
              impactForecast: 'More UBI funding.',
            },
            // Law amendment item
            {
              oldParagraph: 'Article 2. Duties.',
              newParagraph: 'Article 2. Civic service.',
              description: 'Reframe Article 2',
              impactForecast: 'Language update.',
            },
          ],
        }),
      },
      { match: /voting in a Legislative Session/, reply: '{"vote": "YES", "reason": "agreed"}' },
    ];

    const provider = makeScriptedProvider(script);
    const citizenProv = makeScriptedProvider(script);

    const result = await runGovernanceCycle({
      sessionId: session.id,
      agents,
      session,
      currentPolicy,
      iterNum: 5,
      provider,
      citizenProv,
      model: 'mock',
      citizenModel: 'mock',
    });

    expect(result.ratifiedItems).toHaveLength(2);
    const kinds = result.ratifiedItems.map(i => i.kind).sort();
    expect(kinds).toEqual(['law_amendment', 'policy']);
    // Both effects observed
    expect(result.newPolicy.tax_rate).toBe(0.05);
    expect(session.law).toContain('Article 2. Civic service.');
    expect(updateLawMock).toHaveBeenCalledOnce();
  });
});
