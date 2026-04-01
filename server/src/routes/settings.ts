import { Router } from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { readSettings, writeSettings } from '../settings.js';
import { getProvider, invalidateProvider, createProviderFromSettings } from '../llm/gateway.js';
import type { AppSettings, Agent } from '@policylab/shared';
import type { SkillMatrix, Inventory } from '@policylab/shared';
import { resolveAction, clampHappinessByPhysiology } from '../mechanics/physicsEngine.js';
import { getPhysicsConfig, updatePhysicsConfig, resetPhysicsConfig } from '../mechanics/physicsConfig.js';
import { normalizeActionCode } from '../mechanics/actionCodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// GET /api/settings
router.get('/', (_req, res) => {
  try {
    const s = readSettings();
    const keys = s.apiKeys ?? {};
    res.json({
      provider: s.provider,
      hasApiKey: s.apiKey.length > 0,
      savedApiKeys: {
        claude: !!(keys.claude),
        openai: !!(keys.openai),
        gemini: !!(keys.gemini),
        vertex: !!(keys.vertex),
      },
      baseUrl: s.baseUrl,
      centralAgentModel: s.centralAgentModel,
      citizenAgentModel: s.citizenAgentModel,
      maxConcurrency: s.maxConcurrency,
      citizenProvider: s.citizenProvider,
      hasCitizenApiKey: !!(s.citizenApiKey && s.citizenApiKey.length > 0),
      citizenBaseUrl: s.citizenBaseUrl,
      maxMessageLength: s.maxMessageLength,
      vertexProjectId: s.vertexProjectId,
      vertexLocation: s.vertexLocation,
      citizenVertexProjectId: s.citizenVertexProjectId,
      citizenVertexLocation: s.citizenVertexLocation,
    });
  } catch (err) {
    console.error('GET /settings error:', err);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// PUT /api/settings
router.put('/', (req, res) => {
  try {
    const body = req.body as Partial<AppSettings>;

    // Frontend sends null to explicitly clear fields (JSON stringify drops undefined)
    for (const key of Object.keys(body)) {
      if ((body as any)[key] === null) {
        (body as any)[key] = undefined;
      }
    }

    // If apiKey field is empty and we're staying on the same provider,
    // keep the existing key (don't overwrite with empty from masked UI).
    // But if switching providers, let writeSettings resolve the correct key.
    const current = readSettings();
    const switchingProvider = body.provider && body.provider !== current.provider;
    if (body.apiKey !== undefined && body.apiKey.trim() === '' && current.apiKey && !switchingProvider) {
      delete body.apiKey;
    }
    // Same for citizenApiKey
    if (body.citizenApiKey !== undefined && body.citizenApiKey.trim() === '' && current.citizenApiKey) {
      delete body.citizenApiKey;
    }

    const updated = writeSettings(body);
    invalidateProvider();

    const uKeys = updated.apiKeys ?? {};
    res.json({
      provider: updated.provider,
      hasApiKey: updated.apiKey.length > 0,
      savedApiKeys: {
        claude: !!(uKeys.claude),
        openai: !!(uKeys.openai),
        gemini: !!(uKeys.gemini),
        vertex: !!(uKeys.vertex),
      },
      baseUrl: updated.baseUrl,
      centralAgentModel: updated.centralAgentModel,
      citizenAgentModel: updated.citizenAgentModel,
      maxConcurrency: updated.maxConcurrency,
      citizenProvider: updated.citizenProvider,
      hasCitizenApiKey: !!(updated.citizenApiKey && updated.citizenApiKey.length > 0),
      citizenBaseUrl: updated.citizenBaseUrl,
      maxMessageLength: updated.maxMessageLength,
      vertexProjectId: updated.vertexProjectId,
      vertexLocation: updated.vertexLocation,
      citizenVertexProjectId: updated.citizenVertexProjectId,
      citizenVertexLocation: updated.citizenVertexLocation,
    });
  } catch (err) {
    console.error('PUT /settings error:', err);
    res.status(500).json({ error: 'Failed to write settings' });
  }
});

// POST /api/settings/test
//
// Accepts an optional JSON body with the same shape as AppSettings.
// Any fields provided in the body override what is on disk — this lets
// the frontend test with a freshly-typed API key before saving.
// The API key from the body is used only for this request; it is never
// persisted.
router.post('/test', async (req, res) => {
  try {
    // Merge saved settings with whatever the UI sent (body wins)
    const saved = readSettings();
    const body = (req.body ?? {}) as Partial<AppSettings>;

    const testProvider = body.provider ?? saved.provider;
    const testSettings: AppSettings = {
      ...saved,
      // Only override fields the body actually provided (non-empty)
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.apiKey?.trim() ? { apiKey: body.apiKey.trim() } : {}),
      ...(body.baseUrl?.trim() ? { baseUrl: body.baseUrl.trim() } : {}),
      ...(body.centralAgentModel?.trim() ? { centralAgentModel: body.centralAgentModel.trim() } : {}),
      ...(body.vertexProjectId?.trim() ? { vertexProjectId: body.vertexProjectId.trim() } : {}),
      ...(body.vertexLocation?.trim() ? { vertexLocation: body.vertexLocation.trim() } : {}),
    };

    // Resolve API key for the provider being tested from per-provider storage
    if (!body.apiKey?.trim() && testProvider !== 'local') {
      const savedKeys = saved.apiKeys ?? {};
      testSettings.apiKey = savedKeys[testProvider] ?? '';
    }

    // Validate: cloud providers (except Vertex) require an API key
    const needsKey = testSettings.provider !== 'local' && testSettings.provider !== 'vertex';
    if (needsKey && !testSettings.apiKey) {
      return res.json({
        ok: false,
        model: testSettings.centralAgentModel,
        latencyMs: 0,
        error: `No API key configured for ${testSettings.provider}. Enter your key and click Test Connection (or Save first).`,
      });
    }

    // Create a temporary provider (does not touch the module-level cache)
    const tempProvider = createProviderFromSettings(testSettings);
    const result = await tempProvider.testConnection();
    res.json(result);
  } catch (err) {
    res.json({
      ok: false,
      model: '',
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /api/settings/sandbox — run the deterministic physics sandbox test (no LLM calls)
router.post('/sandbox', (_req, res) => {
  const sandboxPath = path.resolve(__dirname, '../mechanics/__tests__/physics_sandbox.ts');

  res.setHeader('Content-Type', 'application/json');

  const child = spawn('npx', ['tsx', sandboxPath], {
    cwd: path.resolve(__dirname, '../../..'), // repo root (IdealWorld/)
    shell: process.platform === 'win32',
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

  child.on('close', (code) => {
    res.json({ output, exitCode: code ?? 1 });
  });

  child.on('error', (err) => {
    res.json({ output: `Failed to start sandbox: ${err.message}`, exitCode: 1 });
  });
});

// POST /api/settings/sandbox-json — run sandbox in --json mode; returns structured telemetry
router.post('/sandbox-json', (_req, res) => {
  const sandboxPath = path.resolve(__dirname, '../mechanics/__tests__/physics_sandbox.ts');

  // Pass the current in-memory physics config so the sandbox uses tweaked constants.
  const child = spawn('npx', ['tsx', sandboxPath, '--json'], {
    cwd: path.resolve(__dirname, '../../..'),
    shell: process.platform === 'win32',
    env: { ...process.env, PHYSICS_CONFIG_JSON: JSON.stringify(getPhysicsConfig()) },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on('close', (code) => {
    try {
      const data = JSON.parse(stdout);
      res.json({ ...data, exitCode: code ?? 1 });
    } catch {
      res.json({ error: 'Failed to parse sandbox output', raw: stdout + stderr, exitCode: code ?? 1 });
    }
  });

  child.on('error', (err) => {
    res.json({ error: `Failed to start sandbox: ${err.message}`, exitCode: 1 });
  });
});

// ── Physics Lab: GET /api/settings/physics-config ────────────────────────────
// Returns the live physics configuration (all numerical constants).
router.get('/physics-config', (_req, res) => {
  res.json(getPhysicsConfig());
});

// ── Physics Lab: PUT /api/settings/physics-config ────────────────────────────
// Hot-swaps one or more physics constants at runtime. Changes take effect
// immediately on the next resolveAction / allostatic tick call.
router.put('/physics-config', (req, res) => {
  try {
    const updated = updatePhysicsConfig(req.body ?? {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Physics Lab: POST /api/settings/physics-config/reset ─────────────────────
// Resets all physics constants to factory defaults.
router.post('/physics-config/reset', (_req, res) => {
  res.json(resetPhysicsConfig());
});

// ── Physics Lab: POST /api/settings/trace-physics ────────────────────────────
// Stateless "What-If" endpoint — runs resolveAction on a mock agent and returns
// the full math trace. Does NOT touch the database; safe to call any time.
router.post('/trace-physics', (req, res) => {
  try {
    const body = req.body as {
      role?: string;
      stats?: { wealth: number; health: number; happiness: number; cortisol: number; dopamine: number };
      skills?: SkillMatrix;
      inventory?: Inventory;
      actionCode?: string;
      isSabotaged?: boolean;
      isSuppressed?: boolean;
    };

    const stats = body.stats ?? { wealth: 50, health: 70, happiness: 60, cortisol: 20, dopamine: 50 };
    const role = (body.role ?? 'WORKER').toUpperCase();
    const actionCode = normalizeActionCode(body.actionCode ?? 'WORK');

    // Construct a minimal mock agent satisfying the Agent interface
    const mockAgent: Agent = {
      id: 'trace-mock',
      sessionId: 'trace',
      name: 'Mock Agent',
      role,
      background: '',
      initialStats: { ...stats },
      currentStats: { ...stats },
      isAlive: true,
      isCentralAgent: false,
      status: 'alive',
      type: 'citizen',
      bornAtIteration: null,
      diedAtIteration: null,
    };

    const result = resolveAction({
      agent: mockAgent,
      actionCode,
      allAgents: [mockAgent],
      skills: body.skills,
      inventory: body.inventory,
      isSabotaged: body.isSabotaged ?? false,
      isSuppressed: body.isSuppressed ?? false,
    });

    // Compute final stats and check happiness physiological clamping
    const finalHealth = Math.max(0, Math.min(100, stats.health + result.healthDelta));
    const finalCortisol = Math.max(0, Math.min(100, stats.cortisol + result.cortisolDelta));
    const finalHappiness = Math.max(0, Math.min(100, stats.happiness + result.happinessDelta));
    const clampedHappiness = clampHappinessByPhysiology(finalHappiness, finalHealth, finalCortisol);

    res.json({
      ...result,
      finalHappiness,
      happinessClamped: clampedHappiness < finalHappiness,
      clampedHappiness,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
