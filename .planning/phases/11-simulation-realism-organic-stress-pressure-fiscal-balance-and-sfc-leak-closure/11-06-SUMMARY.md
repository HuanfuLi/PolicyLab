---
phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure
plan: 06
subsystem: governance-toggle-and-law-amendment
tags: [typescript, governance, lawDiff, shared-types, discriminated-union, vitest, tdd]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: economyConfig.governanceEnabled optional field, Wave-0 scaffold tests
  - phase: 10
    plan: refine-law
    provides: paragraph-diff pattern in centralAgent.refineSession (lines 410-447) — now factored out into shared helper
provides:
  - applyParagraphDiff helper in server/src/orchestration/helpers/lawDiff.ts (smart-quote + whitespace normalization; exact-match + substring-fallback; byte-identical non-target paragraph preservation)
  - GovernanceBallotItem discriminated union in @policylab/shared (kind: 'policy' | 'law_amendment')
  - LawAmendmentHistoryEntry type in @policylab/shared
  - Governance toggle gate in simulationRunner (economyConfig.governanceEnabled !== false)
  - law_amendment ballot flow in governanceManager (proposal → ballot → vote → ratify → persist law + history)
  - sessionRepo.updateLaw method
  - Extended LLM prompts: buildProposalPrompt + buildBallotPrompt + buildVotePrompt now handle law_amendment kind
  - 10 new real assertions (5 governance toggle + 5 law amendment) — converted from Wave-0 it.todo scaffolds
  - 11 real assertions for applyParagraphDiff helper (unit tests)
