/**
 * The kit a hero starts with (`01` section 3), now made of `04`'s own items.
 *
 * The kit is handed over as a pack: the two equipped pieces go into their
 * slots, and the rest is carried. These are the tests that stop the hand-over
 * and the gear's effect on the sheet from drifting from the two documents.
 */
import { describe, it, expect } from 'vitest';
import { equipKit, gearDef, kitOf, refreshGear } from '../src/systems/kit.js';
import { entryOf, equipNew, packItems, slotsUsed, unequip } from '../src/systems/inventory.js';
import { ORIGIN_ORDER, ORIGINS } from '../src/data/origins.js';
import { item } from '../src/data/items.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { rebuildSheet, levelUp } from '../src/systems/levelling.js';
import { defenseFor } from '../src/systems/derived.js';
import { learn } from '../src/systems/skill-tree.js';

const SCORES = { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 };

function hero(origin = 'sellsword') {
  return finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores: SCORES }, origin), 'Harrow'),
  );
}

/** A fixed roll, so a level-up is not a dice test. */
const die = (n) => ({ roll: () => n, dice: () => n, die: () => n, d20: () => n });

describe('what the four origins carry', () => {
  it('names an item in the database on every kit line', () => {
    for (const id of ORIGIN_ORDER) {
      for (const entry of ORIGINS[id].kit) {
        expect([id, entry.item, Boolean(item(entry.item))]).toEqual([id, entry.item, true]);
      }
    }
  });

  it("gives the Sellsword 04's long sword and leather", () => {
    const { weapon, armor } = kitOf('sellsword');
    expect(weapon).toMatchObject({ id: 'long_sword', damage: '1d8', damageType: 'slash' });
    expect(armor).toMatchObject({ id: 'leather_armor', def: 2 });
  });

  it('gives the Apprentice a staff and a robe that adds nothing', () => {
    const { weapon, armor } = kitOf('apprentice');
    expect(weapon).toMatchObject({ id: 'staff', damage: '1d6', damageType: 'crush' });
    expect(armor).toMatchObject({ id: 'robe', def: 0 });
  });

  it('carries everything else in the pack, and counts its slots', () => {
    // The Cutpurse: a short sword worn, then three daggers, picks and a pole.
    const who = hero('cutpurse');
    expect(packItems(who.pack)).toHaveLength(6);
    expect(slotsUsed(who.pack)).toBe(6);
    // The Sellsword's two rations are one stack in one slot.
    const sellsword = hero();
    expect(slotsUsed(sellsword.pack)).toBe(1);
    expect(packItems(sellsword.pack).find((entry) => entry.baseId === 'ration').count).toBe(2);
  });

  it('leaves an origin with no armour bare', () => {
    // The Cutpurse's kit is a short sword, daggers, picks and a pole.
    expect(kitOf('cutpurse').armor).toBe(null);
    expect(gearDef({ origin: 'cutpurse' })).toBe(0);
    expect(hero('cutpurse').gear.def).toBe(0);
  });
});

describe('a hero who has just been made', () => {
  it('is holding their weapon and wearing their armour', () => {
    const who = hero();
    expect(who.attack).toMatchObject({ damage: '1d8 slash', kind: 'melee' });
    expect(who.armor).toMatchObject({ def: 2 });
    expect(who.weapon.baseId).toBe('long_sword');
    // Equipped gear costs no slots (`04` section 1).
    expect(slotsUsed(who.pack)).toBe(1);
  });

  it('puts the weapon down when it is taken off, and picks it up again', () => {
    const who = hero();
    const sword = who.pack.equipped.weapon;
    expect(unequip(who.pack, 'weapon')).toEqual({ ok: true });
    refreshGear(who);
    expect(who.weapon).toBe(null);
    expect(who.attack.damage).toBe('1d2 crush');
    expect(slotsUsed(who.pack)).toBe(2);
    expect(entryOf(who.pack, sword)).toBeTruthy();
  });

  it('counts the armour in DEF (01 section 4: 10 + AGI mod + armor)', () => {
    const who = hero();
    expect(who.def).toBe(defenseFor(who.attributes, 2));
    expect(hero('cutpurse').def).toBe(defenseFor(hero('cutpurse').attributes, 0));
  });

  it('is equipped by `equipKit` alone, so nothing else has to know', () => {
    const bare = { origin: 'pilgrim', attributes: SCORES, slots: 12 };
    equipKit(bare);
    expect(bare.attack.damage).toBe('1d6 crush');
    expect(bare.armor.def).toBe(2);
    expect(bare.gear).toMatchObject({ def: 2, heavyArmor: false, shield: false });
  });
});

