/**
 * Grid movement (`07` section 4, `03` section 6, `05` section 4).
 *
 * Two kinds of test here: hand-built corridors that check one rule each, and
 * real floors from the builder, where the point is that movement and the
 * solvability checker agree — a floor the checker calls finishable has to be
 * one the hero can actually walk.
 */
import { describe, it, expect } from 'vitest';
import {
  COMMANDS,
  DELTA,
  turnBy,
  headingFor,
  targetTile,
  tileAhead,
  createExploration,
  blockedBy,
  resolveMove,
  commitMove,
  move,
  openDoor,
  findSecret,
  clearHazard,
  whatIsAt,
  lookAhead,
  contextFor,
} from '../src/dungeon/movement.js';
import { buildFloor, TILE, FACING } from '../src/dungeon/floor-builder.js';
import { canStep } from '../src/dungeon/solvability.js';
import { layoutStream } from '../src/engine/rng.js';
import { allFloorSpecs } from '../src/data/floors.js';

const SEED = 20260918;
const key = (x, y) => `${x},${y}`;

/**
 * A three-tile corridor running east, with a door in the middle:
 *
 *   # # # # #
 *   # . + . #
 *   # # # # #
 */
function corridor({ door = null, hazard = null, tile = TILE.DOOR, extra = {} } = {}) {
  const map = [
    [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
    [TILE.WALL, TILE.FLOOR, tile, TILE.FLOOR, TILE.WALL],
    [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
  ];
  return {
    floor: 1,
    width: 5,
    height: 3,
    map,
    rooms: [],
    start: { pos: [1, 1], facing: FACING.E },
    stairs: { up: [1, 1], down: [3, 1] },
    waystone: [1, 1],
    criticalPath: [],
    doors: door ? { '2,1': { pos: [2, 1], ...door } } : {},
    keys: {},
    traps: {},
    chests: {},
    hazards: hazard ? { '2,1': { pos: [2, 1], ...hazard } } : {},
    secrets: {},
    curiosities: {},
    ...extra,
  };
}

describe('direction maths', () => {
  it('numbers facings the way the generator does: 0 N, 1 E, 2 S, 3 W', () => {
    expect(DELTA[FACING.N]).toEqual([0, -1]);
    expect(DELTA[FACING.E]).toEqual([1, 0]);
    expect(DELTA[FACING.S]).toEqual([0, 1]);
    expect(DELTA[FACING.W]).toEqual([-1, 0]);
  });

  it('turns in quarters and wraps both ways', () => {
    expect(turnBy(FACING.N, 1)).toBe(FACING.E);
    expect(turnBy(FACING.N, -1)).toBe(FACING.W);
    expect(turnBy(FACING.W, 1)).toBe(FACING.N);
    expect(turnBy(FACING.N, -5)).toBe(FACING.W);
  });

  it('sends each pad key where the outline says it goes', () => {
    // Facing east: forward is +x, back is -x, strafe left is north.
    expect(headingFor(FACING.E, 'forward')).toBe(FACING.E);
    expect(headingFor(FACING.E, 'back')).toBe(FACING.W);
    expect(headingFor(FACING.E, 'strafeLeft')).toBe(FACING.N);
    expect(headingFor(FACING.E, 'strafeRight')).toBe(FACING.S);
    expect(headingFor(FACING.E, 'turnLeft')).toBe(null);

    expect(targetTile([4, 4], FACING.N, 'forward')).toEqual([4, 3]);
    expect(targetTile([4, 4], FACING.N, 'strafeRight')).toEqual([5, 4]);
    expect(targetTile([4, 4], FACING.N, 'turnRight')).toBe(null);
    expect(tileAhead([4, 4], FACING.S)).toEqual([4, 5]);
  });

  it("has a key for each of the pad's six moves", () => {
    expect(Object.keys(COMMANDS).sort()).toEqual(
      ['back', 'forward', 'strafeLeft', 'strafeRight', 'turnLeft', 'turnRight'].sort(),
    );
  });
});

describe('what stops a step', () => {
  it('lets the hero walk on plain floor', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    expect(blockedBy(floor, [1, 1], [2, 1], createExploration(floor))).toBe(null);
  });

  it('stops at a wall and at the edge of the map', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    expect(blockedBy(floor, [1, 1], [1, 0]).reason).toBe('wall');
    expect(blockedBy(floor, [1, 1], [-1, 1]).reason).toBe('wall');
  });

  it('walks through an archway, and through a door once it is opened', () => {
    const open = corridor({ door: { kind: 'open' } });
    expect(blockedBy(open, [1, 1], [2, 1], createExploration(open))).toBe(null);

    for (const kind of ['stuck', 'locked', 'keyed', 'sealed']) {
      const floor = corridor({ door: { kind } });
      const ex = createExploration(floor);
      expect(blockedBy(floor, [1, 1], [2, 1], ex).reason, kind).toBe(kind);
      openDoor(ex, [2, 1]);
      expect(blockedBy(floor, [1, 1], [2, 1], ex), kind).toBe(null);
    }
  });

  it('opens a barred door from its far side only', () => {
    // 03 section 6: "Can only be opened from the other side."
    const floor = corridor({ door: { kind: 'barred', passFrom: [3, 1] } });
    const ex = createExploration(floor);
    expect(blockedBy(floor, [1, 1], [2, 1], ex).reason).toBe('barred');
    expect(blockedBy(floor, [3, 1], [2, 1], ex)).toBe(null);
  });

  it('shows a one-way door as plain wall from behind', () => {
    // 03 section 6: "It looks like a wall from the other side."
    const floor = corridor({ door: { kind: 'oneWay', passFrom: [1, 1] } });
    const ex = createExploration(floor);
    expect(blockedBy(floor, [1, 1], [2, 1], ex)).toBe(null);
    const back = blockedBy(floor, [3, 1], [2, 1], ex);
    expect(back.reason).toBe('oneWay');
    expect(back.looksLike).toBe('wall');
  });

  it('shows a secret door as wall until it is found', () => {
    const floor = corridor({ tile: TILE.ILLUSION });
    floor.secrets = { '2,1': { kind: 'shortcut', found: false } };
    const ex = createExploration(floor);

    const stopped = blockedBy(floor, [1, 1], [2, 1], ex);
    expect(stopped.reason).toBe('secret');
    expect(stopped.looksLike).toBe('wall');

    findSecret(ex, [2, 1]);
    expect(blockedBy(floor, [1, 1], [2, 1], ex)).toBe(null);
  });

  it('is stopped by a web curtain until it is burned', () => {
    // 03 section 8: a web curtain blocks the corridor until burned or bashed.
    const floor = corridor({ tile: TILE.FLOOR, hazard: { kind: 'web_curtain', burned: false } });
    const ex = createExploration(floor);
    expect(blockedBy(floor, [1, 1], [2, 1], ex).reason).toBe('web');
    clearHazard(ex, [2, 1]);
    expect(blockedBy(floor, [1, 1], [2, 1], ex)).toBe(null);
  });

  it('lets the hero walk over a visible pit and every other hazard', () => {
    // A pit is crossable — falling in is a Reflex save, not a wall (03 section 4)
    // — and the checker treats it the same way.
    const pit = corridor({ tile: TILE.PIT });
    expect(blockedBy(pit, [1, 1], [2, 1], createExploration(pit))).toBe(null);

    const pad = corridor({ tile: TILE.FLOOR, hazard: { kind: 'teleporter_pad', destination: [1, 1] } });
    expect(blockedBy(pad, [1, 1], [2, 1], createExploration(pad))).toBe(null);
  });
});

