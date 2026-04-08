import type { LLMMessage } from '../types.js';
import type { Agent, ChatMessage, Session } from '@policylab/shared';
import type { PostMortemInput } from './shared.js';

// ── Phase 4 prompts ─────────────────────────────────────────────────────────

export function buildAgentReflectionPrompt(
  agent: Agent,
  session: Pick<Session, 'idea' | 'societyOverview' | 'timeScale'>,
  iterationSummaries: Array<{ number: number; summary: string }>
): LLMMessage[] {
  const summaryText = iterationSummaries
    .map(s => `Iteration ${s.number}: ${s.summary}`)
    .join('\n');

  const cortisolStat = (agent.currentStats as unknown as Record<string, unknown>).cortisol;
  const cortisolLine = cortisolStat != null ? `- Cortisol (stress): ${cortisolStat}/100` : '';

  const systemPrompt = `You are ${agent.name}, a ${agent.role}. This is your life, your world: "${session.idea}"

Background: ${agent.background}

Your final material reality:
- Wealth: ${agent.currentStats.wealth}
- Health: ${agent.currentStats.health}/100
- Happiness: ${agent.currentStats.happiness}/100${cortisolLine ? `\n${cortisolLine}` : ''}
- Status: ${agent.isAlive ? 'Alive' : 'Deceased'}

It is over now. Reflect on your MATERIAL EXPERIENCE — your economic reality, not abstract philosophy.

What you lived through (${iterationSummaries.length} weeks):
${summaryText.slice(0, 2000)}

You MUST respond with ONLY valid JSON (no markdown, no preamble):
{
  "pass1": "string - your personal reflection (3-5 sentences, first person, raw and honest)"
}

Rules:
- ANCHOR every sentence in MATERIAL REALITY: your actual wealth trajectory, food access, labour conditions, wages, debts, or inequality you witnessed. Did you eat? Were you exploited? Did you hoard or starve? Compare yourself to others.
- Do NOT reflect on abstract philosophy, systems, or ideals — ground it in YOUR specific economic experience
- Speak as this specific character — their class, background, and biases must be audible in every sentence
- Express raw, unfiltered emotion rooted in material conditions: rage at poverty, guilt at excess, desperation from hunger, pride from earnings, resentment of exploitation — whatever is authentic to this person's class position
- Do NOT use standard AI phrasing ("I felt a mix of...", "I realized that...", "In that moment...") — FORBIDDEN
- Do not summarize society history; reflect from YOUR narrow, economically-grounded, personal vantage point`;

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
  const systemPrompt = `You are ${agent.name}, a ${agent.role}.

You previously reflected: "${pass1}"

You have now been shown the full society evaluation report:
${evaluationAnalysis.slice(0, 800)}

Does knowing the full picture change your perspective? Respond with ONLY valid JSON (no markdown, no preamble):
{
  "pass2": "string - your updated reflection after seeing the full picture (2-4 sentences, first person)"
}

Rules:
- You may soften, deepen, or completely harden your original view — let your class and personal losses dictate which
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
  const systemPrompt = `You are ${agent.name}, a ${agent.role}. Your world was: "${session.idea}"

Background: ${agent.background}

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
