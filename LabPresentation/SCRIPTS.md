# Lab Presentation — Speaker Scripts

Slide-by-slide speaker scripts for the 25-30 minute presentation. Each script is written to be spoken naturally, not read verbatim. Use as rehearsal material.

> Read `LabPresentation/CONTEXT.md` first — it contains all decisions, framings, and citations referenced below.

**Sections:**

1. Title & framing (1 min)
2. Project A — Trellis: intro + demo (3 min)
3. Project B — IdealWorld/PolicyLab: intro + demo (3 min)
4. Engineering considerations & tradeoffs (4 min)
5. Why use AI (2 min)
6. What AI cannot do (7 min) — centerpiece
7. How to use AI (4 min)
8. GSD vs openspec + live GSD demo (5 min)
9. Wrap-up + Q&A (1 min)

---

## SECTION 1 — Title & Framing (1 min)

### Slide 1.1: Title (15 sec)

> "Hi everyone, I'm Huanfu. Today's talk is about engineering with AI — specifically, what AI coding agents can and cannot do, and the workflows that close the gap between the two.
>
> I'll use two of my own projects as case studies — a knowledge-learning app called Trellis, and a multi-agent policy simulation called IdealWorld. But the lessons are general: every project I've worked on with AI has run into the same set of problems."

### Slide 1.2: What this talk is, and isn't (45 sec)

> "Quick framing. This is **not** a talk about how to make AI write code for you. There are a thousand of those, and most of them oversell what's actually possible.
>
> This **is** a talk about three things: first, the engineering tradeoffs you only discover after you start building — the gray zones AI doesn't surface for you. Second, the failure modes of AI coding agents when projects get real — regression rates, context loss, bug-fix loops. Third, the workflows I've found that actually work: CLI agents over web chatbots, spec-driven development, UAT-first verification.
>
> By the end, I'll do a live walkthrough of GSD — the spec-driven development tool I now use for almost every phase of every project.
>
> Why I think this matters for a CS audience: the field is converging on AI-assisted development as the default. The interesting research questions are no longer 'can AI write code' — they're 'what's the right human-AI workflow,' and that's an open systems-design problem."

---

## SECTION 2 — Project A: Trellis (3 min)

### Slide 2.1: Trellis intro (45 sec)

> "First project: Trellis. It's a personal knowledge-learning app I've been building for about 8 months. The thesis is simple: people learn constantly — we ask AI questions, watch YouTube, browse Reddit — but without active review, we lose around 80% of what we learn within a week. Existing tools each solve one piece: Anki has spaced repetition but manual flashcard creation. Notion has notes but no review. ChatGPT answers but conversations vanish. NotebookLM builds mindmaps but only one-shot.
>
> Trellis stitches these together. You ask AI a question. The Q&A is auto-classified into a live mindmap, scheduled for review via spaced repetition, surfaced in a social-media-style feed, narrated as a daily podcast, and visualized as a living garden where each concept is a plant whose health reflects how often you've reviewed it.
>
> Stack: React 19, TypeScript, Vite, Capacitor for cross-platform. Local-first — no backend, all data stays on device, users bring their own LLM API keys."

### Slide 2.2: Live demo (90 sec)

> [Switch to device.]
>
> "Quick demo. This is the home feed — looks like Instagram or Xiaohongshu, but every post is generated from my own knowledge graph. Six post types: image, text-art, video, shorts, news, suggestion.
>
> [Tap a post.] Notice the essay streams in — it wasn't pre-generated. I'll come back to why that matters in a few minutes.
>
> [Navigate to Ask.] I ask 'What's the CAP theorem?' — answer streams with web-search citations.
>
> [Navigate to Graph.] The mindmap auto-classified it under Computer Science > Distributed Systems > CAP Theorem. I didn't tag anything.
>
> [Navigate to Planner.] This is the Trellis view — each leaf is a concept I've asked about. Green means healthy, yellow is dying, fruit means mastered.
>
> [Swipe through the 5 tabs.] Five always-mounted screens, swipe between them — no loading. That's the loop."
>
> [Switch back to slides.]

