import { describe, it } from 'vitest';

// Phase 11 D-18, D-19 — law_amendment ballot applies paragraph-level diff
// using exact-match replacement (same pattern as centralAgent.ts refine-law).
// Silently rejected when oldParagraph not found verbatim.
describe('law amendment ballot (Phase 11 D-18, D-19)', () => {
  it.todo('law_amendment ballot applies paragraph diff when oldParagraph matches verbatim');
  it.todo('amendment silently rejected when oldParagraph not found in session.law');
  it.todo('lawAmendmentHistory persists to session.config');
  it.todo('amendment scope is paragraph-level text only — no JSON schema');
  it.todo('multiple amendments in one governance cycle apply sequentially');
});
