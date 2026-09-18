/**
 * The solvability check (`05` section 4).
 *
 * A floor is only allowed to exist if a hero with **no special skills or
 * items** can reach the boss arena, reach the down stairs behind it, and get
 * back to where they arrived from anywhere they can get to.
 *
 * The check is deliberately pessimistic. It gives the hero nothing but their
 * hands: they can bash a stuck or locked door, carry a key they have walked
 * over, and burn a web curtain — but they cannot find a secret door, open a
 * Sealed one, or count on a teleporter to take them anywhere useful. Anything
 * that needs more than that is optional content, and is allowed to be
 * unreachable (`05` section 4, "Optional Content").
 *
 * No DOM, no randomness: given a floor, the answer is always the same.
 */
import { TILE } from './floor-builder.js';

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const key = (x, y) => `${x},${y}`;

/**
 * What the minimum hero can do, spelled out so the reasons a floor failed can
 * name the rule it broke.
 */
export const MINIMUM_HERO = {
  canBash: true,
  canUseKeys: true,
  canBurnWebs: true,
  canFindSecretDoors: false,
  canOpenSealed: false,
  canUseTeleporters: false,
};

/**
 * Whether the minimum hero can step from one tile to the next, carrying the
 * keys they have found so far.
 *
 * Direction matters: a barred door opens only from its far side, and a one-way
 * door is a wall from behind.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} from
 * @param {[number, number]} to
 * @param {Set<string>} keysHeld ids of the keys picked up so far
 */
export function canStep(floor, from, to, keysHeld) {
  const [tx, ty] = to;
  const tile = floor.map[ty]?.[tx];
  if (tile === undefined || tile === TILE.WALL) return false;

  // A secret door is a wall to a hero who cannot find it.
  if (tile === TILE.ILLUSION) return MINIMUM_HERO.canFindSecretDoors;

  // A teleporter takes the hero somewhere of its own choosing, so the checker
  // refuses to route through one (`05` section 4).
  const hazard = floor.hazards?.[key(tx, ty)];
  if (hazard?.kind === 'teleporter_pad' && !MINIMUM_HERO.canUseTeleporters) return false;

  if (tile !== TILE.DOOR) return true;

  const door = floor.doors?.[key(tx, ty)];
  if (!door) return true;

  switch (door.kind) {
    case 'open':
    case 'stuck': // bashed: TN 8 + F, always possible
    case 'locked': // bashed or picked
      return true;
    case 'keyed':
      return MINIMUM_HERO.canUseKeys && keysHeld.has(door.keyId);
    case 'sealed':
      // Only Dispel Ward, a scroll, or the Rune Key. The minimum hero has none.
      return MINIMUM_HERO.canOpenSealed;
    case 'barred':
    case 'oneWay':
      // Passable only when coming from the side it opens to.
      return Boolean(door.passFrom) && from[0] === door.passFrom[0] && from[1] === door.passFrom[1];
    default:
      return true;
  }
}

/**
 * Every tile the minimum hero can reach, picking up keys as they go and trying
 * again until no new key turns up — the flood fill `05` section 4 describes.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} [from] defaults to where the hero arrives
 * @param {boolean} [reverse] follow every step backwards, to ask what can get
 *   *to* `from` rather than what it can get to
 */
export function floodFill(floor, from = floor.start.pos, reverse = false) {
  /** @type {Set<string>} */
  let keysHeld = new Set();

  for (let round = 0; round < 16; round += 1) {
    const seen = new Set([key(...from)]);
    /** @type {[number, number][]} */
    const queue = [from];

    for (let head = 0; head < queue.length; head += 1) {
      const here = queue[head];
      for (const [dx, dy] of DIRS) {
        const next = /** @type {[number, number]} */ ([here[0] + dx, here[1] + dy]);
        if (seen.has(key(...next))) continue;
        // Going backwards asks whether the *next* tile could have stepped here.
        const ok = reverse
          ? canStep(floor, next, here, keysHeld) && insideMap(floor, next)
          : canStep(floor, here, next, keysHeld);
        if (!ok) continue;
        seen.add(key(...next));
        queue.push(next);
      }
    }

    // Any key standing in the reachable area is now in hand.
    const found = new Set(keysHeld);
    for (const [at, entry] of Object.entries(floor.keys ?? {})) {
      if (seen.has(at)) found.add(entry.id);
    }
    if (found.size === keysHeld.size) return { reachable: seen, keysHeld };
    keysHeld = found;
  }
  /* c8 ignore next */
  throw new Error('solvability: the key search did not settle');
}