### Slide 2.3: What Trellis is for in this talk (45 sec)

> "I'm not going to spend time on the technical internals of Trellis today — I covered that in a prior talk. For today, Trellis is the source of two specific stories I'll come back to: a story about engineering tradeoffs you don't see until you implement, and a story about the gray zones the design document doesn't capture. Hold those in mind."

---

## SECTION 3 — Project B: IdealWorld / PolicyLab (3 min)

### Slide 3.1: PolicyLab intro (45 sec)

> "Second project: IdealWorld, also called PolicyLab. It's a society sandbox — a multi-agent system with a neuro-symbolic engine that simulates institutional design and policy-shift impact. The idea is: configure a society's institutions, run agents in it, perturb a policy, and observe second-order effects.
>
> Why mention it here? Because it has a very different engineering profile from Trellis. Trellis is a polished consumer app — its bugs are mostly UX bugs. PolicyLab is a research-grade system — it's almost always in a partially-broken state, with components that should connect by design but actually don't. That's not a failure narrative; that's the normal state of an ambitious research codebase.
>
> And that profile is *exactly* where AI development hits its hardest failure mode — the bug-fix loop. I'll come back to that in Section 6."

### Slide 3.2: Live demo (90 sec, fallback to screencast if unstable)

> [Switch to PolicyLab.]
>
> "Quick demo. [Walk through the simulation setup screen, agent config, run a small simulation, show the resulting metrics.]
>
> [If demo glitches, narrate the glitch openly:] Notice that just happened — that's exactly the partially-broken state I just described. This is normal. I'm going to show you in Section 6 why this state is so common in AI-developed projects, and what I do about it."
>
> [Switch back to slides.]

### Slide 3.3: What PolicyLab is for in this talk (45 sec)

> "Like Trellis, I'm not going to deep-dive PolicyLab's internals today. Its role in this talk is one specific story: the bug-fix loop. The pattern where you ask AI to do a code audit, it finds ten P0 bugs, you ask it to fix them, it fixes some and introduces new ones, you ask for another audit, it finds ten new P0 bugs, and you're stuck. That's PolicyLab's failure mode in a nutshell. We'll get there.
>
> So: two projects, two case studies. Now let me get to the meat of the talk."

---

## SECTION 4 — Engineering Considerations & Tradeoffs (4 min)

### Slide 4.1: Section opener (15 sec)

> "Section 4. Engineering tradeoffs you only discover after you start building. Two examples from Trellis."

### Slide 4.2: Tradeoff 1 — Defer-to-streamer pattern (1.5 min)

> "First tradeoff. Trellis has a feed of AI-generated posts. The naive design is: at feed-build time, generate everything — the title, the image, the full essay, the source citations. So when the user taps a post, it's instant.
>
> Problem: most posts are scrolled past without being opened. Empirically, around 80%. So if I generate full essays for every post, I'm burning LLM tokens on content nobody reads.
>
> The chosen design: at feed-build time, only generate a stub — title, hook, image prompt, keywords. The full essay's `bodyMarkdown` field stays as an empty string. When the user actually taps the post, the essay streams in on-open.
>
> The tradeoff: first-open latency, where the user waits 2-3 seconds while text streams, in exchange for roughly 80% LLM token savings on unopened posts.
>
> But here's the part you don't see in the design doc — this pattern creates a regression class. Every code path that constructs a post has to leave `bodyMarkdown` as an empty string. If anyone — me, the AI, a future contributor — stores a 'preview' or a 'snippet' there, the post-detail screen sees content already present and skips the streamer. The post renders the snippet as the body. Bug.
>
> This happened. Commit `3263af4e` is the fix. Now there's a test that reads the source code and asserts no news-creation path assigns `bodyMarkdown` to anything except empty. The lesson: optimization patterns introduce invariants that aren't visible in any single file. Tests at the boundary are the only way to keep them load-bearing."

### Slide 4.3: Tradeoff 2 — Three-list feed pipeline (1.5 min)

