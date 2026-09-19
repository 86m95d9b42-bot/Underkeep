/**
 * Initiative and the three bands (`06` section 3).
 *
 * The numbers here are worked by hand from the section: a d6 plus the
 * bestiary's Init column, one roll shared by each monster type, three bands
 * that beat any roll, and the tiebreaks in the order the section gives them.
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createCombat } from '../src/engine/field.js';
import {
  BANDS,
  INITIATIVE_DIE,
  bandOf,
  groupKeyOf,
  initiativeModifier,
  orderIds,
  rollInitiative,
} from '../src/engine/initiative.js';
import { applyCondition } from '../src/engine/conditions.js';

/** A stream whose d6 hands out the rolls given, in order, and then repeats the last. */
function dice(...rolls) {
  const queue = [...rolls];
  const rng = () => 0.5;
  rng.die = () => (queue.length > 1 ? queue.shift() : queue[0] ?? 1);
  rng.int = (n) => n - 1;
  rng.shuffle = (items) => [...items].reverse();
  return rng;
}

const hero = (extra = {}) => ({ id: 'hero', name: 'Harrow', hp: 12, maxHp: 12, init: 0, ...extra });
const monster = (type, extra = {}) => ({ type, hp: 6, maxHp: 6, init: 0, row: 'front', ...extra });

function fight(monsters, { rng = dice(3), heroExtra = {} } = {}) {
  return createCombat({ hero: hero(heroExtra), monsters, rng, surprise: false });
}

describe('the bands', () => {
  it('are the three 06 section 3 names, in order', () => {
    expect(BANDS).toEqual(['first', 'normal', 'last']);
    expect(INITIATIVE_DIE).toBe(6);
  });

  it('puts Quicksilver first, Slowed last, and everyone else in between', () => {
    expect(bandOf({ actsFirst: true })).toBe('first');
    expect(bandOf({})).toBe('normal');
    const slow = { conditions: {}, immunities: [], controlImmunity: {} };
    applyCondition(slow, 'slowed');
    expect(bandOf(slow)).toBe('last');
  });

  it('puts the Zombie last on its own tactics, with no condition needed', () => {
    expect(bandOf({ type: 'zombie', actsLast: true })).toBe('last');
  });

  it('beats any roll: a Slowed unit that rolls a 6 still acts after a 1', () => {
    // The hero rolls 1, the kobold 6 — but the kobold is Slowed.
    const combat = fight([monster('kobold')], { rng: dice(1, 6) });
    applyCondition(combat.units[1], 'slowed');
    expect(orderIds(rollInitiative(combat))).toEqual(['hero', 'kobold-1']);
  });
});

describe('rolling', () => {
  it('is d6 + the initiative modifier', () => {
    const combat = fight([monster('rat', { init: 2 })], { rng: dice(4, 3) });
    const order = rollInitiative(combat);
    const rat = order.find((entry) => entry.unit.type === 'rat');
    expect(rat.roll).toBe(3);
    expect(rat.mod).toBe(2);
    expect(rat.total).toBe(5);
  });

  it('adds the hero sheet bonus on top of the modifier', () => {
    expect(initiativeModifier({ init: 1, initBonus: 2 })).toBe(3);
  });

  it('gives monsters of one type a single shared roll', () => {
    const combat = fight([monster('rat'), monster('rat'), monster('kobold')], { rng: dice(2, 5, 1) });
    const order = rollInitiative(combat);
    const rats = order.filter((entry) => entry.unit.type === 'rat');
    expect(rats).toHaveLength(2);
    expect(rats[0].roll).toBe(rats[1].roll);
    expect(rats[0].group).toBe(rats[1].group);
    expect(groupKeyOf(rats[0].unit)).toBe('type:rat');
    // Four units but three groups: the hero draws 2, the rats 5 between them,
    // the kobold 1 — three draws, not four.
    expect(orderIds(order)).toEqual(['rat-1', 'rat-2', 'hero', 'kobold-1']);
    expect(order.map((entry) => entry.roll)).toEqual([5, 5, 2, 1]);
  });

  it('is rolled fresh each round, so the order can change', () => {
    const rng = createStream('initiative-reroll', 'combat');
    const combat = createCombat({
      hero: hero({ init: 0 }),
      monsters: [monster('kobold', { init: 0 })],
      rng,
      surprise: false,
    });
    const rounds = new Set();
    for (let i = 0; i < 40; i += 1) rounds.add(orderIds(rollInitiative(combat)).join('>'));
    expect(rounds.size).toBe(2);
  });
});

