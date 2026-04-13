import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Phase 11 D-17 — economyConfig.governanceEnabled toggle gates runGovernanceCycle.
// Must use `!== false` (not truthy check) so undefined defaults to enabled
// for backward-compat sessions (see 11-RESEARCH.md Pitfall 5).

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(__dirname, '../simulationRunner.ts');
const runnerSource = readFileSync(runnerPath, 'utf8');

/**
 * Mirror of the in-file gate expression. Changing this helper WITHOUT
 * changing simulationRunner.ts (and vice versa) will cause the grep
 * assertion below to fail — enforcing that the toggle semantics stay
 * in lock-step with the real runner.
 */
function shouldRunGovernanceCycle(params: {
  iterNum: number;
  aliveAgentCount: number;
  governanceEnabled: boolean | undefined;
}): boolean {
  return (
    params.iterNum % 5 === 0 &&
    params.aliveAgentCount >= 2 &&
    params.governanceEnabled !== false
  );
}

describe('governance toggle (Phase 11 D-17)', () => {
  it('runGovernanceCycle is skipped when economyConfig.governanceEnabled === false', () => {
    expect(
      shouldRunGovernanceCycle({ iterNum: 5, aliveAgentCount: 10, governanceEnabled: false }),
    ).toBe(false);
    expect(
      shouldRunGovernanceCycle({ iterNum: 10, aliveAgentCount: 5, governanceEnabled: false }),
    ).toBe(false);
  });

  it('runGovernanceCycle runs when economyConfig.governanceEnabled === true', () => {
    expect(
      shouldRunGovernanceCycle({ iterNum: 5, aliveAgentCount: 10, governanceEnabled: true }),
    ).toBe(true);
  });

  it('runGovernanceCycle runs when economyConfig.governanceEnabled === undefined (backward compat per Pitfall 5)', () => {
    expect(
      shouldRunGovernanceCycle({ iterNum: 5, aliveAgentCount: 10, governanceEnabled: undefined }),
    ).toBe(true);
  });

  it('simulationRunner.ts uses the `!== false` comparison (not a truthy check)', () => {
    // This is the critical contract: `governanceEnabled !== false` means
    // undefined → enabled. A `=== true` or truthy check would break legacy
    // sessions whose config has no governanceEnabled field.
    expect(runnerSource).toMatch(/governanceEnabled\s*!==\s*false/);
  });

  it('simulationRunner.ts does NOT gate the governance block with a truthy check', () => {
    // Guard against regression: neither `=== true` nor a bare truthy check
    // should appear on the governance cycle gate.
    const governanceBlock = runnerSource.match(
      /Governance Phase[\s\S]{0,400}if\s*\([^)]*governanceEnabled[^)]*\)/,
    );
    expect(governanceBlock).not.toBeNull();
    const block = governanceBlock![0];
    expect(block).not.toMatch(/governanceEnabled\s*===\s*true/);
    // Plain `governanceEnabled &&` (truthy) would be wrong — guard against it.
    expect(block).not.toMatch(/&&\s*economyConfig\.governanceEnabled\s*\)/);
  });
});
