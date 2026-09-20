/**
 * The Shop (`04` sections 1 and 15).
 *
 * What is on the shelves is the tiers the hero has unlocked: everything the
 * tiers at or below the Shop's own tier list, plus the **rotating** lines,
 * which are rerolled every time the hero comes back from the dungeon
 * (`04` section 15, `05` section 8). Those rolls come from the **restock**
 * stream, which `05` section 11 derives from the master seed and the town
 * visit — so a shop's stock on day 7 is the same stock every time that seed
 * reaches day 7.
 *
 * Prices are section 1: the listed price to buy, half to sell, all of it for
 * a valuable, an unidentified item as if it were plain, and 5% off per point
 * of positive Luck modifier. The Merchant's Seal is an item effect, so it
 * arrives here through the hero's gear summary rather than by name.
 *
 * No DOM, and nothing here rolls outside the stream it is handed.
 */
import shops from '../data/shops.json' with { type: 'json' };
import { ITEMS, ITEM_IDS, costOf, item, itemOf, sellFor, slotsFor } from '../data/items.js';
import { poolFor } from '../data/loot.js';
import { restockStream } from '../engine/rng.js';
import { addItem, entryOf, isEquipped, removeItem, slotsUsed } from './inventory.js';
import { identify, isIdentified } from './identification.js';
import { rollProperty } from './loot.js';
import { shopTier } from './town.js';

export const SHOP_RULES = shops.rules;
export const TIERS = shops.tiers;

/** The three tabs of the outline's Shop table. */
export const TABS = /** @type {const} */ (['buy', 'sell', 'repair']);

/** Every tier at or below the one the Shop is stocking. */
function tiersUpTo(tier) {
  return TIERS.filter((row) => row.tier <= tier);
}

/**
 * What is always on the shelves at this tier: the ids each tier lists, and
 * whatever its pools match ("all base weapons").
 * @param {number} tier
 * @returns {string[]}
 */
export function fixedStock(tier) {
  const ids = [];
  for (const row of tiersUpTo(tier)) {
    for (const filter of row.pools ?? []) {
      for (const id of ITEM_IDS) {
        const entry = ITEMS[id];
        if (filter.category && !filter.category.includes(entry.category)) continue;
        if (filter.rarity && !filter.rarity.includes(entry.rarity)) continue;
        if (entry.loot === false || entry.magic || entry.cost === null) continue;
        ids.push(id);
      }
    }
    ids.push(...(row.items ?? []));
  }
  return [...new Set(ids)];
}

/**
 * The rotating lines, rolled for one visit.
 *
 * @param {number} tier
 * @param {import('../engine/rng.js').Stream} rng the restock stream
 * @param {object} [state] what the shop remembers between visits
 * @returns {object[]} stock entries
 */
export function rollRotating(tier, rng, { sold = [] } = {}) {
  const out = [];
  for (const row of tiersUpTo(tier)) {
    for (const line of row.rotating ?? []) {
      for (let i = 0; i < (line.count ?? 1); i += 1) {
        // Something sold "once" is gone for the rest of the game.
        if (line.once && sold.includes(line.item)) continue;
        const baseId = line.item ?? rng.pick(poolFor(line.pick));
        out.push({
          baseId,
          bonus: line.bonus ?? 0,
          property: line.property ? rollProperty(rng, baseId) : null,
          priceMultiplier: line.priceMultiplier ?? 1,
          once: Boolean(line.once),
          rotating: true,
        });
      }
    }
  }
  return out;
}

/**
 * The shop as the hero finds it on this visit.
 *
 * @param {object} options
 * @param {object} options.town
 * @param {number} options.masterSeed
 * @param {string[]} [options.sold] what has been bought out for good
 * @returns {{ tier: number, stock: object[] }}
 */
export function openShop({ town, masterSeed, sold = [] }) {
  const tier = shopTier(town);
  const rng = restockStream(masterSeed, town.day);
  const stock = [
    ...fixedStock(tier).map((baseId) => ({ baseId, bonus: 0, property: null, priceMultiplier: 1 })),
    ...rollRotating(tier, rng, { sold }),
  ];
  return {
    tier,
    // The list the caller keeps: what has been bought out for good, so an
    // "Archon's Vestments (once)" is once in a game and not once a visit.
    sold,
    stock: stock.map((entry, index) => ({ id: `stk_${index}`, ...entry })),
  };
}

/* -------------------------------------------------------------------------- */
/* Prices (`04` section 1)                                                    */
/* -------------------------------------------------------------------------- */

/** What the hero's Luck and charms take off a price, as a multiplier. */
export function buyDiscount(hero) {
  const luck = Math.max(0, hero?.mods?.luck ?? 0);
  const fromLuck = luck * SHOP_RULES.luckDiscountPerMod;
  // A charm that helps says so as a `shop` effect (`04` section 7).
  const fromGear = (hero?.gear?.effects ?? [])
    .filter((effect) => effect.shop === 'buy')
    .reduce((total, effect) => total + Math.abs(effect.value ?? 0), 0);
  return Math.max(0.1, 1 - fromLuck - fromGear);
}

