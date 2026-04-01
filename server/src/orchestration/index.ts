/**
 * C4: Orchestration layer (spec §2, component C4).
 *
 * Phase 2: designOrchestrator — society design generation (Stage 1B).
 * Phase 3: simulationRunner + simulationManager — simulation loop (Stage 2).
 * Phase 4: reflectionOrchestrator — reflections + evaluation (Stage 3) [to be added].
 */
export { generateDesign } from './designOrchestrator.js';
export { runSimulation } from './simulationRunner.js';
export { simulationManager } from './simulationManager.js';
export { runReflection } from './reflectionRunner.js';
export { reflectionManager } from './reflectionManager.js';