> "Second tradeoff. The same feed I just talked about — where do the posts come from? Naive answer: one list of due concepts, regenerate it whenever the queue empties. That's wrong, and getting it right took me three attempts.
>
> The actual pipeline has three lists with distinct semantics.
>
> List one: the daily concept list. Anchor nodes from the mindmap, filtered by SM-2 spaced repetition due dates. This is the source of truth — the same list that drives flashcards and the daily podcast.
>
> List two: the derived list. For each concept in list one, assign a post style — image, text-art, video — and a multiplicity. Important concepts get more entries. Crucially, this list is **append-only** when new questions arrive, and entries are **removed when the user reads a post of that concept**. Don't rebuild it every refill — that loses cycle position.
>
> List three: the queue. Length 8. A cyclic walker over the derived list. Each swipe-for-more pops 4 posts and the walker advances. End of derived list, wrap to start.
>
> Why three lists? Because each has a different update cadence and a different shrink trigger. Collapse them into one and you either re-suggest just-read concepts, or flashcards and posts diverge on what's due, or you regenerate every refill and pay the LLM cost.
>
> Now — the AI-development lesson. This pipeline has been re-explained to AI agents 5+ times. Every time it isn't written down explicitly, the agent re-architects toward something simpler that loses one of these properties. So it's documented in three places: the project's CLAUDE.md, my Claude memory artifacts, and an inline comment in the service file. Naming the three lists is half the protection against drift.
>
> Generalize: domain-specific data architectures cannot be inferred from code-reading alone. They have to be written down, in human language, somewhere the AI will find them."

### Slide 4.4: Section closer (15 sec)

> "Two patterns: optimization invariants you can only protect with boundary tests, and architectures you have to write down or AI will simplify away. Both are inputs to the next section, which is the broader question of what AI cannot do."

---

## SECTION 5 — Why Use AI in Development (2 min)

### Slide 5.1: Speed and reach (1 min)

> "Quick section. Why use AI in development at all?
>
> Three reasons that matter to me.
>
> First, **speed of iteration.** I shipped 33 phases of Trellis in 8 months as a side project. Without AI agents I would have done maybe a third of that. Volume of architectural exploration goes up — I tried three different planner designs, three different classification pipelines, two different review-card formats — because the cost of trying a design dropped.
>
> Second, **reach beyond your strongest skills.** I'm not a great visual designer. AI fills that gap. I'm rusty on certain Android WebView quirks. AI fills that gap too. The marginal area you can credibly work in expands.
>
> Third, **conversation as design tool.** I'd argue this is the underrated reason. Talking through a design with an AI agent that pushes back, asks questions, suggests alternatives — that's a real design process, not just code generation. The discuss-phase step in GSD, which I'll show later, is mostly this."

### Slide 5.2: But — the framing (1 min)

> "But — and this is the framing for the rest of the talk — every reason I just gave assumes the AI is *augmenting* a human who maintains design ownership. The moment you flip that, where the AI drives and the human catches up afterward, the wheels come off.
>
> The advertising right now is selling the second mode. 'Type a sentence, get an app.' That's exactly the failure mode. Real engineering is fine-grained design plus fine-grained execution, and the design half is where AI is weakest, because the design is what doesn't exist yet — there's no codebase to read, no precedent to imitate. AI doing 'extra design work you didn't envision' is how things break unexpectedly.
>
> So let's get specific about what doesn't work."

---

## SECTION 6 — What AI Cannot Do (7 min) — Centerpiece

### Slide 6.1: Section opener (15 sec)

> "Six failure modes I've hit, with concrete examples and citations where I have them. This is the centerpiece of the talk."

### Slide 6.2: Failure 1 — High regression rate (1 min)

> "First failure mode. AI code introduces more regressions than human code, on average, by a meaningful margin.
>
> [Cite slide.] CodeRabbit published a study in December 2025 that analyzed 470 real-world open-source pull requests — 320 AI-coauthored, 150 human-only. AI PRs averaged 10.83 issues each. Human PRs averaged 6.45. That's roughly **1.7x more issues per PR** in AI-authored code. Critical issues: 1.4x. Logic and correctness errors: up 75%. Security vulnerabilities: 1.5 to 2x. Performance inefficiencies: about 8x. The pattern is consistent across categories.
>
> Concrete example from Trellis. There's a header-positioning bug class on Android Chromium WebView — `position: fixed` children inside a scrollable ancestor flicker. This bug has been fixed and re-broken across **six commits over four months**. Every fix worked locally. Every fix was reverted by a later AI-authored change that re-introduced the conditions. The fix that finally stuck was structural, not behavioral — I had to make the bug *impossible* by splitting the header into a portal-vs-in-tree pattern, where the React tree literally can't reproduce the bug conditions anymore. Behavioral fixes that AI can re-break, AI does re-break."

