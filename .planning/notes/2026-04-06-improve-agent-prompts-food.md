---
date: "2026-04-06 22:50"
promoted: true
---

URGENT: Improve agent LLM prompts to surface economic incentives for food production. When food prices are high / reserves are low, agent prompts should clearly highlight PRODUCE_AND_SELL profitability (e.g. "Food sells at 25.6 fiat/unit — producing food is extremely profitable"). This is a prompt engineering fix in server/src/llm/prompts.ts to prevent death spiral where agents never choose to produce food. Related to the broader issue of LLM agent decision quality vs survival behavior.
