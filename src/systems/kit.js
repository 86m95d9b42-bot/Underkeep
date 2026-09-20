/**
 * What a hero walks in carrying (`01` section 3's kits).
 *
 * The items themselves are `04` and Phase 5: slots, prices, identification,
 * curses and properties all belong to the pack. But a hero who has a long
 * sword and leather armour from their first step fights differently from one
 * who has neither, so the two numbers a fight reads — the weapon's dice and
 * the armour's DEF — come from `starting-kit.json` until `items.json` takes
 * over.
 *
 * Nothing here is a second copy of a rule: `04`'s own tables are the numbers,
 * and the DEF formula that adds the armour is `01` section 4's, in
 * `attributes.json`.
 */
import data from '../data/starting-kit.json' with { type: 'json' };
import { origin as originOf } from '../data/origins.js';

export const KIT_WEAPONS = data.weapons;
export const KIT_ARMOR = data.armor;

/** The weapon and armour an origin's kit equips, by `04`'s ids. */
export function kitOf(origin) {
  const entries = originOf(origin)?.kit ?? [];
  const weapon = entries.find((entry) => entry.equip === 'weapon');
  const armor = entries.find((entry) => entry.equip === 'armor');
  return {
    weapon: weapon ? { id: weapon.item, ...KIT_WEAPONS[weapon.item] } : null,
    armor: armor ? { id: armor.item, ...KIT_ARMOR[armor.item] } : null,
  };
}

/** What the hero's worn gear adds to DEF (`01` section 4: 10 + AGI mod + armor). */
export function gearDef(hero) {
  return hero?.armor?.def ?? 0;
}

/**
 * Puts the origin's kit on a new hero: the weapon they swing and the armour
 * they wear. The sheet is not rebuilt here — the caller derives it with
 * `gearDef` folded in, which is how the armour reaches DEF without ever being
 * added to it twice.
 * @param {object} hero
 */
export function equipKit(hero) {
  const { weapon, armor } = kitOf(hero.origin);
  if (weapon) {
    hero.weapon = weapon;
    hero.attack = { name: weapon.name, kind: weapon.kind, damage: weapon.damage };
  }
  if (armor) hero.armor = armor;
  return hero;
}
