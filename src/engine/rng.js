/**
 * Seeded randomness. Every random outcome in the game comes from here, so the
 * same state plus the same action always gives the same result and reloading
 * can't change luck (`05` section 11, principle 2).
 *
 * **Never call `Math.random()` in game code.** The one exception is the
 * vendored floor generator, which calls it internally; `withRng()` in the floor
 * builder lends it the layout stream instead (`07` section 2). That is why a
 * stream is itself a function returning a float in [0, 1): it can be assigned
 * straight to `Math.random`.
 *
 * Five streams, so one system never shifts another's results (`05` section 11,
 * "Random Number Streams"):
 *
 * | Stream    | Used for                                   | Seeded from                |
 * | --------- | ------------------------------------------ | -------------------------- |
 * | layout    | Generating a floor                         | master seed + floor number |
 * | encounter | Wandering checks and encounter rolls       | master seed, then carried  |
 * | combat    | Attack rolls, damage, saves, AI choices    | master seed, then carried  |
 * | loot      | Drops, chest contents, properties, curses  | master seed, then carried  |
 * | restock   | Restocking floors                          | master seed + town visits  |
 *
 * Layout and restock are *derived*: they are rebuilt from the master seed and a
 * number whenever they are needed, so they are never saved. The other three are
 * *carried*: their state goes in the save file (`05` section 14).
 *
 * No DOM, no clock, no ambient state — this file is pure so the rules can be
 * tested in Node and replayed by the balance simulator.
 */

/** The carried streams, whose state is part of the save file. */
export const CARRIED_STREAMS = /** @type {const} */ (['encounter', 'combat', 'loot']);

/**
 * The derived streams, rebuilt from the master seed and a number.
 *
 * `05` section 11 names layout and restock; `creation` is the same shape and
 * was added for character creation, where the player may reroll the whole set
 * as often as they like (`01` section 3). The attempt number is that number,
 * so the tenth reroll of a seed is the tenth reroll of that seed for ever.
 */
export const DERIVED_STREAMS = /** @type {const} */ ([
  'layout',
  'restock',
  'creation',
  'appearance',
]);

/** 2^32, the divisor that turns a 32-bit word into a float in [0, 1). */
const TWO32 = 4294967296;

/**
 * Fresh state is stirred before first use, so two seeds that differ by one
 * don't start with visibly similar output.
 */
const WARMUP_DRAWS = 12;

/**
 * sfc32: small, fast, and good enough for a game, with exactly four words of
 * state — which is the shape `05` section 14 stores in the save file.
 *
 * The state lives in the caller's array and is updated in place, so a stream
 * can report it without the generator having to hand it back.
 * @param {number[]} words four state words, mutated on every draw
 * @returns {() => number} a float in [0, 1)
 */
function sfc32(words) {
  return function next() {
    let a = words[0] >>> 0;
    let b = words[1] >>> 0;
    let c = words[2] >>> 0;
    let d = words[3] >>> 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    words[0] = a >>> 0;
    words[1] = b >>> 0;
    words[2] = c >>> 0;
    words[3] = d >>> 0;
    return (t >>> 0) / TWO32;
  };
}

/**
 * xmur3: turns a string into a run of well-mixed 32-bit words, used to seed
 * sfc32. Without it, nearby seeds would produce nearby first draws.
 * @param {string} text
 */
function xmur3(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function nextWord() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * Builds four state words from any list of parts. The parts are joined, so
 * `seedState(123, 'layout', 4)` and `seedState(123, 'layout', 5)` are unrelated.
 * @param {...(string | number)} parts
 * @returns {[number, number, number, number]}
 */
export function seedState(...parts) {
  const word = xmur3(parts.join('|'));
  const state = [word(), word(), word(), word()];
  // All-zero state is the one input sfc32 cannot escape from. xmur3 will not
  // produce it, but a hand-written save might.
  if (state.every((n) => n === 0)) return [1, 2, 3, 4];
  return /** @type {[number, number, number, number]} */ (state);
}

/** @param {unknown} value @returns {value is [number, number, number, number]} */
export function isStreamState(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n < TWO32)
  );
}

