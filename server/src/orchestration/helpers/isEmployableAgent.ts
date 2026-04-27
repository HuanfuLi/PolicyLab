/**
 * Phase 12 D-07: predicate for "employable citizen agents" used by
 *  - enterprise bootstrap (denominator for 110% vacancy target)
 *  - APPLY_FOR_JOB matching pass (applicant eligibility)
 *  - unemployment rate telemetry (denominator)
 *
 * Excludes institutional agents (bank, central_bank) and governance/ownership roles
 * (central_agent, official) who own enterprises or govern rather than work for wages.
 *
 * Per CLAUDE.md "Bank agents" rule: bank agents (type='bank') are always excluded.
 */
const NON_EMPLOYEE_ROLES = new Set(['central_bank', 'central_agent', 'official']);

export function isEmployableAgent(agent: { type?: string; role?: string }): boolean {
  const t = (agent.type ?? '').toLowerCase();
  if (t === 'bank') return false;
  const r = (agent.role ?? '').toLowerCase();
  if (NON_EMPLOYEE_ROLES.has(r)) return false;
  return true;
}
