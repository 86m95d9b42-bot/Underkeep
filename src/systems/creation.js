/**
 * Making a hero (`01` section 3, Character Creation and Origins).
 *
 * Two modes, both of them the document's:
 *
 *   - **Classic (hard):** 3d6 for each attribute *in order*. The player may
 *     reroll the whole set as often as they like, but cannot rearrange.
 *   - **Standard:** 4d6 drop the lowest, six times, assigned freely.
 *
 * Every roll comes from the **creation** stream, derived from the master seed
 * and the attempt number, so the tenth reroll of a seed is the tenth reroll of
 * that seed for ever and a screenshot of a hero can be reproduced.
 *
 * A draft is a plain object the screens read and write through these
 * functions; `finish` turns one into the hero the game carries. No DOM.
 */
import { ATTRIBUTE_ORDER, CREATION, MAX_AT_CREATION, modsFor } from '../data/attributes.js';
import { grantsOf, ORIGIN_ORDER } from '../data/origins.js';
import { equipKit, kitOf } from './kit.js';
import { creationStream } from '../engine/rng.js';
import { derivedFor } from './derived.js';
import { grantFree } from './skill-tree.js';
import { rebuildSheet } from './levelling.js';
import { createIdentification, identify } from './identification.js';
import { LEVELING } from '../data/attributes.js';

/** The two modes, and the one the New Game screen starts on. */
export const ROLL_MODES = Object.keys(CREATION.modes);
export const DEFAULT_ROLL_MODE = CREATION.default;

/** The two ways a run can end, offered on the New Game screen. */
export const MODES = /** @type {const} */ (['adventurer', 'ironman']);

/** The three difficulty settings (`06` section 11), chosen once per run. */
export const DIFFICULTIES = /** @type {const} */ (['easy', 'normal', 'hard']);

/** How long a name may be, so it fits the sheet and the Hall of the Dead. */
export const NAME_LIMIT = 16;

/**
 * A fresh master seed.
 *
 * This is the one number in the game that is not itself seeded: every roll
 * afterwards comes from it, so the run is reproducible from the number the
 * player can read on the New Game screen (`05` section 11).
 */
export function newSeed() {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
  /* c8 ignore next -- only where crypto is missing */
  return Date.now() % 4294967296;
}

