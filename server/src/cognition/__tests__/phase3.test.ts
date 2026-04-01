/**
 * Phase 3 Integration Test Script
 *
 * Tests the cognitive layer independently by injecting synthetic memories
 * and observing if the systems correctly:
 *   - Store and retrieve memories (3A)
 *   - Score memories with 3D retrieval (3B)
 *   - Trigger reflections at the right threshold (3C)
 *   - Create and manage recursive plans (3D)
 *   - Close the neuro-symbolic loop via experience memories
 *
 * Usage: npx tsx server/src/cognition/__tests__/phase3.test.ts
 */
import {
    addMemory,
    getMemories,
    retrieveMemories,
    getRecentImportanceSum,
    createExperienceMemories,
    formatMemoriesForPrompt,
    clearSessionMemories,
    type Memory,
} from '../memoryStream.js';
import {
    shouldReflect,
    runReflection,
    clearReflectionState,
} from '../reflectionTree.js';
import {
    runPlanning,
    getAgentPlan,
    clearPlanningState,
} from '../recursivePlanner.js';
import {
    runCognitivePreProcessing,
    runCognitivePostProcessing,
    cleanupSessionCognition,
} from '../cognitiveEngine.js';

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

const SESSION_ID = 'test-session-phase3';
const AGENT_ID = 'agent-1';
const AGENT_NAME = 'TestAgent';
const AGENT_ROLE = 'Farmer';

// Mock LLM provider (for deterministic fallback testing)
const mockProvider = {
    async chat(): Promise<string> { throw new Error('Mock LLM unavailable'); },
    async *chatStream(): AsyncIterable<string> { throw new Error('Mock'); },
    async testConnection() { return { ok: false, model: 'mock', latencyMs: 0 }; },
};

// ── 3A: Localized Memory Stream ─────────────────────────────────────────────

section('3A: Localized Memory Stream');

// Clear any previous state
clearSessionMemories(SESSION_ID);

// Test: Add a memory
const mem1 = addMemory({
    id: 'mem-1',
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    description: 'I worked at the farm and earned 5 gold.',
    createdAt: 1,
    importance: 3,
    type: 'experience',
});
assert(mem1.id === 'mem-1', 'Memory created with correct ID');
assert(mem1.keywords.length > 0, 'Keywords extracted from description');
assert(mem1.lastAccessedAt === 1, 'Last accessed set to creation time');

// Test: Retrieve memories
const memories = getMemories(SESSION_ID, AGENT_ID);
assert(memories.length === 1, 'One memory stored');
assert(memories[0].description.includes('farm'), 'Correct description stored');

// Test: Multiple memories
addMemory({
    id: 'mem-2', agentId: AGENT_ID, sessionId: SESSION_ID,
    description: 'I went hungry because I had no food.',
    createdAt: 2, importance: 9, type: 'economic',
});
addMemory({
    id: 'mem-3', agentId: AGENT_ID, sessionId: SESSION_ID,
    description: 'I helped Elena carry her harvest.',
    createdAt: 3, importance: 5, type: 'social',
});

const allMemories = getMemories(SESSION_ID, AGENT_ID);
assert(allMemories.length === 3, 'Three memories stored');

// Test: Information asymmetry — other agents don't see this agent's memories
const otherAgentMemories = getMemories(SESSION_ID, 'agent-2');
assert(otherAgentMemories.length === 0, 'Other agent has no memories (isolation)');

// ── 3B: 3D Retrieval System ─────────────────────────────────────────────────

section('3B: 3D Retrieval System');

// Test: Retrieve with relevance to food/hunger
const foodMemories = retrieveMemories(SESSION_ID, AGENT_ID, 4, 'food hungry starving', 5);
assert(foodMemories.length > 0, 'Retrieved at least one memory');
assert(foodMemories[0].score > 0, 'Memory has a positive score');
assert(foodMemories[0].scoreBreakdown.recency > 0, 'Recency component exists');
assert(foodMemories[0].scoreBreakdown.importance > 0, 'Importance component exists');

