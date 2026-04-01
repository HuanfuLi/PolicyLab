/**
 * C4: Design Orchestrator (spec §2, component C4).
 *
 * Coordinates the multi-step design generation workflow (Stage 1B):
 *   1. Society overview
 *   2. Virtual law document
 *   3. Agent roster
 *
 * Delegates to C2 (LLM gateway) via centralAgent helpers and persists
 * results through C1 (DB repos).
 */

// Re-export the design generation function for use by routes.
// The implementation lives in llm/centralAgent.ts for Phase 2;
// Phase 3 simulation orchestration will be added here.
export { generateDesign } from '../llm/centralAgent.js';
