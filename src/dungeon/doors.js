/**
 * Door types, lock tiers and secret doors — `07` section 3 steps 5 and 6,
 * following `05` section 3 step 7 and `03` section 6.
 *
 * Doors are terrain (`TILE.DOOR`); everything about one — its kind, its lock,
 * whether it is jammed — lives in the floor's `doors` side table, keyed "x,y"
 * (docs/DECISIONS.md, 2026-09-18).
 *
 * No DOM, and every draw comes from the floor's layout stream.
 */
import locks from '../data/locks.json' with { type: 'json' };
import { TILE, isWalkable, distancesFrom, RegenerateFloor } from './floor-builder.js';

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** @param {{ base: number, perFloor: number }} rule @param {number} floor */
export function tn(rule, floor) {
  return rule.base + rule.perFloor * floor;
}

/**
 * The lock tier for one door or chest: d10 + F, banded (`03` section 6).
 * @param {import('../engine/rng.js').Stream} rng
 * @param {number} floor
 */
export function rollLockTier(rng, floor) {
  const total = rng.die(10) + floor;
  const band = locks.lockTierRoll.bands.find((b) => total <= b.upTo);
  return { lock: band.lock, tier: band.tier, roll: total };
}

/**
 * Caps a lock at a maximum strength. Doors on the critical path are capped at
 * Good, so bashing always remains possible (`05` section 3 step 7).
 * @param {{ lock: string, tier: string }} rolled
 * @param {string} max
 */
export function capLock(rolled, max) {
  const order = locks.lockTierRoll.order;
  if (order.indexOf(rolled.lock) <= order.indexOf(max)) return rolled;
  const band = locks.lockTierRoll.bands.find((b) => b.lock === max);
  return { ...rolled, lock: band.lock, tier: band.tier, capped: true };
}

/** Every DOOR tile on a map. @returns {[number, number][]} */
export function findDoors(map) {
  /** @type {[number, number][]} */
  const doors = [];
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[0].length; x++) if (map[y][x] === TILE.DOOR) doors.push([x, y]);
  }
  return doors;
}

/**
 * The walkable tiles either side of a door. A door in a corridor has two; one
 * against the map edge may have fewer, and is then no use as a door at all.
 * @param {number[][]} map @param {[number, number]} pos
 */
function sidesOf(map, [x, y]) {
  /** @type {[number, number][]} */
  const sides = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (isWalkable(map[ny]?.[nx])) sides.push([nx, ny]);
  }
  return sides;
}

/**
 * True when the floor still holds together with this door sealed, which is
 * what `05` section 3 step 7 means by "on a loop": barred and one-way doors go
 * only here, so the far side can always be reached another way.
 *
 * @param {number[][]} map
 * @param {[number, number]} pos
 */
export function isOnLoop(map, pos) {
  const sides = sidesOf(map, pos);
  if (sides.length < 2) return false;

  const sealed = map.map((row) => [...row]);
  sealed[pos[1]][pos[0]] = TILE.WALL;

  const reach = distancesFrom(sealed, sides[0]);
  return sides.slice(1).every(([x, y]) => reach[y][x] >= 0);
}

/**
 * What is known about each door before its kind is chosen: where it is, what it
 * touches, and whether the floor survives without it.
 *
 * @param {import('./floor-builder.js').Floor} floor
 */
export function describeDoors(floor) {
  const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));

  /** Which room, if any, a tile belongs to. */
  const roomAt = (x, y) =>
    floor.rooms.find((room) => {
      const [rx, ry, rw, rh] = room.rect;
      return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
    });

  return findDoors(floor.map).map((pos) => {
    const sides = sidesOf(floor.map, pos);
    const rooms = sides.map(([x, y]) => roomAt(x, y)).filter(Boolean);
    return {
      pos,
      key: `${pos[0]},${pos[1]}`,
      onCriticalPath: onPath.has(`${pos[0]},${pos[1]}`),
      onLoop: isOnLoop(floor.map, pos),
      sides,
      // "In front of" a room means one side of the door is inside it.
      fronts: [...new Set(rooms.map((room) => room.role))],
      roomIds: rooms.map((room) => room.id),
    };
  });
}

/**
 * Gives every door a kind and, where it has one, a lock
 * (`05` section 3 step 7, `03` section 6).
 *
 * Kinds are assigned most-constrained first, the same reasoning as room roles:
 * barred and one-way need a loop, sealed needs an optional room off the route,
 * keyed needs the route or a treasure room. Whatever is left takes its chance
 * at being stuck or locked, and the rest stay open.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('../engine/rng.js').Stream} rng
 */
