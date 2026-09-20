/**
 * Leaving the dungeon and coming back (`05` section 9).
 *
 * Two ways out and two ways in, and this is the half of them the **Scroll of
 * Return** needs: the scroll takes the hero to town and leaves a **Return
 * Mark** on the tile it was read from, and the next trip down can begin
 * there. Waystones — attuning them, travelling between them — are the other
 * half and their own task; they will leave and arrive through these same two
 * functions.
 *
 * The rules `05` section 9 gives the mark are all here:
 *
 *   - only one exists at a time, and a second scroll replaces it;
 *   - it cannot be placed inside a boss arena;
 *   - the Dungeon Gate offers it **once**, and using it removes it.
 *
 * The mark lives on the town rather than on the hero, because the town is
 * what offers it and what remembers the day it was left.
 *
 * No DOM.
 */
import { inSafeZone } from '../dungeon/step-clock.js';
import { arrive, deepestBoss } from './town.js';

/** Why a mark cannot be left here, or null (`05` section 9). */
export function whyNotMark(floor, pos) {
  if (!floor || !pos) return 'nowhere';
  // "A mark can't be placed inside a boss arena." The arena's safe zone is
  // the arena, its Safe Room and the stairs behind it, and none of them is
  // somewhere a scroll should be able to plant a shortcut.
  if (inSafeZone(floor, pos)) return 'inArena';
  return null;
}

/**
 * Leaves a mark where the hero is standing, replacing whatever was there.
 * @param {object} town
 * @param {object} run
 * @returns {{ ok: boolean, why?: string, mark?: object }}
 */
export function placeMark(town, run) {
  const floor = run?.floor;
  const pos = run?.ex?.pos;
  const why = whyNotMark(floor, pos);
  if (why) return { ok: false, why };

  town.mark = { floor: floor.floor, pos: [...pos], facing: run.ex.facing, day: town.day };
  return { ok: true, mark: town.mark };
}

/** The mark, if there is one. */
export function markOf(town) {
  return town?.mark ?? null;
}

/** Takes the mark away, which is what using it does. */
export function clearMark(town) {
  const had = town?.mark ?? null;
  if (town) town.mark = null;
  return had;
}

/**
 * The hero comes up. A return turns the day over (`05` section 12), and the
 * caller is what puts the run down.
 *
 * @param {object} town
 * @param {object} [options]
 * @param {object} [options.run] where the hero is, for a mark
 * @param {boolean} [options.leaveMark] a Scroll of Return does; a Waystone does not
 * @returns {{ day: number, mark: object | null, why?: string }}
 */
export function returnToTown(town, { run, leaveMark = false } = {}) {
  let mark = markOf(town);
  let why;
  if (leaveMark) {
    const placed = placeMark(town, run);
    if (placed.ok) mark = placed.mark;
    else why = placed.why;
  }
  const day = arrive(town);
  return { day, mark, ...(why ? { why } : {}) };
}

/**
 * Where the next trip down begins: the mark, or the floor's own arrival room.
 * Reading it does not spend it — `use` does — so a screen can offer it.
 * @param {object} town
 * @returns {{ floor: number, at: [number, number], facing?: string } | null}
 */
export function markStart(town) {
  const mark = markOf(town);
  return mark ? { floor: mark.floor, at: [...mark.pos], facing: mark.facing } : null;
}

/** Takes the mark and hands back where it led (`05` section 9: "once"). */
export function useMark(town) {
  const start = markStart(town);
  if (!start) return null;
  clearMark(town);
  return start;
}

/* -------------------------------------------------------------------------- */
/* Waystones (`05` section 9)                                                 */
/* -------------------------------------------------------------------------- */

/** Every floor a Waystone could be on, which is every floor. */
export const FLOORS = Array.from({ length: 10 }, (_, index) => index + 1);

/** The floors whose Waystones the hero has stepped on, in order. */
export function attunedFloors(town) {
  return [...(town?.attuned ?? [])].sort((a, b) => a - b);
}

/** True once this floor's stone has been stood on. */
export function isAttuned(town, floor) {
  return attunedFloors(town).includes(floor);
}

/**
 * Stepping on a Waystone attunes it, permanently (`05` section 9).
 * @returns {{ attuned: boolean, floor: number }} whether this was the first time
 */
export function attune(town, floor) {
  if (!town || isAttuned(town, floor)) return { attuned: false, floor };
  town.attuned = [...attunedFloors(town), floor];
  return { attuned: true, floor };
}

/**
 * The Dungeon Gate's list: every floor, whether it can be travelled to, and
 * what is known about the ones that cannot (`00`, Dungeon Gate: *"Locked
 * floors show what unlocks them, or 'Unknown'"*).
 *
 * A floor is reachable when its own stone is attuned. The next floor down
 * from the deepest attuned one is the one the hero has not been to yet but
 * knows how to reach — everything past that is Unknown.
 *
 * @param {object} town
 * @returns {{ floor: number, attuned: boolean, known: boolean, why: string | null }[]}
 */
export function gateFloors(town) {
  const attunedList = attunedFloors(town);
  const deepest = attunedList.length ? attunedList[attunedList.length - 1] : 0;
  // What the hero knows is there: one floor past the deepest stone they have
  // touched, and one past the deepest boss they have beaten — either is how
  // you learn a floor below exists.
  const frontier = Math.max(deepest, deepestBoss(town)) + 1;
  return FLOORS.map((floor) => {
    // Floor 1 is always reachable: the stairs down are where a trip starts.
    const reachable = attunedList.includes(floor) || floor === 1;
    const known = reachable || floor <= frontier;
    return {
      floor,
      attuned: reachable,
      known,
      why: reachable ? null : known ? 'notAttuned' : 'unknown',
    };
  });
}

/** Why the hero cannot travel to this floor from town, or null. */
export function whyNotTravel(town, floor) {
  const row = gateFloors(town).find((entry) => entry.floor === floor);
  return row ? row.why : 'unknown';
}

/**
 * Leaving the dungeon by Waystone: free, instant, and no mark
 * (`05` section 9). The stone has to be one the hero has attuned.
 */
export function whyNotLeaveByStone(town, run) {
  const floor = run?.floor;
  const pos = run?.ex?.pos;
  if (!floor || !pos) return 'nowhere';
  if (floor.waystone?.[0] !== pos[0] || floor.waystone?.[1] !== pos[1]) return 'notOnStone';
  if (!isAttuned(town, floor.floor)) return 'notAttuned';
  return null;
}
