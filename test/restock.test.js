/**
 * Restocking on each return (`05` section 8), and what a floor remembers
 * between trips.
 *
 * A floor is rebuilt from the seed every time the hero goes down to it, so
 * everything they did to it lives in the town's own record of that floor.
 * Section 8 then says what comes back: lairs refill, a chest appears, traps
 * re-arm — and the map, the opened doors and the shortcuts do not change.
 */
import { describe, it, expect } from 'vitest';
import {
  applyMemory,
  deadEnds,
  memoryFor,
  restockFloor,
  restockedWaiting,
  visitedFloors,
} from '../src/systems/floor-memory.js';
import { arrive, createTown, descend } from '../src/systems/town.js';
import { createRun } from '../src/systems/run.js';
import { buildFloor, isWalkable } from '../src/dungeon/floor-builder.js';
import { layoutStream } from '../src/engine/rng.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { restock as RESTOCK } from '../src/data/floors.js';

const SEED = 20260918;

function makeHero() {
  return finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 10 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
}

/**
 * A floor and the town's record of it, as a trip would leave them: visited
 * today, and so owing no return that happened before.
 */
function visited(floorNumber = 1, town = createTown()) {
  const floor = buildFloor(floorNumber, SEED, layoutStream);
  const memory = memoryFor(town, floorNumber);
  memory.visits = 1;
  memory.restockedOnDay = town.day;
  return { floor, memory, town };
}

const restockOn = ({ floor, memory, town }) =>
  restockFloor({ floor, memory, town, masterSeed: SEED, isWalkable });

describe("what 05 section 8 says comes back", () => {
  it('has the table as data', () => {
    expect(RESTOCK.lairs.refill).toEqual([1, 2]);
    expect(RESTOCK.chests).toMatchObject({ perReturn: 1, maxRestocked: 3, where: 'deadEnd' });
    expect(RESTOCK.traps.rearm).toBe('1d3');
    expect(RESTOCK.never).toEqual(['bosses', 'uniques', 'secretDoors', 'keys']);
  });

  it('refills one or two defeated lairs', () => {
    const where = visited();
    const lairs = Object.keys(where.floor.lairs);
    for (const id of lairs) where.memory.lairsCleared.add(id);
    const cleared = where.memory.lairsCleared.size;
    expect(cleared).toBeGreaterThan(0);

    arrive(where.town);
    const done = restockOn(where);
    expect(done.restocked).toBe(true);
    const refilled = cleared - where.memory.lairsCleared.size;
    expect(refilled).toBeGreaterThanOrEqual(1);
    expect(refilled).toBeLessThanOrEqual(Math.min(2, cleared));
  });

  it('re-arms one to three traps that were dealt with', () => {
    const where = visited();
    const traps = Object.keys(where.floor.traps).slice(0, 6);
    for (const at of traps) where.memory.trapsGone.add(at);

    arrive(where.town);
    restockOn(where);
    const back = traps.length - where.memory.trapsGone.size;
    expect(back).toBeGreaterThanOrEqual(1);
    expect(back).toBeLessThanOrEqual(3);
  });

  it('puts one new chest in a dead end, and no more than three at once', () => {
    const where = visited();
    const ends = deadEnds(where.floor, isWalkable);
    expect(ends.length).toBeGreaterThan(0);

    for (let day = 1; day <= 5; day += 1) {
      arrive(where.town);
      restockOn(where);
    }
    expect(restockedWaiting(where.memory)).toBe(RESTOCK.chests.maxRestocked);
    for (const chest of where.memory.addedChests) {
      expect(chest.restocked).toBe(true);
      expect(ends.some(([x, y]) => x === chest.pos[0] && y === chest.pos[1])).toBe(true);
    }

    // Open one and the shop has room to leave another.
    const first = where.memory.addedChests[0];
    where.memory.chestsOpened.add(`${first.pos[0]},${first.pos[1]}`);
    expect(restockedWaiting(where.memory)).toBe(2);
    arrive(where.town);
    restockOn(where);
    expect(restockedWaiting(where.memory)).toBe(3);
  });

  it('restocks a floor once a return, however often it is entered', () => {
    const where = visited();
    for (const id of Object.keys(where.floor.lairs)) where.memory.lairsCleared.add(id);
    arrive(where.town);

    const first = restockOn(where);
    expect(first.restocked).toBe(true);
    const again = restockOn(where);
    expect(again.restocked).toBe(false);
    expect(where.memory.restockedOnDay).toBe(where.town.day);
  });

  it('catches up the returns a floor was not visited on', () => {
    const one = visited(2);
    const other = visited(2, createTown());
    for (const where of [one, other]) {
      for (const at of Object.keys(where.floor.traps).slice(0, 8)) where.memory.trapsGone.add(at);
    }

    // One floor is entered on each of three days; the other only on the third.
    for (let day = 0; day < 3; day += 1) {
      arrive(one.town);
      restockOn(one);
      arrive(other.town);
    }
    restockOn(other);

    expect(other.memory.restockedOnDay).toBe(one.memory.restockedOnDay);
    expect(other.memory.addedChests.length).toBe(one.memory.addedChests.length);
    expect([...other.memory.trapsGone].sort()).toEqual([...one.memory.trapsGone].sort());
  });

  it('never restocks a floor the hero has not been to', () => {
    const town = createTown();
    const floor = buildFloor(3, SEED, layoutStream);
    const memory = memoryFor(town, 3);
    arrive(town);
    expect(restockFloor({ floor, memory, town, masterSeed: SEED, isWalkable })).toMatchObject({
      restocked: false,
    });
    expect(memory.addedChests).toEqual([]);
  });
});

