import { describe, expect, it } from 'vitest';
import { simulationManager } from '../simulationManager.js';

// Locks in the resume-after-stuck-pause fix: when the runner is blocked inside
// an in-flight LLM call, the user's Pause sets pauseRequested but cannot flip
// status to 'paused'. Resume must be able to clear that pending request without
// returning a 409.
describe('simulationManager.cancelPendingPause', () => {
  it('returns false when the session has no state', () => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    expect(simulationManager.cancelPendingPause(id)).toBe(false);
  });

  it('returns false when running with no pause requested', () => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    simulationManager.start(id);
    try {
      expect(simulationManager.isPauseRequested(id)).toBe(false);
      expect(simulationManager.cancelPendingPause(id)).toBe(false);
      expect(simulationManager.getStatus(id)).toBe('running');
    } finally {
      simulationManager.cleanup(id);
    }
  });

  it('clears pauseRequested and returns true when pause is pending mid-run', () => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    simulationManager.start(id);
    try {
      simulationManager.pause(id); // sets pauseRequested, status stays 'running'
      expect(simulationManager.isPauseRequested(id)).toBe(true);
      expect(simulationManager.getStatus(id)).toBe('running');

      const cleared = simulationManager.cancelPendingPause(id);

      expect(cleared).toBe(true);
      expect(simulationManager.isPauseRequested(id)).toBe(false);
      // Status must remain 'running' — the simulation never actually stopped.
      expect(simulationManager.getStatus(id)).toBe('running');
    } finally {
      simulationManager.cleanup(id);
    }
  });

  it('does not touch a session that has actually paused', () => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    simulationManager.start(id);
    try {
      simulationManager.pause(id);
      simulationManager.setPaused(id); // runner reached the checkpoint
      expect(simulationManager.getStatus(id)).toBe('paused');
      expect(simulationManager.isPauseRequested(id)).toBe(false);

      // Nothing pending — should be a no-op.
      expect(simulationManager.cancelPendingPause(id)).toBe(false);
      expect(simulationManager.getStatus(id)).toBe('paused');
    } finally {
      simulationManager.cleanup(id);
    }
  });
});
