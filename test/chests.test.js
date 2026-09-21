/**
 * Treasure chests, and the sequence `03` section 7 puts the hero through.
 *
 * The chances are checked against the document's table, and the sequence is
 * driven with a scripted stream so each of the three moments an armed trap can
 * go off — a pick that fails badly, a bash, and simply lifting the lid — is
 * the document's own, and so that the Mimic's TN 18 is exactly TN 18.
 */
import { describe, it, expect } from 'vitest';
import {
  CHEST_RULES,
  chanceOf,
  chestState,
  disarmTrap,
  inspect,
  isArmed,
  isLocked,
  lootBonusOf,
  open,
  poleTrap,
  unlock,
  waysIn,
  whyNotOpen,
} from '../src/systems/chests.js';
import { detectTn } from '../src/systems/traps.js';
import { pickTn } from '../src/systems/locks.js';
import { createRun } from '../src/systems/run.js';
import { isWalkable } from '../src/dungeon/floor-builder.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { learn } from '../src/systems/skill-tree.js';
import { rebuildSheet } from '../src/systems/levelling.js';

const SCORES = { might: 13, agility: 14, vigor: 13, intellect: 13, wits: 14, luck: 10 };

function makeHero(scores = SCORES) {
  const who = finish(setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores }, 'cutpurse'), 'Vex'));
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
  stream.asked = [];
  stream.d20 = (options = {}) => {
    stream.asked.push(options);
    return twenties.length ? twenties.shift() : 10;
  };
  stream.die = () => (dice.length ? dice.shift() : 1);
  stream.roll = () => (rolls.length ? rolls.shift() : 3);
  stream.dice = () => stream.roll();
  stream.range = (low) => low;
  stream.int = (n) => stream.die() % n;
  stream.chance = () => (chances.length ? chances.shift() : false);
  stream.pick = (list) => list[(picks.length ? picks.shift() : 0) % list.length];
  stream.shuffle = (list) => [...list];
  return stream;
}

/** A chest as a floor holds one. */
const chestOf = (extra = {}) => ({
  id: 'chest_test',
  lock: 'none',
  tier: null,
  pickTn: 0,
  trap: null,
  mimic: false,
  searches: { normal: false, careful: false },
  opened: false,
  ...extra,
});

/** A chest trap as a floor holds one. */
const trapOf = (kind = 'poison_needle', tier = 'standard', extra = {}) => ({
  kind,
  tier,
  found: false,
  typeKnown: false,
  disarmed: false,
  sprung: false,
  searches: { normal: false, careful: false },
  ...extra,
});

const services = (rng) => ({ rng });

describe('generating a chest (03 section 7)', () => {
  it('follows the table: 20% + 5% F trapped, 30% + 5% F locked', () => {
    expect(chanceOf('trapped', 1)).toBeCloseTo(0.25);
    expect(chanceOf('locked', 1)).toBeCloseTo(0.35);
    expect(chanceOf('trapped', 5)).toBeCloseTo(0.45);
    expect(chanceOf('locked', 5)).toBeCloseTo(0.55);
  });

  it('stops at the maximums the table gives', () => {
    // Trapped caps at 70%, which floor 10 would otherwise pass; locked at 80%.
    expect(chanceOf('trapped', 10)).toBeCloseTo(0.7);
    expect(chanceOf('locked', 10)).toBeCloseTo(0.8);
  });

  it('keeps Mimics out of the first four floors', () => {
    expect([1, 2, 3, 4].map((f) => chanceOf('mimic', f))).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7].map((f) => chanceOf('mimic', f))).toEqual([0.03, 0.03, 0.03]);
    expect([8, 9, 10].map((f) => chanceOf('mimic', f))).toEqual([0.08, 0.08, 0.08]);
  });
});

describe('what the panel knows', () => {
  it('shows the lock from the first look and hides the trap', () => {
    const chest = chestOf({ lock: 'good', tier: 'standard', trap: trapOf() });
    expect(chestState(chest)).toMatchObject({ lock: 'good', trap: 'unknown', locked: true });
  });

  it('says "none" only once the hero has looked', () => {
    const empty = chestOf();
    expect(chestState(empty).trap).toBe('unknown');
    inspect(stub({ d20: [20] }), makeHero(), empty, 1, {});
    expect(chestState(empty).trap).toBe('none');
  });

  it('follows the trap from armed to gone', () => {
    const chest = chestOf({ trap: trapOf('poison_needle', 'standard', { found: true }) });
    expect(chestState(chest).trap).toBe('armed');
    expect(isArmed(chest)).toBe(true);
    chest.trap.disarmed = true;
    expect(chestState(chest).trap).toBe('disarmed');
    expect(isArmed(chest)).toBe(false);
  });

  it('offers a Sealed chest the ways a Sealed door has', () => {
    const sealed = chestOf({ lock: 'sealed', tier: 'arcane' });
    const ways = waysIn(sealed, { has: {} });
    expect(ways.every((way) => !way.usable)).toBe(true);
    expect(waysIn(sealed, { has: { dispelWard: true } }).find((w) => w.method === 'dispelWard').usable).toBe(true);
  });
});

