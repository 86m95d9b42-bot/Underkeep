/**
 * Traps: finding them, dealing with them, and what they do
 * (`03` sections 2 to 5, and section 11's XP).
 *
 * The catalog is checked against the document's three tables, and the rules
 * are driven with a scripted stream so each of the four outcomes of a disarm
 * — clean, plain, retry, and the trap going off — is the document's own.
 */
import { describe, it, expect } from 'vitest';
import {
  CHEST_TRAP_ROLL,
  TRAP_IDS,
  damageNotation,
  floorDice,
  isArcane,
  poleAdvantage,
  poleable,
  rollChestTrap,
  rollTier,
  rollTrap,
  salvageFor,
  trap,
  trapsFor,
  xpFor,
} from '../src/data/traps.js';
import {
  detectTn,
  detectionBonus,
  detectionMod,
  disarm,
  disarmTn,
  passiveNotice,
  saveDc,
  search,
  springWithPole,
  trigger,
  whyNotDisarm,
  whyNotSearch,
} from '../src/systems/traps.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { learn } from '../src/systems/skill-tree.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import { equipNew } from '../src/systems/inventory.js';
import { carriedStreams } from '../src/engine/rng.js';
import { item } from '../src/data/items.js';

const SCORES = { might: 13, agility: 14, vigor: 13, intellect: 13, wits: 14, luck: 10 };

function makeHero(scores = SCORES) {
  const who = finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores }, 'cutpurse'), 'Vex'),
  );
  who.has = { lockpicks: true, pole: true };
  return who;
}

/** A stream that answers exactly what a test needs, in order. */
function stub({ d20 = [], die = [], roll = [], chance = [], pick = [] } = {}) {
  const twenties = [...d20];
  const dice = [...die];
  const rolls = [...roll];
  const chances = [...chance];
  const picks = [...pick];
  const stream = () => 0.5;
  stream.d20 = () => (twenties.length ? twenties.shift() : 10);
  stream.die = () => (dice.length ? dice.shift() : 1);
  // `roll` and `dice` are the same queue: a test that says "the dice came up
  // 10" does not care which of the two the damage rules reached for.
  stream.roll = () => (rolls.length ? rolls.shift() : 3);
  stream.dice = () => stream.roll();
  stream.range = (low) => low;
  stream.int = (n) => stream.die() % n;
  stream.chance = () => (chances.length ? chances.shift() : false);
  stream.pick = (list) => list[(picks.length ? picks.shift() : 0) % list.length];
  stream.shuffle = (list) => [...list];
  return stream;
}

/** A trap as a floor holds one. */
const entry = (kind, tier = 'standard', extra = {}) => ({
  kind,
  tier,
  found: false,
  typeKnown: false,
  disarmed: false,
  sprung: false,
  searches: { normal: false, careful: false },
  ...extra,
});

