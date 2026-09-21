/**
 * Encounter tables (`02` section 16).
 *
 * Roll d12 when a wandering monster check succeeds. On a **12**, roll d6: a 1
 * means a Coin Imp; otherwise roll again on the table and make one monster
 * Elite automatically.
 *
 * Rolls come from the **encounter** stream, which is the one `05` section 11
 * gives to wandering checks and encounter rolls, and which the save carries.
 */
import data from './encounters.json' with { type: 'json' };
import { groupSize, makeMonster } from './monsters.js';
import { eliteChance, makeElite } from './elites.js';

export const ENCOUNTERS = data.floors;
export const ENCOUNTER_DIE = data.die;
export const SPECIAL = data.special;

/** The table for one floor, or null where there isn't one yet. */
export function tableFor(floor) {
  return ENCOUNTERS[String(floor)]?.table ?? null;
}

/** Which line of the table a d12 lands on. */
export function lineFor(floor, roll) {
  const table = tableFor(floor);
  if (!table) throw new Error(`no encounter table for floor ${floor}`);
  return table.find((row) => roll <= row.upTo) ?? null;
}

/**
 * Rolls one encounter.
 *
 * @param {number} floor
 * @param {import('../engine/rng.js').Stream} rng the encounter stream
 * @param {{ depth?: number }} [options] how many 12s have already been rolled
 * @returns {{ roll: number, monsters: object[], elite?: string, wanderer?: string }}
 */
export function rollEncounter(floor, rng, { depth = 0, elite = true } = {}) {
  const roll = rng.die(ENCOUNTER_DIE);

  if (roll === SPECIAL.on) {
    const special = rng.die(SPECIAL.die);
    // A 1 is the Coin Imp, whose numbers come from the floor it is met on.
    if (special <= SPECIAL.wandererUpTo) {
      return {
        roll,
        special,
        wanderer: SPECIAL.wanderer,
        monsters: [makeMonster(SPECIAL.wanderer, { floor })],
      };
    }
    // Otherwise roll again and make one monster Elite. The guard is for a
    // table that could only ever answer 12, which none of them can.
    const again = depth < 4 ? rollEncounter(floor, rng, { depth: depth + 1, elite: false }) : null;
    if (!again || again.monsters.length === 0) return { roll, special, monsters: [] };
    // Which trait it gets is the d12 of `02` section 15.
    const chosen = rng.int(again.monsters.length);
    makeElite(rng, again.monsters[chosen]);
    return { ...again, roll, special, elite: again.monsters[chosen].type };
  }

  const line = lineFor(floor, roll);
  if (!line) return { roll, monsters: [] };

  const monsters = [];
  for (const entry of line.monsters) {
    const count = groupSize(entry.id, rng, entry.count);
    for (let i = 0; i < count; i += 1) monsters.push(makeMonster(entry.id, { floor }));
  }

  // `02` section 15: every non-boss encounter has a 10% + 2% x F chance that
  // one of them is Elite. The table's own 12 has already made one, and does
  // not roll again.
  if (elite && monsters.length > 0 && rng.chance(eliteChance(floor))) {
    const chosen = rng.int(monsters.length);
    makeElite(rng, monsters[chosen]);
    return { roll, monsters, elite: monsters[chosen].type };
  }

  return { roll, monsters };
}

/** Every monster id a floor's table can produce, for the data check. */
export function idsOnTable(floor) {
  const ids = new Set();
  for (const row of tableFor(floor) ?? []) {
    for (const entry of row.monsters) ids.add(entry.id);
  }
  return [...ids];
}