describe('1. inspect', () => {
  it('finds the trap at the trap tier’s own TN', () => {
    const hero = makeHero();
    const chest = chestOf({ trap: trapOf('poison_needle', 'standard') });
    // Standard on floor 4 is TN 14; WIT 14 is +1, so a 13 is exactly enough.
    expect(detectTn('standard', 4)).toBe(14);
    const found = inspect(stub({ d20: [13] }), hero, chest, 4, {});
    expect(found.trap).toBeTruthy();
    expect(chest.trap.found).toBe(true);
  });

  it('is the only step that can find one, and only once each way', () => {
    const chest = chestOf({ trap: trapOf() });
    const hero = makeHero();
    expect(inspect(stub({ d20: [2] }), hero, chest, 1, {}).why).toBe(undefined);
    expect(inspect(stub({ d20: [20] }), hero, chest, 1, {}).why).toBe('searched');
    // A Careful Search is a second, better look (03 section 3).
    const careful = inspect(stub({ d20: [20] }), hero, chest, 1, { careful: true });
    expect(careful.trap).toBeTruthy();
    expect(careful.steps).toBeGreaterThan(5);
  });

  it('finds nothing in the dark', () => {
    const chest = chestOf({ trap: trapOf() });
    expect(inspect(stub({ d20: [20] }), makeHero(), chest, 1, { dark: true }).why).toBe('tooDark');
    expect(chest.searches.normal).toBe(false);
  });

  it('costs the same look whether the chest is trapped or not', () => {
    const hero = makeHero();
    const trapped = inspect(stub({ d20: [2] }), hero, chestOf({ trap: trapOf() }), 3, {});
    const empty = inspect(stub({ d20: [2] }), hero, chestOf(), 3, {});
    expect(empty.steps).toBe(trapped.steps);
    expect(empty.trap).toBe(null);
  });

  it('spots a Mimic at TN 18, and not at 17', () => {
    const hero = makeHero(); // WIT 14: +1
    expect(CHEST_RULES.mimic.detectTn).toBe(18);
    const seen = inspect(stub({ d20: [17] }), hero, chestOf({ mimic: true }), 6, {});
    expect(seen.mimic).toBe(true);
    const missed = inspect(stub({ d20: [16] }), hero, chestOf({ mimic: true }), 6, {});
    expect(missed.mimic).toBe(false);
  });

  it('lets Lore name a Mimic whatever the roll', () => {
    const scholar = makeHero();
    scholar.skillPoints = 1;
    learn(scholar, 'lore');
    rebuildSheet(scholar);
    const chest = chestOf({ mimic: true });
    expect(inspect(stub({ d20: [2] }), scholar, chest, 6, {}).mimic).toBe(true);
    expect(chest.mimicKnown).toBe(true);
  });
});

describe('2. handling the trap', () => {
  it('will not disarm what was never found', () => {
    const chest = chestOf({ trap: trapOf() });
    expect(disarmTrap(stub({ d20: [20] }), makeHero(), chest, 1).why).toBe('notFound');
    expect(disarmTrap(stub(), makeHero(), chestOf(), 1).why).toBe('noTrap');
  });

  it('disarms a found trap, and springs one safely with a pole', () => {
    const hero = makeHero();
    const chest = chestOf({ trap: trapOf('poison_needle', 'crude', { found: true, typeKnown: true }) });
    expect(disarmTrap(stub({ d20: [20] }), hero, chest, 1).disarmed).toBe(true);
    expect(isArmed(chest)).toBe(false);

    const poled = chestOf({ trap: trapOf('poison_needle', 'crude', { found: true }) });
    expect(poleTrap(stub(), hero, poled).ok).toBe(true);
    expect(isArmed(poled)).toBe(false);
  });
});

