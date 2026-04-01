/**
 * C1: ChatMessageRepo — append and query chat messages (spec §5.5).
 */
import { and, eq, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../index.js';
import { chatMessages } from '../schema.js';
import type { ChatMessage, ChatContext } from '@policylab/shared';

function rowToMsg(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    context: row.context as ChatContext,
    agentId: row.agentId ?? null,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    timestamp: row.timestamp,
  };
}

export const chatMessageRepo = {
  async append(msg: Omit<ChatMessage, 'id'>): Promise<ChatMessage> {
    const id = uuidv4();
    await db.insert(chatMessages).values({
      id,
      sessionId: msg.sessionId,
      context: msg.context as string,
      agentId: msg.agentId ?? null,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp ?? new Date().toISOString(),
    });
    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return rowToMsg(row);
  },

  async listByContext(sessionId: string, context: ChatContext | string): Promise<ChatMessage[]> {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, sessionId),
          eq(chatMessages.context, context as string)
        )
      )
      .orderBy(asc(chatMessages.timestamp));
    return rows.map(rowToMsg);
  },
};