describe('ties', () => {
  it('go to the hero', () => {
    // Both roll a 4 with no modifier.
    const combat = fight([monster('kobold')], { rng: dice(4) });
    expect(orderIds(rollInitiative(combat))).toEqual(['hero', 'kobold-1']);
  });

  it('go to the hero even when a monster has the better modifier', () => {
    const combat = fight([monster('kobold', { init: 3 })], { rng: dice(6, 3) });
    const order = rollInitiative(combat);
    expect(order.map((entry) => entry.total)).toEqual([6, 6]);
    expect(orderIds(order)).toEqual(['hero', 'kobold-1']);
  });

  it('go to the higher initiative modifier between monster groups', () => {
    // Hero 1; rats roll 2 with +3; kobolds roll 4 with +1. Both total 5.
    const combat = fight([monster('rat', { init: 3 }), monster('kobold', { init: 1 })], {
      rng: dice(1, 2, 4),
    });
    expect(orderIds(rollInitiative(combat))).toEqual(['rat-1', 'kobold-1', 'hero']);
  });

  it('come down to a coin flip when nothing else separates two groups', () => {
    // The stub shuffle reverses, so the flip is visible: kobolds before rats.
    const combat = fight([monster('rat'), monster('kobold')], { rng: dice(1, 4, 4) });
    expect(orderIds(rollInitiative(combat))).toEqual(['kobold-1', 'rat-1', 'hero']);
  });

  it('never spends the stream on a flip that is not needed', () => {
    let flips = 0;
    const rng = dice(1, 2, 3);
    rng.shuffle = (items) => {
      flips += 1;
      return items;
    };
    const combat = fight([monster('rat'), monster('kobold')], { rng });
    rollInitiative(combat);
    expect(flips).toBe(0);
  });

  it('draws the same number of times however the tie falls', () => {
    // A replay has to stay in step, so the flip is taken once per tie and the
    // sort itself never touches the stream.
    const draws = (seed) => {
      const rng = createStream(seed, 'combat');
      const combat = createCombat({
        hero: hero(),
        monsters: [monster('rat'), monster('kobold'), monster('bat', { row: 'back' })],
        rng,
        surprise: false,
      });
      const before = rng.state();
      rollInitiative(combat);
      return { before, after: rng.state() };
    };
    const a = draws('flip-a');
    const b = draws('flip-b');
    expect(a.before).not.toEqual(a.after);
    expect(b.before).not.toEqual(b.after);
  });
});

describe('units that share a roll', () => {
  it('act front row left to right, then back row left to right', () => {
    const combat = fight(
      [
        monster('rat'),
        monster('rat', { row: 'back' }),
        monster('rat'),
        monster('rat', { row: 'back' }),
      ],
      { rng: dice(1, 6) },
    );
    expect(orderIds(rollInitiative(combat))).toEqual([
      'rat-1',
      'rat-3',
      'rat-2',
      'rat-4',
      'hero',
    ]);
  });

  it('split by band but keep the group roll', () => {
    const combat = fight([monster('kobold'), monster('kobold')], { rng: dice(1, 5) });
    applyCondition(combat.units[1], 'slowed');
    const order = rollInitiative(combat);
    expect(orderIds(order)).toEqual(['kobold-2', 'hero', 'kobold-1']);
    expect(order[0].roll).toBe(5);
    expect(order[2].roll).toBe(5);
    expect(order[0].band).toBe('normal');
    expect(order[2].band).toBe('last');
  });
});

describe('who is in the order at all', () => {
  it('leaves out the dead and the fled', () => {
    const combat = fight([monster('rat'), monster('rat'), monster('rat')]);
    combat.units[1].alive = false;
    combat.units[2].fled = true;
    expect(orderIds(rollInitiative(combat))).toEqual(['hero', 'rat-3']);
  });

  it('leaves out objects, which stand there without acting', () => {
    const combat = fight([monster('valve', { object: true, row: 'back' }), monster('rat')]);
    expect(orderIds(rollInitiative(combat))).toEqual(['hero', 'rat-1']);
  });

  it('includes an object that is meant to act', () => {
    const combat = fight([monster('hydraBody', { object: true, acts: true, row: 'back' })]);
    expect(orderIds(rollInitiative(combat))).toContain('hydraBody-1');
  });

  it('takes only the units it is given, which is how a surprise round works', () => {
    const combat = fight([monster('rat')]);
    const order = rollInitiative(combat, { units: [combat.hero] });
    expect(orderIds(order)).toEqual(['hero']);
  });
});
