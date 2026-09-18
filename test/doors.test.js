/**
 * Door types, lock tiers and secret doors (`07` steps 5 and 6, `05` section 3
 * step 7, `03` section 6).
 *
 * The placement limits are the point: a door on the route can always be got
 * through, a barred door always has a way round, and a key is never behind the
 * door it opens.
 */
import { describe, it, expect } from 'vitest';
import {
  rollLockTier,
  capLock,
  isOnLoop,
  findDoors,
  describeDoors,
  tn,
  lockData,
} from '../src/dungeon/doors.js';
import { buildFloor, distancesFrom, isWalkable, TILE } from '../src/dungeon/floor-builder.js';
import { layoutStream, createStream } from '../src/engine/rng.js';
import { allFloorSpecs } from '../src/data/floors.js';

const SEED = 20260918;
const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);

describe('lock tiers', () => {
  it('bands d10 + F the way 03 section 6 does', () => {
    // 1-5 Simple, 6-11 Good, 12-15 Masterwork, 16+ Sealed.
    const band = (total) => lockData.lockTierRoll.bands.find((b) => total <= b.upTo).lock;
    expect([1, 3, 5].map(band)).toEqual(['simple', 'simple', 'simple']);
    expect([6, 9, 11].map(band)).toEqual(['good', 'good', 'good']);
    expect([12, 14, 15].map(band)).toEqual(['masterwork', 'masterwork', 'masterwork']);
    expect([16, 20].map(band)).toEqual(['sealed', 'sealed']);
  });

  it('gets harder the deeper the floor', () => {
    const sample = (floor) => {
      const rng = createStream('locks');
      const seen = [];
      for (let i = 0; i < 400; i += 1) seen.push(rollLockTier(rng, floor).lock);
      return seen.filter((lock) => lock === 'simple').length;
    };
    expect(sample(10)).toBeLessThan(sample(1));
  });

  it('never rolls outside the four locks', () => {
    const rng = createStream('range');
    for (let floor = 1; floor <= 10; floor += 1) {
      for (let i = 0; i < 200; i += 1) {
        expect(lockData.lockTierRoll.order).toContain(rollLockTier(rng, floor).lock);
      }
    }
  });

  it('works out the pick TN from the tier table', () => {
    // 03 section 2: Standard is 10 + F.
    expect(tn(lockData.tiers.standard.pickTn, 4)).toBe(14);
    expect(tn(lockData.tiers.masterwork.pickTn, 10)).toBe(23);
  });
});

describe('capping a lock', () => {
  it('leaves a lock that is already weak enough alone', () => {
    const simple = { lock: 'simple', tier: 'crude' };
    expect(capLock(simple, 'good')).toEqual(simple);
  });

  it('brings a stronger lock down to the cap', () => {
    const capped = capLock({ lock: 'sealed', tier: 'arcane' }, 'good');
    expect(capped.lock).toBe('good');
    expect(capped.tier).toBe('standard');
    expect(capped.capped).toBe(true);
  });
});

