/**
 * The item database (`04` sections 1 to 13).
 *
 * `items.json` holds every **base** item in the shape section 17 gives, plus
 * the tables that turn a base item into a found one: the enhancement bonuses
 * and properties of section 4, the identification rules of section 5, the
 * curses of section 6, the gem table of section 12 and the Alchemist's
 * recipes. This module reads it.
 *
 * Two kinds of number live on an item, and the difference is worth keeping:
 *
 *   - **Its own numbers** describe the thing itself — `damage`, `toHit`,
 *     `def`, `maxAgi`, `slots`, `cost`. The engine reads them off the weapon
 *     it swings or the armour it wears.
 *   - **`effects`** are what it adds to the *hero* while it is equipped or
 *     carried, written in `skills.json`'s vocabulary (`sheet`, `hook`,
 *     `explore`, `action`), so a charm and a skill reach the sheet the same
 *     way and no item gets a code path of its own.
 *
 * A unique or legendary item names a `base` and inherits everything it does
 * not override, which is what "Mace +1" or "Longbow +2" means in section 13.
 *
 * No DOM, and nothing here rolls: loot generation is `loot.js` and the system
 * over it.
 */
import data from './items.json' with { type: 'json' };
// `04` writes Trap Parts as "5 x floor"; the bestiary writes the Coin Imp's
// numbers the same way, and one parser for both is better than two.
import { scale } from './monsters.js';

export const ITEMS = data.items;
export const ITEM_RULES = data.rules;
export const MAGIC = data.magic;
export const IDENTIFICATION = data.identification;
export const CURSES = data.curses;
export const GEMS = data.gems;
export const ART_OBJECTS = data.artObjects;
export const ALCHEMY = data.alchemy;

/** Every item id, in the order the document lists them. */
export const ITEM_IDS = Object.keys(ITEMS).filter((id) => !id.startsWith('_'));

/** Every category an item can have. */
export const CATEGORIES = [...new Set(ITEM_IDS.map((id) => ITEMS[id].category))];

/** One base item, as the document writes it. */
export function item(id) {
  const found = ITEMS[id];
  if (!found) throw new Error(`unknown item: ${id}`);
  return found;
}

/** True if the database has this id, for a check that must not throw. */
export function hasItem(id) {
  return Boolean(ITEMS[id]) && !id.startsWith('_');
}

/** Every item id, as a list. */
export function itemIds() {
  return [...ITEM_IDS];
}

/**
 * One item with its id, and with anything it inherits from its `base` filled
 * in: a unique weapon keeps its base's dice, group and slots (`04` section 13).
 */
export function itemOf(id) {
  const entry = item(id);
  const base = entry.base ? item(entry.base) : null;
  if (!base) return { id, ...entry };
  // The base gives the shape of the thing; the item's own keys win.
  const { name: _baseName, rarity: _baseRarity, cost: _baseCost, effects: baseEffects, ...rest } = base;
  return {
    id,
    ...rest,
    ...entry,
    ...(baseEffects || entry.effects
      ? { effects: [...(baseEffects ?? []), ...(entry.effects ?? [])] }
      : {}),
  };
}

/** Every item of one category, in document order. */
export function itemsOfCategory(category) {
  const wanted = Array.isArray(category) ? category : [category];
  return ITEM_IDS.filter((id) => wanted.includes(ITEMS[id].category));
}

/** Every item of one rarity. */
export function itemsOfRarity(rarity) {
  const wanted = Array.isArray(rarity) ? rarity : [rarity];
  return ITEM_IDS.filter((id) => wanted.includes(ITEMS[id].rarity));
}

/** What an item does while it is held: its `effects`, or none. */
export function effectsOf(id) {
  return itemOf(id).effects ?? [];
}

/** The damage the engine reads off a weapon: "1d8 slash". */
export function damageOf(id) {
  const entry = itemOf(id);
  if (!entry.damage) return null;
  return entry.damageType ? `${entry.damage} ${entry.damageType}` : entry.damage;
}

/** How many of an item fit in one inventory slot (`04` section 1). */
export function stackOf(id) {
  return item(id).stack ?? 1;
}

/** How many inventory slots `count` of an item take up. */
export function slotsFor(id, count = 1) {
  const entry = item(id);
  const slots = entry.slots ?? 1;
  return Math.ceil(count / (entry.stack ?? 1)) * slots;
}

