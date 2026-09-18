/**
 * The step clock (`01` section 9, `03` section 1, `05` sections 5 and 7,
 * `02` for the Hollow Stalker).
 *
 * The clock is the game's hidden cost, so these tests are about counting: how
 * often a check comes round, what it rolls against, and where it does not run
 * at all. Rolls come from a stub stream, so every check here is exact.
 */
import { describe, it, expect } from 'vitest';
import {
  createClock,
  ACTION_STEPS,
  costOf,
  inSafeZone,
  inDarkness,
  encounterRange,
  rollWanderingCheck,
  rollNoiseCheck,
  advance,
  immediateCheck,
  tick,
} from '../src/dungeon/step-clock.js';
import { createExploration, move } from '../src/dungeon/movement.js';
import { buildFloor, TILE, FACING } from '../src/dungeon/floor-builder.js';
import { createStream } from '../src/engine/rng.js';
import { layoutStream } from '../src/engine/rng.js';
import { pacing, stepClock } from '../src/data/floors.js';

/** A stream that hands out the numbers it was given, then repeats the last. */
function fakeRng(...dice) {
  const queue = [...dice];
  const rng = () => 0;
  rng.die = () => (queue.length > 1 ? queue.shift() : queue[0]);
  rng.label = 'fake';
  return rng;
}

const clockOf = (extra = {}) => ({ ...createClock(), ...extra });

describe('the numbers come from the data', () => {
  it('rolls a d6 every ten steps, as 01 section 9 says', () => {
    expect(stepClock.checkEvery).toBe(10);
    expect(stepClock.die).toBe(6);
    expect(stepClock.encounterUpTo).toBe(1);
  });

  it('knows what every careful action costs (03 section 1)', () => {
    expect(ACTION_STEPS.search).toBe(5);
    expect(ACTION_STEPS.carefulSearch).toBe(20);
    expect(ACTION_STEPS.pick).toBe(5);
    expect(ACTION_STEPS.disarm).toBe(5);
    expect(ACTION_STEPS.bash).toBe(2);
    expect(ACTION_STEPS.key).toBe(1);
    expect(costOf('carefulSearch')).toBe(20);
    expect(() => costOf('sing')).toThrow(/sing/);
  });
});

describe('how often an encounter happens', () => {
  it('is a 1 in 6 on the upper floors', () => {
    for (const floor of [1, 2, 3, 4, 5]) expect(encounterRange(floor)).toBe(1);
  });

  it('widens by one from floor 6 down (01 section 9)', () => {
    expect(encounterRange(6)).toBe(2);
    expect(encounterRange(10)).toBe(2);
  });

  it('doubles in the dark (01, Light)', () => {
    expect(encounterRange(1, { dark: true })).toBe(2);
    expect(encounterRange(6, { dark: true })).toBe(4);
  });

  it("takes an item's addition, which is how the Cursed Beacon works", () => {
    // 04: "Wandering monsters appear on a 1-2 instead of a 1."
    expect(encounterRange(1, { bonus: 1 })).toBe(2);
    expect(encounterRange(10, { bonus: 1, dark: true })).toBe(6);
  });

  it('never needs more than the die has faces', () => {
    expect(encounterRange(10, { bonus: 5, dark: true })).toBe(6);
  });
});

describe('one check', () => {
  it('is an encounter on a 1 and nothing on a 2', () => {
    expect(rollWanderingCheck(fakeRng(1), 1).encounter).toBe(true);
    expect(rollWanderingCheck(fakeRng(2), 1).encounter).toBe(false);
    // Floor 6 widens the range, so the same 2 now brings something.
    expect(rollWanderingCheck(fakeRng(2), 6).encounter).toBe(true);
  });

  it('reports the roll it made, so the result can be saved before it is shown', () => {
    // 05 section 11: commit random outcomes before showing them.
    const check = rollWanderingCheck(fakeRng(4), 3, { cause: 'steps' });
    expect(check).toMatchObject({ type: 'wanderingCheck', roll: 4, range: 1, encounter: false, cause: 'steps' });
  });

  it('carries surprise when the noise gave the monsters a free round', () => {
    const check = rollWanderingCheck(fakeRng(1), 3, { surprise: true, cause: 'gas_vent' });
    expect(check.surprise).toBe(true);
    expect(check.cause).toBe('gas_vent');
  });

  it('is 2 in 6 for the noise of a bash, 1 in 6 for Knock (03 section 6)', () => {
    expect(rollNoiseCheck(fakeRng(2), 'bash')).toMatchObject({ range: 2, encounter: true });
    expect(rollNoiseCheck(fakeRng(3), 'bash').encounter).toBe(false);
    expect(rollNoiseCheck(fakeRng(2), 'knock').encounter).toBe(false);
    expect(() => rollNoiseCheck(fakeRng(1), 'whistle')).toThrow(/whistle/);
  });
});

