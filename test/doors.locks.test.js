/**
 * Doors and locks (`03` section 6, `05` section 3 step 7).
 *
 * Phase 2 built the minimum hero's half — a bash and the matching key. This
 * is the rest: picking with everything that can go wrong with it, Knock,
 * Dispel Ward and its backlash, the two keys that open things by themselves,
 * and the secret doors a Search turns up.
 */
import { describe, it, expect } from 'vitest';
import {
  bashTn,
  bestWay,
  dispelTn,
  lockData,
  pickTn,
  rollDispel,
  rollKnock,
  rollPick,
  searchSecret,
  secretTn,
  stepsFor,
  tryOpen,
  useKey,
  useSkeletonKey,
  waysToOpen,
} from '../src/systems/locks.js';
import { meansOf } from '../src/systems/kit.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem, removeItem } from '../src/systems/inventory.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import { learn } from '../src/systems/skill-tree.js';
import { xpFor } from '../src/data/traps.js';

const SCORES = { might: 14, agility: 16, vigor: 13, intellect: 16, wits: 14, luck: 10 };

function makeHero(origin = 'cutpurse', scores = SCORES) {
  return finish(setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores }, origin), 'Vex'));
}

/** A stream that answers exactly what a test needs. */
function stub({ d20 = [], chance = [] } = {}) {
  const twenties = [...d20];
  const chances = [...chance];
  const stream = () => 0.5;
  stream.d20 = () => (twenties.length ? twenties.shift() : 10);
  stream.die = () => 1;
  stream.dice = () => 1;
  stream.roll = () => 3;
  stream.chance = () => (chances.length ? chances.shift() : false);
  stream.pick = (list) => list[0];
  stream.shuffle = (list) => [...list];
  return stream;
}

const door = (kind, extra = {}) => ({ kind, lock: 'good', tier: 'standard', ...extra });

describe('what the hero can try (03 section 6)', () => {
  it('reads the means off the pack and the tree together', () => {
    const hero = makeHero();
    // The Cutpurse walks in with lockpicks and a pole.
    expect(hero.has).toMatchObject({ lockpicks: true, pole: true, knock: false, dispelWard: false });

    addItem(hero.pack, 'crowbar');
    addItem(hero.pack, 'scroll_of_knock');
    addItem(hero.pack, 'skeleton_key');
    rebuildSheet(hero);
    expect(hero.has).toMatchObject({ crowbar: true, knock: true, skeletonKey: true });
    // A carried crowbar is a crowbar in the hand: +2 to bash (`04` section 11).
    expect(hero.explore.bash).toBe(2);

    const caster = makeHero('apprentice');
    caster.skillPoints = 4;
    // Dispel Ward is Arcana tier II, so the tier has to be opened first.
    learn(caster, 'arcane_well');
    learn(caster, 'arcane_well');
    learn(caster, 'lore');
    learn(caster, 'dispel_ward');
    rebuildSheet(caster);
    expect(meansOf(caster)).toMatchObject({ dispelWard: true, lore: true });
  });

  it('offers every way the door allows, and says why each is off', () => {
    const empty = { lockpicks: false };
    const ways = waysToOpen(door('locked'), { has: empty });
    expect(ways.map((way) => way.method)).toEqual(['bash', 'pick', 'knock', 'skeletonKey']);
    expect(ways.find((way) => way.method === 'pick')).toMatchObject({ usable: false, why: 'noLockpicks' });
    expect(ways.find((way) => way.method === 'bash').usable).toBe(true);

    // A stuck door is bashed and nothing else.
    const stuck = waysToOpen(door('stuck'), { has: { lockpicks: true } });
    expect(stuck.find((way) => way.method === 'pick')).toMatchObject({ usable: false, why: 'notPickable' });

    // Sealed: Dispel Ward or its own Rune Key.
    const sealed = waysToOpen(door('sealed', { keyId: 'rune_1' }), {
      has: { dispelWard: true },
      keysHeld: new Set(['rune_1']),
    });
    expect(sealed.filter((way) => way.usable).map((way) => way.method)).toEqual(['dispelWard', 'runeKey']);

    // Barred: nothing from this side.
    expect(waysToOpen(door('barred'), {}).every((way) => !way.usable)).toBe(true);
  });

  it('takes picking off the table once a lock is jammed', () => {
    const jammed = door('locked', { jammed: true });
    const ways = waysToOpen(jammed, { has: { lockpicks: true, knock: true, skeletonKey: true } });
    expect(ways.find((way) => way.method === 'pick')).toMatchObject({ usable: false, why: 'jammed' });
    // Bashing, Knock and a Skeleton Key still work (`03` section 6).
    expect(ways.filter((way) => way.usable).map((way) => way.method)).toEqual([
      'bash',
      'knock',
      'skeletonKey',
    ]);
  });

  it('prefers the quiet ways', () => {
    const has = { lockpicks: true, knock: true, skeletonKey: true };
    expect(bestWay(door('locked'), { has }).method).toBe('skeletonKey');
    expect(bestWay(door('keyed', { keyId: 'k1' }), { has, keysHeld: new Set(['k1']) }).method).toBe('key');
  });
});