/** Matches dice notation: `d20`, `2d6`, `1d6+3`, `3d8-1`. */
const DICE = /^(\d*)d(\d+)([+-]\d+)?$/i;

/**
 * A random stream.
 *
 * The stream is a function, so `Math.random = stream` works and the vendored
 * generator draws from it. The helpers hang off that function.
 *
 * @typedef {{
 *   (): number,
 *   label: string,
 *   state(): [number, number, number, number],
 *   int(n: number): number,
 *   range(min: number, max: number): number,
 *   die(sides: number): number,
 *   dice(count: number, sides: number): number,
 *   roll(notation: string): number,
 *   d20(options?: { advantage?: boolean, disadvantage?: boolean }): number,
 *   chance(probability: number): boolean,
 *   pick<T>(items: readonly T[]): T,
 *   shuffle<T>(items: readonly T[]): T[],
 * }} Stream
 */

/**
 * Creates a stream from four state words, or from anything `seedState` accepts.
 *
 * @param {[number, number, number, number] | string | number} seed
 *   four saved state words, or parts to seed from
 * @param {string} [name] the stream's label, used in error messages
 * @returns {Stream}
 */
export function createStream(seed, name = 'rng') {
  // A saved state resumes exactly where it left off; anything else is a seed,
  // and fresh seeds are stirred so that nearby seeds don't start alike.
  const resuming = isStreamState(seed);
  const words = resuming ? [...seed] : [...seedState(seed)];
  const next = sfc32(words);
  if (!resuming) for (let i = 0; i < WARMUP_DRAWS; i++) next();

  /** @type {any} */
  const stream = function draw() {
    return next();
  };

  // Not `name`: a function's own `name` property is read-only.
  stream.label = name;

  stream.state = () => /** @type {[number, number, number, number]} */ ([...words]);

  /**
   * A whole number from 0 to n − 1.
   * @param {number} n
   */
  stream.int = (n) => {
    if (!Number.isFinite(n) || n < 1) throw new RangeError(`${name}.int needs n >= 1, got ${n}`);
    return Math.floor(stream() * n);
  };

  /**
   * A whole number from min to max, both included.
   * @param {number} min @param {number} max
   */
  stream.range = (min, max) => {
    if (max < min) throw new RangeError(`${name}.range needs max >= min, got ${min}..${max}`);
    return min + stream.int(max - min + 1);
  };

  /**
   * One die: 1 to `sides`.
   * @param {number} sides
   */
  stream.die = (sides) => stream.range(1, sides);

  /**
   * The total of `count` dice of `sides`.
   * @param {number} count @param {number} sides
   */
  stream.dice = (count, sides) => {
    let total = 0;
    for (let i = 0; i < count; i++) total += stream.die(sides);
    return total;
  };

  /**
   * Dice notation as the rule documents write it: `d20`, `2d6`, `1d6+3`.
   * @param {string} notation
   */
  stream.roll = (notation) => {
    const match = DICE.exec(String(notation).trim());
    if (!match) throw new SyntaxError(`${name}.roll cannot read "${notation}"`);
    const count = match[1] === '' ? 1 : Number(match[1]);
    const sides = Number(match[2]);
    const modifier = match[3] ? Number(match[3]) : 0;
    if (count < 1 || sides < 1) throw new RangeError(`${name}.roll cannot read "${notation}"`);
    return stream.dice(count, sides) + modifier;
  };

  /**
   * The natural d20 for an attack, save, or check. One advantage and one
   * disadvantage cancel, and there is never more than one of each
   * (`06` section 6, step 5).
   *
   * Both dice are always drawn when they cancel out, so a cancelled pair costs
   * the same two draws however the code reached it, and a replay stays in step.
   * @param {{ advantage?: boolean, disadvantage?: boolean }} [options]
   */
  stream.d20 = ({ advantage = false, disadvantage = false } = {}) => {
    if (!advantage && !disadvantage) return stream.die(20);
    const first = stream.die(20);
    const second = stream.die(20);
    if (advantage && disadvantage) return first;
    return advantage ? Math.max(first, second) : Math.min(first, second);
  };

  /**
   * True with the given probability, as the rules write percentages
   * ("Blink: 50% chance the hit becomes a miss").
   * @param {number} probability 0 to 1
   */
  stream.chance = (probability) => stream() < probability;

  /**
   * One item, chosen evenly.
   * @template T @param {readonly T[]} items
   */
  stream.pick = (items) => {
    if (!items || items.length === 0) throw new RangeError(`${name}.pick needs a non-empty list`);
    return items[stream.int(items.length)];
  };

  /**
   * A shuffled copy, leaving the original alone.
   * @template T @param {readonly T[]} items
   */
  stream.shuffle = (items) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = stream.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  return /** @type {Stream} */ (stream);
}

