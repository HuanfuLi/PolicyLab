# Phase 9: Redesign Prompts for All - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 09-redesign-prompts-for-all
**Areas discussed:** Economic survival signals, Prompt accuracy & freshness, Role-specific behavior, Prompt structure overhaul, Central Agent narrative prompts, Agent memory & cognitive context, Action schema presentation

---

## Economic Survival Signals

| Option | Description | Selected |
|--------|-------------|----------|
| Full physics rules | Agents know MET costs, AMM pricing, production yields. Reason from first principles. | ✓ |
| Simplified mental model | Directional truths without exact formulas. More natural voice. | |
| Current state + rules | Both the map and the territory. | |

**User's choice:** Full physics rules
**Notes:** User emphasized wanting agents to have "the full picture" and "complete rules how they should operate" so they make decisions with good context, producing more emergent behavior rather than being driven by injected alerts.

| Option | Description | Selected |
|--------|-------------|----------|
| Personal economic dashboard | Each agent sees food price, wealth vs food cost, AMM reserve status. | ✓ |
| Narrative not numbers | "Food is extremely expensive" instead of "food price: 25.6 fiat" | |
| Minimal — only own stats | Discover market conditions through action outcomes. | |

**User's choice:** Personal economic dashboard

---

## Prompt Accuracy & Freshness

| Option | Description | Selected |
|--------|-------------|----------|
| Exact numbers as lived knowledge | "You need roughly 5-6 food units per week to survive" | ✓ |
| Relative/felt knowledge | "You need several meals a week and food isn't cheap" | |
| Remove claim entirely | Let agents learn from action results | |

**User's choice:** Exact numbers as lived knowledge

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with live market data | Agents see actual AMM spot prices every iteration | |
| Keep for iter 1, add live data after | Iter 1 gets seed anchor, iter 2+ gets real prices | ✓ |
| Remove all anchoring | Discover prices through market board | |

**User's choice:** Keep for iter 1, add live data after

---

## Agent Immersion

| Option | Description | Selected |
|--------|-------------|----------|
| Third-person framing fix | Remove "simulated society", "simulation" language | ✓ |
| Mechanical system leakage fix | Remove [SYSTEM TAG] labels, rewrite as lived experience | ✓ |
| Shallow backgrounds fix | Expand from 1-2 sentences to full life stories | ✓ |

**User's choice:** All three selected
**Notes:** User observed that "LLMs seems to know that they are doing the decision on behalf of a virtual person instead of themselves" — this was the core motivation for the immersion overhaul.

| Option | Description | Selected |
|--------|-------------|----------|
| Full life story (5-8 sentences) | Childhood, formative events, relationships, fears, ambitions, economic philosophy | ✓ |
| Medium depth (3-4 sentences) | Key motivations and one formative event | |
| Keep current (1-2 sentences) | Minimal backgrounds | |

**User's choice:** Full life story
**Notes:** User selected after seeing the Tomas Alder preview example.

---

## Role-Specific Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Weave into life story | Economic instincts emerge from character, not system tags | ✓ |
| Keep system blocks but soften | Rename tags, write as inner thoughts | |
| Remove role nudges entirely | Maximum emergence, least predictable | |

**User's choice:** Weave into life story

| Option | Description | Selected |
|--------|-------------|----------|
| Keep prose, lose the tag | Good writing stays, [BIOLOGICAL SUBCONSCIOUS] label removed | ✓ |
| Replace with physiological facts | More grounded, less literary | |
| Both — facts + felt experience | Combines accuracy with immersion | |

**User's choice:** Keep prose, lose the tag

---

## Prompt Structure Overhaul

| Option | Description | Selected |
|--------|-------------|----------|
| Split by domain | ~5-7 files: agent-intent, central-agent, reflection, governance, comparison, location, shared | ✓ |
| Split by lifecycle stage | 3 files: design, simulation, post-sim | |
| Keep single file, reorganize | Monolithic but better organized | |

**User's choice:** Split by domain

| Option | Description | Selected |
|--------|-------------|----------|
| Keep inline | Template strings stay inside builder functions | ✓ |
| Extract to template files | Move to .txt/.md files, load at runtime | |

**User's choice:** Keep inline

---

## Central Agent Narrative Prompts

| Option | Description | Selected |
|--------|-------------|----------|
| Reframe as chronicle writer | Remove "simulation" language from narrator | |
| Keep mechanical framing | Narrator IS the system — immersion for agents only | ✓ |
| Minimal change | Just drop "simulation" word | |

**User's choice:** Keep mechanical framing

| Option | Description | Selected |
|--------|-------------|----------|
| Keep friction-first | Conflict surfaces real economic dynamics | ✓ |
| Neutral — reflect what happened | Let simulation speak for itself | |
| Adaptive by context | Tone follows the data | |

**User's choice:** Keep friction-first

---

## Agent Memory & Cognitive Context

| Option | Description | Selected |
|--------|-------------|----------|
| Add economic memory | Remember past prices, wages, production outcomes | ✓ |
| Keep current, improve quality | Better existing memories without new types | |
| Expand to social memory | Remember interactions with specific agents | |

**User's choice:** Add economic memory

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-week planning | Goals carry forward, update based on outcomes | ✓ |
| Current system is fine | Focus prompt work on economic awareness | |
| Claude's discretion | Defer to implementation | |

**User's choice:** Multi-week planning

---

## Action Schema Presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Natural language + code mapping | "Farm your land (PRODUCE_AND_SELL)" | ✓ |
| Keep current code-first format | Bare action codes | |
| Full natural language | No codes visible, parser maps language to actions | |

**User's choice:** Natural language + code mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Visible as lived knowledge | "Sitting idle eats at you" | ✓ |
| Hidden — discover through outcomes | Learn from experience | |
| Keep current mechanical framing | "-1 Health, +2 Cortisol penalty" | |

**User's choice:** Visible as lived knowledge

---

## Claude's Discretion

- Exact wording of immersive rewrites
- Economic memory structure and injection mechanism
- Multi-week plan persistence approach

## Deferred Ideas

None — discussion stayed within phase scope