// Test: Hunger memory should rank high (importance 9 + keyword match)
const hungerMemory = foodMemories.find(m => m.description.includes('hungry'));
assert(hungerMemory !== undefined, 'Hunger memory retrieved for food query');
assert(hungerMemory!.score > foodMemories[foodMemories.length - 1].score, 'Hunger memory scores higher than least relevant');

// Test: Retrieve with relevance to work
const workMemories = retrieveMemories(SESSION_ID, AGENT_ID, 4, 'work earn gold money', 5);
const farmMemory = workMemories.find(m => m.description.includes('farm'));
assert(farmMemory !== undefined, 'Farm work memory retrieved for work query');

// Test: Recency affects scoring (newer memories score higher for recency)
// mem-3 (iter 3) should have higher recency than mem-1 (iter 1) at current iter 4
const iter4Memories = retrieveMemories(SESSION_ID, AGENT_ID, 4, 'help', 5);
const helpMemory = iter4Memories.find(m => m.description.includes('Elena'));
assert(helpMemory !== undefined, 'Help memory retrieved');
assert(helpMemory!.scoreBreakdown.recency > 0.9, 'Recent memory has high recency score');

// Test: Old memory has lower recency
const oldRetrieve = retrieveMemories(SESSION_ID, AGENT_ID, 100, 'farm work', 5);
const oldFarmMemory = oldRetrieve.find(m => m.description.includes('farm'));
assert(oldFarmMemory !== undefined, 'Old farm memory still retrievable');
assert(oldFarmMemory!.scoreBreakdown.recency < 0.1, 'Old memory has decayed recency');

// Test: Format memories for prompt
const formatted = formatMemoriesForPrompt(foodMemories);
assert(formatted.includes('[iter'), 'Formatted output contains iteration info');
assert(formatted.includes('imp:'), 'Formatted output contains importance');

// ── 3C: Directed Economic Reflection Tree ───────────────────────────────────

section('3C: Reflection Tree');

clearReflectionState(SESSION_ID);

// Test: Not enough importance to trigger reflection
const preCheck = shouldReflect(SESSION_ID, AGENT_ID, 4);
assert(preCheck.importanceSum > 0, 'Import sum is positive');

// Inject enough high-importance memories to breach threshold (25)
for (let i = 4; i <= 8; i++) {
    addMemory({
        id: `high-imp-${i}`, agentId: AGENT_ID, sessionId: SESSION_ID,
        description: `I witnessed terrible suffering in iteration ${i}. People are starving.`,
        createdAt: i, importance: 8, type: 'observation',
    });
}

const postCheck = shouldReflect(SESSION_ID, AGENT_ID, 9);
assert(postCheck.importanceSum >= 25, `Importance sum (${postCheck.importanceSum}) >= 25 threshold`);
assert(postCheck.shouldTrigger === true, 'Reflection should trigger');

// Test: Run reflection (with mock provider → deterministic fallback)
async function testReflection() {
    const result = await runReflection(
        SESSION_ID, AGENT_ID, AGENT_NAME, AGENT_ROLE,
        9,
        { wealth: 15, health: 30, happiness: 20 },
        mockProvider,
    );

    assert(result.triggered === true, 'Reflection was triggered');
    assert(result.reflection !== null, 'Reflection text generated');
    assert(result.reflection!.length > 20, 'Reflection text is substantial');
    assert(result.memory !== null, 'Reflection memory created');
    assert(result.memory!.type === 'reflection', 'Memory type is reflection');
    assert(result.memory!.importance === 7, 'Reflection has importance 7');

    // After reflecting, threshold should reset
    const postReflection = shouldReflect(SESSION_ID, AGENT_ID, 9);
    assert(postReflection.shouldTrigger === false, 'No immediate re-triggering after reflection');
}

// ── 3D: Recursive Planning ──────────────────────────────────────────────────

section('3D: Recursive Planning');

clearPlanningState(SESSION_ID);

