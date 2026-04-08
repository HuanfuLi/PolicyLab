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
    type ApiKeyProvider = 'claude' | 'openai' | 'gemini' | 'vertex';
    const hasApiKeyMap = (p: string): p is ApiKeyProvider => !['local', 'custom'].includes(p);
    if (!merged.apiKeys) merged.apiKeys = {};
    if (merged.apiKey && hasApiKeyMap(merged.provider) && !merged.apiKeys[merged.provider]) {
      merged.apiKeys[merged.provider] = merged.apiKey;
    }

    // Ensure apiKey reflects the active provider's key from apiKeys
    if (hasApiKeyMap(merged.provider)) {
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

  // If a new apiKey was explicitly provided, store it for the target provider.
  // 'custom' and 'local' providers store the key directly in apiKey (not the per-provider map).
  type ApiKeyProvider = 'claude' | 'openai' | 'gemini' | 'vertex';
  const hasApiKeyMap = (p: string): p is ApiKeyProvider => !['local', 'custom'].includes(p);
  if (updates.apiKey && updates.apiKey.trim()) {
    if (hasApiKeyMap(next.provider)) {
      next.apiKeys![next.provider] = updates.apiKey;
    }
  }

  // Resolve apiKey from per-provider storage for known cloud providers.
  // 'custom' keeps its own apiKey directly (not in the map).
  if (hasApiKeyMap(next.provider)) {
    next.apiKey = next.apiKeys![next.provider] ?? '';
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