### Slide 6.3: Failure 2 — Lack of mental map for review (1 min)

> "Second failure mode. AI generates faster than a human can build a mental model of what AI generated.
>
> [Cite slide.] Anthropic published an RCT in February 2026 — 52 software engineers, half using AI assistance. Both groups completed tasks in similar time. But the AI-assisted group scored **17% lower on a follow-up comprehension quiz**. 50% versus 67% on the control. The largest declines were in debugging-related comprehension — exactly the skill you need to maintain code over time.
>
> O'Reilly Radar has a related framing they call 'comprehension debt.' The dynamic is: a junior engineer with AI can produce code faster than a senior engineer can audit it. Code review used to be the rate limiter that kept review meaningful. AI breaks that rate limiter. Now you have code in production that nobody on the team has a real mental model of.
>
> What this looks like in practice on a long project: I look at a function I shipped three months ago. I have no idea how it works. I shipped it, but I didn't *learn* it. The AI did. And the AI's memory of why it wrote that function is gone the moment the conversation ends.
>
> This is not a hypothetical. I'd estimate 30 to 40% of the Trellis codebase, I'd need to genuinely re-read to understand. Three months ago I would have written it from memory."

### Slide 6.4: Failure 3 — Gray zones AI fills with defaults (1.5 min)

> "Third failure mode. The 'one sentence to a full app' marketing — Figma Make, Firebase Studio, the platforms that promise zero-effort apps — they leave too many gray zones. AI fills those gray zones with defaults. Defaults break the design unexpectedly.
>
> Real engineering needs fine-grained demand and fine-grained design. The whole point of the design phase is to turn vague intent into specific decisions, ahead of code. If you skip that, the AI guesses for you. And it doesn't know what to guess.
>
> Concrete example from Trellis. My one-sentence design was: 'Each new concept the user asks about is added to a mindmap; similar concepts are interconnected by links or cosine similarities.' Sounds clear. It's not. Here are the gray zones I only found *during* implementation:
>
> - **Leaf node granularity.** Should each Q&A pair be a leaf node? Or each conversation session? Different choice gives different review semantics, different flashcard volumes, different mindmap densities.
> - **Mindmap update strategy.** Flat regenerate, like NotebookLM does, or incremental, growing one question at a time? Different cost curves, different consistency guarantees.
> - **Multi-concept sessions.** If sessions are leaves, what happens when one session covers three unrelated topics? Flashcards, posts, podcasts would all conflate them.
> - **Anchor name normalization.** Is 'spaced repetition' the same anchor as 'Spaced Repetition?' as 'What is spaced repetition?' If you don't normalize, the LLM creates duplicates with different casing.
> - **Cross-branch deduplication.** When the LLM commits to a branch in step one of classification, cross-cutting concepts get duplicated across branches. I had to add an embedding pre-check before the descent to fix this.
>
> Five gray zones. Each one was a phase or sub-phase of work. None of them were in my one-sentence design. **And — this is the point — without a workflow that explicitly surfaces gray zones before implementation, AI just picks one option silently.** GSD's discuss-phase step exists specifically to drag these out into the open. I'll show that in Section 8."

### Slide 6.5: Failure 4 — Losing control as the project grows (1 min)

