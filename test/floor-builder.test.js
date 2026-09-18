/**
 * withRng and the first generator call (`07` sections 2 and 3).
 *
 * The point of the wrapper is that a floor rebuilds identically from its seed
 * (`05` section 11), so most of these tests are about reproducibility, and the
 * rest are about not leaving `Math.random` broken behind us.
 */
import { describe, it, expect, vi } from 'vitest';
import { withRng, generateLayout, TILE, DungeonGenerator } from '../src/dungeon/floor-builder.js';
import { layoutStream } from '../src/engine/rng.js';
import { floorSpec, allFloorSpecs } from '../src/data/floors.js';

describe('withRng', () => {
  it('lends the stream to Math.random for the length of the call', () => {
    const rng = () => 0.25;
    const seen = withRng(rng, () => [Math.random(), Math.random()]);
    expect(seen).toEqual([0.25, 0.25]);
  });

  it('puts the real Math.random back afterwards', () => {
    const real = Math.random;
    withRng(() => 0.5, () => Math.random());
    expect(Math.random).toBe(real);
  });

  it('puts it back even when the call throws', () => {
    const real = Math.random;
    expect(() => withRng(() => 0.5, () => {
      throw new Error('generation failed');
    })).toThrow('generation failed');
    expect(Math.random).toBe(real);
  });

  it('returns whatever the call returned', () => {
    expect(withRng(() => 0.5, () => 'floor 4')).toBe('floor 4');
  });

  it('nests without losing the outer stream', () => {
    const real = Math.random;
    const outer = () => 0.1;
    const inner = () => 0.9;
    const seen = withRng(outer, () => {
      const before = Math.random();
      const nested = withRng(inner, () => Math.random());
      return [before, nested, Math.random()];
    });
    expect(seen).toEqual([0.1, 0.9, 0.1]);
    expect(Math.random).toBe(real);
  });

  it('refuses anything that is not a stream, rather than silently not seeding', () => {
    const real = Math.random;
    expect(() => withRng(undefined, () => 1)).toThrow(TypeError);
    expect(() => withRng([1, 2, 3, 4], () => 1)).toThrow(TypeError);
    expect(Math.random).toBe(real);
  });

  it('actually reaches the vendored generator, which is the whole point', () => {
    // The generator calls Math.random 15 times over in its own source; if the
    // wrapper did not reach it, this spy would never fire.
    const rng = vi.fn(layoutStream(1, 1));
    withRng(rng, () => DungeonGenerator.generate(33, 33, { roomDensity: 0.13 }));
    expect(rng.mock.calls.length).toBeGreaterThan(100);
  });
});

describe('generateLayout', () => {
  it('builds a floor at the size the spec asks for', () => {
    const spec = floorSpec(1);
    const { map, rooms } = generateLayout(spec, layoutStream(123, 1));
    expect(map.length).toBe(spec.height);
    expect(map[0].length).toBe(spec.width);
    expect(rooms.length).toBeGreaterThan(0);
  });

  it('takes a floor number as readily as a spec', () => {
    const fromNumber = generateLayout(4, layoutStream(7, 4));
    const fromSpec = generateLayout(floorSpec(4), layoutStream(7, 4));
    expect(fromNumber.map).toEqual(fromSpec.map);
    expect(fromNumber.spec.id).toBe('fungal_caverns');
  });

  it('rebuilds the same floor from the same master seed and floor number', () => {
    // 05 section 1: the same seed always produces the same dungeon.
    const once = generateLayout(3, layoutStream(918273645, 3));
    const twice = generateLayout(3, layoutStream(918273645, 3));
    expect(twice.map).toEqual(once.map);
    expect(twice.rooms).toEqual(once.rooms);
  });

  it('gives different floors of one game different layouts', () => {
    const floor1 = generateLayout(1, layoutStream(42, 1));
    const floor2 = generateLayout(2, layoutStream(42, 2));
    // Same size on floors 1 and 2, so a matching map would mean the floor
    // number never reached the stream.
    expect(floor2.map).not.toEqual(floor1.map);
  });

  it('gives different games different floors', () => {
    const gameA = generateLayout(1, layoutStream(1000, 1));
    const gameB = generateLayout(1, layoutStream(1001, 1));
    expect(gameB.map).not.toEqual(gameA.map);
  });

  it('gives a regenerated floor a different layout', () => {
    // 05 section 3 step 10: a floor failing the solvability check is rebuilt.
    const first = generateLayout(5, layoutStream(500, 5, 0));
    const retry = generateLayout(5, layoutStream(500, 5, 1));
    expect(retry.map).not.toEqual(first.map);
  });

  it('leaves Math.random alone', () => {
    const real = Math.random;
    generateLayout(1, layoutStream(1, 1));
    expect(Math.random).toBe(real);
  });
});

describe('every floor generates', () => {
  it.each(allFloorSpecs().map((s) => [s.floor, s]))('floor %i', (floor, spec) => {
    const { map, rooms } = generateLayout(spec, layoutStream(20260918, floor));

    expect(map.length).toBe(spec.height);
    expect(map.every((row) => row.length === spec.width)).toBe(true);

    // Every tile is one the tile enum knows about (07 section 1).
    const known = new Set(Object.values(TILE));
    for (const row of map) for (const tile of row) expect(known.has(tile)).toBe(true);

    // A floor with no walkable space, or no rooms, would be unplayable.
    const walkable = map.flat().filter((t) => t === TILE.FLOOR).length;
    expect(walkable).toBeGreaterThan(spec.width * spec.height * 0.1);
    expect(rooms.length).toBeGreaterThan(0);
  });

  it('never places stairs itself: the floor builder does that', () => {
    // 07 section 1: STAIRS_DOWN / STAIRS_UP are placed by the floor builder.
    for (const spec of allFloorSpecs()) {
      const { map } = generateLayout(spec, layoutStream(5150, spec.floor));
      const tiles = new Set(map.flat());
      expect(tiles.has(TILE.STAIRS_DOWN)).toBe(false);
      expect(tiles.has(TILE.STAIRS_UP)).toBe(false);
    }
  });
});
