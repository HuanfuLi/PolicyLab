import { describe, expect, it } from 'vitest';
import { getPhysicsConfig } from '../physicsConfig.js';

// Phase 11 D-02, D-07 — continuous per-tick structural cortisol & happiness
// pressures applied to every alive citizen (not bank/central_bank).
// See .planning/phases/11-*/11-RESEARCH.md §10 for coefficient seed values.
describe('structural pressures: coefficient presence (Phase 11 D-02, D-07)', () => {
  it('physicsConfig exposes all 9 structural pressure coefficients', () => {
    const cfg = getPhysicsConfig();
    expect(cfg.k_inflation_cor).toBeTypeOf('number');
    expect(cfg.k_gini_cor).toBeTypeOf('number');
    expect(cfg.k_unemp_cor).toBeTypeOf('number');
    expect(cfg.k_pg_cor).toBeTypeOf('number');
    expect(cfg.k_peer_death_hap).toBeTypeOf('number');
    expect(cfg.k_gini_hap).toBeTypeOf('number');
    expect(cfg.k_unemp_hap).toBeTypeOf('number');
    expect(cfg.k_welfare_hap).toBeTypeOf('number');
    expect(cfg.k_inflation_hap).toBeTypeOf('number');
  });
});

describe('structural pressures: cortisol mechanics (Phase 11 D-02)', () => {
  it.todo('inflation surprise raises cortisol by k_inflation_cor × max(0, actualCPI - expected)');
  it.todo('bottom-quintile citizen receives k_gini_cor × max(0, Gini - giniStressThreshold)');
  it.todo('top-quintile citizen receives zero Gini pressure');
  it.todo('unemployed agent with wealth < lowWealthThreshold receives k_unemp_cor/tick');
  it.todo('underfunded public goods (min quality/50) applies k_pg_cor × (1 - min/50)');
  it.todo('bank agent receives zero structural cortisol pressure');
  it.todo('central_bank agent receives zero structural cortisol pressure');
});

describe('structural pressures: happiness mechanics (Phase 11 D-07)', () => {
  it.todo('deaths this tick reduce all citizens happiness by k_peer_death_hap × count');
  it.todo('bottom-quintile citizen receives -k_gini_hap × (Gini - threshold) happiness');
  it.todo('unemployed + low wealth receives -k_unemp_hap happiness/tick');
  it.todo('welfareQuality under 50 applies -k_welfare_hap × (1 - quality/50)');
  it.todo('inflation surprise subtracts k_inflation_hap × surprise from happiness');
  it.todo('bank agent receives zero structural happiness pressure');
});
