/**
 * Phase 3, Components 3A & 3B: Localized Memory Stream + 3D Retrieval System
 *
 * 3A — Localized Memory Stream:
 *   Every experience is recorded as a natural language memory object
 *   containing a description, creation timestamp, importance score, and
 *   last-accessed timestamp. Agents have STRICT information asymmetry —
 *   they only know what they personally experience.
 *
 * 3B — 3D Retrieval System:
 *   Intelligently surfaces the most relevant context from a massive
 *   memory stream using a composite score of three dimensions:
 *     1. Recency: exponential decay since creation/last access
 *     2. Importance: 1–10 score assigned at creation time
 *     3. Relevance: keyword overlap between memory and current situation
 *
 *   (Note: Full cosine similarity via embeddings is a future optimization.
 *    For Phase 3 v1, we use tf-idf-style keyword overlap, which is
 *    deterministic, free, and surprisingly effective for our use case.)
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A single memory object in an agent's memory stream. */
export interface Memory {
    /** Unique identifier. */
    id: string;
    /** The agent who owns this memory. */
    agentId: string;
    /** Session this memory belongs to. */
    sessionId: string;
    /** Natural language description of the experience. */
    description: string;
    /** Iteration when this memory was created. */
    createdAt: number;
    /** Iteration when this memory was last accessed/retrieved. */
    lastAccessedAt: number;
    /** Importance score (1 = trivial, 10 = life-changing). */
    importance: number;
    /** Memory type for categorization. */
    type: MemoryType;
    /** Optional: keywords extracted for retrieval (cached). */
    keywords: string[];
}

export type MemoryType =
    | 'experience'     // Direct personal experience (action outcome)
    | 'observation'    // Something witnessed (another agent's action)
    | 'economic'       // Economic event (trade, starvation, price change)
    | 'social'         // Social interaction (helped, was helped, conflict)
    | 'reflection'     // Higher-order reflection (from Component 3C)
    | 'plan';          // A plan created by the agent (from Component 3D)

