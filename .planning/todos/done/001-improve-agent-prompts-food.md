---
title: "Improve agent prompts to surface economic incentives for food production"
status: pending
priority: P1
source: "promoted from /gsd:note"
created: 2026-04-07
theme: prompts
---

## Goal

Improve agent LLM prompts to surface economic incentives for food production. When food prices are high / reserves are low, agent prompts should clearly highlight PRODUCE_AND_SELL profitability (e.g. "Food sells at 25.6 fiat/unit — producing food is extremely profitable"). This is a prompt engineering fix in server/src/llm/prompts.ts to prevent death spiral where agents never choose to produce food. Related to the broader issue of LLM agent decision quality vs survival behavior.

## Context

Promoted from quick note captured on 2026-04-06 22:50.

## Acceptance Criteria

- [ ] When food prices are high or reserves are critical/low, agent prompts include a conditional profitability signal showing yield × spot price earnings
