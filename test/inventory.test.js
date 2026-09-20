/**
 * The pack (`04` section 1).
 *
 * Slots, stacking, the four equipment slots and the four quick slots, plus the
 * two rules that make equipping more than a swap: a two-handed weapon blocks
 * the off-hand, and a cursed item cannot be taken off.
 */
import { describe, it, expect } from 'vitest';
import {
  EQUIP_SLOTS,
  QUICK_SLOTS,
  STASH_SLOTS,
  addItem,
  attackWith,
  canAdd,
  capacityFor,
  createPack,
  entryOf,
  equip,
  equipNew,
  equipSlotFor,
  equippedItem,
  gearSummary,
  isConsumable,
  isEquipped,
  isTwoHanded,
  pin,
  quickItems,
  removeItem,
  slotsFree,
  slotsUsed,
  unequip,
  unpin,
  whyNotEquip,
  whyNotPin,
} from '../src/systems/inventory.js';
import { t } from '../src/data/strings.js';

/** A pack with room for the test at hand. */
const pack = (capacity = 14) => createPack({ capacity });

describe('slots and stacking (04 section 1)', () => {
  it('sizes items the way the table does', () => {
    const p = pack();
    addItem(p, 'long_sword');
    expect(slotsUsed(p)).toBe(1);
    addItem(p, 'great_sword');
    expect(slotsUsed(p)).toBe(3);
    addItem(p, 'tower_shield');
    expect(slotsUsed(p)).toBe(6);
    addItem(p, 'plate');
    expect(slotsUsed(p)).toBe(10);
    expect(slotsFree(p)).toBe(4);
  });

  it('stacks consumables five to a slot and valuables ten', () => {
    const p = pack();
    expect(addItem(p, 'torch', { count: 5 }).added).toBe(5);
    expect(slotsUsed(p)).toBe(1);
    addItem(p, 'torch');
    // Six torches are one stack that needs two slots.
    expect(p.items.filter((entry) => entry.baseId === 'torch')).toHaveLength(1);
    expect(slotsUsed(p)).toBe(2);

    addItem(p, 'quartz', { count: 10 });
    expect(slotsUsed(p)).toBe(3);
    addItem(p, 'quartz');
    expect(slotsUsed(p)).toBe(4);
  });

  it('keeps items that do not stack apart, one entry each', () => {
    const p = pack();
    expect(addItem(p, 'dagger', { count: 3 }).added).toBe(3);
    expect(p.items).toHaveLength(3);
    expect(slotsUsed(p)).toBe(3);
  });

  it('never stacks a rolled item with a plain one', () => {
    const p = pack();
    addItem(p, 'healing_potion', { count: 2 });
    addItem(p, 'healing_potion', { count: 1, identified: false });
    addItem(p, 'oil_flask', { count: 1, bonus: 1 });
    addItem(p, 'oil_flask', { count: 1 });
    expect(p.items.filter((entry) => entry.baseId === 'healing_potion')).toHaveLength(2);
    expect(p.items.filter((entry) => entry.baseId === 'oil_flask')).toHaveLength(2);
  });

  it('fills what room there is and hands back the rest', () => {
    const p = pack(3);
    const { added, left } = addItem(p, 'long_sword', { count: 5 });
    expect([added, left]).toEqual([3, 2]);
    expect(canAdd(p, 'dagger')).toMatchObject({ ok: false, why: 'packFull' });
    expect(canAdd(p, 'torch')).toMatchObject({ ok: false });
  });

  it('takes items out, and forgets an entry when the last one goes', () => {
    const p = pack();
    const { entry } = addItem(p, 'torch', { count: 5 });
    expect(removeItem(p, entry.instanceId, 2)).toMatchObject({ removed: 2 });
    expect(entryOf(p, entry.instanceId).count).toBe(3);
    expect(removeItem(p, entry.instanceId).removed).toBe(3);
    expect(entryOf(p, entry.instanceId)).toBe(null);
    expect(removeItem(p, 'itm_9999')).toEqual({ removed: 0, entry: null });
  });

  it('gives a pack the hero’s own slot count, and the stash its fifty', () => {
    expect(capacityFor({ slots: 16 })).toBe(16);
    expect(capacityFor(null)).toBe(10);
    expect(STASH_SLOTS).toBe(50);
    expect(createPack({ capacity: STASH_SLOTS }).capacity).toBe(50);
  });
});

