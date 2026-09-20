/**
 * The pack (`04` section 1: Inventory, Equipment Slots and Quick Slots).
 *
 * A pack is plain data, so it saves and loads as it is:
 *
 * ```js
 * {
 *   capacity: 14,                       // 10 + (MIG mod x 2), kept in step
 *   items: [{ instanceId, baseId, count, identified, bonus, property, curse }],
 *   equipped: { weapon, offHand, armor, charm },   // instance ids
 *   quick: [id, null, null, null],                 // up to four consumables
 *   nextId: 7,
 * }
 * ```
 *
 * Four rules do most of the work, and all four are the document's:
 *
 *   - **Slots.** A one-handed weapon takes 1, a two-handed weapon or light
 *     armour 2, a tower shield 3, heavy armour 4. Consumables stack 5 to a
 *     slot and valuables 10, so a stack of 7 torches takes 2. Gold takes none.
 *   - **Equipped items cost no slots.** They are still in `items`; the slot
 *     count skips them. That way an id means one thing wherever it is used.
 *   - **Two-handed weapons block the off-hand**, and a shield cannot go on
 *     while one is held.
 *   - **A cursed item cannot be taken off** once it has bound itself
 *     (`04` section 6; what binds it is the identification task).
 *
 * Nothing here rolls and nothing here touches the DOM. Every refusal comes
 * back as a `why` key for `strings.json`, the way `locks.js` answers.
 */
import { CURSES, ITEM_RULES, MAGIC, item, itemOf, slotsFor, stackOf } from '../data/items.js';

/** The four equipment slots, in the document's order. */
export const EQUIP_SLOTS = ITEM_RULES.equipSlots;

/** How many consumables can be pinned to the combat bar. */
export const QUICK_SLOTS = ITEM_RULES.quickSlots;

/** The Town Stash, which is a pack of its own (`04` section 1, Phase 6). */
export const STASH_SLOTS = ITEM_RULES.stashSlots;

/** What the hero swings with when both hands are empty. */
export const UNARMED = ITEM_RULES.unarmed;

/** A fresh, empty pack. */
export function createPack({ capacity = ITEM_RULES.inventory.base, prefix = 'itm' } = {}) {
  return {
    capacity,
    // Ids are handed out per pack, so a second one — the Town Stash — takes a
    // prefix of its own and an id can never mean two things at once.
    prefix,
    items: [],
    equipped: Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, null])),
    quick: Array.from({ length: QUICK_SLOTS }, () => null),
    nextId: 1,
  };
}

/** How many slots a pack holds: 10 + (MIG mod x 2), from the hero's sheet. */
export function capacityFor(hero) {
  return hero?.slots ?? ITEM_RULES.inventory.base;
}

/** The next instance id, in the shape `04` section 17 gives (`itm_0007`). */
function nextInstanceId(pack) {
  const id = `${pack.prefix ?? 'itm'}_${String(pack.nextId).padStart(4, '0')}`;
  pack.nextId += 1;
  return id;
}

/** Every entry in the pack, equipped ones included. */
export function packItems(pack) {
  return pack.items;
}

/** One entry by its instance id, or null. */
export function entryOf(pack, instanceId) {
  return pack.items.find((entry) => entry.instanceId === instanceId) ?? null;
}

/** True while this entry is worn or held. */
export function isEquipped(pack, instanceId) {
  return Object.values(pack.equipped).includes(instanceId);
}

/** Which equipped slot an entry is in, or null. */
export function slotOf(pack, instanceId) {
  return EQUIP_SLOTS.find((slot) => pack.equipped[slot] === instanceId) ?? null;
}

/** How many slots one entry takes up: its size, times the stacks it needs. */
export function slotsOfEntry(pack, entry) {
  if (isEquipped(pack, entry.instanceId)) return 0;
  return slotsFor(entry.baseId, entry.count ?? 1);
}

/** How many slots the pack is using (`04` section 1). */
export function slotsUsed(pack) {
  return pack.items.reduce((total, entry) => total + slotsOfEntry(pack, entry), 0);
}

/** How many slots are left. */
export function slotsFree(pack) {
  return pack.capacity - slotsUsed(pack);
}

/** The slot an item goes in, or null for something that cannot be equipped. */
export function equipSlotFor(baseId) {
  switch (item(baseId).category) {
    case 'weapon':
      return 'weapon';
    case 'shield':
      return 'offHand';
    case 'armor':
      return 'armor';
    case 'charm':
      return 'charm';
    default:
      return null;
  }
}

