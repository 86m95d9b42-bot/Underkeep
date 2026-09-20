/**
 * The step clock: the cost of time, and what it brings (`01` section 9,
 * `03` section 1, `05` sections 5 and 7).
 *
 * Every step, every turn, and every careful action moves one clock. On every
 * tenth tick the game rolls d6 and a wandering monster arrives on a 1 — more
 * often deep down, and more often in the dark. The same count is what wakes
 * the Hollow Stalker after 1,500 steps on one floor (`02`).
 *
 * The check is rolled on the **encounter** stream, which `05` section 11 names
 * for "wandering monster checks and encounter rolls" and carries in the save.
 * Which monsters arrive comes from the floor's encounter table, and that is
 * Phase 3; until then a successful check says so in the log and no more.
 *
 * No DOM. Every roll comes from the stream it is handed.
 */
import { stepClock as data, pacing } from '../data/floors.js';
import { TILE } from './floor-builder.js';

const key = (x, y) => `${x},${y}`;

/** What every non-combat action costs, in steps (`03` section 1). */
export const ACTION_STEPS = data.actionSteps;

/**
 * The counters a visit to a floor keeps. They live in the exploration state so
 * there is one object to save (`05` section 14, "Floor Changes").
 */
export function createClock() {
  return {
    /** Steps this visit: moves, turns and actions alike (`01` section 9). */
    steps: 0,
    /** Ticks since the last wandering check; safe rooms don't add to it. */
    sinceCheck: 0,
    /** How many checks have been rolled, for the log and for tests. */
    checks: 0,
    /** Hollow Stalker warnings already given, so each is said once (`02`). */
    stalkerWarned: /** @type {number[]} */ ([]),
    /** The Stalker is out, and stays out until the hero leaves the floor. */
    stalkerLoose: false,
    /** Set by a Potion of Invisibility: the next check is skipped (`04`). */
    skipNextCheck: false,
  };
}

/** The cost in steps of a named action, for callers that don't hold the data. */
export function costOf(action) {
  const cost = ACTION_STEPS[action];
  if (cost === undefined) throw new Error(`no step cost for action: ${action}`);
  return cost;
}

/* -------------------------------------------------------------------------- */
/* Where the clock doesn't run                                                */
/* -------------------------------------------------------------------------- */

/**
 * True inside the boss arena or the Safe Room, where no wandering monster
 * check is made and steps don't count towards one (`05` sections 5 and 7).
 * The alcove holding the down stairs is behind the arena, so it counts too.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {[number, number]} pos
 */
export function inSafeZone(floor, [x, y]) {
  const inside = (rect) => {
    if (!rect) return false;
    const [rx, ry, rw, rh] = rect;
    return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  };

  if (inside(floor.arena?.rect)) return true;
  if (floor.arena?.stairsDown?.[0] === x && floor.arena?.stairsDown?.[1] === y) return true;
  if (floor.map?.[y]?.[x] === TILE.STAIRS_DOWN) return true;

  for (const room of floor.rooms ?? []) {
    if (!data.safeRoles.includes(room.role)) continue;
    if (inside(room.rect)) return true;
  }
  return false;
}

/** True where a Dark Zone swallows the torchlight (`03` section 8). */
export function inDarkness(floor, [x, y]) {
  return floor.hazards?.[key(x, y)]?.kind === 'dark_zone';
}

/* -------------------------------------------------------------------------- */
/* The wandering monster check                                                */
/* -------------------------------------------------------------------------- */

/**
 * The d6 range an encounter happens on: a 1, plus one deeper than floor 6
 * (`01` section 9), doubled in darkness (`01`, "Light"), plus whatever an item
 * adds — the Cursed Beacon makes it 1–2 (`04`).
 *
 * @param {number} floorNumber
 * @param {{ dark?: boolean, bonus?: number }} [where]
 */
export function encounterRange(floorNumber, { dark = false, bonus = 0 } = {}) {
  let range = data.encounterUpTo + bonus;
  if (floorNumber >= data.deepFloorsFrom) range += data.deepFloorsBonus;
  if (dark) range *= data.darknessMultiplier;
  return Math.min(range, data.die);
}

/**
 * What a curse adds to the check. The Beacon curse says wandering monsters
 * "appear on a 1-2 instead of a 1" (`04` section 6), so the data names the
 * range it wants and this is the difference.
 * @param {object} [hero]
 */
export function wanderingBonus(hero) {
  const upTo = hero?.explore?.wanderingOn ?? 0;
  return Math.max(0, upTo - data.encounterUpTo);
}

/**
 * One wandering monster check: d6 against the range.
 *
 * `05` section 11 wants random outcomes committed before they are shown, so
 * this returns the roll rather than acting on it; the caller saves, then logs.
 *
 * @param {import('../engine/rng.js').Stream} rng the encounter stream
 * @param {number} floorNumber
 * @param {{ dark?: boolean, bonus?: number, surprise?: boolean, cause?: string }} [where]
 */
