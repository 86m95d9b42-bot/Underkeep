/**
 * The floor builder (`07` section 3, steps 1 and 2; `05` sections 3 and 5).
 *
 * The shape of a floor matters more than any single number here: the arena has
 * one way in, the down stairs are behind it, the arrival point is far away, and
 * everything the hero can see is reachable.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  withRng,
  generateLayout,
  buildFloor,
  stampBossArena,
  placeArrival,
  distancesFrom,
  reachableCount,
  isWalkable,
  RegenerateFloor,
  MAX_ATTEMPTS,
  TILE,
  DungeonGenerator,
} from '../src/dungeon/floor-builder.js';
import { layoutStream } from '../src/engine/rng.js';
import { floorSpec, allFloorSpecs } from '../src/data/floors.js';

const SEED = 20260918;

/** Every walkable tile on a map. */
const walkable = (map) => map.flat().filter(isWalkable).length;

/**
 * Walkable once secret doors are found. A secret door is an ILLUSION tile, so
 * a floor is whole only when they count as passable; the stash behind one is
 * meant to be cut off until it is found (05 section 3 step 6).
 */
const orSecret = (tile) => isWalkable(tile) || tile === TILE.ILLUSION;
const walkableOrSecret = (map) => map.flat().filter(orSecret).length;

/** The gaps in the arena's wall ring. */
function ringOpenings(floor) {
  const [ax, ay, aw, ah] = floor.arena.rect;
  /** @type {[number, number][]} */
  const open = [];
  for (let x = ax - 1; x <= ax + aw; x++) {
    for (const y of [ay - 1, ay + ah]) if (isWalkable(floor.map[y][x])) open.push([x, y]);
  }
  for (let y = ay; y < ay + ah; y++) {
    for (const x of [ax - 1, ax + aw]) if (isWalkable(floor.map[y][x])) open.push([x, y]);
  }
  return open;
}

describe('withRng', () => {
  it('lends the stream to Math.random for the length of the call', () => {
    expect(withRng(() => 0.25, () => [Math.random(), Math.random()])).toEqual([0.25, 0.25]);
  });

  it('puts the real Math.random back afterwards', () => {
    const real = Math.random;
    withRng(() => 0.5, () => Math.random());
    expect(Math.random).toBe(real);
  });

  it('puts it back even when the call throws', () => {
    const real = Math.random;
    expect(() =>
      withRng(() => 0.5, () => {
        throw new Error('generation failed');
      }),
    ).toThrow('generation failed');
    expect(Math.random).toBe(real);
  });

  it('nests without losing the outer stream', () => {
    const real = Math.random;
    const seen = withRng(() => 0.1, () => {
      const before = Math.random();
      const nested = withRng(() => 0.9, () => Math.random());
      return [before, nested, Math.random()];
    });
    expect(seen).toEqual([0.1, 0.9, 0.1]);
    expect(Math.random).toBe(real);
  });

  it('refuses anything that is not a stream, rather than silently not seeding', () => {
    const real = Math.random;
    expect(() => withRng(undefined, () => 1)).toThrow(TypeError);
    expect(() => withRng([1, 2, 3, 4], () => 1)).toThrow(TypeError);
    expect(Math.random).toBe(real);
  });

  it('actually reaches the vendored generator, which is the whole point', () => {
    const rng = vi.fn(layoutStream(1, 1));
    withRng(rng, () => DungeonGenerator.generate(33, 33, { roomDensity: 0.13 }));
    expect(rng.mock.calls.length).toBeGreaterThan(100);
  });
});

describe('generateLayout', () => {
  it('builds a floor at the size the spec asks for', () => {
    const spec = floorSpec(1);
    const { map, rooms } = generateLayout(spec, layoutStream(123, 1));
    expect(map.length).toBe(spec.height);
    expect(map[0].length).toBe(spec.width);
    expect(rooms.length).toBeGreaterThan(0);
  });

  it('rebuilds the same floor from the same master seed and floor number', () => {
    const once = generateLayout(3, layoutStream(918273645, 3));
    const twice = generateLayout(3, layoutStream(918273645, 3));
    expect(twice.map).toEqual(once.map);
  });

  it('never places stairs itself: the floor builder does that', () => {
    const { map } = generateLayout(1, layoutStream(5150, 1));
    const tiles = new Set(map.flat());
    expect(tiles.has(TILE.STAIRS_DOWN)).toBe(false);
    expect(tiles.has(TILE.STAIRS_UP)).toBe(false);
  });

  it('leaves Math.random alone', () => {
    const real = Math.random;
    generateLayout(1, layoutStream(1, 1));
    expect(Math.random).toBe(real);
  });
});