describe('resolving a move', () => {
  it('turns without moving, and does not spend a step', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    const ex = createExploration(floor);

    const outcome = move(floor, ex, 'turnRight');
    expect(outcome.turned).toBe(true);
    expect(outcome.moved).toBe(false);
    expect(ex.facing).toBe(FACING.S);
    expect(ex.pos).toEqual([1, 1]);
    expect(ex.steps).toBe(0);
    expect(outcome.events[0]).toMatchObject({ type: 'turn', facing: FACING.S });
  });

  it('steps one tile, keeps facing, and counts the step', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    const ex = createExploration(floor);

    const outcome = move(floor, ex, 'forward');
    expect(outcome.moved).toBe(true);
    expect(ex.pos).toEqual([2, 1]);
    expect(ex.facing).toBe(FACING.E);
    expect(ex.steps).toBe(1);
    expect(ex.explored.has('2,1')).toBe(true);
    expect(outcome.events.map((e) => e.type)).toContain('newTile');
  });

  it('strafes and backs up without turning', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    const ex = createExploration(floor);
    move(floor, ex, 'forward');
    move(floor, ex, 'back');
    expect(ex.pos).toEqual([1, 1]);
    expect(ex.facing).toBe(FACING.E);
    expect(ex.steps).toBe(2);
  });

  it('changes nothing when the way is blocked', () => {
    const floor = corridor({ door: { kind: 'locked' } });
    const ex = createExploration(floor);
    const before = { ...ex, pos: [...ex.pos] };

    const outcome = move(floor, ex, 'forward');
    expect(outcome.moved).toBe(false);
    expect(outcome.blocked.reason).toBe('locked');
    expect(ex.pos).toEqual(before.pos);
    expect(ex.steps).toBe(0);
    expect(outcome.events[0].type).toBe('blocked');
  });

  it('resolves without touching state until it is committed', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    const ex = createExploration(floor);

    const outcome = resolveMove(floor, ex, 'forward');
    expect(ex.pos).toEqual([1, 1]);
    expect(ex.steps).toBe(0);

    commitMove(ex, outcome);
    expect(ex.pos).toEqual([2, 1]);
    expect(ex.steps).toBe(1);
  });

  it('raises an event for what the hero steps onto', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    floor.map[1][3] = TILE.STAIRS_DOWN;
    floor.waystone = [3, 1];
    floor.traps = { '3,1': { pos: [3, 1], found: false, sprung: false, disarmed: false } };
    const ex = createExploration(floor);

    move(floor, ex, 'forward');
    const outcome = move(floor, ex, 'forward');
    const types = outcome.events.map((e) => e.type);
    expect(types).toContain('stairs');
    expect(types).toContain('waystone');
    expect(types).toContain('trap');
    expect(outcome.events.find((e) => e.type === 'stairs').direction).toBe('down');
  });

  it('refuses a command it does not know', () => {
    const floor = corridor({ tile: TILE.FLOOR });
    expect(() => resolveMove(floor, createExploration(floor), 'jump')).toThrow(/jump/);
  });
});

