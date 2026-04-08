import type { LLMProvider } from './types.js';
import type { AppSettings, ProviderConfig } from '@policylab/shared';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider, OpenAICompatibleProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { VertexProvider } from './vertex.js';
import { LoadBalancer, type LoadBalancerSlotConfig } from './loadBalancer.js';
import { readSettings } from '../settings.js';

let provider: LLMProvider | null = null;
let citizenProviderCache: LLMProvider | null = null;
let loadBalancerInstance: LoadBalancer | null = null;

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

/** Create an LLMProvider from a ProviderConfig slot. */
function createProviderFromSlot(slot: ProviderConfig): LLMProvider {
  return createProviderFromSettings({
    provider: slot.provider,
    apiKey: slot.apiKey ?? '',
    baseUrl: slot.baseUrl ?? 'http://localhost:1234/v1',
    centralAgentModel: slot.model,
    citizenAgentModel: slot.model,
    maxConcurrency: 10,
    maxMessageLength: 64000,
    vertexProjectId: slot.vertexProjectId,
    vertexLocation: slot.vertexLocation,
  });
}

/** Get or create a load balancer that distributes citizen agent LLM calls across
 *  configured providers. Falls back to a single-provider balancer using getCitizenProvider()
 *  when no multi-provider array is configured. */
export function getLoadBalancer(): LLMProvider {
  if (loadBalancerInstance) return loadBalancerInstance;

  const settings = readSettings();
  const extraProviders = settings.providers ?? [];

  // Primary citizen provider is always the first slot
  const slots: LoadBalancerSlotConfig[] = [{
    provider: getCitizenProvider(),
    label: `${settings.citizenProvider ?? settings.provider}/${settings.citizenAgentModel}`,
    rateLimit: null,
  }];

  // Add extra provider slots from config
  for (const cfg of extraProviders) {
    slots.push({
      provider: createProviderFromSlot(cfg),
      label: `${cfg.provider}/${cfg.model}`,
      rateLimit: cfg.rateLimit,
    });
  }

  loadBalancerInstance = new LoadBalancer(slots);
  return loadBalancerInstance;
}

export function invalidateProvider(): void {
  provider = null;
  citizenProviderCache = null;
  loadBalancerInstance = null;
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

    case 'custom':
      // Custom OpenAI-compatible endpoint with user-provided API key.
      return new OpenAICompatibleProvider(
        settings.baseUrl || 'http://localhost:1234/v1',
        settings.apiKey,
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
