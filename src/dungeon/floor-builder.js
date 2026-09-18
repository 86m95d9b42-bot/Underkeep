/**
 * Floor builder: everything Underkeep adds on top of the vendored generator
 * (`07` section 3). This file covers steps 1 and 2 — the boss arena, the Safe
 * Room, the stairs, and the waystone. Room roles, doors, traps and the
 * solvability check come next and build on what this returns.
 *
 * Tiles hold terrain only; the waystone and everything else live in side
 * tables keyed "x,y" (docs/DECISIONS.md, 2026-09-18).
 *
 * No DOM. Every random draw comes from the floor's layout stream, so a floor
 * rebuilds identically from `masterSeed + floor` (`05` section 11).
 */
import DungeonGenerator from './dungeon-generator.js';
import { floorSpec } from '../data/floors.js';
import { assignDoorTypes, placeKeys, placeSecretDoors } from './doors.js';

export { DungeonGenerator };
export const TILE = DungeonGenerator.TILE;

/** How many times a floor is rebuilt before giving up (`05` section 3 step 10). */
export const MAX_ATTEMPTS = 8;

/**
 * Thrown when a floor cannot be finished and must be rebuilt with the next
 * seed. `buildFloor` catches it; it only escapes if every attempt fails.
 */
export class RegenerateFloor extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = 'RegenerateFloor';
  }
}

/** Tiles a hero can stand on. ILLUSION is a secret door, so it is not one. */
export function isWalkable(tile) {
  return (
    tile === TILE.FLOOR ||
    tile === TILE.DOOR ||
    tile === TILE.STAIRS_DOWN ||
    tile === TILE.STAIRS_UP ||
    tile === TILE.PIT
  );
}

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Facing, as the vendored `deadEndFacing` numbers them. */
export const FACING = { N: 0, E: 1, S: 2, W: 3 };

/**
 * Runs `fn` with `Math.random` replaced by a seeded stream.
 *
 * The vendored generator calls `Math.random()` internally, and Underkeep needs
 * floors to rebuild identically from a seed (`05` section 11). Rather than fork
 * the file, the call is borrowed for the length of one generation
 * (`07` section 2).
 *
 * `Math.random` is always put back, including when `fn` throws, and nesting is
 * safe because each call restores whatever it found rather than the real one.
 * This is the only place in the game that touches `Math.random` at all.
 *
 * @template T
 * @param {() => number} rng a seeded stream, which is itself a function
 * @param {() => T} fn
 * @returns {T}
 */
export function withRng(rng, fn) {
  if (typeof rng !== 'function') throw new TypeError('withRng needs a stream function');
  const real = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

/**
 * Runs the vendored generator for one floor, drawing every number from the
 * floor's layout stream. Step 1 of `07` section 3.
 *
 * @param {import('../data/floors.js').FloorSpec | number} floorOrSpec
 * @param {() => number} layoutRng
 */
export function generateLayout(floorOrSpec, layoutRng) {
  const spec = typeof floorOrSpec === 'number' ? floorSpec(floorOrSpec) : floorOrSpec;
  const { map, rooms } = withRng(layoutRng, () =>
    DungeonGenerator.generate(spec.width, spec.height, { roomDensity: spec.roomDensity }),
  );
  return { map, rooms, spec };
}

/* -------------------------------------------------------------------------- */
/* Measuring                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Walking distance from one tile to every other, in steps. Unreachable tiles
 * stay -1. Used for the critical path, room depth, and every "farthest from"
 * question the documents ask (`05` section 3 step 5).
 *
 * @param {number[][]} map
 * @param {[number, number]} from
 * @param {(tile: number, x: number, y: number) => boolean} [passable]
 * @returns {number[][]}
 */
export function distancesFrom(map, [fx, fy], passable = isWalkable) {
  const h = map.length;
  const w = map[0].length;
  const dist = Array.from({ length: h }, () => new Array(w).fill(-1));
  if (!passable(map[fy][fx], fx, fy)) return dist;

  dist[fy][fx] = 0;
  const queue = [[fx, fy]];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (dist[ny][nx] !== -1) continue;
      if (!passable(map[ny][nx], nx, ny)) continue;
      dist[ny][nx] = dist[y][x] + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

/** Every walkable tile reachable from `from`. */
export function reachableCount(map, from) {
  return distancesFrom(map, from)
    .flat()
    .filter((d) => d >= 0).length;
}

/** Every walkable tile on the map, wherever it is. */
function walkableTiles(map) {
  /** @type {[number, number][]} */
  const tiles = [];
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[0].length; x++) if (isWalkable(map[y][x])) tiles.push([x, y]);
  }
  return tiles;
}

