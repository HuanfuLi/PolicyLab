import type { LLMProvider } from './types.js';
import type { AppSettings } from '@policylab/shared';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider, OpenAICompatibleProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { VertexProvider } from './vertex.js';
import { readSettings } from '../settings.js';

let provider: LLMProvider | null = null;
let citizenProviderCache: LLMProvider | null = null;

export function getProvider(): LLMProvider {
  if (!provider) {
    provider = createProviderFromSettings(readSettings());
  }
  return provider;
}

/** Returns a separate provider for citizen agent tasks if configured, otherwise falls back to main provider. */
export function getCitizenProvider(): LLMProvider {
  const settings = readSettings();
  if (!settings.citizenProvider) {
    return getProvider();
  }
  if (!citizenProviderCache) {
    citizenProviderCache = createProviderFromSettings({
      ...settings,
      provider: settings.citizenProvider,
      apiKey: settings.citizenApiKey ?? '',
      baseUrl: settings.citizenBaseUrl ?? 'http://localhost:1234/v1',
      vertexProjectId: settings.citizenVertexProjectId ?? '',
      vertexLocation: settings.citizenVertexLocation ?? '',
    });
  }
  return citizenProviderCache;
}

export function invalidateProvider(): void {
  provider = null;
  citizenProviderCache = null;
}

/** Create a provider from explicit settings without touching the module-level cache. */
export function createProviderFromSettings(settings: AppSettings): LLMProvider {
  switch (settings.provider) {
    case 'claude':
      return new AnthropicProvider(settings.apiKey, settings.centralAgentModel);

    case 'openai':
      return new OpenAIProvider(
        settings.apiKey,
        settings.centralAgentModel
      );

    case 'gemini':
      return new GeminiProvider(
        settings.apiKey,
        settings.centralAgentModel
      );

    case 'vertex':
      return new VertexProvider(
        settings.vertexProjectId ?? '',
        settings.vertexLocation ?? '',
        settings.centralAgentModel
      );

    case 'local':
    default:
      // LM Studio / Ollama — API key is not required; use a placeholder so
      // the OpenAI SDK does not fall back to OPENAI_API_KEY env var and throw.
      return new OpenAICompatibleProvider(
        settings.baseUrl || 'http://localhost:1234/v1',
        settings.apiKey || 'lm-studio',
        settings.centralAgentModel
      );
  }
}