describe('the catalog (03 section 5)', () => {
  it('has the thirty traps the three tables list', () => {
    expect(TRAP_IDS).toHaveLength(30);
    expect(trapsFor('floor', 10)).toHaveLength(13);
    expect(trapsFor('door', 10)).toHaveLength(5);
    expect(trapsFor('chest', 10)).toHaveLength(12);
  });

  it('keeps a trap out of a floor that is too shallow for it', () => {
    expect(trapsFor('floor', 1)).toEqual(['alarm_tile', 'pit', 'dart_plate']);
    expect(trapsFor('floor', 2)).toContain('swinging_blade');
    expect(trapsFor('floor', 1)).not.toContain('swinging_blade');
    expect(trapsFor('door', 1)).toEqual(['alarm_chime', 'needle_lock']);
    expect(trap('crushing_walls').minFloor).toBe(7);
  });

  it('scales the floor dice: 1d6 per two floors, at least 1d6', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10].map(floorDice)).toEqual([
      '1d6', '1d6', '2d6', '2d6', '3d6', '3d6', '5d6', '5d6',
    ]);
    expect(damageNotation('FD', 5)).toBe('3d6');
    expect(damageNotation('2FD', 8)).toBe('8d6');
    expect(damageNotation('FD+1d6', 3)).toBe('2d6+1d6');
    expect(damageNotation('1d4+F', 6)).toBe('1d4+6');
    expect(damageNotation(null, 1)).toBe(null);
  });

  it('rolls a mechanical tier on d10 + F, and keeps to what the trap has', () => {
    // 1-5 Crude, 6-11 Standard, 12+ Masterwork.
    expect(rollTier(stub({ roll: [2] }), 1, ['crude', 'standard', 'masterwork'])).toBe('crude');
    expect(rollTier(stub({ roll: [8] }), 1, ['crude', 'standard', 'masterwork'])).toBe('standard');
    expect(rollTier(stub({ roll: [9] }), 5, ['crude', 'standard', 'masterwork'])).toBe('masterwork');
    // A trap that only comes in two tiers takes the nearest it has.
    expect(rollTier(stub({ roll: [2] }), 1, ['standard', 'masterwork'])).toBe('standard');
    expect(rollTier(stub({ roll: [10] }), 8, ['crude'])).toBe('crude');
  });

  it('rolls a chest trap on the die its floor uses', () => {
    expect(CHEST_TRAP_ROLL.dieByFloor.map((row) => row.die)).toEqual([6, 10, 12]);
    expect(rollChestTrap(stub({ die: [1] }), 1)).toMatchObject({ kind: 'poison_needle' });
    expect(rollChestTrap(stub({ die: [8] }), 5)).toMatchObject({ kind: 'fire_rune', tier: 'arcane' });
    expect(rollChestTrap(stub({ die: [12] }), 9)).toMatchObject({ kind: 'soul_leech' });
  });

  it('picks a trap a floor is deep enough for', () => {
    const rolled = rollTrap(stub({ pick: [1] }), 'floor', 1);
    expect(trapsFor('floor', 1)).toContain(rolled.kind);
    expect(trap(rolled.kind).tiers).toContain(rolled.tier);
  });

  it('salvages what the table says, and Trap Parts otherwise', () => {
    expect(salvageFor('poison_needle')).toBe('poison_vial');
    expect(salvageFor('gas_cloud')).toBe('sleep_bomb');
    expect(salvageFor('fire_rune')).toBe('fire_pot');
    expect(salvageFor('crossbow_bolt')).toBe('crossbow_parts');
    expect(salvageFor('pit')).toBe('trap_parts');
    for (const id of TRAP_IDS) expect([id, Boolean(item(salvageFor(id)))]).toEqual([id, true]);
  });

  it('pays the XP section 11 gives, and nothing for a pole', () => {
    expect(xpFor('disarm', 4, 'standard')).toBe(40);
    expect(xpFor('disarm', 4, 'masterwork')).toBe(80);
    expect(xpFor('disarm', 4, 'arcane')).toBe(120);
    expect(xpFor('pickLock', 6)).toBe(30);
    expect(xpFor('secretDoor', 3)).toBe(30);
    expect(xpFor('pole', 9, 'arcane')).toBe(0);
    expect(xpFor('bash', 9)).toBe(0);
  });

  it('knows which traps a pole can reach', () => {
    expect(poleable('pit')).toBe(true);
    expect(poleable('alarm_tile')).toBe(false);
    expect(poleable('gas_cloud')).toBe(true);
    expect(poleAdvantage('gas_cloud')).toBe(true);
    expect(poleAdvantage('pit')).toBe(false);
    expect(isArcane('soul_glyph')).toBe(true);
    expect(isArcane('pit')).toBe(false);
  });
});