/** The seed a player typed: a number when it reads as one, the text otherwise. */
export function seedFrom(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/**
 * One attribute's roll under a mode.
 *
 * Classic is 3d6. Standard rolls 4d6 and drops the lowest, which the document
 * writes as one step, so both dice and the drop come from the same rule.
 *
 * @param {import('../engine/rng.js').Stream} rng
 * @param {object} rule one of `CREATION.modes`
 * @returns {{ total: number, dice: number[], dropped?: number }}
 */
export function rollOne(rng, rule) {
  const match = /^(\d+)d(\d+)$/.exec(rule.roll);
  if (!match) throw new SyntaxError(`cannot read a creation roll of "${rule.roll}"`);
  const [, count, sides] = match;
  const dice = [];
  for (let i = 0; i < Number(count); i += 1) dice.push(rng.die(Number(sides)));

  const kept = [...dice].sort((a, b) => a - b);
  const dropped = [];
  for (let i = 0; i < (rule.dropLowest ?? 0); i += 1) dropped.push(kept.shift());

  return {
    total: kept.reduce((sum, die) => sum + die, 0),
    dice,
    ...(dropped.length ? { dropped } : {}),
  };
}

/**
 * Six rolls, in the order `01` section 3 lists the attributes.
 * @param {number} masterSeed
 * @param {string} mode `classic` or `standard`
 * @param {number} attempt
 */
export function rollSet(masterSeed, mode = DEFAULT_ROLL_MODE, attempt = 0) {
  const rule = CREATION.modes[mode];
  if (!rule) throw new Error(`unknown roll mode: ${mode}`);
  const rng = creationStream(masterSeed, attempt);

  const rolls = ATTRIBUTE_ORDER.map((id) => ({ id, ...rollOne(rng, rule) }));
  const scores = /** @type {any} */ ({});
  for (const roll of rolls) {
    // 3d6 and 4d6-drop-one both stay inside 3-18, which is the document's
    // natural maximum at creation; the clamp says so rather than assuming it.
    scores[roll.id] = Math.min(MAX_AT_CREATION, roll.total);
  }
  return { scores, rolls };
}

/**
 * @typedef {object} Draft
 * @property {number} seed
 * @property {'adventurer' | 'ironman'} mode
 * @property {'easy' | 'normal' | 'hard'} difficulty
 * @property {string} rollMode
 * @property {number} attempt
 * @property {Record<string, number>} scores
 * @property {object[]} rolls
 * @property {string | null} origin
 * @property {string} name
 */

/**
 * A new hero in progress. The New Game screen chooses the seed, the mode, the
 * difficulty and the roll style; Create: Attributes rolls and arranges; Create:
 * Origin names and picks.
 *
 * @param {object} options
 * @returns {Draft}
 */
export function createDraft({
  seed,
  mode = MODES[0],
  difficulty = 'normal',
  rollMode = DEFAULT_ROLL_MODE,
  attempt = 0,
} = {}) {
  const { scores, rolls } = rollSet(seed, rollMode, attempt);
  return {
    seed,
    mode: MODES.includes(mode) ? mode : MODES[0],
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    rollMode,
    attempt,
    scores,
    rolls,
    origin: null,
    name: '',
  };
}

/**
 * Rolls the whole set again. `01` section 3 allows this "as many times as they
 * like", and the attempt number is what keeps each one reproducible.
 * @param {Draft} draft
 */
export function reroll(draft) {
  const attempt = draft.attempt + 1;
  const { scores, rolls } = rollSet(draft.seed, draft.rollMode, attempt);
  return { ...draft, attempt, scores, rolls };
}

/** True while this mode lets the player move scores around (Standard only). */
export function canRearrange(draft) {
  return Boolean(CREATION.modes[draft.rollMode]?.rearrange);
}

/**
 * Swaps two attributes' scores. Classic rolls in order and cannot rearrange,
 * so it refuses.
 * @param {Draft} draft @param {string} a @param {string} b
 */
export function swap(draft, a, b) {
  if (!canRearrange(draft)) return draft;
  if (!ATTRIBUTE_ORDER.includes(a) || !ATTRIBUTE_ORDER.includes(b) || a === b) return draft;
  const scores = { ...draft.scores, [a]: draft.scores[b], [b]: draft.scores[a] };
  return { ...draft, scores };
}

/** Picks an origin, or clears it. */
export function chooseOrigin(draft, id) {
  if (id !== null && !ORIGIN_ORDER.includes(id)) return draft;
  return { ...draft, origin: id };
}

/** Sets the name, trimmed to what the sheet can show. */
export function setName(draft, name) {
  return { ...draft, name: String(name ?? '').slice(0, NAME_LIMIT) };
}

/**
 * What the Create: Attributes screen previews — HP, Focus and Defense — and
 * what the Create: Origin screen previews once an origin is chosen, since its
 * +1 can move all three (`00`, Create: Attributes).
 * @param {Draft} draft
 */
export function previewOf(draft) {
  const scores = draft.origin ? grantsOf(draft.scores, draft.origin).attributes : draft.scores;
  // Once an origin is picked its armour counts, which is part of what the
  // choice is (`01` section 3).
  const gear = draft.origin ? (kitOf(draft.origin).armor?.def ?? 0) : 0;
  const derived = derivedFor(scores, { gear });
  return { scores, mods: modsFor(scores), hp: derived.maxHp, fp: derived.maxFp, def: derived.def };
}

/** Why the draft cannot be finished yet, or null when it can. */
export function whyNotReady(draft) {
  if (!draft.origin) return 'noOrigin';
  if (!draft.name.trim()) return 'noName';
  return null;
}

/**
 * Turns a finished draft into the hero the game carries.
 *
 * The origin's free skill is learned here — it costs nothing and counts
 * towards nothing (`01` section 3) — and the kit comes back as it is, because
 * the pack that would take it is `04` and Phase 5.
 *
 * @param {Draft} draft
 */
export function finish(draft) {
  const why = whyNotReady(draft);
  if (why) throw new Error(`the hero is not ready: ${why}`);

  const grants = grantsOf(draft.scores, draft.origin);
  // `01` section 3 hands the kit over at creation, and its armour is part of
  // DEF from the first step (`01` section 4: 10 + AGI mod + armor).
  const worn = kitOf(draft.origin);
  const derived = derivedFor(grants.attributes, { gear: worn.armor?.def ?? 0 });

  const hero = {
    name: draft.name.trim(),
    origin: draft.origin,
    level: 1,
    xp: 0,
    attributes: grants.attributes,
    mods: grants.mods,

    hp: derived.maxHp,
    maxHp: derived.maxHp,
    fp: derived.maxFp,
    maxFp: derived.maxFp,

    ba: derived.ba,
    // The engine reads one `atk`; a weapon passes its own bonus when `04`
    // arrives, and melee is what a hero swings with until then.
    atk: derived.attacks.melee,
    attacks: derived.attacks,
    def: derived.def,
    init: derived.init,
    saves: derived.saves,
    slots: derived.slots,
    critFrom: derived.critFrom,

    // The solo protections are a flag on the unit (`01`, and the conditions
    // ruling in DECISIONS).
    protected: true,

    skillPoints: LEVELING.skillPointsAtLevel1,
    skills: [],
    freeSkill: grants.freeSkill,
    gold: grants.gold,
    kit: grants.kit,

    seed: draft.seed,
    mode: draft.mode,
    difficulty: draft.difficulty,
  };

  // The kit goes on, and the sheet is rebuilt over it: what is worn decides
  // DEF, the Max AGI it lets through and the to-hit it costs (`04` section 3),
  // and `rebuildSheet` is the one place that composes those.
  // What one game calls a Murky Potion another calls a Fizzy one: the looks
  // and titles are shuffled once, here, and kept with the save
  // (`04` sections 5 and 17).
  hero.identification = createIdentification(draft.seed);
  equipKit(hero);
  // The kit is the hero's own: they know what all of it is, types included.
  for (const entry of hero.pack.items) identify(hero.identification, entry);
  rebuildSheet(hero);
  // The origin's skill is the hero's from the first step (`01` section 3).
  return grantFree(hero, grants.freeSkill);
}
