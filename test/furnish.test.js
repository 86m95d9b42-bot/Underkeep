/**
 * The rest of a floor's side tables (`07` section 1; `05` section 3 steps 8
 * and 9; `03` section 8).
 *
 * The counts come straight from the documents, and so do the places a thing may
 * not go: no trap by the stairs, in the Safe Room or next to where the hero
 * arrives, no spinner in a room, no darkness over more than a tenth of a floor.
 */
import { describe, it, expect } from 'vitest';
import { isArcane as isArcaneTrap, trap as trapSpec } from '../src/data/traps.js';
import { buildFloor, TILE, isWalkable, distancesFrom } from '../src/dungeon/floor-builder.js';
import { protectedTiles, everySlideEnds } from '../src/dungeon/furnish.js';
import { layoutStream } from '../src/engine/rng.js';
import { allFloorSpecs, hazardRules, chestDepthBonus, floorsData } from '../src/data/floors.js';
import { chanceOf } from '../src/systems/chests.js';

const SEED = 20260918;
const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);
const at = (pos) => `${pos[0]},${pos[1]}`;

/** Which room a tile sits in, if any. */
function roomAt(floor, [x, y]) {
  return floor.rooms.find((room) => {
    const [rx, ry, rw, rh] = room.rect;
    return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  });
}

describe('traps', () => {
  it.each(floors)('floor %i lays the 4 + F floor traps 05 asks for', (number, floor) => {
    // A Heat Vent is a theme feature that happens to be a trap (05 section 6),
    // so it is not one of the floor's own count.
    const laid = Object.values(floor.traps).filter((trap) => trap.on === 'floor' && !trap.feature);
    expect(laid).toHaveLength(floor.spec.counts.floorTraps);
  });

  it.each(floors)('floor %i keeps traps off the tiles that must stay clear', (number, floor) => {
    // 05 section 3 step 9: never on stairs, waystones, the Safe Room or the
    // arena, and never within 3 tiles of where the hero arrives.
    const off = protectedTiles(floor);
    for (const [where, trap] of Object.entries(floor.traps)) {
      if (trap.on !== 'floor') continue;
      expect(off.has(where), `${where} is out of bounds for a trap`).toBe(false);
    }

    const near = distancesFrom(floor.map, floor.start.pos);
    for (const trap of Object.values(floor.traps)) {
      if (trap.on !== 'floor') continue;
      expect(near[trap.pos[1]][trap.pos[0]], 'too close to arrival').toBeGreaterThan(3);
    }
  });

  it.each(floors)('floor %i puts every floor trap on a tile that can be stepped on', (number, floor) => {
    for (const trap of Object.values(floor.traps)) {
      if (trap.on !== 'floor') continue;
      expect(floor.map[trap.pos[1]][trap.pos[0]]).toBe(TILE.FLOOR);
    }
  });

  it.each(floors)('floor %i traps roughly one door in the documented share', (number, floor) => {
    // 1 in 6 doors, 1 in 4 from floor 6 down.
    const doorTraps = Object.values(floor.traps).filter((trap) => trap.on === 'door');
    const doors = Object.keys(floor.doors).length;
    const expected = doors / floor.spec.doorTrapOneIn;
    expect(Math.abs(doorTraps.length - expected)).toBeLessThan(Math.max(4, expected));
  });

  it.each(floors)('floor %i never allows an Arcane door trap on the route', (number, floor) => {
    // 05 section 3 step 9: doors on the critical path can't have Arcane traps.
    const onPath = new Set(floor.criticalPath.map(at));
    for (const [where, trap] of Object.entries(floor.traps)) {
      if (trap.on !== 'door') continue;
      if (onPath.has(where)) expect(trap.arcaneAllowed, where).toBe(false);
    }
  });

  it.each(floors)('floor %i never traps the arena entrance', (number, floor) => {
    // 05 section 5: its one door is never locked or trapped.
    expect(floor.traps[at(floor.arena.door)]).toBeUndefined();
  });

  it.each(floors)('floor %i starts every trap unfound and unsprung', (number, floor) => {
    for (const trap of Object.values(floor.traps)) {
      // A Heat Vent is visible from the start: 05 section 6 says it does not
      // need detecting, and that is what makes it timeable.
      if (trap.feature) continue;
      expect(trap.found).toBe(false);
      expect(trap.disarmed).toBe(false);
      expect(trap.sprung).toBe(false);
      expect(trap.searches).toEqual({ normal: false, careful: false });
    }
  });

  it.each(floors)('floor %i gives every trap a kind deep enough to be there', (number, floor) => {
    for (const entry of Object.values(floor.traps)) {
      const spec = trapSpec(entry.kind);
      expect([entry.kind, spec.placement]).toEqual([entry.kind, expect.arrayContaining([entry.on])]);
      expect([entry.kind, spec.minFloor <= number]).toEqual([entry.kind, true]);
      expect([entry.kind, spec.tiers]).toEqual([entry.kind, expect.arrayContaining([entry.tier])]);
    }
  });

  it.each(floors)('floor %i keeps Arcane door traps off the route (05 section 4)', (number, floor) => {
    for (const entry of Object.values(floor.traps)) {
      if (entry.on !== 'door' || entry.arcaneAllowed) continue;
      expect([entry.kind, isArcaneTrap(entry.kind, entry.tier)]).toEqual([entry.kind, false]);
    }
  });
});

