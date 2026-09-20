/**
 * The rest of a floor's side tables: traps, chests, hazards, lairs and
 * curiosities (`07` section 1; `05` section 3 steps 8 and 9).
 *
 * Everything here is a side table keyed "x,y", never a tile: the map holds
 * terrain only (docs/DECISIONS.md, 2026-09-18).
 *
 * What each thing *does* belongs to later phases — trap kinds come from
 * `traps.json` and chest contents from the loot tables — so the entries this
 * file writes carry positions, tiers and flags, and leave `kind` null where a
 * table it cannot see yet will fill it in.
 */
import floorsData from '../data/floors.json' with { type: 'json' };
import { isArcane, rollTrap } from '../data/traps.js';
import { TILE, isWalkable, distancesFrom } from './floor-builder.js';
import { rollLockTier, capLock, tn, lockData } from './doors.js';

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const key = (x, y) => `${x},${y}`;

/** @param {{ base: number, perFloor: number }} rule @param {number} floor */
function resolveCount(rule, floor) {
  return rule.base + Math.floor(floor * rule.perFloor);
}

/**
 * Every tile the hero can stand on, with what is already there, so each pass
 * can avoid the last one's work.
 * @param {import('./floor-builder.js').Floor} floor
 */
function openTiles(floor) {
  /** @type {[number, number][]} */
  const tiles = [];
  for (let y = 1; y < floor.height - 1; y += 1) {
    for (let x = 1; x < floor.width - 1; x += 1) {
      if (floor.map[y][x] === TILE.FLOOR) tiles.push([x, y]);
    }
  }
  return tiles;
}

/** The tiles inside a room. */
function roomTiles(floor, room) {
  const [rx, ry, rw, rh] = room.rect;
  /** @type {[number, number][]} */
  const tiles = [];
  for (let y = ry; y < ry + rh; y += 1) {
    for (let x = rx; x < rx + rw; x += 1) if (isWalkable(floor.map[y]?.[x])) tiles.push([x, y]);
  }
  return tiles;
}

/** Which room a tile is in, if any. */
function roomAt(floor, x, y) {
  return floor.rooms.find((room) => {
    const [rx, ry, rw, rh] = room.rect;
    return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  });
}

/** True for a tile in a corridor: walkable, and in no room at all. */
function inCorridor(floor, [x, y]) {
  return !roomAt(floor, x, y);
}

/**
 * The tiles that must stay clear whatever else happens: the stairs, the
 * waystone, the Safe Room, the arena, and everything within 3 steps of where
 * the hero arrives (`05` section 3 step 9).
 * @param {import('./floor-builder.js').Floor} floor
 */
export function protectedTiles(floor) {
  const off = new Set([
    key(...floor.stairs.up),
    key(...floor.stairs.down),
    key(...floor.waystone),
    key(...floor.arena.door),
  ]);

  const rules = floorsData.floorTrapPlacement;
  const near = distancesFrom(floor.map, floor.start.pos);
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      const d = near[y][x];
      if (d >= 0 && d <= rules.minDistanceFromArrival) off.add(key(x, y));
    }
  }

  for (const room of floor.rooms) {
    if (room.role !== 'bossArena' && room.role !== 'safeRoom') continue;
    for (const [x, y] of roomTiles(floor, room)) off.add(key(x, y));
  }
  return off;
}

/* -------------------------------------------------------------------------- */
/* Traps                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Floor traps and door traps (`05` section 3 step 9).
 *
 * Positions and tiers only: which trap it actually is comes from `traps.json`
 * in Phase 7, so `kind` is left null and the entry says what is allowed.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 */
export function placeTraps(floor, rng) {
  /** @type {Record<string, any>} */
  const traps = {};
  const off = protectedTiles(floor);

  // Floor traps: 4 + F, on corridors and in rooms.
  const spots = openTiles(floor).filter(([x, y]) => !off.has(key(x, y)));
  const wanted = floor.spec.counts.floorTraps;
  for (const [x, y] of rng.shuffle(spots).slice(0, wanted)) {
    // Which trap, and how good it is, are `03` section 5's own rolls.
    const rolled = rollTrap(rng, 'floor', floor.floor);
    traps[key(x, y)] = {
      on: 'floor',
      pos: [x, y],
      kind: rolled?.kind ?? null,
      tier: rolled?.tier ?? null,
      found: false,
      typeKnown: false,
      searches: { normal: false, careful: false },
      disarmed: false,
      sprung: false,
    };
  }

  // Door traps: 1 in 6 doors, 1 in 4 from floor 6 down. A door on the route
  // may not carry an Arcane trap, because the hero has to get through it.
  const onPath = new Set(floor.criticalPath.map(([x, y]) => key(x, y)));
  const oneIn = floor.spec.doorTrapOneIn;
  for (const [at, door] of Object.entries(floor.doors)) {
    if (door.arenaEntrance) continue; // 05 section 5: never trapped
    if (!rng.chance(1 / oneIn)) continue;
    // A door the hero has to get through may not carry an Arcane trap: they
    // would need Dispel Ward to pass, and `05` section 4 promises a way.
    const arcaneAllowed = !onPath.has(at);
    let rolled = rollTrap(rng, 'door', floor.floor);
    for (let tries = 0; tries < 6 && !arcaneAllowed && isArcane(rolled?.kind, rolled?.tier); tries += 1) {
      rolled = rollTrap(rng, 'door', floor.floor);
    }
    if (!arcaneAllowed && isArcane(rolled?.kind, rolled?.tier)) continue;
    traps[at] = {
      on: 'door',
      pos: door.pos,
      kind: rolled?.kind ?? null,
      tier: rolled?.tier ?? null,
      arcaneAllowed,
      found: false,
      typeKnown: false,
      searches: { normal: false, careful: false },
      disarmed: false,
      sprung: false,
    };
  }

  return traps;
}

