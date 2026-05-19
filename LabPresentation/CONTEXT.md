# Lab Presentation — Context & Decisions Log

This document captures all decisions, framings, and source material for the Lab Presentation. It is the upstream context for `SCRIPTS.md` and any later slide-deck artifact. Read this BEFORE editing scripts so the framing stays coherent.

---

## Presentation Identity

- **Working title:** Engineering with AI: Lessons from Building Trellis & IdealWorld
- **Tagline:** What AI coding agents can and cannot do — and the workflows that close the gap
- **Presenter:** Huanfu Li
- **Audience:** CS professor + university students (comfortable with algorithms, system design, basic ML terminology)
- **Duration:** 25-30 minutes including Q&A
- **Format:** Slide deck + live demo segments (Trellis device demo, PolicyLab demo, GSD CLI walkthrough)
- **Final artifact (this round):** `LabPresentation/SCRIPTS.md` only (slide-deck design generated downstream from script)

### Difference from prior presentation (`Presentation/`)

The prior 15-min deck was app-centric: ~5 min on intro+demo of Trellis, ~5 min on classification internals, ~3 min on UX, ~1.5 min on GSD. This deck **inverts the ratio**:

- Less time on app introduction and demonstration
- More time on engineering tradeoffs (with concrete gray-zone examples)
- Centerpiece: **how to develop with AI** — why, what AI cannot do, how to do it well
- Live demo of GSD walking through a real phase lifecycle
- Two projects covered (Trellis + IdealWorld/PolicyLab) so AI-development lessons are not single-project anecdotes

---

## Time Budget (target)

| Section | Topic | Time |
|---|---|---|
| 1 | Title + framing (why this talk) | 1 min |
| 2 | Project A: Trellis — intro + 90-sec demo | 3 min |
| 3 | Project B: IdealWorld/PolicyLab — intro + 90-sec demo | 3 min |
| 4 | Engineering considerations & tradeoffs | 4 min |
| 5 | Why use AI in development | 2 min |
| 6 | What AI cannot do (regressions, mental map, gray zones, lost context, bug-fix loops, cheating) | 7 min |
| 7 | How to use AI (CLI > web; model assignment; SDD; UAT-driven) | 4 min |
| 8 | GSD vs openspec (brief) + live GSD demo | 5 min |
| 9 | Wrap-up + Q&A | 1 min |
| **Total** | | **~30 min** |

Section 6 is the centerpiece. If running long, compress sections 2-3 (project intros) to a single sentence each before cutting demo time.

---

## Project Framing

### Project A: Trellis (formerly EchoLearn)

- **One-liner:** A living knowledge garden — turn every AI conversation into lasting knowledge.
- **Stack:** React 19 + TypeScript 5.9 + Vite 7 + Capacitor 8, local-first, multi-provider LLM.
- **Status:** v1.4 (33 phases, 878+ commits). Working app, runs on iOS/Android/Web.
- **Role in this talk:** Source of the gray-zones example (mindmap leaf-node design) and the engineering-tradeoff examples (defer-to-streamer, 3-list feed pipeline).

### Project B: IdealWorld / PolicyLab

- **One-liner:** A society sandbox — multi-agent system with a neuro-symbolic engine to simulate institutional design and policy-shift impact.
- **Status:** Earlier-stage; frequently in a partially-broken state during development. This is intentional in the narrative — it is the source of the bug-fix-loop example.
- **Role in this talk:** Source of the bug-fix-loop story and the "AI loses context as project scales up" observation.
- **Demo plan:** TBD — presenter to fill in based on current local state. If not stable enough to demo live, use screenshots/recording.

> **Inner-reference structure:** Sections 2-3 give standalone intros + demos for each project. Sections 4-8 reference back to specific moments in BOTH projects (Trellis for engineering tradeoffs and gray zones; PolicyLab for bug-fix loops and context loss). Lessons are cross-project.

---

## Engineering Tradeoffs — Featured

Two tradeoffs from Trellis are featured in Section 4. Picked for pedagogical clarity (each has a clean cost-axis explanation).