describe('every floor builds', () => {
  const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

  it.each(floors)('floor %i', (number, floor) => {
    const spec = floorSpec(number);

    expect(floor.width).toBe(spec.width);
    expect(floor.map.length).toBe(spec.height);
    expect(floor.map.every((row) => row.length === spec.width)).toBe(true);

    const known = new Set(Object.values(TILE));
    for (const row of floor.map) for (const tile of row) expect(known.has(tile)).toBe(true);
  });

  it.each(floors)('floor %i is one connected place, once its secrets are found', (number, floor) => {
    // Nothing may be walled off for good. The stash is deliberately sealed
    // behind a secret door, so secret doors count as passable here.
    const reached = distancesFrom(floor.map, floor.start.pos, orSecret)
      .flat()
      .filter((d) => d >= 0).length;
    expect(reached).toBe(walkableOrSecret(floor.map));
  });

  it.each(floors)('floor %i has an arena of the size 05 section 5 gives', (number, floor) => {
    const spec = floorSpec(number);
    const [ax, ay, aw, ah] = floor.arena.rect;
    expect([aw, ah]).toEqual([spec.arenaSize, spec.arenaSize]);

    // Its inside is clear, so the boss fight has the shape it needs.
    for (let y = ay; y < ay + ah; y++) {
      for (let x = ax; x < ax + aw; x++) expect(floor.map[y][x]).toBe(TILE.FLOOR);
    }
  });

  it.each(floors)('floor %i lets the arena be entered exactly one way', (number, floor) => {
    // 05 section 5: one entrance door, and an alcove that is not a way in.
    const openings = ringOpenings(floor);
    expect(openings).toHaveLength(2);

    const kinds = openings.map(([x, y]) => floor.map[y][x]).sort();
    expect(kinds).toEqual([TILE.STAIRS_DOWN, TILE.DOOR].sort());
    expect(floor.map[floor.arena.door[1]][floor.arena.door[0]]).toBe(TILE.DOOR);
  });

  it.each(floors)('floor %i puts the down stairs behind the arena', (number, floor) => {
    // 05 section 5: reachable only through the arena. Wall the arena off and
    // the stairs must become unreachable.
    const [ax, ay, aw, ah] = floor.arena.rect;
    const walledOff = floor.map.map((row) => [...row]);
    for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) walledOff[y][x] = TILE.WALL;

    const dist = distancesFrom(walledOff, floor.start.pos);
    expect(dist[floor.stairs.down[1]][floor.stairs.down[0]]).toBe(-1);

    // And with the arena open, they must be reachable.
    const open = distancesFrom(floor.map, floor.start.pos);
    expect(open[floor.stairs.down[1]][floor.stairs.down[0]]).toBeGreaterThan(0);
  });

  it.each(floors)('floor %i puts the hero on the up stairs, beside a waystone', (number, floor) => {
    // 05 section 9: every floor has a Waystone in its arrival room.
    expect(floor.map[floor.stairs.up[1]][floor.stairs.up[0]]).toBe(TILE.STAIRS_UP);
    expect(floor.start.pos).toEqual(floor.stairs.up);
    expect([0, 1, 2, 3]).toContain(floor.start.facing);

    // The waystone is a side-table entry on a walkable tile of its own, never
    // on the stairs: tiles hold terrain only (DECISIONS, 2026-09-18).
    expect(floor.waystone).not.toEqual(floor.stairs.up);
    const [wx, wy] = floor.waystone;
    expect(isWalkable(floor.map[wy][wx])).toBe(true);
    const gap = Math.abs(wx - floor.stairs.up[0]) + Math.abs(wy - floor.stairs.up[1]);
    expect(gap).toBe(1);
  });

  it.each(floors)('floor %i arrives a long way from the arena', (number, floor) => {
    // 05 section 3 step 5: the arrival point is the farthest from the arena.
    const dist = distancesFrom(floor.map, floor.arena.entrance);
    const here = dist[floor.start.pos[1]][floor.start.pos[0]];
    expect(here).toBeGreaterThan(0);

    const farthest = Math.max(...dist.flat());
    expect(here).toBeGreaterThan(farthest * 0.5);
  });

  it.each(floors)('floor %i names a Safe Room in front of the arena', (number, floor) => {
    // 05 section 5: the room right before the arena.
    const safe = floor.rooms.find((room) => room.id === floor.safeRoom);
    expect(safe).toBeTruthy();
    expect(safe.role).toBe('safeRoom');

    const dist = distancesFrom(floor.map, floor.arena.entrance);
    const [sx, sy, sw, sh] = safe.rect;
    let nearest = Infinity;
    for (let y = sy; y < sy + sh; y++) {
      for (let x = sx; x < sx + sw; x++) {
        const d = dist[y]?.[x];
        if (d >= 0) nearest = Math.min(nearest, d);
      }
    }
    // No other room is closer to the arena than the one chosen. The arena is
    // itself listed as a room, so it is skipped.
    for (const room of floor.rooms) {
      if (room.role === 'bossArena') continue;
      const [rx, ry, rw, rh] = room.rect;
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const d = dist[y]?.[x];
          if (d >= 0) expect(d).toBeGreaterThanOrEqual(nearest);
        }
      }
    }
  });
});