describe('what a floor remembers', () => {
  it('keeps the map, the opened doors and the shortcuts', () => {
    const town = createTown();
    const hero = makeHero();
    const first = createRun({ masterSeed: SEED, floor: 1, hero, town });
    for (let i = 0; i < 25; i += 1) first.press('forward');
    first.press('turnLeft');
    for (let i = 0; i < 15; i += 1) first.press('forward');

    const memory = memoryFor(town, 1);
    const map = new Set(memory.explored);
    expect(map.size).toBeGreaterThan(1);
    memory.doorsOpened.add('9,9');

    // Home and back down again.
    arrive(town);
    descend(town);
    const second = createRun({ masterSeed: SEED, floor: 1, hero, town });

    expect(memory.visits).toBe(2);
    expect([...second.ex.explored].sort()).toEqual([...map].sort());
    expect(second.ex.doorsOpened.has('9,9')).toBe(true);
    // The floor itself is the same floor (`05` section 11).
    expect(second.floor.start.pos).toEqual(first.floor.start.pos);
  });

  it('dresses a rebuilt floor in what was left behind', () => {
    const { floor, memory } = visited();
    const doorAt = Object.keys(floor.doors)[0];
    const lairId = Object.keys(floor.lairs)[0];
    const chestAt = Object.keys(floor.chests)[0];
    const trapAt = Object.keys(floor.traps)[0];
    memory.doorsOpened.add(doorAt);
    memory.lairsCleared.add(lairId);
    memory.chestsOpened.add(chestAt);
    memory.trapsGone.add(trapAt);
    memory.addedChests.push({ id: 'chest_r', pos: [1, 1], restocked: true });

    const rebuilt = applyMemory(buildFloor(1, SEED, layoutStream), memory);
    expect(rebuilt.doors[doorAt].kind).toBe('open');
    expect(rebuilt.lairs[lairId].cleared).toBe(true);
    expect(rebuilt.chests[chestAt].opened).toBe(true);
    expect(rebuilt.traps[trapAt]).toMatchObject({ disarmed: true, found: true });
    expect(rebuilt.chests['1,1']).toMatchObject({ id: 'chest_r', restocked: true });
  });

  it('counts the floors the hero has actually been to', () => {
    const town = createTown();
    memoryFor(town, 1).visits = 2;
    memoryFor(town, 4).visits = 1;
    memoryFor(town, 7); // looked at, never visited
    expect(visitedFloors(town)).toEqual([1, 4]);
  });

  it('gives a run with no town a floor with no memory', () => {
    const run = createRun({ masterSeed: SEED, floor: 1, hero: makeHero() });
    expect(run.ex.explored.size).toBe(1);
    expect(run.floor.chests).toBeTruthy();
  });
});
