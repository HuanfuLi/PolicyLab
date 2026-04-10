---
date: "2026-04-10 00:00"
promoted: false
---

Phase: Dynamic Role Transitions

## Issue: Static Agent Roles Break Type Enforcement

Currently, the LLM can reassign agent roles at runtime (e.g. turning a Farmer into a Merchant mid-simulation). This silently violates the role-tier permission gate in `actionCodes.ts`, which controls which actions each tier can take. A "Farmer" who becomes a "Merchant" via LLM re-labeling gains Merchant-class action permissions without any formal social mobility event, breaking simulation realism and SFC integrity.

## Proposed New Feature: Controlled Role Transition System

Design a phase to add intentional, structured role mobility:

**Core questions to discuss:**
1. Should roles be truly static (locked at roster creation), or should mobility be possible under defined conditions?
2. If mobility is allowed: what triggers a transition? (Wealth threshold? Skill level? Governance vote? Life event narrative?)
3. How should the LLM be constrained? (System prompt instruction vs. server-side validation that ignores unrecognized role strings vs. canonical role enum enforcement?)
4. Should role transitions generate a narrative event visible in the simulation feed?
5. Should the action permission gate use role-tiers (coarse) or individual role names (fine-grained)?

**Implementation surface:** `mechanics/actionCodes.ts` (tier gate), `orchestration/simulationRunner.ts` (agent prompt), `shared/src/types.ts` (Agent type), `db/schema.ts` (roleChanges table already exists).

**Note:** The `roleChanges` table already exists in the DB schema — likely scaffolded in a prior phase. Any implementation should use it.
