/**
 * Grid movement: the rules for one step or one turn.
 *
 * The game is turn-based on a grid, so a move is resolved in one step and the
 * result is committed before anything is drawn (CLAUDE.md, "Resolve first,
 * render second"). The 140 ms tween that draws the step is display only and
 * lives in `view.js`.
 *
 * What may be stepped on follows `03` section 6 for doors and `05` section 4
 * for which way a one-directional door opens — the same reading the solvability
 * checker uses, so anywhere the checker says the hero can reach, the hero can
 * actually walk (`solvability.js` `canStep`).
 *
 * No DOM, no `Math.random()`: a move is decided entirely by the floor and the
 * exploration state.
 */
import { TILE } from './floor-builder.js';
import { createClock } from './step-clock.js';

const key = (x, y) => `${x},${y}`;

/** Facings, as the vendored `deadEndFacing` numbers them: 0 N, 1 E, 2 S, 3 W. */
export const DELTA = /** @type {[number, number][]} */ ([
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]);

/** Compass letters, for the facing chip and for saves (`05` section 14). */
export const FACING_LETTER = ['N', 'E', 'S', 'W'];

/**
 * The movement pad's six keys (`00-build-outline.md`, Exploration). `travel` is
 * the quarter turn from the hero's facing that the step goes in, so forward is
 * 0 and back is 2; a turn key doesn't travel at all.
 */
export const COMMANDS = /** @type {const} */ ({
  forward: { travel: 0, quarterTurns: 0 },
  strafeRight: { travel: 1, quarterTurns: 0 },
  back: { travel: 2, quarterTurns: 0 },
  strafeLeft: { travel: 3, quarterTurns: 0 },
  turnLeft: { travel: null, quarterTurns: -1 },
  turnRight: { travel: null, quarterTurns: 1 },
});

/** @param {number} facing @param {number} quarterTurns */
export function turnBy(facing, quarterTurns) {
  return (((facing + quarterTurns) % 4) + 4) % 4;
}

/**
 * The compass direction a command travels in, from the hero's facing.
 * @param {number} facing @param {keyof typeof COMMANDS} command
 */
export function headingFor(facing, command) {
  const { travel } = COMMANDS[command];
  return travel === null ? null : turnBy(facing, travel);
}

/**
 * The tile a command would move to, whether or not it can be entered.
 * @param {[number, number]} pos @param {number} facing @param {keyof typeof COMMANDS} command
 * @returns {[number, number] | null} null for a command that only turns
 */
export function targetTile([x, y], facing, command) {
  const heading = headingFor(facing, command);
  if (heading === null) return null;
  const [dx, dy] = DELTA[heading];
  return [x + dx, y + dy];
}

/** @param {[number, number]} pos @param {number} facing */
export function tileAhead(pos, facing) {
  return /** @type {[number, number]} */ (targetTile(pos, facing, 'forward'));
}

/* -------------------------------------------------------------------------- */
/* Exploration state                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} Exploration
 * @property {number} floor
 * @property {[number, number]} pos
 * @property {number} facing
 * @property {number} steps            steps this visit (`05` section 14)
 * @property {number} sinceCheck       ticks towards the next wandering check
 * @property {number} checks           wandering checks rolled this visit
 * @property {Set<string>} explored    tiles the hero has stood on
 * @property {Set<string>} seen        tiles the hero knows of, walked or not
 * @property {Set<string>} doorsOpened
 * @property {Set<string>} secretsFound
 * @property {Set<string>} hazardsCleared  burned web curtains and the like
 * @property {Set<string>} keysTaken    ids of the floor's keys picked up
 */

/**
 * The changes a visit makes to a floor. The floor itself is rebuilt from the
 * seed and never saved, so everything that changes lives here (`05` section 14,
 * "Floor Changes"). Sets are used in memory; the save module turns them into
 * the arrays the template lists.
 *
 * The step clock's counters live here too, so a visit is one object to save.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {object} [memory] what this floor remembers from an earlier trip
 * @returns {Exploration}
 */
