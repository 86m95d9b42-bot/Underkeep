/**
 * Cursed items (`04` section 6).
 *
 * A curse does three things: it binds the item to the hero, it takes
 * something away, and it can only be lifted two ways. All eight of the d8
 * table's curses are checked here against the thing they change.
 */
import { describe, it, expect } from 'vitest';
import {
  cleanseAtTemple,
  cleanseFee,
  cursedWorn,
  curseOf,
  isBound,
  removeCurses,
  takeOff,
  wear,
} from '../src/systems/gear.js';
import { addItem, createPack, entryOf, equipNew, slotsUsed, unequip } from '../src/systems/inventory.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import { afterCombat, isIdentified, isRevealed, nameOf } from '../src/systems/identification.js';
import { CURSES } from '../src/data/items.js';
import { legalityOf } from '../src/engine/actions.js';
import { encounterRange, wanderingBonus } from '../src/dungeon/step-clock.js';
import { calcDamage } from '../src/engine/damage.js';
import { createHooks } from '../src/engine/hooks.js';
import { carriedStreams } from '../src/engine/rng.js';

const SCORES = { might: 14, agility: 12, vigor: 13, intellect: 12, wits: 12, luck: 16 };

function hero(scores = SCORES) {
  return finish(setName(chooseOrigin({ ...createDraft({ seed: 2 }), scores }, 'sellsword'), 'Harrow'));
}

/** A hero wearing one cursed item, with everything re-derived. */
function wearing(curse, base = 'long_sword', extra = {}) {
  const who = hero();
  const before = { ...who, mods: { ...who.mods }, attacks: { ...who.attacks } };
  const entry = addItem(who.pack, base, { curse, bonus: -1, identified: false, ...extra }).entry;
  const put = wear(who, entry.instanceId);
  return { who, entry, put, before };
}

describe('binding (04 section 6)', () => {
  it('binds a cursed item the moment it goes on, and gives the curse away', () => {
    const { who, entry, put } = wearing('leaden');
    expect(put).toMatchObject({ ok: true, bound: true, cursed: true });
    expect(isBound(entry)).toBe(true);
    expect(isRevealed(entry, 'curse')).toBe(true);
    expect(nameOf(entry, who.identification)).toBe('Cursed Long Sword');
  });

  it('will not come off while it is bound', () => {
    const { who } = wearing('leaden');
    expect(takeOff(who, 'weapon')).toMatchObject({ ok: false, why: 'cursedInPlace' });
    expect(unequip(who.pack, 'weapon')).toMatchObject({ ok: false, why: 'cursedInPlace' });
  });

  it('binds an item put straight into its slot too', () => {
    const pack = createPack({ capacity: 10 });
    const ring = equipNew(pack, 'ring_of_protection', { curse: 'clumsy' });
    expect(isBound(ring)).toBe(true);
  });

  it('leaves an uncursed item free to come and go', () => {
    const who = hero();
    const entry = addItem(who.pack, 'chain_mail').entry;
    expect(wear(who, entry.instanceId)).toMatchObject({ ok: true, bound: false });
    expect(takeOff(who, 'armor')).toEqual({ ok: true });
  });
});

