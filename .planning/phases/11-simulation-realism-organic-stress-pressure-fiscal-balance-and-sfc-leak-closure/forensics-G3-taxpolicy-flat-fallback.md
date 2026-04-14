---
finding: G3 — Central Agent chose flat 8.7/5/8.7 taxPolicy for US bootstrap (expected progressive)
also-covers: G4 — TaxPolicyReadout needs to be editable at design stage
mode: read-only forensics
author: gsd-debugger
date: 2026-04-13
---

# G3 — taxPolicy Flat Fallback Attribution (+ G4 Editor Implications)

## TL;DR

**Root cause is (c) — the threshold heuristic was never satisfied for the US profile the bootstrap actually consumed.** The cached WB value for `govExpensePctGdp` is **24.9%** (year 2023), well below the `> 30%` gate. The 11-05-SUMMARY baseline assumption (~37%) was wrong; the heuristic fired *correctly* given the inputs it saw. There is no precedence bug — bootstrap-derived `taxPolicy` is never overwritten downstream when the bootstrap path is taken. However, the **observed rates (8.7% / 5% / 8.7%) cannot be reproduced from the bootstrap derivation with US data**, which means the session in question almost certainly took the **creative-mode path** (LLM-chosen taxPolicy), not the location-bootstrap path.

---

## 1. Path Attribution

Two disjoint session-creation flows exist. Both can produce a US-themed session.

| Path | Entry | Writes `economyConfig.taxPolicy` via |
|---|---|---|
| Location-mode bootstrap | `POST /api/sessions/:id/bootstrap` → `server/src/routes/bootstrap.ts:70` | `profileToEconomyConfig` in `server/src/data/dataBootstrapPipeline.ts:221-242`, persisted at `bootstrap.ts:528` |
| Creative mode | `POST /api/sessions/:id/design` → `server/src/routes/design.ts:76` → `generateDesign` | LLM `buildLawMessages` schema in `server/src/llm/prompts/central-agent.ts:124-203`, validated + merged at `centralAgent.ts:193, 287` |

**Flow divergence signal.** In `centralAgent.ts:283`:
```
if (!existingConfig.economyConfig) {
  const economyConfig = { ...DEFAULT_ECONOMY_CONFIG, taxPolicy: llmTaxPolicy };
  ...
}
```
The creative-mode merge only fires when `economyConfig` is absent. A prior bootstrap would have populated it. **So creative-mode never overwrites bootstrap-derived taxPolicy** — but it also means: if bootstrap was skipped, only the LLM's taxPolicy lands.

**Which path did the US session take?**

Mechanical check on the observed rates (`flat 8.7% / 5% / 8.7%`):
- Bootstrap derivation for cached US data (`lendingInterestRate = 3.25`, `govExpensePctGdp = 24.9`):
  - `incomeSeed = clamp(3.25/100 × 2, 0.08, 0.30) = clamp(0.065, 0.08, 0.30) = 0.08` → **8.0%** (not 8.7%)
  - `vatSeed = clamp(24.9/300, 0.05, 0.20) = clamp(0.083, 0.05, 0.20) = 0.083` → **8.3%** (not 5.0%)
- The `5.0%` VAT is exactly the `vatSeed` minimum clamp. That clamp only activates when `govExpensePctGdp < 15`. US data has 24.9%, so bootstrap cannot produce 5%.

Therefore: **the observed taxPolicy was emitted by the Central Agent's LLM law-step, which means the session was created via the creative-mode path** (`generateDesign` → `buildLawMessages`), not the location-bootstrap path. The UI label "United States" was the seed idea text, not a location-bootstrap selection.