/** What a valuable or a monster part is worth, with `04`'s "5 x floor" read. */
export function valueOf(id, floor = 1) {
  const entry = item(id);
  return entry.value === undefined ? null : scale(entry.value, floor);
}

/**
 * What a shop charges for an item, with the magic it carries
 * (`04` section 4: +150, +600 and +2,000 for the bonus, +300 for a property).
 * @param {string} id
 * @param {{ bonus?: number, property?: string }} [magic]
 */
export function costOf(id, { bonus = 0, property = null } = {}) {
  const base = item(id).cost;
  if (base === null || base === undefined) return null;
  const tier = bonusTier(bonus);
  const propertyPrice = property
    ? (isArmorLike(id) ? MAGIC.armorProperties.price : MAGIC.weaponProperties.price)
    : 0;
  return base + (tier?.price ?? 0) + propertyPrice;
}

/**
 * What a shop pays for one (`04` section 1): half the price, all of a
 * valuable's value, and an unidentified item as if it were plain.
 * @param {string} id
 * @param {{ bonus?: number, property?: string, identified?: boolean, floor?: number }} [instance]
 */
export function sellFor(id, { bonus = 0, property = null, identified = true, floor = 1 } = {}) {
  const entry = item(id);
  if (entry.sellable === false) return 0;
  if (entry.value !== undefined) return Math.floor(valueOf(id, floor) * ITEM_RULES.shop.valuableSellRate);
  if (entry.sell !== undefined) return entry.sell;
  const price = identified ? costOf(id, { bonus, property }) : costOf(id);
  return price === null ? 0 : Math.floor(price * ITEM_RULES.shop.sellRate);
}

/** True for armour and shields, which roll their properties on their own table. */
export function isArmorLike(id) {
  return ['armor', 'shield'].includes(item(id).category);
}

/** The enhancement row for a bonus, or null for a plain item (`04` section 4). */
export function bonusTier(bonus) {
  return MAGIC.bonuses.find((row) => row.bonus === bonus) ?? null;
}

/** The weapon property a d12 lands on (`04` section 4). */
export function weaponPropertyFor(roll) {
  const row = MAGIC.weaponProperties.table.find((entry) => entry.roll === roll);
  if (!row) throw new Error(`no weapon property for a roll of ${roll}`);
  return { ...row, ...MAGIC.weaponProperties.properties[row.id] };
}

/** The armour or shield property a d10 lands on (`04` section 4). */
export function armorPropertyFor(roll) {
  const row = MAGIC.armorProperties.table.find((entry) => entry.roll === roll);
  if (!row) throw new Error(`no armor property for a roll of ${roll}`);
  return { ...row, ...MAGIC.armorProperties.properties[row.id] };
}

/** The curse a d8 lands on (`04` section 6). */
export function curseFor(roll) {
  const row = CURSES.table.find((entry) => entry.roll === roll);
  if (!row) throw new Error(`no curse for a roll of ${roll}`);
  return row;
}

/** How likely an unidentified magic item is cursed on a floor (`04` section 6). */
export function curseChanceOn(floor) {
  const row = CURSES.chance.find(({ floors }) => floor >= floors[0] && floor <= floors[1]);
  return row?.chance ?? CURSES.chance[CURSES.chance.length - 1].chance;
}

/**
 * The gem a roll of d100 + (floor x 5) finds (`04` section 12). Floors 1-3 cap
 * the common table's gem at Pearl, which the caller passes as `capTo`.
 * @param {number} roll the die alone; the floor bonus is added here
 * @param {{ floor?: number, capTo?: string }} [options]
 */
export function gemFor(roll, { floor = 1, capTo = null } = {}) {
  const total = roll + floor * GEMS.perFloor;
  const band = GEMS.bands.find((entry) => total <= entry.upTo) ?? GEMS.bands[GEMS.bands.length - 1];
  if (!capTo) return band.item;
  const capIndex = GEMS.bands.findIndex((entry) => entry.item === capTo);
  const bandIndex = GEMS.bands.indexOf(band);
  return capIndex >= 0 && bandIndex > capIndex ? GEMS.bands[capIndex].item : band.item;
}

/** The Alchemist's recipes (`04` section 12). */
export function recipes() {
  return ALCHEMY.recipes;
}

/** The recipe that makes an item, if the Alchemist can make it. */
export function recipeFor(id) {
  return ALCHEMY.recipes.find((recipe) => recipe.result.item === id) ?? null;
}