/* -------------------------------------------------------------------------- */
/* Chests                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Chests (`05` section 3 step 9): 3 + ⌊F ÷ 2⌋, preferring dead ends, treasure
 * rooms, lairs and the secret stash. A chest in the deepest 40% of rooms adds
 * +2 to its lock and trap tier rolls, and to its loot roll.
 *
 * Contents are Phase 5's business; what is decided here is where a chest is,
 * how hard its lock is, and whether it carries the depth bonus.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 * @param {Record<string, any>} traps so a chest is not dropped onto a floor trap
 */
export function placeChests(floor, rng, traps) {
  /** @type {Record<string, any>} */
  const chests = {};
  const off = protectedTiles(floor);
  const taken = new Set(Object.keys(traps));

  // The depth bonus applies to the deepest 40% of rooms.
  const ranked = floor.rooms
    .filter((room) => room.depth >= 0 && room.role !== 'bossArena')
    .sort((a, b) => b.depth - a.depth);
  const deepCut = Math.ceil(ranked.length * floorsData.chestDepthBonus.deepestShare);
  const deepRooms = new Set(ranked.slice(0, deepCut).map((room) => room.id));

  /** Somewhere a chest would like to be, best first. */
  const preferred = [];
  if (floor.secretStash) preferred.push({ pos: floor.secretStash, why: 'secretStash' });
  for (const role of ['treasure', 'lair']) {
    for (const room of floor.rooms.filter((r) => r.role === role)) {
      for (const pos of roomTiles(floor, room)) preferred.push({ pos, why: role, room: room.id });
    }
  }
  const deadEnds = openTiles(floor).filter(
    ([x, y]) => DIRS.filter(([dx, dy]) => isWalkable(floor.map[y + dy]?.[x + dx])).length === 1,
  );
  for (const pos of deadEnds) preferred.push({ pos, why: 'deadEnd' });
  for (const pos of openTiles(floor)) preferred.push({ pos, why: 'floor' });

  const wanted = floor.spec.counts.chests;
  const usedRooms = new Set();
  let placed = 0;

  for (const option of preferred) {
    if (placed >= wanted) break;
    const [x, y] = option.pos;
    const at = key(x, y);
    if (taken.has(at) || off.has(at) || chests[at]) continue;
    // One chest to a room, so a lair does not end up with three.
    const room = roomAt(floor, x, y);
    if (room && usedRooms.has(room.id)) continue;

    const deep = room ? deepRooms.has(room.id) : false;
    const bonus = deep ? floorsData.chestDepthBonus.bonus : 0;
    const lock = capLock(rollLockTier(rng, floor.floor + bonus), 'masterwork');

    chests[at] = {
      id: `chest_f${floor.floor}_${String(placed).padStart(2, '0')}`,
      pos: [x, y],
      where: option.why,
      room: room?.id ?? null,
      depthBonus: bonus,
      lock: lock.lock,
      tier: lock.tier,
      pickTn: tn(lockData.tiers[lock.tier].pickTn, floor.floor),
      trap: null,
      opened: false,
      restocked: false,
    };
    taken.add(at);
    if (room) usedRooms.add(room.id);
    placed += 1;
  }

  return chests;
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hazards (`05` section 3 step 8, `03` section 8).
 *
 * The documents give each hazard's placement rules but never say how many a
 * floor gets, so the count is `hazardCount` in `floors.json` and is flagged in
 * docs/DECISIONS.md. Kinds are drawn from the ones the floor allows.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 * @param {Record<string, any>} traps
 */
export function placeHazards(floor, rng, traps) {
  /** @type {Record<string, any>} */
  const hazards = {};
  if (floor.spec.hazards.length === 0) return hazards;

  const rules = floorsData.hazardRules;
  const off = protectedTiles(floor);
  const taken = new Set([...Object.keys(traps)]);
  const onPath = new Set(floor.criticalPath.map(([x, y]) => key(x, y)));
  const open = openTiles(floor).filter(([x, y]) => !off.has(key(x, y)));

  const free = (pos) => !taken.has(key(...pos)) && !off.has(key(...pos));

  /** True when sealing this tile would cut the floor in two. */
  const severs = ([x, y]) => {
    const sides = DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) =>
      isWalkable(floor.map[ny]?.[nx]),
    );
    if (sides.length < 2) return false;
    const sealed = floor.map.map((row) => [...row]);
    sealed[y][x] = TILE.WALL;
    const reach = distancesFrom(sealed, sides[0]);
    return sides.slice(1).some(([nx, ny]) => reach[ny][nx] < 0);
  };

  /** Distance to the nearest stairs or door, for the spinner's spacing rule. */
  const landmarks = [floor.stairs.up, floor.stairs.down, ...Object.values(floor.doors).map((d) => d.pos).filter(Boolean)];
  const farFromLandmarks = ([x, y], least) =>
    landmarks.every(([lx, ly]) => Math.abs(lx - x) + Math.abs(ly - y) >= least);

  /** @param {string} kind @param {[number, number][]} tiles */
  const add = (kind, tiles, extra = {}) => {
    for (const [x, y] of tiles) {
      hazards[key(x, y)] = { kind, pos: [x, y], found: false, ...extra };
      taken.add(key(x, y));
    }
  };

  /** Grows a blob of connected tiles, for the hazards that cover an area. */
  const blob = (start, size, allowed) => {
    /** @type {[number, number][]} */
    const out = [start];
    const seen = new Set([key(...start)]);
    const edge = [start];
    while (out.length < size && edge.length > 0) {
      const [x, y] = edge.shift();
      for (const [dx, dy] of rng.shuffle(DIRS)) {
        const next = /** @type {[number, number]} */ ([x + dx, y + dy]);
        if (seen.has(key(...next))) continue;
        if (!isWalkable(floor.map[next[1]]?.[next[0]])) continue;
        if (!allowed(next)) continue;
        seen.add(key(...next));
        out.push(next);
        edge.push(next);
        if (out.length >= size) break;
      }
    }
    return out;
  };

  const placers = {
    // Corridors only, and at least 5 tiles from stairs and doors.
    spinner: () => {
      const spots = open.filter(
        (pos) => free(pos) && inCorridor(floor, pos) && farFromLandmarks(pos, rules.spinner.minDistanceFromStairsAndDoors),
      );
      if (spots.length === 0) return false;
      add('spinner', [rng.pick(spots)]);
      return true;
    },

    // Up to 10% of floor tiles, never over stairs, the waystone or the arena.
    // The share is a cap on the floor's whole darkness, not on one patch, so
    // the running total is what is checked.
    dark_zone: () => {
      const spots = open.filter((pos) => free(pos));
      if (spots.length === 0) return false;
      const cap = Math.floor(openTiles(floor).length * rules.dark_zone.maxFloorTileShare);
      const already = Object.values(hazards).filter((h) => h.kind === 'dark_zone').length;
      const room = cap - already;
      if (room < rules.dark_zone.blobTiles[0]) return false;
      const size = Math.min(room, rng.range(...rules.dark_zone.blobTiles));
      add('dark_zone', blob(rng.pick(spots), size, free));
      return true;
    },

    // At most 3 in a row on the critical path; longer pools only off it.
    deep_water: () => {
      const spots = open.filter((pos) => free(pos) && inCorridor(floor, pos));
      if (spots.length === 0) return false;
      const start = rng.pick(spots);
      const onRoute = onPath.has(key(...start));
      const size = onRoute
        ? rng.range(1, rules.deep_water.maxRunOnCriticalPath)
        : rng.range(...rules.deep_water.poolTiles);
      const pool = blob(start, size, (pos) => free(pos) && (!onPath.has(key(...pos)) || onRoute));
      // A pool that wandered onto the route must still respect the run limit.
      const onRouteTiles = pool.filter((pos) => onPath.has(key(...pos)));
      if (onRouteTiles.length > rules.deep_water.maxRunOnCriticalPath) {
        add('deep_water', pool.filter((pos) => !onPath.has(key(...pos))));
      } else {
        add('deep_water', pool);
      }
      return true;
    },

    // Its fixed destination must be a tile the hero can reach. The pad itself
    // may not sit on the route or anywhere else that is the only way through:
    // stepping on one teleports the hero away, so a pad in a single corridor
    // is a wall to anyone trying to walk past it (05 section 4).
    teleporter_pad: () => {
      const spots = open.filter(
        (pos) => free(pos) && !onPath.has(key(...pos)) && !severs(pos),
      );
      if (spots.length < 2) return false;
      const pad = rng.pick(spots);
      const reach = distancesFrom(floor.map, floor.start.pos);
      const targets = open.filter((pos) => reach[pos[1]][pos[0]] > 0 && key(...pos) !== key(...pad));
      if (targets.length === 0) return false;
      add('teleporter_pad', [pad], { destination: rng.pick(targets) });
      return true;
    },

    // Never in the boss arena or the Safe Room, which protectedTiles covers.
    anti_magic_field: () => {
      const rooms = floor.rooms.filter(
        (room) => !['bossArena', 'safeRoom'].includes(room.role) && room.depth >= 0,
      );
      if (rooms.length === 0) return false;
      const tiles = roomTiles(floor, rng.pick(rooms)).filter(free);
      if (tiles.length === 0) return false;
      add('anti_magic_field', tiles);
      return true;
    },

    // Rooms only, and every entry has to lead back out to a non-ice tile.
    ice_slide: () => {
      const rooms = floor.rooms.filter(
        (room) => !['bossArena', 'safeRoom'].includes(room.role) && room.depth >= 0,
      );
      for (const room of rng.shuffle(rooms)) {
        const tiles = roomTiles(floor, room).filter(free);
        if (tiles.length < 4) continue;
        const ice = new Set(tiles.map((pos) => key(...pos)));
        if (!everySlideEnds(floor, ice)) continue;
        add('ice_slide', tiles, { room: room.id });
        return true;
      }
      return false;
    },

    // Blocks a corridor until burned or bashed.
    web_curtain: () => {
      const spots = open.filter((pos) => free(pos) && inCorridor(floor, pos));
      if (spots.length === 0) return false;
      add('web_curtain', [rng.pick(spots)], {
        burned: false,
        bashTn: floor.spec.webCurtainBashTn,
      });
      return true;
    },
  };

  const wanted = resolveCount(floorsData.hazardCount, floor.floor);
  let placed = 0;
  let tries = 0;
  while (placed < wanted && tries < wanted * 6) {
    tries += 1;
    const kind = rng.pick(floor.spec.hazards);
    if (placers[kind]?.()) placed += 1;
  }
  return hazards;
}

