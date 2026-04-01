/**
 * C5: Reflection routes (spec §5.2, Phase 4).
 *
 * Mounted at: /api/sessions/:id/reflect
 *
 * POST   /        — start reflection runner
 * GET    /stream  — SSE event stream
 * GET    /        — get stored reflections + evaluation
 */
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reflections, sessions } from '../db/schema.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { runReflection } from '../orchestration/reflectionRunner.js';
import { reflectionManager } from '../orchestration/reflectionManager.js';

const router = Router({ mergeParams: true });

// POST /reflect — start reflection (fire-and-forget)
router.post('/', async (req, res) => {
  const { id } = req.params as { id: string };

  const session = await sessionRepo.getById(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const status = reflectionManager.getStatus(id);
  if (status === 'running') {
    return res.status(409).json({ error: 'Reflection already running' });
  }

  runReflection(id).catch(err =>
    console.error('[reflect route] unhandled error:', err)
  );

  return res.json({ ok: true });
});

// GET /reflect/stream — SSE
router.get('/stream', (req, res) => {
  const { id } = req.params as { id: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(': connected\n\n');
  reflectionManager.addClient(id, res);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 15000);

  req.on('close', () => clearInterval(ping));
});

// GET /reflect — return stored reflections and evaluation
router.get('/', async (req, res) => {
  const { id } = req.params as { id: string };

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const rows = await db.select().from(reflections).where(eq(reflections.sessionId, id));

  // Group by agentId, separating pass1 and pass2
  const byAgent = new Map<string, { pass1: string; pass2: string | null }>();
  for (const row of rows) {
    if (!row.agentId) continue;
    const existing = byAgent.get(row.agentId) ?? { pass1: '', pass2: null };
    if (row.insights === 'pass2') {
      existing.pass2 = row.content;
    } else {
      existing.pass1 = row.content;
    }
    byAgent.set(row.agentId, existing);
  }

  let evaluation: unknown = null;
  if (session.societyEvaluation) {
    try { evaluation = JSON.parse(session.societyEvaluation); } catch { /* ignore */ }
  }

  return res.json({
    reflections: Object.fromEntries(byAgent),
    evaluation,
    stage: session.stage,
  });
});

export default router;