export function assignDoorTypes(floor, rng) {
  const spec = floor.spec;
  const described = describeDoors(floor);
  /** @type {Record<string, any>} */
  const doors = {};
  const taken = new Set();

  /** The arena's one entrance is never locked or trapped (`05` section 5). */
  const arenaDoor = `${floor.arena.door[0]},${floor.arena.door[1]}`;
  taken.add(arenaDoor);
  doors[arenaDoor] = { kind: 'open', arenaEntrance: true };

  const free = (allowed) => described.filter((d) => !taken.has(d.key) && allowed(d));

  /**
   * @param {string} kind
   * @param {[number, number]} range how many, as the document gives it
   * @param {(door: any) => boolean} allowed
   */
  const place = (kind, range, allowed) => {
    const wanted = rng.range(range[0], range[1]);
    const placed = [];
    for (let i = 0; i < wanted; i += 1) {
      const options = free(allowed);
      if (options.length === 0) break;
      const door = rng.pick(options);
      taken.add(door.key);
      doors[door.key] = { kind, pos: door.pos };
      placed.push(door);
    }
    return placed;
  };

  const allows = (kind) => Boolean(spec.specialDoors[kind]);
  const range = (kind) => spec.specialDoors[kind].count;

  // Barred and one-way: only on a loop, so the hero can always get round.
  if (allows('barred')) place('barred', range('barred'), (d) => d.onLoop && !d.onCriticalPath);
  if (allows('oneWay')) place('oneWay', range('oneWay'), (d) => d.onLoop && !d.onCriticalPath);

  // Sealed: only in front of a treasure room or the secret stash, never on the
  // route. Its tier is Arcane by definition.
  const sealed = allows('sealed')
    ? place(
        'sealed',
        range('sealed'),
        (d) => !d.onCriticalPath && d.fronts.includes('treasure'),
      )
    : [];
  for (const door of sealed) {
    doors[door.key] = { kind: 'sealed', pos: door.pos, lock: 'sealed', tier: 'arcane', needsKey: 'rune' };
  }

  // Keyed: on the route, or in front of a treasure room.
  const keyed = allows('keyed')
    ? place('keyed', range('keyed'), (d) => d.onCriticalPath || d.fronts.includes('treasure'))
    : [];
  for (const door of keyed) {
    doors[door.key] = { kind: 'keyed', pos: door.pos, lock: 'masterwork', tier: 'masterwork', needsKey: 'floor' };
  }

  // Stuck or locked: 25% + 2% x F of all doors (05 section 3 step 7).
  const share = spec.rates.lockedDoors;
  const wantedLocked = Math.round(described.length * share);
  const stuckShare = locks.stuckShare.value;

  for (let i = 0; i < wantedLocked; i += 1) {
    const options = free(() => true);
    if (options.length === 0) break;
    const door = rng.pick(options);
    taken.add(door.key);

    if (rng.chance(stuckShare)) {
      doors[door.key] = { kind: 'stuck', pos: door.pos, bashTn: tn(locks.doorKinds.stuck.bashTn, floor.floor) };
      continue;
    }
    // A door on the route is capped at Good, so bashing always remains
    // possible; a rolled Sealed elsewhere becomes Masterwork, because a Sealed
    // door is only allowed where the document says.
    let rolled = rollLockTier(rng, floor.floor);
    rolled = capLock(rolled, door.onCriticalPath ? 'good' : 'masterwork');
    doors[door.key] = {
      kind: 'locked',
      pos: door.pos,
      lock: rolled.lock,
      tier: rolled.tier,
      pickTn: tn(locks.tiers[rolled.tier].pickTn, floor.floor),
    };
  }

  // Everything else is an open archway.
  for (const door of described) {
    if (!doors[door.key]) doors[door.key] = { kind: 'open', pos: door.pos };
  }

  return { doors, described, keyed, sealed };
}

/**
 * Puts each key where the hero can reach it before the door it opens
 * (`05` section 3 step 7). A key behind its own door would make the floor
 * unsolvable, so this checks rather than hopes.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {Record<string, any>} doors
 * @param {import('../engine/rng.js').Stream} rng
 */