export function createExploration(floor, memory = null) {
  const [x, y] = floor.start.pos;
  // A floor the hero has been to before hands over the sets it kept, so
  // walking writes straight into what the floor remembers (`05` section 8:
  // the map, opened shortcuts and unlocked doors stay as they were left).
  const kept = memory ?? {};
  const set = (name, start = []) => {
    if (!kept[name]) return new Set(start);
    for (const one of start) kept[name].add(one);
    return kept[name];
  };

  return {
    floor: floor.floor,
    pos: [x, y],
    facing: floor.start.facing,
    ...createClock(),
    // Map memory. `automap.js` owns what goes in: a Dark Zone is never
    // remembered, so neither set is written to by movement itself
    // (`05` section 10).
    explored: set('explored', [key(x, y)]),
    seen: set('seen', [key(x, y)]),
    doorsOpened: set('doorsOpened'),
    secretsFound: set('secretsFound'),
    hazardsCleared: set('hazardsCleared'),
    keysTaken: set('keysTaken'),
  };
}

/** Whether a secret door here has been found, by the floor or by this visit. */
function secretFound(floor, at, ex) {
  return Boolean(floor.secrets?.[at]?.found) || Boolean(ex?.secretsFound?.has(at));
}

/** Whether a door has been opened this visit. An archway starts open. */
function doorOpen(door, at, ex) {
  return door.kind === 'open' || Boolean(ex?.doorsOpened?.has(at));
}

/* -------------------------------------------------------------------------- */
/* What blocks a step                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Why a step can't be taken, or null when it can.
 *
 * `looksLike` is what the hero is allowed to notice: a secret door and a
 * one-way door from behind are both indistinguishable from wall (`03`
 * section 6), so the log says "wall" while the code still knows better.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} from
 * @param {[number, number]} to
 * @param {Exploration} [ex]
 * @returns {{ reason: string, looksLike: string, at: [number, number], door?: any, hazard?: any } | null}
 */
export function blockedBy(floor, from, to, ex) {
  const [tx, ty] = to;
  const at = key(tx, ty);
  const tile = floor.map[ty]?.[tx];
  /** @param {string} reason @param {string} [looksLike] @param {object} [extra] */
  const stop = (reason, looksLike = reason, extra = {}) => ({ reason, looksLike, at: to, ...extra });

  if (tile === undefined || tile === TILE.WALL) return stop('wall');

  // A secret door is wall until it is found, and says nothing of itself.
  if (tile === TILE.ILLUSION && !secretFound(floor, at, ex)) return stop('secret', 'wall');

  if (tile === TILE.DOOR) {
    const door = floor.doors?.[at];
    if (door && !doorOpen(door, at, ex)) {
      switch (door.kind) {
        case 'stuck':
        case 'locked':
        case 'keyed':
        case 'sealed':
          return stop(door.kind, door.kind, { door });
        case 'barred':
        case 'oneWay': {
          // Passable only from the side it opens to; from behind it is wall.
          const opens = door.passFrom && from[0] === door.passFrom[0] && from[1] === door.passFrom[1];
          if (!opens) return stop(door.kind, door.kind === 'oneWay' ? 'wall' : 'barred', { door });
          break;
        }
        default:
          break;
      }
    }
  }

  // A web curtain is the one hazard that stops a step outright: it blocks the
  // corridor until it is burned or bashed (`03` section 8).
  const hazard = floor.hazards?.[at];
  if (hazard?.kind === 'web_curtain' && !hazard.burned && !ex?.hazardsCleared?.has(at)) {
    return stop('web', 'web', { hazard });
  }

  // Lava channels and ash pits are impassable scenery (`05` section 6). They
  // are a side table rather than a wall, because the map holds terrain only,
  // but nothing walks through them and the solvability check knows it.
  const feature = floor.features?.[at];
  if (feature?.blocks) return stop('scenery', feature.kind, { feature });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Resolving a move                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the hero finds on a tile, for the arrival events and for the context
 * key. Everything but terrain lives in the side tables (`07` section 1).
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} pos
 * @param {Exploration} [ex]
 */
export function whatIsAt(floor, pos, ex) {
  const [x, y] = pos;
  const at = key(x, y);
  const tile = floor.map[y]?.[x];
  const trap = floor.traps?.[at];
  const hazard = floor.hazards?.[at];
  return {
    at: /** @type {[number, number]} */ ([x, y]),
    tile,
    door: tile === TILE.DOOR ? (floor.doors?.[at] ?? null) : null,
    secret: tile === TILE.ILLUSION ? (floor.secrets?.[at] ?? null) : null,
    secretFound: tile === TILE.ILLUSION ? secretFound(floor, at, ex) : false,
    chest: floor.chests?.[at] ?? null,
    curiosity: floor.curiosities?.[at] ?? null,
    feature: floor.features?.[at] ?? null,
    keyItem: floor.keys?.[at] ?? null,
    // An undetected trap or hazard is not something the hero can be told about;
    // it is here so the step resolver can fire it (Phase 7).
    trap: trap ?? null,
    hazard: hazard ?? null,
    waystone: floor.waystone?.[0] === x && floor.waystone?.[1] === y,
    stairs:
      tile === TILE.STAIRS_DOWN ? 'down' : tile === TILE.STAIRS_UP ? 'up' : null,
    pit: tile === TILE.PIT,
  };
}