async function testPlanning() {
    // Test: Create initial plan (no existing plan)
    const plan1 = await runPlanning(
        SESSION_ID, AGENT_ID, AGENT_NAME, AGENT_ROLE,
        10,
        { wealth: 15, health: 30, happiness: 20 },
        true, // starving
        mockProvider,
    );

    assert(plan1.planCreated === true, 'New plan created');
    assert(plan1.plan.steps.length >= 2, 'Plan has at least 2 steps');
    assert(plan1.currentStepText.length > 5, 'Current step has content');
    assert(plan1.plan.goal.length > 10, 'Plan goal is substantial');

    // Since starving + low health, should be a survival plan
    const isSurvivalPlan = plan1.plan.goal.toLowerCase().includes('surviv') ||
        plan1.plan.steps.some(s => s.toLowerCase().includes('food') || s.toLowerCase().includes('surviv'));
    assert(isSurvivalPlan, 'Starving agent gets a survival-focused plan');

    // Test: Advance existing plan (next iteration, no crisis)
    const plan2 = await runPlanning(
        SESSION_ID, AGENT_ID, AGENT_NAME, AGENT_ROLE,
        11,
        { wealth: 20, health: 35, happiness: 25 },
        false,
        mockProvider,
    );

    assert(plan2.planCreated === false, 'Existing plan reused (not expired)');
    assert(plan2.currentStepText.length > 0, 'Step text available');

    // Test: plan persists in memory
    const storedPlan = getAgentPlan(SESSION_ID, AGENT_ID);
    assert(storedPlan !== null, 'Plan stored in memory');
    assert(storedPlan!.currentStep >= 1, 'Current step advanced');

    // Test: Crisis overwrites plan
    const plan3 = await runPlanning(
        SESSION_ID, AGENT_ID, AGENT_NAME, AGENT_ROLE,
        12,
        { wealth: 5, health: 15, happiness: 10 }, // crisis stats
        true,
        mockProvider,
    );

    assert(plan3.planCreated === true, 'Crisis triggers new plan');
    assert(plan3.planOverwritten === true, 'Plan marked as overwritten');

    // Test: plan stores as memory
    const planMemories = getMemories(SESSION_ID, AGENT_ID).filter(m => m.type === 'plan');
    assert(planMemories.length >= 1, 'Plan stored as memory');
}

// ── Experience Memory Creation ──────────────────────────────────────────────

section('Experience Memory Creation');

const EXP_AGENT = 'agent-experience-test';

function testExperienceMemories() {
    const beforeCount = getMemories(SESSION_ID, EXP_AGENT).length;

    createExperienceMemories(EXP_AGENT, SESSION_ID, 15, {
        actionPerformed: 'worked at the blacksmith forge',
        actionCode: 'WORK',
        wealthDelta: 8,
        healthDelta: -2,
        happinessDelta: 1,
        economyEvents: ['Bought 3 units of food for $5', 'Tools quality degraded'],
        isStarving: false,
        narrativeSummary: 'The village continued its daily routine under the watchful eye of the council.',
    });

    const afterCount = getMemories(SESSION_ID, EXP_AGENT).length;
    assert(afterCount > beforeCount, 'Experience memories added');

    // Check that specific memories were created
    const newMemories = getMemories(SESSION_ID, EXP_AGENT).filter(m => m.createdAt === 15);
    assert(newMemories.length >= 2, 'Multiple experience memories created (action + events)');

    const actionMemory = newMemories.find(m => m.type === 'experience');
    assert(actionMemory !== undefined, 'Primary action memory exists');
    assert(actionMemory!.description.includes('blacksmith'), 'Action description preserved');

    const econMemory = newMemories.find(m => m.type === 'economic');
    assert(econMemory !== undefined, 'Economic event memory exists');

    // Test starvation experience
    createExperienceMemories(EXP_AGENT, SESSION_ID, 16, {
        actionPerformed: 'rested in despair',
        actionCode: 'REST',
        wealthDelta: 0,
        healthDelta: -10,
        happinessDelta: -5,
        economyEvents: [],
        isStarving: true,
        narrativeSummary: 'A quiet, hungry day.',
    });

    const starvationMemories = getMemories(SESSION_ID, EXP_AGENT).filter(
        m => m.createdAt === 16 && m.description.includes('starv')
    );
    assert(starvationMemories.length > 0, 'Starvation creates high-importance memory');
    assert(starvationMemories[0].importance >= 8, 'Starvation memory has high importance');
}

testExperienceMemories();

// ── Full Cognitive Engine Pipeline ──────────────────────────────────────────

