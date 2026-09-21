/**
 * The automap: what the hero remembers of a floor, and how it is framed on
 * screen (`05` section 10; `00-build-outline.md`, Automap).
 *
 * Two rules from `05` shape everything here: explored tiles are remembered
 * permanently, and **Dark Zones never fill in**. So the map is memory, not the
 * floor — nothing is drawn that the hero has not been in a position to see.
 *
 * No DOM: this decides what to draw and where to look; `ui/screens/map.js`
 * turns that into SVG.
 */
import { TILE } from './floor-builder.js';
import { inDarkness } from './step-clock.js';

const key = (x, y) => `${x},${y}`;

/** The eight tiles around one: what the hero can see from where they stand. */
export const AROUND = /** @type {[number, number][]} */ ([
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
]);

/**
 * Records what the hero learns by standing where they are: the tile itself,
 * and the eight around it.
 *
 * A glimpsed tile is one the hero has seen but not walked — a corridor branch,
 * the far side of a doorway — and the map draws those dashed. Sight stops at a
 * Dark Zone, which is never mapped at all (`05` section 10).
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('./movement.js').Exploration} ex
 * @returns {{ explored: number, seen: number }} how much was new
 */
export function remember(floor, ex) {
  ex.seen ??= new Set();
  const counts = { explored: 0, seen: 0 };
  const [x, y] = ex.pos;

  // Magical darkness: the hero learns nothing here, not even where they stood.
  if (inDarkness(floor, ex.pos)) return counts;

  if (!ex.explored.has(key(x, y))) {
    ex.explored.add(key(x, y));
    counts.explored += 1;
  }
  if (!ex.seen.has(key(x, y))) {
    ex.seen.add(key(x, y));
    counts.seen += 1;
  }

  for (const [dx, dy] of AROUND) {
    const nx = x + dx;
    const ny = y + dy;
    if (floor.map[ny]?.[nx] === undefined) continue;
    if (inDarkness(floor, [nx, ny])) continue;
    if (ex.seen.has(key(nx, ny))) continue;
    ex.seen.add(key(nx, ny));
    counts.seen += 1;
  }
  return counts;
}

/** Everything a Scroll of Mapping reveals: walls and doors, nothing else (`05` section 10). */
export function revealLayout(floor, ex) {
  ex.seen ??= new Set();
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      if (floor.map[y][x] === TILE.WALL) continue;
      if (inDarkness(floor, [x, y])) continue;
      ex.seen.add(key(x, y));
    }
  }
  return ex;
}

/* -------------------------------------------------------------------------- */
/* What is on the map                                                         */
/* -------------------------------------------------------------------------- */

/** How a remembered tile is drawn. */
export const TILE_STATE = /** @type {const} */ ({
  explored: 'explored', // walked: filled
  glimpsed: 'glimpsed', // seen but not walked: dashed
  unknown: 'unknown', // never drawn
});

/**
 * @param {import('./movement.js').Exploration} ex
 * @param {[number, number]} at
 */
export function stateOf(ex, [x, y]) {
  if (ex.explored.has(key(x, y))) return TILE_STATE.explored;
  if (ex.seen?.has(key(x, y))) return TILE_STATE.glimpsed;
  return TILE_STATE.unknown;
}

/**
 * The tiles to draw: every remembered walkable tile, with how it is known and
 * whether it is a door.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('./movement.js').Exploration} ex
 */
export function mapTiles(floor, ex) {
  /** @type {{ at: [number, number], state: string, door: boolean }[]} */
  const tiles = [];
  const known = new Set([...ex.explored, ...(ex.seen ?? [])]);
  for (const at of known) {
    const [x, y] = at.split(',').map(Number);
    const tile = floor.map[y]?.[x];
    if (tile === undefined || tile === TILE.WALL) continue;
    // An unfound secret door is wall to the hero, so it is wall on the map.
    if (tile === TILE.ILLUSION && !floor.secrets?.[at]?.found && !ex.secretsFound?.has(at)) continue;
    tiles.push({ at: [x, y], state: stateOf(ex, [x, y]), door: tile === TILE.DOOR });
  }
  return tiles;
}

/** The marks the map draws, in the order the legend lists them (`05` section 10). */
export const MARKS = /** @type {const} */ ([
  'you',
  'stairsUp',
  'stairsDown',
  'waystone',
  'safeRoom',
  'lockedDoor',
  'chest',
  'trap',
  'hazard',
  'grave',
  'returnMark',
]);

/** Door kinds that are drawn as shut and locked until the hero opens them. */
const LOCKED_KINDS = new Set(['stuck', 'locked', 'keyed', 'sealed', 'barred']);

/**
 * Every symbol on the map. Only what the hero has seen is listed, and only
 * what they have found: an undetected trap is not on the map, and neither is
 * a secret door (`05` section 10, `03` sections 3 and 6).
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('./movement.js').Exploration} ex
 * @returns {{ kind: string, at: [number, number], facing?: number, label?: string }[]}
 */
