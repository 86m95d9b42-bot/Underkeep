/**
 * Elites and the two rare wanderers (`02` sections 14 and 15).
 *
 * An elite is not a different monster: it is one of the floor's own with
 * double hit points, double experience, a guaranteed drop and one trait off a
 * d12. So this makes the unit the encounter rolled into an elite in place,
 * rather than keeping twelve more stat blocks.
 *
 * No DOM, and nothing rolls except where it is handed a stream.
 */
import data from './elites.json' with { type: 'json' };

export const ELITE = data.elite;
export const ELITE_TABLE = ELITE.table;
export const WANDERERS = data.wanderers;

/** Every elite trait id, in the order the d12 lists them. */
export function eliteIds() {
  return ELITE_TABLE.map((row) => row.id);
}

/** One row of the table, by its id or by its roll. */
export function eliteTrait(which) {
  const found = ELITE_TABLE.find((row) => row.id === which || row.roll === which);
  if (!found) throw new Error(`unknown elite trait: ${which}`);
  return found;
}

/** The chance that one monster of an encounter is Elite: 10% + 2% a floor. */
export function eliteChance(floor = 1) {
  return ELITE.chance.base + ELITE.chance.perFloor * floor;
}

/**
 * Makes a unit Elite (`02` section 15): double HP, double XP, a guaranteed
 * drop, and the one trait the d12 turned up.
 *
 * The trait's own numbers go on the unit beside its name, the way a monster's
 * traits are written, so `engine/elite-traits.js` never has to look a trait
 * up in a table.
 *
 * @param {object} unit a unit from `makeMonster`
 * @param {object} row one row of the d12 table
 * @returns {object} the same unit
 */
export function applyElite(unit, row) {
  unit.elite = true;
  unit.eliteTrait = row.id;
  unit.name = `${row.name} ${unit.name}`;

  unit.maxHp = Math.floor(unit.maxHp * ELITE.hpMultiplier * (1 + (row.extraHpShare ?? 0)));
  unit.hp = unit.maxHp;
  unit.xp = Math.floor((unit.xp ?? 0) * ELITE.xpMultiplier);

  // What the trait is worth before the fight starts: the numbers on the sheet.
  if (row.init) unit.init += row.init;
  if (row.dr) unit.dr = (unit.dr ?? 0) + row.dr;
  if (row.immune) {
    unit.immune = [...new Set([...(unit.immune ?? []), ...row.immune])];
    unit.immunities = [...new Set([...(unit.immunities ?? []), ...row.immune])];
  }
  // Venomous poisons with the monster's own DC, which `riders.js` works out
  // when the rider does not name one.
  if (row.id === 'venomous' && unit.attack) {
    unit.attack = { ...unit.attack, onHit: { _trait: row.name, save: 'body', condition: row.condition } };
    unit.attacks = [unit.attack, ...(unit.attacks ?? []).slice(1)];
  }
  if (row.goldMultiplier) unit.goldMultiplier = row.goldMultiplier;

  // Every elite drops something, and a Gilded one drops something good.
  const drop = row.drop ?? 'common';
  unit.drops = [...(unit.drops ?? []), { item: drop, chance: 1 }];

  // The trait itself, in the shape every monster trait is written in.
  // The trait's own name is the row's id; the trait the engine registers is
  // that name with `elite_` in front, so an elite's Venomous and a monster's
  // own trait can never be confused for one another.
  unit.traits = [...(unit.traits ?? []), { ...row, id: `elite_${row.id}` }];
  return unit;
}

/**
 * Rolls one elite trait and applies it.
 * @param {import('../engine/rng.js').Stream} rng
 * @param {object} unit
 */
export function makeElite(rng, unit) {
  const roll = rng.die(12);
  return applyElite(unit, eliteTrait(roll));
}
