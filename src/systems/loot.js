/**
 * Rolling loot (`04` section 14, with `02` section 17's category roll).
 *
 * Two rolls and then a handful of small ones. The bestiary rolls **d100 +
 * (LCK mod x 5)** once for the whole encounter and gets a category; `04` rolls
 * **d12** on that category's table; and the row that comes up says what to
 * make. Where the row names gear, the rest of section 14 follows: a base type
 * the hero can probably use, the bonus its floor allows, a property on half of
 * rare gear, a curse check, and everything magical arriving unidentified.
 *
 * Every draw comes from the **loot** stream (`05` section 11), which the save
 * carries, so the same fight on the same seed always drops the same things —
 * and `05` section 11 wants them committed before they are shown.
 *
 * A drop is not an item yet: it is `{ baseId, count, ... }`, exactly what
 * `inventory.addItem` takes, and the pack is what gives it an instance id.
 * No DOM.
 */
import {
  CATEGORY_ROLL,
  GEAR_RULES,
  LOOT_DIE,
  categoryFor,
  poolFor,
  rareGearOn,
  rollFor,
} from '../data/loot.js';
import { addItem } from './inventory.js';
import { onPickUp } from './identification.js';
import {
  CURSES,
  MAGIC,
  armorPropertyFor,
  bonusTier,
  curseChanceOn,
  curseFor,
  gemFor,
  isArmorLike,
  item,
  weaponPropertyFor,
} from '../data/items.js';

/** Categories the d12 tables answer to. */
const CATEGORIES = ['common', 'uncommon', 'rare'];

/** Things that can carry a bonus, a property or a curse (`04` sections 4 and 6). */
const ENCHANTABLE = ['weapon', 'armor', 'shield', 'charm'];

/** Only weapons, armour and shields have a property table (`04` section 4). */
const PROPERTIED = ['weapon', 'armor', 'shield'];

/**
 * How many times one encounter's loot roll may send itself round again. A
 * total of 100+ rolls again (`02` section 17), and each one has to clear 100
 * of its own, so this only ever stops a pathological chain.
 */
export const MAX_CATEGORY_ROLLS = 5;

/* -------------------------------------------------------------------------- */
/* The two rolls                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The category roll: d100 + (LCK mod x 5) (`02` section 17).
 * @param {import('../engine/rng.js').Stream} rng the loot stream
 * @param {{ luckMod?: number, bonus?: number }} [options] a chest's lock and
 *   trap add to the roll (`03` section 7: harder chests give better loot)
 */
export function rollCategory(rng, { luckMod = 0, bonus = 0 } = {}) {
  const roll = rng.die(100);
  const total = roll + luckMod * CATEGORY_ROLL.perLuckMod + bonus;
  const band = categoryFor(total);
  return {
    roll,
    total,
    category: band.category ?? null,
    rollAgain: Boolean(band.rollAgain),
  };
}

/**
 * Everything one encounter drops (`02` section 17). Gold is not here: each
 * defeated monster's own gold is rolled as the fight ends (`06` section 15).
 *
 * @param {import('../engine/rng.js').Stream} rng the loot stream
 * @param {object} [context]
 * @param {number} [context.floor]
 * @param {object} [context.hero] for the base-type reroll
 * @param {number} [context.luckMod]
 * @param {Set<string> | string[]} [context.found] legendaries already found
 * @returns {{ rolls: object[], drops: object[] }}
 */
export function rollLoot(rng, context = {}) {
  // The Luck modifier is the hero's unless the caller says otherwise, so no
  // call site has to remember to pass it.
  const luckMod = context.luckMod ?? context.hero?.mods?.luck ?? 0;
  const bonus = context.bonus ?? 0;
  const rolls = [];
  const drops = [];
  for (let round = 0; round < MAX_CATEGORY_ROLLS; round += 1) {
    const rolled = rollCategory(rng, { luckMod, bonus });
    rolls.push(rolled);
    if (rolled.category) drops.push(...rollOnTable(rng, rolled.category, context));
    if (!rolled.rollAgain) break;
  }
  return { rolls, drops };
}