/** What the hero is facing, for the context key. */
export function lookAhead(floor, ex) {
  return whatIsAt(floor, tileAhead(ex.pos, ex.facing), ex);
}

/**
 * The context key's action (`00-build-outline.md`, Exploration): OPEN for a
 * chest or door, TOUCH for a waystone, DRINK for a fountain, BURN for a web
 * curtain, SEARCH otherwise. What the hero stands on counts too, so a waystone
 * underfoot is still reachable.
 *
 * @returns {'open' | 'touch' | 'drink' | 'offer' | 'burn' | 'search'}
 */
export function contextFor(floor, ex) {
  const ahead = lookAhead(floor, ex);
  const here = whatIsAt(floor, ex.pos, ex);

  // What is in the way comes first: a web and a shut door are what stop the
  // hero going on.
  if (ahead.hazard?.kind === 'web_curtain' && !ahead.hazard.burned && !ex.hazardsCleared.has(key(...ahead.at))) {
    return 'burn';
  }
  if (ahead.door && !doorOpen(ahead.door, key(...ahead.at), ex)) return 'open';

  // Then what is underfoot, which the hero is already standing in: a
  // Waystone is the way out (`05` section 9), and a chest in the next tile
  // can wait for them to step off it.
  if (here.waystone) return 'touch';

  if (ahead.chest && !ahead.chest.opened) return 'open';
  for (const spot of [ahead, here]) {
    if (spot.waystone) return 'touch';
    if (spot.curiosity && !spot.curiosity.used) {
      return spot.curiosity.kind === 'fountain' ? 'drink' : 'offer';
    }
    // A sarcophagus is opened and an ash pit is reached into; a wine rack and
    // a bookshelf are searched, which is what the key already does
    // (`05` section 6).
    if (spot.feature && !spot.feature.opened && !spot.feature.taken) {
      if (spot.feature.kind === 'sarcophagus' || spot.feature.gem) return 'open';
    }
  }
  return 'search';
}

/**
 * What being on a tile raises. Nothing is resolved here — the trap, hazard and
 * curiosity rules are Phase 7 — but the events are raised so there is one place
 * for them to be handled, and the run uses the same list when the hero first
 * arrives on a floor.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} at
 * @param {Exploration} ex
 */
export function arrivalEvents(floor, at, ex) {
  /** @type {object[]} */
  const events = [];
  const landed = whatIsAt(floor, at, ex);
  if (landed.stairs) events.push({ type: 'stairs', direction: landed.stairs, at });
  if (landed.waystone) events.push({ type: 'waystone', at });
  if (landed.pit) events.push({ type: 'pit', at });
  if (landed.hazard) events.push({ type: 'hazard', kind: landed.hazard.kind, at, hazard: landed.hazard });
  if (landed.feature) events.push({ type: 'feature', kind: landed.feature.kind, at, feature: landed.feature });
  if (landed.trap && !landed.trap.sprung && !landed.trap.disarmed) {
    events.push({ type: 'trap', at, trap: landed.trap });
  }
  // A key lies where the builder put it, and belongs to the floor rather than
  // to a pack: `05` section 14 saves it as `keysTaken`.
  if (landed.keyItem && !ex.keysTaken?.has(landed.keyItem.id)) {
    events.push({ type: 'key', at, key: landed.keyItem });
  }
  if (!ex.explored.has(key(...at))) events.push({ type: 'newTile', at });
  return events;
}

/**
 * Resolves one press of the movement pad, without changing anything.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {Exploration} ex
 * @param {keyof typeof COMMANDS} command
 */