/** A retrieved memory with its composite retrieval score. */
export interface ScoredMemory extends Memory {
    /** Composite retrieval score (higher = more relevant). */
    score: number;
    /** Breakdown of scoring components. */
    scoreBreakdown: {
        recency: number;
        importance: number;
        relevance: number;
    };
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Exponential decay rate for recency scoring. Higher = faster decay. */
const RECENCY_DECAY = 0.95;

/** Maximum memories per agent (older low-importance memories are evicted). */
const MAX_MEMORIES_PER_AGENT = 200;

/** Weights for the three retrieval dimensions (sum = 1.0). */
const RETRIEVAL_WEIGHTS = {
    recency: 0.3,
    importance: 0.3,
    relevance: 0.4,
};

/** Importance scores for different event types. */
export const IMPORTANCE_SCORES: Record<string, number> = {
    // Survival events
    'starving': 9,
    'died': 10,
    'health_critical': 8,
    'was_robbed': 8,
    'was_helped': 6,

    // Economic events
    'trade_completed': 4,
    'earned_wage': 3,
    'food_spoiled': 5,
    'tools_broke': 6,
    'produced_food': 4,
    'market_trade': 5,

    // Social events
    'stole_from': 7,
    'helped_someone': 5,
    'witnessed_death': 8,
    'witnessed_strike': 6,

    // Work/routine
    'worked': 2,
    'rested': 1,
    'ate': 2,

    // Reflections and plans
    'reflection': 7,
    'plan_created': 5,
    'plan_overwritten': 6,

    // Default
    'default': 3,
};

// ── In-Memory Storage (per-session) ──────────────────────────────────────────

/**
 * In-memory storage for agent memories within active sessions.
 * Key: `${sessionId}:${agentId}` → Memory[]
 */
const memoryStore = new Map<string, Memory[]>();

function storeKey(sessionId: string, agentId: string): string {
    return `${sessionId}:${agentId}`;
}

// ── 3A: Memory Stream Operations ─────────────────────────────────────────────

/**
 * Add a new memory to an agent's stream.
 */
export function addMemory(
    memory: Omit<Memory, 'lastAccessedAt' | 'keywords'>,
): Memory {
    const key = storeKey(memory.sessionId, memory.agentId);
    if (!memoryStore.has(key)) {
        memoryStore.set(key, []);
    }

    const fullMemory: Memory = {
        ...memory,
        lastAccessedAt: memory.createdAt,
        keywords: extractKeywords(memory.description),
    };

    const memories = memoryStore.get(key)!;
    memories.push(fullMemory);

    // Evict old low-importance memories if over limit
    if (memories.length > MAX_MEMORIES_PER_AGENT) {
        evictMemories(memories);
    }

    return fullMemory;
}

/**
 * Get all memories for an agent, sorted by creation time (newest first).
 */
export function getMemories(sessionId: string, agentId: string): Memory[] {
    const key = storeKey(sessionId, agentId);
    return memoryStore.get(key) ?? [];
}

/**
 * Get the total importance of recent memories (since last reflection).
 * Used by Component 3C to determine when to trigger a reflection.
 */
export function getRecentImportanceSum(
    sessionId: string,
    agentId: string,
    sinceIteration: number,
): number {
    const memories = getMemories(sessionId, agentId);
    return memories
        .filter(m => m.createdAt >= sinceIteration && m.type !== 'reflection' && m.type !== 'plan')
        .reduce((sum, m) => sum + m.importance, 0);
}

/**
 * Clear all memories for a session (cleanup).
 */
export function clearSessionMemories(sessionId: string): void {
    for (const [key] of memoryStore) {
        if (key.startsWith(`${sessionId}:`)) {
            memoryStore.delete(key);
        }
    }
}

// ── 3B: 3D Retrieval System ──────────────────────────────────────────────────

/**
 * Retrieve the most relevant memories for a given situation/query.
 *
 * Scoring formula:
 *   score = w_r * recency(m) + w_i * importance(m) + w_rel * relevance(m, query)
 *
 * where:
 *   recency(m) = decay^(currentIter - max(createdAt, lastAccessedAt))
 *   importance(m) = m.importance / 10  (normalized to 0-1)
 *   relevance(m, query) = keyword_overlap(m.keywords, query_keywords)
 *
 * @param sessionId Session identifier.
 * @param agentId Agent identifier.
 * @param currentIteration Current iteration number (for recency).
 * @param situationQuery Current situation description (for relevance).
 * @param topK Number of memories to return.
 * @returns Array of memories with scores, sorted by score descending.
 */
export function retrieveMemories(
    sessionId: string,
    agentId: string,
    currentIteration: number,
    situationQuery: string,
    topK: number = 10,
): ScoredMemory[] {
    const memories = getMemories(sessionId, agentId);
    if (memories.length === 0) return [];

    const queryKeywords = extractKeywords(situationQuery);

    const scored: ScoredMemory[] = memories.map(m => {
        // Dimension 1: Recency
        const timeSince = currentIteration - Math.max(m.createdAt, m.lastAccessedAt);
        const recency = Math.pow(RECENCY_DECAY, Math.max(0, timeSince));

        // Dimension 2: Importance (normalized to 0–1)
        const importance = m.importance / 10;

        // Dimension 3: Relevance (keyword overlap, Jaccard-like)
        const relevance = keywordRelevance(m.keywords, queryKeywords);

        const score =
            RETRIEVAL_WEIGHTS.recency * recency +
            RETRIEVAL_WEIGHTS.importance * importance +
            RETRIEVAL_WEIGHTS.relevance * relevance;

        return {
            ...m,
            score,
            scoreBreakdown: { recency, importance, relevance },
        };
    });

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    const topMemories = scored.slice(0, topK);

    // Mark retrieved memories as accessed (update lastAccessedAt)
    for (const m of topMemories) {
        const original = memories.find(o => o.id === m.id);
        if (original) {
            original.lastAccessedAt = currentIteration;
        }
    }

    return topMemories;
}

// ── Memory-to-Experience Converters ──────────────────────────────────────────

/**
 * Convert an iteration's action outcomes into natural language memory objects.
 * This is how physical outcomes (from Phases 1+2) feed back into the cognitive
 * layer — closing the neuro-symbolic loop.
 */
export function createExperienceMemories(
    agentId: string,
    sessionId: string,
    iteration: number,
    context: {
        actionPerformed: string;
        actionCode: string;
        wealthDelta: number;
        healthDelta: number;
        happinessDelta: number;
        economyEvents: string[];
        isStarving: boolean;
        narrativeSummary: string;
    },
): Memory[] {
    const memories: Memory[] = [];
    const id = () => `mem-${agentId}-${iteration}-${memories.length}`;

    // Primary experience: what the agent did
    const outcomeAdj = context.wealthDelta >= 0 ? 'gainful' : 'costly';
    memories.push(addMemory({
        id: id(),
        agentId,
        sessionId,
        description: `I ${context.actionPerformed}. It was ${outcomeAdj} (wealth ${context.wealthDelta >= 0 ? '+' : ''}${context.wealthDelta}, health ${context.healthDelta >= 0 ? '+' : ''}${context.healthDelta}).`,
        createdAt: iteration,
        importance: Math.min(10, Math.abs(context.wealthDelta) + Math.abs(context.healthDelta) > 15 ? 7 : 3),
        type: 'experience',
    }));

    // Starvation: high-importance survival memory
    if (context.isStarving) {
        memories.push(addMemory({
            id: id(),
            agentId,
            sessionId,
            description: 'I had no food and went hungry. My body is weakening from starvation.',
            createdAt: iteration,
            importance: IMPORTANCE_SCORES['starving'],
            type: 'economic',
        }));
    }

    // Economy events (trades, spoilage, etc.)
    for (const event of context.economyEvents) {
        const importance = event.includes('Bought') || event.includes('Sold')
            ? IMPORTANCE_SCORES['market_trade']
            : event.includes('spoil')
                ? IMPORTANCE_SCORES['food_spoiled']
                : event.includes('broke')
                    ? IMPORTANCE_SCORES['tools_broke']
                    : IMPORTANCE_SCORES['default'];

        memories.push(addMemory({
            id: id(),
            agentId,
            sessionId,
            description: event,
            createdAt: iteration,
            importance,
            type: 'economic',
        }));
    }

    // Social/observational: brief awareness of the iteration's events
    if (context.narrativeSummary.length > 20) {
        memories.push(addMemory({
            id: id(),
            agentId,
            sessionId,
            description: `I heard that: ${context.narrativeSummary.slice(0, 300)}`,
            createdAt: iteration,
            importance: 2,
            type: 'observation',
        }));
    }

    return memories;
}

/**
 * Format retrieved memories as a string for prompt injection.
 */
export function formatMemoriesForPrompt(memories: ScoredMemory[], maxLength: number = 800): string {
    if (memories.length === 0) return '(No memories yet)';

    let result = '';
    for (const m of memories) {
        const line = `- [iter ${m.createdAt}, imp: ${m.importance}/10] ${m.description}\n`;
        if (result.length + line.length > maxLength) break;
        result += line;
    }

    return result || '(No relevant memories)';
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/** Stop words to exclude from keyword extraction. */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'between', 'but', 'and', 'or', 'nor',
    'not', 'so', 'yet', 'it', 'its', 'i', 'me', 'my', 'we', 'our',
    'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
    'their', 'this', 'that', 'these', 'those', 'what', 'which', 'who',
    'whom', 'how', 'when', 'where', 'why', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'some', 'any', 'no', 'just', 'very',
    'also', 'than', 'too', 'only', 'then', 'if', 'about', 'up',
]);

