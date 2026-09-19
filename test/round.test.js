/**
 * Combat setup and the round (`06` sections 2 and 3).
 *
 * The round is ten numbered steps, and most of what happens in it is hooks.
 * These tests drive it with a `takeTurn` that only writes its own name down,
 * which is the point: the order is provable before a single attack exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks, ORDER } from '../src/engine/hooks.js';
import {
  CROWD_CAP,
  ROW_CAPACITY,
  createCombat,
  countedEnemies,
  place,
  rollSurprise,
} from '../src/engine/field.js';
import {
  ROUND_END_HOOKS,
  ROUND_START_HOOKS,
  SURPRISE_ROUND,
  beginCombat,
  combatOver,
  endRound,
  runRound,
  startRound,
} from '../src/engine/round.js';
import { orderIds } from '../src/engine/initiative.js';

const hero = (extra = {}) => ({ id: 'hero', hp: 12, maxHp: 12, init: 0, ...extra });
const monster = (type, extra = {}) => ({ type, hp: 6, maxHp: 6, init: 0, row: 'front', ...extra });

function fight({ monsters = [monster('rat')], seed = 'round', surprise = false, hooks } = {}) {
  return createCombat({
    hero: hero(),
    monsters,
    rng: createStream(seed, 'combat'),
    hooks,
    surprise,
  });
}

describe('setup (06 section 2)', () => {
  it('places monsters in their rows, left to right, in the order listed', () => {
    const combat = fight({
      monsters: [monster('rat'), monster('bat', { row: 'back' }), monster('rat')],
    });
    const placed = combat.units.map((unit) => `${unit.id}@${unit.row}${unit.slot}`);
    expect(placed).toEqual(['hero@front0', 'rat-1@front0', 'bat-1@back0', 'rat-2@front1']);
  });

  it('overflows a fifth front-row monster into the back row', () => {
    // Five Giant Rats are within the crowd cap but one over the row, so the
    // fifth waits behind and steps forward when there is room (`02`).
    const combat = fight({ monsters: Array.from({ length: 5 }, () => monster('rat')) });
    expect(countedEnemies(combat)).toHaveLength(5);
    expect(combat.units.at(-1)).toMatchObject({ id: 'rat-5', row: 'back', slot: 0 });
    expect(combat.turnedAway).toEqual([]);
  });

  it('turns away enemies over the 5-enemy crowd cap', () => {
    const combat = fight({ monsters: Array.from({ length: 7 }, () => monster('rat')) });
    expect(countedEnemies(combat)).toHaveLength(CROWD_CAP);
    expect(combat.turnedAway.map((row) => row.why)).toEqual(['crowded', 'crowded']);
  });

  it('lets objects stand beyond the cap, because they do not count toward it', () => {
    const combat = fight({
      monsters: [
        ...Array.from({ length: 5 }, () => monster('rat')),
        monster('valve', { object: true, row: 'back' }),
      ],
    });
    expect(countedEnemies(combat)).toHaveLength(5);
    expect(combat.units.some((unit) => unit.type === 'valve')).toBe(true);
  });

  it('holds four to a row, and refuses a fifth', () => {
    const combat = fight({ monsters: [] });
    for (let i = 0; i < ROW_CAPACITY; i += 1) {
      expect(place(combat, { id: `s${i}`, side: 'monsters', row: 'back', alive: true }).placed).toBe(true);
    }
    expect(place(combat, { id: 'late', side: 'monsters', row: 'back', alive: true })).toEqual({
      placed: false,
      why: 'rowFull',
    });
  });

  it('records the starting group size for morale, objects excluded', () => {
    const combat = fight({
      monsters: [monster('rat'), monster('rat'), monster('valve', { object: true, row: 'back' })],
    });
    expect(combat.startingGroupSize).toBe(2);
  });

  it('gives a surprise round to the one side that surprised the other', () => {
    const rolls = [1, 4];
    const rng = createStream('surprise', 'combat');
    rng.die = () => rolls.shift();
    const combat = createCombat({ hero: hero(), monsters: [monster('rat')], rng, surprise: false });
    combat.rng = rng;
    const result = rollSurprise(combat);
    expect(result).toMatchObject({ monstersSurprised: true, heroSurprised: false, side: 'hero' });
    expect(combat.units[1].surprised).toBe(true);
  });

  it('gives no surprise round when both sides roll it', () => {
    const rolls = [1, 1];
    const rng = createStream('surprise-both', 'combat');
    rng.die = () => rolls.shift();
    const combat = createCombat({ hero: hero(), monsters: [monster('rat')], rng, surprise: false });
    combat.rng = rng;
    expect(rollSurprise(combat).side).toBe(null);
  });

  it('rolls both dice even when a side cannot be surprised, so the stream keeps step', () => {
    const drawn = [];
    const rng = createStream('surprise-keen', 'combat');
    const die = rng.die;
    rng.die = (sides) => {
      const value = die(sides);
      drawn.push(value);
      return value;
    };
    const combat = createCombat({
      hero: hero({ cannotBeSurprised: true }),
      monsters: [monster('rat')],
      rng,
    });
    expect(drawn).toHaveLength(2);
    expect(combat.surprise.heroSurprised).toBe(false);
  });

  it('fires combatStart, and only after setup', () => {
    const hooks = createHooks();
    const seen = [];
    hooks.on('combatStart', (payload) => seen.push(payload.combat.startingGroupSize), {
      name: 'sneak',
    });
    const combat = fight({ monsters: [monster('rat'), monster('rat')], hooks });
    expect(seen).toEqual([]);
    beginCombat(combat);
    expect(seen).toEqual([2]);
  });
});

describe('round start (steps 1-6)', () => {
  it('counts rounds from 1, and calls the surprise round round 0', () => {
    const combat = fight();
    expect(startRound(combat, { surprise: true }).round).toBe(SURPRISE_ROUND);
    expect(startRound(combat).round).toBe(1);
    expect(startRound(combat).round).toBe(2);
  });

  it('lets only the surprising side act in round 0', () => {
    const combat = fight({ monsters: [monster('rat'), monster('kobold')] });
    combat.surprise = { side: 'hero', monstersSurprised: true, heroSurprised: false };
    expect(orderIds(startRound(combat, { surprise: true }).order)).toEqual(['hero']);
    // And everyone acts again from round 1.
    expect(orderIds(startRound(combat).order).sort()).toEqual(['hero', 'kobold-1', 'rat-1']);
  });

  it('gives the per-round reactions back (step 2)', () => {
    const combat = fight();
    combat.hero.reactions = { riposte: false, shieldBlock: false };
    startRound(combat);
    expect(combat.hero.reactions).toEqual({ riposte: true, shieldBlock: true });
  });

  it('does not hand a unit a reaction it never had', () => {
    const combat = fight();
    combat.hero.reactions = { riposte: false };
    startRound(combat);
    expect(combat.hero.reactions.guardian).toBeUndefined();
  });

  it('resets the hooks limited to one use a round', () => {
    const hooks = createHooks();
    const fired = vi.fn();
    hooks.on('roundStart', fired, { name: 'ghastStench', limit: { uses: 1, per: 'round' } });
    const combat = fight({ hooks });
    startRound(combat);
    startRound(combat);
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it('fires the start-of-round effects in the order of 06 section 3, not section 16', () => {
    // Step 3 turns the Grimoire's page before step 4's Ghast Stench, which the
    // examples column of section 16 lists the other way round.
    expect(ROUND_START_HOOKS).toEqual([
      'grimoirePage',
      'ghastStench',
      'basiliskGaze',
      'fallenTroll',
      'bossPhase',
    ]);
    expect(ORDER.roundStart).toEqual(ROUND_START_HOOKS);

    const hooks = createHooks();
    const order = [];
    // Registered backwards, so only the documented order can sort them.
    for (const name of [...ROUND_START_HOOKS].reverse()) {
      hooks.on('roundStart', () => order.push(name), { name });
    }
    startRound(fight({ hooks }));
    expect(order).toEqual(ROUND_START_HOOKS);
  });

  it('builds the turn order last, so a start-of-round effect can change it', () => {
    const hooks = createHooks();
    // The Ghast's stench Slows the hero this round; the hero then acts last.
    hooks.on('roundStart', (payload) => {
      payload.combat.hero.actsLast = true;
    }, { name: 'ghastStench' });
    const combat = fight({ monsters: [monster('rat')], hooks });
    expect(orderIds(startRound(combat).order).at(-1)).toBe('hero');
  });
});

describe('the turns (step 7)', () => {
  it('takes them in the order rolled, and saves after every one', () => {
    const combat = fight({ monsters: [monster('rat'), monster('bat', { row: 'back' })] });
    const turns = [];
    const save = vi.fn();
    const { order } = runRound(combat, {
      takeTurn: (_combat, unit) => turns.push(unit.id),
      save,
    });
    expect(turns).toEqual(orderIds(order));
    // One save per turn, plus the round's own save at step 10.
    expect(save).toHaveBeenCalledTimes(turns.length + 1);
  });

  it('skips a unit that died or fled before its turn came round', () => {
    const combat = fight({ monsters: [monster('rat'), monster('rat'), monster('rat')] });
    const turns = [];
    runRound(combat, {
      takeTurn: (_c, unit) => {
        turns.push(unit.id);
        // The hero's turn kills the second rat and frightens off the third.
        if (unit.id === 'hero') {
          combat.units[2].alive = false;
          combat.units[3].fled = true;
        }
      },
      // The fight is not over: one rat is still standing.
      isOver: () => false,
    });
    expect(turns).toContain('rat-1');
    expect(turns).not.toContain('rat-2');
    expect(turns).not.toContain('rat-3');
  });

  it('makes a new arrival wait for the next round (step 5 of Initiative)', () => {
    const combat = fight({ monsters: [monster('rat')] });
    const turns = [];
    runRound(combat, {
      takeTurn: (_c, unit) => {
        turns.push(unit.id);
        if (unit.id === 'rat-1' && !combat.units.some((u) => u.type === 'summon')) {
          place(combat, { id: 'summon-1', type: 'summon', side: 'monsters', row: 'back', alive: true });
        }
      },
    });
    expect(turns).not.toContain('summon-1');
    const next = runRound(combat, { takeTurn: (_c, unit) => turns.push(unit.id) });
    expect(orderIds(next.order)).toContain('summon-1');
  });

  it('stops the moment the fight is over', () => {
    const combat = fight({ monsters: [monster('rat'), monster('rat')] });
    const turns = [];
    runRound(combat, {
      takeTurn: (_c, unit) => {
        turns.push(unit.id);
        for (const enemy of combat.units) if (enemy.side === 'monsters') enemy.alive = false;
      },
    });
    expect(turns).toHaveLength(1);
    expect(combat.over).toBe(true);
  });
});

describe('round end (steps 8-10)', () => {
  it('fires the end-of-round effects in the documented order', () => {
    expect(ROUND_END_HOOKS).toEqual([
      'shriek',
      'regrowth',
      'reassemble',
      'summons',
      'sickened',
    ]);
    const hooks = createHooks();
    const order = [];
    for (const name of [...ROUND_END_HOOKS].reverse()) {
      hooks.on('roundEnd', () => order.push(name), { name });
    }
    endRound(fight({ hooks }));
    expect(order).toEqual(ROUND_END_HOOKS);
  });

  it('spends the surprise: the flags are gone after round 0', () => {
    const combat = fight({ monsters: [monster('rat')] });
    combat.surprise = { side: 'hero' };
    combat.units[1].surprised = true;
    runRound(combat, { surprise: true, takeTurn: () => {} });
    expect(combat.units[1].surprised).toBeUndefined();
  });

  it('checks combat end and saves, in that order', () => {
    const combat = fight({ monsters: [monster('rat')] });
    let overWhenSaved = null;
    combat.units[1].alive = false;
    endRound(combat, { save: (c) => (overWhenSaved = c.over) });
    expect(overWhenSaved).toBe(true);
  });
});

describe('combat end (06 section 15)', () => {
  it('ends when no enemies remain', () => {
    const combat = fight({ monsters: [monster('rat')] });
    expect(combatOver(combat)).toBe(false);
    combat.units[1].alive = false;
    expect(combatOver(combat)).toBe(true);
  });

  it('ends when the hero flees or is defeated', () => {
    const fled = fight();
    fled.hero.fled = true;
    expect(combatOver(fled)).toBe(true);
    const dead = fight();
    dead.hero.alive = false;
    expect(combatOver(dead)).toBe(true);
  });

  it('does not end while an unburned Fallen troll lies there', () => {
    const combat = fight({ monsters: [monster('troll')] });
    const troll = combat.units[1];
    troll.alive = false;
    troll.fallen = true;
    expect(combatOver(combat)).toBe(false);
    troll.burned = true;
    expect(combatOver(combat)).toBe(true);
  });

  it('does not count objects as enemies that keep the fight going', () => {
    const combat = fight({
      monsters: [monster('rat'), monster('valve', { object: true, row: 'back' })],
    });
    combat.units[1].alive = false;
    expect(combatOver(combat)).toBe(true);
  });
});

describe('the same fight twice', () => {
  it('runs identically from the same seed', () => {
    const play = () => {
      const combat = fight({
        monsters: [monster('rat'), monster('kobold', { init: 1 })],
        seed: 'replay',
        surprise: true,
      });
      const turns = [];
      beginCombat(combat);
      if (combat.surprise.side) runRound(combat, { surprise: true, takeTurn: (_c, u) => turns.push(`0:${u.id}`) });
      for (let round = 1; round <= 3; round += 1) {
        runRound(combat, { takeTurn: (_c, u) => turns.push(`${round}:${u.id}`), isOver: () => false });
      }
      return turns;
    };
    expect(play()).toEqual(play());
  });
});
