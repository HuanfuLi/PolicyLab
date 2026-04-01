import type { EconomyConfig } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

export function getEconomyConfig(
  sessionConfig: Record<string, unknown> | null | undefined,
): EconomyConfig {
  if (!sessionConfig?.economyConfig) {
    return { ...DEFAULT_ECONOMY_CONFIG, bankingEnabled: false };
  }
  return {
    ...DEFAULT_ECONOMY_CONFIG,
    ...(sessionConfig.economyConfig as Partial<EconomyConfig>),
  };
}