/* -------------------------------------------------------------------------- */
/* Step 1 — the boss arena, its Safe Room, and the down stairs                */
/* -------------------------------------------------------------------------- */

/**
 * Where an arena of this size could go, cheapest first.
 *
 * No generated floor has a blank block big enough — the maze fills the grid —
 * so a site is scored by how many walkable tiles it would destroy, and the
 * damage is repaired afterwards. Ties break on distance from the middle, so the
 * arena drifts outward and leaves the middle to the maze; a floor with two
 * equally good sites still picks the same one every time.
 *
 * @param {number[][]} map
 * @param {number} outer the arena's footprint including its wall ring
 */
function arenaSites(map, outer) {
  const h = map.length;
  const w = map[0].length;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  /** @type {{ x: number, y: number, cost: number, fromMiddle: number }[]} */
  const sites = [];
  for (let y = 1; y + outer <= h - 1; y++) {
    for (let x = 1; x + outer <= w - 1; x++) {
      let cost = 0;
      for (let j = 0; j < outer; j++) {
        for (let i = 0; i < outer; i++) if (isWalkable(map[y + j][x + i])) cost += 1;
      }
      const mx = x + outer / 2 - cx;
      const my = y + outer / 2 - cy;
      sites.push({ x, y, cost, fromMiddle: -(mx * mx + my * my) });
    }
  }
  sites.sort((a, b) => a.cost - b.cost || a.fromMiddle - b.fromMiddle || a.y - b.y || a.x - b.x);
  return sites;
}

/**
 * Carves the arena at one site: a solid wall ring, a clear interior, one door,
 * and an alcove behind holding the down stairs.
 *
 * The door goes on the side facing the most map, so the arena opens back
 * towards the floor rather than into the edge; the alcove goes opposite it, so
 * the stairs can only be reached through the arena (`05` section 5).
 *
 * @param {number[][]} map mutated
 * @param {{ x: number, y: number }} site top-left of the footprint, wall ring included
 * @param {number} size the arena's inside, 9 or 11
 */
function carveArena(map, site, size) {
  const h = map.length;
  const w = map[0].length;
  const outer = size + 2;

  for (let j = 0; j < outer; j++) {
    for (let i = 0; i < outer; i++) {
      const edge = i === 0 || j === 0 || i === outer - 1 || j === outer - 1;
      map[site.y + j][site.x + i] = edge ? TILE.WALL : TILE.FLOOR;
    }
  }

  const inside = { x: site.x + 1, y: site.y + 1, w: size, h: size };
  const midX = site.x + Math.floor(outer / 2);
  const midY = site.y + Math.floor(outer / 2);

  // Room on each side of the arena, so the door faces the bulk of the floor.
  const room = {
    [FACING.N]: site.y,
    [FACING.S]: h - (site.y + outer),
    [FACING.W]: site.x,
    [FACING.E]: w - (site.x + outer),
  };
  const doorSide = Number(
    Object.keys(room).sort((a, b) => room[b] - room[a] || Number(a) - Number(b))[0],
  );

  /** @param {number} side @returns {{ door: [number, number], outside: [number, number] }} */
  const doorAt = (side) => {
    if (side === FACING.N) return { door: [midX, site.y], outside: [midX, site.y - 1] };
    if (side === FACING.S) {
      return { door: [midX, site.y + outer - 1], outside: [midX, site.y + outer] };
    }
    if (side === FACING.W) return { door: [site.x, midY], outside: [site.x - 1, midY] };
    return { door: [site.x + outer - 1, midY], outside: [site.x + outer, midY] };
  };

  const { door, outside } = doorAt(doorSide);
  map[door[1]][door[0]] = TILE.DOOR;
  // The tile just outside the door has to be walkable, or the arena is sealed.
  if (!isWalkable(map[outside[1]][outside[0]])) map[outside[1]][outside[0]] = TILE.FLOOR;

  // The alcove is dug into the arena's own wall ring on the far side. The tile
  // beyond it is sealed, so the stairs can be reached only through the arena
  // (05 section 5).
  const opposite = (doorSide + 2) % 4;
  const { door: alcove, outside: beyond } = doorAt(opposite);
  map[alcove[1]][alcove[0]] = TILE.STAIRS_DOWN;
  if (beyond[0] > 0 && beyond[1] > 0 && beyond[0] < w - 1 && beyond[1] < h - 1) {
    map[beyond[1]][beyond[0]] = TILE.WALL;
  }

  // The arena has exactly one entrance, so its wall ring is off limits to the
  // repair pass below, which would otherwise happily dig a second way in.
  const protect = new Set();
  for (let j = 0; j < outer; j++) {
    for (let i = 0; i < outer; i++) {
      if (!(i === 0 || j === 0 || i === outer - 1 || j === outer - 1)) continue;
      protect.add(`${site.x + i},${site.y + j}`);
    }
  }
  protect.delete(`${door[0]},${door[1]}`);
  protect.add(`${beyond[0]},${beyond[1]}`);

  return {
    protect,
    rect: /** @type {[number, number, number, number]} */ ([inside.x, inside.y, inside.w, inside.h]),
    size,
    door: /** @type {[number, number]} */ (door),
    entrance: /** @type {[number, number]} */ (outside),
    doorSide,
    stairsDown: /** @type {[number, number]} */ (alcove),
  };
}

