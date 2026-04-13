import type { Agent } from '@policylab/shared';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../../mechanics/automatedMarketMaker.js';

/**
 * Sum every fiat-holding location in the closed SFC perimeter.
 *
 * Bank agents are excluded from the agent fiat sum (their reserves are modeled via
 * depositBalances to prevent SFC double-counting per CLAUDE.md).
 *
 * @param publicGoodsEscrow Per-session escrow sum (infrastructure + education + defense).
 *   Counted in the total so M0 stays constant when fiscal routes non-welfare spending
 *   into escrow rather than citizen wealth. Default 0 keeps legacy callers unaffected.
 *   @see Phase 11 D-11
 */
export function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
  depositBalances: number = 0,
  collateralEscrow: number = 0,
  publicGoodsEscrow: number = 0,
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
    + collateralEscrow
    + publicGoodsEscrow;
}
