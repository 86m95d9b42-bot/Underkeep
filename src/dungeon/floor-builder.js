/**
 * Floor builder: everything Underkeep adds on top of the vendored generator
 * (`07` section 3). This file starts with the piece the rest depends on —
 * lending the generator a seeded stream.
 *
 * No DOM here. The builder takes a floor spec and a stream and returns a floor.
 */
import DungeonGenerator from './dungeon-generator.js';
import { floorSpec } from '../data/floors.js';

export { DungeonGenerator };
export const TILE = DungeonGenerator.TILE;

/**
 * Runs `fn` with `Math.random` replaced by a seeded stream.
 *
 * The vendored generator calls `Math.random()` internally, and Underkeep needs
 * floors to rebuild identically from a seed (`05` section 11). Rather than fork
 * the file, the call is borrowed for the length of one generation
 * (`07` section 2).
 *
 * `Math.random` is always put back, including when `fn` throws, and nesting is
 * safe because each call restores whatever it found rather than the real one.
 * This is the only place in the game that touches `Math.random` at all.
 *
 * @template T
 * @param {() => number} rng a seeded stream, which is itself a function
 * @param {() => T} fn
 * @returns {T}
 */
export function withRng(rng, fn) {
  if (typeof rng !== 'function') throw new TypeError('withRng needs a stream function');
  const real = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

/**
 * Runs the vendored generator for one floor, drawing every number from the
 * floor's layout stream. This is step 1 of `07` section 3; the rest of the
 * builder works on what it returns.
 *
 * @param {import('../data/floors.js').FloorSpec | number} floorOrSpec
 * @param {() => number} layoutRng the floor's layout stream
 * @returns {{ map: number[][], rooms: { x: number, y: number, w: number, h: number, cx: number, cy: number }[], spec: import('../data/floors.js').FloorSpec }}
 */
export function generateLayout(floorOrSpec, layoutRng) {
  const spec = typeof floorOrSpec === 'number' ? floorSpec(floorOrSpec) : floorOrSpec;
  const { map, rooms } = withRng(layoutRng, () =>
    DungeonGenerator.generate(spec.width, spec.height, { roomDensity: spec.roomDensity }),
  );
  return { map, rooms, spec };
}
