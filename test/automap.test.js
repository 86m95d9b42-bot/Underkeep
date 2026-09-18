/**
 * What the hero remembers of a floor, and how it is framed (`05` section 10).
 *
 * The two rules that matter most are that memory is permanent and that a Dark
 * Zone is never mapped, so most of this is about what does *not* end up on the
 * map.
 */
import { describe, it, expect } from 'vitest';
import {
  remember,
  revealLayout,
  stateOf,
  mapTiles,
  mapMarks,
  viewBoxFor,
  viewBoxAttr,
  zoomBy,
  panBy,
  ZOOM,
  AROUND,
} from '../src/dungeon/automap.js';
import { createExploration, move } from '../src/dungeon/movement.js';
import { buildFloor, TILE, FACING } from '../src/dungeon/floor-builder.js';
import { layoutStream } from '../src/engine/rng.js';
import { createRun } from '../src/systems/run.js';

const SEED = 20260918;
const key = (x, y) => `${x},${y}`;

/** A 7 x 3 corridor with a room mouth, so sight has somewhere to reach. */
function corridor(extra = {}) {
  const W = 7;
  const map = Array.from({ length: 3 }, () => new Array(W).fill(TILE.WALL));
  for (let x = 1; x <= 5; x += 1) map[1][x] = TILE.FLOOR;
  return {
    floor: 1,
    width: W,
    height: 3,
    map,
    rooms: [],
    start: { pos: [1, 1], facing: FACING.E },
    stairs: { up: [1, 1], down: [5, 1] },
    waystone: [2, 1],
    criticalPath: [],
    doors: {},
    keys: {},
    traps: {},
    chests: {},
    hazards: {},
    secrets: {},
    curiosities: {},
    ...extra,
  };
}

describe('remembering a floor', () => {
  it('records the tile underfoot and the eight around it', () => {
    const floor = corridor();
    const ex = createExploration(floor);
    ex.explored.clear();
    ex.seen.clear();

    remember(floor, ex);
    expect(ex.explored.has(key(1, 1))).toBe(true);
    // Every neighbour inside the map, walls included, is now known of.
    for (const [dx, dy] of AROUND) {
      expect(ex.seen.has(key(1 + dx, 1 + dy)), `${dx},${dy}`).toBe(true);
    }
  });

  it('tells a walked tile from a glimpsed one', () => {
    const floor = corridor();
    const ex = createExploration(floor);
    remember(floor, ex);
    expect(stateOf(ex, [1, 1])).toBe('explored');
    expect(stateOf(ex, [2, 1])).toBe('glimpsed');
    expect(stateOf(ex, [4, 1])).toBe('unknown');

    move(floor, ex, 'forward');
    remember(floor, ex);
    expect(stateOf(ex, [2, 1])).toBe('explored');
    expect(stateOf(ex, [3, 1])).toBe('glimpsed');
  });

  it('never fills in a Dark Zone, not even the tile stood on', () => {
    // 05 section 10: "Dark Zones never fill in on the map."
    const floor = corridor({
      hazards: {
        '3,1': { kind: 'dark_zone', pos: [3, 1] },
        '4,1': { kind: 'dark_zone', pos: [4, 1] },
      },
    });
    const ex = createExploration(floor);
    ex.explored.clear();
    ex.seen.clear();

    ex.pos = [3, 1];
    expect(remember(floor, ex)).toEqual({ explored: 0, seen: 0 });
    expect(ex.explored.size).toBe(0);
    expect(ex.seen.size).toBe(0);

    // And standing beside one does not map it either.
    ex.pos = [2, 1];
    remember(floor, ex);
    expect(ex.seen.has(key(3, 1))).toBe(false);
    expect(ex.seen.has(key(1, 1))).toBe(true);
  });

  it('keeps what it learns, permanently', () => {
    const floor = corridor();
    const ex = createExploration(floor);
    remember(floor, ex);
    const known = new Set(ex.seen);
    move(floor, ex, 'forward');
    remember(floor, ex);
    for (const at of known) expect(ex.seen.has(at), at).toBe(true);
  });

  it('is filled in by a Scroll of Mapping, walls and doors only', () => {
    const floor = corridor({ hazards: { '4,1': { kind: 'dark_zone', pos: [4, 1] } } });
    const ex = createExploration(floor);
    revealLayout(floor, ex);
    expect(ex.seen.has(key(5, 1))).toBe(true);
    // Not the dark patch, and nothing becomes "walked".
    expect(ex.seen.has(key(4, 1))).toBe(false);
    expect(ex.explored.has(key(5, 1))).toBe(false);
  });
});