describe('chests', () => {
  it.each(floors)('floor %i places the 3 + F/2 chests 05 asks for', (number, floor) => {
    // 05 section 3 step 9 counts the floor's own chests; a boss's chest is
    // "plus any placed by bosses or special rooms" (03 section 7).
    const own = Object.values(floor.chests).filter((chest) => !chest.boss);
    expect(own).toHaveLength(floor.spec.counts.chests);
  });

  it.each(floors)('floor %i prefers the places the document lists', (number, floor) => {
    // Dead ends, treasure rooms, lairs and the secret stash come first.
    const wanted = ['secretStash', 'treasure', 'lair', 'deadEnd'];
    const placed = Object.values(floor.chests);
    const preferred = placed.filter((chest) => wanted.includes(chest.where));
    expect(preferred.length, `${preferred.length} of ${placed.length} in a preferred spot`).toBeGreaterThanOrEqual(
      Math.min(placed.length, 3),
    );
  });

  it.each(floors)('floor %i never drops a chest on a trap or a protected tile', (number, floor) => {
    const off = protectedTiles(floor);
    for (const [where, chest] of Object.entries(floor.chests)) {
      expect(floor.traps[where], `${where} has a trap under it`).toBeUndefined();
      // The dragon's hoard is the exception: it belongs in the arena, which is
      // out of bounds to everything else (05 section 6).
      if (chest.boss) continue;
      expect(off.has(where), `${where} is out of bounds`).toBe(false);
    }
  });

  it.each(floors)('floor %i gives the deepest rooms their +2', (number, floor) => {
    // 05 section 3 step 9: the deepest 40% of rooms add +2.
    for (const chest of Object.values(floor.chests)) {
      expect([0, chestDepthBonus.bonus]).toContain(chest.depthBonus);
      if (!chest.room) expect(chest.depthBonus).toBe(0);
    }
  });

  it.each(floors)('floor %i gives every chest a lock it can describe', (number, floor) => {
    for (const chest of Object.values(floor.chests)) {
      // 03 section 7: the five things the chest panel can say about a lock.
      expect(['none', 'simple', 'good', 'masterwork', 'sealed']).toContain(chest.lock);
      // An unlocked chest has no lock to pick; a locked one always does.
      expect(chest.pickTn > 0).toBe(chest.lock !== 'none');
      expect(chest.opened).toBe(false);
      if (chest.trap) expect(chest.trap.sprung).toBe(false);
      if (floor.floor <= 4) expect(chest.mimic).toBe(false);
    }
  });

  it('locks and traps chests as often as 03 section 7 says', () => {
    // 30% + 5% F locked, 20% + 5% F trapped, so more of both as it deepens.
    // One floor of one seed is four chests, so this counts many seeds.
    const tally = (number) => {
      const counts = { chests: 0, locked: 0, trapped: 0, mimic: 0 };
      for (let seed = 1; seed <= 80; seed += 1) {
        const built = buildFloor(number, SEED + seed * 7919, layoutStream);
        for (const chest of Object.values(built.chests)) {
          counts.chests += 1;
          if (chest.lock !== 'none') counts.locked += 1;
          if (chest.trap) counts.trapped += 1;
          if (chest.mimic) counts.mimic += 1;
        }
      }
      return counts;
    };

    for (const number of [1, 5, 9]) {
      const counts = tally(number);
      for (const what of ['locked', 'trapped', 'mimic']) {
        const share = counts[what] / counts.chests;
        const wanted = chanceOf(what, number);
        expect(
          Math.abs(share - wanted),
          `floor ${number} ${what}: ${(share * 100).toFixed(0)}% against ${(wanted * 100).toFixed(0)}%`,
        ).toBeLessThan(0.06);
      }
    }
  });

  it.each(floors)('floor %i gives every chest its own id and tile', (number, floor) => {
    const ids = Object.values(floor.chests).map((chest) => chest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [where, chest] of Object.entries(floor.chests)) expect(at(chest.pos)).toBe(where);
  });

  it.each(floors)('floor %i puts at most one chest in a room', (number, floor) => {
    const rooms = Object.values(floor.chests).map((chest) => chest.room).filter(Boolean);
    expect(new Set(rooms).size).toBe(rooms.length);
  });
});

