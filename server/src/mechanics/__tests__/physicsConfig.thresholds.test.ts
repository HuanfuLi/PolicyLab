import { describe, expect, it } from 'vitest';
import { getPhysicsConfig, resetPhysicsConfig, updatePhysicsConfig } from '../physicsConfig.js';

// Phase 11 D-03, D-04, D-05, D-08, D-09 — raised clamps + thresholds + pressure seeds.
// See .planning/phases/11-*/11-RESEARCH.md §10 for exact seed values.
describe('physicsConfig Phase 11 thresholds and coefficients', () => {
  it('cortisolCeiling === 95 (D-03)', () => {
    expect(getPhysicsConfig().cortisolCeiling).toBe(95);
  });
  it('cortisolFloor === 3 (D-03 retained from Phase 10)', () => {
    expect(getPhysicsConfig().cortisolFloor).toBe(3);
  });
  it('happinessCeiling === 95 (D-08)', () => {
    expect(getPhysicsConfig().happinessCeiling).toBe(95);
  });
  it('happinessFloor === 5 (D-08)', () => {
    expect(getPhysicsConfig().happinessFloor).toBe(5);
  });
  it('lowWealthThreshold raised 20 -> 50 (D-04)', () => {
    expect(getPhysicsConfig().lowWealthThreshold).toBe(50);
  });
  it('lowHealthThreshold raised 30 -> 60 (D-04)', () => {
    expect(getPhysicsConfig().lowHealthThreshold).toBe(60);
  });
  it('giniStressThreshold === 0.35 (D-02)', () => {
    expect(getPhysicsConfig().giniStressThreshold).toBe(0.35);
  });

  it('cortisol pressure coefficients match 11-RESEARCH.md §10 seeds', () => {
    const c = getPhysicsConfig();
    expect(c.k_inflation_cor).toBe(0.3);
    expect(c.k_gini_cor).toBe(8.0);
    expect(c.k_unemp_cor).toBe(3.0);
    expect(c.k_pg_cor).toBe(2.0);
  });

  it('happiness pressure coefficients match 11-RESEARCH.md §10 seeds', () => {
    const c = getPhysicsConfig();
    expect(c.k_peer_death_hap).toBe(2.0);
    expect(c.k_gini_hap).toBe(6.0);
    expect(c.k_unemp_hap).toBe(2.5);
    expect(c.k_welfare_hap).toBe(2.5);
    expect(c.k_inflation_hap).toBe(0.25);
  });

  it('updatePhysicsConfig hot-swaps Phase 11 fields without disturbing others', () => {
    resetPhysicsConfig();
    const before = getPhysicsConfig().k_gini_cor;
    updatePhysicsConfig({ k_inflation_cor: 0.5 });
    const after = getPhysicsConfig();
    expect(after.k_inflation_cor).toBe(0.5);
    expect(after.k_gini_cor).toBe(before); // unchanged
    // Cleanup
    resetPhysicsConfig();
  });
});
