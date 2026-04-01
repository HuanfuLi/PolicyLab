/**
 * Phase 3, Component 3D: Recursive Planning
 *
 * Shifts agent behavior from immediate reaction to long-term proactive strategy.
 *
 * Based on retrieved memories and reflections, the agent drafts a macroscopic
 * natural language plan. This plan is recursively broken down into specific
 * steps. If confronted with severe sudden events (being robbed, starvation),
 * the agent is forced to halt, trigger an immediate situational evaluation,
 * and rewrite the plan.
 *
 * Plan structure:
 *   - Goal: high-level objective (1–2 sentences)
 *   - Steps: ordered list of specific actions (3–5 steps)
 *   - CurrentStep: index into steps array (what to do this iteration)
 *   - ValidUntil: iteration when the plan expires and must be refreshed
 */
import type { LLMProvider, LLMOptions, LLMMessage } from '../llm/types.js';
import {
    addMemory,
    retrieveMemories,
    formatMemoriesForPrompt,
    type Memory,
    type ScoredMemory,
    IMPORTANCE_SCORES,
} from './memoryStream.js';
import { parseJSON } from '../parsers/json.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** An agent's active plan. */
export interface AgentPlan {
    /** High-level goal description. */
    goal: string;
    /** Ordered list of specific action steps. */
    steps: string[];
    /** Index of the current step (0-based). */
    currentStep: number;
    /** Iteration number when this plan was created. */
    createdAt: number;
    /** Iteration number when this plan expires. */
    validUntil: number;
    /** Whether the plan was recently overwritten due to a crisis. */
    wasOverwritten: boolean;
}

