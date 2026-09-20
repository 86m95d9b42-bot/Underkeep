/**
 * Putting gear on, taking it off, and getting a curse off (`04` section 6).
 *
 * Three things happen when something goes on, and they belong to three
 * different modules: the pack decides whether it can be worn and binds a
 * cursed item to the hero, identification decides what the hero learns by
 * wearing it, and the sheet is rebuilt over what is now on. This is the one
 * place that does all three in order, so no screen has to remember to.
 *
 * Curses come off two ways and only two: a Scroll of Remove Curse frees the
 * item — which can then be taken off and sold — or the Temple burns it off for
 * **50 gp x the floor it was found on**, which destroys the item.
 *
 * No DOM.
 */
import { CURSES, item } from '../data/items.js';
import { entryOf, equip, equippedItems, unequip } from './inventory.js';
import { isIdentified, onEquip } from './identification.js';
import { refreshGear } from './kit.js';
import { rebuildSheet } from './levelling.js';

/** True while an item has bound itself to the hero (`04` section 6). */
export function isBound(instance) {
  return Boolean(instance?.bound);
}

/**
 * Wears or holds one item: the pack's rules, then what wearing it teaches,
 * then the sheet.
 *
 * @param {object} hero
 * @param {string} instanceId
 * @returns {{ ok: boolean, why?: string, slot?: string, replaced?: string[],
 *   bound?: boolean, revealed?: string[] }}
 */
export function wear(hero, instanceId) {
  const result = equip(hero.pack, instanceId);
  if (!result.ok) return result;

  const instance = entryOf(hero.pack, instanceId);
  const learned = onEquip(hero.identification, instance);
  rebuildSheet(hero);
  return {
    ...result,
    bound: isBound(instance),
    revealed: learned.revealed ?? [],
    cursed: Boolean(learned.cursed),
  };
}

/**
 * Takes what is in a slot off. A bound item refuses, which is the whole of
 * what a curse costs until it is removed.
 */
export function takeOff(hero, slot) {
  const result = unequip(hero.pack, slot);
  if (result.ok) rebuildSheet(hero);
  return result;
}

/** Every cursed item the hero is wearing, revealed or not. */
export function cursedWorn(hero) {
  return Object.values(equippedItems(hero.pack ?? {}))
    .filter((gear) => gear?.curse)
    .map((gear) => entryOf(hero.pack, gear.instanceId));
}

/**
 * A Scroll of Remove Curse: every curse on what the hero is wearing
 * (`04` section 6, and section 9's scroll). The item keeps the bonus it has —
 * a freed -1 sword is still a -1 sword — but it lets go, and can be sold.
 *
 * It does not name what is left: a sword whose curse has been lifted is still
 * a sword of unknown bonus until a combat shows it (`04` section 5).
 *
 * @param {object} hero
 * @returns {object[]} the items that were freed
 */
export function removeCurses(hero) {
  const freed = cursedWorn(hero);
  for (const instance of freed) {
    delete instance.curse;
    delete instance.bound;
    instance.revealed = (instance.revealed ?? []).filter((secret) => secret !== 'curse');
    // One secret fewer: an item with nothing else to hide is now known.
    instance.identified = isIdentified(hero.identification, instance);
  }
  if (freed.length > 0) rebuildSheet(hero);
  return freed;
}

/** What the Temple charges to burn a curse off: 50 gp x the floor it came from. */
export function cleanseFee(instance) {
  const perFloor = CURSES.removal.temple.goldPerFloor;
  return perFloor * (instance?.foundOnFloor ?? 1);
}

/**
 * The Temple's way (`04` section 6, and the Temple prices in DECISIONS): the
 * curse goes, and so does the item.
 *
 * @param {object} hero
 * @param {string} instanceId
 * @returns {{ ok: boolean, why?: string, fee?: number, destroyed?: string }}
 */
export function cleanseAtTemple(hero, instanceId) {
  const instance = entryOf(hero.pack, instanceId);
  if (!instance) return { ok: false, why: 'notCarried' };
  if (!instance.curse) return { ok: false, why: 'notCursed' };

  const fee = cleanseFee(instance);
  if ((hero.gold ?? 0) < fee) return { ok: false, why: 'notEnoughGold', fee };

  hero.gold -= fee;
  // Destroyed: out of its slot, out of the pack, out of the quick bar.
  for (const [slot, id] of Object.entries(hero.pack.equipped)) {
    if (id === instanceId) hero.pack.equipped[slot] = null;
  }
  hero.pack.items = hero.pack.items.filter((held) => held.instanceId !== instanceId);
  for (const [index, pinned] of hero.pack.quick.entries()) {
    if (pinned === instanceId) hero.pack.quick[index] = null;
  }
  rebuildSheet(hero);
  return { ok: true, fee, destroyed: item(instance.baseId).name };
}

/** What a curse is called and what it does, for the Item Detail sheet. */
export function curseOf(id) {
  return CURSES.table.find((row) => row.id === id) ?? null;
}

export { refreshGear };
