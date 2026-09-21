/**
 * Hazards, curiosities and theme features (`03` section 8, `05` section 6).
 *
 * `hazards.json` holds what each one *does*; where each one may go is `05`
 * section 3 step 8, which has lived in `floors.json` as `hazardRules` since
 * Phase 2. Placement reads that file; this one is read by the systems that
 * make a hazard happen to the hero.
 *
 * No DOM, and nothing here rolls except where it is handed a stream.
 */
import data from './hazards.json' with { type: 'json' };

export const HAZARDS = data.hazards;
export const HAZARD_DETECTION = data.detection;
export const CURIOSITIES = data.curiosities;
export const FEATURES = data.features;

/** Every hazard id, in the order the document lists them. */
export const HAZARD_IDS = Object.keys(HAZARDS).filter((id) => !id.startsWith('_'));

/** Every theme feature id. */
export const FEATURE_IDS = Object.keys(FEATURES).filter((id) => !id.startsWith('_'));

/** One hazard, as the document writes it. */
export function hazard(id) {
  const found = HAZARDS[id];
  if (!found) throw new Error(`unknown hazard: ${id}`);
  return found;
}

/** One theme feature. */
export function feature(id) {
  const found = FEATURES[id];
  if (!found) throw new Error(`unknown feature: ${id}`);
  return found;
}

/** One curiosity: the fountain or the shrine. */
export function curiosity(id) {
  const found = CURIOSITIES[id];
  if (!found) throw new Error(`unknown curiosity: ${id}`);
  return found;
}

/**
 * A `{ base, perFloor }` number on this floor, the way every other table in
 * the game scales: the Detect TN, the web curtain's bash TN, a Body save DC.
 * @param {{ base: number, perFloor?: number }} rule
 * @param {number} floor
 */
export function onFloor(rule, floor = 1) {
  return rule.base + (rule.perFloor ?? 0) * floor;
}

/** The TN to spot a hidden hazard on this floor: 12 + F (`03` section 8). */
export function hazardTn(floor) {
  return onFloor(HAZARD_DETECTION.findTn, floor);
}

/** True for a hazard the hero has to find before it is on the map. */
export function isHidden(id) {
  return Boolean(hazard(id).hidden);
}

/** What a shrine asks for on this floor: 20 x F gold (`03` section 8). */
export function offeringCost(floor) {
  return CURIOSITIES.shrine.costPerFloor * floor;
}
