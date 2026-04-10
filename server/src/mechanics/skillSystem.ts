/**
 * Component 1A: Dynamic Skills & Dual-Track Production
 *
 * Abolishes static hardcoded occupations. Agents develop skills through
 * "learning by doing" — executing actions increases the corresponding skill
 * multiplier while all skills experience natural decay over time.
 *
 * This module is fully deterministic and LLM-independent.
 */
import type {
    SkillCategory,
    SkillMatrix,
    SkillEntry,
} from '@policylab/shared';
import {
    DEFAULT_SKILL_MATRIX,
    SKILL_CATEGORIES,
} from '@policylab/shared';
import type { ActionCode } from './actionCodes.js';

// ── Configuration Constants ───────────────────────────────────────────────────

/** XP gained per action that exercises the skill. */
const XP_PER_ACTION = 12;

/** Natural decay of XP per iteration (hedonic adaptation in skills). */
const XP_DECAY_PER_ITERATION = 2;

/** Level decay per iteration when skill is not exercised. */
const LEVEL_DECAY_RATE = 0.5;

/** XP required per level (linear progression). */
const XP_PER_LEVEL = 20;

/** Maximum skill level. */
const MAX_LEVEL = 100;

/** Minimum skill level (skills never drop below this). */
const MIN_LEVEL = 1;

// ── Skill ↔ Action Mapping ────────────────────────────────────────────────────

/**
 * Maps action codes to the skills they exercise.
 * An action can train multiple skills (primary + secondary).
 */
const ACTION_SKILL_MAP: Record<ActionCode, { primary: SkillCategory; secondary?: SkillCategory }> = {
    WORK: { primary: 'crafting', secondary: 'mining' },
    REST: { primary: 'healing' },
    STRIKE: { primary: 'leadership', secondary: 'combat' },
    STEAL: { primary: 'combat' },
    HELP: { primary: 'healing', secondary: 'leadership' },
    INVEST: { primary: 'trading', secondary: 'scholarship' },
    PRODUCE_AND_SELL: { primary: 'farming', secondary: 'crafting' },
    POST_BUY_ORDER: { primary: 'trading' },
    POST_SELL_ORDER: { primary: 'trading' },
    FOUND_ENTERPRISE: { primary: 'management', secondary: 'leadership' },
    POST_JOB_OFFER: { primary: 'management', secondary: 'trading' },
    APPLY_FOR_JOB: { primary: 'scholarship', secondary: 'trading' },
    HIRE_EMPLOYEE: { primary: 'management', secondary: 'leadership' },
    FIRE_EMPLOYEE: { primary: 'management', secondary: 'leadership' },
    WORK_AT_ENTERPRISE: { primary: 'crafting', secondary: 'leadership' },
    QUIT_JOB: { primary: 'leadership' },
    SABOTAGE: { primary: 'combat', secondary: 'leadership' },
    EMBEZZLE: { primary: 'trading', secondary: 'leadership' },
    ADJUST_TAX: { primary: 'leadership', secondary: 'scholarship' },
    SUPPRESS: { primary: 'combat', secondary: 'leadership' },
    // Banking actions (Phase 1: Banking Foundation)
    DEPOSIT: { primary: 'trading', secondary: 'scholarship' },
    WITHDRAW: { primary: 'trading' },
    TAKE_LOAN: { primary: 'trading', secondary: 'scholarship' },
    REPAY_LOAN: { primary: 'trading', secondary: 'scholarship' },
    ISSUE_LOAN: { primary: 'management', secondary: 'trading' },
    SET_INTEREST_RATE: { primary: 'scholarship', secondary: 'management' },
    SET_RESERVE_RATIO: { primary: 'management', secondary: undefined },
    SET_BASE_RATE: { primary: 'management', secondary: undefined },
    // Capital Markets actions (Phase 2)
    BUY_SHARES: { primary: 'trading', secondary: undefined },
    SELL_SHARES: { primary: 'trading', secondary: undefined },
    BUY_BOND: { primary: 'trading', secondary: undefined },
    ISSUE_GOV_BOND: { primary: 'management', secondary: undefined },
    NONE: { primary: 'scholarship' },
};

/**
 * Maps a role string to its primary skill affinity for production bonuses.
 */
const ROLE_SKILL_AFFINITY: Record<string, SkillCategory> = {
    FARMER: 'farming',
    MINER: 'mining',
    ARTISAN: 'crafting',
    WORKER: 'crafting',
    MERCHANT: 'trading',
    TRADER: 'trading',
    HEALER: 'healing',
    DOCTOR: 'healing',
    PRIEST: 'healing',
    LEADER: 'leadership',
    GOVERNOR: 'leadership',
    KING: 'leadership',
    QUEEN: 'leadership',
    MAYOR: 'leadership',
    MINISTER: 'leadership',
    SOLDIER: 'combat',
    GUARD: 'combat',
    SCHOLAR: 'scholarship',
    TEACHER: 'scholarship',
    SAGE: 'scholarship',
    MONK: 'scholarship',
    SMITH: 'crafting',
    CARPENTER: 'crafting',
    BUILDER: 'crafting',
    CHIEF: 'leadership',
};

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Creates a fresh skill matrix, optionally boosted for a role.
 */
