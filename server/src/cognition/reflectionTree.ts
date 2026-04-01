/**
 * Phase 3, Component 3C: Directed Economic Reflection Tree
 *
 * Synthesizes raw experiences into high-level sociological and economic
 * motivations. Triggered when the cumulative importance of recent memories
 * breaches a threshold.
 *
 * When reflecting, the LLM is structurally forced to consider:
 *   - Personal financial security
 *   - Difficulty of acquiring resources
 *   - Fairness of society
 *   - Relationships and social standing
 *
 * These forced economic reflections give rise to synthesized higher-order
 * memories, serving as the direct algorithmic catalyst for class consciousness,
 * protest motivation, and strategic behavior shifts.
 */
import type { LLMProvider, LLMOptions, LLMMessage } from '../llm/types.js';
import {
    addMemory,
    getMemories,
    getRecentImportanceSum,
    retrieveMemories,
    formatMemoriesForPrompt,
    type Memory,
    type ScoredMemory,
} from './memoryStream.js';
import { parseJSON } from '../parsers/json.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReflectionResult {
    /** Whether a reflection was triggered. */
    triggered: boolean;
    /** The synthesized reflection (null if not triggered). */
    reflection: string | null;
    /** The reflection memory object (null if not triggered). */
    memory: Memory | null;
    /** Total importance that triggered the reflection. */
    importanceSum: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Importance threshold to trigger a reflection cycle. */
const REFLECTION_THRESHOLD = 25;

/** Number of recent memories to feed into the reflection prompt. */
const REFLECTION_CONTEXT_SIZE = 15;

/** Per-agent tracker of last reflection iteration. */
const lastReflectionIter = new Map<string, number>();

function reflectionKey(sessionId: string, agentId: string): string {
    return `${sessionId}:${agentId}`;
}

// ── Reflection Trigger ───────────────────────────────────────────────────────

/**
 * Check if an agent should reflect based on accumulated memory importance.
 */
export function shouldReflect(
    sessionId: string,
    agentId: string,
    currentIteration: number,
): { shouldTrigger: boolean; importanceSum: number } {
    const key = reflectionKey(sessionId, agentId);
    const lastReflection = lastReflectionIter.get(key) ?? 0;
    const importanceSum = getRecentImportanceSum(sessionId, agentId, lastReflection);

    return {
        shouldTrigger: importanceSum >= REFLECTION_THRESHOLD,
        importanceSum,
    };
}

// ── Reflection Execution ─────────────────────────────────────────────────────

/**
 * Build the reflection prompt.
 * Structurally forces the LLM to consider economic and survival dimensions.
 */
function buildReflectionPrompt(
    agentName: string,
    agentRole: string,
    recentMemories: ScoredMemory[],
    currentStats: { wealth: number; health: number; happiness: number },
): LLMMessage[] {
    const memoriesText = formatMemoriesForPrompt(recentMemories, 1200);

    const systemPrompt = `You are the inner consciousness of ${agentName}, a ${agentRole} in a simulated society.

Based on your recent experiences, synthesize a high-level reflection. You MUST address ALL of these dimensions:

1. **Personal Financial Security**: How secure do you feel? Can you afford food, shelter, and necessities? Are your savings growing or shrinking?
2. **Resource Acquisition Difficulty**: How hard is it to get what you need? Are prices fair? Is work available?
3. **Societal Fairness**: Do you feel the society treats you fairly? Are some people exploiting others? Is there inequality?
4. **Social Relationships**: Who do you trust? Who has helped or harmed you? Who are your allies or rivals?
5. **Future Outlook**: Are things getting better or worse? What do you fear or hope for?

Your recent memories:
${memoriesText}

Your current state: Wealth: ${currentStats.wealth}/100, Health: ${currentStats.health}/100, Happiness: ${currentStats.happiness}/100

Respond with ONLY valid JSON:
{
  "reflection": "Your synthesized reflection as a first-person paragraph (4-6 sentences). Be emotional and specific. Reference specific memories.",
  "economicSentiment": "positive|neutral|negative|desperate",
  "classConsciousness": "none|emerging|strong|militant",
  "primaryConcern": "survival|economic|social|existential"
}`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Reflect on your recent experiences. What is your high-level view of your situation?' },
    ];
}

/**
 * Run a reflection cycle for an agent.
 *
 * Called when shouldReflect() returns true. Uses the LLM to synthesize
 * recent experiences into a higher-order memory that guides future behavior.
 *
 * Falls back to a deterministic reflection if the LLM call fails.
 */