/**
 * The layout stream for one floor. Derived, never saved: the same master seed
 * and floor number always rebuild the same floor.
 * @param {number} masterSeed
 * @param {number} floor
 * @param {number} [attempt] bumped when the solvability check fails and the
 *   floor is regenerated with `seed + 1` (`05` section 3)
 */
export function layoutStream(masterSeed, floor, attempt = 0) {
  return createStream(seedState(masterSeed, 'layout', floor, attempt), `layout:${floor}`);
}

/**
 * The restock stream for one return to town. Derived, never saved.
 *
 * A floor draws its own: `05` section 8 restocks *every* previously visited
 * floor on the same return, and each is entered at its own time, so keying
 * the stream by the floor as well as the visit keeps one floor's rolls out
 * of another's.
 * @param {number} masterSeed
 * @param {number} townVisits
 * @param {number} [floor] 0 for the shop's own stock, which is the town's
 */
export function restockStream(masterSeed, townVisits, floor = 0) {
  return createStream(
    seedState(masterSeed, 'restock', townVisits, floor),
    `restock:${townVisits}:${floor}`,
  );
}

/**
 * The stream a game's potion appearances and scroll titles are shuffled from
 * (`04` section 5). Derived, never saved: the save stores the shuffle
 * (`04` section 17), and this can always rebuild it from the seed alone.
 * @param {number} masterSeed
 */
export function appearanceStream(masterSeed) {
  return createStream(seedState(masterSeed, 'appearance'), 'appearance');
}

/**
 * The stream one roll of a new hero's attributes comes from. Derived, never
 * saved: the same seed and the same attempt always roll the same six numbers.
 * @param {number} masterSeed
 * @param {number} attempt how many times the player has rerolled
 */
export function creationStream(masterSeed, attempt = 0) {
  return createStream(seedState(masterSeed, 'creation', attempt), `creation:${attempt}`);
}

/**
 * The three carried streams, either fresh from the master seed or resumed from
 * a save.
 * @param {number} masterSeed
 * @param {Partial<Record<'encounter' | 'combat' | 'loot', unknown>>} [saved]
 *   the save file's `rng` block; anything missing or malformed starts fresh
 * @returns {Record<'encounter' | 'combat' | 'loot', Stream>}
 */
export function carriedStreams(masterSeed, saved) {
  const streams = /** @type {any} */ ({});
  for (const name of CARRIED_STREAMS) {
    const state = saved?.[name];
    streams[name] = isStreamState(state)
      ? createStream(state, name)
      : createStream(seedState(masterSeed, name), name);
  }
  return streams;
}

/**
 * The `rng` block for the save file: the current state of every carried stream.
 * @param {Record<string, Stream>} streams
 * @returns {Record<string, [number, number, number, number]>}
 */
export function serializeStreams(streams) {
  const out = /** @type {any} */ ({});
  for (const name of CARRIED_STREAMS) {
    if (streams[name]) out[name] = streams[name].state();
  }
  return out;
}