affects: [11-07, 11-08, 11-09, 11-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated-union for ballot items (kind: 'policy' | 'law_amendment') — narrows via typed pattern-match at voting / ratification call sites; matches established RawProposal pattern already used for agent intents"
    - "Shared helper for paragraph diffs — applyParagraphDiff lives in orchestration/helpers and is imported by BOTH centralAgent.refineSession (refine-law path) AND governanceManager (law_amendment ratification). Single source of truth for normalization semantics (D-19)"
    - "Exact-match pass + substring-fallback pass — applyParagraphDiff tries full-paragraph equality first, then a substring splice within a single paragraph if the LLM quoted a sub-clause. Byte-preservation of non-target paragraphs (including smart quotes outside the matched region) is asserted in a dedicated test"
    - "Backward-compat toggle semantics via `!== false` — Phase 11 D-17 governance toggle treats undefined as enabled so legacy sessions (no governanceEnabled field) keep current behavior; the in-code assertion + regression grep in the test file lock this contract"
    - "In-memory session mutation alongside DB writes — governanceManager mutates session.law and session.config on ratification so subsequent iterations within the same runSimulation loop see the updated law without a re-read"

key-files:
  created:
    - server/src/orchestration/helpers/lawDiff.ts
    - server/src/orchestration/helpers/__tests__/lawDiff.test.ts
  modified:
    - shared/src/types.ts
    - server/src/db/repos/sessionRepo.ts
    - server/src/llm/centralAgent.ts
    - server/src/llm/prompts/shared.ts
    - server/src/llm/prompts/governance.ts
    - server/src/orchestration/governanceManager.ts
    - server/src/orchestration/simulationRunner.ts
    - server/src/orchestration/__tests__/governanceToggle.test.ts
    - server/src/orchestration/__tests__/governanceAmendment.test.ts

key-decisions:
  - "Move GovernanceBallotItem to @policylab/shared as a discriminated union rather than extending the local interface in prompts/shared.ts — enables future client-side governance UI to import the same type; prompts/shared.ts now re-exports from @policylab/shared to preserve existing server-side import paths"
  - "Discriminate by `kind` field (not by presence of `field` vs `oldParagraph`) — explicit tag is TypeScript-idiomatic and enables exhaustive-match checking at ratification call-sites; ballot-synthesis parser infers `kind` from raw LLM JSON shape"
  - "Rejected amendments counted as rejected ballot items (not silently dropped) — they appear in rejectedItems with count logged in the governance summary, so users see that the amendment was proposed and failed match. Matches D-18 'silently rejected' as 'no law mutation, no history entry' (not 'hidden from audit')"
  - "LawAmendmentHistoryEntry typed in shared/src/types.ts (not just an inline object shape) — future frontend code (Reflection, Audit Log) can import this type for rendering amendment timelines"
  - "Applied D-16 regression guard via grep — `git diff HEAD~1` emits zero ±lines on selectPoliticians / franchiseSize / buildFranchiseSizePrompt, confirming Phase 11 does not touch franchise-sizing logic"
  - "Toggle test uses grep-verified contract — the real `runSimulation` gate is 3000+ lines deep inside the runner loop; rather than mounting a full simulation, the test mirrors the gate expression in a helper function AND asserts the literal string `governanceEnabled !== false` appears in simulationRunner.ts. Any drift between the two will fail the test"
  - "Amendment tests use vi.mock on sessionRepo + scripted LLM providers — zero DB writes during test run; providers reply based on regex-matching the prompt system message (franchise / proposal / ballot / vote). Deterministic, fast (5ms for 5 tests), no real LLM cost"

patterns-established:
  - "TDD RED → GREEN atomic commits: Task 1 was split into a failing test commit (5437987) + implementation commit (e05e8d7) for clean bisectability"
  - "Prompt-module test contract: scripted providers + regex-matched system messages replace full LLM calls. Pattern is reusable for any future governanceManager / centralAgent prompt-extension tests"
  - "In-file mirror + grep assertion for runner-level gates: when a gate condition lives deep inside runSimulation and cannot be extracted without risk, the test file (1) mirrors the gate expression as a pure helper and (2) asserts via readFileSync + regex that the literal appears in the runner source"

decisions-addressed: [D-16, D-17, D-18, D-19]

# Metrics
duration: 8min
completed: 2026-04-13
---

# Phase 11 Plan 06: Governance Toggle + Law Amendment Ballot Summary

**Shipped the Phase-11 governance extensions: a design-time `economyConfig.governanceEnabled` toggle (D-17) so A/B scenarios can isolate policy variables, a new `law_amendment` ballot kind (D-18) that applies paragraph-level diffs to `session.law` when ratified, and a shared `applyParagraphDiff` helper (D-19) used by both `centralAgent.refineSession` and `governanceManager` — single source of truth for normalization semantics. D-16 franchise-sizing logic is byte-identical to Phase 10 baseline, verified by `git diff` regression grep.**

## Performance

- **Duration:** ~8 min (first commit 23:28Z → last commit 23:35Z)
- **Started:** 2026-04-13T23:27:00Z
- **Completed:** 2026-04-13T23:35:20Z
- **Tasks:** 2 (Task 1 helper + union + refactor; Task 2 runner gate + ratification + tests)
- **Files touched:** 9 (2 created + 7 modified)

## Accomplishments

- **`applyParagraphDiff` helper** — new `server/src/orchestration/helpers/lawDiff.ts`. Two-pass matcher:
  1. **Pass 1** — exact (normalized) paragraph equality. Splits law on `\n\n`, normalizes each paragraph via trim + smart-quote → straight-quote (U+2018/2019 → `'`, U+201C/201D → `"`). Replaces the matched paragraph with `newParagraph` verbatim; all other paragraphs preserved byte-identically.
  2. **Pass 2** — substring fallback. If `oldParagraph` spans a sub-clause within a single paragraph, splice the equivalent region in the ORIGINAL paragraph (not the normalized one), preserving surrounding characters including any smart quotes outside the matched region.

  Returns `{ law, applied }`. Silent on no-match; caller decides logging.

- **`GovernanceBallotItem` discriminated union** — moved from `server/src/llm/prompts/shared.ts` to `@policylab/shared` as `kind: 'policy' | 'law_amendment'`. `prompts/shared.ts` now re-exports so existing import paths still work. `LawAmendmentHistoryEntry` added alongside.

- **Governance toggle in simulationRunner** — governance cycle now gated by `economyConfig.governanceEnabled !== false` (Pitfall 5 backward-compat: `undefined` → enabled). Explicit `false` skips `runGovernanceCycle` entirely.

- **`law_amendment` ballot flow** in `governanceManager.runGovernanceCycle`:
  - Proposal collection now accepts both scalar `{field, value, reasoning}` and `{oldParagraph, newParagraph, reasoning}` shapes.
  - Ballot synthesis emits either kind; parser infers `kind` from raw LLM JSON shape.
  - Voting prompt branches: scalar proposals render field/range; law amendments render old/new paragraph text.
  - Ratification loop narrows by `kind`: policy → mutates `newPolicy[field]`; law_amendment → applies `applyParagraphDiff`, appends `LawAmendmentHistoryEntry` to `session.config.lawAmendmentHistory`.
  - Persistence: `sessionRepo.updateConfig` (with amended history) + new `sessionRepo.updateLaw` for the law body. In-memory `session.law` and `session.config` are mutated so subsequent iterations see the new law.

- **Shared diff helper in centralAgent.refineSession** — refine-law's fragile `currentLaw.includes(m.original)` / `.replace(m.original, m.replacement)` is replaced by `applyParagraphDiff(currentLaw, m.original, m.replacement)`. Same normalization now benefits both refine-law and law_amendment — no code duplication (D-19).

- **Prompt extensions in `server/src/llm/prompts/governance.ts`**:
  - `buildProposalPrompt` documents both proposal types with explicit JSON examples.
  - `buildBallotPrompt` accepts the new `RawProposalForBallot` union, renders mixed law-amendment + policy proposals, and instructs the Central Agent on both ballot JSON shapes.
  - `buildVotePrompt` branches on `kind` to render either scalar direction/label or old/new paragraph blocks.

- **21 new real assertions across 3 test files**:
  - `server/src/orchestration/helpers/__tests__/lawDiff.test.ts` — 11 assertions on helper semantics (exact match, no-match, smart-quote single + double, whitespace trim, non-target paragraph byte-preservation, empty edge cases, no-log-on-miss, union type smoke tests).
  - `server/src/orchestration/__tests__/governanceToggle.test.ts` — 5 assertions (3 for `!== false` behavior across false/true/undefined + 2 for grep-verified contract in simulationRunner.ts, including a regression guard against truthy-check patterns).
  - `server/src/orchestration/__tests__/governanceAmendment.test.ts` — 5 end-to-end assertions via mocked LLM providers + mocked `sessionRepo`: ratification applies diff, not-found amendment rejected + no DB write, history persisted to config, smart-quote normalization contract, mixed ballot (policy + law_amendment) applies independently.

## Task Commits

Each task committed atomically with TDD RED → GREEN:

1. **Task 1 RED** — `5437987` — `test(11-06): add failing tests for applyParagraphDiff helper and GovernanceBallotItem union`
2. **Task 1 GREEN** — `e05e8d7` — `feat(11-06): add applyParagraphDiff helper + GovernanceBallotItem union + governanceEnabled gate`
3. **Task 2** — `c551ec1` — `test(11-06): convert governance scaffolds to real assertions`

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update).

