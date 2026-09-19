/**
 * Odds, for the screen's optional display (`06` section 17: "Shows hit chance
 * on each enemy and save chance on the hero's conditions").
 *
 * Nothing here rolls anything or fires an event: it counts how many of the
 * twenty faces would land, under the same rules `06` section 6 uses — a
 * natural 1 always misses, a natural 20 always hits — and folds advantage or
 * disadvantage into that.
 */
import { attackBonus, coverPenalty, defenceOf } from './attack.js';
import { attackMods, defenceMods, isHelpless } from './conditions.js';

const FACES = 20;

/**
 * The share of the die that lands, as a fraction.
 * @param {number} need the total the roll has to reach
 * @param {number} bonus what the attacker adds
 * @param {{ advantage?: boolean, disadvantage?: boolean }} [mods]
 */
export function chanceToBeat(need, bonus, { advantage = false, disadvantage = false } = {}) {
  let hits = 0;
  for (let face = 1; face <= FACES; face += 1) {
    if (face === 1) continue;
    if (face === FACES || face + bonus >= need) hits += 1;
  }
  const single = hits / FACES;
  // One of each cancels (`06` section 6 step 5).
  if (advantage && disadvantage) return single;
  if (advantage) return 1 - (1 - single) ** 2;
  if (disadvantage) return single ** 2;
  return single;
}

/**
 * The hero's chance to hit one enemy, as a whole percentage.
 *
 * @param {object} combat
 * @param {object} attacker
 * @param {object} target
 * @param {object} [attack]
 * @returns {number} 0 to 100
 */
export function hitChance(combat, attacker, target, attack = {}) {
  if (!target) return 0;
  const weapon = { kind: 'melee', ...(attacker.attack ?? {}), ...attack };
  // A helpless target is hit automatically (`06` section 6 step 4).
  if (defenceMods(target).autoHit || isHelpless(target)) return 100;

  const bonus = attackBonus(attacker, weapon) + coverPenalty(combat, attacker, target, weapon);
  const mine = attackMods(attacker);
  const theirs = defenceMods(target);
  const chance = chanceToBeat(defenceOf(target), bonus, {
    advantage: mine.advantage || theirs.advantage,
    disadvantage: mine.disadvantage || theirs.disadvantage,
  });
  return Math.round(chance * 100);
}

/**
 * The chance a unit shakes off a condition at the end of its turn, as a whole
 * percentage — what the odds setting shows beside a condition chip.
 * @param {object} unit
 * @param {string} save body, reflex or mind
 * @param {number} dc
 */
export function saveChance(unit, save, dc) {
  return Math.round(chanceToBeat(dc, unit.saves?.[save] ?? 0) * 100);
}
