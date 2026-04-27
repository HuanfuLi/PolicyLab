import { describe, it } from 'vitest';

describe('Phase 12: APPLY_FOR_JOB matching pass + QUIT reapply', () => {
  it.todo('L-09: applicant placed at highest-wage qualifying enterprise (wage ≥ reservation_wage)');
  it.todo('L-09: tie-breaker chooses enterprise with lowest current workforce');
  it.todo('L-09: vacancy count (capacity − employees.size) decrements when hire succeeds');
  it.todo('L-09: unmatched applicants remain unemployed (no placement)');
  it.todo('L-10: QUIT_JOB marks agent for sessionQuitLastIteration; auto-reapplies next iteration');
  it.todo('L-10: quit-and-reapply can move employed agent to higher-paying enterprise');
  it.todo('D-16: insolvent enterprise bankruptcy releases employees and increments displacedThisIteration');
  it.todo('D-03: lastApplicants and lastVacancies persisted on enterprise for next iteration wage nudge');
  it.todo('SFC: matching pass mutates employmentRegistry only — no fiat movement');
});