describe('rebuilding from a seed', () => {
  it('gives the same floor every time', () => {
    const once = buildFloor(4, 777, layoutStream);
    const twice = buildFloor(4, 777, layoutStream);
    expect(twice.map).toEqual(once.map);
    expect(twice.arena).toEqual(once.arena);
    expect(twice.stairs).toEqual(once.stairs);
    expect(twice.waystone).toEqual(once.waystone);
    expect(twice.start).toEqual(once.start);
    expect(twice.safeRoom).toEqual(once.safeRoom);
  });

  it('gives different floors of one game different shapes', () => {
    const one = buildFloor(1, 4242, layoutStream);
    const two = buildFloor(2, 4242, layoutStream);
    expect(two.map).not.toEqual(one.map);
  });

  it('gives different games different floors', () => {
    expect(buildFloor(1, 1000, layoutStream).map).not.toEqual(buildFloor(1, 1001, layoutStream).map);
  });

  it('records which attempt produced the floor', () => {
    expect(buildFloor(1, SEED, layoutStream).attempt).toBeGreaterThanOrEqual(0);
  });
});

describe('when a floor cannot be finished', () => {
  it('tries again with the next seed, and says which attempt won', () => {
    // 05 section 3 step 10. A stream of zeros makes the generator produce a
    // floor the builder cannot finish, so attempt 0 is forced to fail here.
    const failFirst = (seed, floor, attempt) =>
      attempt === 0 ? () => 0 : layoutStream(seed, floor, attempt);

    const floor = buildFloor(1, 99, failFirst);
    expect(floor.attempt).toBe(1);
    // And the floor it settled on is a real one.
    expect(reachableCount(floor.map, floor.start.pos)).toBeGreaterThan(walkable(floor.map) * 0.9);
  });

  it('asks the stream for each attempt in turn', () => {
    const makeStream = vi.fn((seed, floor, attempt) =>
      attempt < 2 ? () => 0 : layoutStream(seed, floor, attempt),
    );
    buildFloor(1, 31337, makeStream);
    expect(makeStream.mock.calls.map((call) => call[2])).toEqual([0, 1, 2]);
  });

  it('gives up with every reason listed, rather than looping forever', () => {
    let error;
    try {
      buildFloor(1, 1, () => () => 0);
    } catch (err) {
      error = err;
    }
    expect(error, 'a floor that can never be built must throw').toBeDefined();
    expect(error).not.toBeInstanceOf(RegenerateFloor);
    expect(error.message).toContain(`${MAX_ATTEMPTS} attempts`);
    // Each attempt's reason is kept, so a failure can be diagnosed.
    expect(error.message.split('attempt ').length - 1).toBe(MAX_ATTEMPTS);
  });

  it('refuses an arena that will not fit on the map at all', () => {
    const tiny = Array.from({ length: 9 }, () => new Array(9).fill(TILE.WALL));
    expect(() => stampBossArena(tiny, { ...floorSpec(1), width: 9, height: 9 })).toThrow(
      RegenerateFloor,
    );
  });

  it('refuses to place arrival when nothing can reach the arena', () => {
    const sealed = Array.from({ length: 21 }, () => new Array(21).fill(TILE.WALL));
    const spec = { ...floorSpec(1), width: 21, height: 21 };
    expect(() => placeArrival(sealed, spec, { entrance: [1, 1], rect: [5, 5, 9, 9] })).toThrow(
      RegenerateFloor,
    );
  });
});

