import { describe, it, expect } from 'vitest';
import { isEmployableAgent } from '../isEmployableAgent.js';

describe('isEmployableAgent', () => {
  // Positive cases — should be employable
  it('returns true for a laborer (farmer)', () => {
    expect(isEmployableAgent({ role: 'farmer' })).toBe(true);
  });

  it('returns true for a specialist (engineer)', () => {
    expect(isEmployableAgent({ role: 'engineer' })).toBe(true);
  });

  it('returns true for an elite non-official (merchant)', () => {
    expect(isEmployableAgent({ role: 'merchant' })).toBe(true);
  });

  it('returns true when type and role are both undefined', () => {
    expect(isEmployableAgent({})).toBe(true);
  });

  it('returns true for a regular citizen with no special type', () => {
    expect(isEmployableAgent({ type: 'citizen', role: 'worker' })).toBe(true);
  });

  // Negative cases — should NOT be employable
  it('returns false for type=bank (institutional agent)', () => {
    expect(isEmployableAgent({ type: 'bank', role: 'bank_manager' })).toBe(false);
  });

  it('returns false for role=central_bank', () => {
    expect(isEmployableAgent({ role: 'central_bank' })).toBe(false);
  });

  it('returns false for role=central_agent', () => {
    expect(isEmployableAgent({ role: 'central_agent' })).toBe(false);
  });

  it('returns false for role=official (governance role)', () => {
    expect(isEmployableAgent({ role: 'official' })).toBe(false);
  });

  // Case-insensitive matching
  it('returns false for type=BANK (case-insensitive)', () => {
    expect(isEmployableAgent({ type: 'BANK' })).toBe(false);
  });

  it('returns false for role=CENTRAL_BANK (case-insensitive)', () => {
    expect(isEmployableAgent({ role: 'CENTRAL_BANK' })).toBe(false);
  });

  it('returns false for role=OFFICIAL (case-insensitive)', () => {
    expect(isEmployableAgent({ role: 'OFFICIAL' })).toBe(false);
  });

  it('returns false for role=Central_Agent (mixed case)', () => {
    expect(isEmployableAgent({ role: 'Central_Agent' })).toBe(false);
  });
});
