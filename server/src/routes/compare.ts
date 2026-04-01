/**
 * Phase 5: Cross-session comparison routes.
 *
 * Mounted at: /api/compare
 *
 * POST /        — run LLM comparison of two sessions
 * POST /chat    — follow-up Q&A on an existing comparison
 */
import { Router } from 'express';
import { and, asc, eq, like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, agents, iterations, chatMessages } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { getProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import { buildComparisonMessages, buildComparisonChatMessages } from '../llm/prompts.js';
import { parseJSON } from '../parsers/json.js';
import type { ComparisonResult, ChatMessage } from '@policylab/shared';

const router = Router();

/** Gather all data needed to describe a session for comparison. */
async function loadSessionSummary(sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return null;

  const agentRows = await db.select().from(agents).where(eq(agents.sessionId, sessionId));
  const agentCount = agentRows.length;
  const deaths = agentRows.filter(a => a.status === 'dead').length;

  const iterRows = await db
    .select()
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .orderBy(asc(iterations.iterationNumber));

  let avgWealth = 0, avgHealth = 0, avgHappiness = 0;
  if (iterRows.length > 0) {
    const last = iterRows[iterRows.length - 1];
    try {
      const stats = JSON.parse(last.statistics) as {
        avgWealth?: number; avgHealth?: number; avgHappiness?: number;
      };
      avgWealth = Math.round(stats.avgWealth ?? 0);
      avgHealth = Math.round(stats.avgHealth ?? 0);
      avgHappiness = Math.round(stats.avgHappiness ?? 0);
    } catch { /* use defaults */ }
  }

  let verdict: string | null = null;
  if (session.societyEvaluation) {
    try {
      const ev = JSON.parse(session.societyEvaluation) as { verdict?: string };
      verdict = ev.verdict ?? null;
    } catch { /* ignore */ }
  }

  return {
    title: session.title,
    societyOverview: session.societyOverview,
    law: session.law,
    agentCount,
    deaths,
    avgWealth,
    avgHealth,
    avgHappiness,
    verdict,
  };
}

// POST /api/compare
router.post('/', async (req, res) => {
  const { id1, id2 } = req.body as { id1?: string; id2?: string };

  if (!id1 || !id2) {
    return res.status(400).json({ error: 'id1 and id2 are required' });
  }
  if (id1 === id2) {
    return res.status(400).json({ error: 'id1 and id2 must be different sessions' });
  }

  const [summary1, summary2] = await Promise.all([
    loadSessionSummary(id1),
    loadSessionSummary(id2),
  ]);

  if (!summary1) return res.status(404).json({ error: `Session ${id1} not found` });
  if (!summary2) return res.status(404).json({ error: `Session ${id2} not found` });

  try {
    const settings = readSettings();
    const provider = getProvider();
    const llmMessages = buildComparisonMessages(summary1, summary2);
    const raw = await provider.chat(llmMessages, { model: settings.centralAgentModel });
    const parsed = parseJSON<{ narrative: string; dimensions: ComparisonResult['dimensions']; verdict: string }>(raw);

    const comparison: ComparisonResult = {
      session1Id: id1,
      session2Id: id2,
      narrative: parsed.narrative,
      dimensions: parsed.dimensions,
      verdict: parsed.verdict,
    };

    // Persist the comparison as a system message so /chat can reload it
    const context = `compare:${id1}:${id2}`;
    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: id1,
      context,
      agentId: null,
      role: 'system',
      content: JSON.stringify(comparison),
      timestamp: new Date().toISOString(),
    });

    return res.json({ comparison });
  } catch (err) {
    console.error('POST /api/compare error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'LLM call failed', detail });
  }
});

// POST /api/compare/chat
router.post('/chat', async (req, res) => {
  const { id1, id2, message } = req.body as { id1?: string; id2?: string; message?: string };
  const maxLength = readSettings().maxMessageLength ?? 64000;

  if (!id1 || !id2) {
    return res.status(400).json({ error: 'id1 and id2 are required' });
  }
  if (!message || message.trim().length === 0 || message.length > maxLength) {
    return res.status(400).json({ error: `message must be 1-${maxLength} characters` });
  }

  // Verify both sessions exist
  const [s1, s2] = await Promise.all([
    db.select().from(sessions).where(eq(sessions.id, id1)),
    db.select().from(sessions).where(eq(sessions.id, id2)),
  ]);
  if (!s1[0]) return res.status(404).json({ error: `Session ${id1} not found` });
  if (!s2[0]) return res.status(404).json({ error: `Session ${id2} not found` });

  const context = `compare:${id1}:${id2}`;

  // Load all stored messages for this comparison context
  const allRows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, id1), eq(chatMessages.context, context)))
    .orderBy(asc(chatMessages.timestamp));

  // The latest system message holds the comparison result
  const systemRow = [...allRows].reverse().find(r => r.role === 'system');
  if (!systemRow) {
    return res.status(409).json({ error: 'No comparison found for these sessions. Run POST /api/compare first.' });
  }

  let comparison: ComparisonResult;
  try {
    comparison = JSON.parse(systemRow.content) as ComparisonResult;
  } catch {
    return res.status(500).json({ error: 'Stored comparison data is corrupt' });
  }

  // Chat history = non-system messages
  const history: ChatMessage[] = allRows
    .filter(r => r.role !== 'system')
    .map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      context: r.context as ChatMessage['context'],
      agentId: r.agentId ?? null,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      timestamp: r.timestamp,
    }));

  const now = new Date().toISOString();

  // Persist user message
  await db.insert(chatMessages).values({
    id: uuidv4(),
    sessionId: id1,
    context,
    agentId: null,
    role: 'user',
    content: message.trim(),
    timestamp: now,
  });

  try {
    const settings = readSettings();
    const provider = getProvider();
    const llmMessages = buildComparisonChatMessages(
      s1[0].title,
      s2[0].title,
      comparison,
      history,
      message.trim()
    );
    const reply = await provider.chat(llmMessages, { model: settings.centralAgentModel });

    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: id1,
      context,
      agentId: null,
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
    });

    return res.json({ reply });
  } catch (err) {
    console.error('POST /api/compare/chat error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'LLM call failed', detail });
  }
});

// GET /api/compare/history
router.get('/history', async (req, res) => {
  try {
    const rows = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        context: chatMessages.context,
        content: chatMessages.content,
        timestamp: chatMessages.timestamp
      })
      .from(chatMessages)
      .where(and(eq(chatMessages.role, 'system'), like(chatMessages.context, 'compare:%')))
      .orderBy(asc(chatMessages.timestamp));

    const history = rows.map(r => {
      try {
        const comparison = JSON.parse(r.content) as ComparisonResult;
        return {
          id: r.id,
          timestamp: r.timestamp,
          comparison
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch comparison history' });
  }
});

export default router;