describe('across many seeds', () => {
  const SEEDS = 25;

  it(`builds every floor for ${SEEDS} seeds, each one whole`, () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      for (let number = 1; number <= 10; number += 1) {
        const floor = buildFloor(number, seed * 7919, layoutStream);
        const where = `seed ${seed}, floor ${number}`;

        const reached = distancesFrom(floor.map, floor.start.pos, orSecret)
          .flat()
          .filter((d) => d >= 0).length;
        expect(reached, `${where}: not all reachable`).toBe(walkableOrSecret(floor.map));
        expect(ringOpenings(floor), `${where}: arena openings`).toHaveLength(2);

        const dist = distancesFrom(floor.map, floor.start.pos);
        expect(dist[floor.arena.entrance[1]][floor.arena.entrance[0]], `${where}: arena`).toBeGreaterThan(0);
        expect(dist[floor.stairs.down[1]][floor.stairs.down[0]], `${where}: stairs`).toBeGreaterThan(0);
        expect(dist[floor.waystone[1]][floor.waystone[0]], `${where}: waystone`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the critical path', () => {
  const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

  it.each(floors)('floor %i runs from arrival to the arena door, step by step', (number, floor) => {
    // 05 section 3 step 5: the shortest walking route from arrival to the arena.
    const path = floor.criticalPath;
    expect(path[0]).toEqual(floor.start.pos);
    expect(path.at(-1)).toEqual(floor.arena.entrance);

    for (const [x, y] of path) expect(isWalkable(floor.map[y][x])).toBe(true);

    for (let i = 1; i < path.length; i += 1) {
      const gap = Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]);
      expect(gap, `step ${i} jumps`).toBe(1);
    }
  });

  it.each(floors)('floor %i takes the shortest route there is', (number, floor) => {
    const dist = distancesFrom(floor.map, floor.arena.entrance);
    expect(floor.criticalPath).toHaveLength(dist[floor.start.pos[1]][floor.start.pos[0]] + 1);
  });

  it.each(floors)('floor %i never repeats a tile', (number, floor) => {
    const seen = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
    expect(seen.size).toBe(floor.criticalPath.length);
  });
});

describe('room depth', () => {
  const floor = buildFloor(6, SEED, layoutStream);

  it('measures every room from the arrival tile', () => {
    // 07 step 3: flood-fill distances from the arrival tile.
    const dist = distancesFrom(floor.map, floor.start.pos);
    for (const room of floor.rooms) {
      const [rx, ry, rw, rh] = room.rect;
      let nearest = -1;
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const d = dist[y]?.[x];
          if (d >= 0 && (nearest === -1 || d < nearest)) nearest = d;
        }
      }
      expect(room.depth, room.id).toBe(nearest);
    }
  });

  it('puts the arena deeper than the room the hero arrives nearest', () => {
    const arena = floor.rooms.find((room) => room.role === 'bossArena');
    const shallowest = Math.min(...floor.rooms.filter((r) => r.depth >= 0).map((r) => r.depth));
    expect(arena.depth).toBeGreaterThan(shallowest);
  });

  it('marks the rooms the critical path runs through', () => {
    const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
    for (const room of floor.rooms) {
      const [rx, ry, rw, rh] = room.rect;
      let crosses = false;
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) if (onPath.has(`${x},${y}`)) crosses = true;
      }
      expect(room.onCriticalPath, room.id).toBe(crosses);
    }
  });
});

