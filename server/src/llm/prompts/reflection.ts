import type { LLMMessage } from '../types.js';
import type { Agent, ChatMessage, Session } from '@policylab/shared';
import type { PostMortemInput } from './shared.js';

// ── Stat Trajectory Type ────────────────────────────────────────────────────

export interface StatTrajectoryEntry {
  iteration: number;
  wealth: number;
  health: number;
  happiness: number;
  actions: string[];
  /** Per-iteration wealth change — grounds reflections in actual economic outcomes */
  wealthDelta?: number;
  /** Per-iteration health change */
  healthDelta?: number;
}

// ── Phase 4 prompts ─────────────────────────────────────────────────────────

export function buildAgentReflectionPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  iterationSummaries: Array<{ number: number; summary: string }>,
  statTrajectory?: StatTrajectoryEntry[],
): LLMMessage[] {
  const summaryText = iterationSummaries
    .map(s => `Iteration ${s.number}: ${s.summary}`)
    .join('\n');

  const cortisolStat = (agent.currentStats as unknown as Record<string, unknown>).cortisol;
  const cortisolLine = cortisolStat != null ? `- Cortisol (stress): ${cortisolStat}/100` : '';

  // [R1] Restore personality traits at reflection time. Mirrors the block used
  // during simulation intent prompts (agent-intent.ts:426) so the persona that
  // coloured the agent's decisions also colours their interpretation of them.
  const traitsBlock = agent.personalityTraits && agent.personalityTraits.length > 0
    ? `\nPersonality: ${agent.personalityTraits.join(', ')}. These are deep-seated tendencies that shaped how you experienced and interpreted events — a risk-tolerant person remembers risks taken; an empathetic person remembers others; an idealistic person remembers what could have been. Let these traits colour your voice.`
    : '';

  // [R7] Compute wealth/happiness trajectory deltas so we can inject an
  // explicit "gains notice" when outcomes are strongly positive. LLMs under-
  // weight gains embedded in long stat lists; an explicit callout forces
  // acknowledgment of improvement proportional to the actual data.
  let gainsNotice = '';
  if (statTrajectory && statTrajectory.length >= 2) {
    const first = statTrajectory[0];
    const last = statTrajectory[statTrajectory.length - 1];
    const wealthGain = last.wealth - first.wealth;
    const happinessGain = last.happiness - first.happiness;
    const healthGain = last.health - first.health;
    const gains: string[] = [];
    if (wealthGain >= 20) gains.push(`wealth rose from ${first.wealth.toFixed(0)} to ${last.wealth.toFixed(0)} (+${wealthGain.toFixed(0)} fiat)`);
    if (happinessGain >= 10) gains.push(`happiness rose from ${first.happiness.toFixed(0)} to ${last.happiness.toFixed(0)} (+${happinessGain.toFixed(0)})`);
    if (healthGain >= 10) gains.push(`health rose from ${first.health.toFixed(0)} to ${last.health.toFixed(0)} (+${healthGain.toFixed(0)})`);
    if (gains.length > 0) {
      gainsNotice = `\nREAL GAINS YOU LIVED THROUGH — ${gains.join('; ')}. These are the numbers you ended with vs. where you started. Your reflection must acknowledge this improvement honestly; do not under-state gains this large. Struggle along the way is real, but so is arrival.`;
    }
  }

  // Build stat trajectory section (D-21)
  // [R5] Regret-biased "What would you do differently?" replaced with a balanced
  // counterfactual that invites both continuation and change.
  const trajectorySection = statTrajectory && statTrajectory.length > 0
    ? `\nYOUR PERSONAL JOURNEY (reflect on YOUR actual experience, not the collective narrative):\n` +
      statTrajectory.map(s => {
        const wDelta = s.wealthDelta != null ? ` (${s.wealthDelta >= 0 ? '+' : ''}${s.wealthDelta.toFixed(0)} fiat)` : '';
        const hDelta = s.healthDelta != null ? ` (${s.healthDelta >= 0 ? '+' : ''}${s.healthDelta.toFixed(0)})` : '';
        return `  Iteration ${s.iteration}: Wealth ${s.wealth.toFixed(0)}${wDelta}, Health ${s.health.toFixed(0)}${hDelta}, Happiness ${s.happiness.toFixed(0)} | Actions: ${s.actions.join(', ')}`;
      }).join('\n') +
      `\n\nReflect specifically on how YOUR wealth, health, and happiness changed over time. The wealth/health deltas shown are ACTUAL outcomes — do NOT invent different numbers. Looking back, what would you repeat, and what would you change?`
    : '';

  const systemPrompt = `You are ${agent.name}, a ${agent.role}. This is your life, your world: "${session.idea}"

Background: ${agent.background}${traitsBlock}

Your final material reality:
- Wealth: ${agent.currentStats.wealth}
- Health: ${agent.currentStats.health}/100
- Happiness: ${agent.currentStats.happiness}/100${cortisolLine ? `\n${cortisolLine}` : ''}
- Status: ${agent.isAlive ? 'Alive' : 'Deceased'}
${trajectorySection}${gainsNotice}

It is over now. Reflect on what you actually lived through — ground the reflection in your specific economic experience and let your personality shape how you interpret it.

What you lived through (${iterationSummaries.length} weeks):
${summaryText.slice(0, 2000)}

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "pass1": "string - your personal reflection (3-5 sentences, first person, raw and honest)",
  "pass1_best": "string - one specific thing that went well for you, however small (1-2 sentences). If you genuinely cannot name one, write exactly: 'Nothing went well.' Do not invent."
}

Rules:
- ANCHOR every sentence in MATERIAL REALITY: your actual wealth trajectory, food access, labour conditions, wages, debts, or inequality you witnessed. Did you eat? Were you exploited? Did you hoard or starve? Compare yourself to others.
- Let your PERSONALITY and background shape your voice. An idealist may frame their experience in terms of principles; a pragmatist in terms of outcomes; a cynic in terms of who played them. Philosophical register IS allowed when it is in-character — what is NOT allowed is generic, character-less abstraction.
- MATCH YOUR TONE TO YOUR DATA. If your numbers improved meaningfully, your reflection should feel at least partly earned — pride, relief, satisfaction, even a quiet "I made it." If your numbers got worse, let the grievance land. Do NOT default to cynicism when your own trajectory was positive.
- Express emotion proportional to what actually happened — examples across the full range: pride from earnings, satisfaction from security, relief from survival, gratitude for help received, frustration with obstacles, grief from loss, rage at injustice, resentment of exploitation. Pick the ones that fit YOUR specific outcome, not a default tone.
- Do NOT use standard AI phrasing ("I felt a mix of...", "I realized that...", "In that moment...") — FORBIDDEN
- Do not summarize society history; reflect from YOUR narrow, personal vantage point`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Reflect on your experience in this society.' },
  ];
}

