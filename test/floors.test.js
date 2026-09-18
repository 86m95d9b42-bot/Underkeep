/**
 * Floor specifications. Every expected value here is read straight off the
 * tables in `05` sections 2, 3, 5 and 6, so the test fails if the data drifts
 * from the documents.
 */
import { describe, it, expect } from 'vitest';
import {
  floorSpec,
  allFloorSpecs,
  hazardAllowed,
  roomDensityFor,
  pacing,
  bossArena,
  hazardRules,
  chestDepthBonus,
  criticalPathMaxLockTier,
  FLOOR_COUNT,
} from '../src/data/floors.js';

/** The floor specification table, copied from `05` section 2. */
const TABLE = [
  [1, 'The Cellars', 33, [8, 10], [], ['wine_rack']],
  [2, 'The Old Crypt', 33, [8, 10], ['spinner'], ['sarcophagus']],
  [3, 'Goblin Warrens', 33, [9, 11], ['spinner'], ['goblin_camp']],
  [4, 'Fungal Caverns', 41, [10, 12], ['spinner', 'dark_zone'], ['glowcap_room', 'web_curtain']],
  [5, 'The Drowned Halls', 41, [10, 12], ['spinner', 'dark_zone', 'deep_water', 'teleporter_pad'], ['flooded_corridor']],
  [6, 'Sanctum of the Pale Flame', 41, [11, 13], ['spinner', 'dark_zone', 'deep_water', 'teleporter_pad', 'anti_magic_field'], ['altar']],
  [7, 'The Iron Forge', 41, [11, 13], ['spinner', 'dark_zone', 'deep_water', 'teleporter_pad', 'anti_magic_field'], ['lava_channel', 'heat_vent']],
  [8, 'The Silent Library', 49, [12, 14], ['spinner', 'dark_zone', 'deep_water', 'teleporter_pad', 'anti_magic_field'], ['bookshelf']],
  [9, 'The Frozen Deep', 49, [12, 14], ['spinner', 'dark_zone', 'deep_water', 'teleporter_pad', 'anti_magic_field', 'ice_slide'], ['frozen_lake']],
  [10, 'The Ashen Lair', 49, [12, 15], ['spinner', 'dark_zone', 'deep_water', 'teleporter_pad', 'anti_magic_field', 'ice_slide'], ['ash_pit', 'dragon_hoard']],
];