/** True for a two-handed weapon, which also blocks the off-hand. */
export function isTwoHanded(baseId) {
  return (itemOf(baseId).properties ?? []).includes('twoHanded');
}

/**
 * True for something that can be pinned to the combat bar: a potion, a scroll
 * or a bomb, or a piece of gear that is used up in one go.
 */
export function isConsumable(baseId) {
  const entry = item(baseId);
  if (['potion', 'scroll', 'bomb'].includes(entry.category)) return true;
  return entry.category === 'gear' && Boolean(entry.use);
}

/** Two entries stack only if they are the same plain, known item. */
function sameStack(entry, made) {
  if (entry.baseId !== made.baseId) return false;
  if (stackOf(entry.baseId) <= 1) return false;
  // Anything that carries a roll of its own is its own item, even where the
  // base is the same: a +1 dagger never joins a pile of daggers.
  for (const key of ['bonus', 'property', 'curse']) {
    if ((entry[key] ?? null) !== (made[key] ?? null)) return false;
  }
  return Boolean(entry.identified) === Boolean(made.identified);
}

/**
 * An instance as it will be held, before it has an id: the defaults matter,
 * because whether two items stack is decided on these fields.
 */
function asHeld(baseId, { count = 1, identified = true, ...rest } = {}) {
  item(baseId); // throws on an id that does not exist
  return { baseId, count, identified, ...rest };
}

/** A new instance of a base item, not yet in any pack (`04` section 17). */
function makeInstance(pack, baseId, options = {}) {
  return { instanceId: nextInstanceId(pack), ...asHeld(baseId, options) };
}

/**
 * Whether `count` of an item would fit, and what stops it.
 * @returns {{ ok: boolean, why?: string, slots: number }}
 */
export function canAdd(pack, baseId, { count = 1, ...rest } = {}) {
  const made = asHeld(baseId, rest);
  const existing = pack.items.find((entry) => sameStack(entry, made));
  const before = existing ? slotsFor(baseId, existing.count) : 0;
  const after = existing ? slotsFor(baseId, existing.count + count) : slotsFor(baseId, count);
  const needed = after - before;
  if (needed > slotsFree(pack)) return { ok: false, why: 'packFull', slots: needed };
  return { ok: true, slots: needed };
}

/**
 * Puts an item in the pack, merging it into a stack where it belongs.
 *
 * What does not fit is handed back rather than lost, which is what the loot
 * popup offers to drop or swap (`04` section 16).
 *
 * @param {object} pack
 * @param {string} baseId
 * @param {object} [options] `count`, and anything the instance carries
 * @returns {{ added: number, left: number, entry: object | null }}
 */
export function addItem(pack, baseId, { count = 1, ...rest } = {}) {
  const made = asHeld(baseId, rest);
  const stacks = stackOf(baseId) > 1;

  // One at a time, so a stack that half fits goes half in. Anything that does
  // not stack becomes its own entry: three daggers are three daggers, and any
  // one of them can be the one that is thrown.
  let added = 0;
  let entry = null;
  for (let i = 0; i < count; i += 1) {
    if (!canAdd(pack, baseId, { count: 1, ...rest }).ok) break;
    const existing = stacks ? pack.items.find((held) => sameStack(held, made)) : null;
    if (existing) existing.count += 1;
    else pack.items.push(makeInstance(pack, baseId, { count: 1, ...rest }));
    entry = existing ?? pack.items[pack.items.length - 1];
    added += 1;
  }

  return { added, left: count - added, entry };
}

/**
 * Takes items out. Removing the last of a stack removes the entry, takes it
 * off if it was worn, and clears any quick slot pointing at it.
 * @returns {{ removed: number, entry: object | null }}
 */
export function removeItem(pack, instanceId, count = Infinity) {
  const entry = entryOf(pack, instanceId);
  if (!entry) return { removed: 0, entry: null };

  const removed = Math.min(entry.count ?? 1, count);
  entry.count -= removed;
  if (entry.count <= 0) {
    pack.items = pack.items.filter((held) => held !== entry);
    for (const slot of EQUIP_SLOTS) if (pack.equipped[slot] === instanceId) pack.equipped[slot] = null;
    for (const [index, pinned] of pack.quick.entries()) if (pinned === instanceId) pack.quick[index] = null;
    return { removed, entry: null };
  }
  return { removed, entry };
}