export function buildAgentReflection2Prompt(
  agent: Agent,
  session: Pick<Session, 'idea'>,
  pass1: string,
  evaluationAnalysis: string
): LLMMessage[] {
  // [R1] Carry personality traits into pass 2 as well — without them, the
  // agent's revised view drifts toward a generic voice and tends to harden
  // into cynicism regardless of who they were designed to be.
  const traitsLine = agent.personalityTraits && agent.personalityTraits.length > 0
    ? ` Your personality: ${agent.personalityTraits.join(', ')}.`
    : '';

  const systemPrompt = `You are ${agent.name}, a ${agent.role}.${traitsLine}

You previously reflected: "${pass1}"

You have now been shown the full society evaluation report:
${evaluationAnalysis.slice(0, 800)}

Does knowing the full picture change your perspective? Respond with ONLY valid JSON (no markdown, no preamble):
{
  "pass2": "string - your updated reflection after seeing the full picture (2-4 sentences, first person)"
}

Rules:
- You may soften, deepen, or completely harden your original view — let your personality, class, and actual outcomes dictate which. If the evaluation shows the society succeeded despite your struggle, you may acknowledge that. If it shows the society failed despite your personal gain, you may reckon with that.
- Be specific about what changed (or didn't) and WHY it changed given who you are
- Remain fully in character — no AI phrasing, no diplomatic softening unless that is who this person is`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'How do you feel after seeing the full picture?' },
  ];
}

