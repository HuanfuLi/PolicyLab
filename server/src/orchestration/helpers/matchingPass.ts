/**
 * Phase 12 D-13: APPLY_FOR_JOB Automated Matching Pass
 *
 * Greedy best-offer matching algorithm: pairs job applicants with enterprises
 * that have open vacancies and posted wages >= applicant's reservation wage.
 *
 * Placement order: highest posted wage first; tie-break by smallest current workforce.
 *
 * SFC invariant: this function mutates ONLY employmentRegistry, enterprise.employees,
 * enterprise.applicants, enterprise.lastApplicants, enterprise.lastVacancies, and
 * weekStateMap.employer_id via the weekStateEmployerIdSetter callback.
 * It does NOT touch any fiat accumulator (no wealthDelta, no treasury, no AMM reserve).
 *
 * See .planning/phases/12-labor-market-realism-.../12-CONTEXT.md D-12, D-13, D-14
 * See .planning/phases/12-labor-market-realism-.../12-RESEARCH.md §4
 */

import type { EnterpriseRecord, EmploymentRecord } from '../simulationState.js';

export interface MatchingPassInput {
  enterpriseRegistry: Map<string, EnterpriseRecord>;
  employmentRegistry: Map<string, EmploymentRecord>;
  /** Applicant IDs to process this pass (APPLY_FOR_JOB this iteration + QUIT last iteration). */
  applicantIds: Set<string>;
  /** Per-agent reservation wages from last iteration's PRODUCE_AND_SELL. */
  reservationWages: Map<string, number>;
  /** Minimum wage floor from EconomyConfig — used as fallback reservation wage. */
  minimumWage: number;
  /** Current iteration number — written as startedAt on new EmploymentRecord. */
  iterationNumber: number;
  /** Setter to update weekStateMap.employer_id for newly placed agents. */
  weekStateEmployerIdSetter: (agentId: string, entId: string) => void;
}

export interface MatchingPassResult {
  placements: Array<{ agentId: string; enterpriseId: string; wage: number }>;
  /** Applicant count per enterprise measured BEFORE the pass cleared enterprise.applicants. */
  applicantCountsByEnt: Map<string, number>;
  placementsThisIter: number;
}

/**
 * Run the greedy APPLY_FOR_JOB matching pass.
 *
 * Algorithm (D-13 verbatim):
 *  1. Skip already-employed applicants.
 *  2. reservationWage = sessionReservationWages[agentId] ?? max(minimumWage × 0.5, 1).
 *  3. Filter enterprises: (capacity − employees.size) > 0 AND wage >= reservationWage.
 *  4. Sort: descending wage, then ascending employees.size (tie-break: smallest workforce).
 *  5. Pick best; set employmentRegistry, add to enterprise.employees, call setter for weekStateMap.
 *
 * After loop: persist lastApplicants / lastVacancies on each enterprise (D-03),
 * then clear enterprise.applicants (consumed).
 */
export function runApplyForJobMatching(input: MatchingPassInput): MatchingPassResult {
  const {
    enterpriseRegistry,
    employmentRegistry,
    applicantIds,
    reservationWages,
    minimumWage,
    iterationNumber,
    weekStateEmployerIdSetter,
  } = input;

  // D-12: reservation wage floor = max(minimumWage × 0.5, 1) — small_constant = 1
  const reservationFloor = Math.max(minimumWage * 0.5, 1);

  // Snapshot applicant counts per enterprise BEFORE clearing applicants.
  // This gives processWageAdjustment (D-03) the demand signal it needs next iteration.
  const applicantCountsByEnt = new Map<string, number>();
  for (const ent of enterpriseRegistry.values()) {
    applicantCountsByEnt.set(ent.id, ent.applicants.size);
  }

  const placements: Array<{ agentId: string; enterpriseId: string; wage: number }> = [];

  // Greedy best-offer loop: for each applicant, find the highest-wage qualifying enterprise.
  for (const agentId of applicantIds) {
    // Skip agents who are already employed (e.g., QUIT_JOB pool member who re-found work mid-pass)
    if (employmentRegistry.has(agentId)) continue;

    const reservationWage = reservationWages.get(agentId) ?? reservationFloor;

    // Filter to enterprises with vacancies AND a posted wage >= reservation wage
    const qualifying = [...enterpriseRegistry.values()]
      .filter(ent => {
        const vacancies = (ent.capacity ?? 0) - ent.employees.size;
        return vacancies > 0 && ent.wage >= reservationWage;
      })
      .sort((a, b) => {
        // Primary: highest posted wage
        if (b.wage !== a.wage) return b.wage - a.wage;
        // Tie-break: smallest current workforce (load-balance)
        return a.employees.size - b.employees.size;
      });

    if (qualifying.length === 0) continue; // unmatched — remains unemployed

    const best = qualifying[0]!;

    employmentRegistry.set(agentId, {
      enterpriseId: best.id,
      employerId: best.ownerId,
      employeeId: agentId,
      wage: best.wage,
      minSkill: best.minSkill,
      startedAt: iterationNumber,
    });
    best.employees.add(agentId);
    weekStateEmployerIdSetter(agentId, best.id);

    placements.push({ agentId, enterpriseId: best.id, wage: best.wage });
  }

  // Persist lastApplicants / lastVacancies for next-iteration wage nudge (D-03)
  for (const ent of enterpriseRegistry.values()) {
    ent.lastApplicants = applicantCountsByEnt.get(ent.id) ?? 0;
    ent.lastVacancies = Math.max(0, (ent.capacity ?? 0) - ent.employees.size);
    ent.applicants.clear(); // consumed by this pass
  }

  return {
    placements,
    applicantCountsByEnt,
    placementsThisIter: placements.length,
  };
}