describe('advancing the clock', () => {
  it('checks on the tenth step, not before', () => {
    const clock = clockOf();
    const rng = fakeRng(6);
    for (let i = 0; i < 9; i += 1) {
      expect(advance({ clock, floorNumber: 1, rng })).toEqual([]);
    }
    const events = advance({ clock, floorNumber: 1, rng });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('wanderingCheck');
    expect(clock.steps).toBe(10);
    expect(clock.sinceCheck).toBe(0);
    expect(clock.checks).toBe(1);
  });

  it('rolls every check a slow action crosses', () => {
    // A Careful Search is 20 steps, so it pays for two checks at once.
    const clock = clockOf();
    const events = advance({ clock, floorNumber: 1, rng: fakeRng(6), steps: 20, cause: 'carefulSearch' });
    expect(events.filter((e) => e.type === 'wanderingCheck')).toHaveLength(2);
    expect(events[0].cause).toBe('carefulSearch');
    expect(clock.steps).toBe(20);
  });

  it('stops the clock in the Safe Room and the boss arena (05 section 5)', () => {
    const clock = clockOf();
    const events = advance({ clock, floorNumber: 1, rng: fakeRng(1), steps: 30, safe: true });
    expect(events.filter((e) => e.type === 'wanderingCheck')).toHaveLength(0);
    expect(clock.sinceCheck).toBe(0);
    expect(clock.checks).toBe(0);
    // The steps themselves still happened: the Stalker counts them.
    expect(clock.steps).toBe(30);
  });

  it('skips one check for a Potion of Invisibility, then carries on', () => {
    const clock = clockOf({ skipNextCheck: true });
    const rng = fakeRng(1);
    const skipped = advance({ clock, floorNumber: 1, rng, steps: 10 });
    expect(skipped[0].type).toBe('checkSkipped');
    expect(clock.skipNextCheck).toBe(false);

    const next = advance({ clock, floorNumber: 1, rng, steps: 10 });
    expect(next[0]).toMatchObject({ type: 'wanderingCheck', encounter: true });
  });

  it('rolls an immediate check without disturbing the ten-step rhythm', () => {
    const clock = clockOf();
    advance({ clock, floorNumber: 1, rng: fakeRng(6), steps: 7 });
    const events = immediateCheck({ clock, floorNumber: 1, rng: fakeRng(1), surprise: true, cause: 'gas_vent' });
    expect(events[0]).toMatchObject({ encounter: true, surprise: true, cause: 'gas_vent' });
    expect(clock.sinceCheck).toBe(7);
  });
});

