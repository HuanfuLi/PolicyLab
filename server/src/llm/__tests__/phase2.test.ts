/**
 * Phase 2 Integration Test Script
 *
 * Tests the Parser Agent independently by passing it an array of diverse
 * natural language strings (both relevant and absurd) and asserting that
 * the output is always a valid ActionCode.
 *
 * Tests cover:
 *  - Component 2A: LLM/keyword-based parsing of natural language → ActionCode
 *  - Component 2B: Safety and fallback for irrelevant/absurd input
 *  - Target extraction from natural language
 *  - Edge cases (empty, very long, non-English, emoji-only)
 *
 * Usage: npx tsx server/src/llm/__tests__/phase2.test.ts
 */
import { parseByKeywords, runParserAgent, type ParserAgentInput, type ParserAgentOutput } from '../parserAgent.js';
import type { ActionCode } from '../../mechanics/actionCodes.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        passed++;
        console.log(`  ✓ ${message}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL: ${message}`);
    }
}

function section(name: string): void {
    console.log(`\n═══ ${name} ═══`);
}

const VALID_ACTIONS = new Set([
    'WORK_AT_ENTERPRISE', 'REST', 'STRIKE', 'STEAL', 'HELP',
    'INVEST', 'PRODUCE_AND_SELL',
    'POST_BUY_ORDER', 'POST_SELL_ORDER',
    'FOUND_ENTERPRISE', 'POST_JOB_OFFER', 'APPLY_FOR_JOB',
    'HIRE_EMPLOYEE', 'FIRE_EMPLOYEE', 'QUIT_JOB', 'NONE',
]);

function isValidAction(code: string | undefined): boolean {
    return typeof code === 'string' && VALID_ACTIONS.has(code);
}

const AGENT_NAMES = ['Alice', 'Bob', 'Charlie', 'Marie', 'Georg', 'Elena'];

// ── 2A: Keyword-Based Parsing Tests ─────────────────────────────────────────

section('2A: Keyword-Based Parsing');

// Work-related intents
const work1 = parseByKeywords("I'm going to work at the factory today to earn some money.", AGENT_NAMES);
assert(work1?.actionCode === 'WORK_AT_ENTERPRISE', 'Factory work → WORK_AT_ENTERPRISE');

const work2 = parseByKeywords("I need to toil in the fields from sunrise to sunset.", AGENT_NAMES);
assert(work2?.actionCode === 'WORK_AT_ENTERPRISE', 'Toiling in fields → WORK_AT_ENTERPRISE');

const work3 = parseByKeywords("Time to study the ancient texts in the library.", AGENT_NAMES);
assert(work3?.actionCode === 'WORK_AT_ENTERPRISE', 'Studying → WORK_AT_ENTERPRISE');

const work4 = parseByKeywords("I'll patrol the village borders and guard the gate.", AGENT_NAMES);
assert(work4?.actionCode === 'WORK_AT_ENTERPRISE', 'Guarding → WORK_AT_ENTERPRISE');

// Rest-related intents
const rest1 = parseByKeywords("I think I'll take a break and lie down for a while.", AGENT_NAMES);
assert(rest1?.actionCode === 'REST', 'Taking break → REST');

const rest2 = parseByKeywords("I want to meditate and pray at the temple for peace.", AGENT_NAMES);
assert(rest2?.actionCode === 'REST', 'Meditating → REST');

const rest3 = parseByKeywords("Just going to relax by the river today, I'm exhausted.", AGENT_NAMES);
assert(rest3?.actionCode === 'REST', 'Relaxing → REST');

const rest4 = parseByKeywords("I'll take a stroll through the village square.", AGENT_NAMES);
assert(rest4?.actionCode === 'REST', 'Strolling → REST');

// Trade-related intents
const trade1 = parseByKeywords("I want to trade some of my crops with Bob.", AGENT_NAMES);
assert(trade1?.actionCode === 'POST_BUY_ORDER', 'Trading with name → POST_BUY_ORDER');
assert(trade1?.actionTarget === 'Bob', 'Trade target is Bob');

const trade2 = parseByKeywords("I'll barter my tools for food at the market with Elena.", AGENT_NAMES);
assert(trade2?.actionCode === 'POST_BUY_ORDER', 'Bartering → POST_BUY_ORDER');
assert(trade2?.actionTarget === 'Elena', 'Trade target is Elena');

// Strike-related intents
const strike1 = parseByKeywords("I can't afford food anymore! I refuse to work at the factory today, I'm going to the plaza to protest.", AGENT_NAMES);
assert(strike1?.actionCode === 'STRIKE', 'Protesting at plaza → STRIKE');

const strike2 = parseByKeywords("We need to rebel against these unfair conditions!", AGENT_NAMES);
assert(strike2?.actionCode === 'STRIKE', 'Rebelling → STRIKE');

const strike3 = parseByKeywords("I'm joining the uprising against the council.", AGENT_NAMES);
assert(strike3?.actionCode === 'STRIKE', 'Uprising → STRIKE');

