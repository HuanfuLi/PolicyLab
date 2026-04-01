import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, chatMessages, agents } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { brainstorm, refine } from '../llm/centralAgent.js';
import { readSettings } from '../settings.js';
import type { ChatMessage, BrainstormChecklist, SessionConfig } from '@policylab/shared';

const router = Router({ mergeParams: true });

// POST /api/sessions/:id/chat
// Body: { message, context: 'brainstorm' | 'refinement' }
router.post('/', async (req, res) => {
  const { id } = req.params as { id: string };
  const { message, context } = req.body as { message?: string; context?: string };
  const maxLength = readSettings().maxMessageLength ?? 64000;

  if (!message || message.trim().length === 0 || message.length > maxLength) {
    return res.status(400).json({ error: `message must be 1-${maxLength} characters` });
  }
  if (context !== 'brainstorm' && context !== 'refinement') {
    return res.status(400).json({ error: 'context must be "brainstorm" or "refinement"' });
  }

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const now = () => new Date().toISOString();

  // If first brainstorm message, advance stage from idea-input → brainstorming
  if (context === 'brainstorm' && session.stage === 'idea-input') {
    await db
      .update(sessions)
      .set({ stage: 'brainstorming', updatedAt: now() })
      .where(eq(sessions.id, id));
    session.stage = 'brainstorming';
  }

  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, id))
    .orderBy(asc(chatMessages.timestamp));

  const history: ChatMessage[] = historyRows
    .filter(r => r.context === context)
    .map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      context: r.context as ChatMessage['context'],
      agentId: r.agentId ?? null,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      timestamp: r.timestamp,
    }));

  // Persist user message
  const userMsgId = uuidv4();
  await db.insert(chatMessages).values({
    id: userMsgId,
    sessionId: id,
    context,
    agentId: null,
    role: 'user',
    content: message.trim(),
    timestamp: now(),
  });

  try {
    if (context === 'brainstorm') {
      let currentChecklist: import('@policylab/shared').BrainstormChecklist | undefined;
      if (session.config) {
        try {
          const cfg = JSON.parse(session.config) as import('@policylab/shared').SessionConfig;
          currentChecklist = cfg.checklist;
        } catch { /* ignore malformed config */ }
      }
      const result = await brainstorm(id, session.idea, history, message.trim(), currentChecklist);

      let currentConfig: SessionConfig = {
        totalIterations: 20,
        checklist: {
          governance: false,
          economy: false,
          legal: false,
          culture: false,
          infrastructure: false,
        },
        readyForDesign: false,
      };
      if (session.config) {
        try {
          const parsed = JSON.parse(session.config);
          currentConfig = { ...currentConfig, ...parsed };
        } catch {
          // ignore malformed config
        }
      }

      const updatedConfig: SessionConfig = {
        ...currentConfig,
        checklist: {
          governance: currentConfig.checklist.governance || result.checklist.governance,
          economy: currentConfig.checklist.economy || result.checklist.economy,
          legal: currentConfig.checklist.legal || result.checklist.legal,
          culture: currentConfig.checklist.culture || result.checklist.culture,
          infrastructure: currentConfig.checklist.infrastructure || result.checklist.infrastructure,
        },
        readyForDesign: result.readyForDesign,
      };

      // If all checklist items are true, force readyForDesign
      const allConfirmed = Object.values(updatedConfig.checklist).every(Boolean);
      if (allConfirmed) updatedConfig.readyForDesign = true;

      await db
        .update(sessions)
        .set({ config: JSON.stringify(updatedConfig), updatedAt: now() })
        .where(eq(sessions.id, id));

      await db.insert(chatMessages).values({
        id: uuidv4(),
        sessionId: id,
        context,
        agentId: null,
        role: 'assistant',
        content: result.reply,
        timestamp: now(),
      });

      return res.json({
        reply: result.reply,
        updatedChecklist: result.checklist,
        readyForDesign: result.readyForDesign,
        artifactsUpdated: [],
        agentsSummary: null,
      });
    } else {
      // refinement context
      const agentRows = await db
        .select()
        .from(agents)
        .where(eq(agents.sessionId, id));

      const result = await refine(
        {
          id: session.id,
          title: session.title,
          idea: session.idea,
          societyOverview: session.societyOverview,
          law: session.law,
          config: session.config,
        },
        agentRows,
        history,
        message.trim()
      );

      await db.insert(chatMessages).values({
        id: uuidv4(),
        sessionId: id,
        context,
        agentId: null,
        role: 'assistant',
        content: result.reply,
        timestamp: now(),
      });

      return res.json({
        reply: result.reply,
        updatedChecklist: null,
        readyForDesign: false,
        artifactsUpdated: result.artifactsUpdated,
        agentsSummary: result.agentsSummary,
      });
    }
  } catch (err) {
    console.error('POST /sessions/:id/chat error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'LLM call failed', detail });
  }
});

export default router;
