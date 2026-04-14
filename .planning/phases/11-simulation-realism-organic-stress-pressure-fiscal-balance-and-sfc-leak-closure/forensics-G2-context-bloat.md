# Forensics G2 — LLM Context Bloat on `groupResolution`

**Symptom.** Phase 11 UAT (US-bootstrap, 30+ agent session, local model with ~20k context window):

```
[retryWithHealing] groupResolution:2 attempt 1 — chat error: 400 "Context size has been exceeded."
[retryWithHealing] groupResolution:0 attempt 1 — chat error: 400 "Context size has been exceeded."
```

**Bottom line.** Root cause is a **pre-Phase-11** regression introduced in commit `fdcd6ce` (Phase 5+6 refactor, 2026-04-10), not a Phase 11 addition. Phase 11's new `[TAX]` trace sites accelerate the bloat but are not the origin. G2 is **structurally pre-existing but exposed by Phase 11**; log as out-of-scope for 11-GC1, defer to a dedicated trace-log fix.

---

## 1. Prompt size estimate — groupResolution, 5-iteration 30-agent US bootstrap

Rough tokenization: 4 chars/token. Measurements taken by reading `buildGroupResolutionMessages` in `server/src/llm/prompts/central-agent.ts:401-477` and following each dynamic component back to its producer.

### 1a. Current (HEAD) — what's being sent

| Prompt component | Source | Chars (typical) | Tokens |
|---|---|---|---|
| Static prefix (header, schema, rules) | `central-agent.ts:426-452` | ~1,200 | ~300 |
| `session.law` slice | `central-agent.ts:430` — `session.law?.slice(0, 400)` | ≤400 | ≤100 |
| `groupLockedNote` | `central-agent.ts:421-423` | 0 (none locked) | 0 |
| `previousSummary` slice | `central-agent.ts:460` — `.slice(0, 400)` | ≤400 | ≤100 |
| `metricsSnippet` (prev `sessionIterationMetrics`) | `central-agent.ts:455-456`, source `simulationRunner.ts:2823-2825` + appends at `:2836,:2965` — single-iteration overwrite, bounded | ~500 | ~125 |
| **`physicsLogSnippet`** | `central-agent.ts:457-458` — embeds `prevPhysicsLog` **verbatim** | **≤50,000** (hard cap) | **≤12,500** |
| `groupList` (15 agents × ~120 chars) | `central-agent.ts:414-419` | ~1,800 | ~450 |
| `allIntentsBrief.slice(0,800)` | `central-agent.ts:466` | ≤800 | ≤200 |
| User turn | `central-agent.ts:475` — one short sentence | ~40 | ~10 |
| **Prompt total (steady state, iter ≥ 3)** | | **~55,140 chars** | **~13,785 tokens** |

A 20k-token model needs output headroom (the group resolution response itself is 300-600 tokens, plus provider overhead). Effective input budget on a 20k-window model is ~14-15k tokens. **Steady-state prompt at 13.8k is already brushing the ceiling** — any variance (larger session idea text, a law paragraph near 400 chars, a spike in intents) tips it over.

### 1b. Pre-Phase-11 baseline — same prompt path

The **prompt builder itself** was untouched by Phase 11. `buildGroupResolutionMessages` predates Phase 11 (last functional edit: `cd45f0c Refactored`, pre-11). The group prompt *shape* is identical.

However, the `physicsLog` that gets embedded **is** a function of what Phase 11 added to `appendTrace`:

| Phase 11 commit | Added trace sites | Per-iter chars added |
|---|---|---|
| 11-04 | 4 new `appendTrace(... '[TAX] Withheld ...')` sites at `simulationRunner.ts:1364, :1494, :1516, :1536, :1594, :1648, :2478` | ~3–5 KB |
| 11-03 / 11-05 / 11-06 / 11-07 / 11-08 | No new `appendTrace` sites; touched separate prompt paths | 0 |

Pre-Phase-11 trace generation (commit `37243eb~1`, just before Phase 11 started): **7 `appendTrace` sites**. HEAD: **15 sites**. Phase 11 more than doubled the count — but all 8 new ones are Phase 11 D-12/D-14 `[TAX]` withholding lines added by 11-04.

**Pre-Phase-11 per-iteration physics trace volume** (30 agents):
- Per-agent D4 summary: 30 × ~400 chars = 12,000 chars (`simulationRunner.ts:1446-1455`)
- Banking trace join: ~1–3 KB
- Capital-market trace join: ~2–4 KB
- Fiscal trace join: ~1–2 KB
- Inflation trace: ~1 KB
- **Pre-Phase-11 per iter: ~17–22 KB**

**Phase 11 per-iteration physics trace volume**:
- Same as above + ~8 new `[TAX]` lines × ~100 chars × ~10 events/iter = ~8 KB extra
- **Phase 11 per iter: ~25–30 KB**

