/**
 * Walking a floor from arrival to the boss arena, with the same calls the
 * Exploration screen makes: `createRun`, the six movement keys, the context
 * key for doors and webs, and the step clock ticking underneath. If this
 * arrives, a player with the same abilities can arrive.
 *
 * What it assumes about the hero is `05` section 4's minimum — no skills and
 * no items — plus the bash bonus it is given, which stands for the Might
 * modifier, Brute Force and a crowbar that `03` section 6 adds up.
 *
 * `tools/walk.js` runs it over many seeds; `test/walk.test.js` runs a few of
 * them on every test run.
 */
import { createRun } from '../../src/systems/run.js';
import { blockedBy, DELTA, turnBy, tileAhead } from '../../src/dungeon/movement.js';
import { bashTn } from '../../src/systems/locks.js';
import { FLOOR_COUNT } from '../../src/data/floors.js';

const key = (x, y) => `${x},${y}`;

/** How many times the hero will try one shut door before giving up on it. */
const BASH_TRIES = 40;

/**
 * A shortest route to the target through tiles the hero can enter, treating a
 * shut door as passable when the hero has a way through it. The walk then has
 * to actually open it.
 */
export function routeTo(run, target, bashBonus = 0) {
  const { floor, ex } = run;
  const cameFrom = new Map([[key(...ex.pos), null]]);
  let edge = [ex.pos];

  while (edge.length) {
    const next = [];
    for (const from of edge) {
      if (from[0] === target[0] && from[1] === target[1]) {
        const route = [];
        for (let at = from; cameFrom.get(key(...at)); at = cameFrom.get(key(...at))) route.unshift(at);
        return route;
      }
      for (const [dx, dy] of DELTA) {
        const to = [from[0] + dx, from[1] + dy];
        if (cameFrom.has(key(...to))) continue;
        // A teleporter pad is not a way through: it takes the hero somewhere
        // of its own choosing, so the route goes round one (`05` section 4).
        if (floor.hazards?.[key(...to)]?.kind === 'teleporter_pad') continue;
        const stop = blockedBy(floor, from, to, ex);
        if (stop && !openable(run, stop, bashBonus)) continue;
        cameFrom.set(key(...to), from);
        next.push(to);
      }
    }
    edge = next;
  }
  return null;
}

/**
 * Whether a blocked step is one the hero can clear where they stand. A lock
 * this hero cannot roll high enough to break is a wall to them, and the route
 * goes round — which is why `05` section 3 step 7 caps the locks on the
 * critical path at Good.
 */
function openable(run, stop, bashBonus) {
  if (stop.reason === 'web') return true; // a lit torch, no roll (03 section 8)
  if (!stop.door) return false;
  if (stop.door.kind === 'keyed') return run.ex.keysTaken.has(stop.door.keyId);
  if (!['stuck', 'locked'].includes(stop.door.kind)) return false;
  return bashTn(stop.door, run.floor.floor) - bashBonus <= 20;
}

/** What `walkTo` answers when the floor has moved the hero out from under it. */
const REPLAN = Symbol('replan');

/**
 * Turns to face a heading, then steps; opens what is in the way first.
 *
 * Every press is offered to `notes.onEvents`, which is how the climb answers
 * a wandering monster check: the walk stops where it stands, the fight
 * happens, and the walk goes on from the same tile.
 */
