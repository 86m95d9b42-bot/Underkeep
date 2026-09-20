/**
 * The kit a hero starts with (`01` section 3), with `04`'s numbers.
 *
 * The pack is Phase 5; what a fight reads — the weapon's dice and the
 * armour's DEF — is here, and these are the tests that stop it drifting from
 * the two documents it comes from.
 */
import { describe, it, expect } from 'vitest';
import { KIT_ARMOR, KIT_WEAPONS, equipKit, gearDef, kitOf } from '../src/systems/kit.js';
import { ORIGIN_ORDER, ORIGINS } from '../src/data/origins.js';
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
  it('has a line for every equipped item in every kit', () => {
    for (const id of ORIGIN_ORDER) {
      for (const entry of ORIGINS[id].kit) {
        if (entry.equip === 'weapon') expect([id, KIT_WEAPONS[entry.item]]).toBeTruthy();
        if (entry.equip === 'armor') expect([id, KIT_ARMOR[entry.item]]).toBeTruthy();
      }
    }
  });

  it("gives the Sellsword 04's long sword and leather", () => {
    const { weapon, armor } = kitOf('sellsword');
    expect(weapon).toMatchObject({ id: 'long_sword', damage: '1d8 slash', kind: 'melee' });
    expect(armor).toMatchObject({ id: 'leather_armor', def: 2 });
  });

  it('gives the Apprentice a staff and a robe that adds nothing', () => {
    const { weapon, armor } = kitOf('apprentice');
    expect(weapon).toMatchObject({ id: 'staff', damage: '1d6 crush' });
    expect(armor).toMatchObject({ id: 'robe', def: 0 });
  });

  it('leaves an origin with no armour bare', () => {
    // The Cutpurse's kit is a short sword, daggers, picks and a pole.
    expect(kitOf('cutpurse').armor).toBe(null);
    expect(gearDef({ origin: 'cutpurse' })).toBe(0);
  });
});

describe('a hero who has just been made', () => {
  it('is holding their weapon and wearing their armour', () => {
    const who = hero();
    expect(who.attack).toMatchObject({ damage: '1d8 slash', kind: 'melee' });
    expect(who.armor).toMatchObject({ def: 2 });
  });

  it('counts the armour in DEF (01 section 4: 10 + AGI mod + armor)', () => {
    const who = hero();
    expect(who.def).toBe(defenseFor(who.attributes, 2));
    expect(hero('cutpurse').def).toBe(defenseFor(hero('cutpurse').attributes, 0));
  });

  it('is equipped by `equipKit` alone, so nothing else has to know', () => {
    const bare = { origin: 'pilgrim', attributes: SCORES };
    equipKit(bare);
    expect(bare.attack.damage).toBe('1d6 crush');
    expect(bare.armor.def).toBe(2);
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