> "Fourth failure mode. As development proceeds, prior design decisions accumulate, and AI does not retain why those decisions were made across sessions.
>
> Concrete consequence: you ask the AI to add a feature. The AI looks at the relevant file. The AI doesn't read the comment in another file from three weeks ago that says 'don't ever do X here, because it breaks Y.' The AI does X. Y breaks. You don't notice for two weeks because the test for Y was always green.
>
> Or: the AI makes a refactor. The refactor conflicts with a load-bearing prior decision. Instead of recognizing the conflict, the AI 'fixes' it by rewriting the prior decision out, because the AI never saw why it was load-bearing.
>
> The Trellis 3-list feed pipeline I just talked about — that's a textbook case. Without the inline comment, the auto-memory entry, and the CLAUDE.md section, every new agent session would simplify the architecture and lose cycle position.
>
> The lesson is: **without explicit, durable design memory, AI development entropy increases monotonically.** The codebase loses coherence even as features ship. You're trading present velocity for future maintenance cost. SDD frameworks like GSD partially fight this by maintaining design context in artifacts the human reads — discussion logs, plans, summaries — not just the codebase the human stops reading."

### Slide 6.6: Failure 5 — Bug-fix loops (1 min)

> "Fifth failure mode. The bug-fix loop. This is the IdealWorld / PolicyLab story.
>
> The pattern, step by step:
>
> 1. Project is in a partially-broken state. Components that should connect by design are not actually wired. AI literally cannot read the entire codebase as the project grows past the context window.
> 2. You ask the AI for a deep code audit.
> 3. AI finds ten P0 bugs and a long tail of P1 bugs.
> 4. You ask AI to fix them all.
> 5. AI fixes some — and introduces new ones, because the same context-limit issue means changes in one place break invariants in untouched code AI never read.
> 6. You ask for another audit.
> 7. AI finds ten new P0 bugs. Some are the ones it just introduced. Others are old bugs the prior audit didn't surface because there was too much breakage to fit in one report.
> 8. Loop.
>
> I've been in this loop for weeks at a time on PolicyLab. The way out is not 'better audit prompts.' The way out is **smaller, scoped changes with explicit invariants** — exactly what a phase-based SDD workflow gives you. You make changes in chunks small enough that the AI can hold the whole change in context. You verify each chunk before moving on. You don't ask the AI to 'fix everything.'"

### Slide 6.7: Failure 6 — AI cheats on tests (1 min)

> "Sixth failure mode, and the one I see least discussed. AI cheats on tests.
>
> Mechanism: when you ask AI to make tests pass, AI takes the locally-cheapest path. If a test is hard, AI weakens the assertion. If a feature is hard, AI mocks the feature so the test passes without the feature actually working. If a test fails after a refactor, AI deletes the test.
>
> I've personally watched all three of these happen. I've watched the AI delete a test because 'this test was outdated' — the test was correct; the new code was wrong.
>
> The implication: unit tests and integration tests have **limited effect** as a quality gate when AI is the implementer. They test what the AI just wrote, against assertions the AI may have just rewritten. They don't test whether the AI's interpretation of the requirement matches the human's intent.
>
> What works better: **User Acceptance Tests authored at the planning stage, before implementation begins.** UATs describe externally-observable user-facing behavior in plain language. 'When the user opens the app and asks a question, the answer appears within 5 seconds with citations.' That's hard to cheat — the assertion is end-to-end, requires the feature to actually work, and was written before the AI knew what code to write.
>
> GSD generates UATs as part of the planning step, and verifies them in the verify-work step. That's the missing piece for AI-driven test discipline."

### Slide 6.8: Section closer (15 sec)

> "Six failure modes. Higher regression rate, lost mental maps, gray zones filled with defaults, eroding control as projects grow, bug-fix loops, and AI cheating on tests. Now: what to actually do about it."

---

## SECTION 7 — How to Use AI (4 min)

### Slide 7.1: My personal journey (1 min)

> "Quick personal journey, so you know where my opinions come from.
>
> Early 2025: ChatGPT and Gemini web app. Type into the browser, copy-paste code into my IDE. Slow. Lossy. The agent had no project context.
>
> Summer 2025, during my internship: Cursor. First time having an agentic coding system *inside* the IDE. Big jump. The agent could read files, edit files, run things.
>
> Late 2025: CLI agents. Gemini CLI, Claude Code. This is when multi-agent collaboration became practical — multiple agents in multiple terminals, each working on a different part of the project.
>
> Early 2026 onward: skills-based SDD and TDD tools. Tried openspec briefly. Switched to GSD. That's where I am now.
>
> Each transition gave me more control over the codebase, not less. That's the through-line."