describe('the floor table', () => {
  it('has the ten floors the game is made of', () => {
    expect(FLOOR_COUNT).toBe(10);
    expect(allFloorSpecs().map((s) => s.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each(TABLE)('floor %i matches the table in 05 section 2', (floor, theme, grid, rooms, hazards, features) => {
    const spec = floorSpec(floor);
    expect(spec.theme).toBe(theme);
    expect(spec.width).toBe(grid);
    expect(spec.height).toBe(grid);
    expect(spec.rooms).toEqual(rooms);
    expect([...spec.hazards].sort()).toEqual([...hazards].sort());
    expect(spec.features).toEqual(features);
  });

  it('uses odd grid sizes, so maze carving lines up', () => {
    for (const spec of allFloorSpecs()) expect(spec.width % 2).toBe(1);
  });

  it('gives every floor its own id and theme', () => {
    const specs = allFloorSpecs();
    expect(new Set(specs.map((s) => s.id)).size).toBe(FLOOR_COUNT);
    expect(new Set(specs.map((s) => s.theme)).size).toBe(FLOOR_COUNT);
  });

  it('only ever adds hazards as the floors get deeper', () => {
    // 05 section 2 writes the deeper floors as "+ X" and "All above".
    const specs = allFloorSpecs();
    for (let i = 1; i < specs.length; i++) {
      for (const hazard of specs[i - 1].hazards) {
        expect(specs[i].hazards, `floor ${i + 1} dropped ${hazard}`).toContain(hazard);
      }
    }
  });

  it('refuses a floor that does not exist', () => {
    expect(() => floorSpec(0)).toThrow(RangeError);
    expect(() => floorSpec(11)).toThrow(RangeError);
    expect(() => floorSpec(2.5)).toThrow(RangeError);
  });

  it('hands out copies, so a caller cannot edit the table', () => {
    const spec = floorSpec(1);
    spec.hazards.push('lava');
    spec.rooms[0] = 99;
    expect(floorSpec(1).hazards).toEqual([]);
    expect(floorSpec(1).rooms).toEqual([8, 10]);
  });
});

describe('counts the documents give as formulas', () => {
  it('places 2 + floor(F / 2) lairs', () => {
    // 05 section 3 step 6.
    expect(allFloorSpecs().map((s) => s.counts.lairs)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);
  });

  it('places 3 + floor(F / 2) chests', () => {
    // 05 section 3 step 9.
    expect(allFloorSpecs().map((s) => s.counts.chests)).toEqual([3, 4, 4, 5, 5, 6, 6, 7, 7, 8]);
  });

  it('places 4 + F floor traps', () => {
    // 05 section 3 step 9.
    expect(allFloorSpecs().map((s) => s.counts.floorTraps)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('locks 25% + 2% x F of doors', () => {
    // 05 section 3 step 7.
    expect(floorSpec(1).rates.lockedDoors).toBeCloseTo(0.27, 10);
    expect(floorSpec(10).rates.lockedDoors).toBeCloseTo(0.45, 10);
  });

  it('traps 1 door in 6, and 1 in 4 from floor 6 down', () => {
    // 05 section 3 step 9.
    expect(allFloorSpecs().map((s) => s.doorTrapOneIn)).toEqual([6, 6, 6, 6, 6, 4, 4, 4, 4, 4]);
  });

  it('sets the Web Curtain bash TN at 10 + F', () => {
    // 05 section 3 step 8.
    expect(floorSpec(4).webCurtainBashTn).toBe(14);
    expect(floorSpec(10).webCurtainBashTn).toBe(20);
  });
});

describe('special doors', () => {
  it('only offers a door kind on the floors that allow it', () => {
    // 05 section 3 step 7: keyed 3+, sealed 5+, barred 3+, one-way 4+, secret 1+.
    const on = (kind) =>
      allFloorSpecs()
        .filter((s) => s.specialDoors[kind])
        .map((s) => s.floor);
    expect(on('keyed')).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(on('sealed')).toEqual([5, 6, 7, 8, 9, 10]);
    expect(on('barred')).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(on('oneWay')).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(on('secret')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps each kind to the count the document gives', () => {
    const spec = floorSpec(10);
    expect(spec.specialDoors.keyed.count).toEqual([0, 2]);
    expect(spec.specialDoors.sealed.count).toEqual([0, 1]);
    expect(spec.specialDoors.barred.count).toEqual([0, 2]);
    expect(spec.specialDoors.oneWay.count).toEqual([0, 2]);
    expect(spec.specialDoors.secret.count).toEqual([2, 4]);
  });

  it('caps critical-path locks at Good, so bashing always remains possible', () => {
    expect(criticalPathMaxLockTier).toBe('good');
  });

  it('keeps the _source notes out of the resolved spec', () => {
    expect(floorSpec(1).specialDoors._source).toBeUndefined();
    expect(Object.keys(floorSpec(1).specialDoors)).toEqual(['secret']);
  });
});

describe('the boss arena', () => {
  it('is 9 x 9, and 11 x 11 on floor 10', () => {
    // 05 section 5.
    expect(allFloorSpecs().map((s) => s.arenaSize)).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9, 11]);
  });

  it('has one entrance, never locked or trapped', () => {
    expect(bossArena.entrances).toBe(1);
    expect(bossArena.entranceNeverLockedOrTrapped).toBe(true);
  });

  it('keeps the arena and Safe Room out of the wandering monster clock', () => {
    // 05 section 5, last bullet.
    expect(bossArena.wanderingChecksInArena).toBe(false);
    expect(bossArena.safeRoom.wanderingChecks).toBe(false);
    expect(bossArena.safeRoom.campingInterrupted).toBe(false);
    expect(bossArena.safeRoom.trapsOrHazards).toBe(false);
  });
});

describe('pacing targets', () => {
  it('matches the table in 05 section 2', () => {
    expect(pacing.criticalPathSteps).toEqual([150, 300]);
    expect(pacing.fullClearSteps).toEqual([600, 1000]);
    expect(pacing.hollowStalkerSteps).toBe(1500);
  });

  it('puts the Hollow Stalker well past a full clear', () => {
    expect(pacing.hollowStalkerSteps).toBeGreaterThan(pacing.fullClearSteps[1]);
  });
});

describe('hazard placement rules', () => {
  it('matches 05 section 3 step 8', () => {
    expect(hazardRules.spinner.corridorsOnly).toBe(true);
    expect(hazardRules.spinner.minDistanceFromStairsAndDoors).toBe(5);
    expect(hazardRules.dark_zone.maxFloorTileShare).toBe(0.1);
    expect(hazardRules.deep_water.maxRunOnCriticalPath).toBe(3);
    expect(hazardRules.anti_magic_field.neverIn).toEqual(['bossArena', 'safeRoom']);
    expect(hazardRules.ice_slide.roomsOnly).toBe(true);
  });

  it('names a rule for every hazard any floor can use', () => {
    const used = new Set(allFloorSpecs().flatMap((s) => s.hazards));
    for (const hazard of used) expect(Object.keys(hazardRules)).toContain(hazard);
  });

  it('only allows ice slides on floor 9 and below', () => {
    // 05 section 6: the Ice Slide is introduced on floor 9.
    expect(hazardAllowed(8, 'ice_slide')).toBe(false);
    expect(hazardAllowed(9, 'ice_slide')).toBe(true);
    expect(hazardAllowed(10, 'ice_slide')).toBe(true);
  });

  it('gives the deepest rooms their chest bonus', () => {
    // 05 section 3 step 9.
    expect(chestDepthBonus.deepestShare).toBe(0.4);
    expect(chestDepthBonus.bonus).toBe(2);
  });
});

describe('room density for the vendored generator', () => {
  it('asks for about as many rooms as the floor wants', () => {
    // 07 / dungeon-generator.js: maxRooms = floor(w * h * 0.08 * roomDensity).
    for (const spec of allFloorSpecs()) {
      const maxRooms = Math.floor(spec.width * spec.height * 0.08 * spec.roomDensity);
      expect(maxRooms, `floor ${spec.floor}`).toBe(spec.rooms[1]);
    }
  });

  it('round-trips for any grid and room count, never one room short', () => {
    for (const grid of [33, 41, 49]) {
      for (let wanted = 4; wanted <= 20; wanted++) {
        const density = roomDensityFor(grid, wanted);
        expect(Math.floor(grid * grid * 0.08 * density), `${grid} / ${wanted}`).toBe(wanted);
      }
    }
  });
});