describe('the Hollow Stalker', () => {
  it('warns at 1,000 and 1,250 steps, and arrives at 1,500 (02)', () => {
    const clock = clockOf();
    const rng = fakeRng(6);
    const say = (n) => advance({ clock, floorNumber: 1, rng, steps: n }).filter((e) => e.type.startsWith('stalker'));

    expect(say(999)).toEqual([]);
    expect(say(1)).toEqual([{ type: 'stalkerWarning', at: 1000, steps: 1000 }]);
    expect(say(250)).toEqual([{ type: 'stalkerWarning', at: 1250, steps: 1250 }]);
    expect(say(249)).toEqual([]);
    expect(say(1)).toEqual([{ type: 'stalker', steps: pacing.hollowStalkerSteps }]);
    expect(clock.stalkerLoose).toBe(true);
  });

  it('says each warning once, however long the hero stays', () => {
    const clock = clockOf();
    const events = advance({ clock, floorNumber: 1, rng: fakeRng(6), steps: 2000 });
    expect(events.filter((e) => e.type === 'stalkerWarning')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'stalker')).toHaveLength(1);
  });

  it('counts steps taken in the Safe Room too: it is an anti-grinding clock', () => {
    const clock = clockOf();
    const events = advance({ clock, floorNumber: 1, rng: fakeRng(6), steps: 1500, safe: true });
    expect(events.filter((e) => e.type === 'stalker')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* On a real floor                                                            */
/* -------------------------------------------------------------------------- */

const floor = buildFloor(4, 20260918, layoutStream);

describe('the clock on a generated floor', () => {
  it('knows the arena, its alcove and the Safe Room are off the clock', () => {
    const [ax, ay] = floor.arena.rect;
    expect(inSafeZone(floor, [ax + 4, ay + 4])).toBe(true);
    expect(inSafeZone(floor, floor.arena.stairsDown)).toBe(true);

    const safeRoom = floor.rooms.find((room) => room.id === floor.safeRoom);
    const [sx, sy] = safeRoom.rect;
    expect(inSafeZone(floor, [sx + 1, sy + 1])).toBe(true);

    expect(inSafeZone(floor, floor.start.pos)).toBe(false);
  });

  it('knows where the light fails', () => {
    const dark = Object.values(floor.hazards).find((h) => h.kind === 'dark_zone');
    const lit = Object.values(floor.hazards).find((h) => h.kind !== 'dark_zone');
    if (dark) expect(inDarkness(floor, dark.pos)).toBe(true);
    if (lit) expect(inDarkness(floor, lit.pos)).toBe(false);
    expect(inDarkness(floor, floor.start.pos)).toBe(false);
  });

  it('winds on as the hero walks, and is the same walk from the same seed', () => {
    const walkOnce = () => {
      const ex = createExploration(floor);
      const rng = createStream(4242, 'encounter');
      /** @type {object[]} */
      const log = [];
      // Turn on the spot: a turn is a tick of the clock like any other step.
      for (let i = 0; i < 40; i += 1) {
        const outcome = move(floor, ex, 'turnRight');
        log.push(...tick(floor, ex, rng, outcome.cost));
      }
      return { steps: ex.steps, checks: ex.checks, log };
    };

    const first = walkOnce();
    const second = walkOnce();
    expect(first.steps).toBe(40);
    expect(first.checks).toBe(4);
    expect(second).toEqual(first);
  });

  it('does not wind on when the hero walks into a wall', () => {
    const ex = createExploration(floor);
    const rng = createStream(1, 'encounter');
    // Face the wall the arrival dead end backs onto, then push at it.
    ex.facing = (floor.start.facing + 2) % 4;
    const outcome = move(floor, ex, 'forward');
    expect(outcome.blocked).not.toBe(null);
    expect(tick(floor, ex, rng, outcome.cost)).toEqual([]);
    expect(ex.steps).toBe(0);
  });
});

describe('a hand-built safe room', () => {
  /** Two tiles: one plain, one inside a Safe Room. */
  const room = {
    floor: 1,
    width: 5,
    height: 3,
    map: [
      [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
      [TILE.WALL, TILE.FLOOR, TILE.FLOOR, TILE.FLOOR, TILE.WALL],
      [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
    ],
    rooms: [{ id: 'r0', rect: [3, 1, 1, 1], role: 'safeRoom' }],
    arena: { rect: [9, 9, 1, 1] },
    start: { pos: [1, 1], facing: FACING.E },
    stairs: { up: [1, 1], down: [9, 9] },
    waystone: [1, 1],
    criticalPath: [],
    doors: {},
    keys: {},
    traps: {},
    chests: {},
    hazards: { '2,1': { kind: 'dark_zone', pos: [2, 1] } },
    secrets: {},
    curiosities: {},
  };

  it('picks up safety and darkness from where the hero stands', () => {
    const ex = createExploration(room);
    const rng = fakeRng(1);

    // On the plain tile: ten steps, one check, and the dark tile is next door.
    expect(inSafeZone(room, [1, 1])).toBe(false);
    expect(tick(room, ex, rng, 10).filter((e) => e.type === 'wanderingCheck')).toHaveLength(1);

    // In the dark, the range doubles.
    ex.pos = [2, 1];
    const dark = tick(room, ex, rng, 10).find((e) => e.type === 'wanderingCheck');
    expect(dark.range).toBe(2);

    // In the Safe Room, nothing is rolled at all.
    ex.pos = [3, 1];
    expect(tick(room, ex, rng, 10)).toEqual([]);
  });
});
