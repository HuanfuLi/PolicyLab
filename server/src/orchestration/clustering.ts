/**
 * Role-based clustering for HMAS map-reduce simulation.
 * Groups agents by role for more coherent sub-group resolution.
 */
import type { Agent } from '@policylab/shared';

/**
 * Cluster agents by role, with a maximum cluster size.
 * Same-role agents stay together; remaining agents fill mixed clusters.
 */
export function clusterByRole(agents: Agent[], maxPerCluster: number): Agent[][] {
  // Group agents by role
  const byRole = new Map<string, Agent[]>();
  for (const agent of agents) {
    const role = agent.role.toLowerCase();
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(agent);
  }

  // Sort groups by size (largest first)
  const groups = Array.from(byRole.values()).sort((a, b) => b.length - a.length);

  const clusters: Agent[][] = [];
  const overflow: Agent[] = [];

  for (const group of groups) {
    if (group.length <= maxPerCluster) {
      // Small enough to be its own cluster
      clusters.push([...group]);
    } else {
      // Split large role groups into chunks
      for (let i = 0; i < group.length; i += maxPerCluster) {
        const chunk = group.slice(i, i + maxPerCluster);
        if (chunk.length >= Math.ceil(maxPerCluster / 2)) {
          clusters.push(chunk);
        } else {
          // Too small for its own cluster — add to overflow
          overflow.push(...chunk);
        }
      }
    }
  }

  // Fill overflow into existing clusters or create mixed clusters
  if (overflow.length > 0) {
    // Try to fill existing small clusters first
    for (const agent of overflow) {
      const smallest = clusters
        .filter(c => c.length < maxPerCluster)
        .sort((a, b) => a.length - b.length)[0];

      if (smallest) {
        smallest.push(agent);
      } else {
        // All clusters are full — start a new mixed cluster
        clusters.push([agent]);
      }
    }
  }

  return clusters;
}
