---
phase: 09-redesign-prompts-for-all
plan: 03
subsystem: llm
tags: [prompts, agent-roster, reflection, immersion, life-stories]

requires:
  - phase: 09-redesign-prompts-for-all-01
    provides: Split prompt modules (central-agent.ts, reflection.ts, location.ts)
provides:
  - Rich 5-8 sentence agent life stories with economic instincts in roster prompts
  - Immersive first-person reflection prompts for citizen agents
  - D-11/D-13 prompt content tests unskipped and passing
affects: [simulation-quality, agent-behavior-diversity]

tech-stack:
  added: []
  patterns: [immersion-first-citizen-prompts, mechanical-framing-central-agent]

key-files:
  created: []
  modified:
    - server/src/llm/prompts/central-agent.ts
    - server/src/llm/prompts/reflection.ts
    - server/src/llm/prompts/location.ts
    - server/src/llm/__tests__/promptContent.test.ts

key-decisions:
  - "D-11/D-12: Roster background field changed from 1-2 sentences to 5-8 sentence life story with economic instinct requirement"
  - "D-13: Central Agent resolution/merge/group prompts preserved with mechanical framing unchanged"
  - "D-14: NARRATIVE DIRECTIVE friction-first bias preserved verbatim"
  - "Reflection immersion: removed simulation framing from citizen-facing prompts only; buildEvaluationPrompt analytical structure kept intact"

patterns-established:
  - "Citizen-facing prompts use first-person embodiment; Central Agent prompts keep mechanical framing"
  - "Agent roster prompts require economic instinct and diversity in backgrounds"

requirements-completed: [D-11, D-12, D-13, D-14]

duration: 3min
completed: 2026-04-07
---

# Phase 09 Plan 03: Agent Roster and Reflection Prompt Enrichment Summary

**5-8 sentence life stories with economic instincts for agent roster generation, plus immersive first-person reflection prompts for citizen agents**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-07T05:07:29Z
- **Completed:** 2026-04-07T05:10:15Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Agent roster prompts (both creative and location modes) now request rich 5-8 sentence life stories including formative events, economic philosophy, and practical role knowledge
- Economic instinct requirement ensures natural behavioral diversity among generated agents
- Citizen-facing reflection prompts aligned with immersion principles (no simulation framing, first-person embodiment)
- Central Agent prompts preserved with mechanical framing per D-13/D-14

## Task Commits

Each task was committed atomically:

1. **Task 1: Enrich agent roster background prompt** - `1db368d` (feat)
2. **Task 2: Align reflection prompts with immersion** - `3321d6e` (feat)
3. **Task 3: Unskip D-11 and D-13 tests** - `0ac7867` (test)

## Files Created/Modified
- `server/src/llm/prompts/central-agent.ts` - Updated buildAgentRosterMessages background schema and rules
- `server/src/llm/prompts/location.ts` - Updated buildLocationAgentRosterMessages with same enrichment
- `server/src/llm/prompts/reflection.ts` - Immersive tone for citizen-facing reflection prompts
- `server/src/llm/__tests__/promptContent.test.ts` - Unskipped D-11 and D-13 tests

## Decisions Made
- Applied identical life story format to both creative mode (central-agent.ts) and location mode (location.ts) for consistency
- Removed `[STATE LOCKED - DECEASED]` system tag from postMortemPrompt as part of immersion cleanup
- Changed "Iteration" references to "week" in postMortemPrompt for consistency with immersive framing
- Left 9 tests still skipped in promptContent.test.ts -- these belong to Plan 02 (intent prompt rewrites), not Plan 03

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all changes are complete prompt content updates with no placeholder data.

## Next Phase Readiness
- Plan 03 complete; roster and reflection prompts enriched
- Plan 02 (intent prompt rewrites) handles the remaining 9 skipped tests
- Plan 04 (governance prompts) can proceed independently

---
*Phase: 09-redesign-prompts-for-all*
*Completed: 2026-04-07*