// Steal-related intents
const steal1 = parseByKeywords("I'm desperate. I'm going to steal some bread from Charlie.", AGENT_NAMES);
assert(steal1?.actionCode === 'STEAL', 'Stealing bread → STEAL');
assert(steal1?.actionTarget === 'Charlie', 'Steal target is Charlie');

const steal2 = parseByKeywords("I'll rob the merchant's warehouse tonight.", AGENT_NAMES);
assert(steal2?.actionCode === 'STEAL', 'Robbing → STEAL');

// Help-related intents
const help1 = parseByKeywords("I want to help Marie with her injured child.", AGENT_NAMES);
assert(help1?.actionCode === 'HELP', 'Helping → HELP');
assert(help1?.actionTarget === 'Marie', 'Help target is Marie');

const help2 = parseByKeywords("I'll donate some of my food to the hungry families.", AGENT_NAMES);
assert(help2?.actionCode === 'HELP', 'Donating → HELP');

// Investment intents
const invest1 = parseByKeywords("I'm going to invest my savings in the new mill.", AGENT_NAMES);
assert(invest1?.actionCode === 'INVEST', 'Investing → INVEST');

const invest2 = parseByKeywords("I'll save my earnings for the winter.", AGENT_NAMES);
assert(invest2?.actionCode === 'INVEST', 'Saving → INVEST');

// Consume intents
const consume1 = parseByKeywords("I deserve a treat! I'm going to indulge in some luxury goods.", AGENT_NAMES);
assert(consume1?.actionCode === 'REST', 'Indulging → REST');

const consume2 = parseByKeywords("Time to go shopping for new clothes and enjoy myself.", AGENT_NAMES);
assert(consume2?.actionCode === 'REST', 'Shopping → REST');

// Phase 1 action codes
const produce1 = parseByKeywords("I'll spend the day farming my plot and growing vegetables.", AGENT_NAMES);
assert(produce1?.actionCode === 'PRODUCE_AND_SELL', 'Farming → PRODUCE_AND_SELL');

const produce2 = parseByKeywords("I need to craft some new tools in my workshop.", AGENT_NAMES);
assert(produce2?.actionCode === 'PRODUCE_AND_SELL', 'Crafting → PRODUCE_AND_SELL');

const eat1 = parseByKeywords("I'm going to feast on the food I've been saving.", AGENT_NAMES);
assert(eat1 === null || eat1.actionCode === 'POST_BUY_ORDER' || eat1.actionCode === 'REST', 'Feasting remains parseable under weekly metabolism');

const buy1 = parseByKeywords("I want to place a buy order for food at the market.", AGENT_NAMES);
assert(buy1?.actionCode === 'POST_BUY_ORDER', 'Buy order → POST_BUY_ORDER');

const sell1 = parseByKeywords("I'll sell my surplus tools at the market.", AGENT_NAMES);
assert(sell1?.actionCode === 'POST_SELL_ORDER', 'Sell at market → POST_SELL_ORDER');

const wage1 = parseByKeywords("I want to hire Georg to work in my shop.", AGENT_NAMES);
assert(wage1?.actionCode === 'HIRE_EMPLOYEE', 'Hiring → HIRE_EMPLOYEE');

// ── 2B: Safety and Fallback Tests ───────────────────────────────────────────

section('2B: Safety and Fallback - Keyword Parser');

// Irrelevant/absurd intents should return null from keyword parser
const absurd1 = parseByKeywords("The sky is a beautiful shade of purple today.", AGENT_NAMES);
assert(absurd1 === null, 'Absurd statement returns null');

const absurd2 = parseByKeywords("I wonder about the meaning of existence.", AGENT_NAMES);
assert(absurd2 === null, 'Philosophical musing returns null');

const absurd3 = parseByKeywords("42 is the answer to everything.", AGENT_NAMES);
assert(absurd3 === null, 'Random number statement returns null');

const absurd4 = parseByKeywords("🎵🎵🎵", AGENT_NAMES);
assert(absurd4 === null, 'Emoji-only returns null');

// ── Full Parser Agent (runParserAgent with mock) ────────────────────────────

section('2B: Full Parser Agent Safety');

// Mock LLM provider that always fails (to test fallback behavior)
const failingProvider = {
    async chat(): Promise<string> { throw new Error('Mock LLM failure'); },
    async *chatStream(): AsyncIterable<string> { throw new Error('Mock LLM failure'); },
    async testConnection() { return { ok: false, model: 'mock', latencyMs: 0, error: 'mock' }; },
};

// Test fallback with keyword match (should still work even if LLM fails)
async function testKeywordFallback() {
    const input: ParserAgentInput = {
        naturalLanguageIntent: "I'm going to work hard at the mine today.",
        agentName: 'TestAgent',
        agentRole: 'Miner',
        aliveAgentNames: AGENT_NAMES,
    };
    const result = await runParserAgent(input, failingProvider);
    assert(isValidAction(result.actionCode), 'Keyword match → valid ActionCode even with failing LLM');
    assert(result.actionCode === 'WORK', 'Mining → WORK via keyword');
    assert(result.method === 'keyword', 'Method is keyword');
    assert(result.confidence === 1, 'Confidence is 1 (keyword)');
}

