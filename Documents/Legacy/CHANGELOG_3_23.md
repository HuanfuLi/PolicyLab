# Changelog - 2026-03-23 (3.23)

## Phase 3: SFC & Reliability Hardening
**Status: 100% Implemented & Verified**

### Summary
Successfully completed the hardening of the simulation's Stock-Flow Consistency (SFC), persistence layer, and real-time synchronization. Conducted a full 6-pillar visual audit and archived all Phase 3 planning documents.

### Added
- **SSE Sequence Numbering (REL-04)**: Implemented monotonic sequence IDs for server-side SSE broadcasts and client-side duplicate filtering/gap detection.
- **Frontend Memory Management (REL-05)**: Added a 500-entry ring buffer for `agentIntentHistory` in the Zustand store to prevent unbounded memory growth.
- **Order Book Persistence (REL-01)**: Created SQLite-backed storage for market orders, ensuring they survive server restarts.
- **Multi-Action MET Aggregation (REL-03)**: Updated the metabolic engine to aggregate caloric costs across all actions in a multi-action queue.
- **Integer-Safe Redistribution (SFC-04)**: Implemented `distributeProRata` helper for exact integer wealth transfers (EMBEZZLE, death seizures).
- **Work Action**: Added `WORK` to `BASE_ACTIONS` in `actionCodes.ts` for manual task assignments.

### Fixed
- **EMBEZZLE Victim-Death (SFC-01)**: Corrected logic to ensure stolen wealth is accounted for even if a victim dies in the same iteration.
- **HELP Action Fiat Destruction (SFC-02)**: Prevented fiat leakage when zero-wealth agents attempt to help others.
- **Treasury Initialization (SFC-03)**: Moved treasury seeding before the genesis wealth floor calculation to ensure first-iteration top-ups are funded.
- **Allostatic Engine API**: Removed redundant `state` property from `AllostaticTickInput` and cleaned up `runFullMetabolicTick` calls.
- **Physics Engine Clamping**: Removed global clamping in `resolveActionQueue` to allow proper stat accumulation in multi-action queues.

### UI/UX Refinement
- **Color Tokenization (UI-01)**: Migrated chart colors and simulation stats to centralized CSS variables and TypeScript constants.
- **Typography Standardization (UI-02)**: Replaced inline `fontSize` styles in `PhysicsLaboratory.tsx` with Tailwind utility classes.
- **CTA Labeling (UI-03)**: Standardized buttons to use project-specific language (e.g., "Apply Configuration", "Begin Brainstorming").

### Maintenance
- **Roadmap Update**: Marked all Phase 3 plans as completed in `.planning/ROADMAP.md`.
- **Planning Archive**: Moved completed Phase 3 plans and research to `.planning/codebase/archives/phase-03/`.
- **UAT & Reviews**: Generated and archived `PHASE-3-REVIEWS.md` and `PHASE-3-UAT.md`.