/** Result of the planning phase. */
export interface PlanningResult {
    /** The active plan (new or continued). */
    plan: AgentPlan;
    /** The current step to execute this iteration. */
    currentStepText: string;
    /** Whether a new plan was created this iteration. */
    planCreated: boolean;
    /** Whether the plan was overwritten due to a crisis. */
    planOverwritten: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** How many iterations a plan lasts before requiring refresh. */
const PLAN_DURATION = 5;

/** Number of memories to retrieve for planning context. */
const PLANNING_CONTEXT_SIZE = 8;

/** Crisis thresholds that force immediate plan overwrite. */
const CRISIS_THRESHOLDS = {
    health: 20,       // Health drops below 20
    wealth: 10,       // Wealth drops below 10
    starvationIters: 2, // Starving for 2+ consecutive iterations
};

// ── In-Memory Plan Storage ───────────────────────────────────────────────────

const agentPlans = new Map<string, AgentPlan>();

function planKey(sessionId: string, agentId: string): string {
    return `${sessionId}:${agentId}`;
}

// ── Plan Lifecycle ───────────────────────────────────────────────────────────

/**
 * Get the current plan for an agent, or null if no plan exists.
 */
export function getAgentPlan(sessionId: string, agentId: string): AgentPlan | null {
    return agentPlans.get(planKey(sessionId, agentId)) ?? null;
}

/**
 * Determine if the agent needs a new plan.
 */
function needsNewPlan(
    sessionId: string,
    agentId: string,
    currentIteration: number,
    currentStats: { wealth: number; health: number },
    isStarving: boolean,
): { needsPlan: boolean; reason: 'none' | 'expired' | 'completed' | 'crisis' } {
    const existing = getAgentPlan(sessionId, agentId);

    if (!existing) {
        return { needsPlan: true, reason: 'none' };
    }

    // Plan expired
    if (currentIteration > existing.validUntil) {
        return { needsPlan: true, reason: 'expired' };
    }

    // Plan completed (all steps done)
    if (existing.currentStep >= existing.steps.length) {
        return { needsPlan: true, reason: 'completed' };
    }

    // Crisis detection — force immediate replan
    if (currentStats.health <= CRISIS_THRESHOLDS.health) {
        return { needsPlan: true, reason: 'crisis' };
    }
    if (currentStats.wealth <= CRISIS_THRESHOLDS.wealth && !existing.wasOverwritten) {
        return { needsPlan: true, reason: 'crisis' };
    }
    if (isStarving && !existing.wasOverwritten) {
        return { needsPlan: true, reason: 'crisis' };
    }

    return { needsPlan: false, reason: 'none' };
}

/**
 * Build the planning prompt for the LLM.
 */
function buildPlanningPrompt(
    agentName: string,
    agentRole: string,
    memories: ScoredMemory[],
    currentStats: { wealth: number; health: number; happiness: number },
    reason: string,
    existingPlan: AgentPlan | null,
): LLMMessage[] {
    const memoriesText = formatMemoriesForPrompt(memories, 800);

    let contextNote = '';
    if (reason === 'crisis') {
        contextNote = '\n\n⚠️ CRISIS: Your situation has become dire. You must create an emergency survival plan. Prioritize immediate needs (food, health, safety) over long-term goals.';
    } else if (reason === 'expired' || reason === 'completed') {
        contextNote = existingPlan
            ? `\n\nYour previous plan was: "${existingPlan.goal}" — it is now ${reason}. Create a new plan building on what you've accomplished.`
            : '';
    }

    const systemPrompt = `You are ${agentName}, a ${agentRole}. Based on your memories and current situation, create a plan for the next few iterations.

Your memories:
${memoriesText}

Current state: Wealth: ${currentStats.wealth}/100, Health: ${currentStats.health}/100, Happiness: ${currentStats.happiness}/100${contextNote}

Consider what actions are available to you: work, trade, rest, produce food, eat, help others, invest, or protest/strike.

Respond with ONLY valid JSON:
{
  "goal": "Your high-level goal (1-2 sentences, first person)",
  "steps": ["Step 1 description", "Step 2 description", "Step 3 description"]
}

Create 3-5 concrete steps. Each step should be one iteration's action described naturally (e.g., "Work at the farm to earn money", "Rest to recover my health", "Produce food to build reserves").`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create your plan. Reason: ${reason}` },
    ];
}

/**
 * Run the planning phase for a single agent.
 *
 * Creates a new plan if needed (expired, completed, crisis), or
 * advances the current step of an existing plan.
 */
export async function runPlanning(
    sessionId: string,
    agentId: string,
    agentName: string,
    agentRole: string,
    currentIteration: number,
    currentStats: { wealth: number; health: number; happiness: number },
    isStarving: boolean,
    provider: LLMProvider,
    options?: LLMOptions,
): Promise<PlanningResult> {
    const key = planKey(sessionId, agentId);
    const existing = getAgentPlan(sessionId, agentId);

    const { needsPlan, reason } = needsNewPlan(
        sessionId, agentId, currentIteration, currentStats, isStarving,
    );

    if (!needsPlan && existing) {
        // Advance existing plan
        const step = existing.steps[existing.currentStep] ?? existing.steps[existing.steps.length - 1] ?? 'Continue as planned.';
        existing.currentStep++;
        return {
            plan: existing,
            currentStepText: step,
            planCreated: false,
            planOverwritten: false,
        };
    }

    // Create new plan
    const memories = retrieveMemories(
        sessionId, agentId, currentIteration,
        'plan goal strategy survival food wealth health work',
        PLANNING_CONTEXT_SIZE,
    );

    let plan: AgentPlan;
    const isOverwrite = reason === 'crisis' && existing !== null;

    try {
        const messages = buildPlanningPrompt(
            agentName, agentRole, memories, currentStats, reason, existing,
        );
        const raw = await provider.chat(messages, {
            ...options,
            maxTokens: 300,
            temperature: 0.6,
        });

        const parsed = parseJSON<Record<string, unknown>>(raw);
        const goal = String(parsed.goal ?? '').trim();
        const steps = Array.isArray(parsed.steps)
            ? (parsed.steps as unknown[]).map(s => String(s).trim()).filter(s => s.length > 0)
            : ['Work to earn resources.', 'Rest to recover.', 'Continue routine.'];

        plan = {
            goal: goal || 'Survive and improve my situation.',
            steps: steps.length > 0 ? steps : ['Work to earn resources.', 'Rest to recover.'],
            currentStep: 1, // 0 is the current iteration's step
            createdAt: currentIteration,
            validUntil: currentIteration + PLAN_DURATION,
            wasOverwritten: isOverwrite,
        };
    } catch {
        // Deterministic fallback plan
        plan = generateDeterministicPlan(currentStats, isStarving, currentIteration, isOverwrite);
    }

    // Store the plan
    agentPlans.set(key, plan);

    // Store plan as a memory
    addMemory({
        id: `plan-${agentId}-${currentIteration}`,
        agentId,
        sessionId,
        description: `[PLAN${isOverwrite ? ' (CRISIS REWRITE)' : ''}] Goal: ${plan.goal}. Steps: ${plan.steps.join('; ')}`,
        createdAt: currentIteration,
        importance: isOverwrite ? IMPORTANCE_SCORES['plan_overwritten'] : IMPORTANCE_SCORES['plan_created'],
        type: 'plan',
    });

    return {
        plan,
        currentStepText: plan.steps[0] ?? 'Work to survive.',
        planCreated: true,
        planOverwritten: isOverwrite,
    };
}

/**
 * Generate a deterministic plan based on stats (no LLM needed).
 */
function generateDeterministicPlan(
    stats: { wealth: number; health: number; happiness: number },
    isStarving: boolean,
    currentIteration: number,
    isOverwrite: boolean,
): AgentPlan {
    const steps: string[] = [];

    if (isStarving || stats.health < 30) {
        // Survival mode
        steps.push('Produce food immediately — farm or forage to survive.');
        steps.push('Eat whatever food is available to restore health.');
        steps.push('Rest to recover from the physical toll.');
        return {
            goal: 'Survive. I need food and rest urgently.',
            steps,
            currentStep: 1,
            createdAt: currentIteration,
            validUntil: currentIteration + 3,
            wasOverwritten: isOverwrite,
        };
    }

    if (stats.wealth < 20) {
        // Economic distress
        steps.push('Work hard to earn money for essentials.');
        steps.push('Produce food to reduce dependency on the market.');
        steps.push('Look for trading opportunities to improve finances.');
        return {
            goal: 'Get my finances back on track. I need to earn and save.',
            steps,
            currentStep: 1,
            createdAt: currentIteration,
            validUntil: currentIteration + PLAN_DURATION,
            wasOverwritten: isOverwrite,
        };
    }

    // Normal planning
    if (stats.happiness < 40) {
        steps.push('Take some time to rest and reduce stress.');
        steps.push('Work to maintain income.');
        steps.push('Help someone in need — it might lift my spirits.');
    } else {
        steps.push('Continue working in my occupation.');
        steps.push('Invest some earnings for the future.');
        steps.push('Perhaps trade with others for mutual benefit.');
    }

    return {
        goal: stats.happiness > 50
            ? 'Maintain my stable situation and look for opportunities to grow.'
            : 'Improve my overall wellbeing while maintaining income.',
        steps,
        currentStep: 1,
        createdAt: currentIteration,
        validUntil: currentIteration + PLAN_DURATION,
        wasOverwritten: isOverwrite,
    };
}

/**
 * Clean up planning state for a session.
 */
export function clearPlanningState(sessionId: string): void {
    for (const [key] of agentPlans) {
        if (key.startsWith(`${sessionId}:`)) {
            agentPlans.delete(key);
        }
    }
}