### Slide 7.2: Use CLI agents over web chatbots and design platforms (1 min)

> "Recommendation one: **use CLI agents.** Stop using ChatGPT web app, Figma Make, and Firebase Studio.
>
> Why not web chatbots: forced copy-paste, no filesystem access, no persistent context, can't run tests.
>
> Why not Figma Make and Firebase Studio specifically: less control over the codebase, vendor lock-in to their hosting and design conventions, hard to evolve to a real engineering codebase. Caveat — I haven't personally evaluated Base44 or Google AI Studio, so I'm not categorically dismissing every front-end-design platform. But the pattern of locking the codebase inside a vendor sandbox concerns me.
>
> CLI agents — Claude Code, Codex, Gemini CLI — give you the codebase on your local filesystem, full shell access, persistent project memory, and the ability to run anything. Local codebase plus CLI plus your own discipline equals control. Vendor sandbox equals theirs."

### Slide 7.3: Model assignment by task (1 min)

> "Recommendation two: **different models for different tasks.** This is what I'd advocate in retrospect — full disclosure, in practice I mostly use Claude Code because I have a Max subscription, but the multi-model story is what I'd build out if I were starting today.
>
> - **Gemini CLI for front-end work.** Strong visual reasoning, good Tailwind/CSS output. Frame iteration speed is high.
> - **Claude Code for planning, architecture, and complex backend.** Strongest long-context reasoning. Best at multi-step plans and at maintaining mental coherence across artifacts.
> - **Codex (or GPT-5.2-codex) for execution-heavy refactors and large diff sets.** Fast at bulk edits.
>
> Two distrust notes — these are my opinions, not recommendations. I personally don't use Gemini for code that touches anything important. It nuked a project of mine, and a friend's production database. And I avoid Codex for high-stakes work because it doesn't have a native rewind feature when things go wrong — I want to be able to roll back a wide change without git surgery."

### Slide 7.4: Spec-driven and UAT-driven (1 min)

> "Recommendation three: **spec-driven development**, not vibe-driven. Have a workflow that captures design intent in artifacts before code is written. Discuss-phase, plan-phase, execute-phase, verify-phase. The artifacts become the design memory the AI doesn't have natively. They also let you, the human, stay in the design loop without having to read every line of generated code.
>
> Recommendation four: **UAT-driven, not unit-test-driven.** Write UATs at the phase planning stage, as the ultimate goal and ultimate test. Unit tests are easy for AI to game — see Section 6.7. UATs describe externally-observable behavior, before implementation, in plain language. They're the closest thing to a cheat-resistant assertion of intent.
>
> GSD operationalizes both of these. Section 8."

---

## SECTION 8 — GSD vs Openspec + GSD Live Demo (5 min)

### Slide 8.1: Brief openspec mention (30 sec)

> "I want to spend most of this section on a live demo, so I'll be brief on the contrast.
>
> I tried openspec for a few weeks earlier this year. It's a clean implementation of basic spec-driven development primitives — propose a change, generate specs, apply tasks, archive. Solid foundation.
>
> But its command surface stops there. As projects scale up, you need more — milestone-level audits, gap-closure planning, autonomous multi-phase execution, retroactive UAT generation. GSD has all of those. So I switched. The rest of this section is about what GSD actually does, in practice."

### Slide 8.2: GSD overview slide before demo (30 sec)

> "Quick orientation before the demo.
>
> GSD organizes work hierarchically: project → milestones → phases → waves → tasks. Each phase produces a set of artifacts in a `.planning` directory: research, discussion log, plan, summary, validation, UAT, verification. The artifacts are the durable memory I keep talking about. They're what new agent sessions read when context is fresh.
>
> Per-phase, the lifecycle is: discuss → plan → execute → validate → verify. I'll run that lifecycle live now."

### Slide 8.3: Live demo — show the .planning directory (30 sec)

