/**
 * The trap catalog (`03` sections 2 to 5).
 *
 * `traps.json` holds the document's three tables — floor, door and chest — in
 * the JSON shape section 13 gives, plus the rolls that pick one: which trap,
 * which tier, and how much a trap of that depth hits for.
 *
 * The tier TNs are not here: `03` section 2 gives traps and locks **one**
 * table between them, and `locks.json` already holds it.
 *
 * No DOM, and nothing here rolls except where it is handed a stream.
 */
import data from './traps.json' with { type: 'json' };
import { lockData } from '../systems/locks.js';

export const TRAPS = data.traps;
export const DETECTION = data.detection;
export const DISARM = data.disarm;
export const POLE = data.pole;
export const TRIGGER = data.trigger;
export const TRAP_XP = data.xp;
export const SALVAGE = data.salvage;
export const CHEST_TRAP_ROLL = data.chestTrapRoll;
export const TIER_ROLL = data.mechanicalTierRoll;

/** Every trap id, in the order the document lists them. */
export const TRAP_IDS = Object.keys(TRAPS).filter((id) => !id.startsWith('_'));

/** One trap, as the document writes it. */
export function trap(id) {
  const found = TRAPS[id];
  if (!found) throw new Error(`unknown trap: ${id}`);
  return found;
}

/** Every trap that can be put on a floor, a door or a chest at this depth. */
export function trapsFor(placement, floor = 1) {
  return TRAP_IDS.filter(
    (id) => TRAPS[id].placement.includes(placement) && (TRAPS[id].minFloor ?? 1) <= floor,
  );
}

/**
 * The floor dice: 1d6 per two floors, at least 1d6 (`03` section 2).
 * @param {number} floor
 * @returns {string} dice notation
 */
export function floorDice(floor = 1) {
  const rule = data.floorDice;
  const count = Math.max(rule.minimum, Math.ceil(floor / rule.perFloors));
  return `${count}d${rule.die}`;
}

/**
 * A trap's damage, with the document's shorthands filled in: `FD` is the
 * floor dice, `2FD` twice them, and `F` the floor number.
 * @param {string} notation
 * @param {number} floor
 */
export function damageNotation(notation, floor = 1) {
  if (!notation) return null;
  const fd = floorDice(floor);
  const [count, sides] = fd.split('d');
  return String(notation)
    .replace(/(\d*)FD/g, (_, times) => `${Number(count) * (Number(times) || 1)}d${sides}`)
    .replace(/\bF\b/g, String(floor));
}

/**
 * Which tier a mechanical trap is: d10 + F, capped to the tiers the trap
 * itself lists (`03` section 5, Mechanical tier roll).
 * @param {import('../engine/rng.js').Stream} rng
 * @param {number} floor
 * @param {string[]} allowed the trap's own tiers
 */
export function rollTier(rng, floor, allowed) {
  if (!allowed || allowed.length === 1) return allowed?.[0] ?? 'standard';
  const total = rng.roll(TIER_ROLL.dice) + floor;
  const rolled = TIER_ROLL.bands.find((band) => total <= band.upTo)?.tier ?? 'standard';
  if (allowed.includes(rolled)) return rolled;
  // "If the result is a tier the trap doesn't list, use the closest tier it
  // does" — closest by the order the tiers themselves are in.
  const order = Object.keys(lockData.tiers).filter((id) => !id.startsWith('_'));
  const wanted = order.indexOf(rolled);
  return [...allowed].sort(
    (a, b) => Math.abs(order.indexOf(a) - wanted) - Math.abs(order.indexOf(b) - wanted),
  )[0];
}

/** One trap for a floor tile or a door: anything deep enough to be there. */
export function rollTrap(rng, placement, floor) {
  const choices = trapsFor(placement, floor);
  if (choices.length === 0) return null;
  const id = rng.pick(choices);
  return { kind: id, tier: rollTier(rng, floor, trap(id).tiers) };
}

/**
 * A chest's trap: d6 on floors 1-3, d10 on 4-7, d12 below (`03` section 5).
 * @param {import('../engine/rng.js').Stream} rng
 * @param {number} floor
 */
export function rollChestTrap(rng, floor) {
  const die = CHEST_TRAP_ROLL.dieByFloor.find((band) => floor <= band.upToFloor)?.die ?? 12;
  const roll = rng.die(die);
  const id = CHEST_TRAP_ROLL.table.find((row) => row.roll === roll)?.id;
  if (!id) return null;
  return { kind: id, tier: rollTier(rng, floor, trap(id).tiers), roll };
}

/** What disarming this trap cleanly leaves in the hero's hands. */
export function salvageFor(id) {
  return trap(id).salvage ?? SALVAGE.by[id] ?? SALVAGE.default;
}

/**
 * The XP one non-combat action is worth (`03` section 11). Masterwork doubles
 * it and Arcane trebles it; a pole, a bash and a key are worth nothing.
 * @param {string} action
 * @param {number} floor
 * @param {string} [tier]
 */
export function xpFor(action, floor, tier) {
  if (TRAP_XP.none.includes(action)) return 0;
  const rule = TRAP_XP[action];
  if (!rule) return 0;
  return rule.perFloor * floor * (TRAP_XP.tierMultiplier[tier] ?? 1);
}

/** True for a trap the ten-foot pole can set off (`03` section 4). */
export function poleable(id) {
  return trap(id).poleable !== false;
}

/** True where the pole springs it but the hero is still in the way. */
export function poleAdvantage(id) {
  return trap(id).poleable === 'advantage';
}

/** True for the glyphs, runes and sigils, which are found and disarmed differently. */
export function isArcane(id, tier) {
  return (tier ?? trap(id).tiers[0]) === 'arcane' || trap(id).family === 'arcane';
}