describe('picking a lock', () => {
  const hero = () => {
    const who = makeHero();
    who.explore = { pick: 4 };
    return who;
  };

  it('rolls d20 + AGI + Lockpicking against the lock', () => {
    const who = hero();
    const locked = door('locked');
    expect(pickTn(locked, 3)).toBe(13);
    const done = rollPick(stub({ d20: [12] }), locked, 3, who);
    expect(done).toMatchObject({ method: 'pick', roll: 12, opened: true, steps: 5 });
    expect(done.bonus).toBe(who.mods.agility + 4);
    expect(done.xp).toBe(xpFor('pickLock', 3, 'standard'));
  });

  it('picks a Keyed door at Masterwork + 2', () => {
    // 13 + F for Masterwork, and two more because it wants its key.
    expect(pickTn(door('keyed'), 4)).toBe(19);
    expect(pickTn(door('locked'), 4)).toBe(14);
  });

  it('may break a pick on any failure, and never with two ranks', () => {
    const who = hero();
    const broken = rollPick(stub({ d20: [3], chance: [true] }), door('locked'), 5, who);
    expect(broken).toMatchObject({ opened: false, broke: true });

    who.explore.picksNeverBreak = true;
    const safe = rollPick(stub({ d20: [3], chance: [true] }), door('locked'), 5, who);
    expect(safe.broke).toBe(false);
  });

  it('jams the lock on a natural 1 or a failure by ten', () => {
    const who = hero();
    const fumbled = door('locked');
    expect(rollPick(stub({ d20: [1] }), fumbled, 3, who).jammed).toBe(true);
    expect(fumbled.jammed).toBe(true);

    // A Standard lock on floor 3 is TN 13. Rolling 4 with +6 is 10: short by
    // 3, so nothing jams.
    const near = door('locked');
    expect(rollPick(stub({ d20: [4] }), near, 3, who).jammed).toBe(false);
    expect(near.jammed).toBeUndefined();
    // Short by ten does.
    const far = door('locked');
    expect(rollPick(stub({ d20: [0] }), far, 7, who)).toMatchObject({ jammed: true, opened: false });
  });

  it('sets off a needle on a failure by five', () => {
    const who = hero();
    // TN 13, total 12: short by 1.
    expect(rollPick(stub({ d20: [5] }), door('locked'), 3, who).springsTrap).toBe(false);
    // TN 13, total 7: short by 6.
    expect(rollPick(stub({ d20: [0] }), door('locked'), 3, who).springsTrap).toBe(true);
  });
});