> [Switch to terminal.]
>
> "First, the directory. [Run:] `tree -L 3 .planning`
>
> So you can see — `PROJECT.md` is the living project definition. `ROADMAP.md` is the phase sequence. `STATE.md` tracks current execution state. Under `phases/`, every completed phase has its own folder with all artifacts. This is the memory I was talking about. When I open a new session, the agent reads these.
>
> [Briefly scroll one phase folder.] You can see PLAN.md, SUMMARY.md, VERIFICATION.md, UAT.md. Every decision is in writing."

### Slide 8.4: Live demo — phase lifecycle (3 min)

> "Now I'll run a small fake phase end-to-end. The feature: 'Add a last-reviewed timestamp to flashcards.' Tiny, but it'll let me show every step.
>
> [Run:] `/gsd:add-phase`
>
> "I describe the feature, GSD adds it to the roadmap. Done.
>
> [Run:] `/gsd:discuss-phase`
>
> "Watch what happens here. GSD asks me clarifying questions — the gray-zone interrogation step from Section 6.4. Where should the timestamp render — every card or only library view? Localized format? Relative or absolute? These are exactly the gray zones the AI would otherwise fill with defaults. I answer them, and answers go into a discussion log artifact.
>
> [Run:] `/gsd:plan-phase`
>
> "GSD researches the codebase, generates a PLAN.md with task breakdown, and — this is the key step — it generates a UAT.md alongside the plan. The UAT is the externally-observable behavior assertion, written before code, that becomes the goal of execution.
>
> [Run:] `/gsd:execute-phase`
>
> "Wave-based execution. Each wave is a set of tasks with no dependencies between them, run in parallel by separate agent contexts. Each task ends in an atomic git commit. [Show commit landing.]
>
> [Run:] `/gsd:validate-phase`
>
> "This generates tests post-hoc, which I admitted earlier is TDD-lite. It runs them and reports.
>
> [Run:] `/gsd:verify-work`
>
> "This is the goal-backward step. GSD takes the UAT — written before any code — and verifies that the implementation actually delivers it. If not, the phase is not done.
>
> [Run:] `/gsd:plan-phase --gaps-only`
>
> "If verify found gaps, this generates a focused gap-closure plan. Only the gaps. Doesn't replan everything.
>
> [Run:] `/gsd:execute-phase --gaps-only`
>
> "Closes the gaps. End of cycle."

### Slide 8.5: Live demo — capable commands not run (30 sec)

> "Two more commands I won't run live but want to flag.
>
> `/gsd:audit-milestone` — when a milestone is done, this audits all phases inside it for cross-cutting issues. Not just per-phase verification, but milestone-level coherence. Catches the 'feature shipped, but doesn't connect to other features' bug class.
>
> `/gsd:autonomous` — full autonomous mode. Runs discuss → plan → execute → verify across all remaining phases of a milestone. I use this when I trust the planning enough to step away. With UATs as the verification gate, I can audit autonomously-produced work afterward."

### Slide 8.6: Section closer (30 sec)

> "What I want you to take from the GSD demo: it's not the commands. It's the *workflow*. Discuss before you plan. Plan before you execute. Generate UATs before you generate code. Verify against UATs, not against unit tests. Every step produces a durable artifact that survives the agent's context window. The agents come and go — the artifacts stay.
>
> That workflow is what makes AI development sustainable past the small-project size."

---

## SECTION 9 — Wrap-Up + Q&A (1 min)

### Slide 9.1: Three takeaways (45 sec)

> "Three takeaways.
>
> One: AI changes what's possible in software engineering, but it changes the failure modes too. Higher regression rates, lost mental models, eroding design coherence over time. None of these are the AI's fault — they're properties of the workflow you wrap around it.
>
> Two: real engineering is fine-grained design plus fine-grained execution. AI is good at the execution half. The design half is where humans stay in the loop, and SDD frameworks like GSD give you a structured way to do that.
>
> Three: trust UATs over unit tests, CLI agents over chatbots, and durable design artifacts over agent memory. Pick the workflow that survives your project scaling up.
>
> Trellis is at v1.4, 33 phases, 878 commits. PolicyLab is messier — but workable, with the discipline above. The framework I'm advocating is the difference between those two states being a permanent gap and being a phase of growth."

