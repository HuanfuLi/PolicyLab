import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, chatMessages } from '../db/schema.js';
import { generateDesign } from '../llm/centralAgent.js';
import type { ChatMessage } from '@policylab/shared';

const router = Router({ mergeParams: true });

// POST /api/sessions/:id/design — SSE stream (spec §5.2)
router.post('/', async (req, res) => {
  const { id } = req.params as { id: string };

  // Fetch session
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Validate preconditions
  let config: { readyForDesign?: boolean } = {};
  if (session.config) {
    try {
      config = JSON.parse(session.config);
    } catch {
      // ignore
    }
  }

  if (session.stage !== 'brainstorming' || !config.readyForDesign) {
    return res.status(400).json({
      error: 'Session is not ready for design generation',
      stage: session.stage,
      readyForDesign: config.readyForDesign ?? false,
    });
  }

  // Immediately set stage to 'designing' to prevent duplicate triggers
  const now = new Date().toISOString();
  await db
    .update(sessions)
    .set({ stage: 'designing', updatedAt: now })
    .where(eq(sessions.id, id));

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Load brainstorm chat history
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, id))
    .orderBy(asc(chatMessages.timestamp));

  const brainstormHistory: ChatMessage[] = historyRows
    .filter(r => r.context === 'brainstorm')
    .map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      context: r.context,
      agentId: r.agentId ?? null,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      timestamp: r.timestamp,
    }));

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await generateDesign(
      { id: session.id, idea: session.idea, societyOverview: session.societyOverview, law: session.law, config: session.config },
      brainstormHistory,
      sendEvent
    );
    res.end();
  } catch (err) {
    console.error('Design generation error:', err);
    const message = err instanceof Error ? err.message : String(err);
    sendEvent({ type: 'error', step: 'unknown', message });

    // Rollback stage
    await db
      .update(sessions)
      .set({ stage: 'brainstorming', updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, id));

    res.end();
  }
});

export default router;