describe('what the hero faces', () => {
  it('reads the tile ahead from the side tables', () => {
    const floor = corridor({ door: { kind: 'locked' } });
    const ex = createExploration(floor);
    const ahead = lookAhead(floor, ex);
    expect(ahead.at).toEqual([2, 1]);
    expect(ahead.door.kind).toBe('locked');
    expect(whatIsAt(floor, [1, 1], ex).waystone).toBe(true);
  });

  it('chooses the context key the outline lists', () => {
    const open = corridor({ tile: TILE.FLOOR });
    open.waystone = [9, 9];
    expect(contextFor(open, createExploration(open))).toBe('search');

    const door = corridor({ door: { kind: 'stuck' } });
    door.waystone = [9, 9];
    expect(contextFor(door, createExploration(door))).toBe('open');

    const chest = corridor({ tile: TILE.FLOOR });
    chest.waystone = [9, 9];
    chest.chests = { '2,1': { pos: [2, 1], opened: false } };
    expect(contextFor(chest, createExploration(chest))).toBe('open');

    const stone = corridor({ tile: TILE.FLOOR });
    stone.waystone = [2, 1];
    expect(contextFor(stone, createExploration(stone))).toBe('touch');

    const fountain = corridor({ tile: TILE.FLOOR });
    fountain.waystone = [9, 9];
    fountain.curiosities = { '2,1': { kind: 'fountain', pos: [2, 1], used: false } };
    expect(contextFor(fountain, createExploration(fountain))).toBe('drink');

    const web = corridor({ tile: TILE.FLOOR, hazard: { kind: 'web_curtain', burned: false } });
    web.waystone = [9, 9];
    expect(contextFor(web, createExploration(web))).toBe('burn');
  });
});

/* -------------------------------------------------------------------------- */
/* Real floors                                                                */
/* -------------------------------------------------------------------------- */

const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

/**
 * The exploration state of a hero with the minimum hero's abilities: every
 * door that can be bashed or unlocked is open, every web is burned. That is
 * exactly what the solvability checker assumes (`05` section 4), so movement
 * and the checker should now agree tile for tile.
 */