/** Extract meaningful keywords from text. */
function extractKeywords(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/** Compute keyword overlap score (Jaccard-like, 0–1). */
function keywordRelevance(memoryKeywords: string[], queryKeywords: string[]): number {
    if (memoryKeywords.length === 0 || queryKeywords.length === 0) return 0;
    const querySet = new Set(queryKeywords);
    const overlap = memoryKeywords.filter(k => querySet.has(k)).length;
    const union = new Set([...memoryKeywords, ...queryKeywords]).size;
    return union > 0 ? overlap / union : 0;
}

/** Evict lowest-value memories when over the limit. */
function evictMemories(memories: Memory[]): void {
    // Score each memory: low importance + old = evict first
    memories.sort((a, b) => {
        // Keep reflections and plans
        const aProtected = a.type === 'reflection' || a.type === 'plan' ? 1 : 0;
        const bProtected = b.type === 'reflection' || b.type === 'plan' ? 1 : 0;
        if (aProtected !== bProtected) return bProtected - aProtected;
        // Then by importance (high = keep)
        if (a.importance !== b.importance) return b.importance - a.importance;
        // Then by recency (new = keep)
        return b.createdAt - a.createdAt;
    });

    // Remove oldest, least important memories beyond the limit
    memories.splice(MAX_MEMORIES_PER_AGENT);
}
