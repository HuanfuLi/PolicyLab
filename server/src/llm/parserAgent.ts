/**
 * Phase 2, Component 2A: The Parser Agent (Lightweight Intermediary)
 *
 * Allows the primary Generative Agent to output purely natural language
 * intents without worrying about system syntax. A smaller, highly-constrained
 * LLM (the Parser Agent) receives the natural language string and maps it
 * strictly to the allowed symbolic action schema.
 *
 * Component 2B: Safety and Fallback Mechanism
 *
 * If the Main Agent outputs behavior that holds zero economic or physical
 * relevance (e.g., "Take a walk on the beach"), the Parser Agent safely
 * maps this to ActionCode: REST or NONE, guaranteeing the deterministic
 * engine in Phase 1 always receives valid typed parameters.
 *
 * The Parser Agent supports three strategies in order of preference:
 *   1. LLM-based parsing (small model, highly constrained prompt)
 *   2. Rule-based keyword extraction (deterministic fallback)
 *   3. Safe default mapping (NONE/REST)
 */
import type { LLMMessage, LLMProvider, LLMOptions } from './types.js';
import { normalizeActionCode, type ActionCode } from '../mechanics/actionCodes.js';
import { parseJSON } from '../parsers/json.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Input to the Parser Agent.
 */
export interface ParserAgentInput {
    /** Raw natural language output from the Main (Generative) Agent. */
    naturalLanguageIntent: string;
    /** Agent's name (for context). */
    agentName: string;
    /** Agent's role (helps disambiguate actions). */
    agentRole: string;
    /** Names of all alive agents (for target resolution). */
    aliveAgentNames: string[];
}

/**
 * Output from the Parser Agent — always a valid ActionCode.
 */
export interface ParserAgentOutput {
    /** The resolved action code — guaranteed valid. */
    actionCode: ActionCode;
    /** Resolved target agent name, or null. */
    actionTarget: string | null;
    /** Confidence level of the parsing (1 = deterministic keyword, 2 = LLM parsed, 3 = fallback). */
    confidence: 1 | 2 | 3;
    /** The method used to parse. */
    method: 'llm' | 'keyword' | 'fallback';
}

// ── Keyword-Based Deterministic Parser (Component 2B fallback) ───────────────

/**
 * Keyword rules: ordered by specificity (most specific first).
 * Each rule has a set of trigger keywords/phrases and the ActionCode it maps to.
 */
const KEYWORD_RULES: Array<{
    patterns: RegExp;
    action: ActionCode;
    /** Optional: extract target from the match */
    extractTarget?: boolean;
}> = [
        // Market actions (Phase 1)
        { patterns: /\b(buy|purchase|acquire|procure)\b.*\b(order|market|goods|food|tools|materials)\b/i, action: 'POST_BUY_ORDER' },
        { patterns: /\b(sell|offer|list|put up)\b.*\b(order|market|goods|food|tools|materials)\b/i, action: 'POST_SELL_ORDER' },
        { patterns: /\b(post\s*job|job\s*offer|offer\s*job)\b/i, action: 'POST_JOB_OFFER' },
        { patterns: /\b(hire|employ)\b/i, action: 'HIRE_EMPLOYEE' },
        { patterns: /\b(fire|dismiss)\b/i, action: 'FIRE_EMPLOYEE' },
        { patterns: /\b(apply|application)\b.*\b(job|enterprise|factory|shop)\b/i, action: 'APPLY_FOR_JOB' },
        { patterns: /\b(quit|resign|leave\s*the\s*job)\b/i, action: 'QUIT_JOB' },

        // Production (allow -ing, -ed, -s suffixes)
        { patterns: /\b(farm|grow|harvest|cultivat|plant|sow|produc|craft|manufactur|forg|build|construct)\w*/i, action: 'PRODUCE_AND_SELL' },

        // Core actions — specific patterns
        { patterns: /\b(strike|protest|rebel|revolt|refuse\s*to\s*work|picket|march|demonstrate|riot|uprising)\b/i, action: 'STRIKE' },
        { patterns: /\b(steal|rob|thieve|loot|pilfer|burgle|mug|take\s*from|pickpocket|plunder)\b/i, action: 'STEAL', extractTarget: true },
        { patterns: /\b(trade|barter|exchange|swap|deal|negotiate|commerce|buy\s*from|sell\s*to)\b/i, action: 'POST_BUY_ORDER', extractTarget: true },
        { patterns: /\b(help|aid|assist|support|volunteer|donate|give|charity|care\s*for|tend\s*to)\b/i, action: 'HELP', extractTarget: true },
        { patterns: /\b(invest|save|deposit|fund|finance|speculate|put\s*money)\b/i, action: 'INVEST' },
        { patterns: /\b(consume|indulge|luxury|treat|spend|shop|buy\s*for\s*self|enjoy|splurge|pleasure)\b/i, action: 'REST' },
        { patterns: /\b(rest|sleep|relax|recuperate|recover|take\s*a\s*break|take\s*it\s*easy|meditate|pray|wander|walk|stroll)\b/i, action: 'REST' },
        { patterns: /\b(work|labor|toil|earn|job|occupation|duty|task|mine|dig|serve|patrol|guard|teach|heal|study|research|practise)\b/i, action: 'WORK_AT_ENTERPRISE' },
    ];

