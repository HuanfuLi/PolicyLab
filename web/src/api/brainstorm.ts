import { apiFetch } from './client';
import type { SessionDetail, ChatMessage, Agent, ChatResponse, Stage } from '@policylab/shared';

export const brainstormApi = {
  getSession: (id: string) =>
    apiFetch<SessionDetail>(`/sessions/${id}`),

  getMessages: (id: string) =>
    apiFetch<{ brainstorm: ChatMessage[]; refinement: ChatMessage[] }>(`/sessions/${id}/messages`),

  getAgents: (id: string) =>
    apiFetch<{ agents: Agent[]; total: number }>(`/sessions/${id}/agents`),

  chat: (id: string, message: string, context: 'brainstorm' | 'refinement') =>
    apiFetch<ChatResponse>(`/sessions/${id}/chat`, 'POST', { message, context }),

  patchConfig: (id: string, patch: Record<string, unknown>) =>
    apiFetch(`/sessions/${id}/config`, 'PUT', patch),

  patchStage: (id: string, stage: Stage) =>
    apiFetch(`/sessions/${id}/stage`, 'PATCH', { stage }),
};