Both exceed half the 50 KB cap, so **the cap saturates within 2–3 iterations in either era**. The steady-state prompt size is essentially the same pre-vs-post Phase 11 — **~12,500 tokens from physicsLog alone** — because `appendTrace` always tail-slices to exactly 50 KB. The 8 new `[TAX]` sites are drowned out by the existing 7 sites' higher per-event volume.

### 1c. The actual root cause — `fdcd6ce` (pre-Phase-11)

The "last iteration" physics log was **never meant to accumulate**. Original behavior at `fdcd6ce~1:server/src/orchestration/simulationRunner.ts:1386`:

```ts
if (logLines.length > 0) {
  sessionLastPhysicsTraces.set(sessionId, logLines.join('\n'));  // ← OVERWRITE
}
```

Commit `fdcd6ce` ("refactor: Phase 5+6 — lifecycle controller + phase module scaffolding", 2026-04-10) centralized trace emission into a helper and **silently changed `.set(...)` to `appendTrace(...)`** across every emission site. See `simulationState.ts:74-78`:

```ts
export function appendTrace(sessionId: string, newContent: string): void {
  const existing = sessionLastPhysicsTraces.get(sessionId) ?? '';
  const combined = existing + '\n' + newContent;
  sessionLastPhysicsTraces.set(sessionId, combined.length > 50_000 ? combined.slice(-50_000) : combined);
}
```

The 50 KB tail-slice is the only guard. There is **no per-iteration reset** — grep for `sessionLastPhysicsTraces.(set|clear|delete)` returns only the `appendTrace` body and `cleanupSessionState` (session end). The comment at `simulationRunner.ts:977` ("Physics log from last iteration — grounding data for the narrator") and the prompt header at `central-agent.ts:458` ("exact mechanical outcomes **last iteration**") are **both inaccurate** — the log is whatever 50 KB tail happens to be in the buffer.

**Evidence of "never meant to accumulate":**
- The in-code comment says "last iteration's physics trace log" (`simulationState.ts:124`).
- The prompt header says "exact mechanical outcomes last iteration" (`central-agent.ts:458`).
- Per-agent logs take only `traces.slice(-3)` before emission (`simulationRunner.ts:1450`) — explicit bounding intent at the producer site.
- Pre-`fdcd6ce` code used `.set(sessionId, logLines.join('\n'))`.

The refactor broke the contract without updating comments or prompt text.

---

## 2. Phase 11 vs pre-existing — attribution verdict

| Question | Answer | Evidence |
|---|---|---|
| Did a Phase 11 prompt change bloat `groupResolution`? | **No.** | `buildGroupResolutionMessages` signature + body unchanged in 11-01 through 11-09. Last functional edit is `cd45f0c` (pre-11). |
| Did Phase 11 widen the JSON schema of `groupResolution`? | No. | 11-05 widened `buildLawMessages` only (stat: `central-agent.ts +54 lines`, all inside law schema block `:127-200`). 11-06 widened `prompts/governance.ts` only. |
| Did Phase 11 add per-iteration TelemetryLog dumps into any resolution prompt? | No. | `sfcDrift`/`sfcDriftBySubsystem` (11-07) are written to `iterTelemetry` (`simulationRunner.ts:2947-2955`) but that struct is **not** stringified into `groupResolution`. The merge prompt receives a `telemetryDigest` (`central-agent.ts:501-503`) — a deliberately compact summary — not the raw log. |
| Did Phase 11 add new `appendTrace` sites? | **Yes — 8 new `[TAX]` sites added by 11-04.** But the 50 KB cap was already saturating pre-Phase-11 from physics/banking/capmkt/fiscal traces alone. | `git show HEAD:... \| grep -c appendTrace` = 15; `git show 37243eb~1:... \| grep -c appendTrace` = 7. Per-iteration trace volume pre-11 already ~20 KB vs cap 50 KB. |
| Is the structural cause in Phase 11 scope? | **No.** | The `set → appendTrace` regression is in `fdcd6ce` (2026-04-10, Phase 5+6 refactor). All Phase 11 commits have later timestamps and none touch `sessionLastPhysicsTraces`. |

**Verdict:** G2 is **out-of-scope for 11-GC1**. Log to `.planning/phases/11-.../deferred-items.md` as a pre-existing structural bug to be fixed in a dedicated phase (recommend: a small "trace-log hygiene" follow-up, not a Phase 12 scope item).

Phase 11 is a **contributing accelerant** (TAX lines fill the buffer ~15–20% faster), but the prompt would exceed 20k tokens on any 3+ iteration run **without Phase 11 as well** if the user ever hit a 20k-window local model. This is a latent defect, not a Phase 11 regression.

---

## 3. Biggest-wins fix direction

Recommend in priority order. None should be done as part of Phase 11 scope; document here for the follow-up phase.

### Fix A — Restore `appendTrace` to an **intra-iteration** buffer, clear between iterations (≈12,000-token savings)

**Change:** Either (a) restore the original `.set(sessionId, logLines.join('\n'))` semantics at `simulationRunner.ts:1454` and stop calling `appendTrace` from banking/capmkt/fiscal/inflation/tax sites into the same key; or (b) add a `resetTrace(sessionId)` at the top of each iteration and keep `appendTrace` as-is for within-iteration accumulation.

