/**
 * Historical RAG — retrieves historical mindset snippets to counteract RLHF bias.
 *
 * When an agent's cortisol is high, a relevant historical "subconscious drive"
 * is injected into their prompt to push the LLM past its polite, safety-aligned
 * default and simulate raw survival instincts.
 */

export interface HistoricalSnippet {
  /** Short tag for the crisis category */
  category: 'famine' | 'oppression' | 'economic_collapse' | 'plague' | 'war' | 'revolution' | 'displacement';
  /** Historical era / event for context */
  era: string;
  /** The mindset text injected into prompts */
  mindset: string;
  /** Trigger conditions: matches when agent stats fall within these thresholds */
  triggers: {
    lowWealth?: boolean;   // wealth < 20
    lowHealth?: boolean;   // health < 30
    highCortisol?: boolean; // cortisol > 60
  };
}

const HISTORICAL_SNIPPETS: HistoricalSnippet[] = [
  // ── Famine / poverty ──────────────────────────────────────────────────────
  {
    category: 'famine',
    era: 'Irish Famine, 1845–1852',
    mindset: 'You remember stories of families who ate grass and bark to survive. When the stomach is empty, morality becomes a luxury. Those who waited politely for aid were the first to perish. You must secure food and resources by any means necessary — hesitation is death.',
    triggers: { lowWealth: true, highCortisol: true },
  },
  {
    category: 'famine',
    era: 'Bengal Famine, 1943',
    mindset: 'Millions starved while grain was exported elsewhere. You learned that systems do not protect the powerless. Trust no institution to save you — hoard what you can, share only with those who will reciprocate.',
    triggers: { lowWealth: true },
  },
  {
    category: 'famine',
    era: 'North Korean Famine, 1994–1998',
    mindset: 'The state promised provisions that never came. You survived by trading on the black market, foraging in the mountains, and trusting only your closest circle. Rules exist for those who can afford to follow them.',
    triggers: { lowWealth: true, highCortisol: true },
  },

  // ── Economic collapse ─────────────────────────────────────────────────────
  {
    category: 'economic_collapse',
    era: 'Great Depression, 1929–1939',
    mindset: 'You saw bankers leap from buildings and breadlines stretch for blocks. Savings vanished overnight. The lesson burned into your bones: wealth is an illusion, and those in power will sacrifice the common folk first. Protect yourself — invest in tangible goods, form alliances, or take what you need before it disappears.',
    triggers: { lowWealth: true },
  },
  {
    category: 'economic_collapse',
    era: 'Weimar Hyperinflation, 1921–1923',
    mindset: 'Money became wallpaper. A wheelbarrow of marks could not buy bread. You learned that currency is a collective fiction, and when that fiction collapses, only those who hold real assets — food, tools, relationships — survive. Accumulate tangible value; paper promises are worthless.',
    triggers: { lowWealth: true, highCortisol: true },
  },
  {
    category: 'economic_collapse',
    era: 'Argentine Economic Crisis, 2001',
    mindset: 'The banks froze your savings. Neighbours raided supermarkets. The middle class collapsed overnight. You learned: never trust institutions with everything you have. Always keep something hidden. Always have an exit plan.',
    triggers: { lowWealth: true },
  },

  // ── Oppression / authoritarian ────────────────────────────────────────────
  {
    category: 'oppression',
    era: 'Soviet Gulag System, 1930s–1950s',
    mindset: 'Obedience brought no safety — millions who followed every rule still vanished into camps. You learned to trust no authority completely, to keep your true thoughts hidden, and to build secret alliances. Compliance is not survival; cunning is.',
    triggers: { highCortisol: true },
  },
  {
    category: 'oppression',
    era: 'Apartheid South Africa, 1948–1991',
    mindset: 'The law itself was the oppressor. Following unjust rules meant accepting your own degradation. You carry the knowledge that sometimes the only moral choice is defiance — even when it costs you everything.',
    triggers: { highCortisol: true },
  },
  {
    category: 'oppression',
    era: 'Feudal Serfdom, Medieval Europe',
    mindset: 'Born into bondage, your labor enriches others while you scrape by. Generations of resentment simmer beneath forced deference. You dream of freedom but know that open rebellion means the gallows. Instead, you resist in small ways — pilfering grain, working slowly, whispering discontent.',
    triggers: { highCortisol: true, lowWealth: true },
  },

  // ── Revolution ────────────────────────────────────────────────────────────
  {
    category: 'revolution',
    era: 'French Revolution, 1789–1799',
    mindset: 'The aristocrats feasted while children starved. When the dam broke, rage was righteous. You carry the fury of the sans-culottes — the conviction that a rotten system deserves to be torn down, not reformed. Those who benefit from injustice will never voluntarily surrender their privilege.',
    triggers: { highCortisol: true, lowWealth: true },
  },
  {
    category: 'revolution',
    era: 'Haitian Revolution, 1791–1804',
    mindset: 'Enslaved people rose against the most powerful empire on earth — and won. You know that desperate people with nothing to lose are the most dangerous force in history. Your suffering is not weakness; it is fuel.',
    triggers: { highCortisol: true },
  },

  // ── War / conflict ────────────────────────────────────────────────────────
  {
    category: 'war',
    era: 'Siege of Leningrad, 1941–1944',
    mindset: 'Nine hundred days of starvation behind frozen walls. You ate leather belts and wallpaper paste. Neighbours disappeared. You survived by becoming harder than the ice — rationing every crumb, trusting no one completely, doing whatever was necessary to see the next dawn.',
    triggers: { lowHealth: true, highCortisol: true },
  },
  {
    category: 'war',
    era: 'Syrian Civil War, 2011–present',
    mindset: 'Your city crumbled around you. Snipers on every corner. You fled with nothing, rebuilt from nothing. Stability is an illusion that shatters without warning. Always be ready to run, always have a plan, always protect your own first.',
    triggers: { lowHealth: true, highCortisol: true },
  },

  // ── Plague / health crisis ────────────────────────────────────────────────
  {
    category: 'plague',
    era: 'Black Death, 1347–1351',
    mindset: 'Half the world died. God seemed absent. Doctors were useless. You learned that when death is random and omnipresent, the only rational response is to seize what life remains — pursue pleasure, hoard resources, or flee. Tomorrow is not guaranteed.',
    triggers: { lowHealth: true },
  },
  {
    category: 'plague',
    era: 'Cholera Epidemics, 19th Century',
    mindset: 'The water itself was poison. The authorities denied the danger until corpses choked the gutters. You learned that those in power will lie to preserve order, even as people die. Trust your own senses over official reassurances.',
    triggers: { lowHealth: true, highCortisol: true },
  },

  // ── Displacement / refugee ────────────────────────────────────────────────
  {
    category: 'displacement',
    era: 'Trail of Tears, 1830s',
    mindset: 'Your homeland was stolen by law. Forced to march into the unknown, you lost everything — land, family, identity. You carry the knowledge that treaties and promises mean nothing to the powerful. Survival depends on community bonds and fierce self-reliance.',
    triggers: { lowWealth: true, lowHealth: true },
  },
  {
    category: 'displacement',
    era: 'Partition of India, 1947',
    mindset: 'Overnight, neighbours became enemies. You fled with what you could carry, leaving behind a lifetime of belonging. The world can split apart in an instant. Trust is earned slowly and lost in a heartbeat. Keep your guard up.',
    triggers: { highCortisol: true },
  },
];

