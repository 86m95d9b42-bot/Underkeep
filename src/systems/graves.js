/**
 * Graves (`05` section 9, `01` section 12).
 *
 * An Adventurer who falls wakes in town, "having lost half their carried gold
 * and all unidentified items". Those losses are not gone: they are left in a
 * Grave on the tile where the hero died, marked on the map, and walking onto
 * it gives everything back.
 *
 * There is only ever one. Dying again before reaching the old one loses it,
 * which is what makes a grave worth going back for.
 *
 * No DOM, and nothing here moves the hero: digging a grave takes from the
 * pack, opening one puts it back, and the run decides when either happens.
 */
import { addItem, removeItem } from './inventory.js';
import { isIdentified } from './identification.js';
import { refreshGear } from './kit.js';

/** Half of what the hero is carrying, rounded down (`01` section 12). */
export function goldLost(hero) {
  return Math.floor((hero.gold ?? 0) / 2);
}

/** Everything in the pack the hero could not name (`04` section 5). */
export function unknownItems(hero) {
  return (hero.pack?.items ?? []).filter((entry) => !isIdentified(hero.identification, entry));
}

/**
 * What a hero loses by falling, left where they fell.
 *
 * @param {object} hero
 * @param {{ floor: number, at: [number, number] }} where
 * @returns {{ floor: number, pos: [number, number], gold: number, items: object[] }}
 */
export function dig(hero, { floor, at }) {
  const gold = goldLost(hero);
  hero.gold = (hero.gold ?? 0) - gold;

  // The items themselves go into the grave, keeping everything they were
  // carrying with them — an unidentified item is still whatever it is.
  const items = [];
  for (const entry of unknownItems(hero)) {
    const { instanceId, ...rest } = entry;
    items.push({ ...rest });
    removeItem(hero.pack, instanceId, entry.count ?? 1);
  }
  refreshGear(hero);

  return { floor, pos: [...at], gold, items };
}

/**
 * Walking onto it: everything that was dropped comes back. What will not fit
 * stays in the grave, the way a chest keeps what the pack cannot hold.
 *
 * @param {object} hero
 * @param {object} grave
 * @returns {{ gold: number, taken: object[], left: object[] }}
 */
export function open(hero, grave) {
  if (!grave) return { gold: 0, taken: [], left: [] };

  const gold = grave.gold ?? 0;
  hero.gold = (hero.gold ?? 0) + gold;
  grave.gold = 0;

  const taken = [];
  const left = [];
  for (const item of grave.items ?? []) {
    const { baseId, count = 1, ...rest } = item;
    const { added } = addItem(hero.pack, baseId, { count, ...rest });
    if (added > 0) taken.push({ ...item, count: added });
    if (added < count) left.push({ ...item, count: count - added });
  }
  refreshGear(hero);

  grave.items = left;
  grave.emptied = left.length === 0;
  return { gold, taken, left };
}

/**
 * The hero fell (`01` section 12). In Adventurer mode they wake in town
 * without half their gold and without what they could not name, and the town
 * remembers the one grave that holds it.
 *
 * Ironman keeps nothing to come back for: the save is deleted, which is
 * Phase 8's, so nothing is dug here.
 *
 * @param {object} town
 * @param {object} hero
 * @param {{ floor: number, at: [number, number], mode?: string }} where
 * @returns {object | null} the grave, or null in Ironman
 */
export function heroFell(town, hero, { floor, at, mode = 'adventurer' }) {
  if (mode === 'ironman') return null;
  // "If the hero dies again before reaching it, the old Grave is lost and a
  // new one is made."
  const grave = dig(hero, { floor, at });
  town.grave = grave;
  return grave;
}

/** The grave on this floor, if the one that exists is on it. */
export function graveOn(town, floor) {
  return town?.grave?.floor === floor ? town.grave : null;
}

/** Takes the grave off the town once it has given everything back. */
export function clearGrave(town) {
  town.grave = null;
  return town;
}