/** The item in one equipment slot, base and instance together, or null. */
export function equippedItem(pack, slot) {
  const id = pack.equipped[slot];
  if (!id) return null;
  const entry = entryOf(pack, id);
  return entry ? { ...itemOf(entry.baseId), ...entry } : null;
}

/** Everything the hero is wearing or holding, by slot. */
export function equippedItems(pack) {
  return Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, equippedItem(pack, slot)]));
}

/**
 * Why this item cannot be equipped, or null when it can. A requirement the
 * hero does not meet is **not** a refusal: `04` says they may wear it and take
 * -2 to hit, which `gearSummary` reports.
 */
export function whyNotEquip(pack, instanceId) {
  const entry = entryOf(pack, instanceId);
  if (!entry) return 'notCarried';
  const slot = equipSlotFor(entry.baseId);
  if (!slot) return 'notEquipment';
  if (isEquipped(pack, instanceId)) return 'alreadyWorn';

  // Taking off what is there has to be possible, and has to fit.
  const worn = pack.equipped[slot];
  if (worn && entryOf(pack, worn)?.bound) return 'cursedInPlace';
  if (slot === 'offHand' && pack.equipped.weapon && isTwoHanded(entryOf(pack, pack.equipped.weapon).baseId)) {
    return 'bothHands';
  }
  const held = pack.equipped.offHand;
  if (slot === 'weapon' && isTwoHanded(entry.baseId) && held && entryOf(pack, held)?.bound) {
    return 'cursedInPlace';
  }

  // The swap has to leave the pack able to hold what comes off: the new item
  // stops taking slots, the old one starts.
  let freed = slotsFor(entry.baseId, entry.count);
  let needed = 0;
  if (worn) needed += slotsFor(entryOf(pack, worn).baseId, entryOf(pack, worn).count);
  if (slot === 'weapon' && isTwoHanded(entry.baseId) && held) {
    needed += slotsFor(entryOf(pack, held).baseId, entryOf(pack, held).count);
  }
  if (needed - freed > slotsFree(pack)) return 'packFull';
  return null;
}

/**
 * Wears or holds an item. Whatever it replaces goes back in the pack.
 * @returns {{ ok: boolean, why?: string, slot?: string, replaced: string[] }}
 */
export function equip(pack, instanceId) {
  const why = whyNotEquip(pack, instanceId);
  if (why) return { ok: false, why, replaced: [] };

  const entry = entryOf(pack, instanceId);
  const slot = equipSlotFor(entry.baseId);
  const replaced = [];

  if (pack.equipped[slot]) {
    replaced.push(pack.equipped[slot]);
    pack.equipped[slot] = null;
  }
  // Both hands on a great sword: the shield comes off with it.
  if (slot === 'weapon' && isTwoHanded(entry.baseId) && pack.equipped.offHand) {
    replaced.push(pack.equipped.offHand);
    pack.equipped.offHand = null;
  }
  pack.equipped[slot] = instanceId;
  // A cursed item binds itself the moment it goes on (`04` section 6), and
  // `unequip` is what refuses to take a bound item off.
  if (entry.curse) entry.bound = true;
  // Worn gear is not a pinned consumable.
  for (const [index, pinned] of pack.quick.entries()) if (pinned === instanceId) pack.quick[index] = null;
  return { ok: true, slot, replaced };
}

/**
 * Puts an item straight into a slot without it passing through the pack, which
 * is how a kit is handed over: equipped gear costs no slots, so a hero with a
 * heavy pack still starts out dressed.
 */
export function equipNew(pack, baseId, options = {}) {
  const slot = equipSlotFor(baseId);
  if (!slot) throw new Error(`${baseId} is not equipment`);
  const entry = makeInstance(pack, baseId, { ...options, count: 1 });
  pack.items.push(entry);
  if (pack.equipped[slot]) unequip(pack, slot);
  pack.equipped[slot] = entry.instanceId;
  if (entry.curse) entry.bound = true;
  if (slot === 'weapon' && isTwoHanded(baseId) && pack.equipped.offHand) unequip(pack, 'offHand');
  return entry;
}

/**
 * Takes something off. A cursed item that has bound itself stays on
 * (`04` section 6), and there has to be room for what comes off.
 * @returns {{ ok: boolean, why?: string }}
 */