/**
 * One d12 on one of the three tables (`04` section 14).
 * @param {import('../engine/rng.js').Stream} rng
 * @param {'common' | 'uncommon' | 'rare'} category
 */
export function rollOnTable(rng, category, context = {}) {
  const roll = rng.die(LOOT_DIE);
  return resolveRow(rng, rollFor(category, roll), { ...context, category, roll });
}

/* -------------------------------------------------------------------------- */
/* What a row makes                                                           */
/* -------------------------------------------------------------------------- */

/** One row of a table, rolled out into drops. */
function resolveRow(rng, row, context) {
  if (row.item) return [makeDrop(rng, row.item, { count: row.count ?? 1 }, context)];
  if (row.oneOf) return [makeDrop(rng, rng.pick(row.oneOf), {}, context)];
  if (row.gem) return [gemDrop(rng, row.gem, context)];
  if (row.pick) return pickedDrop(rng, row, context);
  return [];
}

/** A row that picks from a pool, which is every row that can make magic gear. */
function pickedDrop(rng, row, context) {
  if (row.pick === 'legendary') return legendaryDrop(rng, row, context);
  const pool = poolFor(row.pick);
  const baseId = chooseBase(rng, pool, context.hero);
  return [gearDrop(rng, baseId, row, context)];
}

/**
 * A legendary find (`04` section 13): floor 8+ only, and once found it is out
 * of the pool for the rest of the game. Anything else is the row's fallback.
 */
function legendaryDrop(rng, row, context) {
  const floor = context.floor ?? 1;
  if (floor >= (row.fromFloor ?? 8)) {
    const left = poolFor('legendary').filter((id) => !alreadyFound(context.found, id));
    if (left.length > 0) {
      const chosen = rng.pick(left);
      remember(context.found, chosen);
      return [makeDrop(rng, chosen, {}, context)];
    }
  }
  return row.else ? resolveRow(rng, row.else, context) : [];
}

/** A gemstone: d100 + (floor x 5), with the row's own bonus and cap. */
function gemDrop(rng, spec, context) {
  const floor = context.floor ?? 1;
  const roll = rng.die(100) + (spec.plus ?? 0);
  const [from, to] = spec.onFloors ?? [1, 10];
  const capTo = spec.capTo && floor >= from && floor <= to ? spec.capTo : null;
  return makeDrop(rng, gemFor(roll, { floor, capTo }), {}, context);
}

/**
 * Gear from a pool, with everything `04` section 14's Gear Details adds:
 * the bonus its floor allows, a property on half of rare gear, and the curse
 * check that can turn the whole thing upside down.
 */
function gearDrop(rng, baseId, row, context) {
  const entry = item(baseId);
  const floor = context.floor ?? 1;
  if (!ENCHANTABLE.includes(entry.category)) return makeDrop(rng, baseId, {}, context);

  let bonus = 0;
  let wantsProperty = Boolean(row.property);

  if (row.rareGear) {
    const rule = rareGearOn(floor);
    bonus = rule.bonus;
    // Floors 8+: a d6 of 5-6 makes it a +3 (Gear Details 2).
    if (rule.upgrade && rng.die(rule.upgrade.die) >= rule.upgrade.from) bonus = rule.upgrade.to;
    // A row that names a property always has one; otherwise rare gear is 50/50.
    wantsProperty = wantsProperty || Boolean(rule.property) || rng.chance(GEAR_RULES.propertyChance);
  } else if (row.bonus) {
    bonus = row.bonus;
  }

  // A charm carries its own magic rather than a bonus, but it is still magic:
  // it is found unknown, and it can still be cursed.
  const magical = bonus !== 0 || wantsProperty || Boolean(entry.magic);
  let curse = null;
  if (magical && rng.chance(curseChanceOn(floor))) {
    curse = curseFor(rng.die(CURSES.die)).id;
    // "A cursed weapon, armor, or shield has a -1 or -2 bonus instead."
    bonus = PROPERTIED.includes(entry.category) ? rng.pick(CURSES.bonus) : 0;
    // "Half of cursed items also carry a normal property", which is what makes
    // one worth keeping.
    wantsProperty = rng.chance(CURSES.alsoPropertyShare);
  }

  const property = wantsProperty && PROPERTIED.includes(entry.category) ? rollProperty(rng, baseId) : null;
  return makeDrop(rng, baseId, { bonus, property, curse }, context);
}

