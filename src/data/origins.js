/**
 * The four origins (`01` section 3, Origins).
 *
 * An origin is three things: +1 to one attribute, one free skill that doesn't
 * count against a Path's requirements, and a starting kit. This module reads
 * them and applies the first; the skill needs the skill tree (Phase 4's later
 * task) and the kit needs items (`04`, Phase 5), so both are handed back for
 * whoever can grant them rather than pretended here.
 */
import data from './origins.json' with { type: 'json' };
import { MAX_SCORE, modsFor } from './attributes.js';
import { t } from './strings.js';

export const ORIGIN_ORDER = data.order;
export const ORIGINS = data.origins;

/** One origin. */
export function origin(id) {
  const found = ORIGINS[id];
  if (!found) throw new Error(`unknown origin: ${id}`);
  return found;
}

/**
 * All four, in the order the document lists them, each with its id and the
 * words the Create: Origin screen shows.
 */
export function originList() {
  return ORIGIN_ORDER.map((id) => ({
    id,
    ...ORIGINS[id],
    name: t(`origins.${id}.name`),
    blurb: t(`origins.${id}.blurb`),
  }));
}

/**
 * The attribute scores an origin leaves behind. The +1 is part of creation,
 * so it may take a score past the natural creation maximum of 18 but never
 * past 20 (`01` section 3).
 *
 * @param {Record<string, number>} scores
 * @param {string} id
 * @returns {Record<string, number>}
 */
export function withOrigin(scores, id) {
  const chosen = origin(id);
  const out = { ...scores };
  out[chosen.attribute] = Math.min(MAX_SCORE, (out[chosen.attribute] ?? 0) + chosen.bonus);
  return out;
}

/**
 * Everything an origin gives a new hero, ready for the parts of the game that
 * can grant each piece.
 * @param {Record<string, number>} scores
 * @param {string} id
 */
export function grantsOf(scores, id) {
  const chosen = origin(id);
  const attributes = withOrigin(scores, id);
  return {
    origin: id,
    attributes,
    mods: modsFor(attributes),
    // The skill tree learns this one for free (`01` section 6).
    freeSkill: { ...chosen.freeSkill },
    // The pack takes these when there is a pack (`04`, Phase 5).
    kit: chosen.kit.map((entry) => ({ ...entry })),
    gold: chosen.gold,
  };
}

/** Every item id the four kits name, for the data check once items.json exists. */
export function kitItemIds() {
  const ids = new Set();
  for (const id of ORIGIN_ORDER) for (const entry of ORIGINS[id].kit) ids.add(entry.item);
  return [...ids];
}
