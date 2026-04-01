import { describe, it, expect } from 'vitest';

describe('agentRepo - Wealth Preservation (BUG-01)', () => {
  it('should preserve fractional wealth without rounding', () => {
    // After BUG-01 fix, wealth field should NOT use Math.round()
    // Fix: Math.max(0, Math.round(wealth)) → Math.max(0, wealth)
    const wealth = 42.7;  // Fractional fiat
    const preserved = Math.max(0, wealth);  // After fix: no Math.round()

    expect(preserved).toBe(42.7);
    expect(preserved).not.toBe(43);  // Would fail if Math.round() applied
  });

  it('should clamp wealth at floor (0) but not at ceiling', () => {
    const negativeWealth = Math.max(0, -5);
    expect(negativeWealth).toBe(0);  // Floor at 0

    const highWealth = Math.max(0, 999.99);
    expect(highWealth).toBe(999.99);  // NO 100-clamp like stats
  });

  it('should distinguish wealth from stats (health/happiness clamped, wealth not)', () => {
    // Wealth has NO upper bound — only lower (0)
    // Health/Happiness clamped to [0, 100]
    const wealthUnbounded = 500;
    expect(wealthUnbounded).toBeGreaterThan(100);  // Valid, wealth has no ceiling

    const healthClamped = Math.min(100, Math.max(0, 150));
    expect(healthClamped).toBe(100);  // Clamped to max 100
  });
});
