---
date: "2026-04-01 12:30"
promoted: false
---

The system is underdesigned for policymakers to enter their scenario at the beginning of simulation. Currently, Design Review lets you configure agents/roles/wealth and 3 policy levers, but there's no structured way to define economic scenarios ("test 15% corporate tax with infrastructure-heavy spending" or "high-interest-rate environment"). Future milestone should add a scenario builder UI that lets policymakers configure all economic parameters in a guided flow. Prerequisite: v1.0 economy engine must expose all parameters as session-level config (EconomyConfig type) rather than hardcoded constants — this is being addressed in v1.0 requirements.