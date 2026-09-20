/**
 * The Town Stash (`04` section 1: *"The Town Stash stores up to 50 slots of
 * items safely between trips"*).
 *
 * A stash is a pack with a bigger capacity and no equipment slots, so it is
 * `inventory.js`'s own pack and everything about slots and stacking is
 * already the same rule. What is here is the two ways across — into the
 * stash and back out — and the refusals each way.
 *
 * Nothing in a stash goes down a stair: it is what the hero leaves behind.
 * No DOM.
 */
import { STASH_SLOTS, addItem, createPack, entryOf, isEquipped, removeItem, slotsUsed } from './inventory.js';
import { slotsFor } from '../data/items.js';

export { STASH_SLOTS };

/** The stash a hero keeps in town, made on the first visit that needs it. */
export function stashOf(hero) {
  hero.stash ??= createPack({ capacity: STASH_SLOTS, prefix: 'sth' });
  return hero.stash;
}

/** How full the stash is, for the Town Hub's hint and the screen's label. */
export function stashUse(hero) {
  const stash = stashOf(hero);
  return { used: slotsUsed(stash), total: stash.capacity };
}

/** Why this cannot be put away, or null. */
export function whyNotStore(hero, instanceId, count = 1) {
  const pack = hero.pack;
  const instance = entryOf(pack, instanceId);
  if (!instance) return 'notCarried';
  if (instance.bound) return 'cursedInPlace';
  if (isEquipped(pack, instanceId)) return 'worn';
  const stash = stashOf(hero);
  if (slotsUsed(stash) + slotsFor(instance.baseId, count) > stash.capacity) return 'stashFull';
  return null;
}

/** Why this cannot be taken back out, or null. */
export function whyNotWithdraw(hero, instanceId, count = 1) {
  const stash = stashOf(hero);
  const instance = entryOf(stash, instanceId);
  if (!instance) return 'notStored';
  if (slotsUsed(hero.pack) + slotsFor(instance.baseId, count) > hero.pack.capacity) return 'packFull';
  return null;
}

/**
 * Moves one entry from one pack to another, keeping everything it was: a
 * cursed sword is still cursed, an unknown potion still unknown.
 * @returns {{ ok: boolean, why?: string, moved?: number, entry?: object }}
 */
function move(from, to, instanceId, count) {
  const instance = entryOf(from, instanceId);
  const moving = Math.min(instance.count ?? 1, count);
  const { instanceId: _id, count: _count, ...rest } = instance;
  const { added, entry } = addItem(to, instance.baseId, { count: moving, ...rest });
  if (added === 0) return { ok: false, why: 'stashFull' };
  removeItem(from, instanceId, added);
  return { ok: true, moved: added, entry };
}

/** Puts something away (`04` section 1). */
export function store(hero, instanceId, count = 1) {
  const why = whyNotStore(hero, instanceId, count);
  if (why) return { ok: false, why };
  return move(hero.pack, stashOf(hero), instanceId, count);
}

/** Takes something back out. */
export function withdraw(hero, instanceId, count = 1) {
  const why = whyNotWithdraw(hero, instanceId, count);
  if (why) return { ok: false, why };
  return move(stashOf(hero), hero.pack, instanceId, count);
}

/** Everything the hero could put away, in pack order. */
export function storable(hero) {
  return (hero.pack?.items ?? []).filter((entry) => !whyNotStore(hero, entry.instanceId, entry.count));
}