describe('3. unlock', () => {
  it('says so when there is nothing to unlock', () => {
    expect(unlock(services(stub()), makeHero(), chestOf(), 1).why).toBe('unlocked');
  });

  it('picks the lock at the lock tier’s TN', () => {
    const hero = makeHero(); // AGI 14: +1, and the Cutpurse carries picks
    const chest = chestOf({ lock: 'simple', tier: 'crude', pickTn: 9 });
    expect(pickTn({ kind: 'locked', tier: 'crude' }, 1)).toBe(9);
    const out = unlock(services(stub({ d20: [8] })), hero, chest, 1, { method: 'pick' });
    expect(out).toMatchObject({ method: 'pick', opened: true });
    expect(isLocked(chest)).toBe(false);
  });

  it('sets an armed trap off when the pick fails by 5 or more', () => {
    const hero = makeHero();
    const near = chestOf({ lock: 'good', tier: 'standard', trap: trapOf('poison_needle', 'crude') });
    // TN 11 on floor 1, and the Cutpurse picks at +3 (AGI and Lockpicking),
    // so a 7 misses by one: time lost, and nothing more.
    const close = unlock(services(stub({ d20: [7] })), hero, near, 1, { method: 'pick' });
    expect(close.sprung).toBe(null);
    expect(isArmed(near)).toBe(true);

    const far = chestOf({ lock: 'good', tier: 'standard', trap: trapOf('poison_needle', 'crude') });
    // A 3 is a total of 6 against 11: five short, and the needle finds a hand.
    const badly = unlock(services(stub({ d20: [3] })), hero, far, 1, { method: 'pick' });
    expect(badly.sprung).toBeTruthy();
    expect(far.trap.sprung).toBe(true);
  });

  it('sets any armed trap off when the chest is bashed, however good the roll', () => {
    const hero = makeHero();
    const chest = chestOf({ lock: 'simple', tier: 'crude', trap: trapOf('poison_needle', 'crude') });
    const out = unlock(services(stub({ d20: [20] })), hero, chest, 1, { method: 'bash', bashBonus: 10 });
    expect(out.opened).toBe(true);
    expect(out.sprung).toBeTruthy();
    // Which is why a careful hero disarms first: a disarmed trap stays quiet.
    const safe = chestOf({
      lock: 'simple',
      tier: 'crude',
      trap: trapOf('poison_needle', 'crude', { found: true, disarmed: true }),
    });
    expect(unlock(services(stub({ d20: [20] })), hero, safe, 1, { method: 'bash' }).sprung).toBe(null);
  });
});

describe('4 and 5. open, and loot', () => {
  it('will not open what is still locked', () => {
    const chest = chestOf({ lock: 'good', tier: 'standard' });
    expect(whyNotOpen(chest)).toBe('locked');
    expect(open(services(stub()), makeHero(), chest, 1)).toMatchObject({ opened: false, why: 'locked' });
  });

  it('sets off a trap that is still armed, and saves with disadvantage when it was never found', () => {
    const hero = makeHero();
    const unseen = stub({ d20: [12, 3] });
    const chest = chestOf({ trap: trapOf('poison_needle', 'crude') });
    open(services(unseen), hero, chest, 1);
    // 03 section 7 step 4: "If it was never found, the hero saves with
    // disadvantage."
    expect(unseen.asked.some((options) => options.disadvantage)).toBe(true);

    const seen = stub({ d20: [12] });
    const found = chestOf({ trap: trapOf('poison_needle', 'crude', { found: true }) });
    open(services(seen), hero, found, 1);
    expect(seen.asked.every((options) => !options.disadvantage)).toBe(true);
  });

  it('pays F x 3d10 in gold', () => {
    // The stub's `roll` answers the whole notation, as the stream does.
    const rng = stub({ roll: [17] });
    const out = open(services(rng), makeHero(), chestOf(), 4);
    expect(out.gold).toBe(4 * 17);
    expect(out.opened).toBe(true);
    expect(whyNotOpen(out.opened && chestOf({ opened: true }))).toBe('alreadyOpen');
  });

  it('adds the chest’s own difficulty to the loot roll', () => {
    // 03 section 7: Masterwork +5 each, Arcane or Sealed +10 each.
    expect(lootBonusOf(chestOf())).toBe(0);
    expect(lootBonusOf(chestOf({ lock: 'masterwork', tier: 'masterwork' }))).toBe(5);
    expect(lootBonusOf(chestOf({ lock: 'sealed', tier: 'arcane' }))).toBe(10);
    expect(lootBonusOf(chestOf({ trap: trapOf('fire_rune', 'arcane') }))).toBe(10);
    expect(
      lootBonusOf(chestOf({ lock: 'masterwork', tier: 'masterwork', trap: trapOf('fire_rune', 'arcane') })),
    ).toBe(15);
  });

  it('gives a boss chest its Rare item, and never traps it', () => {
    const out = open(services(stub({ die: [6], roll: [5] })), makeHero(), chestOf({ boss: true }), 5);
    expect(out.drops.length).toBeGreaterThan(0);
    expect(CHEST_RULES.boss).toMatchObject({ alwaysRare: true, neverTrapped: true });
  });
});