describe('hazards', () => {
  it.each(floors)('floor %i only uses hazards its depth allows', (number, floor) => {
    // 05 section 2 lists which hazards each floor may have, and section 6's
    // theme features bring their own: floor 4's Web Curtain, floor 5's
    // Flooded Corridor, floor 9's Frozen Lake.
    for (const hazard of Object.values(floor.hazards)) {
      if (hazard.feature) {
        expect(floor.spec.features, `${hazard.feature} on floor ${number}`).toContain(hazard.feature);
        continue;
      }
      expect(floor.spec.hazards, `${hazard.kind} on floor ${number}`).toContain(hazard.kind);
    }
  });

  it('gives floor 1 no hazards at all', () => {
    expect(Object.keys(floors[0][1].hazards)).toHaveLength(0);
  });

  it.each(floors)('floor %i keeps spinners in corridors, well clear of doors', (number, floor) => {
    // 05 section 3 step 8: corridors only, at least 5 tiles from stairs and doors.
    const landmarks = [
      floor.stairs.up,
      floor.stairs.down,
      ...Object.values(floor.doors).map((door) => door.pos).filter(Boolean),
    ];
    for (const hazard of Object.values(floor.hazards)) {
      if (hazard.kind !== 'spinner') continue;
      expect(roomAt(floor, hazard.pos), 'a spinner is in a room').toBeUndefined();
      for (const [lx, ly] of landmarks) {
        const gap = Math.abs(lx - hazard.pos[0]) + Math.abs(ly - hazard.pos[1]);
        expect(gap, `spinner ${at(hazard.pos)} is ${gap} from a landmark`).toBeGreaterThanOrEqual(
          hazardRules.spinner.minDistanceFromStairsAndDoors,
        );
      }
    }
  });

  it.each(floors)('floor %i keeps darkness under a tenth of the floor', (number, floor) => {
    const open = floor.map.flat().filter((tile) => tile === TILE.FLOOR).length;
    const dark = Object.values(floor.hazards).filter((h) => h.kind === 'dark_zone').length;
    expect(dark / open).toBeLessThanOrEqual(hazardRules.dark_zone.maxFloorTileShare);
  });

  it.each(floors)('floor %i keeps deep water on the route to three tiles', (number, floor) => {
    const onPath = new Set(floor.criticalPath.map(at));
    const wet = Object.values(floor.hazards).filter((h) => h.kind === 'deep_water');
    const onRoute = wet.filter((h) => onPath.has(at(h.pos)));
    expect(onRoute.length).toBeLessThanOrEqual(hazardRules.deep_water.maxRunOnCriticalPath);
  });

  it.each(floors)('floor %i sends every teleporter somewhere reachable', (number, floor) => {
    const reach = distancesFrom(floor.map, floor.start.pos);
    for (const hazard of Object.values(floor.hazards)) {
      if (hazard.kind !== 'teleporter_pad') continue;
      expect(hazard.destination).toBeTruthy();
      const [dx, dy] = hazard.destination;
      expect(reach[dy][dx], 'teleporter destination is out of reach').toBeGreaterThanOrEqual(0);
    }
  });

  it.each(floors)('floor %i keeps anti-magic out of the arena and Safe Room', (number, floor) => {
    const off = protectedTiles(floor);
    for (const [where, hazard] of Object.entries(floor.hazards)) {
      if (hazard.kind !== 'anti_magic_field') continue;
      expect(off.has(where), `${where} is in the arena or Safe Room`).toBe(false);
    }
  });

  it.each(floors)('floor %i never stacks a hazard on a trap or a chest', (number, floor) => {
    for (const where of Object.keys(floor.hazards)) {
      expect(floor.traps[where], `${where} has a trap`).toBeUndefined();
      expect(floor.chests[where], `${where} has a chest`).toBeUndefined();
    }
  });

  it('lets the hero off every ice tile it lays', () => {
    // 03 section 8: every ice room is guaranteed to have an exit.
    for (let seed = 1; seed <= 8; seed += 1) {
      const floor = buildFloor(9, seed * 4409, layoutStream);
      const ice = new Set(
        Object.entries(floor.hazards).filter(([, h]) => h.kind === 'ice_slide').map(([where]) => where),
      );
      if (ice.size === 0) continue;
      expect(everySlideEnds(floor, ice), `seed ${seed}`).toBe(true);
    }
  });

  it('spots an ice patch with no way off it', () => {
    // A closed box of ice: sliding any way only ever meets wall or more ice.
    const floor = {
      width: 5,
      height: 5,
      map: [
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1],
      ],
    };
    const allIce = new Set();
    for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) allIce.add(`${x},${y}`);
    expect(everySlideEnds(floor, allIce)).toBe(false);

    // Clearing the middle row gives every remaining ice tile a straight run
    // onto bare floor. Clearing only the centre would not: a slide travels in
    // a straight line, so the corners would still have nowhere to stop.
    const withLane = new Set(allIce);
    for (const tile of ['1,2', '2,2', '3,2']) withLane.delete(tile);
    expect(everySlideEnds(floor, withLane)).toBe(true);
  });
});

