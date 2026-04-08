import { describe, it, expect } from 'vitest';
import { buildPolicyBriefPrompt } from '../prompts/comparison.js';
import type { PolicyBriefScenario } from '../prompts/comparison.js';

function makeScenario(overrides: Partial<PolicyBriefScenario> = {}): PolicyBriefScenario {
  return {
    label: 'Baseline',
    title: 'Test Society',
    societyOverview: 'A small agricultural society.',
    agentCount: 20,
    deaths: 2,
    avgWealth: 150,
    avgHealth: 72,
    avgHappiness: 65,
    verdict: 'Moderate outcomes.',
    ...overrides,
  };
}

describe('buildPolicyBriefPrompt', () => {
  it('returns a two-message array with system and user roles', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'Baseline' }),
      makeScenario({ label: 'High Tax', avgWealth: 110, avgHappiness: 55 }),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes scenario count in system prompt', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'A' }),
      makeScenario({ label: 'B' }),
      makeScenario({ label: 'C' }),
    ]);

    expect(messages[0].content).toContain('3');
  });

  it('includes each scenario label in the user message', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'Baseline' }),
      makeScenario({ label: 'Low Spending' }),
    ]);

    const userContent = messages[1].content;
    expect(userContent).toContain('Baseline');
    expect(userContent).toContain('Low Spending');
  });

  it('includes numeric outcome fields in user message', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'A', avgWealth: 200, avgHealth: 80, avgHappiness: 70, deaths: 5 }),
      makeScenario({ label: 'B', avgWealth: 100, avgHealth: 60, avgHappiness: 40, deaths: 12 }),
    ]);

    const userContent = messages[1].content;
    // Wealth, health, happiness appear in the output as formatted numbers
    expect(userContent).toContain('200');
    expect(userContent).toContain('80');
    expect(userContent).toContain('5');
  });

  it('includes config diffs in user message when provided', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'Baseline' }),
      makeScenario({
        label: 'High Tax',
        configDiffs: { baseLoanInterestRate: { baseline: 0.05, scenario: 0.12 } },
      }),
    ]);

    const userContent = messages[1].content;
    expect(userContent).toContain('baseLoanInterestRate');
    expect(userContent).toContain('0.05');
    expect(userContent).toContain('0.12');
  });

  it('omits config diff section when configDiffs is not present', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'A' }),
      makeScenario({ label: 'B', configDiffs: undefined }),
    ]);

    const userContent = messages[1].content;
    expect(userContent).not.toContain('Config changes from baseline');
  });

  it('includes optional economic telemetry fields when provided', () => {
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'A', giniCoefficient: 0.42, m1: 9800, infrastructureQuality: 65 }),
      makeScenario({ label: 'B' }),
    ]);

    const userContent = messages[1].content;
    expect(userContent).toContain('0.420');
    expect(userContent).toContain('9800');
    expect(userContent).toContain('65.0');
  });

  it('handles null societyOverview gracefully', () => {
    expect(() =>
      buildPolicyBriefPrompt([
        makeScenario({ label: 'A', societyOverview: null }),
        makeScenario({ label: 'B', societyOverview: null }),
      ])
    ).not.toThrow();
  });

  it('handles null verdict gracefully', () => {
    expect(() =>
      buildPolicyBriefPrompt([
        makeScenario({ label: 'A', verdict: null }),
        makeScenario({ label: 'B', verdict: null }),
      ])
    ).not.toThrow();

    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'A', verdict: null }),
      makeScenario({ label: 'B', verdict: null }),
    ]);
    expect(messages[1].content).toContain('(none)');
  });

  it('truncates very long societyOverview to prevent prompt bloat', () => {
    const longOverview = 'x'.repeat(2000);
    const messages = buildPolicyBriefPrompt([
      makeScenario({ label: 'A', societyOverview: longOverview }),
      makeScenario({ label: 'B' }),
    ]);

    // The plan specifies slice(0, 400) — so output should not contain the full 2000-char string
    const userContent = messages[1].content;
    // Count occurrences of the padded character to verify truncation
    const xRun = userContent.match(/x+/)?.[0] ?? '';
    expect(xRun.length).toBeLessThanOrEqual(400);
  });
});