/**
 * Every tile of an ice patch can be slid off onto something that is not ice
 * (`05` section 3 step 8, `03` section 8: every ice room has an exit).
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {Set<string>} ice
 */
export function everySlideEnds(floor, ice) {
  for (const at of ice) {
    const [sx, sy] = at.split(',').map(Number);
    let escapes = false;
    for (const [dx, dy] of DIRS) {
      let x = sx;
      let y = sy;
      // Slide on until a wall or a tile that is not ice.
      for (let step = 0; step < floor.width + floor.height; step += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isWalkable(floor.map[ny]?.[nx])) break;
        x = nx;
        y = ny;
        if (!ice.has(key(x, y))) {
          escapes = true;
          break;
        }
      }
      if (escapes) break;
    }
    if (!escapes) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Lairs and curiosities                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A lair entry for each room already given that role (`05` section 3 step 6).
 * Which monsters are in it comes from the floor's encounter table, which is
 * Phase 3's business, so `encounter` starts null.
 *
 * @param {import('./floor-builder.js').Floor} floor
 */
export function placeLairs(floor) {
  /** @type {Record<string, any>} */
  const lairs = {};
  for (const room of floor.rooms.filter((r) => r.role === 'lair')) {
    lairs[room.id] = {
      room: room.id,
      rect: room.rect,
      depth: room.depth,
      encounter: null,
      cleared: false,
    };
  }
  return lairs;
}

/**
 * One fountain or shrine per Curiosity Room (`05` section 3 step 9,
 * `03` section 8).
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 */
export function placeCuriosities(floor, rng) {
  /** @type {Record<string, any>} */
  const curiosities = {};
  const off = protectedTiles(floor);

  for (const room of floor.rooms.filter((r) => r.role === 'curiosity')) {
    const tiles = roomTiles(floor, room).filter(([x, y]) => !off.has(key(x, y)));
    if (tiles.length === 0) continue;
    const [x, y] = rng.pick(tiles);
    curiosities[key(x, y)] = {
      kind: rng.pick(floorsData.curiosities.kinds),
      pos: [x, y],
      room: room.id,
      used: false,
    };
  }
  return curiosities;
}

/**
 * Fills in every remaining side table for a floor, in the order the passes
 * depend on each other: traps first, then chests and hazards around them.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 */
export function furnishFloor(floor, rng) {
  const traps = placeTraps(floor, rng);
  const chests = placeChests(floor, rng, traps);
  const hazards = placeHazards(floor, rng, { ...traps, ...chests });
  const lairs = placeLairs(floor);
  const curiosities = placeCuriosities(floor, rng);
  return { traps, chests, hazards, lairs, curiosities };
}