/**
 * The property a piece of gear rolls: d12 for a weapon, d10 for armour and
 * shields. Seeking is a ranged property, so a melee weapon rolls again
 * (`04` section 4).
 */
export function rollProperty(rng, baseId) {
  if (isArmorLike(baseId)) return armorPropertyFor(rng.die(MAGIC.armorProperties.die)).id;

  const melee = item(baseId).group !== 'bow';
  for (let tries = 0; tries < MAGIC.weaponProperties.die; tries += 1) {
    const rolled = weaponPropertyFor(rng.die(MAGIC.weaponProperties.die));
    const rerollFor = rolled.rerollFor ?? [];
    if (!(melee && rerollFor.includes('melee'))) return rolled.id;
  }
  /* c8 ignore next -- only if every roll in a row came up Seeking */
  return null;
}

/**
 * A base type from a pool, weighted towards what the hero can use by rerolling
 * once when they do not meet its requirement (`04` section 14, Gear Details 1).
 */
export function chooseBase(rng, pool, hero = null) {
  let chosen = rng.pick(pool);
  const rerolls = GEAR_RULES.baseType.rerollsOnUnmetRequirement ?? 0;
  for (let i = 0; i < rerolls && !canUse(chosen, hero); i += 1) chosen = rng.pick(pool);
  return chosen;
}

/** Whether the hero meets an item's attribute requirement (`04` sections 2, 3). */
export function canUse(baseId, hero) {
  const needs = item(baseId).requires;
  if (!needs || !hero?.attributes) return true;
  return Object.entries(needs).every(([attribute, score]) => (hero.attributes[attribute] ?? 0) >= score);
}

/* -------------------------------------------------------------------------- */
/* The drop itself                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One drop, in the shape `04` section 17 gives an instance — minus the id,
 * which the pack hands out when the item is picked up.
 */
function makeDrop(rng, baseId, rolled = {}, context = {}) {
  const entry = item(baseId);
  const bonus = rolled.bonus || 0;
  const property = rolled.property ?? null;
  const curse = rolled.curse ?? null;
  const drop = {
    baseId,
    count: rolled.count ?? 1,
    rarity: rarityOf(baseId, { bonus, property, curse }),
    identified: knownOnSight(baseId, { bonus, property, curse }),
  };
  if (bonus) drop.bonus = bonus;
  if (property) drop.property = property;
  if (curse) drop.curse = curse;
  if (entry.category !== 'valuable' && entry.category !== 'part') {
    drop.foundOnFloor = context.floor ?? 1;
  }
  return drop;
}

/**
 * What a found item is worth calling. A curse shows as its own rarity only
 * once it is revealed (`04` section 1); until then the item is unidentified,
 * and the screen shows a question mark rather than a colour.
 */
function rarityOf(baseId, { bonus, property, curse }) {
  const entry = item(baseId);
  if (entry.rarity === 'unique') return 'unique';
  if (curse) return 'cursed';
  if (property || bonus >= 2) return 'rare';
  if (bonus === 1) return bonusTier(1).rarity;
  return entry.rarity;
}

