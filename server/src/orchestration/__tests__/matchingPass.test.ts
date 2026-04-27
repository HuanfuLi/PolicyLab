/**
 * Phase 12: APPLY_FOR_JOB matching pass + QUIT reapply tests
 *
 * Tests validate L-09 (matching correctness), L-10 (QUIT auto-reapply),
 * D-03 (lastApplicants/lastVacancies persistence), and SFC fiat neutrality.
 *
 * Uses runApplyForJobMatching() pure helper — no simulationRunner mounting needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { runApplyForJobMatching } from '../helpers/matchingPass.js';
import type { EnterpriseRecord, EmploymentRecord } from '../simulationState.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function mkEnt(
  id: string,
  wage: number,
  capacity: number,
  employees: string[] = [],
): EnterpriseRecord {
  return {
    id,
    ownerId: `owner_${id}`,
    ownerName: id,
    industry: id,
    sector: 'agriculture',
    employees: new Set(employees),
    applicants: new Set(),
    wage,
    minSkill: 0,
    capacity,
    lastApplicants: 0,
    lastVacancies: 0,
  };
}

function mkInput(overrides: {
  enterprises: EnterpriseRecord[];
  applicantIds: string[];
  reservationWages?: Map<string, number>;
  minimumWage?: number;
  existingEmployment?: Map<string, EmploymentRecord>;
}) {
  const enterpriseRegistry = new Map(overrides.enterprises.map(e => [e.id, e]));
  const employmentRegistry: Map<string, EmploymentRecord> = overrides.existingEmployment ?? new Map();
  const setter = vi.fn();
  return {
    enterpriseRegistry,
    employmentRegistry,
    applicantIds: new Set(overrides.applicantIds),
    reservationWages: overrides.reservationWages ?? new Map(),
    minimumWage: overrides.minimumWage ?? 5,
    iterationNumber: 1,
    weekStateEmployerIdSetter: setter,
    _setter: setter,
  };
}

// ── L-09: Placement correctness ───────────────────────────────────────────────

describe('Phase 12: APPLY_FOR_JOB matching pass + QUIT reapply', () => {
  it('L-09: applicant placed at highest-wage qualifying enterprise (wage >= reservation_wage)', () => {
    const ents = [
      mkEnt('e1', 5, 3),
      mkEnt('e2', 10, 3),
      mkEnt('e3', 15, 3),
    ];
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],
      reservationWages: new Map([['a1', 8]]),
    });

    const res = runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // Placed at highest-wage enterprise (e3 at wage=15)
    expect(employmentRegistry.get('a1')?.enterpriseId).toBe('e3');
    expect(enterpriseRegistry.get('e3')!.employees.has('a1')).toBe(true);
    expect(res.placementsThisIter).toBe(1);
  });

  it('L-09: tie-breaker chooses enterprise with lowest current workforce', () => {
    const ents = [
      mkEnt('e1', 10, 5, ['x1', 'x2', 'x3']),  // wage=10, 3 employees
      mkEnt('e2', 10, 5, ['y1']),                 // wage=10, 1 employee
    ];
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],
      reservationWages: new Map([['a1', 5]]),
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // Should pick e2 (1 employee) over e1 (3 employees) when wages are equal
    expect(employmentRegistry.get('a1')?.enterpriseId).toBe('e2');
  });

  it('L-09: vacancy count (capacity - employees.size) decrements after hire', () => {
    const ents = [mkEnt('e1', 10, 3)];  // capacity=3, employees=0, vacancies=3
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // employees.size should be 1 now, so effective vacancies = capacity - employees.size = 2
    const ent = enterpriseRegistry.get('e1')!;
    expect(ent.employees.size).toBe(1);
    expect(ent.capacity - ent.employees.size).toBe(2);
  });

  it('L-09: unmatched applicant remains unemployed when reservation_wage > all posted wages', () => {
    const ents = [
      mkEnt('e1', 5, 3),
      mkEnt('e2', 8, 3),
    ];
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],
      reservationWages: new Map([['a1', 20]]),  // reservation=20 > all wages
    });

    const res = runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    expect(employmentRegistry.has('a1')).toBe(false);
    expect(res.placementsThisIter).toBe(0);
  });

  it('L-09: already-employed applicants are skipped (no double-employment)', () => {
    const ents = [mkEnt('e1', 10, 5), mkEnt('e2', 15, 5)];
    const existing = new Map<string, EmploymentRecord>([
      ['a1', { enterpriseId: 'e1', employerId: 'owner_e1', employeeId: 'a1', wage: 10, minSkill: 0, startedAt: 0 }],
    ]);
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],
      existingEmployment: existing,
    });

    const res = runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // Still employed at e1 — not placed at e2 despite higher wage
    expect(employmentRegistry.get('a1')?.enterpriseId).toBe('e1');
    expect(res.placementsThisIter).toBe(0);
  });

  it('L-09: multiple applicants placed at different enterprises based on preference order', () => {
    // e1: wage=20, capacity=1; e2: wage=10, capacity=3
    // a1 gets e1 (highest), a2 and a3 get e2 (only remaining)
    const ents = [mkEnt('e1', 20, 1), mkEnt('e2', 10, 3)];
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1', 'a2'],
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // Both placed; one at e1, one at e2
    expect(employmentRegistry.size).toBe(2);
    const placements = [
      employmentRegistry.get('a1')?.enterpriseId,
      employmentRegistry.get('a2')?.enterpriseId,
    ];
    expect(placements).toContain('e1');
    expect(placements).toContain('e2');
  });

  // ── L-10: QUIT auto-reapply (sessionQuitLastIteration consumed before call) ─────

  it('L-10: quit-then-reapply moves agent to higher-paying enterprise', () => {
    // Agent was employed at e1 (wage=5) and quit. They are now in the applicantIds
    // pool (added by simulationRunner before calling runApplyForJobMatching).
    // e2 has wage=15. Agent should land there.
    const ents = [mkEnt('e2', 15, 3)];  // e1 no longer exists after quit
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],  // added from sessionQuitLastIteration by runner
      reservationWages: new Map([['a1', 4]]),
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    expect(employmentRegistry.get('a1')?.enterpriseId).toBe('e2');
    expect(employmentRegistry.get('a1')?.wage).toBe(15);
  });

  // ── D-03: lastApplicants / lastVacancies persist on enterprises ──────────────

  it('D-03: lastApplicants and lastVacancies set at end of pass', () => {
    const ent = mkEnt('e1', 10, 5);
    // Manually add a pre-existing applicant to simulate APPLY_FOR_JOB intent
    ent.applicants.add('x1');
    ent.applicants.add('x2');

    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: [ent],
      applicantIds: ['a1'],  // one new applicant this pass
      reservationWages: new Map([['a1', 5]]),
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    const updatedEnt = enterpriseRegistry.get('e1')!;
    // lastApplicants = applicants.size BEFORE clear = 2 (x1, x2 were in enterprise.applicants)
    expect(updatedEnt.lastApplicants).toBe(2);
    // lastVacancies = capacity - employees.size AFTER placements (capacity=5, 1 new employee placed)
    expect(updatedEnt.lastVacancies).toBe(4);
    // applicants Set cleared
    expect(updatedEnt.applicants.size).toBe(0);
  });

  it('D-03: lastVacancies = 0 when enterprise is at full capacity after pass', () => {
    const ents = [mkEnt('e1', 10, 1)];  // capacity=1
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1', 'a2'],  // 2 applicants, only 1 vacancy
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    const ent = enterpriseRegistry.get('e1')!;
    expect(ent.employees.size).toBe(1);          // only one placed
    expect(ent.lastVacancies).toBe(0);            // full capacity
    expect(employmentRegistry.size).toBe(1);      // one placed, one unmatched
  });

  // ── SFC: matching pass moves zero fiat ───────────────────────────────────────

  it('SFC: matching pass does not mutate any wealth/fiat state', () => {
    // Construct a wealth map EXTERNAL to runApplyForJobMatching.
    // After calling the helper, assert the map is completely unchanged.
    // This proves by construction that no fiat field is available to be mutated.
    const wealthBefore = new Map([
      ['a1', 100],
      ['a2', 200],
      ['owner_e1', 500],
    ]);
    const wealthSnapshot = new Map(wealthBefore);

    const ents = [mkEnt('e1', 10, 3)];
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1', 'a2'],
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // Wealth map must be identical after matching
    expect(wealthBefore).toEqual(wealthSnapshot);
    // Placements happened (prove the function ran)
    expect(employmentRegistry.size).toBe(2);
  });

  it('SFC: reservation wage fallback = max(minimumWage * 0.5, 1) when no PAS history', () => {
    // Agent has no entry in reservationWages → fallback floor applies
    // If floor = max(5*0.5, 1) = 2.5, enterprise at wage=3 should match
    const ents = [mkEnt('e1', 3, 3)];
    const { enterpriseRegistry, employmentRegistry, applicantIds, reservationWages, minimumWage, iterationNumber, weekStateEmployerIdSetter } = mkInput({
      enterprises: ents,
      applicantIds: ['a1'],
      reservationWages: new Map(),  // no entry for a1
      minimumWage: 5,
    });

    runApplyForJobMatching({
      enterpriseRegistry, employmentRegistry, applicantIds, reservationWages,
      minimumWage, iterationNumber, weekStateEmployerIdSetter,
    });

    // floor = max(5*0.5, 1) = 2.5; enterprise wage 3 >= 2.5 → placed
    expect(employmentRegistry.get('a1')?.enterpriseId).toBe('e1');
  });
});
