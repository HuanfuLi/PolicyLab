import { describe, it } from 'vitest';

// Phase 11 D-13 — Central Agent selects tax shape (flat | progressive) at
// bootstrap / society generation. Persisted into EconomyConfig.taxPolicy.
// Fixed menu — flat or progressive only. Runtime amendment deferred.
describe('central agent tax policy selection (Phase 11 D-13)', () => {
  it.todo('Central Agent output parsed into EconomyConfig.taxPolicy');
  it.todo('flat taxPolicy has no brackets field');
  it.todo('progressive taxPolicy has strictly increasing brackets');
  it.todo('invalid taxPolicy from LLM falls back to flat 15% defaults');
  it.todo('tax kind restricted to flat|progressive (no wealth/land tax this phase)');
});