export function resolveMove(floor, ex, command) {
  const spec = COMMANDS[command];
  if (!spec) throw new Error(`unknown move command: ${command}`);

  const from = { pos: /** @type {[number, number]} */ ([...ex.pos]), facing: ex.facing };
  /** @type {object[]} */
  const events = [];

  if (spec.travel === null) {
    const facing = turnBy(ex.facing, spec.quarterTurns);
    events.push({ type: 'turn', from: ex.facing, facing });
    return { command, from, to: { pos: from.pos, facing }, moved: false, turned: true, blocked: null, cost: 1, events };
  }

  const to = /** @type {[number, number]} */ (targetTile(ex.pos, ex.facing, command));
  const blocked = blockedBy(floor, ex.pos, to, ex);
  if (blocked) {
    events.push({ type: 'blocked', ...blocked });
    // Walking into a wall costs nothing: the hero never left the tile.
    return { command, from, to: from, moved: false, turned: false, blocked, cost: 0, events };
  }

  const heading = headingFor(ex.facing, command);
  events.push({ type: 'step', from: from.pos, to, heading });

  // Ice: stepping onto it slides the hero on until a wall or a tile that is
  // not ice, and they cannot turn on the way (`05` section 6). Every tile
  // slid still counts on the step clock, so the cost is the whole path.
  const slid = slideOn(floor, to, heading, ex);
  const landed = slid.at;
  if (slid.path.length > 0) {
    events.push({ type: 'slid', from: to, to: landed, tiles: slid.path.length });
  }

  events.push(...arrivalEvents(floor, landed, ex));

  return {
    command,
    from,
    to: { pos: landed, facing: ex.facing },
    moved: true,
    turned: false,
    blocked: null,
    cost: 1 + slid.path.length,
    slid: slid.path,
    events,
  };
}

/**
 * Where a step onto ice ends (`05` section 6, Ice Slide). Deterministic, so
 * it belongs with the movement rather than with the rolls: the hero keeps
 * going in the direction they were travelling until something stops them.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} from the tile just stepped onto
 * @param {[number, number]} heading
 * @param {Exploration} [ex]
 */
export function slideOn(floor, from, heading, ex) {
  /** @type {[number, number][]} */
  const path = [];
  let at = /** @type {[number, number]} */ ([...from]);
  const isIce = (pos) => floor.hazards?.[key(...pos)]?.kind === 'ice_slide';

  // A floor is at most 49 tiles across, so nothing slides further than that.
  for (let step = 0; step < floor.width + floor.height; step += 1) {
    if (!isIce(at)) break;
    const next = /** @type {[number, number]} */ ([at[0] + heading[0], at[1] + heading[1]]);
    if (blockedBy(floor, at, next, ex)) break;
    at = next;
    path.push(at);
  }
  return { path, at };
}

/**
 * Applies a resolved move. This is the one step the game state takes; the save
 * is written from here and only then does anything animate.
 *
 * Two things are deliberately not done here. The clock is not wound:
 * `outcome.cost` says how much time the move took — 1 for a step or a turn, 0
 * for walking into a wall (`01` section 9) — and the caller spends it through
 * `step-clock.js`, which is where the encounter stream is. And the map is not
 * written: `automap.remember` owns that, because what the hero remembers
 * depends on the light (`05` section 10).
 *
 * @param {Exploration} ex
 * @param {ReturnType<typeof resolveMove>} outcome
 */
export function commitMove(ex, outcome) {
  ex.facing = outcome.to.facing;
  if (outcome.moved) ex.pos = [...outcome.to.pos];
  return ex;
}

/**
 * Resolve and commit in one call, for callers that have nothing to do in
 * between. Returns the outcome, so the log and the tween can both read it.
 */
export function move(floor, ex, command) {
  const outcome = resolveMove(floor, ex, command);
  commitMove(ex, outcome);
  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Changes the hero makes to the floor                                        */
/* -------------------------------------------------------------------------- */

/** Records a door as opened, so it stays open and draws open (`view.js`). */
export function openDoor(ex, at) {
  ex.doorsOpened.add(Array.isArray(at) ? key(...at) : at);
  return ex;
}

/** Records a secret door as found (`03` section 6, Secret Doors). */
export function findSecret(ex, at) {
  ex.secretsFound.add(Array.isArray(at) ? key(...at) : at);
  return ex;
}

/**
 * Records a hazard as cleared — today only a web curtain, burned with a torch
 * (`03` section 8). The roll to bash one, and every other hazard's effect, is
 * Phase 7.
 */
export function clearHazard(ex, at) {
  ex.hazardsCleared.add(Array.isArray(at) ? key(...at) : at);
  return ex;
}