function walkTo(run, to, notes, tries) {
  const { ex } = run;
  const press = (command) => {
    const result = run.press(command);
    if (notes.onEvents?.(result.events, run) === 'stop') notes.stopped = true;
    return result;
  };

  const heading = DELTA.findIndex(([dx, dy]) => ex.pos[0] + dx === to[0] && ex.pos[1] + dy === to[1]);
  // The hero is not where the route left them: a teleporter pad, a spinner or
  // a slide across ice has moved them (`03` section 8, `05` section 6). That
  // is not a failure — the route is simply out of date, and is replanned.
  if (heading < 0) return REPLAN;
  while (ex.facing !== heading && !notes.stopped) {
    press(turnBy(ex.facing, 1) === heading ? 'turnRight' : 'turnLeft');
  }
  if (notes.stopped) return null;

  for (let tried = 0; tried < tries; tried += 1) {
    const { outcome } = press('forward');
    if (notes.stopped) return null;
    if (outcome.moved) return null;

    // Blocked: clear it the way a player would, with the context key.
    const before = ex.doorsOpened.size + ex.hazardsCleared.size;
    if (run.actReason && run.context !== 'burn') {
      return `${outcome.blocked.reason} at ${tileAhead(ex.pos, ex.facing)}: ${run.actReason}`;
    }
    run.act();
    if (ex.doorsOpened.size + ex.hazardsCleared.size > before) notes.opened += 1;
    else notes.bashesFailed += 1;
  }
  return `could not get through ${tileAhead(ex.pos, ex.facing)} in ${tries} tries`;
}

/**
 * Walks one floor from arrival to the arena door.
 * @param {number} masterSeed
 * @param {number} floorNumber
 * @param {object} [hero]
 * @param {number} [hero.bashBonus]
 * @param {number} [hero.tries]
 * @param {object} [hero.run] a run already under way, instead of a fresh one
 * @param {(events: object[], run: object) => ('stop' | void)} [hero.onEvents]
 *   called after every press; `'stop'` ends the walk where it stands
 */
export function walkFloor(
  masterSeed,
  floorNumber,
  { bashBonus = 0, tries = BASH_TRIES, run: given, onEvents } = {},
) {
  const run = given ?? createRun({ masterSeed, floor: floorNumber });
  run.hero.bashBonus = bashBonus;
  const notes = { opened: 0, bashesFailed: 0, keys: 0, onEvents, stopped: false };
  const target = run.floor.arena.door;

  // The route is re-planned after each leg, because opening a door can reveal
  // a shorter way and a key may lie off to one side.
  for (let leg = 0; leg < 64; leg += 1) {
    if (notes.stopped) return { ok: false, stopped: true, why: 'stopped', steps: run.ex.steps, run };
    if (key(...run.ex.pos) === key(...target)) {
      return { ok: true, steps: run.ex.steps, checks: run.ex.checks, ...notes, run };
    }

    // Straight for the arena where that works; otherwise fetch the nearest
    // key and try again — which is what a player does when a door wants one.
    let goingFor = null;
    let route = routeTo(run, target, bashBonus);
    if (!route) {
      goingFor = nearestKey(run, bashBonus);
      route = goingFor && routeTo(run, goingFor, bashBonus);
      if (!route) return { ok: false, why: `no route to the arena door at ${target}`, run };
    }

    let replanned = false;
    for (const step of route) {
      const problem = walkTo(run, step, notes, tries);
      if (problem === REPLAN) {
        replanned = true;
        notes.replans = (notes.replans ?? 0) + 1;
        break;
      }
      if (problem) return { ok: false, why: problem, run };
      if (notes.stopped) break;
    }
    if (replanned) continue;
    if (goingFor) notes.keys += 1;
  }
  return { ok: false, why: 'gave up after 64 legs', run };
}

/** The nearest key the hero has not taken and can reach. */
function nearestKey(run, bashBonus = 0) {
  const { floor, ex } = run;
  // A key entry is stored under its tile, and names the door it fits.
  const loose = Object.entries(floor.keys)
    .map(([at, entry]) => ({ at: at.split(',').map(Number), entry }))
    .filter(({ entry }) => !ex.keysTaken.has(entry.id));
  if (loose.length === 0) return null;

  const routes = loose
    .map((row) => ({ ...row, route: routeTo(run, row.at, bashBonus) }))
    .filter((row) => row.route);
  if (routes.length === 0) return null;
  routes.sort((a, b) => a.route.length - b.route.length);
  return routes[0].at;
}