describe('loops', () => {
  it('sees a door with a way round', () => {
    // A ring of floor with a door in it: sealing the door changes nothing.
    const map = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 0, 4, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    expect(isOnLoop(map, [2, 3])).toBe(true);
  });

  it('sees a door that is the only way through', () => {
    const map = [
      [1, 1, 1, 1, 1],
      [1, 0, 4, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    expect(isOnLoop(map, [2, 1])).toBe(false);
  });

  it('is not fooled by a door against a wall', () => {
    const map = [
      [1, 1, 1],
      [1, 4, 1],
      [1, 1, 1],
    ];
    expect(isOnLoop(map, [1, 1])).toBe(false);
  });
});

describe('every floor gets its doors', () => {
  it.each(floors)('floor %i gives every door tile exactly one kind', (number, floor) => {
    const tiles = findDoors(floor.map);
    const described = Object.keys(floor.doors);
    // Every DOOR tile has an entry, and every entry is a DOOR tile or a secret.
    for (const [x, y] of tiles) expect(floor.doors[`${x},${y}`], `${x},${y}`).toBeTruthy();
    for (const key of described) {
      const [x, y] = key.split(',').map(Number);
      expect(floor.map[y][x]).toBe(TILE.DOOR);
    }
  });

  it.each(floors)('floor %i keeps the arena entrance open', (number, floor) => {
    // 05 section 5: one entrance door, never locked or trapped.
    const key = `${floor.arena.door[0]},${floor.arena.door[1]}`;
    expect(floor.doors[key].kind).toBe('open');
  });

  it.each(floors)('floor %i caps locked doors on the route at Good', (number, floor) => {
    // 05 section 3 step 7 states the cap on the "Stuck / Locked" row only, and
    // gives its reason as "so bashing always remains possible". A Keyed door is
    // a separate row: 03 section 6 sets its pick difficulty at Masterwork TN + 2
    // on purpose, and its guarantee is that the key is reachable first.
    const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
    for (const [key, door] of Object.entries(floor.doors)) {
      if (door.kind !== 'locked' || !onPath.has(key)) continue;
      expect(['simple', 'good'], `${key} is ${door.lock}`).toContain(door.lock);
    }
  });

  it.each(floors)('floor %i only bars or one-ways a door with a way round', (number, floor) => {
    for (const [key, door] of Object.entries(floor.doors)) {
      if (door.kind !== 'barred' && door.kind !== 'oneWay') continue;
      const [x, y] = key.split(',').map(Number);
      expect(isOnLoop(floor.map, [x, y]), `${key} has no way round`).toBe(true);
    }
  });

  it.each(floors)('floor %i never seals a door on the route', (number, floor) => {
    // 05 section 3 step 7: sealed doors are never on the critical path, and
    // only in front of a treasure room or the secret stash.
    const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
    const described = new Map(describeDoors(floor).map((d) => [d.key, d]));
    for (const [key, door] of Object.entries(floor.doors)) {
      if (door.kind !== 'sealed') continue;
      expect(onPath.has(key)).toBe(false);
      expect(described.get(key).fronts).toContain('treasure');
    }
  });

  it.each(floors)('floor %i puts keyed doors where the document allows', (number, floor) => {
    const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
    const described = new Map(describeDoors(floor).map((d) => [d.key, d]));
    for (const [key, door] of Object.entries(floor.doors)) {
      if (door.kind !== 'keyed') continue;
      const allowed = onPath.has(key) || described.get(key).fronts.includes('treasure');
      expect(allowed, `${key} is neither on the route nor in front of treasure`).toBe(true);
    }
  });

  it.each(floors)('floor %i only uses door kinds its depth allows', (number, floor) => {
    // 05 section 3 step 7: keyed 3+, sealed 5+, barred 3+, one-way 4+.
    const kinds = new Set(Object.values(floor.doors).map((door) => door.kind));
    const gate = { keyed: 3, sealed: 5, barred: 3, oneWay: 4 };
    for (const [kind, minFloor] of Object.entries(gate)) {
      if (kinds.has(kind)) expect(number, `${kind} on floor ${number}`).toBeGreaterThanOrEqual(minFloor);
    }
  });

  it.each(floors)('floor %i locks about the share 05 asks for', (number, floor) => {
    // 25% + 2% x F of all doors are stuck or locked.
    const total = Object.keys(floor.doors).length;
    const shut = Object.values(floor.doors).filter((d) => d.kind === 'stuck' || d.kind === 'locked').length;
    const wanted = total * floor.spec.rates.lockedDoors;
    expect(Math.abs(shut - wanted), `${shut} of ${total}`).toBeLessThanOrEqual(2);
  });
});

describe('keys', () => {
  it.each(floors)('floor %i leaves every key where it can be reached first', (number, floor) => {
    // 05 section 3 step 7. Seal every door that needs a key: each key must
    // still be reachable, or the floor cannot be finished.
    const needy = Object.values(floor.doors).filter((door) => door.needsKey);
    expect(Object.keys(floor.keys)).toHaveLength(needy.length);

    if (needy.length === 0) return;
    const sealed = floor.map.map((row) => [...row]);
    for (const door of needy) sealed[door.pos[1]][door.pos[0]] = TILE.WALL;
    const reach = distancesFrom(sealed, floor.start.pos);

    for (const key of Object.keys(floor.keys)) {
      const [x, y] = key.split(',').map(Number);
      expect(reach[y][x], `key at ${key} is behind a door it opens`).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(floors)('floor %i gives every key a door and every needy door a key', (number, floor) => {
    const doorKeys = new Set(
      Object.values(floor.doors).filter((d) => d.needsKey).map((d) => `${d.pos[0]},${d.pos[1]}`),
    );
    for (const entry of Object.values(floor.keys)) expect(doorKeys.has(entry.opens)).toBe(true);
    expect(new Set(Object.values(floor.keys).map((k) => k.id)).size).toBe(Object.keys(floor.keys).length);
  });
});

describe('secret doors', () => {
  it.each(floors)('floor %i has the 2 to 4 the documents call for', (number, floor) => {
    // 03 section 6 and 05 section 3 step 7.
    const count = Object.keys(floor.secrets).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(4);
  });

  it.each(floors)('floor %i puts every secret door on an ILLUSION tile', (number, floor) => {
    for (const key of Object.keys(floor.secrets)) {
      const [x, y] = key.split(',').map(Number);
      expect(floor.map[y][x], key).toBe(TILE.ILLUSION);
    }
  });

  it.each(floors)('floor %i never hides the route behind one', (number, floor) => {
    // 07 step 6: never leave an ILLUSION on the critical path.
    const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));
    for (const key of Object.keys(floor.secrets)) expect(onPath.has(key)).toBe(false);

    // And with every secret door treated as wall, the arena is still reachable.
    const blind = floor.map.map((row) => [...row]);
    for (const key of Object.keys(floor.secrets)) {
      const [x, y] = key.split(',').map(Number);
      blind[y][x] = TILE.WALL;
    }
    const reach = distancesFrom(blind, floor.start.pos);
    expect(reach[floor.arena.entrance[1]][floor.arena.entrance[0]]).toBeGreaterThan(0);
  });

  it.each(floors)('floor %i never leaves a stray ILLUSION lying about', (number, floor) => {
    // 07 step 6: the ones not worth keeping become wall.
    for (let y = 0; y < floor.height; y += 1) {
      for (let x = 0; x < floor.width; x += 1) {
        if (floor.map[y][x] === TILE.ILLUSION) expect(floor.secrets[`${x},${y}`], `${x},${y}`).toBeTruthy();
      }
    }
  });

  it.each(floors)('floor %i never gives one tile two kinds', (number, floor) => {
    for (const key of Object.keys(floor.secrets)) expect(floor.doors[key]).toBeUndefined();
  });

  it('seals the stash behind one, with a chamber to hold the chest', () => {
    const withStash = floors.map(([, floor]) => floor).filter((floor) => floor.secrets);
    const sealed = withStash.filter((floor) =>
      Object.values(floor.secrets).some((secret) => secret.kind === 'stash'),
    );
    expect(sealed.length).toBeGreaterThan(0);

    for (const floor of sealed) {
      const entry = Object.entries(floor.secrets).find(([, s]) => s.kind === 'stash');
      const [key, secret] = entry;
      const [dx, dy] = key.split(',').map(Number);
      const [cx, cy] = secret.chamber;

      expect(floor.map[dy][dx]).toBe(TILE.ILLUSION);
      expect(isWalkable(floor.map[cy][cx])).toBe(true);
      // The chamber is behind the door: wall the door and it is cut off.
      const blind = floor.map.map((row) => [...row]);
      blind[dy][dx] = TILE.WALL;
      expect(distancesFrom(blind, floor.start.pos)[cy][cx]).toBe(-1);
    }
  });
});

describe('across many seeds', () => {
  it('keeps every door rule for 15 seeds on every floor', () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      for (let number = 1; number <= 10; number += 1) {
        const floor = buildFloor(number, seed * 6151, layoutStream);
        const where = `seed ${seed}, floor ${number}`;
        const onPath = new Set(floor.criticalPath.map(([x, y]) => `${x},${y}`));

        for (const [key, door] of Object.entries(floor.doors)) {
          if (door.kind === 'locked' && onPath.has(key)) {
            expect(['simple', 'good'], `${where}: ${key}`).toContain(door.lock);
          }
          if (door.kind === 'barred' || door.kind === 'oneWay') {
            const [x, y] = key.split(',').map(Number);
            expect(isOnLoop(floor.map, [x, y]), `${where}: ${key}`).toBe(true);
          }
        }

        const secrets = Object.keys(floor.secrets).length;
        expect(secrets, `${where}: ${secrets} secret doors`).toBeGreaterThanOrEqual(2);
        expect(secrets, `${where}: ${secrets} secret doors`).toBeLessThanOrEqual(4);

        // The floor is still finishable with every secret door unfound and
        // every barred or one-way door shut.
        const worst = floor.map.map((row) => [...row]);
        for (const key of Object.keys(floor.secrets)) {
          const [x, y] = key.split(',').map(Number);
          worst[y][x] = TILE.WALL;
        }
        for (const door of Object.values(floor.doors)) {
          if (door.kind === 'barred' || door.kind === 'oneWay') worst[door.pos[1]][door.pos[0]] = TILE.WALL;
        }
        const reach = distancesFrom(worst, floor.start.pos);
        expect(reach[floor.arena.entrance[1]][floor.arena.entrance[0]], `${where}: arena`).toBeGreaterThan(0);
      }
    }
  });
});