describe('what each of the eight curses does (04 section 6)', () => {
  it('has all eight, each with something to do', () => {
    expect(CURSES.table).toHaveLength(8);
    for (const row of CURSES.table) {
      expect([row.id, row.effects.length > 0]).toEqual([row.id, true]);
      expect(curseOf(row.id)).toMatchObject({ name: expect.any(String) });
    }
    expect(curseOf('nothing_like_this')).toBe(null);
  });

  it('Leaden: -2 initiative', () => {
    const { who, before } = wearing('leaden');
    expect(who.init).toBe(before.init - 2);
  });

  it('Clumsy: -1 DEF', () => {
    const { who, before } = wearing('clumsy');
    expect(who.def).toBe(before.def - 1);
  });

  it('Draining: -3 max Focus', () => {
    const { who, before } = wearing('draining');
    expect(who.maxFp).toBe(before.maxFp - 3);
    expect(who.fp).toBeLessThanOrEqual(who.maxFp);
  });

  it('Unlucky: -2 to the Luck modifier, and the crit range that hangs off it', () => {
    const { who, before } = wearing('unlucky');
    expect(before.mods.luck).toBe(2);
    expect(before.critFrom).toBe(19);
    expect(who.mods.luck).toBe(0);
    expect(who.critFrom).toBe(20);
  });

  it('Bloodthirsty: +2 damage, and no Defend and no Flee', () => {
    const { who, before } = wearing('bloodthirsty');
    expect(who.damageBonus).toBe(2);
    expect(before.damageBonus ?? 0).toBe(0);

    const combat = { rng: carriedStreams(1).combat, hooks: createHooks() };
    const attack = { kind: 'melee', damage: '0d6' };
    const { total } = calcDamage(combat, { attacker: who, target: { def: 10 }, attack });
    // No dice, so what lands is the Might mod plus the curse's own +2.
    expect(total).toBe(who.mods.might + 2);

    expect(who.cannot).toEqual(['defend', 'flee']);
    const field = { units: [], hero: who, rng: combat.rng };
    expect(legalityOf(field, who, { id: 'defend' })).toMatchObject({ legal: false, why: 'cursedGrip' });
    expect(legalityOf(field, who, { id: 'flee' })).toMatchObject({ legal: false, why: 'cursedGrip' });
    expect(legalityOf(field, who, { id: 'wait' }).legal).toBe(true);
  });

  it('Beacon: wandering monsters on a 1-2 instead of a 1', () => {
    const { who } = wearing('beacon');
    expect(who.explore.wanderingOn).toBe(2);
    expect(wanderingBonus(who)).toBe(1);
    expect(encounterRange(1, { bonus: wanderingBonus(who) })).toBe(2);
    expect(encounterRange(1)).toBe(1);
    // And a hero with no curse adds nothing.
    expect(wanderingBonus(hero())).toBe(0);
  });

  it('Hungering: camping takes two rations', () => {
    const { who } = wearing('hungering');
    expect(who.explore.campRations).toBe(2);
  });

  it('Gloom: light burns twice as fast', () => {
    const { who } = wearing('gloom');
    expect(who.explore.lightBurnRate).toBe(2);
  });

  it('is gone from the sheet the moment the item is', () => {
    const { who, before } = wearing('clumsy');
    expect(who.def).toBe(before.def - 1);
    removeCurses(who);
    takeOff(who, 'weapon');
    expect(who.def).toBe(before.def);
  });
});

describe('getting a curse off (04 section 6)', () => {
  it('frees every cursed thing worn, which is what the scroll does', () => {
    const { who, entry } = wearing('draining');
    const maxFp = who.maxFp;
    expect(cursedWorn(who)).toHaveLength(1);

    const freed = removeCurses(who);
    expect(freed).toEqual([entry]);
    expect(entry.curse).toBeUndefined();
    expect(isBound(entry)).toBe(false);
    expect(who.maxFp).toBe(maxFp + 3);
    // Freed, but not named: the bonus is still a mystery until a fight shows
    // it (`04` section 5).
    expect(isIdentified(who.identification, entry)).toBe(false);
    expect(nameOf(entry, who.identification)).toBe('Unknown Long Sword');
    afterCombat(who.identification, who.pack);
    expect(nameOf(entry, who.identification)).toBe('Long Sword -1');
    expect(isIdentified(who.identification, entry)).toBe(true);
    expect(takeOff(who, 'weapon')).toEqual({ ok: true });
    expect(removeCurses(who)).toEqual([]);
  });

  it('charges the Temple fifty gold a floor, and burns the item with it', () => {
    const { who, entry } = wearing('gloom', 'long_sword', { foundOnFloor: 4 });
    who.gold = 500;
    expect(cleanseFee(entry)).toBe(200);

    const done = cleanseAtTemple(who, entry.instanceId);
    expect(done).toMatchObject({ ok: true, fee: 200, destroyed: 'Long Sword' });
    expect(who.gold).toBe(300);
    expect(entryOf(who.pack, entry.instanceId)).toBe(null);
    expect(who.pack.equipped.weapon).toBe(null);
    expect(who.explore.lightBurnRate).toBeUndefined();
  });

  it('refuses what it cannot do, and says why', () => {
    const { who, entry } = wearing('gloom', 'long_sword', { foundOnFloor: 3 });
    who.gold = 10;
    expect(cleanseAtTemple(who, entry.instanceId)).toMatchObject({
      ok: false,
      why: 'notEnoughGold',
      fee: 150,
    });
    expect(cleanseAtTemple(who, 'itm_9999')).toMatchObject({ ok: false, why: 'notCarried' });

    const plain = addItem(who.pack, 'dagger').entry;
    expect(cleanseAtTemple(who, plain.instanceId)).toMatchObject({ ok: false, why: 'notCursed' });
  });

  it('counts the freed item back into the slots it takes', () => {
    const { who, entry } = wearing('leaden');
    const worn = slotsUsed(who.pack);
    removeCurses(who);
    takeOff(who, 'weapon');
    expect(slotsUsed(who.pack)).toBe(worn + 1);
    expect(entryOf(who.pack, entry.instanceId)).toBeTruthy();
  });
});

describe('the sheet, rebuilt again and again', () => {
  it('counts a curse once however many times it is rebuilt', () => {
    const { who } = wearing('draining');
    const fp = who.maxFp;
    const def = who.def;
    for (let i = 0; i < 5; i += 1) rebuildSheet(who);
    expect(who.maxFp).toBe(fp);
    expect(who.def).toBe(def);
  });
});