describe('the four equipment slots (04 section 1)', () => {
  it('sends each kind of item to its own slot', () => {
    expect(EQUIP_SLOTS).toEqual(['weapon', 'offHand', 'armor', 'charm']);
    expect(equipSlotFor('long_sword')).toBe('weapon');
    expect(equipSlotFor('tower_shield')).toBe('offHand');
    expect(equipSlotFor('plate')).toBe('armor');
    expect(equipSlotFor('ring_of_protection')).toBe('charm');
    expect(equipSlotFor('healing_potion')).toBe(null);
    expect(equipSlotFor('torch')).toBe(null);
  });

  it('costs no slots to wear what you carry', () => {
    const p = pack();
    const { entry } = addItem(p, 'plate');
    expect(slotsUsed(p)).toBe(4);
    expect(equip(p, entry.instanceId)).toMatchObject({ ok: true, slot: 'armor' });
    expect(slotsUsed(p)).toBe(0);
    expect(isEquipped(p, entry.instanceId)).toBe(true);
    expect(equippedItem(p, 'armor')).toMatchObject({ baseId: 'plate', def: 6 });
  });

  it('puts what it replaces back in the pack', () => {
    const p = pack();
    const first = addItem(p, 'leather_armor').entry;
    const second = addItem(p, 'chain_mail').entry;
    equip(p, first.instanceId);
    const swap = equip(p, second.instanceId);
    expect(swap.replaced).toEqual([first.instanceId]);
    expect(isEquipped(p, first.instanceId)).toBe(false);
    expect(slotsUsed(p)).toBe(2); // the leather, back in the pack
  });

  it('refuses a swap that would leave the pack unable to hold what comes off', () => {
    const p = pack(4);
    equipNew(p, 'chain_mail'); // four slots' worth, worn, so none used
    const lighter = addItem(p, 'studded_leather').entry; // two slots
    addItem(p, 'dagger', { count: 2 }); // and the last two
    expect(slotsFree(p)).toBe(0);
    // Wearing the lighter armour frees 2 slots and needs 4 for the chain mail.
    expect(whyNotEquip(p, lighter.instanceId)).toBe('packFull');
    expect(equip(p, lighter.instanceId)).toMatchObject({ ok: false, why: 'packFull' });
  });

  it('gives a two-handed weapon both hands', () => {
    const p = pack();
    expect(isTwoHanded('great_sword')).toBe(true);
    expect(isTwoHanded('long_sword')).toBe(false);
    const shield = addItem(p, 'shield').entry;
    const sword = addItem(p, 'great_sword').entry;
    equip(p, shield.instanceId);
    const held = equip(p, sword.instanceId);
    expect(held.replaced).toEqual([shield.instanceId]);
    expect(p.equipped.offHand).toBe(null);
    // And it cannot go back on while the sword is held.
    expect(whyNotEquip(p, shield.instanceId)).toBe('bothHands');
  });

  it('will not equip what is not equipment, or what is not carried', () => {
    const p = pack();
    const potion = addItem(p, 'healing_potion').entry;
    expect(whyNotEquip(p, potion.instanceId)).toBe('notEquipment');
    expect(whyNotEquip(p, 'itm_9999')).toBe('notCarried');
    const sword = addItem(p, 'long_sword').entry;
    equip(p, sword.instanceId);
    expect(whyNotEquip(p, sword.instanceId)).toBe('alreadyWorn');
  });

  it('keeps a cursed item on, and refuses the swap that would take it off', () => {
    const p = pack();
    const cursed = addItem(p, 'long_sword', { curse: 'leaden', bonus: -1 }).entry;
    equip(p, cursed.instanceId);
    cursed.bound = true; // what equipping a cursed item does (`04` section 6)
    expect(unequip(p, 'weapon')).toMatchObject({ ok: false, why: 'cursedInPlace' });
    const other = addItem(p, 'mace').entry;
    expect(whyNotEquip(p, other.instanceId)).toBe('cursedInPlace');
  });

  it('takes gear off when there is room, and says so when there is not', () => {
    const p = pack(2);
    const armor = equipNew(p, 'chain_mail'); // 4 slots, more than the pack has
    expect(slotsUsed(p)).toBe(0);
    expect(unequip(p, 'armor')).toMatchObject({ ok: false, why: 'packFull' });
    expect(unequip(p, 'charm')).toMatchObject({ ok: false, why: 'nothingThere' });
    p.capacity = 8;
    expect(unequip(p, 'armor')).toEqual({ ok: true });
    expect(entryOf(p, armor.instanceId)).toBeTruthy();
    expect(slotsUsed(p)).toBe(4);
  });

  it('swings what is held, and fists when nothing is', () => {
    const p = pack();
    expect(attackWith(p)).toMatchObject({ damage: '1d2 crush', kind: 'melee' });
    equipNew(p, 'shortbow');
    expect(attackWith(p)).toMatchObject({ damage: '1d6 pierce', kind: 'ranged' });
  });
});