describe('finding a trap (03 section 3)', () => {
  it('reads the TNs off the tier table 03 section 2 shares with locks', () => {
    expect(detectTn('crude', 3)).toBe(11);
    expect(detectTn('standard', 3)).toBe(13);
    expect(detectTn('masterwork', 3)).toBe(16);
    expect(detectTn('arcane', 3)).toBe(17);
    expect(disarmTn('standard', 5)).toBe(15);
    expect(saveDc('crude', 5)).toBe(14);
  });

  it('rolls the passive notice at -4', () => {
    const hero = makeHero();
    const wits = detectionMod(hero);
    const found = passiveNotice(stub({ d20: [17] }), hero, entry('pit', 'crude'), 1);
    expect(found).toMatchObject({ roll: 17, tn: 9, found: true, passive: true });
    expect(found.total).toBe(17 + wits - 4);

    const missed = passiveNotice(stub({ d20: [5] }), hero, entry('pit', 'masterwork'), 5);
    expect(missed.found).toBe(false);
    expect(missed.total).toBe(5 + wits - 4);
  });

  it('drops the penalty for a hero with Trapfinding 2', () => {
    const hero = makeHero();
    hero.skillPoints = 4;
    learn(hero, 'trapfinding');
    learn(hero, 'trapfinding');
    rebuildSheet(hero);
    expect(hero.explore.noPassiveNoticePenalty).toBe(true);
    const rolled = passiveNotice(stub({ d20: [10] }), hero, entry('pit', 'crude'), 1);
    // No -4, and +4 from two ranks of Trapfinding.
    expect(hero.explore.trap).toBe(4);
    expect(rolled.total).toBe(10 + detectionMod(hero) + 4);
  });

  it('searches without the penalty, and once each way', () => {
    const hero = makeHero();
    const pit = entry('pit', 'crude');
    const first = search(stub({ d20: [9] }), hero, pit, 1);
    expect(first).toMatchObject({ roll: 9, tn: 9, found: true, steps: 5 });
    expect(first.total).toBe(9 + detectionMod(hero));
    expect(pit.found).toBe(true);

    // One Search and one Careful Search each (`03` section 3).
    expect(search(stub({ d20: [20] }), hero, pit, 1).why).toBe('searched');
    const careful = search(stub({ d20: [15] }), hero, pit, 1, { careful: true });
    expect(careful.steps).toBe(20);
    expect(search(stub({ d20: [15] }), hero, pit, 1, { careful: true }).why).toBe('searched');
  });

  it('names the trap on a success by 5 or more', () => {
    const hero = makeHero();
    const tn = detectTn('crude', 1);
    const mod = detectionMod(hero);
    const near = search(stub({ d20: [tn - mod] }), hero, entry('pit', 'crude'), 1);
    expect(near).toMatchObject({ found: true, exact: false });

    const clear = entry('pit', 'crude');
    const exact = search(stub({ d20: [tn - mod + 5] }), hero, clear, 1);
    expect(exact).toMatchObject({ found: true, exact: true });
    expect(clear.typeKnown).toBe(true);
  });

  it('lets Lore name a magical trap on any success', () => {
    const hero = makeHero({ ...SCORES, intellect: 16 });
    hero.skillPoints = 1;
    learn(hero, 'lore');
    rebuildSheet(hero);
    const glyph = entry('soul_glyph', 'arcane');
    // The better of WIT and INT, and Lore's +3 on top (`03` section 3).
    expect(detectionMod(hero, { magical: true })).toBe(2);
    expect(detectionMod(hero)).toBe(1);
    expect(detectionBonus(hero, { magical: true })).toBe(3);
    const tn = detectTn('arcane', 8);
    const found = search(stub({ d20: [tn - 5] }), hero, glyph, 8);
    // Lore names any magical trap it finds at all, however close the roll.
    expect(found).toMatchObject({ found: true, exact: true });
  });

  it('cannot search in the dark, but still notices a glyph passively', () => {
    const hero = makeHero();
    expect(whyNotSearch(entry('pit'), { dark: true })).toBe('tooDark');
    expect(search(stub(), hero, entry('pit'), 1, { dark: true }).why).toBe('tooDark');
    // An Arcane trap glows: noticed without the -4 (`03` section 3, Darkness).
    const glyph = passiveNotice(stub({ d20: [10] }), hero, entry('soul_glyph', 'arcane'), 8, { dark: true });
    expect(glyph.total).toBe(10 + detectionMod(hero, { magical: true }));
  });
});