describe('the Mimic', () => {
  it('is a fight, not a container: no gold, no loot', () => {
    const chest = chestOf({ mimic: true });
    const out = open(services(stub({ roll: [10] })), makeHero(), chest, 6);
    expect(out).toMatchObject({ mimic: true, opened: false, gold: 0, drops: [] });
    expect(chest.opened).toBe(false);
  });

  it('gets its free round only from a hero who never looked', () => {
    const blind = chestOf({ mimic: true });
    expect(open(services(stub()), makeHero(), blind, 6).surprise).toBe(true);

    const watched = chestOf({ mimic: true, mimicKnown: true });
    expect(open(services(stub()), makeHero(), watched, 6).surprise).toBe(false);
  });
});

describe('through the run (03 section 7, and 03 section 1 for the time)', () => {
  /** A run standing in front of an unopened chest, with the chest it faces. */
  function runAtChest(floor = 3) {
    for (let seed = 1; seed < 40; seed += 1) {
      const run = createRun({ masterSeed: 4177 + seed * 613, floor, hero: makeHero() });
      for (const [at, chest] of Object.entries(run.floor.chests)) {
        const [cx, cy] = at.split(',').map(Number);
        for (const [ox, oy, facing] of [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]]) {
          const [x, y] = [cx + ox, cy + oy];
          if (!isWalkable(run.floor.map?.[y]?.[x])) continue;
          run.ex.pos = [x, y];
          run.ex.facing = facing;
          if (run.chestAhead === chest) return { run, chest };
        }
      }
    }
    throw new Error('no reachable chest found');
  }

  it('offers the chest as the context key, and the screen behind it', () => {
    const { run } = runAtChest();
    expect(run.context).toBe('open');
    expect(run.actReason).toBe(undefined);
    // The key opens the Chest screen rather than resolving anything itself.
    expect(run.act()).toMatchObject({ events: [], openChest: true });
  });

  it('spends the document’s time on each step', () => {
    const { run } = runAtChest();
    const before = run.ex.steps;
    run.chestAct('search');
    expect(run.ex.steps).toBe(before + 5);
    run.chestAct('careful');
    expect(run.ex.steps).toBe(before + 25);
  });

  it('pays the gold to the hero and the loot into the pack', () => {
    const { run, chest } = runAtChest();
    chest.lock = 'none';
    chest.trap = null;
    chest.mimic = false;
    const gold = run.hero.gold ?? 0;
    const carried = run.hero.pack.items.length;

    const { events } = run.chestAct('open');
    const opened = events.find((event) => event.type === 'chestOpened');
    expect(opened).toBeTruthy();
    expect(run.hero.gold).toBe(gold + opened.gold);
    // F x 3d10 on floor 3 is between 9 and 90.
    expect(opened.gold).toBeGreaterThanOrEqual(3 * 3);
    expect(opened.gold).toBeLessThanOrEqual(3 * 30);
    expect(run.hero.pack.items.length).toBeGreaterThanOrEqual(carried);
    // And the chest is done with: the context key moves on.
    expect(run.chestAhead).toBe(null);
  });

  it('leaves a chest alone while a shut door stands in front of it', () => {
    // Floor 8 of this seed puts a chest on a doorway tile, which is how the
    // walk found the rule: what is in the way is what the key offers.
    const run = createRun({ masterSeed: 23770, floor: 8, hero: makeHero() });
    const at = '11,2';
    expect(run.floor.doors[at]).toBeTruthy();
    expect(run.floor.chests[at]).toBeTruthy();

    const [cx, cy] = at.split(',').map(Number);
    const stood = [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]].find(([ox, oy]) =>
      isWalkable(run.floor.map?.[cy + oy]?.[cx + ox]),
    );
    run.ex.pos = [cx + stood[0], cy + stood[1]];
    run.ex.facing = stood[2];

    expect(run.doorAhead).toBeTruthy();
    expect(run.chestAhead).toBe(null);
    expect(run.chestAct('open').events).toEqual([]);
    // The context key opens the door, as it always did.
    expect(run.act().openChest).toBe(undefined);
  });
});
