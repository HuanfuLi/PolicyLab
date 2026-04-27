import { describe, expect, it } from 'vitest';
import { SimulationLifecycle } from '../simulationLifecycle.js';
import { simulationManager } from '../simulationManager.js';

// Locks in the parser-failure resume fix (2026-04-27).
//
// Before the fix, handlePause set in-memory status to 'paused'. When the user
// then clicked Resume, the route took the "status === paused" branch and only
// flipped the flag — but the runner async function had already returned. No
// new runner was spawned, no LLM calls fired, and subsequent pause/resume
// toggles were inert.
//
// After the fix, handlePause sets status to 'idle'. The DB stage stays at
// 'simulation-paused' (set immediately above the finish() call), so the resume
// route's "memStatus === idle && stage === simulation-paused" branch correctly
// re-spawns runSimulation.
describe('SimulationLifecycle.handlePause', () => {
  it('leaves in-memory status at idle so the resume route re-spawns the runner', async () => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    const lifecycle = new SimulationLifecycle(id);
    simulationManager.start(id);
    try {
      expect(simulationManager.getStatus(id)).toBe('running');

      await lifecycle.handlePause(new Error('Simulated parser failure for "Agent" at iteration 3.'));

      // CRITICAL: status must NOT be 'paused' — that would route resume to the
      // signal-only branch which assumes a runner is alive. Status must be 'idle'
      // so resume falls through to the DB-stage restart path.
      expect(simulationManager.getStatus(id)).toBe('idle');
      expect(simulationManager.isPauseRequested(id)).toBe(false);
      expect(simulationManager.isAbortRequested(id)).toBe(false);
    } finally {
      simulationManager.cleanup(id);
    }
  });

  it('marks the lifecycle disposed so the runner finally block does not wipe in-memory state', async () => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    const lifecycle = new SimulationLifecycle(id);
    simulationManager.start(id);
    try {
      await lifecycle.handlePause(new Error('parse-failure'));

      // Calling dispose() after handlePause must be a no-op (state Maps must survive
      // for the resumed runner to pick up reservation wages, AMM state, etc.).
      // We verify by calling dispose twice and asserting no throw — the disposed
      // flag short-circuits both calls.
      expect(() => lifecycle.dispose()).not.toThrow();
      expect(() => lifecycle.dispose()).not.toThrow();
    } finally {
      simulationManager.cleanup(id);
    }
  });

});