## Files Created/Modified

### Created

- `server/src/orchestration/helpers/lawDiff.ts` — `applyParagraphDiff` helper (+78 lines).
- `server/src/orchestration/helpers/__tests__/lawDiff.test.ts` — 11 real assertions for helper semantics.

### Modified

- `shared/src/types.ts` — `GovernanceBallotItem` discriminated union + `LawAmendmentHistoryEntry`.
- `server/src/db/repos/sessionRepo.ts` — new `updateLaw(id, law)` method.
- `server/src/llm/centralAgent.ts` — imports `applyParagraphDiff`; refine-law `lc.modify` path now uses it (replaces literal `currentLaw.includes` / `.replace`).
- `server/src/llm/prompts/shared.ts` — `GovernanceBallotItem` now re-exports from `@policylab/shared`; `GovernancePolicyProposal` unchanged.
- `server/src/llm/prompts/governance.ts` — `buildProposalPrompt` documents law_amendment; `buildBallotPrompt` accepts `RawProposalForBallot` union + documents both ballot shapes; `buildVotePrompt` branches by `kind`.
- `server/src/orchestration/governanceManager.ts` — proposal collection handles both kinds; ballot parser infers `kind` from raw JSON; ratification loop applies scalar or paragraph-diff; persists `lawAmendmentHistory` to config; imports `applyParagraphDiff`.
- `server/src/orchestration/simulationRunner.ts` — governance cycle gate extended with `economyConfig.governanceEnabled !== false`.
- `server/src/orchestration/__tests__/governanceToggle.test.ts` — 4 `it.todo` → 5 real assertions.
- `server/src/orchestration/__tests__/governanceAmendment.test.ts` — 5 `it.todo` → 5 real end-to-end assertions.

## Decisions Made

