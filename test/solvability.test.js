/**
 * The solvability check (`05` section 4).
 *
 * The point of the check is that it is pessimistic: a hero with no skills and
 * no items has to be able to finish the floor. These tests hand it floors that
 * break each rule in turn and confirm it says so, then confirm that the floors
 * the builder actually produces pass.
 */
import { describe, it, expect } from 'vitest';
import {
  checkSolvable,
  floodFill,
  canStep,
  describeReach,
  repairOneWayDoors,
  MINIMUM_HERO,
} from '../src/dungeon/solvability.js';
import { buildFloor, TILE } from '../src/dungeon/floor-builder.js';
import { layoutStream } from '../src/engine/rng.js';
import { allFloorSpecs } from '../src/data/floors.js';

const SEED = 20260918;
const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

/**
 * A tiny hand-built floor: a corridor from the arrival point at 1,1 east to
 * the arena entrance at 7,1, with a door in the middle at 4,1.
 *
 *   # # # # # # # # #
 *   # < . . + . . A #
 *   # # # # # # # # #
 */
function corridorFloor(door = { kind: 'open' }) {
  const W = 9;
  const map = Array.from({ length: 3 }, () => new Array(W).fill(TILE.WALL));
  for (let x = 1; x <= 7; x += 1) map[1][x] = TILE.FLOOR;
  map[1][1] = TILE.STAIRS_UP;
  map[1][4] = TILE.DOOR;

  return {
    floor: 1,
    width: W,
    height: 3,
    map,
    rooms: [],
    start: { pos: [1, 1], facing: 1 },
    stairs: { up: [1, 1], down: [7, 1] },
    waystone: [2, 1],
    arena: { entrance: [7, 1], rect: [7, 1, 1, 1], door: [7, 1] },
    criticalPath: [],
    doors: { '4,1': { pos: [4, 1], ...door } },
    keys: {},
    hazards: {},
    secrets: {},
  };
}

describe('what the minimum hero can do', () => {
  it('has no skills and no items, by definition', () => {
    // 05 section 4: can't find secret doors, open Sealed doors, or rely on
    // teleporters.
    expect(MINIMUM_HERO.canFindSecretDoors).toBe(false);
    expect(MINIMUM_HERO.canOpenSealed).toBe(false);
    expect(MINIMUM_HERO.canUseTeleporters).toBe(false);
    expect(MINIMUM_HERO.canBash).toBe(true);
    expect(MINIMUM_HERO.canUseKeys).toBe(true);
  });

  it('walks through an open, stuck or locked door, because it can be bashed', () => {
    for (const kind of ['open', 'stuck', 'locked']) {
      expect(checkSolvable(corridorFloor({ kind })).ok, kind).toBe(true);
    }
  });

  it('cannot get through a Sealed door', () => {
    const verdict = checkSolvable(corridorFloor({ kind: 'sealed' }));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('boss arena cannot be reached');
  });

  it('cannot get through a secret door it has not found', () => {
    const floor = corridorFloor();
    floor.map[1][4] = TILE.ILLUSION;
    floor.doors = {};
    floor.secrets = { '4,1': { kind: 'shortcut', found: false } };
    expect(checkSolvable(floor).ok).toBe(false);
  });

  it('will not route through a teleporter pad', () => {
    const floor = corridorFloor();
    floor.map[1][4] = TILE.FLOOR;
    floor.doors = {};
    floor.hazards = { '4,1': { kind: 'teleporter_pad', pos: [4, 1], destination: [2, 1] } };
    expect(checkSolvable(floor).ok).toBe(false);
  });

  it('opens a keyed door only once it has walked over the key', () => {
    const withKey = corridorFloor({ kind: 'keyed', keyId: 'floorkey_f1_0' });
    withKey.keys = { '2,1': { id: 'floorkey_f1_0', kind: 'floor', opens: '4,1' } };
    expect(checkSolvable(withKey).ok).toBe(true);

    // The same floor with the key behind its own door is not finishable.
    const keyBehind = corridorFloor({ kind: 'keyed', keyId: 'floorkey_f1_0' });
    keyBehind.keys = { '6,1': { id: 'floorkey_f1_0', kind: 'floor', opens: '4,1' } };
    expect(checkSolvable(keyBehind).ok).toBe(false);
  });

  it('picks up keys one after another, so a chain of doors still opens', () => {
    // Key A by the entrance opens door A, and key B behind it opens door B.
    const floor = corridorFloor();
    floor.map[1][4] = TILE.DOOR;
    floor.map[1][6] = TILE.DOOR;
    floor.doors = {
      '4,1': { pos: [4, 1], kind: 'keyed', keyId: 'k1' },
      '6,1': { pos: [6, 1], kind: 'keyed', keyId: 'k2' },
    };
    floor.keys = {
      '2,1': { id: 'k1', kind: 'floor', opens: '4,1' },
      '5,1': { id: 'k2', kind: 'floor', opens: '6,1' },
    };
    const verdict = checkSolvable(floor);
    expect(verdict.ok).toBe(true);
    expect([...verdict.keysHeld].sort()).toEqual(['k1', 'k2']);
  });
});

