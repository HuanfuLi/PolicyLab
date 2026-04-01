/**
 * Artifacts route — assembles session artifacts on-demand from existing tables.
 *
 * Mounted at: /api/sessions/:id/artifacts
 *
 * GET / — return all artifacts for the session as an array
 */
import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, agents, iterations, reflections, chatMessages } from '../db/schema.js';

const router = Router({ mergeParams: true });

interface ArtifactItem {
  id: string;
  type: string;
  title: string;
  content: string;
  generatedAt: string;
  timestamp: string;
  agentId?: string;
  iterationNumber?: number;
}

router.get('/', async (req, res) => {
  const { id } = req.params as { id: string };

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const artifacts: ArtifactItem[] = [];

  // ── Design artifacts ────────────────────────────────────────────────────────

  if (session.societyOverview) {
    const title = session.title ?? 'Society Overview';
    artifacts.push({
      id: `${id}:overview`,
      type: 'society-overview',
      title: 'Society Overview',
      content: [
        `# ${title}`,
        session.societyOverview,
        session.timeScale ? `\n**Time Scale:** ${session.timeScale}` : '',
      ].filter(Boolean).join('\n\n'),
      generatedAt: 'designing',
      timestamp: session.updatedAt,
    });
  }

  if (session.law) {
    artifacts.push({
      id: `${id}:law`,
      type: 'virtual-law',
      title: 'Virtual Law',
      content: `# Virtual Law\n\n${session.law}`,
      generatedAt: 'designing',
      timestamp: session.updatedAt,
    });
  }

  const agentRows = await db.select().from(agents).where(eq(agents.sessionId, id));
  const citizenAgents = agentRows.filter(a => a.type !== 'central');
  if (citizenAgents.length > 0) {
    const lines = citizenAgents.map((a, i) => {
      let stats: { wealth: number; health: number; happiness: number } = { wealth: 50, health: 70, happiness: 60 };
      try { stats = JSON.parse(a.initialStats); } catch { /* use defaults */ }
      return [
        `### ${i + 1}. ${a.name}`,
        `**Role:** ${a.role}`,
        `**Initial Stats:** Wealth ${stats.wealth} | Health ${stats.health} | Happiness ${stats.happiness}`,
        `**Background:** ${a.background}`,
      ].join('\n');
    });
    artifacts.push({
      id: `${id}:roster`,
      type: 'agent-roster',
      title: `Agent Roster (${citizenAgents.length} agents)`,
      content: `# Agent Roster\n\n${lines.join('\n\n---\n\n')}`,
      generatedAt: 'designing',
      timestamp: session.updatedAt,
    });
  }

  // ── Chat transcripts ────────────────────────────────────────────────────────

  const allMessages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, id))
    .orderBy(asc(chatMessages.timestamp));

  const brainstormMsgs = allMessages.filter(m => m.context === 'brainstorm' && m.role !== 'system');
  if (brainstormMsgs.length > 0) {
    const transcript = brainstormMsgs
      .map(m => `**${m.role === 'user' ? 'You' : 'Central Agent'}:**\n${m.content}`)
      .join('\n\n---\n\n');
    artifacts.push({
      id: `${id}:brainstorm`,
      type: 'brainstorming-transcript',
      title: 'Brainstorming Transcript',
      content: `# Brainstorming Transcript\n\n${transcript}`,
      generatedAt: 'brainstorming',
      timestamp: brainstormMsgs.at(-1)!.timestamp,
    });
  }

  const refinementMsgs = allMessages.filter(m => m.context === 'refinement' && m.role !== 'system');
  if (refinementMsgs.length > 0) {
    const transcript = refinementMsgs
      .map(m => `**${m.role === 'user' ? 'You' : 'Central Agent'}:**\n${m.content}`)
      .join('\n\n---\n\n');
    artifacts.push({
      id: `${id}:refinement`,
      type: 'refinement-transcript',
      title: 'Refinement Transcript',
      content: `# Design Refinement Transcript\n\n${transcript}`,
      generatedAt: 'design-review',
      timestamp: refinementMsgs.at(-1)!.timestamp,
    });
  }

  // ── Simulation artifacts ────────────────────────────────────────────────────

  const iterRows = await db
    .select()
    .from(iterations)
    .where(eq(iterations.sessionId, id))
    .orderBy(asc(iterations.iterationNumber));

  for (const iter of iterRows) {
    artifacts.push({
      id: `${id}:iter:${iter.iterationNumber}`,
      type: 'iteration-summary',
      title: `Iteration ${iter.iterationNumber}`,
      content: `# Iteration ${iter.iterationNumber} Summary\n\n${iter.stateSummary}`,
      generatedAt: 'simulating',
      timestamp: iter.timestamp,
      iterationNumber: iter.iterationNumber,
    });
  }

  // ── Reflection artifacts ────────────────────────────────────────────────────

  if (session.societyEvaluation) {
    try {
      const ev = JSON.parse(session.societyEvaluation) as {
        verdict: string;
        strengths: string[];
        weaknesses: string[];
        analysis: string;
      };
      const content = [
        '# Society Evaluation Report',
        `## Verdict\n${ev.verdict}`,
        `## Strengths\n${ev.strengths.map(s => `- ${s}`).join('\n')}`,
        `## Weaknesses\n${ev.weaknesses.map(w => `- ${w}`).join('\n')}`,
        `## Analysis\n${ev.analysis}`,
      ].join('\n\n');
      artifacts.push({
        id: `${id}:evaluation`,
        type: 'society-evaluation',
        title: 'Society Evaluation Report',
        content,
        generatedAt: 'reflecting',
        timestamp: session.updatedAt,
      });
    } catch { /* malformed JSON — skip */ }
  }

  const reflectionRows = await db.select().from(reflections).where(eq(reflections.sessionId, id));
  const agentMap = new Map(agentRows.map(a => [a.id, a]));
  const reflByAgent = new Map<string, { pass1: string; pass2?: string; ts: string }>();
  for (const r of reflectionRows) {
    if (!r.agentId) continue;
    const existing = reflByAgent.get(r.agentId) ?? { pass1: '', ts: r.createdAt };
    if (r.insights === 'pass2') {
      existing.pass2 = r.content;
    } else {
      existing.pass1 = r.content;
    }
    reflByAgent.set(r.agentId, existing);
  }

  for (const [agentId, refl] of reflByAgent) {
    const agent = agentMap.get(agentId);
    const agentName = agent?.name ?? agentId;
    const sections = [
      `# ${agentName} — Reflection`,
      refl.pass1 ? `## Personal Perspective\n${refl.pass1}` : '',
      refl.pass2 ? `## After Seeing the Full Picture\n${refl.pass2}` : '',
    ].filter(Boolean);
    artifacts.push({
      id: `${id}:refl:${agentId}`,
      type: 'agent-reflection',
      title: `${agentName} — Reflection`,
      content: sections.join('\n\n'),
      generatedAt: 'reflecting',
      timestamp: refl.ts,
      agentId,
    });
  }

  // ── Q&A transcripts (per agent) ─────────────────────────────────────────────

  const qaMsgs = allMessages.filter(m => typeof m.context === 'string' && m.context.startsWith('review:'));
  const byContext = new Map<string, typeof qaMsgs>();
  for (const msg of qaMsgs) {
    const arr = byContext.get(msg.context) ?? [];
    arr.push(msg);
    byContext.set(msg.context, arr);
  }

  for (const [context, msgs] of byContext) {
    const agentId = context.slice('review:'.length);
    const agent = agentMap.get(agentId);
    const agentName = agent?.name ?? agentId;
    const transcript = msgs
      .filter(m => m.role !== 'system')
      .map(m => `**${m.role === 'user' ? 'You' : agentName}:**\n${m.content}`)
      .join('\n\n---\n\n');
    artifacts.push({
      id: `${id}:qa:${agentId}`,
      type: 'qa-transcript',
      title: `Q&A with ${agentName}`,
      content: `# Q&A with ${agentName}\n\n${transcript}`,
      generatedAt: 'reviewing',
      timestamp: msgs.at(-1)!.timestamp,
      agentId,
    });
  }

  return res.json({ artifacts });
});

export default router;
