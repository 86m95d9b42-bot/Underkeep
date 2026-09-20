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
import { arrive } from './town.js';

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
