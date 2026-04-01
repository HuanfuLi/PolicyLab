/**
 * ReflectionManager — tracks per-session reflection status and SSE clients.
 * Mirrors SimulationManager but simpler (no pause/resume).
 */
import type { Response } from 'express';

type ReflectionStatus = 'idle' | 'running' | 'done';

interface ReflectionState {
  status: ReflectionStatus;
  clients: Set<Response>;
}

class ReflectionManager {
  private readonly sessions = new Map<string, ReflectionState>();

  private ensure(sessionId: string): ReflectionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { status: 'idle', clients: new Set() });
    }
    return this.sessions.get(sessionId)!;
  }

  getStatus(sessionId: string): ReflectionStatus {
    return this.sessions.get(sessionId)?.status ?? 'idle';
  }

  start(sessionId: string): void {
    const s = this.ensure(sessionId);
    s.status = 'running';
  }

  finish(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.status = 'done';
      // Close all connected clients
      for (const client of s.clients) {
        try { client.end(); } catch { /* ignore */ }
      }
      s.clients.clear();
    }
  }

  addClient(sessionId: string, res: Response): void {
    const s = this.ensure(sessionId);
    s.clients.add(res);
    res.on('close', () => s.clients.delete(res));
  }

  broadcast(sessionId: string, event: Record<string, unknown>): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of s.clients) {
      try { client.write(payload); } catch { s.clients.delete(client); }
    }
  }
}

export const reflectionManager = new ReflectionManager();