export function unequip(pack, slot) {
  const id = pack.equipped[slot];
  if (!id) return { ok: false, why: 'nothingThere' };
  const entry = entryOf(pack, id);
  if (entry?.bound) return { ok: false, why: 'cursedInPlace' };
  if (slotsFor(entry.baseId, entry.count) > slotsFree(pack)) return { ok: false, why: 'packFull' };
  pack.equipped[slot] = null;
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Quick slots                                                                */
/* -------------------------------------------------------------------------- */

/** Why this item cannot be pinned to the combat bar, or null. */
export function whyNotPin(pack, instanceId) {
  const entry = entryOf(pack, instanceId);
  if (!entry) return 'notCarried';
  if (!isConsumable(entry.baseId)) return 'notConsumable';
  if (isEquipped(pack, instanceId)) return 'worn';
  if (pack.quick.includes(instanceId)) return 'alreadyPinned';
  if (!pack.quick.includes(null)) return 'quickFull';
  return null;
}

/**
 * Pins a consumable to the combat bar (`04` section 1). With no index it takes
 * the first free slot; with one it replaces what is there.
 * @returns {{ ok: boolean, why?: string, index?: number }}
 */
export function pin(pack, instanceId, index = null) {
  const entry = entryOf(pack, instanceId);
  if (!entry) return { ok: false, why: 'notCarried' };
  if (!isConsumable(entry.baseId)) return { ok: false, why: 'notConsumable' };
  if (isEquipped(pack, instanceId)) return { ok: false, why: 'worn' };
  if (pack.quick.includes(instanceId)) return { ok: true, index: pack.quick.indexOf(instanceId) };

  const at = index ?? pack.quick.indexOf(null);
  if (at === -1) return { ok: false, why: 'quickFull' };
  if (at < 0 || at >= QUICK_SLOTS) return { ok: false, why: 'noSuchSlot' };
  pack.quick[at] = instanceId;
  return { ok: true, index: at };
}

/** Clears one quick slot. */
export function unpin(pack, index) {
  if (!(index >= 0 && index < QUICK_SLOTS)) return { ok: false, why: 'noSuchSlot' };
  pack.quick[index] = null;
  return { ok: true };
}

/** The four quick slots, resolved to items (or null) for the combat bar. */
export function quickItems(pack) {
  return pack.quick.map((id) => {
    const entry = id ? entryOf(pack, id) : null;
    return entry ? { ...itemOf(entry.baseId), ...entry } : null;
  });
}

/* -------------------------------------------------------------------------- */
/* What the gear adds up to                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything the hero's worn gear does to their sheet, as one summary the
 * engine can read without knowing what an item is.
 *
 * `04` sections 2 and 3 are the whole of it: armour and shields give DEF and
 * cap the AGI mod that counts towards it; heavy armour and tower shields cost
 * to-hit and fizzle spells, which Armor Training cancels; a requirement the
 * hero does not meet costs -2 to hit, which nothing cancels.
 *
 * @param {object} pack
 * @param {object} [hero] for the requirement checks
 */
export function gearSummary(pack, hero = null) {
  const scores = hero?.attributes ?? {};
  const worn = equippedItems(pack);
  const summary = {
    def: 0,
    maxAgi: null,
    heavyToHit: 0,
    toHit: 0,
    weaponToHit: { melee: 0, ranged: 0 },
    fizzle: 0,
    stealth: 0,
    heavyArmor: false,
    shield: false,
    twoHanded: false,
    unmet: [],
  };

  const meets = (gear) =>
    Object.entries(gear.requires ?? {}).every(([attribute, score]) => (scores[attribute] ?? 0) >= score);

  for (const slot of ['armor', 'offHand']) {
    const gear = worn[slot];
    if (!gear) continue;
    // Featherlight, Shadowed and Spellwoven change what the armour costs to
    // wear rather than what the hero is (`04` section 4).
    const local = propertyEffects(gear).filter((effect) => GEAR_LOCAL.includes(effect.sheet));
    const waives = (key) => local.some((effect) => effect.sheet === key);
    const lighter = local.find((effect) => effect.sheet === 'maxAgi')?.value ?? 0;

    summary.def += (gear.def ?? 0) + (gear.bonus ?? 0);
    if (gear.maxAgi !== undefined) {
      const cap = gear.maxAgi + lighter;
      summary.maxAgi = summary.maxAgi === null ? cap : Math.min(summary.maxAgi, cap);
    }
    if (gear.heavy) summary.heavyArmor = true;
    if (slot === 'offHand') summary.shield = true;
    if (!gear.noPenalties) {
      summary.heavyToHit += gear.toHit ?? 0;
      if (!waives('noFizzle')) summary.fizzle += gear.fizzle ?? 0;
      if (!waives('noStealthPenalty')) summary.stealth += gear.stealth ?? 0;
    }
    if (!meets(gear) && !waives('noRequirement')) {
      summary.toHit += ITEM_RULES.requirementNotMet.toHit;
      summary.unmet.push(gear.instanceId);
    }
  }

  summary.effects = [...wornEffects(worn), ...carriedToolEffects(pack)];

  // A score a charm raises is raised before the sheet is derived from it: the
  // Lucky Coin's +1 LCK is a +1 to the score, capped where the charm says
  // (`04` section 7).
  summary.attributes = {};
  for (const effect of summary.effects) {
    if (effect.sheet !== 'attribute') continue;
    const at = effect.attribute;
    summary.attributes[at] = (summary.attributes[at] ?? 0) + (effect.value ?? 0);
    if (effect.max !== undefined) {
      const capped = Math.min((scores[at] ?? 0) + summary.attributes[at], effect.max);
      summary.attributes[at] = capped - (scores[at] ?? 0);
    }
  }

  const weapon = worn.weapon;
  if (weapon) {
    const kind = weapon.group === 'bow' ? 'ranged' : 'melee';
    summary.twoHanded = (weapon.properties ?? []).includes('twoHanded');
    summary.weaponToHit[kind] += (weapon.toHit ?? 0) + (weapon.bonus ?? 0);
    if (!meets(weapon)) {
      summary.weaponToHit[kind] += ITEM_RULES.requirementNotMet.toHit;
      summary.unmet.push(weapon.instanceId);
    }
  }
  return summary;
}

/**
 * Effects that change how the *item* is read rather than what the hero is, so
 * `gearSummary` answers them where it reads the item and they never reach the
 * sheet (`04` section 4's armour properties).
 */
const GEAR_LOCAL = ['noRequirement', 'maxAgi', 'noStealthPenalty', 'noFizzle'];

/** The effects of whatever property a piece of gear rolled. */
function propertyEffects(gear) {
  if (!gear?.property) return [];
  const table = ['armor', 'shield'].includes(gear.category)
    ? MAGIC.armorProperties
    : MAGIC.weaponProperties;
  return table.properties[gear.property]?.effects ?? [];
}

/**
 * Every effect the worn gear brings: the item's own, the property it rolled
 * and the curse it carries (`04` sections 4 and 6). They are gathered here
 * because the pack is what knows what is on; what each one *does* is the
 * sheet's and the hooks' business.
 *
 * An unidentified item's effects still work — `04` section 5 reveals a charm
 * after a hundred steps *or when it first triggers*, which it can only do if
 * it has been working all along.
 */
function wornEffects(worn) {
  const out = [];
  for (const [slot, gear] of Object.entries(worn)) {
    if (!gear) continue;
    const from = (effects, source) =>
      out.push(...effects.map((effect) => ({ ...effect, slot, source, item: gear.instanceId })));

    from(gear.effects ?? [], 'item');
    from(
      propertyEffects(gear).filter((effect) => !GEAR_LOCAL.includes(effect.sheet)),
      'property',
    );
    if (gear.curse) {
      const curse = CURSES.table.find((row) => row.id === gear.curse);
      from(curse?.effects ?? [], 'curse');
    }
  }
  return out;
}

/**
 * What the tools in the pack are worth. A crowbar, a set of lockpicks and a
 * ten-foot pole have no slot to be worn in — `04` section 1 gives the hero
 * four, and none of them is "tool" — so carrying one is using one, and its
 * `explore` effects count while it is in the pack.
 */
function carriedToolEffects(pack) {
  const out = [];
  for (const entry of pack.items) {
    if (isEquipped(pack, entry.instanceId)) continue;
    const base = item(entry.baseId);
    if (base.category !== 'gear') continue;
    for (const effect of base.effects ?? []) {
      if (effect.explore) out.push({ ...effect, source: 'carried', item: entry.instanceId });
    }
  }
  return out;
}

/** The attack the hero makes with what they are holding, or bare hands. */
export function attackWith(pack) {
  const weapon = equippedItem(pack, 'weapon');
  if (!weapon) {
    return { name: UNARMED.name, kind: 'melee', damage: `${UNARMED.damage} ${UNARMED.damageType}` };
  }
  return {
    name: weapon.name,
    kind: weapon.group === 'bow' ? 'ranged' : 'melee',
    damage: `${weapon.damage} ${weapon.damageType}`,
  };
}