/**
 * Whether the hero knows what it is the moment they pick it up
 * (`04` section 5): magic gear, potions and scrolls are found unidentified,
 * and Healing Potions and Antidotes are always recognised.
 */
function knownOnSight(baseId, { bonus, property, curse }) {
  const entry = item(baseId);
  if (entry.alwaysKnown) return true;
  if (['potion', 'scroll'].includes(entry.category)) return false;
  return !(entry.magic || bonus || property || curse);
}

/**
 * Everything a finished fight leaves on the floor: what each defeated monster
 * was carrying, and then the encounter's own roll (`02` section 17, "in
 * addition to each monster's own drops"). Gold is `06` section 15's and is
 * already counted by the time this runs.
 *
 * The order is fixed — drops first, then the table — because the stream is
 * saved, and a different order would be a different floor's worth of loot.
 *
 * @param {import('../engine/rng.js').Stream} rng the loot stream
 * @param {object[]} defeated the units that fell
 */
export function lootAfterCombat(rng, defeated = [], context = {}) {
  const drops = [];
  for (const unit of defeated) drops.push(...dropsFrom(unit, rng, context));
  const rolled = rollLoot(rng, context);
  drops.push(...rolled.drops);
  return { rolls: rolled.rolls, drops };
}

/* -------------------------------------------------------------------------- */
/* Monster drops                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What one defeated monster leaves behind (`02`, each stat block's `drops`).
 * A line that names a category — the Coin Imp's "uncommon" — rolls on that
 * table instead.
 *
 * @param {object} unit
 * @param {import('../engine/rng.js').Stream} rng the loot stream
 */
export function dropsFrom(unit, rng, context = {}) {
  const drops = [];
  for (const line of unit?.drops ?? []) {
    if (!rng.chance(line.chance ?? 1)) continue;
    if (CATEGORIES.includes(line.item)) drops.push(...rollOnTable(rng, line.item, context));
    else drops.push(makeDrop(rng, line.item, { count: line.count ?? 1 }, context));
  }
  return drops;
}

/* -------------------------------------------------------------------------- */
/* Picking it up                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Takes one drop into the pack (`04` sections 1 and 16). A hero with **Lore**
 * knows what it is as they pick it up; everyone else carries it unknown.
 *
 * What will not fit is left on the floor rather than lost, which is what the
 * loot card's "drop or swap" offer is about.
 *
 * @param {object} hero
 * @param {object} drop `{ baseId, count, ... }` as the tables made it
 * @returns {{ ok: boolean, why?: string, taken: number, left: number, entry?: object }}
 */
export function takeDrop(hero, drop) {
  if (!hero?.pack) return { ok: false, why: 'noPack', taken: 0, left: drop.count ?? 1 };
  const { count = 1, ...rest } = drop;
  const { added, left, entry } = addItem(hero.pack, drop.baseId, { count, ...rest });
  if (added === 0) return { ok: false, why: 'packFull', taken: 0, left };
  if (entry) onPickUp(hero, entry);
  drop.taken = (drop.taken ?? 0) + added;
  drop.count = left;
  return { ok: true, taken: added, left, entry };
}

/** Takes what will fit, and says what is still on the floor. */
export function takeAll(hero, drops = []) {
  const taken = [];
  const left = [];
  for (const drop of drops) {
    if ((drop.count ?? 1) <= 0) continue;
    const result = takeDrop(hero, drop);
    if (result.taken > 0) taken.push(drop);
    if (result.left > 0) left.push(drop);
  }
  return { taken, left };
}

/* -------------------------------------------------------------------------- */
/* Legendaries already found                                                  */
/* -------------------------------------------------------------------------- */

/** Works with a Set or a plain array, because a save carries the array. */
function alreadyFound(found, id) {
  if (!found) return false;
  return typeof found.has === 'function' ? found.has(id) : found.includes(id);
}

function remember(found, id) {
  if (!found) return;
  if (typeof found.add === 'function') found.add(id);
  else found.push(id);
}