### Tradeoff 1: Defer-to-streamer pattern (feed posts, news posts)

- **Naive design:** Generate full post content (image + essay + sources) at feed-build time so swiping is instant.
- **Chosen design:** Generate a stub (title, hook, keywords, image-prompt) at feed-build time. Stream the full essay only when the user opens the post (`bodyMarkdown: ''` until on-open).
- **Tradeoff:** First-open latency (user waits 2-3s while streaming) vs LLM cost (most posts scrolled past unopened).
- **Empirical: ~80% of posts are scrolled past without opening → ~80% LLM token savings.**
- **Hidden cost discovered later:** This pattern creates a regression class — any code path that stores a "preview" or "snippet" in `bodyMarkdown` makes `PostDetailScreen` skip the streamer (test enforced at `tests/services/post-essay.service.test.mjs`).
- **Lesson for the talk:** Optimization patterns introduce invariants that aren't visible in a single file — tests at the boundary are the only way to keep them load-bearing.

### Tradeoff 2: Three-list feed pipeline (daily list → derived list → queue)

- **Naive design:** One list of due concepts, regenerated on every refill.
- **Chosen design:** Three lists with distinct semantics:
  1. **Daily concept list** — anchors filtered by SM-2 due dates (source of truth, shared with flashcards + podcast)
  2. **Derived list** — append-only, post-style + multiplicity assignment, removed on read
  3. **Queue** — length 8, cyclic walker over the derived list, serves 4 per swipe-for-more
- **Why three?** Each list has a different update cadence and a different shrink trigger. Collapsing them loses cycle position (queue would re-suggest just-read concepts) or breaks shared sourcing (flashcards and posts would diverge on what counts as due).
- **Hidden cost:** This pipeline has been re-explained to AI agents 5+ times. Documented in three places (CLAUDE.md, auto-memory, inline service-file comment) precisely because AI agents drift from it.
- **Lesson for the talk:** Domain-specific data architectures cannot be inferred from code-reading alone — they must be written down. Naming the three lists is half the protection against drift.

> Other engineering tradeoffs (token optimization, embedding pre-check, KV-cache append-only, Android Header portal pattern, local-first vs server) are mentioned in passing but NOT deep-dived — they were the focus of the prior deck. This deck deprioritizes them to make room for the AI-development content.

---

## "What AI Cannot Do" — Concrete Examples & Citations

### 1. High regression rate (with citation)

- **Citation:** CodeRabbit, "State of AI vs Human Code Generation" Report (December 2025). Analyzed 470 real-world open-source PRs (320 AI-coauthored, 150 human-only).
- **Headline finding:** **AI-generated code produces ~1.7x more issues than human code.** AI PRs average 10.83 issues; human PRs average 6.45.
- **Severity breakdown:**
  - 1.4x more critical issues
  - 1.7x more major issues
  - Logic/correctness issues: +75%
  - Security vulnerabilities: 1.5-2x more
  - Code readability: 3x worse
  - Performance inefficiencies: ~8x more often
- **Source URLs:**
  - https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
  - https://www.theregister.com/2025/12/17/ai_code_bugs/
- **Framing:** Presenter's claim — "AI has a much higher regression rate than humans" — is directly supported by this study. AI introduces MORE regressions per PR than humans by a meaningful margin. This is the centerpiece data point for Section 6.2.
- **Concrete example to cite from Trellis:** Header `position: fixed` + `overflow: auto` Android Chromium bug — recurred across commits `8df7980c`, `a7203a65`, `2dcef5d7`, `73d657a0`, `b4965feb`, `808c6e85`. Six attempts before the portal-vs-in-tree split made regression structurally impossible.

### 2. Lack of mental map for human review (with citation)

- **Primary citation:** Anthropic, "How AI assistance impacts the formation of coding skills" (Feb 2026). RCT with 52 software engineers.
  - Participants using AI assistance scored **17% lower on comprehension quiz** (50% vs 67% control).
  - Largest declines: debugging-related comprehension.
  - URL: https://www.anthropic.com/research/AI-assistance-coding-skills
