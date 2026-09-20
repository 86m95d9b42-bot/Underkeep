/**
 * What a floor remembers between trips, and what restocks (`05` section 8).
 *
 * A floor is rebuilt from the seed every time the hero goes down to it
 * (`05` section 11), so everything they *did* to it has to be kept somewhere
 * else. That is this: one record per floor, held by the town, carrying the
 * map they made and the things they used up.
 *
 * Section 8 then says what comes back when they return from town:
 *
 *   - **Lairs:** 1-2 defeated Lairs refill with a new encounter.
 *   - **Chests:** 1 new chest appears in a random dead end, at most 3
 *     restocked chests waiting on a floor at once.
 *   - **Traps:** 1d3 disarmed or sprung floor traps re-arm.
 *   - **Never:** bosses, unique items, secret doors and keys.
 *   - **Kept:** the map, opened shortcuts and unlocked doors.
 *
 * Nothing here builds a floor or draws a map; it is the memory a floor is
 * dressed with when it is next built.
 *
 * No DOM. The rolls come from the restock stream (`05` section 11).
 */
import { restock as RESTOCK } from '../data/floors.js';
import { restockStream } from '../engine/rng.js';

/** A floor's record, made the first time the hero goes there. */
export function memoryFor(town, floor) {
  town.floors ??= {};
  town.floors[floor] ??= {
    floor,
    visits: 0,
    // The map the hero made (`05` section 10), kept as the sets exploration
    // itself writes to.
    explored: new Set(),
    seen: new Set(),
    // What they did to the place, and what is therefore still done.
    doorsOpened: new Set(),
    secretsFound: new Set(),
    hazardsCleared: new Set(),
    keysTaken: new Set(),
    lairsCleared: new Set(),
    chestsOpened: new Set(),
    trapsGone: new Set(),
    /** Chests section 8 has added since, which the floor does not know about. */
    addedChests: [],
    /** The day this floor last restocked, so one return restocks it once. */
    restockedOnDay: 0,
  };
  return town.floors[floor];
}

/** Every floor the hero has been to, in order. */
export function visitedFloors(town) {
  return Object.values(town?.floors ?? {})
    .filter((memory) => memory.visits > 0)
    .map((memory) => memory.floor)
    .sort((a, b) => a - b);
}

/**
 * Dresses a freshly built floor in what the hero left behind: doors they
 * opened stay open, lairs they cleared stay empty, chests they opened stay
 * open, traps they dealt with stay gone — and the chests section 8 has added
 * since are put out.
 *
 * @param {object} floor a floor straight from the builder
 * @param {object} memory
 */
export function applyMemory(floor, memory) {
  if (!memory) return floor;

  for (const [at, door] of Object.entries(floor.doors ?? {})) {
    if (memory.doorsOpened.has(at)) door.kind = 'open';
  }
  for (const [id, lair] of Object.entries(floor.lairs ?? {})) {
    if (memory.lairsCleared.has(id)) lair.cleared = true;
  }
  for (const [at, chest] of Object.entries(floor.chests ?? {})) {
    if (memory.chestsOpened.has(at)) chest.opened = true;
  }
  for (const [at, trap] of Object.entries(floor.traps ?? {})) {
    if (memory.trapsGone.has(at)) {
      trap.disarmed = true;
      trap.found = true;
    }
  }
  for (const chest of memory.addedChests) {
    floor.chests[`${chest.pos[0]},${chest.pos[1]}`] = { ...chest };
  }
  return floor;
}

/** The dead ends a restocked chest could appear in (`05` section 8). */
export function deadEnds(floor, isWalkable) {
  const out = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      if (!isWalkable(floor.map[y][x])) continue;
      const ways = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dx, dy]) => isWalkable(floor.map[y + dy]?.[x + dx]));
      if (ways.length === 1) out.push([x, y]);
    }
  }
  return out;
}

/** How many restocked chests are still waiting to be opened. */
export function restockedWaiting(memory) {
  return memory.addedChests.filter(
    (chest) => !memory.chestsOpened.has(`${chest.pos[0]},${chest.pos[1]}`),
  ).length;
}

/**
 * Restocks one floor for one return (`05` section 8). Safe to call every time
 * the floor is entered: a floor restocks once a day, and the day it last did
 * is part of its record.
 *
 * @param {object} options
 * @param {object} options.floor the floor as built
 * @param {object} options.memory
 * @param {object} options.town
 * @param {number} options.masterSeed
 * @param {(tile: number) => boolean} options.isWalkable
 * @returns {{ restocked: boolean, lairs: string[], chests: object[], traps: string[] }}
 */
export function restockFloor({ floor, memory, town, masterSeed, isWalkable }) {
  const nothing = { restocked: false, lairs: [], chests: [], traps: [] };
  // A floor the hero has never been to is not restocked: it is still new.
  // Today counts as done either way, so a floor never owes a return that
  // happened before the hero first saw it.
  if (memory.visits === 0 || memory.restockedOnDay >= town.day) {
    memory.restockedOnDay = Math.max(memory.restockedOnDay, town.day);
    return nothing;
  }

  // `05` section 8 restocks *every* visited floor on every return, and a
  // floor may have been left alone for several. Each missed day is rolled in
  // turn, from its own stream, so a floor is the same however late the hero
  // comes back to it.
  const from = memory.restockedOnDay + 1;
  const out = { restocked: true, lairs: [], chests: [], traps: [] };
  for (let day = from; day <= town.day; day += 1) {
    const one = restockOneDay({ floor, memory, day, masterSeed, isWalkable });
    out.lairs.push(...one.lairs);
    out.chests.push(...one.chests);
    out.traps.push(...one.traps);
  }
  memory.restockedOnDay = town.day;
  return out;
}

/** One return's worth of restocking (`05` section 8). */
function restockOneDay({ floor, memory, day, masterSeed, isWalkable }) {
  const rng = restockStream(masterSeed, day, floor.floor);

  // Lairs: 1-2 of the defeated ones refill.
  const [low, high] = RESTOCK.lairs.refill;
  const cleared = [...memory.lairsCleared];
  const refilling = rng.shuffle(cleared).slice(0, rng.range(low, high));
  for (const id of refilling) memory.lairsCleared.delete(id);

  // Chests: one more in a dead end, up to the cap.
  const chests = [];
  if (restockedWaiting(memory) < RESTOCK.chests.maxRestocked) {
    const taken = new Set([
      ...Object.keys(floor.chests ?? {}),
      ...memory.addedChests.map((chest) => `${chest.pos[0]},${chest.pos[1]}`),
    ]);
    const spots = deadEnds(floor, isWalkable).filter(([x, y]) => !taken.has(`${x},${y}`));
    for (let i = 0; i < RESTOCK.chests.perReturn && spots.length > 0; i += 1) {
      const pos = rng.pick(spots);
      const made = {
        id: `chest_f${floor.floor}_r${memory.addedChests.length}`,
        pos: [...pos],
        where: RESTOCK.chests.where,
        room: null,
        restocked: true,
        lock: 'none',
        tier: null,
        trap: null,
        opened: false,
      };
      memory.addedChests.push(made);
      chests.push(made);
    }
  }

  // Traps: 1d3 of the ones that are gone come back.
  const gone = [...memory.trapsGone];
  const rearming = rng.shuffle(gone).slice(0, rng.roll(RESTOCK.traps.rearm));
  for (const at of rearming) memory.trapsGone.delete(at);

  return { lairs: refilling, chests, traps: rearming };
}
