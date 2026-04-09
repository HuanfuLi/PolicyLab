---
status: awaiting_human_verify
trigger: "5 issues: FK constraint error, fallback agent names, missing reasoning, parser errors with jsonSchema, test connection only tests main provider"
created: 2026-04-08T12:00:00Z
updated: 2026-04-08T12:00:00Z
---

## Current Focus

hypothesis: 5 independent bugs from Phase 10 changes
test: Reading code paths for each issue
expecting: Root causes identifiable from code analysis
next_action: Fix all 5 issues

## Symptoms

expected: 1) Simulation completes without DB errors. 2) All agents have LLM-generated names. 3) Citizens produce reasoning text. 4) JSON schema prevents parse failures. 5) Test Connection tests all providers.
actual: 1) FK constraint error at end of iterations. 2) Fallback names like Agent-A1. 3) Only action codes, no reasoning. 4) Parser errors despite jsonSchema. 5) Only main provider tested.
errors: FOREIGN KEY constraint failed; retryWithHealing parse exhaustion
reproduction: Location-bootstrapped simulation with banking enabled + LM Studio local model
started: After Phase 10 execution

## Eliminated

## Evidence

- timestamp: 2026-04-08T12:01:00Z
  checked: asyncLogFlusher.ts, agent_intents schema, resolved_actions schema
  found: Both tables have FK on agent_id -> agents(id). asyncLogFlusher batches inserts. If agent_intents row references invalid agent_id, FK fails.
  implication: Need to find where invalid agent_ids enter the flusher queue

- timestamp: 2026-04-08T12:02:00Z
  checked: dataBootstrapPipeline.ts generateAgentRoster
  found: Agents created with placeholder names "Agent-I1", "Agent-S1", "Agent-A1". LLM enrichment in bootstrap.ts overwrites names only if rosterData.agents array is long enough.
  implication: If LLM returns fewer agents than blueprints, remaining agents keep fallback names

- timestamp: 2026-04-08T12:03:00Z
  checked: simulationRunner.ts broadcast agent-intent, simulationManager SimulationEvent type
  found: SSE broadcast includes reasoning field. parseSinglePassIntent returns reasoning from internal_monologue. The store receives it. Need to check UI display.
  implication: Reasoning may be collected but not displayed in UI

- timestamp: 2026-04-08T12:04:00Z
  checked: retryWithHealing.ts, openai.ts OpenAICompatibleProvider
  found: retryWithHealing passes options to provider.chat, which includes jsonSchema. LM Studio may not support strict json_schema response_format causing API errors rather than parse errors.
  implication: jsonSchema may cause LLM call to fail rather than helping parse

- timestamp: 2026-04-08T12:05:00Z
  checked: settings.ts POST /test endpoint
  found: Only creates one temp provider from main settings, no iteration over providers array
  implication: Extra provider slots have no test mechanism

## Resolution

root_cause: |
  1. FK constraint: asyncLogFlusher queued inserts can reference stale agent IDs when eraseSimulationData runs concurrently. Also, batch-level FK errors drop all rows.
  2. Fallback names: LLM enrichment may return fewer agents than blueprints; remaining keep placeholder "Agent-XX" names.
  3. Missing reasoning: /agent-intents API didn't select/return the reasoning column; UI only showed narrative (not reasoning).
  4. Parser errors: Citizen intent calls lacked jsonSchema; OpenAICompatibleProvider didn't gracefully degrade when json_schema unsupported.
  5. Test Connection: Only main provider had test endpoint; extra provider slots had no test mechanism.

fix: |
  1. Flush asyncLogFlusher before eraseSimulationData; add per-row FK error fallback in flusher.
  2. After LLM enrichment, patch remaining placeholder names with role-based fallback names.
  3. Add reasoning column to /agent-intents query and response; show reasoning in UI (italic, above narrative).
  4. Add jsonSchema to citizen intent retryWithHealing call; OpenAICompatibleProvider auto-degrades from json_schema to json_object when server rejects it.
  5. Add POST /api/settings/test-provider/:index endpoint; add per-slot Test button in SettingsPage.

verification: Build passes. All 273 server tests pass.
files_changed:
  - server/src/routes/sessions.ts
  - server/src/routes/simulate.ts
  - server/src/routes/settings.ts
  - server/src/routes/bootstrap.ts
  - server/src/orchestration/simulationRunner.ts
  - server/src/llm/openai.ts
  - server/src/db/asyncLogFlusher.ts
  - web/src/pages/Simulation.tsx
  - web/src/pages/SettingsPage.tsx
  - web/src/stores/simulationStore.ts
  - web/src/api/settings.ts