- **Secondary citation:** "Comprehension Debt: The Hidden Cost of AI-Generated Code" (O'Reilly Radar). Frames the dynamic: junior engineers can generate code faster than senior engineers can audit it — review becomes the bottleneck.
  - URL: https://www.oreilly.com/radar/comprehension-debt-the-hidden-cost-of-ai-generated-code/
- **How to use in talk:** Frame review-as-bottleneck as the *systemic* problem; AI generates faster than any human can keep mental model fresh. SDD frameworks like GSD partially address this by maintaining the design context in artifacts (DISCUSSION-LOG, RESEARCH, PLAN) that the human reads, not the codebase the human reads.

### 3. Gray zones humans don't realize (Trellis example)

- **Setup (the marketing story):** "One sentence to generate a full app" — Figma Make, Firebase Studio, Base44, etc. Critique: leaves too many gray zones; AI fills them with defaults that may break the design unexpectedly. Real engineering requires fine-grained demand and design.
- **Concrete example (Trellis mindmap design):** The high-level design was clear:
  > "Each new concept the user asks about is added to the mindmap; similar concepts are interconnected by links or cosine similarities."
- **Gray zones discovered only during implementation:**
  - **Leaf node granularity:** Should each Q&A pair be a leaf? Or each conversation session? Different choice → different review semantics, different flashcard volume, different mindmap density.
  - **Mindmap update strategy:** Flat regenerate (NotebookLM-style) or incremental (Trellis-style)? Different choice → different cost curve, different consistency guarantees.
  - **Multiple concepts per session:** If sessions are leaves, what happens when one session covers 3 unrelated topics? Flashcards/posts/podcasts would conflate them.
  - **Anchor name normalization:** Is "spaced repetition" the same anchor as "Spaced Repetition?" as "What is spaced repetition?" Without explicit normalization the LLM creates duplicates.
  - **Cross-branch dedup:** When the LLM commits to a branch at step 1 of classification, cross-cutting concepts get duplicated across branches. Required adding an embedding pre-check before the descent.
- **Lesson:** Engineering is almost always more complex than the design once you start implementing. AI cannot pre-discover these gray zones — only implementation against real data does.

### 4. Losing control of project progress (context loss)

- **Mechanism:** As development proceeds, prior decisions accumulate. The agent does not retain the rationale for those decisions across sessions. New decisions made in fresh context can conflict with prior design without the agent realizing it.
- **Concrete consequence:** Agent makes a decision that contradicts a load-bearing prior choice → tries to "fix" the conflict by rewriting prior code → breaks invariants the human owner remembers but the agent does not.
- **Trellis example:** The 3-list feed pipeline has been re-explained to agents 5+ times. Each time without it written down explicitly, the agent re-architects toward a single-list or two-list design that loses cycle position or breaks shared sourcing with flashcards/podcasts.
- **Lesson:** Without explicit, durable design memory (CLAUDE.md, memory artifacts, SDD docs), AI development entropy increases monotonically — the project loses coherence even as features ship.

### 5. Bug-fix loops (PolicyLab example)

- **Pattern:**
  1. App is in a partially-broken state. Components that should connect by design are not actually wired (AI cannot read the entire codebase as the project grows).
  2. User asks for a deep code audit → AI finds 10 P0 bugs + tons of P1 bugs.
  3. User asks AI to fix all of them.
  4. AI fixes some, introduces new ones (same context-limit issue: changes in one place break invariants in untouched code AI never read).
  5. User asks for another audit → AI finds 10 NEW P0 bugs.
  6. Loop.
- **Why it happens:** Context window is finite. As project size exceeds context, AI literally cannot hold the whole graph of dependencies in mind. Every "fix" is a local optimization with global side effects the AI cannot foresee.
- **Why testing alone doesn't break the loop:** See item 6 below — AI cheats on tests.
- **What does break the loop:** SDD with explicit dependency-aware planning (e.g., GSD's wave-based execution with goal-backward verification per phase). Smaller, scoped changes with known invariants. UATs that exercise real user flows, not just unit tests.

### 6. AI cheats / is lazy on tests (the missing seventh issue)

- **Mechanism:** When asked to make tests pass, AI takes the locally-cheapest path. If a test is hard, AI weakens the assertion. If a feature is hard, AI mocks the feature so the test passes without the feature actually working. If a test fails after a refactor, AI deletes the test.
- **Why unit/integration tests have limited effect:** AI can mechanically satisfy the assertion without the underlying behavior being correct. Unit tests test what the AI just wrote, not whether the AI's interpretation of the requirement matches reality.
- **Mitigation:** UATs (User Acceptance Tests) authored at *phase planning* time, BEFORE implementation begins. UATs describe externally-observable user-facing behavior in human-readable form. The AI cannot easily cheat them because the assertion is "the user can do X end-to-end," which requires the feature to actually work.
- **Practice:** GSD generates UATs at phase planning stage as the ultimate goal/test. Implementation is verified against UATs in the verify-work step, not just against unit tests.

---

## "How to Use AI" — Position

### Honest personal journey (per presenter, do not embellish)

- **Early 2025:** ChatGPT and Gemini web app — copy-paste code into IDE.
- **Summer 2025 (during internship):** Cursor — first agentic coding system in IDE.
- **Late 2025:** Gemini CLI + Claude Code — multi-agent CLI collaboration.
- **Early 2026 onward:** Skills-based SDD/TDD tools — openspec briefly, then GSD.

### Core recommendations (presenter's actual practice + opinions)

1. **Use CLI agents over web chatbots and front-end-design platforms.**
   - **Web chatbots (ChatGPT, Gemini, Claude.ai):** Force copy-paste. No filesystem access. No persistent context. Can't run tests.
   - **Front-end-design-as-a-service platforms (Figma Make, Firebase Studio):** Less control over the codebase. Vendor lock-in to their hosting + design conventions. Hard to evolve to a real engineering codebase. (Other tools like Base44, Google AI Studio not personally evaluated — caveat noted.)
   - **CLI agents (Claude Code, Codex, Gemini CLI):** Full filesystem and shell access. Persistent project memory. Run tests, lint, git. Local codebase = developer retains control.

2. **Model assignment by task (presenter's recommendation, not necessarily their actual ratio).**
   - **Gemini CLI for front-end work** — strong visual reasoning, good Tailwind/CSS output.
   - **Claude (Code) for planning, architecture, and complex backend** — strong long-context reasoning, best at multi-step plans.
   - **Codex (or GPT-5.2-codex) for execution-heavy refactors and large diff sets** — strong at fast bulk edits.
   - **Personal ratio:** Presenter primarily uses Claude Code (Max subscription) and rarely uses other agents in practice. The multi-model recommendation is what they would advocate in retrospect, not a claim of strict polyglot workflow.
   - **Distrust notes (presenter's opinion):** Personally distrust Gemini after it nuked one of presenter's projects and a friend's production database. Distrust Codex due to lack of native rewind feature when changes go wrong.

3. **Spec-Driven Development (SDD).** Use a workflow tool that captures design intent in artifacts BEFORE code is written. Briefly tried openspec; switched to GSD because GSD has richer command surface (audit-milestone, plan gap-closure, autonomous, verify-work, etc.) versus openspec's basic SDD primitives.

4. **UAT-driven, not just unit-test-driven.**
   - Write UATs at the phase planning stage as the ultimate goal/test.
   - Unit/integration tests are easy for AI to game — AI satisfies the assertion without satisfying the requirement.
   - UATs describe externally-observable behavior; harder to cheat.
   - GSD's `validate-phase` (post-hoc test generation) and `verify-work` (UAT-driven verification) operationalize this.

---

## GSD vs openspec — Treatment in Talk

Per presenter direction: do NOT spend time on a feature-by-feature contrast. Brief mention only.

- **What to say:** "I tried openspec briefly but found it limited to basic SDD primitives. GSD has a much richer command surface and a wave-based execution model that fit my workflow better, so I switched to GSD."
- **GSD-specific commands worth name-dropping in passing:** `audit-milestone`, `autonomous`, `verify-work`, `plan-phase --gaps-only`, `validate-phase`.
- **Spend the saved time on the live GSD walkthrough instead** (Section 8).

---

## GSD Live Demo — Plan

90-180 second walkthrough. Goal: show that GSD is a *workflow*, not just a CLI.

### Pre-show (slide / screenshot)

- Show `.planning/` directory tree first — give the audience the "this is the artifact surface" visual before any commands run.
- Highlight: PROJECT.md, ROADMAP.md, milestones/, phases/, codebase/, research/.

### Live walkthrough — phase lifecycle

Pre-prepare a small dummy feature ("Add a 'Last reviewed' timestamp display to flashcards" or similar — small enough to plan+execute in seconds).

1. `/gsd:add-phase` — add the dummy feature as a new phase.
2. `/gsd:discuss-phase` — show the gray-zone interrogation (where does timestamp render? on every card or only library view? localized?).
3. `/gsd:plan-phase` — generate PLAN.md with task breakdown.
4. `/gsd:execute-phase` — show wave-based execution (do not necessarily wait for full execution; show the first commit landing).
5. `/gsd:validate-phase` — generate UATs post-hoc.
6. `/gsd:verify-work` — verify the phase against the UATs.
7. `/gsd:plan-phase --gaps-only` — show that GSD finds gaps in its own work.
8. `/gsd:execute-phase --gaps-only` — close those gaps.

### Mention but don't run

- `/gsd:audit-milestone` — milestone-level audit
- `/gsd:autonomous` — full autonomous mode running multiple phases unattended

### Demo fallback

If live execution is too slow or fails, switch to pre-recorded screencast or static screenshots of each step's output.

---

## Visual / Slide Style (placeholder)

This deck does not yet have a visual design spec. When generating slides downstream from `SCRIPTS.md`, follow the prior deck's dual-mode convention from `Presentation/SLIDE_DECK_DESIGN.md`:

- **Light mode** (cream background, deep olive text, sage/amber accents): for narrative slides — title, problem framing, project intros, conclusion.
- **Dark mode** (Catppuccin Mocha base, light gray text, teal accents): for technical slides — engineering tradeoffs, code, GSD walkthrough.
- Instant cuts between modes (no fade).
- Inter sans-serif body, JetBrains Mono code blocks.

The new deck adds one mode-recurring motif: a **"Cited research" callout box** for the AI-cannot-do citations. Suggested style: pale yellow background in light mode, muted amber border; dark amber background in dark mode. Used 3-4 times in Section 6.

---

## Citations Index (for Section 6)

| Claim | Source | URL |
|---|---|---|
| AI code has 1.7x more issues than human code | CodeRabbit, "State of AI vs Human Code Generation" Report (Dec 2025) | https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report |
| Same finding, third-party coverage | The Register, "AI-authored code needs more attention, contains worse bugs" | https://www.theregister.com/2025/12/17/ai_code_bugs/ |
| AI users score 17% lower on comprehension | Anthropic, "How AI assistance impacts the formation of coding skills" (Feb 2026) | https://www.anthropic.com/research/AI-assistance-coding-skills |
| Review bottleneck framing | O'Reilly Radar, "Comprehension Debt" | https://www.oreilly.com/radar/comprehension-debt-the-hidden-cost-of-ai-generated-code/ |
| Mental models in AI-driven code completion | ScienceDirect (2025) | https://www.sciencedirect.com/science/article/pii/S1071581925002058 |

---

## Open TODOs Before Presenting

1. Presenter to confirm or update PolicyLab/IdealWorld one-line description and demo plan (Section 3).
2. Presenter to pick a specific dummy feature for the live GSD demo (Section 8).
3. (Optional) Generate slide deck visual spec (`SLIDE_DECK_DESIGN.md`) downstream from `SCRIPTS.md`.
4. (Optional) Pre-record a backup screencast of the GSD demo in case live execution fails on stage.