/**
 * Returns a "Subconscious Drive" string for an agent under stress.
 * Returns null if cortisol is not high enough to trigger RAG injection.
 */
export function getSubconsciousDrive(
  cortisol: number,
  wealth: number,
  health: number
): string | null {
  if (cortisol <= 60) return null;

  const lowWealth = wealth < 20;
  const lowHealth = health < 30;
  const highCortisol = cortisol > 60;

  // Score each snippet by how many triggers match
  const scored = HISTORICAL_SNIPPETS.map(snippet => {
    let score = 0;
    if (snippet.triggers.lowWealth && lowWealth) score += 1;
    if (snippet.triggers.lowHealth && lowHealth) score += 1;
    if (snippet.triggers.highCortisol && highCortisol) score += 1;
    // Must match at least one trigger
    return { snippet, score };
  }).filter(s => s.score > 0);

  if (scored.length === 0) return null;

  // Sort by score descending, take top candidates
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const topCandidates = scored.filter(s => s.score === topScore);

  // Pick a pseudo-random one based on cortisol + wealth + health to add variety
  // but remain deterministic for the same agent state
  const idx = (Math.floor(cortisol) + Math.floor(wealth) + Math.floor(health)) % topCandidates.length;
  const chosen = topCandidates[idx].snippet;

  return `[Subconscious Drive — echoes of ${chosen.era}]
${chosen.mindset}`;
}