describe('the other ways through', () => {
  it('opens a Simple or Good lock with Knock, and rolls for Masterwork', () => {
    const hero = makeHero('apprentice');
    const easy = rollKnock(stub(), door('locked', { lock: 'good' }), 4, hero);
    expect(easy).toMatchObject({ opened: true, noisy: true, steps: 1 });
    expect(easy.roll).toBeUndefined();

    const hard = rollKnock(stub({ d20: [18] }), door('locked', { lock: 'masterwork', tier: 'masterwork' }), 4, hero);
    expect(hard).toMatchObject({ roll: 18, opened: true });
    const missed = rollKnock(stub({ d20: [2] }), door('locked', { lock: 'masterwork', tier: 'masterwork' }), 4, hero);
    expect(missed.opened).toBe(false);
  });

  it('lifts a ward on 14 + F, and bites back when it fails by five', () => {
    const hero = makeHero('apprentice', { ...SCORES, intellect: 18 });
    expect(dispelTn(6)).toBe(20);
    const lifted = rollDispel(stub({ d20: [14] }), door('sealed'), 6, hero);
    expect(lifted).toMatchObject({ opened: true, steps: 5 });
    expect(lifted.xp).toBe(xpFor('sealed', 6));

    const bitten = rollDispel(stub({ d20: [2] }), door('sealed'), 6, hero);
    expect(bitten.opened).toBe(false);
    expect(bitten.backlash).toMatchObject({ damage: '3d6', damageType: 'force', unresistable: true });
  });

  it('opens what a key opens, and spends a Skeleton Key', () => {
    expect(useKey(door('keyed', { keyId: 'k1' }))).toMatchObject({ method: 'key', opened: true, steps: 1 });
    expect(useKey(door('sealed', { keyId: 'rune_1' }))).toMatchObject({ method: 'runeKey', opened: true });
    expect(useSkeletonKey(door('locked'))).toMatchObject({ opened: true, usedUp: true });
    expect(stepsFor('skeletonKey')).toBe(1);
  });

  it('still bashes what Phase 2 bashed', () => {
    expect(bashTn(door('stuck'), 3)).toBe(11);
    // A locked door is its tier's TN plus two.
    expect(bashTn(door('locked'), 3)).toBe(15);
    const bashed = tryOpen({
      door: door('stuck'),
      floor: 3,
      rng: stub({ d20: [18] }),
      has: {},
      bashBonus: 2,
    });
    expect(bashed).toMatchObject({ method: 'bash', opened: true, noisy: true });
  });

  it('takes the method it is asked for, or the best one', () => {
    const has = { lockpicks: true, knock: true };
    const hero = makeHero();
    const asked = tryOpen({ door: door('locked'), floor: 2, rng: stub(), has, hero, method: 'knock' });
    expect(asked.method).toBe('knock');
    const chosen = tryOpen({ door: door('locked'), floor: 2, rng: stub(), has, hero });
    expect(chosen.method).toBe('knock'); // quieter than picking
    expect(tryOpen({ door: door('barred'), floor: 2, rng: stub(), has, hero })).toBe(null);
  });
});

describe('secret doors (03 section 6)', () => {
  it('is found on 12 + F, with the same -4 when nobody is looking', () => {
    const hero = makeHero();
    expect(secretTn(3)).toBe(15);
    const secret = { at: [4, 5], found: false };
    const searched = searchSecret(stub({ d20: [14] }), hero, secret, 3);
    expect(searched).toMatchObject({ found: true, tn: 15, passive: false });
    expect(secret.found).toBe(true);
    expect(searched.xp).toBe(xpFor('secretDoor', 3));

    const missed = searchSecret(stub({ d20: [14] }), hero, { found: false }, 3, { passive: true });
    expect(missed.total).toBe(14 + 1 - 4);
    expect(missed.found).toBe(false);
  });

  it('adds Keen Senses to the look', () => {
    const hero = makeHero('pilgrim');
    hero.skillPoints = 2;
    learn(hero, 'keen_senses');
    rebuildSheet(hero);
    expect(hero.explore.search).toBe(3);
    const found = searchSecret(stub({ d20: [11] }), hero, { found: false }, 3);
    expect(found.total).toBe(11 + (hero.mods.wits ?? 0) + 3);
  });

  it('is two to four a floor, off the critical path (05 section 3 step 7)', () => {
    expect(lockData.secretDoors.perFloor).toEqual([2, 4]);
    expect(lockData.secretDoors.neverOnCriticalPath).toBe(true);
    expect(lockData.secretDoors.xpPerFloor).toBe(10);
  });
});