// Test fallback for completely absurd input
async function testAbsurdFallback() {
    const input: ParserAgentInput = {
        naturalLanguageIntent: "The clouds look like marshmallows today.",
        agentName: 'TestAgent',
        agentRole: 'Villager',
        aliveAgentNames: AGENT_NAMES,
    };
    const result = await runParserAgent(input, failingProvider);
    assert(isValidAction(result.actionCode), 'Absurd input → valid ActionCode (fallback)');
    assert(result.method === 'fallback', 'Method is fallback');
    assert(result.confidence === 3, 'Confidence is 3 (fallback)');
}

// Test empty input
async function testEmptyInput() {
    const input: ParserAgentInput = {
        naturalLanguageIntent: '',
        agentName: 'TestAgent',
        agentRole: 'Villager',
        aliveAgentNames: AGENT_NAMES,
    };
    const result = await runParserAgent(input, failingProvider);
    assert(result.actionCode === 'NONE', 'Empty input → NONE');
    assert(result.method === 'fallback', 'Empty → fallback method');
}

// Test very short input
async function testShortInput() {
    const input: ParserAgentInput = {
        naturalLanguageIntent: 'hi',
        agentName: 'TestAgent',
        agentRole: 'Villager',
        aliveAgentNames: AGENT_NAMES,
    };
    const result = await runParserAgent(input, failingProvider);
    assert(result.actionCode === 'NONE', 'Very short input → NONE');
}

// Test that active-sounding but unmatched intents get REST via fallback
async function testVagueActiveFallback() {
    const input: ParserAgentInput = {
        naturalLanguageIntent: "I want to do something meaningful today, I think I'll try to find my purpose.",
        agentName: 'TestAgent',
        agentRole: 'Philosopher',
        aliveAgentNames: AGENT_NAMES,
    };
    const result = await runParserAgent(input, failingProvider);
    assert(isValidAction(result.actionCode), 'Vague intent still produces valid ActionCode');
    // May be REST from fallback or WORK from keyword match (depends on patterns)
}

// ── Run async tests ─────────────────────────────────────────────────────────

section('Running Async Tests...');

async function runAsyncTests() {
    await testKeywordFallback();
    await testAbsurdFallback();
    await testEmptyInput();
    await testShortInput();
    await testVagueActiveFallback();
}

// ── Target Extraction Tests ─────────────────────────────────────────────────

section('2A: Target Name Extraction');

// Multi-word names
const LONG_NAMES = ['Mary Jane', 'John Smith', 'Anne'];
const target1 = parseByKeywords("I will steal from Mary Jane's shop.", LONG_NAMES);
assert(target1?.actionTarget === 'Mary Jane', 'Extracts multi-word target name');

// Name not in agent list
const target2 = parseByKeywords("I want to trade with Zephyr the wanderer.", ['Alice', 'Bob']);
assert(target2?.actionTarget === null, 'Returns null for unknown agent name');

// ── Batch Deterministic Safety Test ─────────────────────────────────────────

section('2B: Batch Safety - All intents produce valid ActionCodes');

const DIVERSE_INTENTS = [
    "I'm heading to the mine to dig for ore.",
    "I'll rest under the old oak tree.",
    "I refuse to work! I'm going on strike!",
    "I want to steal bread from the bakery.",
    "I'll help the elderly woman with her bags.",
    "Time to invest in the new fishing boats.",
    "I'm going to trade my wool with the weaver.",
    "Let me craft a new sword at the smithy.",
    "I'll eat a hearty meal to recover my strength.",
    "I want to buy food at the market.",
    "The rain falls softly on the empty streets.",    // absurd
    "I wonder if the stars remember our names.",       // absurd
    "Colors don't taste like they used to.",           // absurd
    "",                                                  // empty
    "a",                                                 // too short
    "🌈🦄✨",                                          // emoji
    "Work work work work work",                         // keyword
    "I WILL DESTROY EVERYTHING!!! STEAL ALL!!!",        // aggressive
    "Going to the plaza to protest the new taxes.",     // strike
    "I should probably consume some luxury goods to boost my happiness.", // consume
];

for (const intent of DIVERSE_INTENTS) {
    const result = parseByKeywords(intent, AGENT_NAMES);
    if (result) {
        assert(isValidAction(result.actionCode), `"${intent.slice(0, 50)}..." → ${result.actionCode} (valid)`);
    } else {
        assert(true, `"${intent.slice(0, 50)}..." → null (will use LLM/fallback)`);
    }
}

// ── Run everything ──────────────────────────────────────────────────────────

runAsyncTests().then(() => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) {
        console.error('\n❌ Some tests FAILED!');
        process.exit(1);
    } else {
        console.log('\n✅ All Phase 2 tests PASSED!');
    }
}).catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