describe('the four quick slots (04 section 1)', () => {
  it('pins up to four consumables', () => {
    const p = pack();
    expect(QUICK_SLOTS).toBe(4);
    // Five different consumables: the same kind would be one stack, and a
    // stack is pinned once.
    const ids = ['oil_flask', 'fire_pot', 'healing_potion', 'antidote', 'smoke_bomb'].map(
      (id) => addItem(p, id).entry.instanceId,
    );
    for (let i = 0; i < 4; i += 1) expect(pin(p, ids[i])).toMatchObject({ ok: true, index: i });
    expect(whyNotPin(p, ids[4])).toBe('quickFull');
    expect(pin(p, ids[4])).toMatchObject({ ok: false, why: 'quickFull' });

    expect(unpin(p, 1)).toEqual({ ok: true });
    expect(pin(p, ids[4])).toMatchObject({ ok: true, index: 1 });
    expect(unpin(p, 9)).toMatchObject({ ok: false, why: 'noSuchSlot' });
  });

  it('knows what a consumable is', () => {
    expect(isConsumable('healing_potion')).toBe(true);
    expect(isConsumable('scroll_of_light')).toBe(true);
    expect(isConsumable('fire_pot')).toBe(true);
    expect(isConsumable('torch')).toBe(true);
    expect(isConsumable('long_sword')).toBe(false);
    expect(isConsumable('rope')).toBe(false);
  });

  it('will not pin a weapon, and drops the pin when the item goes', () => {
    const p = pack();
    const sword = addItem(p, 'long_sword').entry;
    expect(whyNotPin(p, sword.instanceId)).toBe('notConsumable');

    const potion = addItem(p, 'healing_potion', { count: 2 }).entry;
    pin(p, potion.instanceId);
    expect(quickItems(p)[0]).toMatchObject({ baseId: 'healing_potion', name: 'Healing Potion' });
    removeItem(p, potion.instanceId, 1);
    expect(p.quick[0]).toBe(potion.instanceId); // one is left, so it stays pinned
    removeItem(p, potion.instanceId, 1);
    expect(p.quick[0]).toBe(null);
    expect(quickItems(p)[0]).toBe(null);
  });

  it('unpins an item that is equipped instead', () => {
    const p = pack();
    const charm = addItem(p, 'ring_of_protection').entry;
    expect(whyNotPin(p, charm.instanceId)).toBe('notConsumable');
    const flask = addItem(p, 'oil_flask').entry;
    pin(p, flask.instanceId);
    expect(p.quick[0]).toBe(flask.instanceId);
  });
});

describe('what the gear adds up to (04 sections 2 and 3)', () => {
  const strong = { might: 15, agility: 16, vigor: 12, intellect: 10, wits: 10, luck: 10 };

  it('adds the DEF of armour and shield, and the lowest Max AGI of the two', () => {
    const p = pack();
    equipNew(p, 'scale_mail'); // +5, Max AGI +1
    equipNew(p, 'tower_shield'); // +2
    const gear = gearSummary(p, { attributes: strong });
    expect(gear).toMatchObject({ def: 7, maxAgi: 1, heavyArmor: true, shield: true });
    expect(gear.stealth).toBe(-5);
    expect(gear.fizzle).toBeCloseTo(0.2);
    expect(gear.heavyToHit).toBe(-2);
  });

  it('counts a magic bonus as DEF, and a weapon’s on its own line', () => {
    const p = pack();
    equipNew(p, 'leather_armor', { bonus: 2 });
    equipNew(p, 'crossbow', { bonus: 1 });
    const gear = gearSummary(p, { attributes: strong });
    expect(gear.def).toBe(4);
    expect(gear.weaponToHit).toEqual({ melee: 0, ranged: 2 });
  });

  it('marks gear the hero cannot really use, and still keeps its DEF', () => {
    const p = pack();
    const weak = { ...strong, might: 8 };
    const armor = equipNew(p, 'plate');
    const gear = gearSummary(p, { attributes: weak });
    expect(gear.def).toBe(6);
    expect(gear.toHit).toBe(-2);
    expect(gear.unmet).toEqual([armor.instanceId]);
    // The same hero who meets it takes no penalty.
    expect(gearSummary(p, { attributes: { ...strong, might: 13 } }).toHit).toBe(0);
  });

  it('is empty for a hero with nothing on', () => {
    expect(gearSummary(pack(), { attributes: strong })).toMatchObject({
      def: 0,
      maxAgi: null,
      toHit: 0,
      heavyArmor: false,
      shield: false,
      twoHanded: false,
      unmet: [],
    });
  });
});

describe('the words a refusal shows', () => {
  /** Every `why` the module can answer with (CLAUDE.md: disabled buttons say why). */
  const REASONS = [
    'packFull',
    'notCarried',
    'notEquipment',
    'alreadyWorn',
    'bothHands',
    'cursedInPlace',
    'nothingThere',
    'notConsumable',
    'worn',
    'alreadyPinned',
    'quickFull',
    'noSuchSlot',
  ];

  it('has a line in strings.json for every reason', () => {
    for (const reason of REASONS) {
      const key = `pack.why.${reason}`;
      expect([reason, t(key)]).not.toEqual([reason, key]);
    }
  });

  it('answers with one of them and nothing else', () => {
    const p = pack(1);
    const seen = new Set();
    seen.add(canAdd(p, 'plate').why);
    seen.add(whyNotEquip(p, 'itm_9999'));
    seen.add(whyNotPin(p, 'itm_9999'));
    seen.add(unequip(p, 'weapon').why);
    for (const why of seen) expect(REASONS).toContain(why);
  });
});