describe('what is drawn', () => {
  it('draws only remembered walkable tiles, and marks the doors', () => {
    const floor = corridor();
    floor.map[1][3] = TILE.DOOR;
    floor.doors = { '3,1': { kind: 'open', pos: [3, 1] } };
    const ex = createExploration(floor);
    remember(floor, ex);
    ex.pos = [2, 1];
    remember(floor, ex);

    const tiles = mapTiles(floor, ex);
    const at = (x, y) => tiles.find((tile) => tile.at[0] === x && tile.at[1] === y);
    expect(at(1, 1).state).toBe('explored');
    expect(at(3, 1).door).toBe(true);
    // Walls are never tiles on the map, and neither is anything unknown.
    expect(at(1, 0)).toBe(undefined);
    expect(at(5, 1)).toBe(undefined);
  });

  it('keeps a secret door off the map until it is found', () => {
    const floor = corridor();
    floor.map[1][2] = TILE.ILLUSION;
    floor.secrets = { '2,1': { kind: 'shortcut', found: false } };
    const ex = createExploration(floor);
    remember(floor, ex);

    expect(mapTiles(floor, ex).some((tile) => tile.at[0] === 2)).toBe(false);
    ex.secretsFound.add('2,1');
    expect(mapTiles(floor, ex).some((tile) => tile.at[0] === 2)).toBe(true);
  });

  it('marks the stairs, the waystone and the hero', () => {
    const floor = corridor();
    floor.map[1][1] = TILE.STAIRS_UP;
    const ex = createExploration(floor);
    remember(floor, ex);

    const kinds = mapMarks(floor, ex).map((mark) => mark.kind);
    expect(kinds).toContain('stairsUp');
    expect(kinds).toContain('waystone');
    // The hero is drawn last, over everything else, and carries the facing.
    expect(kinds.at(-1)).toBe('you');
    expect(mapMarks(floor, ex).at(-1).facing).toBe(ex.facing);
  });

  it('shows an undetected trap to nobody', () => {
    const floor = corridor({
      traps: { '2,1': { pos: [2, 1], found: false, sprung: false, disarmed: false } },
    });
    const ex = createExploration(floor);
    remember(floor, ex);
    expect(mapMarks(floor, ex).some((mark) => mark.kind === 'trap')).toBe(false);

    floor.traps['2,1'].found = true;
    expect(mapMarks(floor, ex).some((mark) => mark.kind === 'trap')).toBe(true);
  });

  it('marks a locked door until it is opened, and an unopened chest', () => {
    const floor = corridor({
      doors: { '3,1': { kind: 'locked', pos: [3, 1] } },
      chests: { '2,1': { pos: [2, 1], opened: false } },
    });
    floor.map[1][3] = TILE.DOOR;
    const ex = createExploration(floor);
    ex.pos = [2, 1];
    remember(floor, ex);

    const kinds = () => mapMarks(floor, ex).map((mark) => mark.kind);
    expect(kinds()).toContain('lockedDoor');
    expect(kinds()).toContain('chest');

    ex.doorsOpened.add('3,1');
    floor.chests['2,1'].opened = true;
    expect(kinds()).not.toContain('lockedDoor');
    expect(kinds()).not.toContain('chest');
  });

  it('says nothing about a part of the floor the hero has not seen', () => {
    const floor = buildFloor(4, SEED, layoutStream);
    const ex = createExploration(floor);
    remember(floor, ex);
    for (const mark of mapMarks(floor, ex)) {
      if (mark.kind === 'you') continue;
      expect(ex.explored.has(key(...mark.at)) || ex.seen.has(key(...mark.at)), mark.kind).toBe(true);
    }
  });
});

describe('framing the map', () => {
  it('keeps the view over the floor', () => {
    const floor = { width: 33, height: 33 };
    const middle = viewBoxFor({ center: [16, 16], tiles: 11, aspect: 1, ...floor });
    expect(middle).toEqual({ x: 11, y: 11, w: 11, h: 11 });

    // Dragged past a corner, the view stops at the edge.
    const corner = viewBoxFor({ center: [0, 0], tiles: 11, aspect: 1, ...floor });
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
    const far = viewBoxFor({ center: [99, 99], tiles: 11, aspect: 1, ...floor });
    expect(far.x).toBe(22);
    expect(far.y).toBe(22);
  });

  it('centres a floor smaller than the view', () => {
    const box = viewBoxFor({ center: [4, 4], tiles: 21, aspect: 1, width: 9, height: 9 });
    expect(box).toEqual({ x: -6, y: -6, w: 21, h: 21 });
  });

  it('fits the tile count across the shorter side, whichever way up', () => {
    const tall = viewBoxFor({ center: [16, 16], tiles: 10, aspect: 0.75, width: 33, height: 33 });
    expect(tall.w).toBe(10);
    expect(tall.h).toBeCloseTo(13.333, 3);

    const wide = viewBoxFor({ center: [16, 16], tiles: 10, aspect: 2, width: 33, height: 33 });
    expect(wide.w).toBe(20);
    expect(wide.h).toBe(10);
  });

  it('zooms between its limits', () => {
    expect(zoomBy(ZOOM.default, ZOOM.step)).toBe(ZOOM.default + ZOOM.step);
    expect(zoomBy(ZOOM.min, -100)).toBe(ZOOM.min);
    expect(zoomBy(ZOOM.max, 100)).toBe(ZOOM.max);
  });

  it('drags the map with the finger, not against it', () => {
    const box = { w: 20, h: 20 };
    const screen = { width: 200, height: 200 };
    // Dragging right moves the view left: the centre goes down in x.
    expect(panBy([10, 10], { dx: 20, dy: 0 }, box, screen)).toEqual([8, 10]);
    expect(panBy([10, 10], { dx: 0, dy: -10 }, box, screen)).toEqual([10, 11]);
  });

  it('writes a viewBox an SVG understands', () => {
    expect(viewBoxAttr({ x: 1, y: 2, w: 3, h: 4 })).toBe('1 2 3 4');
  });
});

describe('the map as the hero walks', () => {
  it('fills in behind them, and nowhere else', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    const start = new Set(run.ex.seen);
    expect(run.ex.explored.has(key(...run.floor.start.pos))).toBe(true);

    for (let i = 0; i < 40; i += 1) {
      const { outcome } = run.press('forward');
      if (!outcome.moved) run.press('turnRight');
    }

    expect(run.ex.seen.size).toBeGreaterThan(start.size);
    // Everything remembered is either walked or next to somewhere walked.
    for (const at of run.ex.seen) {
      const [x, y] = at.split(',').map(Number);
      const touched = [[0, 0], ...AROUND].some(([dx, dy]) => run.ex.explored.has(key(x + dx, y + dy)));
      expect(touched, at).toBe(true);
    }
  });
});
