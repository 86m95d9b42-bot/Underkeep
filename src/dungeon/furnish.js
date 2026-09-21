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
import { FEATURES } from '../data/hazards.js';
import { isArcane, rollChestTrap, rollTrap } from '../data/traps.js';
import { TILE, isWalkable, distancesFrom } from './floor-builder.js';
import { rollLockTier, tn, lockData } from './doors.js';

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

/**
 * The tiles of a patch with its outer ring left off, so whatever covers it
 * has a shore. A room's `rect` counts its walls, so the ring has to be found
 * from the walkable tiles themselves.
 * @param {[number, number][]} tiles
 */
function insideOf(tiles) {
  if (tiles.length === 0) return [];
  const xs = tiles.map(([x]) => x);
  const ys = tiles.map(([, y]) => y);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  return tiles.filter(([x, y]) => x > left && x < right && y > top && y < bottom);
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
    // A chest may be Sealed where a door off the critical path may not: it is
    // treasure, not a way through, and `03` section 7 lists Sealed among the
    // five things the chest panel can say.
    const lock = rollLockTier(rng, floor.floor + bonus);

    // `03` section 7: a chest is locked 30% + 5% a floor, trapped 20% + 5%,
    // and past floor 4 it may not be a chest at all.
    const rules = lockData.chests;
    const chance = (rule) => Math.min(rule.max, rule.base + rule.perFloor * floor.floor);
    const locked = rng.chance(chance(rules.locked));
    const trapped = rng.chance(chance(rules.trapped));
    const mimicOdds = rules.mimic.bands.find((band) => floor.floor <= band.upToFloor)?.chance ?? 0;
    const mimic = rng.chance(mimicOdds);
    const trap = trapped ? rollChestTrap(rng, floor.floor) : null;

    chests[at] = {
      id: `chest_f${floor.floor}_${String(placed).padStart(2, '0')}`,
      pos: [x, y],
      where: option.why,
      room: room?.id ?? null,
      depthBonus: bonus,
      lock: locked ? lock.lock : 'none',
      tier: locked ? lock.tier : null,
      pickTn: locked ? tn(lockData.tiers[lock.tier].pickTn, floor.floor) : 0,
      trap: trap
        ? {
            ...trap,
            found: false,
            typeKnown: false,
            disarmed: false,
            sprung: false,
            searches: { normal: false, careful: false },
          }
        : null,
      mimic,
      searches: { normal: false, careful: false },
      // `03` section 7: F x 3d10, rolled when it is opened, not now.
      gold: `${floor.floor}*${lockData.chests.gold.dice}`,
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
 * One placer per hazard, each answering whether it found somewhere to go
 * (`05` section 3 step 8, `03` section 8).
 *
 * It is a factory because two callers lay hazards: the floor's own random
 * ones, and a theme feature — floor 4's Web Curtain, floor 5's Flooded
 * Corridor, floor 9's Frozen Lake are hazards a room is made of (`05`
 * section 6), and they are laid by the same rules as the rest.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 * @param {Record<string, any>} hazards the table being filled
 * @param {Set<string>} taken tiles already spoken for
 */
export function hazardPlacers(floor, rng, hazards, taken) {
  const rules = floorsData.hazardRules;
  const off = protectedTiles(floor);
  const onPath = new Set(floor.criticalPath.map(([x, y]) => key(x, y)));
  const open = openTiles(floor).filter(([x, y]) => !off.has(key(x, y)));

  const free = (pos) => !taken.has(key(...pos)) && !off.has(key(...pos));

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
      const spots = open.filter((pos) => free(pos) && !onPath.has(key(...pos)));
      if (spots.length < 2) return false;
      // `severs` walks the whole floor, so it is asked about the tile that
      // was picked rather than about every tile there is.
      const pad = rng.shuffle(spots).slice(0, 8).find((pos) => !severs(floor, pos));
      if (!pad) return false;
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
    // The lake is the room's middle, not the whole room: a floor of ice from
    // wall to wall has nowhere to stop, and `05` section 6 wants a room that
    // can be crossed and left.
    ice_slide: () => {
      const rooms = floor.rooms.filter(
        (room) => !['bossArena', 'safeRoom'].includes(room.role) && room.depth >= 0,
      );
      for (const room of rng.shuffle(rooms)) {
        const lake = insideOf(roomTiles(floor, room).filter(free));
        if (lake.length < rules.ice_slide.leastTiles) continue;
        const ice = new Set(lake.map((pos) => key(...pos)));
        if (!everySlideEnds(floor, ice)) continue;
        add('ice_slide', lake, { room: room.id });
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

  return placers;
}

/**
 * The floor's own hazards (`05` section 3 step 8).
 *
 * The documents give each hazard's placement rules but never say how many a
 * floor gets, so the count is `hazardCount` in `floors.json` and is flagged in
 * docs/DECISIONS.md. Kinds are drawn from the ones the floor allows.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 * @param {Record<string, any>} taken what the traps and chests already hold
 */
export function placeHazards(floor, rng, taken) {
  /** @type {Record<string, any>} */
  const hazards = {};
  if (floor.spec.hazards.length === 0) return hazards;

  const placers = hazardPlacers(floor, rng, hazards, new Set(Object.keys(taken)));
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

/* -------------------------------------------------------------------------- */
/* Theme features                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The floor's theme features (`05` section 6).
 *
 * Each floor names one to three in `floors.json`, and `hazards.json` says what
 * each one is: something to search (Wine Racks, Bookshelves), something to
 * open (a Sarcophagus), a hazard a room is made of (the Web Curtain, the
 * Flooded Corridor, the Frozen Lake), scenery that shapes a room (Lava
 * Channels, Ash Pits), a shrine by another name (the Altar), a visible trap
 * (the Heat Vent), a Lair with better loot (the Goblin Camp), or the boss's
 * own chest (the Dragon's Hoard).
 *
 * Theme Rooms were given their role in `05` section 3 step 6; this is what
 * goes in them. Everything a feature creates goes in the table it belongs to,
 * so nothing has to look in two places for a hazard.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 * @param {{ traps: object, chests: object, hazards: object, lairs: object,
 *   curiosities: object }} tables the side tables already filled
 */
export function placeFeatures(floor, rng, tables) {
  /** @type {Record<string, any>} */
  const features = {};
  const wanted = floor.spec.features ?? [];
  if (wanted.length === 0) return features;

  const off = protectedTiles(floor);
  const taken = new Set([
    ...Object.keys(tables.traps),
    ...Object.keys(tables.chests),
    ...Object.keys(tables.hazards),
    ...Object.keys(tables.curiosities),
  ]);
  const onPath = new Set(floor.criticalPath.map(([x, y]) => key(x, y)));
  const placers = hazardPlacers(floor, rng, tables.hazards, taken);
  // What the hero can reach before any scenery is laid, so a patch can be
  // judged against the floor as it was.
  const reachable = distancesFrom(floor.map, floor.start.pos);
  const free = (pos) => !taken.has(key(...pos)) && !off.has(key(...pos));

  /** Writes one feature down and marks its tile. */
  const add = (id, pos, extra = {}) => {
    features[key(...pos)] = { kind: id, pos: [...pos], found: false, used: false, ...extra };
    taken.add(key(...pos));
    return true;
  };

  /** A room that has not been used for a feature yet, deepest first. */
  const themeRooms = floor.rooms
    .filter((room) => room.role === 'theme')
    .sort((a, b) => b.depth - a.depth);
  const usedRooms = new Set();

  /** One tile of a free theme room, and the room it came from. */
  const spotInRoom = () => {
    for (const room of themeRooms) {
      if (usedRooms.has(room.id)) continue;
      const tiles = roomTiles(floor, room).filter(free);
      if (tiles.length === 0) continue;
      usedRooms.add(room.id);
      return { room, tiles };
    }
    return null;
  };

  /** A corridor tile that is not already busy. */
  const spotInCorridor = () => {
    const spots = openTiles(floor).filter((pos) => free(pos) && inCorridor(floor, pos));
    return spots.length ? rng.pick(spots) : null;
  };

  const makers = {
    // Something to search once: a 1-in-6 or a 1-in-8 for what it hides.
    wine_rack: () => searchable('wine_rack'),
    bookshelf: () => searchable('bookshelf'),

    // Something to open, which may be a fight (`05` section 6).
    sarcophagus: () => {
      const spot = spotInRoom();
      if (!spot) return false;
      return add('sarcophagus', rng.pick(spot.tiles), { room: spot.room.id, opened: false });
    },

    // Naturally lit: torches do not burn down inside (`05` section 6).
    glowcap_room: () => {
      const spot = spotInRoom();
      if (!spot) return false;
      spot.room.lit = true;
      return add('glowcap_room', rng.pick(spot.tiles), { room: spot.room.id, lit: true });
    },

    // Impassable scenery that shapes a room. It is a side table, not a wall,
    // so the map still holds terrain only — but the solvability check treats
    // it as one, and it never takes the critical path.
    lava_channel: () => scenery('lava_channel'),
    ash_pit: () => scenery('ash_pit'),

    // An Altar is an Offering Shrine under another name (`05` section 6).
    altar: () => {
      const spot = spotInRoom();
      if (!spot) return false;
      const at = rng.pick(spot.tiles);
      tables.curiosities[key(...at)] = {
        kind: 'shrine',
        pos: [...at],
        room: spot.room.id,
        used: false,
        feature: 'altar',
      };
      return add('altar', at, { room: spot.room.id, curiosity: 'shrine' });
    },

    // A visible Flame Jet that fires every third step: no detecting needed,
    // and it can be timed (`05` section 6).
    heat_vent: () => {
      const at = spotInCorridor();
      if (!at) return false;
      tables.traps[key(...at)] = {
        kind: 'flame_jet',
        tier: 'standard',
        on: 'floor',
        pos: [...at],
        // Visible: `05` section 6 says it does not need detecting.
        found: true,
        typeKnown: true,
        disarmed: false,
        sprung: false,
        searches: { normal: true, careful: true },
        everyStep: FEATURES.heat_vent.firesEveryStep,
        feature: 'heat_vent',
      };
      return add('heat_vent', at, { trap: 'flame_jet' });
    },

    // A Lair whose chest gets +10 on its loot roll (`05` section 6).
    goblin_camp: () => {
      const lairs = Object.values(tables.lairs).filter((lair) => !lair.feature);
      if (lairs.length === 0) return false;
      const lair = rng.pick(lairs);
      lair.feature = 'goblin_camp';
      const chest = Object.values(tables.chests).find((one) => one.room === lair.room);
      if (chest) chest.lootBonus = (chest.lootBonus ?? 0) + FEATURES.goblin_camp.chestLootBonus;
      const tiles = roomTiles(floor, floor.rooms.find((room) => room.id === lair.room)).filter(free);
      if (tiles.length === 0) return false;
      return add('goblin_camp', rng.pick(tiles), { room: lair.room, lair: lair.room });
    },

    // The dragon's hoard: the boss's own chest, always Rare and never
    // trapped (`03` section 7).
    dragon_hoard: () => {
      const tiles = arenaTiles(floor).filter((pos) => !taken.has(key(...pos)));
      if (tiles.length === 0) return false;
      const at = rng.pick(tiles);
      tables.chests[key(...at)] = {
        id: `chest_f${floor.floor}_hoard`,
        pos: [...at],
        where: 'bossArena',
        room: floor.arena?.id ?? null,
        depthBonus: 0,
        boss: true,
        lock: 'none',
        tier: null,
        pickTn: 0,
        trap: null,
        mimic: false,
        searches: { normal: false, careful: false },
        gold: `${floor.floor}*${lockData.chests.gold.dice}`,
        opened: false,
        restocked: false,
      };
      return add('dragon_hoard', at, { chest: true });
    },

    // Three features are a hazard the room is made of: the placers already
    // know the rules, so the feature only records where one went.
    web_curtain: () => fromHazard('web_curtain'),
    flooded_corridor: () => fromHazard('flooded_corridor', 'deep_water'),
    frozen_lake: () => fromHazard('frozen_lake', 'ice_slide'),
  };

  /** A search-once feature: the racks and the shelves. */
  function searchable(id) {
    const spot = spotInRoom();
    if (!spot) return false;
    return add(id, rng.pick(spot.tiles), { room: spot.room.id, searched: false });
  }

  /**
   * Scenery: a few tiles of a room nothing can walk through. The whole patch
   * is checked for connectivity at once — walling tiles one at a time would
   * walk the floor once per tile — and dropped if it would cut the floor.
   */
  function scenery(id) {
    const spot = spotInRoom();
    if (!spot) return false;
    const spec = FEATURES[id];

    // Along the room's edge, and never on a tile the room is entered by: a
    // channel of lava shapes a room, it does not seal it. A tile that touches
    // anything outside the room is a way in, so it is left alone.
    const middle = new Set(insideOf(spot.tiles).map((at) => key(...at)));
    const inRoom = new Set(spot.tiles.map((at) => key(...at)));
    const edge = spot.tiles.filter(([x, y]) => {
      if (middle.has(key(x, y)) || onPath.has(key(x, y))) return false;
      return DIRS.every(([dx, dy]) => {
        const next = [x + dx, y + dy];
        return !isWalkable(floor.map[next[1]]?.[next[0]]) || inRoom.has(key(...next));
      });
    });
    if (edge.length === 0) return false;

    // The whole patch is checked at once; a patch that would cut the floor is
    // trimmed rather than dropped.
    let picked = rng.shuffle(edge).slice(0, Math.max(1, Math.floor(spot.tiles.length / 4)));
    while (picked.length > 0 && !stillConnected(floor, picked, reachable)) picked = picked.slice(0, -1);
    if (picked.length === 0) return false;

    for (const at of picked) {
      const gem = Boolean(spec.gemOneIn) && rng.chance(1 / spec.gemOneIn);
      add(id, at, { room: spot.room.id, blocks: true, gem, taken: false });
    }
    return true;
  }

  /** A feature that is a hazard: lay the hazard, then point at it. */
  function fromHazard(id, kind = id) {
    const before = new Set(Object.keys(tables.hazards));
    if (!placers[kind]?.()) return false;
    const laid = Object.keys(tables.hazards).filter((at) => !before.has(at));
    if (laid.length === 0) return false;
    const [x, y] = laid[0].split(',').map(Number);
    for (const at of laid) tables.hazards[at].feature = id;
    return add(id, [x, y], { hazard: kind, tiles: laid.length });
  }

  for (const id of wanted) makers[id]?.();
  return features;
}

/** The tiles of the boss arena, where the hoard goes. */
function arenaTiles(floor) {
  const arena = floor.arena;
  if (!arena?.rect) return [];
  return roomTiles(floor, arena);
}

/**
 * Whether the floor is still in one piece with these tiles walled off: no
 * tile the hero could reach before may become unreachable. It is measured
 * against the floor as it was, because some tiles — a secret stash behind an
 * illusion — were never reachable this way to begin with.
 *
 * One walk of the map for the whole patch: scenery is placed in handfuls, and
 * asking tile by tile would walk the floor once per tile.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number][]} blocked
 * @param {number[][]} before distances on the untouched map
 */
function stillConnected(floor, blocked, before) {
  const sealed = floor.map.map((row) => [...row]);
  for (const [x, y] of blocked) sealed[y][x] = TILE.WALL;
  const reach = distancesFrom(sealed, floor.start.pos);
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      if (before[y][x] < 0 || !isWalkable(sealed[y][x])) continue;
      if (reach[y][x] < 0) return false;
    }
  }
  return true;
}

/**
 * True when blocking this tile would cut the floor in two. A teleporter pad
 * is as good as a wall to anyone walking past it, and so is scenery.
 */
function severs(floor, [x, y]) {
  const sides = DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) =>
    isWalkable(floor.map[ny]?.[nx]),
  );
  if (sides.length < 2) return false;
  const sealed = floor.map.map((row) => [...row]);
  sealed[y][x] = TILE.WALL;
  const reach = distancesFrom(sealed, sides[0]);
  return sides.slice(1).some(([nx, ny]) => reach[ny][nx] < 0);
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
  // The theme features come last: they read the tables above, and some of
  // them add to those tables (`05` section 6).
  const features = placeFeatures(floor, rng, { traps, chests, hazards, lairs, curiosities });
  return { traps, chests, hazards, lairs, curiosities, features };
}
