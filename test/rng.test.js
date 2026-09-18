/**
 * Seeded randomness (`05` section 11, "Random Number Streams").
 *
 * The properties that matter are the ones the save rules lean on: the same
 * seed always replays, a saved stream resumes exactly, and drawing from one
 * stream never shifts another.
 */
import { describe, it, expect } from 'vitest';
import {
  createStream,
  seedState,
  isStreamState,
  layoutStream,
  restockStream,
  carriedStreams,
  serializeStreams,
  CARRIED_STREAMS,
} from '../src/engine/rng.js';

/** @param {import('../src/engine/rng.js').Stream} stream @param {number} n */
const draws = (stream, n) => Array.from({ length: n }, () => stream());

describe('a stream as a source of floats', () => {
  it('only ever returns a float in [0, 1), which is what Math.random promises', () => {
    const rng = createStream(42);
    for (let i = 0; i < 20000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('can stand in for Math.random, which is how the vendored generator is seeded', () => {
    // 07 section 2: withRng() assigns the layout stream to Math.random.
    const rng = createStream(1234);
    const real = Math.random;
    try {
      Math.random = rng;
      const borrowed = [Math.random(), Math.random(), Math.random()];
      expect(borrowed.every((n) => n >= 0 && n < 1)).toBe(true);
      expect(new Set(borrowed).size).toBe(3);
    } finally {
      Math.random = real;
    }
  });

  it('spreads its draws evenly enough to be worth trusting', () => {
    const rng = createStream('uniformity');
    const buckets = new Array(10).fill(0);
    const total = 100000;
    for (let i = 0; i < total; i++) buckets[Math.floor(rng() * 10)] += 1;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(total / 10 - 1200);
      expect(count).toBeLessThan(total / 10 + 1200);
    }
  });
});

describe('determinism', () => {
  it('replays the same sequence from the same seed', () => {
    expect(draws(createStream(918273645), 50)).toEqual(draws(createStream(918273645), 50));
  });

  it('gives unrelated sequences to seeds that differ by one', () => {
    const a = draws(createStream(1000), 20);
    const b = draws(createStream(1001), 20);
    expect(a).not.toEqual(b);
    // Not merely different: no shared prefix at all.
    expect(a[0]).not.toBeCloseTo(b[0], 3);
  });

  it('treats numbers and their text form as the same seed', () => {
    expect(draws(createStream(77), 5)).toEqual(draws(createStream('77'), 5));
  });
});

describe('saving and resuming', () => {
  it('reports four whole 32-bit words, which is what the save file stores', () => {
    const rng = createStream(5);
    draws(rng, 17);
    const state = rng.state();
    expect(isStreamState(state)).toBe(true);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('carries on from a saved state exactly where it left off', () => {
    const rng = createStream('resume');
    draws(rng, 33);
    const saved = rng.state();
    const rest = draws(rng, 25);
    expect(draws(createStream(saved), 25)).toEqual(rest);
  });

  it('is not disturbed by handing its state out', () => {
    const rng = createStream('peek');
    const state = rng.state();
    state[0] = 0;
    state[1] = 0;
    expect(rng.state()).not.toEqual(state);
  });

  it('survives a save taken mid-roll, which is what Ironman needs', () => {
    // 05 section 11: every random outcome is committed before it is shown, so
    // quitting mid-roll must change nothing.
    const rng = createStream('ironman');
    const before = rng.state();
    const outcome = rng.d20();
    const resumed = createStream(before);
    expect(resumed.d20()).toBe(outcome);
  });
});

describe('the five streams', () => {
  const masterSeed = 123456789;

  it('gives each stream a different sequence from the same master seed', () => {
    const streams = {
      ...carriedStreams(masterSeed),
      layout: layoutStream(masterSeed, 1),
      restock: restockStream(masterSeed, 0),
    };
    const firsts = Object.values(streams).map((s) => s());
    expect(new Set(firsts).size).toBe(5);
  });

  it('never lets one stream shift another', () => {
    const alone = carriedStreams(masterSeed);
    const withNoise = carriedStreams(masterSeed);
    // Hammer the other two streams, then check combat is untouched.
    draws(withNoise.loot, 500);
    draws(withNoise.encounter, 500);
    expect(draws(withNoise.combat, 10)).toEqual(draws(alone.combat, 10));
  });

  it("rebuilds a floor's layout stream from the master seed and floor number", () => {
    expect(draws(layoutStream(masterSeed, 4), 30)).toEqual(draws(layoutStream(masterSeed, 4), 30));
    expect(draws(layoutStream(masterSeed, 4), 5)).not.toEqual(draws(layoutStream(masterSeed, 5), 5));
  });

  it('changes the layout stream when a floor is regenerated', () => {
    // 05 section 3: a floor that fails the solvability check is regenerated.
    expect(draws(layoutStream(masterSeed, 4, 0), 5)).not.toEqual(
      draws(layoutStream(masterSeed, 4, 1), 5),
    );
  });

  it('gives each return to town its own restock stream', () => {
    expect(draws(restockStream(masterSeed, 7), 10)).toEqual(draws(restockStream(masterSeed, 7), 10));
    expect(draws(restockStream(masterSeed, 7), 5)).not.toEqual(draws(restockStream(masterSeed, 8), 5));
  });
});

describe("the save file's rng block", () => {
  const masterSeed = 999;

  it('holds exactly the three carried streams', () => {
    const streams = carriedStreams(masterSeed);
    const block = serializeStreams(streams);
    expect(Object.keys(block).sort()).toEqual([...CARRIED_STREAMS].sort());
    expect(block.layout).toBeUndefined();
  });

  it('resumes all three streams together', () => {
    const streams = carriedStreams(masterSeed);
    draws(streams.combat, 11);
    draws(streams.loot, 4);
    const block = serializeStreams(streams);

    const resumed = carriedStreams(masterSeed, block);
    for (const name of CARRIED_STREAMS) {
      expect(draws(resumed[name], 6)).toEqual(draws(streams[name], 6));
    }
  });

  it('starts a stream fresh when its saved state is missing or damaged', () => {
    const fresh = carriedStreams(masterSeed);
    const patched = carriedStreams(masterSeed, { combat: 'nonsense', loot: [1, 2, 3] });
    expect(draws(patched.combat, 5)).toEqual(draws(fresh.combat, 5));
    expect(draws(patched.loot, 5)).toEqual(draws(carriedStreams(masterSeed).loot, 5));
  });

  it('refuses a state that is not four whole 32-bit words', () => {
    expect(isStreamState([1, 2, 3, 4])).toBe(true);
    expect(isStreamState([1, 2, 3])).toBe(false);
    expect(isStreamState([1, 2, 3, 4.5])).toBe(false);
    expect(isStreamState([-1, 2, 3, 4])).toBe(false);
    expect(isStreamState([1, 2, 3, 2 ** 32])).toBe(false);
    expect(isStreamState(null)).toBe(false);
  });

  it('never seeds itself into the one state sfc32 cannot escape', () => {
    expect(seedState(0, 0)).not.toEqual([0, 0, 0, 0]);
    const stuck = createStream([0, 0, 0, 0]);
    // A hand-written all-zero save is accepted as a state, but must still move.
    expect(new Set(draws(stuck, 5)).size).toBeGreaterThan(1);
  });
});

describe('dice', () => {
  it('rolls a die inside its range, and reaches both ends', () => {
    const rng = createStream('d6');
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const value = rng.die(6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });

  it('reads the notation the rule documents use', () => {
    const rng = createStream('notation');
    for (let i = 0; i < 500; i++) {
      expect(rng.roll('d20')).toBeGreaterThanOrEqual(1);
      expect(rng.roll('d20')).toBeLessThanOrEqual(20);
      expect(rng.roll('2d6')).toBeGreaterThanOrEqual(2);
      expect(rng.roll('2d6')).toBeLessThanOrEqual(12);
      expect(rng.roll('1d6+3')).toBeGreaterThanOrEqual(4);
      expect(rng.roll('1d6+3')).toBeLessThanOrEqual(9);
      expect(rng.roll('3d8-1')).toBeGreaterThanOrEqual(2);
      expect(rng.roll('3d8-1')).toBeLessThanOrEqual(23);
    }
  });

  it('refuses notation it cannot read, rather than guessing', () => {
    const rng = createStream(1);
    expect(() => rng.roll('two d six')).toThrow(SyntaxError);
    expect(() => rng.roll('d')).toThrow(SyntaxError);
    expect(() => rng.roll('0d6')).toThrow(RangeError);
  });

  it('rolls an inclusive range', () => {
    const rng = createStream('range');
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(rng.range(3, 5));
    expect([...seen].sort()).toEqual([3, 4, 5]);
    expect(rng.range(7, 7)).toBe(7);
    expect(() => rng.range(5, 2)).toThrow(RangeError);
  });

  it('refuses an int count below one', () => {
    expect(() => createStream(1).int(0)).toThrow(RangeError);
  });
});

describe('the d20 with advantage and disadvantage', () => {
  it('takes the better of two with advantage, and the worse with disadvantage', () => {
    // 06 section 6, step 5. Compare against the same seed's raw pair.
    const pair = createStream('adv');
    const first = pair.die(20);
    const second = pair.die(20);

    expect(createStream('adv').d20({ advantage: true })).toBe(Math.max(first, second));
    expect(createStream('adv').d20({ disadvantage: true })).toBe(Math.min(first, second));
  });

  it('cancels one advantage against one disadvantage', () => {
    const rng = createStream('cancel');
    const value = rng.d20({ advantage: true, disadvantage: true });
    expect(value).toBe(createStream('cancel').die(20));
  });

  it('draws the same number of dice whether or not they cancel, so a replay stays in step', () => {
    const cancelled = createStream('steps');
    cancelled.d20({ advantage: true, disadvantage: true });
    const advantaged = createStream('steps');
    advantaged.d20({ advantage: true });
    expect(cancelled.state()).toEqual(advantaged.state());
  });

  it('stays inside 1 to 20 however it is rolled', () => {
    const rng = createStream('bounds');
    for (const options of [{}, { advantage: true }, { disadvantage: true }]) {
      for (let i = 0; i < 2000; i++) {
        const value = rng.d20(options);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('chance, pick, and shuffle', () => {
  it('is true about as often as it is asked to be', () => {
    const rng = createStream('blink');
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rng.chance(0.5)) hits += 1;
    expect(hits).toBeGreaterThan(9500);
    expect(hits).toBeLessThan(10500);
  });

  it('is never true at 0 and always true at 1', () => {
    const rng = createStream('edges');
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('picks every item eventually, and only real items', () => {
    const rng = createStream('pick');
    const items = ['rat', 'kobold', 'spider'];
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual([...items].sort());
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffles into a copy, keeping every item exactly once', () => {
    const rng = createStream('shuffle');
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(draws(createStream('s2'), 0)).toEqual([]);
    expect(createStream('same').shuffle(items)).toEqual(createStream('same').shuffle(items));
  });
});

describe('the rule that there is no other source of randomness', () => {
  // CLAUDE.md: "Never call Math.random() in game code." The vendored generator
  // is the one exception, and it is lent the layout stream by withRng().
  const ALLOWED = ['src/dungeon/dungeon-generator.js', 'src/dungeon/raycaster.js'];

  it('finds no Math.random anywhere in src/, outside the vendored modules', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join, relative } = await import('node:path');
    const root = new URL('../src', import.meta.url).pathname;

    /** @param {string} dir @returns {Promise<string[]>} */
    const walk = async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      const found = await Promise.all(
        entries.map((entry) => {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) return walk(path);
          return entry.name.endsWith('.js') ? [path] : [];
        }),
      );
      return found.flat();
    };

    const offenders = [];
    for (const file of await walk(root)) {
      const where = `src/${relative(root, file)}`;
      if (ALLOWED.includes(where)) continue;
      const source = await readFile(file, 'utf8');
      // The rng module names it in prose and in the test for standing in for it.
      const uses = source.split('\n').filter(
        (line) => line.includes('Math.random') && !line.trimStart().startsWith('*'),
      );
      if (uses.length) offenders.push(`${where}: ${uses.join(' / ').trim()}`);
    }
    expect(offenders).toEqual([]);
  });
});
