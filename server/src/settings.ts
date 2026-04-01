import path from 'path';
import os from 'os';
import fs from 'fs';
import type { AppSettings } from '@policylab/shared';

const CONFIG_DIR = path.join(os.homedir(), '.policylab');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'claude',
  apiKey: '',
  apiKeys: {},
  baseUrl: 'http://localhost:1234/v1',
  centralAgentModel: 'claude-sonnet-4-6',
  citizenAgentModel: 'claude-haiku-4-5-20251001',
  maxConcurrency: 3,
  citizenProvider: undefined,
  citizenApiKey: '',
  citizenBaseUrl: '',
  citizenVertexProjectId: '',
  citizenVertexLocation: '',
  maxMessageLength: 64000,
  vertexProjectId: '',
  vertexLocation: '',
};

export function readSettings(): AppSettings {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const stored = JSON.parse(raw) as Partial<AppSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...stored };

    // Migration: if apiKeys doesn't exist but apiKey does, seed apiKeys from apiKey
    if (!merged.apiKeys) merged.apiKeys = {};
    if (merged.apiKey && merged.provider !== 'local' && !merged.apiKeys[merged.provider]) {
      merged.apiKeys[merged.provider] = merged.apiKey;
    }

    // Ensure apiKey reflects the active provider's key from apiKeys
    if (merged.provider !== 'local') {
      merged.apiKey = merged.apiKeys[merged.provider] ?? '';
    }

    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(updates: Partial<AppSettings>): AppSettings {
  const current = readSettings();

  // Merge apiKeys maps (don't let spread overwrite the whole map)
  const mergedApiKeys = { ...current.apiKeys, ...updates.apiKeys };

  const next: AppSettings = { ...current, ...updates, apiKeys: mergedApiKeys };

  // If a new apiKey was explicitly provided, store it for the target provider
  if (updates.apiKey && updates.apiKey.trim()) {
    const targetProvider = next.provider;
    if (targetProvider !== 'local') {
      next.apiKeys![targetProvider] = updates.apiKey;
    }
  }

  // Always resolve apiKey from apiKeys for the active provider
  if (next.provider !== 'local') {
    next.apiKey = next.apiKeys![next.provider] ?? '';
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