export function rollWanderingCheck(rng, floorNumber, where = {}) {
  const range = encounterRange(floorNumber, where);
  const roll = rng.die(data.die);
  return {
    type: 'wanderingCheck',
    roll,
    range,
    encounter: roll <= range,
    // A trap's noise or a gas cloud gives the monsters a surprise round
    // (`03` sections 4 and 5); the fight itself is Phase 3.
    surprise: Boolean(where.surprise),
    cause: where.cause ?? 'steps',
  };
}

/**
 * A noise check: bashing is 2-in-6 to draw something, Knock 1-in-6
 * (`03` section 6). It is the same d6 on the same stream.
 *
 * @param {import('../engine/rng.js').Stream} rng
 * @param {'bash' | 'knock'} action
 */
export function rollNoiseCheck(rng, action) {
  const inSix = data.noiseInSix[action];
  if (inSix === undefined) throw new Error(`no noise rule for action: ${action}`);
  const roll = rng.die(data.die);
  return { type: 'noiseCheck', action, roll, range: inSix, encounter: roll <= inSix, cause: action };
}

/* -------------------------------------------------------------------------- */
/* Advancing the clock                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The Hollow Stalker's warnings and arrival: 1,000 and 1,250 steps on one
 * floor, then 1,500 (`02`, The Hollow Stalker; `05` section 2). The fight is
 * Phase 7, so this raises the events and the log carries them.
 */
function stalkerEvents(clock) {
  /** @type {object[]} */
  const events = [];
  for (const at of data.hollowStalker.warnAtSteps) {
    if (clock.steps >= at && !clock.stalkerWarned.includes(at)) {
      clock.stalkerWarned.push(at);
      events.push({ type: 'stalkerWarning', at, steps: clock.steps });
    }
  }
  if (clock.steps >= pacing.hollowStalkerSteps && !clock.stalkerLoose) {
    clock.stalkerLoose = true;
    events.push({ type: 'stalker', steps: clock.steps });
  }
  return events;
}

/**
 * Advances the clock by some number of steps and rolls whatever that brings.
 *
 * One tick is one step, one turn, or one step's worth of a careful action, and
 * an action worth five steps rolls every check those five steps cross — being
 * slow is meant to be dangerous (`03` section 1).
 *
 * @param {object} options
 * @param {import('./movement.js').Exploration} options.clock the exploration state
 * @param {number} options.floorNumber
 * @param {import('../engine/rng.js').Stream} options.rng the encounter stream
 * @param {number} [options.steps] how many to advance; 1 by default
 * @param {boolean} [options.safe] no checks here (`05` section 5)
 * @param {boolean} [options.dark] a Dark Zone doubles the chance
 * @param {number} [options.bonus] an item's addition to the range
 * @param {string} [options.cause] what spent the time, for the log
 * @returns {object[]} events, in the order they happened
 */
export function advance({ clock, floorNumber, rng, steps = 1, safe = false, dark = false, bonus = 0, cause = 'steps' }) {
  /** @type {object[]} */
  const events = [];

  for (let i = 0; i < steps; i += 1) {
    clock.steps += 1;
    // A step taken in the Safe Room or the boss arena buys no time at all:
    // `05` section 5 keeps them off the wandering clock entirely.
    if (!safe) {
      clock.sinceCheck += 1;
      if (clock.sinceCheck >= data.checkEvery) {
        clock.sinceCheck = 0;
        if (clock.skipNextCheck) {
          clock.skipNextCheck = false;
          events.push({ type: 'checkSkipped', steps: clock.steps });
        } else {
          clock.checks += 1;
          events.push({ ...rollWanderingCheck(rng, floorNumber, { dark, bonus, cause }), steps: clock.steps });
        }
      }
    }
    events.push(...stalkerEvents(clock));
  }

  return events;
}

/**
 * An immediate check, outside the ten-step rhythm: a gas vent, a stink bomb, or
 * the noise of a bash (`03` sections 4, 5 and 6). It doesn't touch the counter,
 * because the ten-step clock keeps running underneath it.
 *
 * @param {object} options
 * @param {import('./movement.js').Exploration} options.clock
 * @param {number} options.floorNumber
 * @param {import('../engine/rng.js').Stream} options.rng
 * @param {boolean} [options.surprise] the monsters arrive with a free round
 * @param {string} [options.cause]
 */
export function immediateCheck({ clock, floorNumber, rng, surprise = false, dark = false, bonus = 0, cause = 'noise' }) {
  clock.checks += 1;
  return [{ ...rollWanderingCheck(rng, floorNumber, { dark, bonus, surprise, cause }), steps: clock.steps }];
}

/**
 * Everything one move costs the clock, worked out from where the hero is.
 * The floor answers both questions the check needs — is this a safe room, and
 * is it dark here — so callers don't have to.
 *
 * @param {import('./floor-builder.js').Floor} floor
 * @param {import('./movement.js').Exploration} ex
 * @param {import('../engine/rng.js').Stream} rng
 * @param {number} [steps]
 * @param {{ bonus?: number, cause?: string }} [options]
 */
export function tick(floor, ex, rng, steps = 1, { bonus = 0, cause = 'steps' } = {}) {
  return advance({
    clock: ex,
    floorNumber: floor.floor,
    rng,
    steps,
    safe: inSafeZone(floor, ex.pos),
    dark: inDarkness(floor, ex.pos),
    bonus,
    cause,
  });
}