/** @param {import('./floor-builder.js').Floor} floor @param {[number, number]} pos */
function insideMap(floor, [x, y]) {
  return x >= 0 && y >= 0 && x < floor.width && y < floor.height && floor.map[y][x] !== TILE.WALL;
}

/**
 * Runs the whole check (`05` section 4).
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @returns {{ ok: boolean, problems: string[], reachable: Set<string>, keysHeld: Set<string> }}
 */
export function checkSolvable(floor) {
  const problems = [];
  const { reachable, keysHeld } = floodFill(floor);

  // 1. The boss arena can be reached from where the hero arrives.
  if (!reachable.has(key(...floor.arena.entrance))) {
    problems.push('the boss arena cannot be reached from the arrival point');
  }

  // 2. The down stairs can be reached, which means through the arena.
  if (!reachable.has(key(...floor.stairs.down))) {
    problems.push('the down stairs cannot be reached');
  }

  // The waystone is the way home, so it has to be stood on (`05` section 9).
  if (!reachable.has(key(...floor.waystone))) {
    problems.push('the waystone cannot be reached');
  }

  // 3. Everywhere the hero can get to, they can get back from. One-way doors
  //    and ice slides are what make this worth checking.
  const backwards = floodFill(floor, floor.start.pos, true).reachable;
  const stranded = [...reachable].filter((at) => !backwards.has(at));
  if (stranded.length > 0) {
    problems.push(
      `${stranded.length} tile(s) cannot walk back to the arrival point, starting at ${stranded[0]}`,
    );
  }

  // A Rune Key has to be reachable for its Sealed door, even though the door
  // itself is optional content.
  for (const [at, entry] of Object.entries(floor.keys ?? {})) {
    if (entry.kind !== 'rune') continue;
    if (!reachable.has(at)) problems.push(`the rune key at ${at} cannot be reached`);
  }

  return { ok: problems.length === 0, problems, reachable, keysHeld };
}

/**
 * What the check could not reach, as a quick summary for the sweep test and
 * for anyone looking at a floor that failed.
 * @param {import('./floor-builder.js').Floor} floor
 */
export function describeReach(floor) {
  const { reachable } = floodFill(floor);
  let walkable = 0;
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      if (floor.map[y][x] !== TILE.WALL && floor.map[y][x] !== TILE.ILLUSION) walkable += 1;
    }
  }
  return { reached: reachable.size, walkable, share: reachable.size / walkable };
}

/**
 * Opens up any one-directional door that strands the hero.
 *
 * Barred and one-way doors are placed on loops so there is always a way round,
 * but the way round can be shut afterwards — by a second one-directional door
 * on the same loop, by a secret door, or by a teleporter pad landing in the
 * corridor that was the bypass. Rather than throw the floor away, the door
 * responsible becomes a plain archway.
 *
 * It runs on the finished floor and uses `canStep`, so it is judging exactly
 * what `checkSolvable` will judge.
 *
 * @param {import('./floor-builder.js').Floor} floor with its doors mutated
 * @returns {number} how many doors had to be opened up
 */
export function repairOneWayDoors(floor) {
  let demoted = 0;

  // Each round opens at most one door, so this always finishes.
  for (let round = 0; round < 8; round += 1) {
    const forward = floodFill(floor).reachable;
    const back = floodFill(floor, floor.start.pos, true).reachable;
    const stranded = [...forward].filter((at) => !back.has(at));
    if (stranded.length === 0) return demoted;

    const [sx, sy] = stranded[0].split(',').map(Number);
    const directional = Object.entries(floor.doors ?? {}).filter(
      ([, door]) => door.kind === 'barred' || door.kind === 'oneWay',
    );
    if (directional.length === 0) return demoted;

    // The one nearest the trouble is the one most likely to have caused it.
    const [at, door] = directional.sort((a, b) => {
      const da = Math.abs(a[1].pos[0] - sx) + Math.abs(a[1].pos[1] - sy);
      const db = Math.abs(b[1].pos[0] - sx) + Math.abs(b[1].pos[1] - sy);
      return da - db || a[0].localeCompare(b[0]);
    })[0];
    floor.doors[at] = { kind: 'open', pos: door.pos, wasOneDirectional: door.kind };
    demoted += 1;
  }
  return demoted;
}