describe('dealing with one (03 section 4)', () => {
  it('wants lockpicks for a mechanical trap, and never refuses an Arcane one', () => {
    const hero = makeHero();
    hero.has = {};
    expect(whyNotDisarm(hero, entry('pit', 'crude', { found: true }))).toBe('noLockpicks');
    expect(whyNotDisarm(hero, entry('soul_glyph', 'arcane', { found: true }))).toBe(null);
    expect(whyNotDisarm(hero, entry('pit'))).toBe('notFound');
    expect(whyNotDisarm(makeHero(), entry('pit', 'crude', { found: true, disarmed: true }))).toBe('alreadyGone');
  });

  it('disarms, and salvages a part on a success by 10', () => {
    const hero = makeHero();
    const needle = entry('poison_needle', 'crude', { found: true, typeKnown: true });
    // d20 19 + AGI 2 = 21 against 9: by 12.
    const done = disarm(stub({ d20: [19] }), hero, needle, 1);
    expect(done).toMatchObject({ ok: true, disarmed: true, salvage: 'poison_vial', xp: 10 });
    expect(needle.disarmed).toBe(true);
  });

  it('takes -2 when the hero does not know what it is', () => {
    const hero = makeHero();
    const known = disarm(stub({ d20: [11] }), hero, entry('pit', 'crude', { found: true, typeKnown: true }), 1);
    const blind = disarm(stub({ d20: [11] }), hero, entry('pit', 'crude', { found: true }), 1);
    expect(known.total - blind.total).toBe(2);
  });

  it('lets a near miss be tried again, and sets a bad one off', () => {
    const hero = makeHero();
    // 5 + 2 = 7 against 13: fail by 6 — the trap goes off.
    const off = disarm(stub({ d20: [5] }), hero, entry('dart_plate', 'standard', { found: true, typeKnown: true }), 3);
    expect(off).toMatchObject({ ok: false, sprung: true, retry: false, steps: 5 });

    // 10 + 2 = 12 against 13: fail by 1 — nothing happens.
    const again = disarm(stub({ d20: [10] }), hero, entry('dart_plate', 'standard', { found: true, typeKnown: true }), 3);
    expect(again).toMatchObject({ ok: false, sprung: false, retry: true, steps: 5 });

    // A natural 1 always sets it off.
    const fumble = disarm(stub({ d20: [1] }), hero, entry('pit', 'crude', { found: true, typeKnown: true }), 1);
    expect(fumble.sprung).toBe(true);
  });

  it('gives an Arcane trap +4 with Dispel Ward and disadvantage without it', () => {
    const hero = makeHero({ ...SCORES, intellect: 16 });
    hero.has = { dispelWard: true };
    const int = 2; // INT 16 is a +2 modifier (`01` section 2)
    const withIt = disarm(stub({ d20: [12] }), hero, entry('soul_glyph', 'arcane', { found: true, typeKnown: true }), 8);
    expect(withIt.total).toBe(12 + int + 4);

    const plain = makeHero({ ...SCORES, intellect: 16 });
    const without = disarm(stub({ d20: [12] }), plain, entry('soul_glyph', 'arcane', { found: true, typeKnown: true }), 8);
    expect(without.total).toBe(12 + int);
  });

  it('springs what a pole reaches, and may break on a blade', () => {
    const hero = makeHero();
    const pit = entry('pit', 'crude', { found: true });
    expect(springWithPole(stub(), hero, pit)).toMatchObject({ ok: true, reaches: false, poleBroke: false });
    expect(pit.sprung).toBe(true);

    // An area trap still reaches the hero, with the save at advantage.
    const gas = entry('gas_cloud', 'standard', { found: true });
    expect(springWithPole(stub(), hero, gas)).toMatchObject({ ok: true, reaches: true, advantage: true });

    // A blade trap can take the pole with it: 1 in 6.
    const blade = entry('swinging_blade', 'standard', { found: true });
    expect(springWithPole(stub({ chance: [true] }), hero, blade).poleBroke).toBe(true);

    expect(springWithPole(stub(), hero, entry('alarm_tile', 'crude', { found: true })).why).toBe('notPoleable');
    expect(springWithPole(stub(), { has: {} }, entry('pit', 'crude', { found: true })).why).toBe('noPole');
  });
});