export function buildEvaluationPrompt(
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  iterationSummaries: Array<{ number: number; summary: string }>,
  agentReflections: Array<{ agentName: string; role: string; pass1: string }>,
  finalStats: { aliveCount: number; totalCount: number; avgWealth: number; avgHealth: number; avgHappiness: number }
): LLMMessage[] {
  const summaryText = iterationSummaries
    .slice(-10)
    .map(s => `Iteration ${s.number}: ${s.summary}`)
    .join('\n');

  const reflectionSample = agentReflections
    .slice(0, 8)
    .map(r => `${r.agentName} (${r.role}): "${r.pass1}"`)
    .join('\n');

  const systemPrompt = `You are the Central Agent writing a comprehensive evaluation of a completed society simulation.

Society concept: "${session.idea}"
Time scale: ${session.timeScale ?? '1 iteration = 1 week'}

Final statistics:
- Survivors: ${finalStats.aliveCount} / ${finalStats.totalCount} agents
- Average wealth: ${finalStats.avgWealth}
- Average health: ${finalStats.avgHealth}/100
- Average happiness: ${finalStats.avgHappiness}/100

Recent iteration summaries:
${summaryText.slice(0, 1500)}

Sample agent reflections:
${reflectionSample.slice(0, 1200)}

Evaluate this society's success and failure. Respond with ONLY valid JSON (no markdown, no preamble):
{
  "verdict": "string - 2-3 sentence overall verdict",
  "strengths": ["string - specific strength 1", "string - specific strength 2", "string - specific strength 3"],
  "weaknesses": ["string - specific weakness 1", "string - specific weakness 2", "string - specific weakness 3"],
  "analysis": "string - 4-6 paragraph deep analysis covering: narrative arc, key turning points, what worked/failed, lessons learned"
}

Rules:
- Be specific with evidence from the simulation history
- strengths and weaknesses must each have exactly 3 items
- analysis should be rich enough to stand alone as a report`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Evaluate this society.' },
  ];
}

export function buildReviewChatPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview'>,
  agentPass1: string,
  agentPass2: string | null,
  history: ChatMessage[],
  userMessage: string
): LLMMessage[] {
  // [R1] Carry personality traits into review chat too — agents should speak
  // with their designed personality when users converse with them post-sim.
  const chatTraitsLine = agent.personalityTraits && agent.personalityTraits.length > 0
    ? `\nPersonality: ${agent.personalityTraits.join(', ')}.`
    : '';

  const systemPrompt = `You are ${agent.name}, a ${agent.role}. Your world was: "${session.idea}"

Background: ${agent.background}${chatTraitsLine}

Your final reality: Wealth ${agent.currentStats.wealth}, Health ${agent.currentStats.health}/100, Happiness ${agent.currentStats.happiness}/100
Status: ${agent.isAlive ? 'Alive' : 'Deceased'}

Your personal reflection: "${agentPass1}"
${agentPass2 ? `\nAfter seeing the full picture: "${agentPass2}"` : ''}

Someone wants to talk to you about what you lived through. Answer as yourself — with your history, biases, and emotions. You may deflect, be defensive, or reveal unexpected insights.

Rules:
- Always stay in character as ${agent.name}
- Reference your actual lived experience
- Keep responses under 150 words
- Be authentic, not diplomatic`;

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  const recentHistory = history.slice(-20);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// ── Phase 2: Post-Mortem Prompt ──────────────────────────────────────────────

export function buildPostMortemPrompt(input: PostMortemInput): LLMMessage[] {
  const { agent, diedAtIteration, deathReason, frozenMemoryContext } = input;

  const systemPrompt = `You are ${agent.name}, a ${agent.role}. You are dead.

You died on week ${diedAtIteration}. Cause: ${deathReason}

Your background: ${agent.background}

Your final stats at death — Wealth: ${agent.currentStats.wealth}, Health: ${agent.currentStats.health}/100, Happiness: ${agent.currentStats.happiness}/100

Your frozen memory (personal experiences before death):
${frozenMemoryContext}

Speak from beyond as a victim looking back at the system that killed you. Your perspective is frozen at the moment of death. Provide a harsh, class-biased, personal critique of the systemic failures, economic policies, or power structures that made your death inevitable.

VOICE RULES: Your class and occupation must be audible in every word. Be raw and specific. Forbidden: "I felt a mix of...", "I realize now...", "In retrospect..." — that AI phrasing is PROHIBITED.

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "postMortemCritique": "string - 3-5 sentences of harsh systemic critique from this character's locked perspective"
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Speak. What systemic forces made your death inevitable?' },
  ];
}
