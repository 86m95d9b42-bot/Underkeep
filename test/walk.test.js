/**
 * Phase 2's "done when": every floor from a seed can be walked from arrival to
 * the boss arena.
 *
 * `npm run walk` does this over many seeds; these are the few that run on
 * every change, so the walk cannot quietly break. The walking itself is the
 * game's own code — `createRun`, the six movement keys, the context key — so a
 * failure here is a failure a player would meet.
 */
import { describe, it, expect } from 'vitest';
import { walkFloor } from '../tools/lib/walker.js';
import { FLOOR_COUNT } from '../src/data/floors.js';

/**
 * What the hero adds to a bash: Might modifier + Brute Force + crowbar
 * (`03` section 6). A hero deep in the dungeon has this and more; the stand-in
 * hero of Phase 2 has none of it, which is why the deep floors are checked
 * with a bonus and the early ones without (docs/DECISIONS.md).
 */
const DEEP_HERO = { bashBonus: 8 };

const SEEDS = [7932, 15851, 23770];
const cases = SEEDS.flatMap((seed) =>
  Array.from({ length: FLOOR_COUNT }, (_, i) => [seed, i + 1]),
);

describe('walking a floor from arrival to the boss arena', () => {
  it.each(cases)('seed %i floor %i', (seed, floorNumber) => {
    const result = walkFloor(seed, floorNumber, DEEP_HERO);
    expect(result.ok, result.why).toBe(true);
    expect(result.run.ex.pos).toEqual(result.run.floor.arena.door);
  });

  it('walks the early floors with the hero the game has today', () => {
    // No Might modifier, no Brute Force, no crowbar: the stand-in hero until
    // Phase 4. Floors 1-3 are still walkable, which is what a player can try
    // on a phone right now.
    for (const seed of SEEDS) {
      for (const floorNumber of [1, 2, 3]) {
        const result = walkFloor(seed, floorNumber, { bashBonus: 0 });
        expect(result.ok, `seed ${seed} floor ${floorNumber}: ${result.why}`).toBe(true);
      }
    }
  });

  it('spends the step clock as it goes, and rolls for wandering monsters', () => {
    const result = walkFloor(SEEDS[0], 4, DEEP_HERO);
    expect(result.steps).toBeGreaterThan(100);
    // A d6 every ten steps (`01` section 9).
    expect(result.run.ex.checks).toBeGreaterThan(result.steps / 20);
  });

  it('remembers where it has been, so the automap has something to draw', () => {
    const result = walkFloor(SEEDS[0], 2, DEEP_HERO);
    expect(result.run.ex.explored.size).toBeGreaterThan(40);
    expect(result.run.ex.seen.size).toBeGreaterThan(result.run.ex.explored.size);
  });
});
