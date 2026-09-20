/**
 * The derived statistics (`01` section 4).
 *
 * Every formula is in `attributes.json`; this reads them. Nothing here writes
 * a rule out a second time, so changing the HP formula means changing one line
 * of data and nothing else.
 *
 * ```text
 * HP        level 1: 10 + VIG score. Each level after: +1d6 + VIG mod (min +2)
 * FP        4 + level + INT mod + WIT mod (minimum 2)
 * BA        floor(level / 2)
 * Attack    d20 + BA + MIG / AGI / INT mod, by the kind of attack
 * DEF       10 + AGI mod + armor + shield + bonuses
 * Init      d6 + AGI mod
 * Saves     d20 + attribute mod + floor(level / 3)
 * Slots     10 + (MIG mod x 2)
 * Crit      natural 20, or 19-20 when the LCK mod is +2 or better
 * ```
 *
 * No DOM, and only one roll in the whole file: the 1d6 a level-up adds to HP,
 * which takes the stream it is handed.
 */
import { DERIVED, LEVELING, modFor, modsFor } from '../data/attributes.js';

/** @typedef {Record<string, number>} Scores */

/** The Base Attack bonus: floor(level / 2). */
export function baseAttack(level = 1) {
  return Math.floor(level / DERIVED.baseAttack.perLevels);
}

/**
 * Hit points at level 1: 10 + the VIG **score**, not its modifier.
 * @param {Scores} scores
 */
export function startingHp(scores) {
  return DERIVED.hp.base + (scores[DERIVED.hp.baseScore] ?? 0);
}

/**
 * What a level-up adds to maximum HP: 1d6 + VIG mod, never less than 2
 * (`01` section 4).
 * @param {Scores} scores
 * @param {import('../engine/rng.js').Stream} rng
 */
export function hpGain(scores, rng) {
  const rule = DERIVED.hp.perLevel;
  const rolled = rng.roll(rule.dice) + modFor(scores[rule.mod]);
  return Math.max(rule.minimum, rolled);
}

/**
 * Focus at a level: 4 + level + INT mod + WIT mod, never less than 2.
 * @param {Scores} scores @param {number} level
 */
export function focusFor(scores, level = 1) {
  const rule = DERIVED.fp;
  const fromMods = rule.mods.reduce((total, id) => total + modFor(scores[id]), 0);
  return Math.max(rule.minimum, rule.base + level * rule.perLevel + fromMods);
}

/**
 * Defense: 10 + AGI mod, plus whatever is worn. Armour and shields come in as
 * a number from the pack, and heavier armour caps the AGI mod that counts
 * (`04` section 3, Max AGI mod).
 * @param {Scores} scores @param {number} [gear] @param {number | null} [maxAgi]
 */
export function defenseFor(scores, gear = 0, maxAgi = null) {
  const agility = modFor(scores[DERIVED.defense.mod]);
  const counted = maxAgi === null || maxAgi === undefined ? agility : Math.min(agility, maxAgi);
  return DERIVED.defense.base + counted + gear;
}

/** The initiative modifier: the AGI mod the d6 is added to each round. */
export function initiativeFor(scores) {
  return modFor(scores[DERIVED.initiative.mod]);
}

/**
 * The attack bonus for one kind of attack: BA plus the attribute it uses.
 * @param {Scores} scores @param {'melee' | 'ranged' | 'spell'} kind @param {number} level
 */
export function attackFor(scores, kind = 'melee', level = 1) {
  const attribute = DERIVED.attack[kind];
  if (!attribute) throw new Error(`no attack rule for "${kind}"`);
  return baseAttack(level) + modFor(scores[attribute]);
}

/** All three attack bonuses, which is what a hero sheet shows. */
export function attacksFor(scores, level = 1) {
  const out = /** @type {any} */ ({});
  for (const kind of Object.keys(DERIVED.attack)) {
    if (kind.startsWith('_')) continue;
    out[kind] = attackFor(scores, kind, level);
  }
  return out;
}

/**
 * The three save bonuses: the attribute's modifier plus floor(level / 3).
 * @param {Scores} scores @param {number} level
 */
export function savesFor(scores, level = 1) {
  const rule = DERIVED.saves;
  const fromLevel = Math.floor(level / rule.perLevels);
  const out = /** @type {any} */ ({});
  for (const [save, attribute] of Object.entries(rule.types)) {
    out[save] = modFor(scores[attribute]) + fromLevel;
  }
  return out;
}

/** Inventory slots: 10 + (MIG mod x 2) (`01` section 4). */
export function slotsFor(scores) {
  const rule = DERIVED.inventorySlots;
  return rule.base + modFor(scores[rule.mod]) * rule.perMod;
}

/**
 * The lowest natural that crits: 20, or 19 once the LCK mod reaches +2
 * (`01` section 4).
 */
export function critFromFor(scores) {
  const rule = DERIVED.critRange;
  return modFor(scores[rule.mod]) >= rule.wideFromMod ? rule.wideNatural : rule.natural;
}

/**
 * The DC of something the hero does to a monster: 10 + floor(level / 2) plus
 * the governing attribute's modifier (`01` section 4, Effect DCs).
 * @param {Scores} scores @param {string} attribute @param {number} level
 */
export function effectDcFor(scores, attribute, level = 1) {
  const rule = DERIVED.effectDc;
  return rule.base + Math.floor(level / rule.perLevels) + modFor(scores[attribute]);
}

/**
 * Every derived statistic at once, which is what the hero sheet and the
 * creation preview both want.
 *
 * @param {Scores} scores
 * @param {object} [options]
 * @param {number} [options.level]
 * @param {number} [options.gear] armour and shield, once there are any
 * @param {number | null} [options.maxAgi] the cap heavy armour puts on the AGI mod
 * @param {number} [options.maxHp] a hero past level 1 carries their own, since
 *   the gains were rolled; without it this is the level 1 figure
 */
export function derivedFor(scores, { level = 1, gear = 0, maxAgi = null, maxHp } = {}) {
  return {
    level,
    mods: modsFor(scores),
    maxHp: maxHp ?? startingHp(scores),
    maxFp: focusFor(scores, level),
    ba: baseAttack(level),
    attacks: attacksFor(scores, level),
    def: defenseFor(scores, gear, maxAgi),
    init: initiativeFor(scores),
    saves: savesFor(scores, level),
    slots: slotsFor(scores),
    critFrom: critFromFor(scores),
    skillPoints: LEVELING.skillPointsAtLevel1 + (level - 1) * LEVELING.skillPointsPerLevel,
  };
}
