---
phase: 09-redesign-prompts-for-all
plan: 02
subsystem: llm
tags: [prompts, agent-intent, action-schemas, immersion, economic-survival]

# Dependency graph
requires:
  - phase: 09-redesign-prompts-for-all plan 01
    provides: Split prompt modules (agent-intent.ts, shared.ts) and barrel index
provides:
  - Rewritten citizen intent prompts with immersive first-person framing
  - Natural language action dictionary with code mapping
  - Personal economic dashboard with AMM market data parameter
  - Accurate MET survival knowledge (5-6 food/week)
  - Economic goal elicitation in planner prompt
affects: [09-03, 09-04, simulationRunner, cognitiveEngine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Natural language + code mapping for action descriptions"
    - "Lived knowledge penalties instead of game mechanics"
    - "ammMarketData optional parameter for forward-compatible market dashboard"

key-files:
  created: []
  modified:
    - server/src/llm/prompts/shared.ts
    - server/src/llm/prompts/agent-intent.ts
    - server/src/cognition/recursivePlanner.ts
    - server/src/llm/__tests__/promptContent.test.ts

key-decisions:
  - "ammMarketData parameter added as optional last param -- Plan 04 will wire it from simulationRunner"
  - "D-15 satisfied by existing economyEvents in memoryStream -- price data already flows through createExperienceMemories"
  - "D-16 addressed by adding economic goal examples to planner prompt"
  - "Biological prose preserved verbatim with em-dash to double-dash normalization"

patterns-established:
  - "Action descriptions: natural language first, code in parentheses at end of first sentence"
  - "No mechanical [TAG] labels in citizen prompts -- use natural language framing"
  - "Prompt labels use conversational tone: 'What you remember:', 'Your goal:', 'Last week's results:'"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-15, D-16, D-17, D-18]

# Metrics
duration: 8min
completed: 2026-04-07
---

# Phase 09 Plan 02: Citizen Agent Intent Prompt Rewrite Summary

**Rewrote citizen intent prompts with accurate MET survival knowledge (5-6 food/week), immersive first-person framing, natural language action dictionary, and personal economic dashboard -- fixing the death spiral root cause**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-07T05:07:35Z
- **Completed:** 2026-04-07T05:15:32Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments
- Fixed death spiral root cause: agents now know food costs 5-6 units/week and PRODUCE_AND_SELL yields 20 units
- Removed all 6 mechanical [SYSTEM TAG] labels from citizen prompts (D-07)
- All 28 ACTION_SCHEMAS descriptions rewritten as natural language + code mapping (D-17/D-18)
- Added ammMarketData parameter for personal economic dashboard with affordability calculation (D-02/D-03)
- Enterprise owner identity rewritten as character-driven paragraph (D-09)
- Planner prompt now elicits economic goals with concrete examples (D-16)
- 9 prompt content tests unskipped and passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite ACTION_SCHEMAS + buildActionDictionary** - `572d953` (feat)
2. **Task 2a: Rewrite buildNaturalIntentPrompt static prefix** - `06efc05` (feat)
3. **Task 2b: Rewrite buildNaturalIntentPrompt dynamic suffix + D-15/D-16** - `15fddab` (feat)
4. **Task 3: Unskip and update prompt content tests** - `864579b` (test)

## Files Created/Modified
- `server/src/llm/prompts/shared.ts` - All 28 action descriptions rewritten with natural language + code mapping; buildActionDictionary header reworded
- `server/src/llm/prompts/agent-intent.ts` - Static prefix with accurate MET cost and immersive framing; dynamic suffix with personal dashboard, no mechanical tags
- `server/src/cognition/recursivePlanner.ts` - Planner prompt enriched with economic goal examples
- `server/src/llm/__tests__/promptContent.test.ts` - 9 tests unskipped for D-02/D-04/D-05/D-06/D-07/D-08/D-09/D-17; 2 remain skipped for Plan 03

## Decisions Made
- ammMarketData added as optional last parameter to avoid breaking existing callers; Plan 04 will wire the actual AMM data from simulationRunner
- D-15 (economic memories) verified satisfied by existing memoryStream.createExperienceMemories -- economyEvents already contain price strings like "sold to market at 5.00/unit"
- D-16 (planner economic goals) addressed by adding examples: "Save enough to buy tools", "Produce food every week until I have 100 fiat"
- Preserved [FINAL OUTPUT RULE] and JSON schema blocks exactly as-is (Pitfall 4)
- Em-dashes normalized to double-dashes throughout rewritten prompts for consistency

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing closing backtick in recursivePlanner template literal**
- **Found during:** Task 2b
- **Issue:** Edit to planner prompt accidentally removed the closing backtick of the template literal, causing TypeScript parse errors
- **Fix:** Added back the closing backtick and semicolon
- **Files modified:** server/src/cognition/recursivePlanner.ts
- **Verification:** TypeScript compiles with zero errors
- **Committed in:** 15fddab (Task 2b commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial edit error, no scope change.

## Issues Encountered
None

## Known Stubs
None -- all data paths are wired or explicitly documented as future-plan responsibility (ammMarketData wired by Plan 04).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (Central Agent + Reflection prompts) can proceed -- all citizen prompt changes are complete
- Plan 04 (simulationRunner wiring) will connect ammMarketData to the new parameter
- D-11 and D-13 test stubs remain skipped, ready for Plan 03 to unskip

## Self-Check: PASSED

All 4 modified files exist. All 4 commit hashes verified in git log.

---
*Phase: 09-redesign-prompts-for-all*
*Completed: 2026-04-07*