/**
 * Reconnects anything the arena cut off, by carving the shortest run of wall
 * back to the main region. The vendored generator guarantees a connected floor
 * and the stamp can break that guarantee, so it is put back here.
 *
 * @param {number[][]} map mutated
 * @param {[number, number]} from a tile in the region everything must reach
 * @param {Set<string>} [protect] tiles that must stay as they are
 * @returns {number} how many tiles were carved
 */
function reconnect(map, from, protect = new Set()) {
  const h = map.length;
  const w = map[0].length;
  let carved = 0;

  for (let guard = 0; guard < 64; guard += 1) {
    const dist = distancesFrom(map, from);
    const stranded = walkableTiles(map).filter(([x, y]) => dist[y][x] === -1);
    if (stranded.length === 0) return carved;

    // Dig from the stranded tile back to the main region, through as little
    // wall as possible: a breadth-first search where walls cost one and
    // walkable tiles cost nothing, which is a 0-1 BFS.
    const [sx, sy] = stranded[0];
    const cost = Array.from({ length: h }, () => new Array(w).fill(Infinity));
    /** @type {([number, number] | null)[][]} */
    const cameFrom = Array.from({ length: h }, () => new Array(w).fill(null));
    cost[sy][sx] = 0;
    /** @type {[number, number][]} */
    let deque = [[sx, sy]];
    let target = null;

    while (deque.length > 0) {
      const [x, y] = deque.shift();
      if (dist[y][x] >= 0) {
        target = [x, y];
        break;
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        if (protect.has(`${nx},${ny}`)) continue;
        const step = isWalkable(map[ny][nx]) ? 0 : 1;
        if (cost[y][x] + step < cost[ny][nx]) {
          cost[ny][nx] = cost[y][x] + step;
          cameFrom[ny][nx] = [x, y];
          if (step === 0) deque.unshift([nx, ny]);
          else deque.push([nx, ny]);
        }
      }
      deque.sort((a, b) => cost[a[1]][a[0]] - cost[b[1]][b[0]]);
    }

    if (!target) throw new RegenerateFloor('a cut-off pocket could not be dug back to the floor');

    for (let step = target; step; step = cameFrom[step[1]][step[0]]) {
      if (!isWalkable(map[step[1]][step[0]])) {
        map[step[1]][step[0]] = TILE.FLOOR;
        carved += 1;
      }
    }
  }
  throw new RegenerateFloor('the floor could not be reconnected after the arena was stamped');
}

/**
 * Stamps the boss arena, its alcove and down stairs, then repairs the floor.
 * Step 1 of `07` section 3, and `05` section 5.
 *
 * Sites are tried cheapest first; a site is kept only if the floor still holds
 * together afterwards without losing too much of itself.
 *
 * @param {number[][]} map mutated
 * @param {import('../data/floors.js').FloorSpec} spec
 */