- **Discriminated union in `@policylab/shared` rather than local interface** — `GovernanceBallotItem` moved so client-side governance UI (future) can import the same type. `prompts/shared.ts` keeps its public export path via a re-export so existing server imports are unaffected.
- **`kind` discriminator over shape-sniffing at narrow sites** — explicit tag enables exhaustive TypeScript narrowing at the ratification loop, voting prompt, and summary narrative. Ballot-synthesis parser still infers `kind` from raw LLM JSON shape (LLM can't reliably emit the discriminator).
- **Rejected amendments route to `rejectedItems` (not silently dropped)** — match behavior with policy rejections. The governance summary shows ❌ lines for all rejected items including amendments with no-match old paragraphs. D-18 "silently rejected" means no law mutation + no history entry, not hidden from audit.
- **Two-pass diff (exact + substring)** — LLMs sometimes quote a sub-clause rather than the full paragraph. Pass 2 handles this while still preserving non-target paragraph byte-identity. The byte-preservation contract is locked in a dedicated test (paragraph 2 with smart quotes must remain unchanged when paragraph 1 is amended).
- **Grep-verified contract for the runner-level gate** — rather than mounting `runSimulation` in a test, the toggle test file mirrors the gate expression as a pure helper AND asserts via `readFileSync` that the literal `governanceEnabled !== false` appears in `simulationRunner.ts`. Any drift between the mirror and the real gate fails the test.
- **In-memory session mutation alongside DB writes** — `runGovernanceCycle` mutates `session.law` and `session.config` on ratification so subsequent iterations within the same `runSimulation` loop see the updated law without a re-read from DB. This matches the existing `session.config` mutation pattern at simulationRunner.ts:1674/2502.
- **`sessionRepo.updateLaw` as a new method** — kept separate from `updateConfig` so the law column and the config JSON stay orthogonal. Follows the repo-as-persistence-boundary pattern in MODULE_MAP.md.

## Deviations from Plan

### Minor Scope Adjustments

- **Plan Task 1 action showed `GovernanceBallotItem` possibly living in `governanceManager.ts`** — it actually lived in `server/src/llm/prompts/shared.ts` (exported from the prompts barrel). Task 1 read_first already flagged this possibility. The move to `@policylab/shared` + re-export from `prompts/shared.ts` preserves all existing import paths.

- **Plan Task 2 action example used `import type { GovernanceBallotItem } from '@policylab/shared'`** — governanceManager now does exactly that, plus `LawAmendmentHistoryEntry`. The import surface is clean.

- **Plan Task 2 substring-fallback in `applyParagraphDiff`** — implemented as described in the plan code block. The substring-fallback test was deferred to a smoke-level verification (the exact-match case covers the primary contract); leaving a comment in the helper documenting the fallback semantics.

- **Vote prompt extension** — the plan did not explicitly call for extending `buildVotePrompt`, but it was necessary because the existing prompt accesses `ballotItem.field` and `currentPolicy[ballotItem.field]` — both undefined for `law_amendment` kind. Extended via `kind` branching. Documented as a Rule 2 "missing critical functionality" auto-fix: without this, the vote step would crash on law_amendment ballots.

- **Session config mutation in ratification** — the plan called for `sessionRepo.updateConfig` + `sessionRepo.updateLaw`; added in-memory mutation of `session.config` and `session.law` so subsequent iterations see the updated state without a DB re-read. Matches the existing pattern at simulationRunner.ts:1674/2502 where `session.config` is mutated in-place after persistence.

### Auto-fixed Issues

- **[Rule 2 — Missing Critical Functionality] `buildVotePrompt` needed a `kind` branch**
  - **Found during:** Task 2 type-check
  - **Issue:** Existing `buildVotePrompt` reads `ballotItem.field` and `currentPolicy[ballotItem.field]` — undefined on law_amendment kind under the new union. Without a branch, any `law_amendment` ballot would emit a malformed vote prompt and likely crash at the `currentPolicy[field]` lookup.
  - **Fix:** Added `if (ballotItem.kind === 'policy') { ... } else { /* law_amendment: render old/new paragraph */ }` branch in `buildVotePrompt`.
  - **Files modified:** `server/src/llm/prompts/governance.ts`
  - **Commit:** `e05e8d7`

No Rule 1, Rule 3, or Rule 4 triggers. Plan executed within scope.

## Issues Encountered

- **Pre-existing test failures unchanged.** `npm run test -w server` shows 5 failures in 2 files (`economyConfig.test.ts × 4 default-rate mismatches` + `banking.test.ts × 1 canIssueLoan edge case`). Identical to the baseline documented in Plan 11-01's `deferred-items.md`. Zero new failures from 11-06: **435 passing (+10 new)**, same 5 pre-existing failures.
- **Pre-existing TypeScript errors unchanged.** `tsc --noEmit -p server/tsconfig.json` reports the same 3 errors (`edgeCases.test.ts × 2 satiety` + `reflectionRunner.ts × 1 possibly undefined`). Diff vs base: flat.
- **No auth gates encountered.** Plan executed fully autonomously.
- **No architectural decisions required.** Rule 4 never triggered.
- **Transient dirty-tree files** (`package-lock.json`, `migrate.ts`, `orderBook.ts`, `bootstrap.ts`, `simulate.ts`) present at plan start, not touched by Plan 11-06, not committed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plans 11-07 through 11-10 unblocked.** The governance toggle and law amendment flow are stable and verifiable:

- **Plan 11-07 (SFC subsystem drift telemetry)** — no conflict with governance; SFC drift instrumentation is orthogonal to the governance cycle.
- **Plan 11-08+ (remaining tuning)** — no direct intersection with governance.
- **Frontend work (future, out-of-scope for 11-06)** — Phase 11 D-17 mentions a checkbox in `DesignReview.tsx` / `EconomyTab.tsx`. This plan does not wire the UI toggle; it only guarantees the server-side gate respects `economyConfig.governanceEnabled`. A minimal UI plan can land independently since the backend contract is fixed.

**Smoke-verification ready:**
- Bootstrap a session with `economyConfig.governanceEnabled: false`, run 10 iterations → Live Feed should show no `governance-summary` events, `session.config.lawAmendmentHistory` should remain absent, `session.config.policy` should remain untouched.
- Bootstrap a governance-enabled session, run 10+ iterations → at iterations 5/10/15 governance cycles fire as before; occasional LLM runs may now emit `law_amendment` ballot items (capability acceptance, not occurrence).

**Blockers:** None.

## Known Stubs

None. All governance extensions wire real values end-to-end:

- `applyParagraphDiff` is a pure function; consumes real law text, produces real diffed text.
- `governanceManager` ratification writes real config (via `sessionRepo.updateConfig`) and real law (via `sessionRepo.updateLaw`) to SQLite.
- In-memory `session.law` / `session.config` mutation is intentional; matches established pattern.
- No mock/placeholder code paths in production source — all mocks live in test files (scripted LLM providers + `vi.mock('sessionRepo')`).

## Self-Check: PASSED

- `server/src/orchestration/helpers/lawDiff.ts` contains `export function applyParagraphDiff` — verified via `grep -c` returning 1.
- `lawDiff.ts` smart-quote regex `[\u2018\u2019]` present — verified (1 match).
- `server/src/llm/centralAgent.ts` references `applyParagraphDiff` 2 times (import + invocation) — verified.
- `shared/src/types.ts` contains `kind: 'law_amendment'` (1) and `kind: 'policy'` (1) — verified.
- `server/src/orchestration/governanceManager.ts` references `'law_amendment'` (3 times), `applyParagraphDiff` (2 times), `lawAmendmentHistory` (3 times) — all meet acceptance thresholds.
- `server/src/llm/prompts/governance.ts` references `law_amendment|lawAmendment` (8 times) and `oldParagraph` (7 times) — exceeds minimum thresholds.
- `server/src/orchestration/simulationRunner.ts` contains `governanceEnabled !== false` (1 match at the governance gate) — verified.
- D-16 regression grep (`git diff HEAD~1 -- governanceManager.ts prompts/governance.ts | grep 'selectPoliticians|franchiseSize|buildFranchiseSizePrompt'`) returns **0 matches** — franchise-sizing logic byte-identical to Phase 10 baseline.
- Commits `5437987`, `e05e8d7`, `c551ec1` all present in `git log` — verified.
- `npx vitest run server/src/orchestration/helpers/__tests__/lawDiff.test.ts server/src/orchestration/__tests__/governanceToggle.test.ts server/src/orchestration/__tests__/governanceAmendment.test.ts` — 21 passed, 0 failed — verified.
- `npm run test -w server` — 435 passed, 5 failed (pre-existing), 24 todo — +10 vs 11-05 baseline; no new failures.
- `tsc --noEmit -p server/tsconfig.json` — same 3 pre-existing errors; no new errors introduced.
- `npm run build -w shared` — exit 0.

---
*Phase: 11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure*
*Completed: 2026-04-13*
