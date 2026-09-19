/**
 * Initiative and the three bands (`06` section 3, *Initiative*).
 *
 * Rolled fresh at the start of every round, which is why the telegraph rule in
 * section 5 exists at all: a monster that wound up after the hero could
 * otherwise strike again before the hero acted.
 *
 * The four rules, in the order they apply:
 *
 *   1. **d6 + initiative modifier**, and monsters of the same type share one
 *      roll — two kobolds roll once between them.
 *   2. **Three bands**: *first* (Quicksilver), *normal*, *last* (Slowed, and
 *      the Zombie, which always acts last). A band beats any roll: a Slowed
 *      unit that rolls a 9 still acts after everyone else.
 *   3. **Ties**: the hero wins. Between monster groups, the higher initiative
 *      modifier wins, then a coin flip from the combat stream.
 *   4. **Units that share a roll** act one after another, front row left to
 *      right, then back row left to right.
 *
 * The sort itself never draws from the stream. A comparator that rolls would
 * draw a different number of times in different engines — the bug that made
 * one seed build two different floors — so ties are found first and then
 * broken, once per tie, in a fixed order.
 */
import data from '../data/combat.json' with { type: 'json' };
import { actsLast as slowed, has } from './conditions.js';
import { inFieldOrder, takesTurns } from './field.js';

export const INITIATIVE_DIE = data.initiative.die;
export const BANDS = /** @type {['first', 'normal', 'last']} */ (data.initiative.bands);

/**
 * Which band a unit acts in. Both ends are flags on the unit, so the
 * Quicksilver potion, the Slowed condition and the Zombie's own tactics all
 * reach the same place.
 * @param {object} unit
 * @returns {'first' | 'normal' | 'last'}
 */
export function bandOf(unit) {
  if (unit.actsFirst || has(unit, 'quicksilver')) return 'first';
  if (unit.actsLast || slowed(unit)) return 'last';
  return 'normal';
}

/** The bestiary's Init column, plus anything the hero's sheet adds. */
export function initiativeModifier(unit) {
  return (unit.init ?? 0) + (unit.initBonus ?? 0);
}

/**
 * Which units roll together. The hero rolls alone; monsters of the same type
 * share one roll (`06` section 3 step 1).
 * @param {object} unit
 */
export function groupKeyOf(unit) {
  return unit.side === 'hero' ? `hero:${unit.id}` : `type:${unit.type ?? unit.id}`;
}

/**
 * @typedef {object} TurnEntry
 * @property {object} unit
 * @property {'first' | 'normal' | 'last'} band
 * @property {number} roll   the d6
 * @property {number} mod    the initiative modifier
 * @property {number} total  roll + mod, what the band sorts by
 * @property {string} group  the key the roll was shared under
 */

/**
 * Rolls initiative and builds the turn order.
 *
 * @param {object} combat
 * @param {object} [options]
 * @param {object[]} [options.units] who may act — a surprise round passes one side
 * @param {import('./rng.js').Stream} [options.rng] defaults to the combat stream
 * @returns {TurnEntry[]} the order for this round
 */
export function rollInitiative(combat, { units, rng = combat.rng } = {}) {
  const acting = inFieldOrder((units ?? combat.units).filter(takesTurns));

  // One d6 per group, drawn in field order so a replay draws in the same
  // order however the units were handed in.
  /** @type {Map<string, { roll: number, mod: number }>} */
  const rolls = new Map();
  for (const unit of acting) {
    const key = groupKeyOf(unit);
    if (rolls.has(key)) continue;
    rolls.set(key, { roll: rng.die(INITIATIVE_DIE), mod: initiativeModifier(unit) });
  }

  // A group splits by band: one Slowed kobold keeps its group's roll but acts
  // in the last band with it.
  /** @type {Map<string, any>} */
  const blocks = new Map();
  for (const unit of acting) {
    const key = groupKeyOf(unit);
    const band = bandOf(unit);
    const id = `${band}|${key}`;
    if (!blocks.has(id)) {
      const { roll, mod } = rolls.get(key);
      blocks.set(id, {
        band,
        key,
        roll,
        // The modifier that decides a tie is the group's, taken from the unit
        // that rolled for it.
        mod,
        total: roll + mod,
        hero: unit.side === 'hero',
        seq: blocks.size,
        units: [],
      });
    }
    blocks.get(id).units.push(unit);
  }

  const ordered = breakTies([...blocks.values()], rng);

  const order = [];
  for (const block of ordered) {
    for (const unit of inFieldOrder(block.units)) {
      order.push({
        unit,
        band: block.band,
        roll: block.roll,
        mod: block.mod,
        total: block.total,
        group: block.key,
      });
    }
  }
  return order;
}

/**
 * Sorts the blocks by band, then by roll, then by the documented tiebreaks —
 * and only then spends the stream on the coin flips that are still needed.
 * @param {any[]} blocks
 * @param {import('./rng.js').Stream} rng
 */
function breakTies(blocks, rng) {
  const sorted = blocks.sort(
    (a, b) =>
      BANDS.indexOf(a.band) - BANDS.indexOf(b.band) ||
      b.total - a.total ||
      // The hero wins ties outright, before modifiers are compared.
      Number(b.hero) - Number(a.hero) ||
      b.mod - a.mod ||
      a.seq - b.seq,
  );

  const out = [];
  for (let i = 0; i < sorted.length; ) {
    let end = i + 1;
    while (end < sorted.length && tied(sorted[i], sorted[end])) end += 1;
    // Two monster groups level on band, roll and modifier: a coin flip from
    // the combat stream. Three or more is the same flip, taken further.
    out.push(...(end - i > 1 ? rng.shuffle(sorted.slice(i, end)) : sorted.slice(i, end)));
    i = end;
  }
  return out;
}

/** True when nothing in the documented order can separate two blocks. */
function tied(a, b) {
  return a.band === b.band && a.total === b.total && a.mod === b.mod && !a.hero && !b.hero;
}

/** The order as ids, which is what a test or a log line wants. */
export function orderIds(order) {
  return order.map((entry) => entry.unit.id);
}