describe('lairs and curiosities', () => {
  it.each(floors)('floor %i gives every lair room a lair', (number, floor) => {
    const lairRooms = floor.rooms.filter((room) => room.role === 'lair');
    expect(Object.keys(floor.lairs)).toHaveLength(lairRooms.length);
    expect(Object.keys(floor.lairs)).toHaveLength(floor.spec.counts.lairs);
    for (const lair of Object.values(floor.lairs)) {
      // The encounter comes from the floor's table in Phase 3.
      expect(lair.encounter).toBeNull();
      expect(lair.cleared).toBe(false);
    }
  });

  it.each(floors)('floor %i puts one curiosity in each Curiosity Room', (number, floor) => {
    const rooms = floor.rooms.filter((room) => room.role === 'curiosity');
    // An Altar is an Offering Shrine in a Theme Room (05 section 6), so it is
    // a curiosity the Curiosity Rooms did not ask for.
    const own = Object.values(floor.curiosities).filter((one) => !one.feature);
    expect(own).toHaveLength(rooms.length);

    const used = new Set();
    for (const curiosity of own) {
      expect(floorsData.curiosities.kinds).toContain(curiosity.kind);
      expect(used.has(curiosity.room)).toBe(false);
      used.add(curiosity.room);
      expect(roomAt(floor, curiosity.pos).id).toBe(curiosity.room);
    }
  });
});

describe('the floor as a whole', () => {
  it.each(floors)('floor %i carries every side table 07 section 1 names', (number, floor) => {
    for (const table of ['doors', 'traps', 'chests', 'hazards', 'keys', 'lairs', 'secrets', 'curiosities']) {
      expect(floor[table], table).toBeTypeOf('object');
    }
    expect(floor.waystone).toBeTruthy();
    expect(floor.arena).toBeTruthy();
    // Both are left by play, not by generation (05 section 9).
    expect(floor.grave).toBeNull();
    expect(floor.returnMark).toBeNull();
  });

  it.each(floors)('floor %i keys every side table by its own tile', (number, floor) => {
    for (const table of ['traps', 'chests', 'hazards', 'curiosities']) {
      for (const [where, entry] of Object.entries(floor[table])) {
        expect(at(entry.pos), `${table}[${where}]`).toBe(where);
        const [x, y] = entry.pos;
        expect(isWalkable(floor.map[y][x]) || floor.map[y][x] === TILE.DOOR, `${table}[${where}]`).toBe(true);
      }
    }
  });

  it('builds the same side tables from the same seed', () => {
    const once = buildFloor(7, 5150, layoutStream);
    const twice = buildFloor(7, 5150, layoutStream);
    for (const table of ['traps', 'chests', 'hazards', 'lairs', 'curiosities']) {
      expect(twice[table], table).toEqual(once[table]);
    }
  });

  it('keeps every rule across 12 seeds on every floor', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (let number = 1; number <= 10; number += 1) {
        const floor = buildFloor(number, seed * 7717, layoutStream);
        const where = `seed ${seed}, floor ${number}`;
        const off = protectedTiles(floor);

        expect(
          Object.values(floor.traps).filter((t) => t.on === 'floor' && !t.feature),
          where,
        ).toHaveLength(
          floor.spec.counts.floorTraps,
        );
        expect(
          Object.values(floor.chests).filter((chest) => !chest.boss),
          where,
        ).toHaveLength(floor.spec.counts.chests);
        expect(Object.keys(floor.lairs), where).toHaveLength(floor.spec.counts.lairs);

        for (const tile of Object.keys(floor.traps)) {
          if (floor.traps[tile].on !== 'floor') continue;
          expect(off.has(tile), `${where}: trap at ${tile}`).toBe(false);
        }
        const open = floor.map.flat().filter((tile) => tile === TILE.FLOOR).length;
        const dark = Object.values(floor.hazards).filter((h) => h.kind === 'dark_zone').length;
        expect(dark / open, `${where}: darkness`).toBeLessThanOrEqual(
          hazardRules.dark_zone.maxFloorTileShare,
        );
        for (const hazard of Object.values(floor.hazards)) {
          if (hazard.feature) continue; // a theme feature brings its own
          expect(floor.spec.hazards, `${where}: ${hazard.kind}`).toContain(hazard.kind);
        }
      }
    }
  });
});