describe('the armour, over a hero life', () => {
  it('is added to DEF once, however many times the sheet is rebuilt', () => {
    const who = hero();
    const def = who.def;
    for (let i = 0; i < 5; i += 1) rebuildSheet(who);
    expect(who.def).toBe(def);
  });

  it('survives a level, and a skill that also moves DEF', () => {
    const who = hero();
    const def = who.def;
    levelUp(who, die(3));
    expect(who.def).toBe(def);

    who.skillPoints = 4;
    learn(who, 'marksman'); // a Shadow point, so Evasion's tier opens
    learn(who, 'sneak');
    learn(who, 'lockpicking');
    learn(who, 'evasion');
    // Evasion is +1 DEF per rank, on top of the leather.
    expect(who.def).toBe(def + 1);
  });
});

describe('what the gear does to the sheet (04 sections 2 and 3)', () => {
  it('caps the AGI mod heavy armour lets through (Max AGI mod)', () => {
    const nimble = { ...SCORES, agility: 18 }; // a +3 AGI mod
    const who = finish(
      setName(chooseOrigin({ ...createDraft({ seed: 4 }), scores: nimble }, 'cutpurse'), 'Vex'),
    );
    const bare = who.def;
    expect(bare).toBe(defenseFor(nimble, 0));

    equipNew(who.pack, 'chain_mail'); // +4 DEF, and the AGI mod counts only +2
    rebuildSheet(who);
    expect(who.def).toBe(defenseFor(nimble, 4, 2));
    expect(who.def).toBe(bare + 4 - 1);
  });

  it('takes the heavy to-hit penalty, and Armor Training takes it away', () => {
    const who = hero();
    const plain = who.attacks.melee;
    equipNew(who.pack, 'plate'); // -2 to hit, 20% spell fizzle
    rebuildSheet(who);
    expect(who.attacks.melee).toBe(plain - 2);
    expect(who.spellFizzle).toBe(0.2);

    who.skillPoints = 4;
    learn(who, 'weapon_training');
    learn(who, 'toughness');
    learn(who, 'brute_force');
    learn(who, 'armor_training');
    // Weapon Training is +1 melee; the armour's -2 is gone.
    expect(who.attacks.melee).toBe(plain + 1);
    expect(who.spellFizzle).toBe(0);
  });

  it('takes -2 to hit for a requirement it does not meet, and keeps the DEF', () => {
    const weak = { ...SCORES, might: 8 }; // under Plate's MIG 13
    const who = finish(
      setName(chooseOrigin({ ...createDraft({ seed: 6 }), scores: weak }, 'apprentice'), 'Ora'),
    );
    const plain = who.attacks.melee;
    equipNew(who.pack, 'plate');
    rebuildSheet(who);
    // -2 for the heavy armour and -2 again for the requirement.
    expect(who.attacks.melee).toBe(plain - 4);
    expect(who.gear.unmet).toHaveLength(1);
    expect(who.def).toBe(defenseFor(who.attributes, 6, 1));
  });

  it("adds a weapon's own bonus to the line it is swung with", () => {
    const who = hero();
    const melee = who.attacks.melee;
    const ranged = who.attacks.ranged;
    equipNew(who.pack, 'crossbow'); // +1 to hit, and it is a ranged weapon
    rebuildSheet(who);
    expect(who.attacks.ranged).toBe(ranged + 1);
    expect(who.attacks.melee).toBe(melee);
    expect(who.attack.kind).toBe('ranged');
  });
});