section('Full Cognitive Engine Pipeline');

async function testCognitiveEngine() {
    // Clear and set up fresh state
    cleanupSessionCognition('pipeline-test');

    const testSession = 'pipeline-test';
    const testAgentId = 'pipeline-agent-1';

    // Seed some memories so the cognitive engine has context
    addMemory({
        id: 'pipe-1', agentId: testAgentId, sessionId: testSession,
        description: 'I worked hard and earned a decent wage.',
        createdAt: 1, importance: 3, type: 'experience',
    });
    addMemory({
        id: 'pipe-2', agentId: testAgentId, sessionId: testSession,
        description: 'Food prices are rising. I could barely afford bread.',
        createdAt: 2, importance: 6, type: 'economic',
    });

    // Run cognitive pre-processing
    const preOutputs = await runCognitivePreProcessing(
        testSession, 3,
        [{
            agentId: testAgentId,
            agentName: 'PipelineAgent',
            agentRole: 'Worker',
            currentStats: { wealth: 40, health: 60, happiness: 50 },
            isStarving: false,
        }],
        mockProvider,
    );

    assert(preOutputs.has(testAgentId), 'Pre-processing output exists for agent');
    const preOutput = preOutputs.get(testAgentId)!;
    assert(preOutput.memoryContext.length > 0, 'Memory context generated');
    assert(preOutput.currentPlanStep.length > 0, 'Plan step generated');
    assert(preOutput.planGoal.length > 0, 'Plan goal generated');
    assert(preOutput.planCreated === true, 'Plan was created (first iteration)');

    // Run cognitive post-processing
    runCognitivePostProcessing([{
        agentId: testAgentId,
        sessionId: testSession,
        iteration: 3,
        actionPerformed: 'worked at the factory',
        actionCode: 'WORK',
        wealthDelta: 5,
        healthDelta: -1,
        happinessDelta: 0,
        economyEvents: [],
        isStarving: false,
        narrativeSummary: 'Another day at the factory.',
    }]);

    const postMemories = getMemories(testSession, testAgentId).filter(m => m.createdAt === 3);
    assert(postMemories.length >= 1, 'Post-processing created experience memories');

    // Verify the loop: retrieved memories in next pre-processing should include the new experience
    const preOutputs2 = await runCognitivePreProcessing(
        testSession, 4,
        [{
            agentId: testAgentId,
            agentName: 'PipelineAgent',
            agentRole: 'Worker',
            currentStats: { wealth: 45, health: 59, happiness: 50 },
            isStarving: false,
        }],
        mockProvider,
    );

    const preOutput2 = preOutputs2.get(testAgentId)!;
    assert(preOutput2.memoryContext.includes('factory') || preOutput2.memoryContext.includes('work'),
        'New experience appears in next iteration\'s memory context');
    assert(preOutput2.planCreated === false, 'Existing plan reused in iteration 4');

    cleanupSessionCognition(testSession);
}

// ── Session Cleanup ─────────────────────────────────────────────────────────

section('Session Cleanup');

function testCleanup() {
    const cleanSession = 'cleanup-test';
    const cleanAgent = 'cleanup-agent';

    addMemory({
        id: 'clean-1', agentId: cleanAgent, sessionId: cleanSession,
        description: 'Test memory', createdAt: 1, importance: 5, type: 'experience',
    });

    assert(getMemories(cleanSession, cleanAgent).length === 1, 'Memory exists before cleanup');

    cleanupSessionCognition(cleanSession);

    assert(getMemories(cleanSession, cleanAgent).length === 0, 'Memory cleared after cleanup');
}

testCleanup();

// ── Run all async tests ─────────────────────────────────────────────────────

section('Running Async Tests...');

(async () => {
    await testReflection();
    await testPlanning();
    await testCognitiveEngine();

    // Final cleanup
    clearSessionMemories(SESSION_ID);
    clearReflectionState(SESSION_ID);
    clearPlanningState(SESSION_ID);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) {
        console.error('\n❌ Some tests FAILED!');
        process.exit(1);
    } else {
        console.log('\n✅ All Phase 3 tests PASSED!');
    }
})().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