function minimumHeroState(floor) {
  const ex = createExploration(floor);
  for (const [at, door] of Object.entries(floor.doors)) {
    if (door.kind === 'stuck' || door.kind === 'locked' || door.kind === 'keyed') openDoor(ex, at);
  }
  for (const [at, hazard] of Object.entries(floor.hazards)) {
    if (hazard.kind === 'web_curtain') clearHazard(ex, at);
  }
  return ex;
}

describe('movement on a generated floor', () => {
  it.each(floors)('floor %i blocks exactly what the checker blocks', (_number, floor) => {
    const ex = minimumHeroState(floor);
    const keysHeld = new Set(Object.values(floor.keys).map((k) => k.id));
    let compared = 0;

    for (let y = 1; y < floor.height - 1; y += 1) {
      for (let x = 1; x < floor.width - 1; x += 1) {
        if (floor.map[y][x] === TILE.WALL) continue;
        for (const [dx, dy] of DELTA) {
          const to = [x + dx, y + dy];
          // The checker refuses to route through a teleporter pad because it
          // cannot predict where it lands; the hero may walk onto one.
          if (floor.hazards[key(...to)]?.kind === 'teleporter_pad') continue;

          const walkable = blockedBy(floor, [x, y], to, ex) === null;
          expect(walkable, `${x},${y} -> ${to}`).toBe(canStep(floor, [x, y], to, keysHeld));
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it.each(floors)('floor %i can be walked from arrival to the arena door', (_number, floor) => {
    const ex = minimumHeroState(floor);
    const route = routeTo(floor, ex, floor.arena.door);
    expect(route, 'no route to the arena door').not.toBe(null);

    walk(floor, ex, route);
    expect(ex.pos).toEqual(floor.arena.door);
    expect(ex.steps).toBe(route.length);
    // Every tile walked is remembered, which is what the automap draws.
    expect(ex.explored.size).toBe(new Set(route.map((p) => key(...p))).add(key(...floor.start.pos)).size);
  });

  it('remembers where it has been, and rebuilds the same way twice', () => {
    const [, floor] = floors[3];
    const one = minimumHeroState(floor);
    const two = minimumHeroState(floor);
    const route = routeTo(floor, one, floor.arena.door);

    walk(floor, one, route);
    walk(floor, two, route);
    expect(two.pos).toEqual(one.pos);
    expect(two.steps).toBe(one.steps);
    expect([...two.explored].sort()).toEqual([...one.explored].sort());
  });
});

/** A shortest route the hero can actually walk, by movement's own rules. */
function routeTo(floor, ex, target) {
  const start = floor.start.pos;
  /** @type {Map<string, [number, number] | null>} */
  const cameFrom = new Map([[key(...start), null]]);
  let edge = [start];

  while (edge.length) {
    /** @type {[number, number][]} */
    const next = [];
    for (const from of edge) {
      if (from[0] === target[0] && from[1] === target[1]) {
        const route = [];
        for (let at = from; cameFrom.get(key(...at)); at = cameFrom.get(key(...at))) route.unshift(at);
        return route;
      }
      for (const [dx, dy] of DELTA) {
        const to = /** @type {[number, number]} */ ([from[0] + dx, from[1] + dy]);
        if (cameFrom.has(key(...to))) continue;
        if (blockedBy(floor, from, to, ex)) continue;
        cameFrom.set(key(...to), from);
        next.push(to);
      }
    }
    edge = next;
  }
  return null;
}

/** Walks a route with the movement pad: turn to face each tile, then step. */
function walk(floor, ex, route) {
  for (const to of route) {
    const heading = DELTA.findIndex(([dx, dy]) => ex.pos[0] + dx === to[0] && ex.pos[1] + dy === to[1]);
    expect(heading, 'route jumped a tile').toBeGreaterThanOrEqual(0);

    // Turn the short way round, then walk forward: what a player's thumb does.
    while (ex.facing !== heading) {
      move(floor, ex, turnBy(ex.facing, 1) === heading ? 'turnRight' : 'turnLeft');
    }
    const outcome = move(floor, ex, 'forward');
    expect(outcome.moved, `blocked at ${to}`).toBe(true);
  }
}