/**
 * Attempt to extract a target agent name from natural language text.
 */
function extractTargetName(text: string, aliveAgentNames: string[]): string | null {
    const lower = text.toLowerCase();
    // Sort by name length descending to match longer names first (e.g., "Mary Jane" before "Mary")
    const sorted = [...aliveAgentNames].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
        if (lower.includes(name.toLowerCase())) {
            return name;
        }
    }
    return null;
}

/**
 * Deterministic keyword-based parser.
 * Scans the natural language text for recognizable action keywords.
 * Returns null if no keywords match (should escalate to LLM or fallback).
 */
export function parseByKeywords(
    text: string,
    aliveAgentNames: string[],
): { actionCode: ActionCode; actionTarget: string | null } | null {
    const normalized = text.toLowerCase();

    for (const rule of KEYWORD_RULES) {
        if (rule.patterns.test(normalized)) {
            const actionTarget = rule.extractTarget
                ? extractTargetName(text, aliveAgentNames)
                : null;
            return { actionCode: rule.action, actionTarget };
        }
    }

    return null;
}

// ── LLM-Based Parser Agent (Component 2A) ────────────────────────────────────

/**
 * Build the system prompt for the Parser Agent.
 * This prompt is designed to be extremely constrained: the LLM's only job
 * is to output a single JSON object mapping the intent to an ActionCode.
 */
function buildParserPrompt(
    naturalLanguageIntent: string,
    agentName: string,
    agentRole: string,
    aliveAgentNames: string[],
): LLMMessage[] {
    const validActions = [
        'WORK_AT_ENTERPRISE', 'REST', 'STRIKE', 'STEAL', 'HELP',
        'INVEST', 'PRODUCE_AND_SELL',
        'POST_BUY_ORDER', 'POST_SELL_ORDER',
        'FOUND_ENTERPRISE', 'POST_JOB_OFFER', 'APPLY_FOR_JOB',
        'HIRE_EMPLOYEE', 'FIRE_EMPLOYEE', 'QUIT_JOB', 'NONE',
    ];

    const systemPrompt = `You are a strict action parser. Your ONLY job is to read a citizen's natural language statement and output the single most appropriate ActionCode.

Valid ActionCodes: ${validActions.join(', ')}

Action definitions:
- WORK_AT_ENTERPRISE: fulfilling formal paid work at an enterprise
- REST: resting, sleeping, relaxing, wandering, meditating, praying, taking a break
- STRIKE: protesting, refusing to work, rebelling, marching, demonstrating
- STEAL: taking from someone illegally, robbing, looting (requires actionTarget)
- HELP: aiding someone at personal cost, volunteering, donating (requires actionTarget)
- INVEST: saving money, depositing, speculating on future returns
- PRODUCE_AND_SELL: producing goods independently and listing them on the market
- POST_BUY_ORDER: placing a buy order on the market
- POST_SELL_ORDER: placing a sell order on the market
- FOUND_ENTERPRISE: creating a new enterprise
- POST_JOB_OFFER: publishing a formal job offer
- APPLY_FOR_JOB: applying for a job at an enterprise
- HIRE_EMPLOYEE: selecting an applicant to hire
- FIRE_EMPLOYEE: dismissing an employee
- QUIT_JOB: resigning from an enterprise role
- NONE: doing nothing, or intent is too vague/irrelevant to map

If the statement has no economic or physical relevance (e.g., "I dream of clouds"), use REST or NONE.
If the statement mentions interacting with a specific person for STEAL/HELP, set actionTarget to that person's name.

Available citizens: ${aliveAgentNames.slice(0, 30).join(', ')}${aliveAgentNames.length > 30 ? '...' : ''}

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{"actionCode": "ACTION", "actionTarget": "name or null"}`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this citizen's intent:\nCitizen: ${agentName} (${agentRole})\nStatement: "${naturalLanguageIntent}"` },
    ];
}

/**
 * Parse the Parser Agent's LLM response into a validated ActionCode.
 */
function parseParserResponse(raw: string): { actionCode: ActionCode; actionTarget: string | null } {
    const parsed = parseJSON<Record<string, unknown>>(raw);
    const actionCode = normalizeActionCode(String(parsed.actionCode ?? 'NONE'));
    const actionTarget = parsed.actionTarget && parsed.actionTarget !== 'null'
        ? String(parsed.actionTarget)
        : null;
    return { actionCode, actionTarget };
}