export function createSkillMatrix(role?: string): SkillMatrix {
    const matrix = structuredClone(DEFAULT_SKILL_MATRIX);
    if (role) {
        const affinity = getRoleAffinity(role);
        if (affinity && matrix[affinity]) {
            // Role specialists start with a bonus in their primary skill
            matrix[affinity].level = 25;
            matrix[affinity].experience = 100;
        }
    }
    return matrix;
}

/**
 * Get the primary skill affinity for a role string (fuzzy matching).
 */
export function getRoleAffinity(role: string): SkillCategory | null {
    const upper = role.toUpperCase();
    for (const [keyword, skill] of Object.entries(ROLE_SKILL_AFFINITY)) {
        if (upper.includes(keyword)) return skill;
    }
    return null;
}

/**
 * Process skill changes for one agent in one iteration.
 *
 * @param skills  Current skill matrix (will be mutated in-place for performance).
 * @param action  The action code the agent executed.
 * @param skillGainMultiplier  Optional multiplier for XP gains (default 1.0).
 *                             Education public goods quality applies a bonus here.
 * @returns       The updated skill matrix.
 */
export function processSkills(
    skills: SkillMatrix,
    action: ActionCode,
    skillGainMultiplier?: number,
): SkillMatrix {
    const mapping = ACTION_SKILL_MAP[action];
    const mult = skillGainMultiplier ?? 1.0;

    // 1. Award XP for exercised skills
    if (mapping) {
        grantXP(skills, mapping.primary, Math.round(XP_PER_ACTION * mult));
        if (mapping.secondary) {
            grantXP(skills, mapping.secondary, Math.round(XP_PER_ACTION * 0.5 * mult));
        }
    }

    // 2. Apply natural decay to ALL skills
    for (const category of SKILL_CATEGORIES) {
        const entry = skills[category];

        // XP decay — skip for skills exercised this action (they just gained XP)
        const isExercised =
            mapping?.primary === category || mapping?.secondary === category;
        if (!isExercised) {
            entry.experience = Math.max(0, entry.experience - XP_DECAY_PER_ITERATION);
        }

        // Level decay for unused skills only (proportional to current level)
        if (!isExercised) {
            const decay = (entry.level - MIN_LEVEL) * (LEVEL_DECAY_RATE / MAX_LEVEL);
            entry.level = Math.max(MIN_LEVEL, entry.level - decay);
        }
    }

    return skills;
}

/**
 * Grant XP to a specific skill, and level it up if threshold is met.
 */
function grantXP(skills: SkillMatrix, category: SkillCategory, xp: number): void {
    const entry = skills[category];
    entry.experience += xp;

    // Level up: every XP_PER_LEVEL XP grants a level
    const newLevel = Math.min(MAX_LEVEL, MIN_LEVEL + Math.floor(entry.experience / XP_PER_LEVEL));
    if (newLevel > entry.level) {
        entry.level = newLevel;
    }
}

/**
 * Get the production multiplier from a skill level.
 * Returns a value between 0.5 (unskilled) and 2.5 (master).
 *
 * Formula: 0.5 + (level / 100) * 2.0
 */
export function getSkillMultiplier(level: number): number {
    const clamped = Math.max(0, Math.min(MAX_LEVEL, level));
    return 0.5 + (clamped / MAX_LEVEL) * 2.0;
}

/**
 * Get the effective production multiplier for an action given the agent's skills.
 */
export function getActionMultiplier(skills: SkillMatrix, action: ActionCode): number {
    const mapping = ACTION_SKILL_MAP[action];
    if (!mapping) return 1.0;

    // M8 fix: Guard against missing skill categories (corrupted/incomplete SkillMatrix)
    const primarySkill = skills[mapping.primary];
    if (!primarySkill) return 1.0;

    const primaryMult = getSkillMultiplier(primarySkill.level);
    if (mapping.secondary) {
        const secondarySkill = skills[mapping.secondary];
        if (!secondarySkill) return primaryMult;
        const secondaryMult = getSkillMultiplier(secondarySkill.level);
        // Primary skill contributes 70%, secondary 30%
        return primaryMult * 0.7 + secondaryMult * 0.3;
    }
    return primaryMult;
}

/**
 * Compute the total average skill level across all categories.
 */
export function averageSkillLevel(skills: SkillMatrix): number {
    let total = 0;
    for (const category of SKILL_CATEGORIES) {
        total += skills[category].level;
    }
    return Math.round((total / SKILL_CATEGORIES.length) * 100) / 100;
}