export function placeKeys(floor, doors, rng) {
  /** @type {Record<string, any>} */
  const keys = {};

  const needy = Object.values(doors).filter((door) => door.needsKey);
  for (const [index, door] of needy.entries()) {
    // Seal every door that needs a key, then look at what is still reachable:
    // anywhere in there is somewhere the hero can get to first.
    const sealed = floor.map.map((row) => [...row]);
    for (const other of needy) sealed[other.pos[1]][other.pos[0]] = TILE.WALL;

    const reach = distancesFrom(sealed, floor.start.pos);
    /** @type {[number, number][]} */
    const spots = [];
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < floor.width; x++) {
        if (reach[y][x] > 2 && floor.map[y][x] === TILE.FLOOR) spots.push([x, y]);
      }
    }
    if (spots.length === 0) {
      throw new RegenerateFloor(`nowhere reachable to leave the ${door.needsKey} key`);
    }

    const id = `${door.needsKey}key_f${floor.floor}_${index}`;
    const at = rng.pick(spots);
    keys[`${at[0]},${at[1]}`] = { id, kind: door.needsKey, opens: `${door.pos[0]},${door.pos[1]}` };
    door.keyId = id;
  }
  return keys;
}

/**
 * Secret doors (`07` step 6, `03` section 6).
 *
 * The generator scatters `ILLUSION` tiles of its own. The ones that make sense
 * are kept — off the route, and hiding a way round rather than the only way
 * through — the rest become wall, and more are added until the floor has the
 * 2 to 4 the documents call for. The secret stash gets one either way: that is
 * what seals it.
 *
 * @param {import('./floor-builder.js').Floor} floor mutated
 * @param {Record<string, any>} doors the door side table, mutated where a door
 *   becomes secret, so no tile ends up with two kinds
 * @param {import('../engine/rng.js').Stream} rng
 */
export function placeSecretDoors(floor, doors, rng) {
  const map = floor.map;
  const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
  const [min, max] = locks.secretDoors.perFloor;

  /** @type {Record<string, any>} */
  const secrets = {};

  // 1. The stash. The corridor tile leading into the chosen dead end becomes
  //    the secret door, and the dead end itself is the chamber the chest sits
  //    in, so nothing has to be dug (05 section 3 step 6).
  let stash = null;
  if (floor.secretStash) {
    const [sx, sy] = floor.secretStash;
    const open = DIRS.filter(([dx, dy]) => isWalkable(map[sy + dy]?.[sx + dx]));
    if (open.length === 1) {
      const [ox, oy] = open[0];
      const door = [sx + ox, sy + oy];
      if (!onPath.has(`${door[0]},${door[1]}`)) {
        map[door[1]][door[0]] = TILE.ILLUSION;
        secrets[`${door[0]},${door[1]}`] = { kind: 'stash', found: false, chamber: [sx, sy] };
        delete doors[`${door[0]},${door[1]}`];
        stash = { door, chamber: [sx, sy] };
      }
    }
  }

  // 2. The generator's own illusions: keep the useful ones, wall up the rest.
  for (let y = 1; y < floor.height - 1; y += 1) {
    for (let x = 1; x < floor.width - 1; x += 1) {
      if (map[y][x] !== TILE.ILLUSION) continue;
      if (secrets[`${x},${y}`]) continue;

      const keep =
        !onPath.has(`${x},${y}`) &&
        Object.keys(secrets).length < max &&
        // Only worth keeping if it hides a way round: sealing it must leave
        // the floor whole, or the secret door is the only way through.
        isOnLoop(map, [x, y]);

      if (keep) secrets[`${x},${y}`] = { kind: 'shortcut', found: false };
      else map[y][x] = TILE.WALL;
    }
  }

  // 3. Top up to the minimum by turning suitable doors secret. Only plain open
  //    archways qualify: a door that is already stuck, locked or barred keeps
  //    the kind it was given, and no tile may end up with two.
  if (Object.keys(secrets).length < min) {
    const candidates = findDoors(map)
      .filter(([x, y]) => !onPath.has(`${x},${y}`))
      .filter(([x, y]) => doors[`${x},${y}`]?.kind === 'open' && !doors[`${x},${y}`].arenaEntrance)
      .filter((pos) => isOnLoop(map, pos));

    const shuffled = rng.shuffle(candidates);
    for (const [x, y] of shuffled) {
      if (Object.keys(secrets).length >= min) break;
      map[y][x] = TILE.ILLUSION;
      secrets[`${x},${y}`] = { kind: 'shortcut', found: false };
      // The door is now a secret door, not an archway.
      delete doors[`${x},${y}`];
    }
  }

  return { secrets, stash, findTn: tn(locks.secretDoors.findTn, floor.floor) };
}

export { locks as lockData };