Evidence in code that no other writer exists:
- `server/src/routes/sessions.ts:398-400` — PUT `/sessions/:id/config` does shallow-merge `body.economyConfig` into the stored config. UI (`web/src/components/EconomyTab.tsx:643`) renders `TaxPolicyReadout` **read-only**; no setter calls, no PUT-body assembly that includes a `taxPolicy` field. `grep -r taxPolicy web/src` finds 1 reference (the readout). So the UI never mutates taxPolicy.
- `server/src/routes/bootstrap.ts:259-298` — scenario interpretation LLM can override parameters. But (a) `buildScenarioInterpretationMessages` in `server/src/llm/prompts/location.ts:101-147` does NOT mention `taxPolicy`; (b) even if the scenario LLM hallucinated a `taxPolicy` key, since `validKeys.has('taxPolicy')` is true (it's a valid `EconomyConfig` key) and the override is an object (not a number), the numeric-bounds check is skipped and it gets merged. This is a latent vulnerability but **not in play for a session with no scenario text**.

---

## 2. Root Cause

**Cause (c) — threshold not actually met for US data, *AND* the observed rates indicate the session never even ran the bootstrap path.**

Two layers of issue:

### 2a. The heuristic threshold is wrong for real WB data

`server/src/data/dataBootstrapPipeline.ts:222`:
```
if (gdpPC > 25000 && govExpensePct > 30) { /* progressive */ }
```

US cached values at `~/.policylab/cache/US.json` (fetched 2026-04-13):

| Indicator | Value | Year | Source |
|---|---|---|---|
| `economics.gdpPerCapita` | 84534.04 | 2024 | `api` (medium confidence) |
| `economics.lendingInterestRate` | 3.25 | 2021 | `api` (low confidence) |
| `economics.inflationRate` | 2.95 | 2024 | `api` (medium) |
| **`fiscal.govExpensePctGdp`** | **24.90** | **2023** | **`api` (medium)** |
| `fiscal.taxRevenuePctGdp` | 10.97 | 2024 | `api` (medium) |
| `fiscal.govDebtPctGdp` | 117.97 | 2024 | `api` (medium) |

`govExpensePctGdp = 24.9 < 30` → heuristic correctly falls to flat.

**Why the 11-05 SUMMARY expected ~37%:** The SUMMARY (line 154) says *"US lending ≈ 6%, gov expense ≈ 37%"*. That 37% corresponds to the OECD general-government-expenditure-percent-GDP (federal + state + local + social insurance), not the World Bank indicator `GC.XPN.TOTL.GD.ZS` which measures central-government cash expense only (typically ~20-25% for the US). The heuristic was designed against OECD-scale data and is being fed WB-scale data.

The thresholds in Plan 11-05 (line 81: *"gdpPerCapita > 25000 AND govExpense > 30%"*) are therefore **miscalibrated for the WB indicator actually fetched**. US (~25% WB central gov expense), Japan (~21%), UK (~39% — larger scope), Germany (~26% WB vs ~49% OECD general-gov) — all modern welfare states fail the 30% gate on the WB indicator.

### 2b. The observed session never took the bootstrap path

As shown in §1, `flat 8.7% / 5% / 8.7%` cannot come from the bootstrap heuristic on US data. It came from `buildLawMessages` — creative-mode. The LLM picked a "United States"-themed flat schedule freely. Its selection of 5% VAT (far below the 10% DEFAULT) suggests the LLM weighted "libertarian/low-tax" framing rather than matching empirical OECD rates.

So the user's session is creative-mode-created, even if the user thought they were doing a location bootstrap. This should be verified at the session's `locationProfile` field: if `session.config.locationProfile` is absent, the bootstrap path was never run.

---

## 3. Precedence Bug Check

**No precedence bug exists for the bootstrap path.** Cross-referenced writes to `session.config.economyConfig`:

| Writer | File:line | Overwrites taxPolicy? |
|---|---|---|
| Bootstrap pipeline | `server/src/routes/bootstrap.ts:528` (`economyConfig: finalConfig`) | YES, full replacement; `finalConfig = { ...DEFAULT_ECONOMY_CONFIG, ...profileToEconomyConfig().config }` (`bootstrap.ts:248`). Bootstrap-derived taxPolicy lands cleanly. |
| Creative-mode generateDesign | `server/src/llm/centralAgent.ts:287-296` | **GUARDED** — only fires when `!existingConfig.economyConfig`. Bootstrap-first sessions never hit this. |
| PUT `/sessions/:id/config` | `server/src/routes/sessions.ts:398-400` | Shallow merge: `{ ...existingEconomy, ...body.economyConfig }`. If the UI ever POST-s an `economyConfig` object containing `taxPolicy`, that would replace it. **UI currently does not.** |
| Scenario interpretation LLM | `server/src/routes/bootstrap.ts:276-298` | Validation loop passes object-valued overrides through unchecked. Not in practice exercised for taxPolicy (prompt doesn't list it), but a latent escape hatch. |
| Fork (`POST /sessions/:id/fork`) | `server/src/routes/sessions.ts:464` | Copies source `economyConfig` entirely — preserves taxPolicy. |
| `scenarioStore.runAllScenarios` | `web/src/stores/scenarioStore.ts:208-215` PUT | Sends full `tab.economyConfig`. Since `initFromSession` seeds `tab.economyConfig` from the bootstrap-derived config, the round-trip preserves taxPolicy. |

Conclusion: **bootstrap-derived taxPolicy wins deterministically if the bootstrap path actually runs**. The G3 symptom is not a precedence bug; it's a (a) threshold-mismatch problem *for legitimate bootstrap sessions*, and (b) an LLM-free-choice problem *for sessions that never ran bootstrap*.

---

## 4. Fix Direction for G3

Two independent fixes are needed.

### 4a. Correct the progressive threshold to match WB indicator scale

File: `server/src/data/dataBootstrapPipeline.ts:222`

Current: `if (gdpPC > 25000 && govExpensePct > 30)`

Recommended: drop `govExpensePct` to **> 18** (catches US 24.9, Germany 26, UK 39 — all modern welfare states; still excludes frontier economies) OR replace with a composite signal less prone to indicator-scope ambiguity, e.g. `gdpPC > 25000 AND (govExpensePct > 18 OR taxRevenuePctGdp > 15)`. 

Alternative stronger signal: use `govDebtPctGdp > 60` as a proxy for mature-state fiscal footprint — US (117), Japan, Italy, UK, France all clear this easily; emerging markets do not. Research note in 11-RESEARCH §5 only specifies "high GDP per capita + high gov expense" narratively; the exact threshold was a Plan-time judgment call that didn't back-test against cached fixtures.

Any chosen threshold MUST be tested against a fixture set including at least: US, DE, UK, JP, IN, BR, NG, SA. The existing test file `server/src/llm/__tests__/centralAgentTaxPolicy.test.ts:117,118` uses synthetic inputs (`gdpPerCapita=30000, govExpensePctGdp=35`) that don't correspond to any real country's WB values — add a "real US fixture" test.

### 4b. Ensure the bootstrap path actually runs for location-mode sessions

If the G3 session truly took the location-bootstrap path but still landed 8.7/5/8.7, the investigation above is wrong and we have a missed-write bug somewhere. To rule this out, add a session-level invariant check: when `session.config.locationProfile` is set, assert `session.config.bootstrapSources?.taxPolicy === 'api'`. This would have surfaced the issue immediately.

For users who entered "United States" as a seed idea via creative-mode (not via the location picker), the LLM is free to choose any schedule. That is working as designed. The remedy for G3 in that case is the G4 editor (§5 below) — let the policymaker correct the LLM's choice.

### 4c. Close the scenario-override escape hatch

At `server/src/routes/bootstrap.ts:274-296`, add taxPolicy to the rejection list or require numeric values only. This prevents a hallucinated scenario LLM from ever bypassing the bootstrap-derived taxPolicy. Out of scope for G3 strictly, but a known-gap worth recording.

---

## 5. Implications for G4 — Editable TaxPolicyReadout

Current state: `web/src/components/EconomyTab.tsx:245-end-of-readout` renders `TaxPolicyReadout` as a non-interactive display. No PUT path exists from the UI to mutate `taxPolicy`.

### Where it should land

Inside `EconomyTab.tsx` Fiscal section (line 641-643 already gates on `section === 'fiscal'`). Replace the read-only display with a controlled form component:

- **Kind selector:** radio/toggle for `flat` | `progressive`
- **Rate inputs:** three numeric fields (`income`, `vat`, `capitalGains`), each 0-50% with step 0.5
- **Brackets editor** (progressive only): array editor for `{ upto, rate }[]` with add/remove row buttons; UI must enforce strictly-increasing `upto`
- **Source/confidence badge:** keep `DataConfidenceBadge` (source = `api` from bootstrap, `llm` from creative, `user` after manual edit)
- **Reset to bootstrap-derived:** button that re-runs `profileToEconomyConfig` (or reads the snapshotted derived value from `session.config.bootstrapSources`)

### Wiring

Form emits a full `TaxPolicy` object → parent patches via the existing PUT `/sessions/:id/config` with `{ economyConfig: { taxPolicy: ... } }`. Server-side flow:
1. `sessions.ts:400` shallow-merge picks up `taxPolicy`.
2. **Add `validateTaxPolicy` call** inside the PUT handler before merging: `body.economyConfig.taxPolicy = validateTaxPolicy(body.economyConfig.taxPolicy)`. Currently `validateTaxPolicy` is only invoked at bootstrap and creative-design paths (`dataBootstrapPipeline.ts:241`, `centralAgent.ts:193`). PUT bypasses it today — G4 must not.
3. Track `sources.taxPolicy = 'user'` (new `DataSource` value, or reuse `'web'`) so the badge reflects manual override.

### Validation rules the editor must enforce (from `economyConfigUtils.ts:47-105`)

- Each rate clamped to `[0, 0.5]` per `clampRate` (`economyConfigUtils.ts:53-56`). UI should show warning if user enters > 50%.
- Progressive: `brackets.length >= 1`. Empty → coerced to `DEFAULT_TAX_POLICY` (flat 15/10/15) *server-side* — UI should prevent this by requiring at least one bracket.
- Progressive: `brackets[i].upto` strictly increasing. UI should auto-sort and flag duplicates.
- Progressive: if validator falls back to flat due to malformed brackets, UI should surface this as an error, not silently accept the coerced result.

### Should the editor overwrite bootstrap-derived values, or layer on top?

**Overwrite.** The PUT path is read-modify-write on the stored config; there is no separate "user overrides" layer. Keep it simple: manual edits replace the derived value, and `sources.taxPolicy` is updated to `'user'` so future re-bootstraps (which would set it back to `'api'`) don't silently lose the user's choice. If re-running bootstrap is desired to revert, that's an explicit button — not automatic.

### G4 ordering relative to G3 fix

G4 should **land after** the G3 heuristic fix (§4a). Otherwise users will see a bootstrap-derived "flat" default for a country where progressive is more accurate, and many will edit it manually, creating a data-quality signal that falsely looks like user preference rather than bad derivation. Fix the derivation first so the editor is genuinely optional correction, not routine repair.

---

## 6. Evidence Manifest

| Claim | File:line | Timestamp |
|---|---|---|
| US govExpensePctGdp = 24.9 | `~/.policylab/cache/US.json:116` | cache fetched 2026-04-13T07:51:08Z |
| US lendingInterestRate = 3.25 | `~/.policylab/cache/US.json:96` | same |
| US gdpPerCapita = 84534 | `~/.policylab/cache/US.json:66` | same |
| Heuristic thresholds `gdpPC > 25000 AND govExpensePct > 30` | `server/src/data/dataBootstrapPipeline.ts:222` | current HEAD |
| Bootstrap persists full finalConfig | `server/src/routes/bootstrap.ts:528` | current HEAD |
| Creative-mode guard: only runs if `!existingConfig.economyConfig` | `server/src/llm/centralAgent.ts:283` | current HEAD |
| UI TaxPolicyReadout is read-only | `web/src/components/EconomyTab.tsx:245`, `:643` | current HEAD |
| PUT config shallow-merge (no taxPolicy validation) | `server/src/routes/sessions.ts:398-400` | current HEAD |
| 11-05-SUMMARY claim US gov expense ≈ 37% | `.planning/phases/11-.../11-05-SUMMARY.md:154` | committed 2026-04-13 |
| Scenario LLM prompt omits taxPolicy | `server/src/llm/prompts/location.ts:117-127` | current HEAD |

Cache path `/Users/huanfuli/.policylab/cache/US.json` is accessible and was used for all US-data attributions above.
