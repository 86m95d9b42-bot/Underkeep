/**
 * The loot tables (`04` section 14, with `02` section 17's category roll).
 *
 * Two rolls decide a drop. The bestiary rolls **d100 + (LCK mod x 5)** once
 * for the whole encounter and gets a category — gold only, Common, Uncommon or
 * Rare — and then `04` rolls **d12** on that category's table for the item
 * itself.
 *
 * This module only reads the tables. A row says what to produce, not what was
 * produced: `item` is a named item, `pick` draws from a pool, `gem` rolls on
 * the gem table, `oneOf` is a choice of two. Turning a row into an item —
 * the base type, the bonus, the property, the curse and the identification
 * state — is loot generation, which is built on top of this.
 */
import data from './loot.json' with { type: 'json' };
import { ITEMS, ITEM_IDS } from './items.js';

export const LOOT = data.tables;
export const LOOT_DIE = data.die;
export const CATEGORY_ROLL = data.categoryRoll;
export const POOLS = data.pools;
export const GEAR_RULES = data.gear;

/** The three d12 tables. */
export function lootTables() {
  return LOOT;
}

/** One category's d12 table. */
export function lootTable(category) {
  const table = LOOT[category];
  if (!table) throw new Error(`no loot table for "${category}"`);
  return table;
}

/** Which line of a table a d12 lands on. */
export function rollFor(category, roll) {
  const row = lootTable(category).find((entry) => roll <= entry.upTo);
  if (!row) throw new Error(`a roll of ${roll} is off the ${category} table`);
  return row;
}

/**
 * Which category a loot roll of d100 + (LCK mod x 5) lands in
 * (`02` section 17). A total over 99 also rolls again, which the band says.
 * @param {number} total the die plus the Luck bonus
 */
export function categoryFor(total) {
  const band = CATEGORY_ROLL.bands.find((entry) => total <= entry.upTo);
  return band ?? CATEGORY_ROLL.bands[CATEGORY_ROLL.bands.length - 1];
}

/**
 * The items a `pick` draws from. A pool is a filter over the database rather
 * than a second list of ids, so an item joins its own pool by existing: the
 * ones kept out are marked `loot: false` (the found-only keys, the crafted
 * armour) or `harmful: true` (the four bad potions, which are never a reward).
 * @param {string} name
 * @returns {string[]}
 */
export function poolFor(name) {
  const filter = POOLS[name];
  if (!filter) throw new Error(`no loot pool called "${name}"`);
  return ITEM_IDS.filter((id) => {
    const entry = ITEMS[id];
    if (entry.loot === false || entry.harmful) return false;
    if (filter.legendary) return Boolean(entry.legendary);
    if (entry.legendary || entry.rarity === 'unique') return false;
    if (filter.category && !filter.category.includes(entry.category)) return false;
    if (filter.rarity && !filter.rarity.includes(entry.rarity)) return false;
    if (filter.magic !== undefined && Boolean(entry.magic) !== filter.magic) return false;
    // A base item is a plain one: the magic robes have their own pool.
    if (filter.rarity?.includes('common') && entry.magic) return false;
    return true;
  });
}

/** Every pool name, for the data check. */
export function poolNames() {
  return Object.keys(POOLS).filter((name) => !name.startsWith('_'));
}

/**
 * What a Rare row's gear gets on a floor (`04` section 14, Gear Details 2):
 * +1 with a property on floors 1-3, +2 on floors 4-7, and +2 on floors 8+
 * that a d6 of 5-6 raises to +3.
 * @param {number} floor
 */
export function rareGearOn(floor) {
  const rows = GEAR_RULES.bonus.rareOnFloors;
  return (
    rows.find((row) => floor >= row.fromFloor && (!row.upToFloor || floor <= row.upToFloor)) ??
    rows[rows.length - 1]
  );
}

/** Every item id a table can name outright, for the data check. */
export function itemsNamedBy(category) {
  const named = [];
  for (const row of lootTable(category)) {
    if (row.item) named.push(row.item);
    for (const id of row.oneOf ?? []) named.push(id);
  }
  return named;
}
