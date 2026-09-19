/**
 * The six attributes, and the modifier every other rule reads (`01` section 3).
 *
 * `attributes.json` holds section 3's table, section 4's derived-stat formulas
 * and section 5's curve. This module is the part everything already needs: the
 * attribute list, the modifier lookup, and the XP a level costs. Resolving the
 * derived statistics themselves is the next task's, and it reads the same
 * `DERIVED` block rather than writing the formulas out again.
 *
 * No DOM: the same calls serve a test, the balance simulator and the screen.
 */
import data from './attributes.json' with { type: 'json' };
import { t } from './strings.js';

/** The six, in the order `01` section 3 lists them. */
export const ATTRIBUTE_ORDER = data.order;
export const ATTRIBUTES = data.attributes;
export const DERIVED = data.derived;
export const LEVELING = data.leveling;
export const CREATION = data.creation;

/** What a score may be, and the most creation itself can roll. */
export const MIN_SCORE = data.min;
export const MAX_SCORE = data.max;
export const MAX_AT_CREATION = data.maxAtCreation;

/** @typedef {'might' | 'agility' | 'vigor' | 'intellect' | 'wits' | 'luck'} Attribute */

/** One attribute's entry, by its name or its abbreviation. */
export function attribute(name) {
  const key = String(name ?? '').toLowerCase();
  if (ATTRIBUTES[key]) return ATTRIBUTES[key];
  const found = ATTRIBUTE_ORDER.find((id) => ATTRIBUTES[id].abbr.toLowerCase() === key);
  if (!found) throw new Error(`unknown attribute: ${name}`);
  return ATTRIBUTES[found];
}

/** MIG, AGI, VIG… the identity the rules are written in. */
export function abbr(name) {
  return attribute(name).abbr;
}

/**
 * What the Create: Attributes screen shows for one attribute: the name and
 * the line about what it governs, both from `strings.json`.
 * @param {string} name
 */
export function wordsFor(name) {
  const id = ATTRIBUTE_ORDER.find((entry) => ATTRIBUTES[entry] === attribute(name));
  return { id, abbr: ATTRIBUTES[id].abbr, name: t(`attributes.${id}.name`), governs: t(`attributes.${id}.governs`) };
}

/**
 * The modifier for a score (`01` section 3, Attribute Modifier Table). A score
 * outside 3-20 is clamped, so a charm that pushes one past 20 still answers.
 * @param {number} score
 */
export function modFor(score) {
  const value = Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.floor(Number(score) || 0)));
  for (const band of data.modifiers) if (value <= band.upTo) return band.mod;
  /* c8 ignore next -- the last band is 20, which the clamp guarantees */
  return data.modifiers.at(-1).mod;
}

/**
 * Every modifier for a set of scores, which is what a hero sheet carries.
 * @param {Record<string, number>} scores
 * @returns {Record<string, number>}
 */
export function modsFor(scores = {}) {
  const out = /** @type {any} */ ({});
  for (const id of ATTRIBUTE_ORDER) out[id] = modFor(scores[id]);
  return out;
}

/** One unit's modifier for an attribute, from its scores. */
export function modOf(unit, name) {
  return modFor(unit?.attributes?.[name]);
}

/* -------------------------------------------------------------------------- */
/* Levels                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The total XP needed to reach a level: **50 x L x (L − 1)**
 * (`01` section 5). Level 1 costs nothing, and the curve stops at the cap.
 * @param {number} level
 */
export function xpForLevel(level) {
  const capped = Math.max(1, Math.min(LEVELING.cap, Math.floor(level)));
  return LEVELING.xpFactor * capped * (capped - 1);
}

/** The level a total of XP has reached. */
export function levelForXp(xp) {
  let level = 1;
  while (level < LEVELING.cap && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

/** True when a level-up hands out an attribute point (`01` section 5). */
export function givesAttributePoint(level) {
  return LEVELING.attributePointLevels.includes(level);
}

/**
 * What an exploration deed is worth, which is always its number times the
 * floor (`01` section 5, XP sources).
 * @param {'disarmTrap' | 'pickLock' | 'findSecretDoor' | 'findStairs'} deed
 * @param {number} floor
 */
export function xpFor(deed, floor) {
  const rate = LEVELING.xpSources[deed];
  if (rate === undefined) throw new Error(`no XP rule for "${deed}"`);
  return rate * floor;
}