export function mapMarks(floor, ex) {
  const marks = [];
  const known = (at) => ex.explored.has(at) || Boolean(ex.seen?.has(at));
  /** @param {string} kind @param {[number, number]} at @param {object} [extra] */
  const add = (kind, at, extra = {}) => {
    if (!at || !known(key(...at))) return;
    marks.push({ kind, at: [at[0], at[1]], ...extra });
  };

  add('stairsUp', floor.stairs?.up);
  add('stairsDown', floor.stairs?.down);
  add('waystone', floor.waystone);

  // The Safe Room is marked once any of it has been seen, on the seen tile
  // nearest its middle: nothing is ever drawn where the hero has not looked.
  const safeRoom = floor.rooms?.find((room) => room.id === floor.safeRoom);
  if (safeRoom) {
    const [rx, ry, rw, rh] = safeRoom.rect;
    const middle = [rx + (rw >> 1), ry + (rh >> 1)];
    let best = null;
    let bestAway = Infinity;
    for (const at of ex.seen ?? []) {
      const [x, y] = at.split(',').map(Number);
      if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) continue;
      const away = Math.abs(x - middle[0]) + Math.abs(y - middle[1]);
      if (away < bestAway) {
        bestAway = away;
        best = /** @type {[number, number]} */ ([x, y]);
      }
    }
    if (best) marks.push({ kind: 'safeRoom', at: best });
  }

  for (const [at, door] of Object.entries(floor.doors ?? {})) {
    if (!LOCKED_KINDS.has(door.kind)) continue;
    if (ex.doorsOpened?.has(at)) continue;
    add('lockedDoor', door.pos ?? at.split(',').map(Number), { label: door.kind });
  }

  for (const [at, chest] of Object.entries(floor.chests ?? {})) {
    if (chest.opened) continue;
    add('chest', chest.pos ?? at.split(',').map(Number));
  }

  // Found only: the map never gives away what the hero has not detected.
  for (const trap of Object.values(floor.traps ?? {})) {
    if (!trap.found || trap.sprung) continue;
    add('trap', trap.pos, { label: trap.kind ?? undefined });
  }
  for (const hazard of Object.values(floor.hazards ?? {})) {
    if (!hazard.found) continue;
    add('hazard', hazard.pos, { label: hazard.kind });
  }
  // Scenery is plain to see, so it is drawn wherever the hero has been:
  // a lava channel on the map is what stops them walking into it again
  // (`05` section 6).
  for (const feature of Object.values(floor.features ?? {})) {
    if (!feature.blocks) continue;
    add('hazard', feature.pos, { label: feature.kind });
  }

  if (floor.grave) add('grave', floor.grave.pos);
  if (floor.returnMark) add('returnMark', floor.returnMark.pos);

  // The hero last, so the arrow draws over everything else.
  marks.push({ kind: 'you', at: [ex.pos[0], ex.pos[1]], facing: ex.facing });
  return marks;
}

/* -------------------------------------------------------------------------- */
/* Framing                                                                    */
/* -------------------------------------------------------------------------- */

/** How many tiles fit across the map's shorter side, and the limits on that. */
export const ZOOM = { min: 9, max: 41, step: 4, default: 21 };

/** @param {number} tiles @param {number} by */
export function zoomBy(tiles, by) {
  return Math.max(ZOOM.min, Math.min(ZOOM.max, tiles + by));
}

/**
 * The box to look at, in tile units, given where the view is centred and how
 * many tiles should fit across its shorter side.
 *
 * The view is kept over the floor: a map smaller than the view is centred, and
 * a larger one cannot be dragged past its edge.
 *
 * @param {object} options
 * @param {[number, number]} options.center in tiles
 * @param {number} options.tiles across the shorter side
 * @param {number} options.aspect view width / height
 * @param {number} options.width the floor's width in tiles
 * @param {number} options.height the floor's height in tiles
 */
export function viewBoxFor({ center, tiles, aspect, width, height }) {
  const w = aspect >= 1 ? tiles * aspect : tiles;
  const h = aspect >= 1 ? tiles : tiles / aspect;

  const axis = (c, size, span) => {
    if (size >= span) return (span - size) / 2; // the floor fits: centre it
    return Math.max(0, Math.min(span - size, c - size / 2));
  };

  return {
    x: axis(center[0] + 0.5, w, width),
    y: axis(center[1] + 0.5, h, height),
    w,
    h,
  };
}

/** The viewBox attribute for an SVG. */
export function viewBoxAttr(box) {
  return `${box.x} ${box.y} ${box.w} ${box.h}`;
}

/**
 * Where a drag of so many screen pixels takes the centre, in tiles.
 * @param {[number, number]} center
 * @param {{ dx: number, dy: number }} drag screen pixels
 * @param {{ w: number, h: number }} box the current view box, in tiles
 * @param {{ width: number, height: number }} screen the view's pixel size
 */
export function panBy(center, { dx, dy }, box, screen) {
  const perPixelX = box.w / Math.max(1, screen.width);
  const perPixelY = box.h / Math.max(1, screen.height);
  return /** @type {[number, number]} */ ([center[0] - dx * perPixelX, center[1] - dy * perPixelY]);
}