// ── Main Parser Agent Function ───────────────────────────────────────────────

/**
 * The full Parser Agent pipeline.
 *
 * Strategy:
 *   1. Try deterministic keyword extraction first (fast, free, reliable)
 *   2. If keywords fail, call the LLM-based Parser Agent (small model)
 *   3. If LLM fails, fall back to safe default (REST for vague, NONE for empty)
 *
 * @param input The natural language intent to parse.
 * @param provider The LLM provider for the Parser Agent (should be a small, fast model).
 * @param options LLM options (model override for the parser).
 * @returns A guaranteed-valid ParserAgentOutput.
 */
export async function runParserAgent(
    input: ParserAgentInput,
    provider: LLMProvider,
    options?: LLMOptions,
): Promise<ParserAgentOutput> {
    const { naturalLanguageIntent, agentName, agentRole, aliveAgentNames } = input;

    // Guard: empty or extremely short input
    if (!naturalLanguageIntent || naturalLanguageIntent.trim().length < 3) {
        return {
            actionCode: 'NONE',
            actionTarget: null,
            confidence: 3,
            method: 'fallback',
        };
    }

    // ── Strategy 1: Deterministic keyword extraction ────────────────────────
    const keywordResult = parseByKeywords(naturalLanguageIntent, aliveAgentNames);
    if (keywordResult) {
        return {
            actionCode: keywordResult.actionCode,
            actionTarget: keywordResult.actionTarget,
            confidence: 1,
            method: 'keyword',
        };
    }

    // ── Strategy 2: LLM-based Parser Agent ─────────────────────────────────
    try {
        const messages = buildParserPrompt(naturalLanguageIntent, agentName, agentRole, aliveAgentNames);
        const raw = await provider.chat(messages, {
            ...options,
            maxTokens: 100, // Very constrained output
            temperature: 0, // Deterministic
        });
        const { actionCode, actionTarget } = parseParserResponse(raw);
        return {
            actionCode,
            actionTarget,
            confidence: 2,
            method: 'llm',
        };
    } catch (err) {
        console.warn(
            `[ParserAgent] LLM parsing failed for "${agentName}": ${err instanceof Error ? err.message : String(err)}`
        );
    }

    // ── Strategy 3: Safe fallback (Component 2B) ───────────────────────────
    // If the intent mentions anything vaguely active, default to REST
    // Otherwise NONE
    const hasActivity = /\b(go|do|want|try|plan|decide|think|feel|hope)\b/i.test(naturalLanguageIntent);
    return {
        actionCode: hasActivity ? 'REST' : 'NONE',
        actionTarget: null,
        confidence: 3,
        method: 'fallback',
    };
}

// ── Batch Processing ─────────────────────────────────────────────────────────

/**
 * Process multiple intents through the Parser Agent in parallel.
 * Used during the simulation loop to translate all agents' natural language
 * outputs into ActionCodes.
 *
 * @param inputs Array of parser inputs (one per agent).
 * @param provider The LLM provider for parsing.
 * @param options LLM options.
 * @param concurrency Max parallel LLM calls.
 * @returns Map of agentName → ParserAgentOutput.
 */
export async function batchParseIntents(
    inputs: ParserAgentInput[],
    provider: LLMProvider,
    options?: LLMOptions,
    concurrency: number = 10,
): Promise<Map<string, ParserAgentOutput>> {
    const results = new Map<string, ParserAgentOutput>();

    // First pass: try keyword parsing (synchronous, instant)
    const needsLLM: ParserAgentInput[] = [];
    for (const input of inputs) {
        const keywordResult = parseByKeywords(input.naturalLanguageIntent, input.aliveAgentNames);
        if (keywordResult) {
            results.set(input.agentName, {
                actionCode: keywordResult.actionCode,
                actionTarget: keywordResult.actionTarget,
                confidence: 1,
                method: 'keyword',
            });
        } else {
            needsLLM.push(input);
        }
    }

    // Second pass: LLM parsing for remaining intents (parallel with concurrency limit)
    if (needsLLM.length > 0) {
        const chunks: ParserAgentInput[][] = [];
        for (let i = 0; i < needsLLM.length; i += concurrency) {
            chunks.push(needsLLM.slice(i, i + concurrency));
        }

        for (const chunk of chunks) {
            const chunkResults = await Promise.all(
                chunk.map(input => runParserAgent(input, provider, options))
            );
            for (let i = 0; i < chunk.length; i++) {
                results.set(chunk[i].agentName, chunkResults[i]);
            }
        }
    }

    return results;
}