describe('room roles', () => {
  const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

  it.each(floors)('floor %i gives every room exactly one role', (number, floor) => {
    const known = ['bossArena', 'safeRoom', 'treasure', 'curiosity', 'theme', 'lair', 'plain'];
    for (const room of floor.rooms) expect(known, room.id).toContain(room.role);

    expect(floor.rooms.filter((r) => r.role === 'bossArena')).toHaveLength(1);
    expect(floor.rooms.filter((r) => r.role === 'safeRoom')).toHaveLength(1);
  });

  it.each(floors)('floor %i places the lairs 05 section 3 step 6 asks for', (number, floor) => {
    // 2 + floor(F / 2).
    const lairs = floor.rooms.filter((room) => room.role === 'lair');
    expect(lairs).toHaveLength(floor.spec.counts.lairs);
  });

  it.each(floors)('floor %i keeps each other role inside its range', (number, floor) => {
    const count = (role) => floor.rooms.filter((room) => room.role === role).length;
    for (const role of ['treasure', 'curiosity', 'theme']) {
      const [min, max] = floor.spec.roomRoles[role];
      expect(count(role), role).toBeGreaterThanOrEqual(min);
      expect(count(role), role).toBeLessThanOrEqual(max);
    }
  });

  it.each(floors)('floor %i puts treasure rooms off the critical path', (number, floor) => {
    // 05 section 3 step 6: deepest rooms off the critical path.
    for (const room of floor.rooms.filter((r) => r.role === 'treasure')) {
      expect(room.onCriticalPath, `${room.id} is on the path`).toBe(false);
    }
  });

  it.each(floors)('floor %i puts treasure in the deepest rooms it can', (number, floor) => {
    const treasure = floor.rooms.filter((r) => r.role === 'treasure');
    const rivals = floor.rooms.filter(
      (r) => !r.onCriticalPath && r.depth >= 0 && ['plain', 'lair', 'curiosity', 'theme'].includes(r.role),
    );
    const shallowestTreasure = Math.min(...treasure.map((r) => r.depth));
    for (const room of rivals) {
      expect(room.depth, `${room.id} is deeper than a treasure room`).toBeLessThanOrEqual(
        shallowestTreasure,
      );
    }
  });

  it('never gives a role to a room the arena ate', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (let number = 1; number <= 10; number += 1) {
        const floor = buildFloor(number, seed * 3571, layoutStream);
        for (const room of floor.rooms) {
          if (room.depth >= 0) continue;
          expect(room.role, `${number}/${room.id}`).toBe('plain');
        }
      }
    }
  });
});

describe('the secret stash', () => {
  const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

  it.each(floors)('floor %i hides it at a dead end away from the route', (number, floor) => {
    // 05 section 3 step 6: a dead end sealed with a secret door.
    expect(floor.secretStash).not.toBeNull();
    const [sx, sy] = floor.secretStash;

    const deadEnds = DungeonGenerator.findDeadEnds(floor.map, floor.width, floor.height);
    expect(deadEnds.some((end) => end.x === sx && end.y === sy)).toBe(true);

    const onPath = floor.criticalPath.some(([x, y]) => x === sx && y === sy);
    expect(onPath).toBe(false);

    expect(floor.secretStash).not.toEqual(floor.stairs.up);
    expect(floor.secretStash).not.toEqual(floor.waystone);

    // It is sealed behind its secret door, so it is out of reach until found,
    // and reachable once it is.
    expect(distancesFrom(floor.map, floor.start.pos)[sy][sx]).toBe(-1);
    expect(distancesFrom(floor.map, floor.start.pos, orSecret)[sy][sx]).toBeGreaterThan(0);
  });
});

describe('roles are drawn from the layout stream', () => {
  it('assigns the same roles every time for one seed', () => {
    const once = buildFloor(5, 24680, layoutStream);
    const twice = buildFloor(5, 24680, layoutStream);
    expect(twice.rooms.map((r) => [r.id, r.role])).toEqual(once.rooms.map((r) => [r.id, r.role]));
    expect(twice.criticalPath).toEqual(once.criticalPath);
    expect(twice.secretStash).toEqual(once.secretStash);
  });

  it('assigns different roles for different seeds', () => {
    const a = buildFloor(5, 111, layoutStream).rooms.map((r) => r.role).join();
    const b = buildFloor(5, 222, layoutStream).rooms.map((r) => r.role).join();
    expect(b).not.toBe(a);
  });
});
