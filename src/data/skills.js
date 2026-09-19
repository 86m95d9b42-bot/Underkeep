/**
 * The skill tree (`01` section 6).
 *
 * Four Paths of four tiers, plus the six Crossroads hybrids: 51 skills and 68
 * skill points, which is the document's own count against a hero's 21 by level
 * 20. `skills.json` holds the tree; this reads it.
 *
 * Every skill declares what it does in one of four shapes, and this module is
 * where that vocabulary is named:
 *
 *   - **sheet** — a number on the hero's own sheet, applied when it is learned
 *     (+5 max HP a rank, +1 DEF a rank, a wider crit range).
 *   - **hook** — an event from `06` section 16 and the handler that runs on it
 *     (Cleave on `kill`, Riposte on `miss`, Undying on `zeroHP`).
 *   - **explore** — a bonus the dungeon systems read (`03` and `05`): bashing,
 *     picking, searching, disarming.
 *   - **action** — what an active skill does when it is used.
 *
 * No DOM. The names a player reads are in `strings.json`, as a condition's are.
 */
import data from './skills.json' with { type: 'json' };
import { t } from './strings.js';

export const SKILLS = data.skills;
export const PATHS = data.paths;
export const TIERS = data.tiers;
export const SKILL_TYPES = data.types;
export const CROSSROADS = data.crossroads;

/** Every path a skill can belong to, the Crossroads included. */
export const PATH_IDS = [...Object.keys(PATHS), 'crossroads'];

/** Every skill id, in the order the document lists them. */
export function skillIds() {
  return Object.keys(SKILLS).filter((id) => !id.startsWith('_'));
}

/** One skill's entry. */
export function skill(id) {
  const found = SKILLS[id];
  if (!found) throw new Error(`unknown skill: ${id}`);
  return found;
}

/** A skill with the words a player reads, for the Skill Tree screen. */
export function skillFor(id) {
  return { id, ...skill(id), name: t(`skills.${id}.name`), effect: t(`skills.${id}.effect`) };
}

/** Every skill of one Path, in tier order. */
export function skillsOfPath(path) {
  return skillIds()
    .filter((id) => SKILLS[id].path === path)
    .sort((a, b) => SKILLS[a].tier - SKILLS[b].tier);
}

/** The skills of one Path and tier, which is how the tree is drawn. */
export function skillsOfTier(path, tier) {
  return skillsOfPath(path).filter((id) => SKILLS[id].tier === tier);
}

/** True for one of the six hybrids (`01` section 6, Crossroads). */
export function isCrossroads(id) {
  return skill(id).path === 'crossroads';
}

/** How many points this Path's tier needs spent in it before it opens. */
export function gateFor(tier) {
  const row = TIERS.find((entry) => entry.tier === tier);
  if (!row) throw new Error(`no tier ${tier}`);
  return row.spent;
}

/** The attribute a capstone asks for, or null. */
export function requirementOf(id) {
  return skill(id).requires ?? null;
}

/** What one rank of a skill costs: always 1 SP (`01` section 6). */
export const COST_PER_RANK = 1;

/**
 * Every skill point the tree holds — the document's "about 68 available",
 * which is what a build is measured against.
 */
export function totalSkillPoints() {
  return skillIds().reduce((total, id) => total + SKILLS[id].ranks * COST_PER_RANK, 0);
}

/* -------------------------------------------------------------------------- */
/* What a skill does                                                          */
/* -------------------------------------------------------------------------- */

/** The effects of a skill that apply at a given rank. */
export function effectsAt(id, rank = 1) {
  return (skill(id).effects ?? []).filter((effect) => rank >= (effect.fromRank ?? 1));
}

/** Only the ones that change the hero's own sheet. */
export function sheetEffects(id, rank = 1) {
  return effectsAt(id, rank).filter((effect) => effect.sheet);
}

/** Only the ones that hang off an event (`06` section 16). */
export function hookEffects(id, rank = 1) {
  return effectsAt(id, rank).filter((effect) => effect.hook);
}

/** Only the ones the dungeon systems read (`03`, `05`). */
export function exploreEffects(id, rank = 1) {
  return effectsAt(id, rank).filter((effect) => effect.explore);
}

/** What an active skill does when it is used, or null for a passive. */
export function actionOf(id) {
  return skill(id).action ?? null;
}

/**
 * How much of a numeric effect a rank is worth: `perRank` multiplied by the
 * rank, or a flat `value`.
 * @param {object} effect
 * @param {number} rank
 */
export function amountOf(effect, rank = 1) {
  if (effect.perRank !== undefined) return effect.perRank * rank;
  return effect.value ?? 0;
}

/** Every distinct handler the tree names, for the registrar to implement. */
export function handlerNames() {
  const names = new Set();
  for (const id of skillIds()) {
    for (const effect of skill(id).effects ?? []) {
      if (effect.handler) names.add(effect.handler);
    }
  }
  return [...names].sort();
}