describe('one-directional doors', () => {
  it('lets the hero through from the side the door opens to', () => {
    const floor = corridorFloor({ kind: 'barred', passFrom: [3, 1] });
    expect(canStep(floor, [3, 1], [4, 1], new Set())).toBe(true);
    expect(canStep(floor, [5, 1], [4, 1], new Set())).toBe(false);
  });

  it('fails a floor the hero cannot walk back out of', () => {
    // Barred the wrong way round: the arena is reachable, but the hero can
    // never return, which 05 section 4 forbids.
    const floor = corridorFloor({ kind: 'barred', passFrom: [3, 1] });
    const verdict = checkSolvable(floor);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('cannot walk back');
  });

  it('opens up the door responsible rather than losing the floor', () => {
    const floor = corridorFloor({ kind: 'barred', passFrom: [3, 1] });
    expect(checkSolvable(floor).ok).toBe(false);

    const demoted = repairOneWayDoors(floor);
    expect(demoted).toBe(1);
    expect(floor.doors['4,1'].kind).toBe('open');
    expect(floor.doors['4,1'].wasOneDirectional).toBe('barred');
    expect(checkSolvable(floor).ok).toBe(true);
  });

  it('leaves a door alone when nothing is stranded', () => {
    const floor = corridorFloor({ kind: 'open' });
    expect(repairOneWayDoors(floor)).toBe(0);
  });
});

describe('what the check refuses', () => {
  it('fails when the down stairs cannot be reached', () => {
    const floor = corridorFloor();
    floor.stairs.down = [7, 2]; // solid wall
    expect(checkSolvable(floor).problems.join(' ')).toContain('down stairs');
  });

  it('fails when the waystone cannot be stood on', () => {
    const floor = corridorFloor();
    floor.waystone = [4, 2];
    expect(checkSolvable(floor).problems.join(' ')).toContain('waystone');
  });

  it('fails when a rune key is out of reach', () => {
    const floor = corridorFloor();
    floor.keys = { '4,2': { id: 'runekey_f1_0', kind: 'rune', opens: '9,9' } };
    expect(checkSolvable(floor).problems.join(' ')).toContain('rune key');
  });

  it('names every problem it found, not just the first', () => {
    const floor = corridorFloor({ kind: 'sealed' });
    floor.waystone = [4, 2];
    expect(checkSolvable(floor).problems.length).toBeGreaterThan(1);
  });
});

describe('every floor the builder makes', () => {
  it.each(floors)('floor %i passes the check', (number, floor) => {
    const verdict = checkSolvable(floor);
    expect(verdict.ok, verdict.problems.join('; ')).toBe(true);
  });

  it.each(floors)('floor %i can be walked from arrival to the boss and back', (number, floor) => {
    const { reachable } = floodFill(floor);
    expect(reachable.has(`${floor.arena.entrance[0]},${floor.arena.entrance[1]}`)).toBe(true);
    expect(reachable.has(`${floor.stairs.down[0]},${floor.stairs.down[1]}`)).toBe(true);

    const back = floodFill(floor, floor.start.pos, true).reachable;
    for (const at of reachable) expect(back.has(at), `${at} cannot get home`).toBe(true);
  });

  it.each(floors)('floor %i leaves only optional content out of reach', (number, floor) => {
    // 05 section 4: Secret Stashes and Sealed rooms may need skills or items.
    // Everything else should be walkable by a hero with neither.
    const reach = describeReach(floor);
    expect(reach.share, `only ${(reach.share * 100).toFixed(1)}% reachable`).toBeGreaterThan(0.9);
  });

  it('gives the same verdict every time for one seed', () => {
    const once = checkSolvable(buildFloor(6, 4242, layoutStream));
    const twice = checkSolvable(buildFloor(6, 4242, layoutStream));
    expect(twice.ok).toBe(once.ok);
    expect([...twice.reachable].sort()).toEqual([...once.reachable].sort());
  });
});

describe('across many seeds', () => {
  it('builds 20 seeds x 10 floors and every one is finishable', () => {
    let rebuilt = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      for (let number = 1; number <= 10; number += 1) {
        const floor = buildFloor(number, seed * 8191, layoutStream);
        const verdict = checkSolvable(floor);
        expect(verdict.ok, `seed ${seed}, floor ${number}: ${verdict.problems.join('; ')}`).toBe(true);
        if (floor.attempt > 0) rebuilt += 1;
      }
    }
    // Rebuilding is meant to be the exception, not the rule.
    expect(rebuilt).toBeLessThan(40);
  });
});