export async function runReflection(
    sessionId: string,
    agentId: string,
    agentName: string,
    agentRole: string,
    currentIteration: number,
    currentStats: { wealth: number; health: number; happiness: number },
    provider: LLMProvider,
    options?: LLMOptions,
): Promise<ReflectionResult> {
    const key = reflectionKey(sessionId, agentId);
    const { shouldTrigger, importanceSum } = shouldReflect(sessionId, agentId, currentIteration);

    if (!shouldTrigger) {
        return { triggered: false, reflection: null, memory: null, importanceSum };
    }

    // Retrieve most relevant recent memories for the reflection context
    const recentMemories = retrieveMemories(
        sessionId,
        agentId,
        currentIteration,
        'personal finances security resources fairness society relationships',
        REFLECTION_CONTEXT_SIZE,
    );

    let reflectionText: string;
    let metadata: { economicSentiment: string; classConsciousness: string; primaryConcern: string } = {
        economicSentiment: 'neutral',
        classConsciousness: 'none',
        primaryConcern: 'economic',
    };

    // Try LLM-based reflection
    try {
        const messages = buildReflectionPrompt(agentName, agentRole, recentMemories, currentStats);
        const raw = await provider.chat(messages, {
            ...options,
            maxTokens: 400,
            temperature: 0.7, // Some creativity for reflections
        });

        const parsed = parseJSON<Record<string, unknown>>(raw);
        reflectionText = String(parsed.reflection ?? '').trim();
        if (!reflectionText) throw new Error('Empty reflection');

        metadata.economicSentiment = String(parsed.economicSentiment ?? 'neutral');
        metadata.classConsciousness = String(parsed.classConsciousness ?? 'none');
        metadata.primaryConcern = String(parsed.primaryConcern ?? 'economic');
    } catch {
        // Deterministic fallback reflection based on stats
        reflectionText = generateDeterministicReflection(agentName, currentStats, recentMemories);
    }

    // Store the reflection as a high-importance memory
    const reflectionMemory = addMemory({
        id: `reflection-${agentId}-${currentIteration}`,
        agentId,
        sessionId,
        description: `[REFLECTION] ${reflectionText} [Sentiment: ${metadata.economicSentiment}, Class consciousness: ${metadata.classConsciousness}, Concern: ${metadata.primaryConcern}]`,
        createdAt: currentIteration,
        importance: 7,
        type: 'reflection',
    });

    // Update last reflection iteration
    lastReflectionIter.set(key, currentIteration);

    return {
        triggered: true,
        reflection: reflectionText,
        memory: reflectionMemory,
        importanceSum,
    };
}

/**
 * Generate a deterministic reflection when LLM is unavailable.
 */
function generateDeterministicReflection(
    agentName: string,
    stats: { wealth: number; health: number; happiness: number },
    memories: ScoredMemory[],
): string {
    const parts: string[] = [];

    // Financial assessment
    if (stats.wealth < 20) {
        parts.push(`I, ${agentName}, am struggling badly. My wealth is dangerously low and I don't know how much longer I can survive like this.`);
    } else if (stats.wealth < 50) {
        parts.push(`Things are tight financially. I need to be more careful with my resources and find better ways to earn.`);
    } else {
        parts.push(`My financial situation is manageable for now, though I should keep working to maintain it.`);
    }

    // Health assessment
    if (stats.health < 30) {
        parts.push(`My health is failing. I need to rest and find food or I may not survive.`);
    } else if (stats.health < 60) {
        parts.push(`I feel worn down. The constant pressure is taking its toll on my body.`);
    }

    // Check for starvation memories
    const hasStarvation = memories.some(m => m.description.includes('starv') || m.description.includes('hungry'));
    if (hasStarvation) {
        parts.push(`The hunger gnaws at me. Food has become the most precious resource in this society.`);
    }

    // Check for theft/conflict memories
    const hasConflict = memories.some(m => m.description.includes('steal') || m.description.includes('rob') || m.description.includes('stole'));
    if (hasConflict) {
        parts.push(`There is lawlessness in our community. People are desperate enough to steal. Something must change.`);
    }

    // Happiness and fairness
    if (stats.happiness < 30) {
        parts.push(`I am deeply unhappy. This society feels unfair and I wonder if things will ever improve.`);
    }

    return parts.join(' ') || `I reflect on my situation and feel ${stats.happiness > 50 ? 'cautiously optimistic' : 'uncertain about the future'}.`;
}

/**
 * Batch reflection check for all agents (called once per iteration).
 * Returns which agents reflected this iteration.
 * Runs concurrently — most agents won't trigger (threshold not met).
 */
export async function batchReflections(
    sessionId: string,
    agents: Array<{ id: string; name: string; role: string; stats: { wealth: number; health: number; happiness: number } }>,
    currentIteration: number,
    provider: LLMProvider,
    options?: LLMOptions,
): Promise<Map<string, ReflectionResult>> {
    const results = new Map<string, ReflectionResult>();

    const reflectionPromises = agents.map(async (agent) => {
        const result = await runReflection(
            sessionId,
            agent.id,
            agent.name,
            agent.role,
            currentIteration,
            agent.stats,
            provider,
            options,
        );
        return { id: agent.id, result };
    });

    const settled = await Promise.all(reflectionPromises);
    for (const { id, result } of settled) {
        results.set(id, result);
    }

    return results;
}

/**
 * Clean up reflection state for a session.
 */
export function clearReflectionState(sessionId: string): void {
    for (const [key] of lastReflectionIter) {
        if (key.startsWith(`${sessionId}:`)) {
            lastReflectionIter.delete(key);
        }
    }
}