export function stampBossArena(map, spec) {
  const outer = spec.arenaSize + 2;
  const before = walkableTiles(map).length;
  const sites = arenaSites(map, outer);
  if (sites.length === 0) throw new RegenerateFloor(`no room for a ${spec.arenaSize} arena`);

  // Only the cheapest handful are worth trying: past that the arena is eating
  // the floor, and a fresh seed is the better answer.
  for (const site of sites.slice(0, 12)) {
    const trial = map.map((row) => [...row]);
    const arena = carveArena(trial, site, spec.arenaSize);
    let carved;
    try {
      carved = reconnect(trial, arena.entrance, arena.protect);
    } catch {
      continue;
    }

    const after = walkableTiles(trial).filter(([x, y]) => {
      const inside =
        x >= arena.rect[0] &&
        x < arena.rect[0] + arena.rect[2] &&
        y >= arena.rect[1] &&
        y < arena.rect[1] + arena.rect[3];
      return !inside;
    }).length;

    // The arena must not swallow the floor it sits in.
    if (after < before * 0.6) continue;

    for (let y = 0; y < map.length; y++) map[y] = trial[y];
    const { protect, ...shape } = arena;
    return { ...shape, carvedToReconnect: carved };
  }
  throw new RegenerateFloor('every arena site left the floor broken or too small');
}

/* -------------------------------------------------------------------------- */
/* Step 2 — arrival room, up stairs, waystone                                 */
/* -------------------------------------------------------------------------- */

/**
 * Places the up stairs as far from the arena as the floor allows, then the
 * waystone beside them. Step 2 of `07` section 3, and `05` section 3 step 5,
 * which measures "farthest" by walking distance.
 *
 * `findDeadEnds` and `findNearestFloor` are the vendored helpers `07` names;
 * the choice between the dead ends is made by walking distance, which is what
 * `05` asks for.
 *
 * @param {number[][]} map mutated
 * @param {import('../data/floors.js').FloorSpec} spec
 * @param {{ entrance: [number, number], rect: [number, number, number, number] }} arena
 */
export function placeArrival(map, spec, arena) {
  const w = spec.width;
  const h = spec.height;
  const fromArena = distancesFrom(map, arena.entrance);

  const inArena = ([x, y]) =>
    x >= arena.rect[0] - 1 &&
    x <= arena.rect[0] + arena.rect[2] &&
    y >= arena.rect[1] - 1 &&
    y <= arena.rect[1] + arena.rect[3];

  const deadEnds = DungeonGenerator.findDeadEnds(map, w, h)
    .map(({ x, y }) => /** @type {[number, number]} */ ([x, y]))
    .filter((pos) => !inArena(pos) && fromArena[pos[1]][pos[0]] > 0);

  /** @type {[number, number] | null} */
  let upStairs = null;
  if (deadEnds.length > 0) {
    upStairs = deadEnds.reduce((best, pos) =>
      fromArena[pos[1]][pos[0]] > fromArena[best[1]][best[0]] ? pos : best,
    );
  } else {
    // No dead end is usable, so fall back to the farthest plain floor tile,
    // found from the corner opposite the arena.
    const away = {
      x: arena.rect[0] < w / 2 ? w - 2 : 1,
      y: arena.rect[1] < h / 2 ? h - 2 : 1,
    };
    const fallback = DungeonGenerator.findNearestFloor(map, w, h, away.x, away.y);
    if (fallback) upStairs = [fallback.x, fallback.y];
  }

  if (!upStairs) throw new RegenerateFloor('nowhere to put the up stairs');
  if (fromArena[upStairs[1]][upStairs[0]] <= 0) {
    throw new RegenerateFloor('the arrival point cannot reach the arena');
  }

  const facing = DungeonGenerator.deadEndFacing(map, w, h, upStairs[0], upStairs[1]);

  // The waystone sits on a tile beside the stairs, not on them: it is a side
  // table entry, and the hero has to be able to step onto it to attune it.
  /** @type {[number, number] | null} */
  let waystone = null;
  for (const [dx, dy] of DIRS) {
    const nx = upStairs[0] + dx;
    const ny = upStairs[1] + dy;
    if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
    if (map[ny][nx] === TILE.FLOOR) {
      waystone = [nx, ny];
      break;
    }
  }
  if (!waystone) throw new RegenerateFloor('nowhere beside the up stairs for the waystone');

  map[upStairs[1]][upStairs[0]] = TILE.STAIRS_UP;

  return { upStairs, waystone, facing };
}

/**
 * The Safe Room: the room right before the arena (`05` section 5), which is the
 * generated room closest to the arena door by walking distance. It gets no
 * traps, no hazards, and no wandering monster checks.
 *
 * @param {{ x: number, y: number, w: number, h: number }[]} rooms
 * @param {number[][]} map
 * @param {{ entrance: [number, number] }} arena
 */
