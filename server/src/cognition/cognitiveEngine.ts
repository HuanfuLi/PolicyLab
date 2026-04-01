/**
 * Cognitive Engine — Phase 3 Orchestrator
 *
 * Coordinates all Phase 3 subsystems (memory, reflection, planning)
 * into a per-agent, per-iteration cognitive pipeline.
 *
 * Pipeline per iteration (per agent):
 *   1. Retrieve subjective context via 3D retrieval (Memories)
 *   2. Check if reflection is needed (threshold breach)
 *   3. If yes, run reflection and store higher-order memory
 *   4. Run recursive planner (create/advance/overwrite plan)
 *   5. Output: the current plan step + memory context for the intent prompt
 *
 * At iteration end (after physics):
 *   6. Convert physical outcomes into experience memories (closes the loop)
 */
import {
    retrieveMemories,
    formatMemoriesForPrompt,
    createExperienceMemories,
    clearSessionMemories,
    type ScoredMemory,
} from './memoryStream.js';
import { batchReflections, clearReflectionState, type ReflectionResult } from './reflectionTree.js';
import { runPlanning, clearPlanningState, type PlanningResult, type AgentPlan, getAgentPlan } from './recursivePlanner.js';
import type { LLMProvider, LLMOptions } from '../llm/types.js';
import { runWithConcurrency } from '../orchestration/concurrencyPool.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Input for one agent's cognitive pre-processing (before intent generation). */
export interface CognitivePreInput {
    agentId: string;
    agentName: string;
    agentRole: string;
    currentStats: { wealth: number; health: number; happiness: number };
    isStarving: boolean;
}

/** Output from cognitive pre-processing — feeds into the intent prompt. */
export interface CognitivePreOutput {
    agentId: string;
    /** Formatted memory context for the intent prompt. */
    memoryContext: string;
    /** Current plan step (what the agent intends to do). */
    currentPlanStep: string;
    /** Whether a reflection was triggered this iteration. */
    reflectionTriggered: boolean;
    /** The reflection text (if triggered). */
    reflectionText: string | null;
    /** Whether a new plan was created. */
    planCreated: boolean;
    /** Whether the plan was overwritten (crisis). */
    planOverwritten: boolean;
    /** The full plan goal (for context). */
    planGoal: string;
    /** Top retrieved memories (for additional context). */
    topMemories: ScoredMemory[];
}

/** Input for post-iteration memory creation (after physics resolution). */
export interface CognitivePostInput {
    agentId: string;
    sessionId: string;
    iteration: number;
    actionPerformed: string;
    actionCode: string;
    wealthDelta: number;
    healthDelta: number;
    happinessDelta: number;
    economyEvents: string[];
    isStarving: boolean;
    narrativeSummary: string;
}

// ── Main Cognitive Pipeline ──────────────────────────────────────────────────

/**
 * Run pre-iteration cognitive processing for all agents.
 *
 * This runs BEFORE intent collection:
 *   - Retrieves relevant memories (3B)
 *   - Checks and runs reflections (3C)
 *   - Runs recursive planning (3D)
 *
 * The outputs feed into the natural language intent prompt,
 * grounding the agent in subjective, personal experience.
 */
export async function runCognitivePreProcessing(
    sessionId: string,
    currentIteration: number,
    agents: CognitivePreInput[],
    provider: LLMProvider,
    options?: LLMOptions,
    maxConcurrency: number = 10,
): Promise<Map<string, CognitivePreOutput>> {
    const outputs = new Map<string, CognitivePreOutput>();

    // Step 1: Batch reflection check (already concurrent internally)
    const reflectionInputs = agents.map(a => ({
        id: a.agentId,
        name: a.agentName,
        role: a.agentRole,
        stats: a.currentStats,
    }));

    const reflections = await batchReflections(
        sessionId, reflectionInputs, currentIteration, provider, options,
    );

    // Step 2: Per-agent memory retrieval + planning (bounded concurrency)
    const agentTasks = agents.map((agent) => async (): Promise<CognitivePreOutput> => {
        // Retrieve subjective memories (3B) — synchronous, in-memory
        const situationQuery = `current situation wealth ${agent.currentStats.wealth} health ${agent.currentStats.health} ${agent.isStarving ? 'starving food urgent' : ''} work plan`;
        const topMemories = retrieveMemories(
            sessionId, agent.agentId, currentIteration, situationQuery, 8,
        );

        const memoryContext = formatMemoriesForPrompt(topMemories, 600);

        // Get reflection result
        const reflectionResult = reflections.get(agent.agentId) ?? {
            triggered: false, reflection: null, memory: null, importanceSum: 0,
        };

        // Run recursive planner (3D) — may make LLM call
        let planResult: PlanningResult;
        try {
            planResult = await runPlanning(
                sessionId, agent.agentId, agent.agentName, agent.agentRole,
                currentIteration, agent.currentStats, agent.isStarving,
                provider, options,
            );
        } catch {
            // Fallback plan step
            planResult = {
                plan: getAgentPlan(sessionId, agent.agentId) ?? {
                    goal: 'Continue daily routine.',
                    steps: ['Work to earn resources.'],
                    currentStep: 0,
                    createdAt: currentIteration,
                    validUntil: currentIteration + 3,
                    wasOverwritten: false,
                },
                currentStepText: 'Continue working.',
                planCreated: false,
                planOverwritten: false,
            };
        }

        return {
            agentId: agent.agentId,
            memoryContext,
            currentPlanStep: planResult.currentStepText,
            reflectionTriggered: reflectionResult.triggered,
            reflectionText: reflectionResult.reflection,
            planCreated: planResult.planCreated,
            planOverwritten: planResult.planOverwritten,
            planGoal: planResult.plan.goal,
            topMemories,
        };
    });

    const results = await runWithConcurrency(agentTasks, maxConcurrency);
    for (const output of results) {
        outputs.set(output.agentId, output);
    }

    return outputs;
}

/**
 * Run post-iteration cognitive processing for all agents.
 *
 * This runs AFTER physics resolution:
 *   - Converts physical outcomes into experience memories
 *   - Closes the neuro-symbolic loop (Phase 1 → Phase 3)
 */
export function runCognitivePostProcessing(inputs: CognitivePostInput[]): void {
    for (const input of inputs) {
        createExperienceMemories(
            input.agentId,
            input.sessionId,
            input.iteration,
            {
                actionPerformed: input.actionPerformed,
                actionCode: input.actionCode,
                wealthDelta: input.wealthDelta,
                healthDelta: input.healthDelta,
                happinessDelta: input.happinessDelta,
                economyEvents: input.economyEvents,
                isStarving: input.isStarving,
                narrativeSummary: input.narrativeSummary,
            },
        );
    }
}

/**
 * Clean up all cognitive state for a session.
 */
export function cleanupSessionCognition(sessionId: string): void {
    clearSessionMemories(sessionId);
    clearReflectionState(sessionId);
    clearPlanningState(sessionId);
}
