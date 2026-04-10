import type { Agent } from '@policylab/shared';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../../mechanics/automatedMarketMaker.js';

export function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
  depositBalances: number = 0,
  collateralEscrow: number = 0,
): number {
  const agentFiat = agents
    .filter(agent => agent.isAlive)
    .reduce((sum, agent) => sum + (wealthOverrides?.get(agent.id) ?? agent.currentStats.wealth), 0);
  const multiAMMFiat = multiAMMs
    ? [...multiAMMs.values()].reduce((sum, pool) => sum + pool.currentFiatReserve, 0)
    : 0;
  return agentFiat
    + (primaryAMM?.currentFiatReserve ?? 0)
    + multiAMMFiat
    + treasury
    + depositBalances
    + collateralEscrow;
}