export function pickSafeRoom(rooms, map, arena) {
  const fromArena = distancesFrom(map, arena.entrance);

  let best = null;
  for (const [index, room] of rooms.entries()) {
    // A room the arena partly ate may have no walkable tiles left.
    let nearest = Infinity;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const d = fromArena[y]?.[x];
        if (d !== undefined && d >= 0 && d < nearest) nearest = d;
      }
    }
    if (nearest === Infinity) continue;
    if (!best || nearest < best.distance) best = { index, room, distance: nearest };
  }

  if (!best) throw new RegenerateFloor('no room is reachable from the arena to be the Safe Room');
  return best;
}

/* -------------------------------------------------------------------------- */
/* Putting one floor together                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} Floor
 * @property {number} floor
 * @property {number} masterSeed
 * @property {number} attempt      which rebuild produced this floor
 * @property {number} width
 * @property {number} height
 * @property {number[][]} map      terrain only
 * @property {{ id: string, rect: [number, number, number, number], role: string, depth: number, onCriticalPath: boolean, openTiles: number }[]} rooms
 * @property {object} arena
 * @property {string | null} safeRoom  the id of the room before the arena
 * @property {{ up: [number, number], down: [number, number] }} stairs
 * @property {[number, number]} waystone
 * @property {{ pos: [number, number], facing: number }} start
 * @property {[number, number][]} criticalPath  arrival to the arena door
 * @property {[number, number] | null} secretStash  the dead end to seal
 * @property {Record<string, number>} roleCounts  how many of each role were placed
 * @property {Record<string, any>} doors    side table, keyed "x,y"
 * @property {Record<string, any>} keys     side table, keyed "x,y"
 * @property {Record<string, any>} secrets  side table, keyed "x,y"
 * @property {import('../data/floors.js').FloorSpec} spec
 */

/**
 * Builds one floor, rebuilding with the next seed if it cannot be finished
 * (`05` section 3 step 10).
 *
 * @param {number} floor 1 to 10
 * @param {number} masterSeed
 * @param {(masterSeed: number, floor: number, attempt: number) => import('../engine/rng.js').Stream} makeStream
 *   normally `layoutStream` from the rng module; taken as an argument so this
 *   file needs no opinion about where randomness comes from
 * @returns {Floor}
 */