/** What a charm adds to what the shop pays. */
export function sellBonus(hero) {
  return (hero?.gear?.effects ?? [])
    .filter((effect) => effect.shop === 'sell')
    .reduce((total, effect) => total + (effect.value ?? 0), 0);
}

/** What one shelf entry costs this hero. */
export function priceOf(hero, entry) {
  const base = costOf(entry.baseId, { bonus: entry.bonus, property: entry.property });
  if (base === null) return null;
  return Math.max(1, Math.round(base * (entry.priceMultiplier ?? 1) * buyDiscount(hero)));
}

/** What the shop pays for something the hero is carrying. */
export function offerFor(hero, instance) {
  const paid = sellFor(instance.baseId, {
    bonus: instance.bonus ?? 0,
    property: instance.property ?? null,
    identified: isIdentified(hero.identification, instance),
  });
  return Math.max(0, Math.round(paid * (1 + sellBonus(hero))));
}

/** What it costs to take the corrosion off a weapon (`04` section 1). */
export function repairCost() {
  return SHOP_RULES.repair.cost;
}

/* -------------------------------------------------------------------------- */
/* Doing business                                                             */
/* -------------------------------------------------------------------------- */

/** Why the hero cannot buy this, or null. */
export function whyNotBuy(hero, entry) {
  const price = priceOf(hero, entry);
  if (price === null) return 'notForSale';
  if ((hero.gold ?? 0) < price) return 'notEnoughGold';
  if (slotsUsed(hero.pack) + slotsFor(entry.baseId, 1) > hero.pack.capacity) return 'packFull';
  return null;
}

/**
 * Buys one. Anything bought in a shop is identified (`04` section 5), and a
 * rotating line is gone from the shelf once it is taken.
 * @returns {{ ok: boolean, why?: string, paid?: number, entry?: object }}
 */
export function buy(shop, hero, stockId) {
  const entry = shop.stock.find((row) => row.id === stockId);
  if (!entry) return { ok: false, why: 'notForSale' };
  const why = whyNotBuy(hero, entry);
  if (why) return { ok: false, why };

  const price = priceOf(hero, entry);
  const { entry: held } = addItem(hero.pack, entry.baseId, {
    count: 1,
    identified: true,
    ...(entry.bonus ? { bonus: entry.bonus } : {}),
    ...(entry.property ? { property: entry.property } : {}),
  });
  hero.gold -= price;
  if (held) identify(hero.identification, held);
  if (entry.rotating) shop.stock = shop.stock.filter((row) => row.id !== stockId);
  if (entry.once && shop.sold && !shop.sold.includes(entry.baseId)) shop.sold.push(entry.baseId);
  return { ok: true, paid: price, entry: held };
}

/** Why the hero cannot sell this, or null. */
export function whyNotSell(hero, instance) {
  if (!instance) return 'notCarried';
  if (instance.bound) return 'cursedInPlace';
  if (isEquipped(hero.pack, instance.instanceId)) return 'worn';
  if (item(instance.baseId).sellable === false) return 'notForSale';
  return null;
}

/**
 * Sells one of a stack (`04` section 1). An unidentified item sells as if it
 * were plain, which is the document's own nudge to identify first.
 */
export function sell(hero, instanceId) {
  const instance = entryOf(hero.pack, instanceId);
  const why = whyNotSell(hero, instance);
  if (why) return { ok: false, why };

  const paid = offerFor(hero, instance);
  removeItem(hero.pack, instanceId, 1);
  hero.gold = (hero.gold ?? 0) + paid;
  return { ok: true, paid };
}

/** Everything the hero could sell, in pack order. */
export function sellable(hero) {
  return (hero.pack?.items ?? []).filter((instance) => !whyNotSell(hero, instance));
}

/** Everything the shop could repair: what a slime has corroded (`04` section 1). */
export function repairable(hero) {
  return (hero.pack?.items ?? []).filter((instance) => instance.corroded);
}

/** Takes the corrosion off, for the flat fee the document gives. */
export function repair(hero, instanceId) {
  const instance = entryOf(hero.pack, instanceId);
  if (!instance) return { ok: false, why: 'notCarried' };
  if (!instance.corroded) return { ok: false, why: 'notCorroded' };
  const cost = repairCost();
  if ((hero.gold ?? 0) < cost) return { ok: false, why: 'notEnoughGold' };
  hero.gold -= cost;
  delete instance.corroded;
  return { ok: true, paid: cost };
}

/** The item a shelf entry is, resolved for the screen. */
export function stockItem(entry) {
  return { ...itemOf(entry.baseId), ...entry };
}