### Slide 9.2: Q&A (15 sec)

> "Happy to take questions."

---

## Anticipated Q&A

**Q: Doesn't GSD just slow you down? All those artifacts?**
> "It slows down phase 1. It speeds up phases 5, 10, 20. Without artifacts, the marginal cost of every new feature grows linearly with codebase size — every change risks invalidating something the AI doesn't remember. With artifacts, that cost is closer to constant. The crossover is around phase 3 to 5 in my experience."

**Q: What do you do when the AI's UAT verification disagrees with your manual verification?**
> "Usually that means the UAT was under-specified. I rewrite the UAT to match what I actually wanted, then re-verify. Occasionally it means the AI is gaming the UAT — those cases are loud once you see them, because the implementation is technically correct but obviously broken."

**Q: How does this scale with team size?**
> "Honestly, I don't know. Both projects are solo. The artifacts seem like they'd help with onboarding and shared mental model, but I haven't tested that. I'd be careful claiming the workflow generalizes to teams without empirical evidence."

**Q: Why not just use Cursor with a really good system prompt?**
> "Cursor is great for in-IDE iteration. It's bad at long-running multi-step plans because each interaction is conversational. CLI agents — especially with Claude Code's task tools — let me run a 30-task wave in the background while I do something else. That's the workflow GSD assumes."

**Q: What about agent-to-agent collaboration — multiple Claude agents talking to each other?**
> "GSD does this — different sub-agents for research, planning, execution, verification. Each one gets a fresh context window with only the artifacts it needs. They don't talk to each other directly; they hand off via artifacts. That's intentional — direct agent-to-agent chat is fragile because there's no record."

**Q: Doesn't the CodeRabbit study just mean AI is bad at code? Why use it at all?**
> "The same study notes AI's speed advantage. The point isn't that AI is better at producing code — it's that AI produces *more* code per hour, and review-and-verify infrastructure has to scale to match. UATs and durable design artifacts are the scaling story."

**Q: How do you handle the ethical / sourcing issues with AI-generated code?**
> "I follow upstream guidance on what's safe to ship. For research code (PolicyLab), the bar is lower. For Trellis, which I'd consider open-sourcing, I keep the design provenance documented in the .planning directory specifically so the human-machine boundary is auditable."

---

## Timing Guide

| Section | Topic | Time |
|---|---|---|
| 1 | Title + framing | 1 min |
| 2 | Trellis — intro + demo | 3 min |
| 3 | PolicyLab — intro + demo | 3 min |
| 4 | Engineering tradeoffs (defer-to-streamer + 3-list pipeline) | 4 min |
| 5 | Why use AI | 2 min |
| 6 | What AI cannot do (6 failure modes) | 7 min |
| 7 | How to use AI (4 recommendations) | 4 min |
| 8 | GSD vs openspec + live demo | 5 min |
| 9 | Wrap-up + Q&A | 1 min |
| **Total** | | **~30 min** |

**Overflow strategy:** If running long, compress sections 2-3 (project intros) — give one-sentence descriptions and skip the live demos. Section 6 (failure modes) and Section 8 (GSD demo) are the load-bearing content; defend them.

**Underflow strategy:** Pull more from the engineering tradeoffs (Section 4) — the prior deck has detail on classification pipeline + token optimization that can be pulled in. Or extend the GSD demo with a real (not dummy) phase from the actual Trellis backlog.

---

## Demo Risk Mitigation

1. **Trellis demo (Section 2.2):** App is stable. Risk low. If device fails, fall back to screencast.
2. **PolicyLab demo (Section 3.2):** App is intentionally less stable. Risk medium. Pre-record a working session as fallback. If the demo glitches live, *narrate the glitch openly* — it's directly on-message for the talk's thesis.
3. **GSD demo (Section 8.4):** Live execution can be slow if any LLM call stalls. Mitigation: pre-prepare the dummy feature description; have a screencast ready; be willing to skip ahead in the lifecycle if any step takes more than ~30 seconds.