**Rationale:** The prompt comment and variable name both claim "last iteration." Matching the contract drops the cap to a single-iteration's ~20 KB worth of trace, which tail-slices itself meaningfully (banking, capmkt, fiscal all emit meaningful signal) rather than an arbitrary 50 KB window across N iterations of mixed-era noise.

**Estimated savings:** 50 KB → 20 KB → ~**7,500 tokens freed**. Prompt drops from ~13,800 → ~6,300 tokens. Safe headroom on any 8k-window model.

Option (b) is the lower-risk patch — it preserves today's intra-iteration accumulation semantics for subsystems and only adds a `sessionLastPhysicsTraces.set(sessionId, '')` at iteration entry (near `simulationRunner.ts:976` where `prevPhysicsLog` is read — capture, then clear).

### Fix B — Hard-cap `physicsLogSnippet` at the prompt boundary (≈8,000-token savings, defense-in-depth)

**Change:** At `central-agent.ts:458`, slice the physicsLog before embedding:

```ts
const physicsLogSnippet = physicsLog
  ? `\n[PHYSICS LOG — exact mechanical outcomes last iteration]\n...\n${physicsLog.slice(-8000)}\n` : '';
```

**Rationale:** Every other user-controlled field in this prompt has a length cap (`law.slice(0,400)`, `previousSummary.slice(0,400)`, `allIntentsBrief.slice(0,800)`). The physics log is the one outlier. An 8 KB slice (~2,000 tokens) is more than enough for narrative grounding — the LLM only needs recent mechanical outcomes, not 50 KB of tax-line noise.

**Estimated savings:** 50 KB → 8 KB → ~**10,500 tokens freed**. Stacks with Fix A as belt-and-suspenders.

### Fix C — Drop the 8 new `[TAX]` trace sites from the physics log (≈1,000-token savings)

**Change:** Remove `appendTrace(sessionId, '[TAX] Withheld ...')` at the 8 sites added by 11-04 (`simulationRunner.ts:1364, :1494, :1516, :1536, :1594, :1648, :2478, and the one in fiscal`). Tax withholding is a mechanical ledger event, not narrative-relevant. If trace-level visibility is needed for debugging, log to console/debug file instead.

**Rationale:** TAX lines are high-frequency (one per withholding event, many per iteration) and low narrative signal (the LLM doesn't need to know the exact withheld amount per agent — it's summarized in `sessionIterationMetrics` already).

**Estimated savings:** ~**1,000 tokens freed**. Small on its own; recommended as cleanup alongside A or B.

---

## 4. Acceptance criterion

After fix, a `groupResolution` prompt in a **5-iteration, 30-agent US bootstrap** session (HMAS Map-Reduce active, 15-agent clusters) must satisfy:

- **Total prompt tokens ≤ 8,000** (measured: char count of full composed messages / 4).
- **`physicsLog` component ≤ 2,000 tokens** (8 KB char cap, enforced at prompt-assembly or at `appendTrace` storage).
- **No growth in steady state** — iteration 5 prompt size must be within 10% of iteration 2 prompt size for the same session. (Today: iter 2 ≈ iter 5 ≈ 13,800 tokens because the cap is saturated — this is coincidentally stable, but at the wrong stable point.)

**Regression test:** add a harness that composes `buildGroupResolutionMessages` for a fixture 30-agent session after 5 iterations of trace accumulation and asserts `JSON.stringify(messages).length < 32_000` (≈8,000 tokens).

**Headroom proof:** with a 20k-context model and 4,000 tokens of output reservation, an 8,000-token input leaves 8,000 tokens of working memory for the provider — comfortable margin.

---

## Appendix — git citations

| Claim | Commit | File:line |
|---|---|---|
| `set → appendTrace` regression | `fdcd6ce` "refactor: Phase 5+6 — lifecycle controller + phase module scaffolding" | `simulationState.ts:74-78` (helper intro); `simulationRunner.ts:1454` (call site change) |
| Pre-regression overwrite behavior | `fdcd6ce~1` | `simulationRunner.ts:1386` |
| Phase 11 doubled `appendTrace` site count (7 → 15) | `11255a8` + `3362055` (11-04 withholding) | `simulationRunner.ts:1364, :1494, :1516, :1536, :1594, :1648, :2478` |
| `groupResolution` prompt builder unchanged by Phase 11 | last edit `cd45f0c` (pre-11) | `central-agent.ts:401-477` |
| Law prompt widened (11-05) — **not** `groupResolution` | `bb3722b` | `central-agent.ts:127-200` |
| Governance prompt widened (11-06) — **not** `groupResolution` | `e05e8d7` | `prompts/governance.ts` |
| TelemetryLog sfcDrift fields — **not stringified into prompts** | `727e464` (11-07) | `simulationRunner.ts:2947-2955` (write-only to `iterTelemetry`) |
