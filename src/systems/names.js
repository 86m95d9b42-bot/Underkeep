/**
 * Rolling a hero's name.
 *
 * No rule document asks for this; it is a convenience on Create: Origin, for
 * a player who would rather start playing than think of a name (recorded in
 * `docs/DECISIONS.md`, 2026-09-22). The parts live in `names.json` like every
 * other table, and the roll comes from a seeded stream, so the same seed and
 * the same tap always give the same name.
 *
 * A name is a start, sometimes a middle, and an end — "Alric", "Selandor" —
 * and sometimes an epithet after it, but only when the whole thing still fits
 * the sheet. No DOM.
 */
import data from '../data/names.json' with { type: 'json' };
import { nameStream } from '../engine/rng.js';

/** How long a name may be, so it fits the sheet and the Hall of the Dead. */
export const NAME_LIMIT = 16;

export const NAME_PARTS = data;

/**
 * One name from a stream.
 *
 * Every part is drawn whether or not it is used, so a name costs the same
 * draws however it comes out and a replay stays in step (the same reason
 * `rng.d20` always rolls both dice).
 *
 * @param {import('../engine/rng.js').Stream} rng
 * @param {number} [limit] the longest name that may come back
 * @returns {string}
 */
export function rollName(rng, limit = NAME_LIMIT) {
  const start = rng.pick(data.starts);
  const middle = rng.pick(data.middles);
  const end = rng.pick(data.ends);
  const epithet = rng.pick(data.epithets);
  const wantsMiddle = rng.chance(data.chances.middle);
  const wantsEpithet = rng.chance(data.chances.epithet);

  const given = `${start}${wantsMiddle ? middle : ''}${end}`;
  const full = `${given} ${epithet}`;
  // The epithet is dropped rather than cut: half a title reads as a bug.
  if (wantsEpithet && full.length <= limit) return full;
  return given.slice(0, limit);
}

/**
 * The name a seed rolls on its nth tap of the dice. Derived, never saved: the
 * draw number is what makes each tap its own roll.
 *
 * @param {number} masterSeed
 * @param {number} [draw] how many names the player has rolled
 * @param {number} [limit]
 */
export function nameFor(masterSeed, draw = 0, limit = NAME_LIMIT) {
  return rollName(nameStream(masterSeed, draw), limit);
}
