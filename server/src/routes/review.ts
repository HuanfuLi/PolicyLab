/**
 * C5: Review routes — agent Q&A chat (spec §5.2, Phase 4).
 *
 * Mounted at: /api/sessions/:id/review
 *
 * POST   /:agentId/chat      — send a message to an agent
 * GET    /:agentId/messages  — get chat history for an agent
 */
import { Router } from 'express';
import { eq, asc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { chatMessages, sessions, agents, reflections } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { getProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import { buildReviewChatPrompt } from '../llm/prompts/index.js';
import { agentRepo } from '../db/repos/agentRepo.js';
import type { ChatMessage } from '@policylab/shared';
import { createScope } from '../db/sessionScope.js';

const router = Router({ mergeParams: true });

// POST /:agentId/chat
router.post('/:agentId/chat', async (req, res) => {
  const { id, agentId } = req.params as { id: string; agentId: string };
  const { message } = req.body as { message?: string };
  const maxLength = readSettings().maxMessageLength ?? 64000;

  if (!message || message.trim().length === 0 || message.length > maxLength) {
    return res.status(400).json({ error: `message must be 1-${maxLength} characters` });
  }

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const allAgents = await agentRepo.listBySession(createScope(id));
  const agent = allAgents.find(a => a.id === agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Advance stage to 'reviewing' on first chat message
  if (session.stage === 'reflection-complete') {
    await db
      .update(sessions)
      .set({ stage: 'reviewing', updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, id));
  }

  const context = `review:${agentId}` as const;
  const now = new Date().toISOString();

  // Load chat history for this agent
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, id), eq(chatMessages.context, context)))
    .orderBy(asc(chatMessages.timestamp));

  const history: ChatMessage[] = historyRows.map(r => ({
    id: r.id,
    sessionId: r.sessionId,
    context: r.context as ChatMessage['context'],
    agentId: r.agentId ?? null,
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
    timestamp: r.timestamp,
  }));

  // Load reflections for this agent
  const reflRows = await db
    .select()
    .from(reflections)
    .where(and(eq(reflections.sessionId, id), eq(reflections.agentId, agentId)));

  const pass1 = reflRows.find(r => r.insights !== 'pass2')?.content ?? '';
  const pass2 = reflRows.find(r => r.insights === 'pass2')?.content ?? null;

  // Persist user message
  await db.insert(chatMessages).values({
    id: uuidv4(),
    sessionId: id,
    context,
    agentId,
    role: 'user',
    content: message.trim(),
    timestamp: now,
  });

  try {
    const settings = readSettings();
    const provider = getProvider();
    const messages = buildReviewChatPrompt(
      agent,
      { idea: session.idea, societyOverview: session.societyOverview },
      pass1,
      pass2,
      history,
      message.trim()
    );
    const reply = await provider.chat(messages, { model: settings.citizenAgentModel });

    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: id,
      context,
      agentId,
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
    });

    return res.json({ reply });
  } catch (err) {
    console.error('POST /sessions/:id/review/:agentId/chat error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'LLM call failed', detail });
  }
});

// GET /:agentId/messages
router.get('/:agentId/messages', async (req, res) => {
  const { id, agentId } = req.params as { id: string; agentId: string };
  const context = `review:${agentId}`;

  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, id), eq(chatMessages.context, context)))
    .orderBy(asc(chatMessages.timestamp));

  const messages: ChatMessage[] = rows.map(r => ({
    id: r.id,
    sessionId: r.sessionId,
    context: r.context as ChatMessage['context'],
    agentId: r.agentId ?? null,
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
    timestamp: r.timestamp,
  }));

  return res.json({ messages });
});

export default router;