export function buildFloor(floor, masterSeed, makeStream) {
  const spec = floorSpec(floor);
  const problems = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const rng = makeStream(masterSeed, floor, attempt);
      const { map, rooms } = generateLayout(spec, rng);

      const arena = stampBossArena(map, spec);
      const { upStairs, waystone, facing } = placeArrival(map, spec, arena);
      const safe = pickSafeRoom(rooms, map, arena);

      // Step 3: measure. The critical path and the depth score are what every
      // later placement rule is written in terms of.
      const path = criticalPath(map, upStairs, arena.entrance);

      const named = rooms.map((room, index) => ({
        id: `r${index}`,
        rect: /** @type {[number, number, number, number]} */ ([room.x, room.y, room.w, room.h]),
        role: index === safe.index ? 'safeRoom' : null,
      }));
      // The arena is a room too, as the save template in 05 section 14 has it,
      // though the generator never placed it.
      named.push({ id: 'arena', rect: arena.rect, role: 'bossArena' });

      const measured = measureRooms(map, named, upStairs, path);
      const { rooms: roled, placed } = assignRoomRoles(measured, spec, rng);

      // Step 4's last role: a dead end to be sealed behind a secret door.
      const secretStash = pickSecretStash(map, spec, upStairs, path, [upStairs, waystone]);

      // Steps 5 and 6: door kinds, lock tiers, keys and secret doors. The
      // partly built floor is handed over, because every rule about doors is
      // written in terms of the route and the room roles above.
      const sofar = {
        floor,
        width: spec.width,
        height: spec.height,
        map,
        rooms: roled,
        arena,
        stairs: { up: upStairs, down: arena.stairsDown },
        start: { pos: upStairs, facing },
        criticalPath: path,
        secretStash,
        spec,
      };
      const { doors } = assignDoorTypes(sofar, rng);
      const keys = placeKeys(sofar, doors, rng);
      const { secrets } = placeSecretDoors(sofar, doors, rng);

      return {
        floor,
        masterSeed,
        attempt,
        width: spec.width,
        height: spec.height,
        map,
        rooms: roled,
        arena,
        safeRoom: named[safe.index].id,
        stairs: { up: upStairs, down: arena.stairsDown },
        waystone,
        start: { pos: upStairs, facing },
        criticalPath: path,
        secretStash,
        roleCounts: placed,
        doors,
        keys,
        secrets,
        spec,
      };
    } catch (err) {
      if (!(err instanceof RegenerateFloor)) throw err;
      problems.push(`attempt ${attempt}: ${err.message}`);
    }
  }

  throw new Error(
    `floor ${floor} could not be built in ${MAX_ATTEMPTS} attempts:\n  ${problems.join('\n  ')}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Steps 3 and 4 — measuring the floor, then giving each room a role          */
/* -------------------------------------------------------------------------- */

/**
 * The shortest walking route from the arrival tile to the arena door
 * (`05` section 3 step 5). Everything downstream leans on this: locks on the
 * critical path are capped at Good, sealed doors are never on it, and treasure
 * rooms sit off it.
 *
 * The route is walked downhill through distances measured from the arena, and
 * ties break on a fixed compass order, so one floor always has one path.
 *
 * @param {number[][]} map
 * @param {[number, number]} from the arrival tile
 * @param {[number, number]} to the tile outside the arena door
 * @returns {[number, number][]} from the arrival tile to `to`, both included
 */
export function criticalPath(map, from, to) {
  const toTarget = distancesFrom(map, to);
  if (toTarget[from[1]][from[0]] < 0) throw new RegenerateFloor('the arena cannot be walked to');

  /** @type {[number, number][]} */
  const path = [[...from]];
  let [x, y] = from;
  let left = toTarget[y][x];

  while (left > 0) {
    let next = null;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const d = toTarget[ny]?.[nx];
      if (d !== undefined && d >= 0 && d < left) {
        next = [nx, ny];
        left = d;
        break;
      }
    }
    /* c8 ignore next */
    if (!next) throw new RegenerateFloor('the route to the arena runs out halfway');
    path.push(next);
    [x, y] = next;
  }
  return path;
}

/**
 * Walking distance from the arrival tile to every room, and whether the
 * critical path runs through it. The depth score places rewards and danger
 * (`05` section 3 step 5, `07` step 3).
 *
 * A room's depth is the nearest of its tiles, because that is where the hero
 * arrives. A room the arena stamped over may have no reachable tiles left, and
 * gets a depth of -1.
 *
 * @param {number[][]} map
 * @param {{ rect: [number, number, number, number] }[]} rooms
 * @param {[number, number]} arrival
 * @param {[number, number][]} path
 */
export function measureRooms(map, rooms, arrival, path) {
  const fromArrival = distancesFrom(map, arrival);
  const onPath = new Set(path.map(([x, y]) => `${x},${y}`));

  return rooms.map((room) => {
    const [rx, ry, rw, rh] = room.rect;
    let depth = -1;
    let crosses = false;
    let open = 0;

    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        if (!isWalkable(map[y]?.[x])) continue;
        open += 1;
        if (onPath.has(`${x},${y}`)) crosses = true;
        const d = fromArrival[y][x];
        if (d >= 0 && (depth === -1 || d < depth)) depth = d;
      }
    }
    return { ...room, depth, onCriticalPath: crosses, openTiles: open };
  });
}

/**
 * Gives every room a role (`05` section 3 step 6).
 *
 * Rooms are assigned most-constrained first, because a treasure room has to be
 * deep and off the critical path while a lair will take any room at all:
 * treasure, then curiosity, then theme, then lairs, and whatever is left is
 * plain. Each floor wants more rooms than it always has — floor 10 asks for up
 * to 14 of its 12 to 15 — so each kind takes its minimum first and the extras
 * are shared out only while rooms remain.
 *
 * @param {ReturnType<typeof measureRooms>} rooms measured, and already carrying
 *   any role this floor's shape fixed (the arena and its Safe Room)
 * @param {import('../data/floors.js').FloorSpec} spec
 * @param {import('../engine/rng.js').Stream} rng the layout stream
 */
export function assignRoomRoles(rooms, spec, rng) {
  const roles = new Map(rooms.map((room) => [room.id, room.role ?? null]));

  /** Rooms still free, deepest first; unreachable rooms are never given a role. */
  const free = () =>
    rooms
      .filter((room) => roles.get(room.id) === null && room.depth >= 0 && room.openTiles > 0)
      .sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id));

  /**
   * @param {string} role
   * @param {number} count
   * @param {(room: any) => boolean} [allowed]
   * @param {boolean} [deepestFirst] false picks at random from the layout stream
   */
  const give = (role, count, allowed = () => true, deepestFirst = false) => {
    let given = 0;
    for (let i = 0; i < count; i += 1) {
      const options = free().filter(allowed);
      if (options.length === 0) break;
      const room = deepestFirst ? options[0] : rng.pick(options);
      roles.set(room.id, role);
      given += 1;
    }
    return given;
  };

  /** @param {[number, number]} range */
  const least = ([min]) => min;
  /** @param {[number, number]} range */
  const most = ([, max]) => max;

  const { treasure, curiosity, theme } = spec.roomRoles;
  const offPath = (room) => !room.onCriticalPath;

  // Treasure goes first and all at once. It is the only role the document ties
  // to depth ("the deepest rooms off the critical path"), so if anything else
  // were placed in between it could take a room deeper than the treasure.
  const placed = {
    treasure: give('treasure', rng.range(least(treasure), most(treasure)), offPath, true),
  };

  // Then a minimum of each of the others, so a floor short of rooms still has
  // one of everything, and the lairs that carry its encounters.
  placed.curiosity = give('curiosity', least(curiosity));
  placed.theme = give('theme', least(theme));
  placed.lair = give('lair', spec.counts.lairs);

  // Extras only while there are rooms to spare.
  placed.curiosity += give('curiosity', rng.range(0, most(curiosity) - least(curiosity)));
  placed.theme += give('theme', rng.range(0, most(theme) - least(theme)));

  for (const room of rooms) if (roles.get(room.id) === null) roles.set(room.id, 'plain');

  return {
    rooms: rooms.map((room) => ({ ...room, role: roles.get(room.id) })),
    placed,
  };
}

/**
 * The Secret Stash: a dead end sealed behind a secret door, holding a chest
 * (`05` section 3 step 6). The tile is chosen here; the secret door itself is
 * placed with the other doors, in the next step of `07` section 3.
 *
 * The farthest dead end from arrival that is not already spoken for, so the
 * stash is a genuine find rather than something passed on the way in.
 *
 * @param {number[][]} map
 * @param {import('../data/floors.js').FloorSpec} spec
 * @param {[number, number]} arrival
 * @param {[number, number][]} path
 * @param {[number, number][]} taken tiles already used (stairs, waystone)
 */
export function pickSecretStash(map, spec, arrival, path, taken) {
  const fromArrival = distancesFrom(map, arrival);
  const onPath = new Set(path.map(([x, y]) => `${x},${y}`));
  const used = new Set(taken.map(([x, y]) => `${x},${y}`));

  /**
   * A dead end can be sealed when the tile leading into it is a plain corridor
   * with exactly two open sides — the dead end and the way back. That tile
   * becomes the secret door and the dead end becomes the chamber, so nothing
   * has to be dug and nothing else is cut off.
   *
   * Digging a fresh chamber beyond the dead end was the first attempt. It
   * needed a walled-in tile on the far side, which three floors in four do not
   * have, and most floors lost their stash.
   */
  const sealable = ([x, y]) => {
    const open = DIRS.filter(([dx, dy]) => isWalkable(map[y + dy]?.[x + dx]));
    if (open.length !== 1) return false;
    const [ox, oy] = open[0];
    const nx = x + ox;
    const ny = y + oy;
    if (onPath.has(`${nx},${ny}`) || used.has(`${nx},${ny}`)) return false;
    // The corridor tile must lead nowhere else, or sealing it would cut off
    // more than the stash.
    const neighbours = DIRS.filter(([dx, dy]) => isWalkable(map[ny + dy]?.[nx + dx]));
    return neighbours.length === 2;
  };

  const candidates = DungeonGenerator.findDeadEnds(map, spec.width, spec.height)
    .map(({ x, y }) => /** @type {[number, number]} */ ([x, y]))
    .filter(([x, y]) => !onPath.has(`${x},${y}`) && !used.has(`${x},${y}`))
    .filter(([x, y]) => fromArrival[y][x] > 0)
    .filter(sealable);

  if (candidates.length === 0) return null;
  return candidates.reduce((best, pos) =>
    fromArrival[pos[1]][pos[0]] > fromArrival[best[1]][best[0]] ? pos : best,
  );
}
