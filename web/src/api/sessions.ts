import { apiFetch } from './client';
import type { SessionMetadata } from '@policylab/shared';

export const sessionsApi = {
  list: () => apiFetch<SessionMetadata[]>('/sessions'),

  create: (idea: string, title?: string) =>
    apiFetch<{ id: string }>('/sessions', 'POST', { idea, title }),

  delete: (id: string) =>
    apiFetch<void>(`/sessions/${id}`, 'DELETE'),

  getIterations: (id: string) =>
    apiFetch<Record<string, unknown>[]>(`/sessions/${id}/iterations?full=true`),
};