describe('when one goes off (03 section 4)', () => {
  const services = (rng) => ({ rng });

  it('rolls an attack at +F + 3 against DEF', () => {
    const hero = makeHero();
    hero.def = 14;
    const rng = stub({ d20: [10], roll: [5] });
    const off = trigger(services(rng), hero, entry('dart_plate', 'standard', { found: true }), 4, { detected: true });
    // 10 + 4 + 3 = 17 against 14.
    expect(off.attack).toMatchObject({ roll: 10, total: 17, hit: true });
  });

  it('gives an unseen trap +2 and the hero disadvantage', () => {
    const hero = makeHero();
    hero.def = 20;
    const seen = trigger(services(stub({ d20: [10], roll: [1] })), hero, entry('dart_plate'), 4, { detected: true });
    const unseen = trigger(services(stub({ d20: [10], roll: [1] })), hero, entry('dart_plate'), 4, { detected: false });
    expect(unseen.attack.total - seen.attack.total).toBe(2);
  });

  it('halves the damage where the document halves it', () => {
    const hero = makeHero();
    const half = trigger(
      services(stub({ d20: [20], roll: [10] })),
      hero,
      entry('flame_jet', 'standard', { found: true }),
      5,
      { detected: true },
    );
    expect(half.save.passed).toBe(true);
    expect(half.damage).toBe(5);
    expect(half.conditions).toEqual([]);
  });

  it('applies the condition on a failed save, and what follows it', () => {
    const hero = makeHero();
    const gas = trigger(
      services(stub({ d20: [2], roll: [0] })),
      hero,
      entry('gas_vent', 'standard', { found: true }),
      3,
      { detected: true },
    );
    expect(gas.save.passed).toBe(false);
    expect(gas.conditions).toContain('asleep');
    expect(gas.durationSteps).toBe(10);
    expect(gas.events).toContainEqual(expect.objectContaining({ type: 'wanderingCheck', surprise: true }));
  });

  it('hands the floor what only the floor can do', () => {
    const hero = makeHero();
    const chute = trigger(services(stub({ d20: [2] })), hero, entry('chute', 'standard'), 4, { detected: false });
    expect(chute.events).toContainEqual(expect.objectContaining({ type: 'chute' }));

    const alarm = trigger(services(stub()), hero, entry('alarm_tile', 'crude'), 1, { detected: false });
    expect(alarm.events).toContainEqual(expect.objectContaining({ type: 'encounter', extra: 1 }));

    const glyph = trigger(services(stub({ d20: [2] })), hero, entry('teleport_glyph', 'arcane'), 6, { detected: false });
    expect(glyph.events).toContainEqual(expect.objectContaining({ type: 'teleport', value: 'floor' }));
  });

  it('takes the hit points through the damage rules', () => {
    const hero = makeHero();
    hero.resistant = ['fire'];
    const before = hero.hp;
    const burn = trigger(
      services(stub({ d20: [2], roll: [10] })),
      hero,
      entry('flame_jet', 'standard'),
      5,
      { detected: false },
    );
    // Resistant halves it, so 10 lands as 5.
    expect(burn.damage).toBe(5);
    expect(hero.hp).toBe(before - 5);
  });

  it('adds the Spiked Pit\'s own spikes on a fall', () => {
    const hero = makeHero();
    const fall = trigger(
      services(stub({ d20: [2], roll: [6, 4] })),
      hero,
      entry('spiked_pit', 'standard'),
      3,
      { detected: false },
    );
    expect(fall.damage).toBe(10);
    expect(fall.conditions).toContain('bleeding');
    expect(fall.climbSteps).toBe(10);
    expect(fall.events).toContainEqual(expect.objectContaining({ type: 'pit' }));
  });

  it('drains the Focus a Curse Sigil takes', () => {
    const hero = makeHero();
    hero.fp = 6;
    const cursed = trigger(services(stub({ d20: [2], roll: [4] })), hero, entry('curse_sigil', 'arcane'), 8, {
      detected: false,
    });
    expect(cursed.fpLost).toBe(4);
    expect(hero.fp).toBe(2);
    expect(cursed.conditions).toContain('weakened');
  });

  it('gives the hero their own resistances and saves', () => {
    const hero = makeHero();
    equipNew(hero.pack, 'wardstone'); // +1 to all saves
    rebuildSheet(hero);
    const rolled = trigger(services(stub({ d20: [12], roll: [6] })), hero, entry('spring_blade', 'standard'), 3, {
      detected: true,
    });
    expect(rolled.save.total).toBe(12 + hero.saves.reflex);
  });
});
