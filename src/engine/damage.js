/**
 * The damage order of operations (`06` section 7).
 *
 * ```text
 *  1 GATHER DICE        weapon or spell dice + extra dice + property dice,
 *                       each part keeping its own damage type
 *  2 CRITICAL           multiply the NUMBER of dice in every part
 *  3 ROLL               roll all the dice
 *  4 FLAT BONUSES       added to the weapon's main part only
 *  5 WEAKENED           a Weakened attacker halves every part of a weapon attack
 *  6 TARGET TYPE        per part: Immune ×0, Resistant ×½, Weak ×1½
 *  7 TELEGRAPH          a telegraphed blow on a Defending hero: each part ×½
 *  8 SUM                add the parts
 *  9 DAMAGE REDUCTION   subtract DR once per hit
 * 10 MINIMUM            at least 1, unless every part was Immune
 * 11 TEMPORARY HP       absorbs first
 * 12 APPLY              subtract from HP, and wake a sleeper
 * 13 ZERO HP?           section 9 — the caller's death check
 * ```
 *
 * The order is the whole rule, so it is written out as one pipeline rather
 * than as hooks: what a trait or a skill contributes are the **inputs** — an
 * extra part, a flat bonus, a point of DR — and they arrive on the
 * `damageCalc` event before step 2. A monster's Res / Weak / Imm line is a
 * table in `02`, so it is data on the unit, not code.
 *
 * Every multiplication rounds down where it happens (`06` section 1 rule 4).
 *
 * Damage over time and auras skip steps 2, 7 and 9; types still matter, so a
 * fire-immune unit ignores Burning.
 */
import data from '../data/combat.json' with { type: 'json' };
import { modFor } from '../data/attributes.js';
import { has, spec } from './conditions.js';

export const DAMAGE = data.damage;
export const DAMAGE_TYPES = DAMAGE.types;
export const PHYSICAL = DAMAGE.physical;

/**
 * Matches the way the documents write damage: `1d6+1 crush`, `2d6 fire`, and
 * the flat `2` that Bleeding deals.
 */
const DICE = /^\s*(?:(\d*)d(\d+))?\s*([+-]?\s*\d+)?\s*([a-z]+)?\s*$/i;

/**
 * @typedef {object} Part
 * @property {string} [type]   slash, fire, holy…; undefined damage is untyped
 * @property {number} count    how many dice
 * @property {number} sides
 * @property {number} flat     the part's own flat, as in `1d6+1`
 * @property {boolean} [main]  the weapon's main part, which takes step 4
 */

/**
 * Reads one part from the documents' notation, or passes an object through.
 * @param {string | Part} text
 * @param {Partial<Part>} [extra]
 * @returns {Part}
 */
export function parsePart(text, extra = {}) {
  if (text && typeof text === 'object') {
    return { count: 0, sides: 0, flat: 0, ...text, ...extra };
  }
  const match = DICE.exec(String(text ?? ''));
  if (!match) throw new SyntaxError(`cannot read damage "${text}"`);
  const [, count, sides, flat, type] = match;
  return {
    count: sides ? (count === '' ? 1 : Number(count)) : 0,
    sides: sides ? Number(sides) : 0,
    flat: flat ? Number(flat.replace(/\s+/g, '')) : 0,
    ...(type ? { type: type.toLowerCase() } : {}),
    ...extra,
  };
}

/**
 * Step 1. The parts of one attack: what the weapon or spell rolls, then the
 * extra dice (Power Strike, Backstab, Spellblade, Smite), then the property
 * dice (Flaming, Holy, Ashen Fang). Each keeps its own type.
 * @param {object} attack
 * @returns {Part[]}
 */
export function gatherParts(attack = {}) {
  const parts = [];
  if (attack.parts) {
    for (const part of attack.parts) parts.push(parsePart(part));
  } else if (attack.damage) {
    parts.push(parsePart(attack.damage, { main: true }));
  }
  if (parts.length && !parts.some((part) => part.main)) parts[0].main = true;

  for (const extra of attack.extraDice ?? []) parts.push(parsePart(extra, { extra: true }));
  for (const property of attack.propertyDice ?? []) parts.push(parsePart(property, { property: true }));
  return parts;
}

/**
 * Step 6 for one part. Resistant and Weak cancel, two Resistances don't stack,
 * and the special cases `02` writes into a monster's own line — resistant to
 * non-magic weapons, and the Gargoyle's crush exception — are flags on the
 * unit rather than code about a particular monster.
 */
export function typeMultiplier(target, part, attack = {}) {
  const type = part.type;
  if (type && target.immune?.includes(type)) return DAMAGE.immune;

  let resistant = Boolean(type && target.resistant?.includes(type));
  const weak = Boolean(type && target.weak?.includes(type));

  // Incorporeal, and the Gargoyle: the physical parts of a non-magic weapon
  // are Resistant, except crush for the Gargoyle.
  if (target.resistNonMagic && type && PHYSICAL.includes(type) && !attack.magic) {
    if (!(target.crushIgnoresResistance && type === 'crush')) resistant = true;
  }

  let multiplier = 1;
  // Resistant and Weak together cancel.
  if (resistant && !weak) multiplier = DAMAGE.resistant;
  else if (weak && !resistant) multiplier = DAMAGE.weak;

  // The named exceptions: the Bound Grimoire's fire ×2, Warded Binding's ×½.
  if (type && target.multipliers?.[type]) multiplier *= target.multipliers[type];
  if (target.allPartsMultiplier) multiplier *= target.allPartsMultiplier;
  return multiplier;
}

/** The DR this hit has to get through (step 9). */
export function damageReduction(target, parts, extra = 0) {
  let dr = (target.dr ?? 0) + extra;
  // A crush-bearing hit ignores part of it: all of an Animated Armor's, two
  // of the Colossus's.
  if (parts.some((part) => part.type === 'crush')) {
    const ignored = target.crushIgnoresDr;
    if (ignored === 'all') dr = 0;
    else if (typeof ignored === 'number') dr -= ignored;
  }
  return Math.max(0, dr);
}

/**
 * Steps 1 to 10: everything up to the number that will come off the target.
 *
 * @param {object} combat
 * @param {object} hit
 * @param {object} hit.attacker
 * @param {object} hit.target
 * @param {object} hit.attack
 * @param {object} [hit.result]   the attack result, which says whether it crit
 * @param {{ overTime?: boolean }} [options]
 * @returns {{ parts: object[], subtotal: number, dr: number, total: number,
 *   crit: boolean, immuneAll: boolean }}
 */
/**
 * Step 4's attribute modifier: *"weapon damage = weapon die + MIG mod for
 * melee (AGI mod for thrown weapons; ranged bows add no attribute unless a
 * skill says so)"* (`01` section 8, `06` section 7 step 4).
 *
 * Only a unit with attributes adds one. A monster's damage line already
 * carries its flat — a Kobold's `1d6+1` is the whole of it — so reading a
 * modifier off a monster would pay it twice.
 *
 * @param {object} attacker
 * @param {object} attack
 */
export function weaponMod(attacker, attack = {}) {
  if (!attacker?.attributes) return 0;
  if (attack.noAttributeDamage) return 0;
  // A skill may name another attribute: Duelist swings a Light weapon on AGI.
  const attribute = attack.damageAttribute ?? DAMAGE.weaponAttribute[attack.kind ?? 'melee'];
  return attribute ? modFor(attacker.attributes[attribute]) : 0;
}

/**
 * A flat bonus the gear puts on every hit — the Mighty property's +2, the
 * Bloodthirsty curse's +2 (`04` sections 4 and 6). It sits on the sheet, like
 * DR, so the pipeline reads it rather than asking what is worn. Spells are not
 * weapon damage and do not take it.
 * @param {object} attacker
 * @param {object} attack
 */
export function gearDamage(attacker, attack = {}) {
  if (!attacker?.damageBonus) return 0;
  return (attack.kind ?? 'melee') === 'spell' ? 0 : attacker.damageBonus;
}

export function calcDamage(combat, { attacker, target, attack = {}, result = {} }, options = {}) {
  const rng = combat.rng;
  const overTime = Boolean(options.overTime || attack.overTime);

  // Step 1, and the one chance a trait or a skill has to change the inputs.
  const payload = combat.hooks?.fire('damageCalc', {
    combat,
    attacker,
    unit: attacker,
    target,
    attack,
    result,
    phase: 'gather',
    overTime,
    // A weapon attack is anything that is not a spell, which is what Weakened
    // and the property dice care about.
    weapon: attack.weapon ?? (attack.kind ?? 'melee') !== 'spell',
    parts: gatherParts(attack),
    // Step 4's flats, gathered before a hook can change them.
    flat: (attack.flat ?? 0) + weaponMod(attacker, attack) + gearDamage(attacker, attack),
    crit: Boolean(result.crit),
    critDice: attack.mastery ? DAMAGE.critDiceWithMastery : DAMAGE.critDice,
    dr: 0,
  }) ?? {
    parts: gatherParts(attack),
    flat: (attack.flat ?? 0) + weaponMod(attacker, attack) + gearDamage(attacker, attack),
    crit: Boolean(result.crit),
  };

  const parts = (payload.parts ?? []).map((part) => ({ ...part }));
  const crit = Boolean(payload.crit) && !overTime;

  for (const part of parts) {
    // 2. CRITICAL: the number of dice, never the flats.
    const count = crit ? part.count * (payload.critDice ?? DAMAGE.critDice) : part.count;

    // 3. ROLL.
    part.rolled = count > 0 ? rng.dice(count, part.sides) : 0;
    part.diceCount = count;
    let amount = part.rolled + (part.flat ?? 0);

    // 4. FLAT BONUSES, on the weapon's main part alone.
    if (part.main) amount += payload.flat ?? 0;

    // 5. WEAKENED: every part of a weapon attack.
    if (payload.halved && payload.weapon) amount = Math.floor(amount * DAMAGE.weakened);

    // 6. TARGET TYPE. A trait may multiply every part as well — the Cave Bat
    //    Swarm's body, which turns a single-target weapon aside and comes
    //    apart under an area effect.
    part.multiplier = typeMultiplier(target, part, attack) * (payload.allPartsMultiplier ?? 1);
    amount = Math.floor(amount * part.multiplier);

    // 7. TELEGRAPH: a wind-up landing on a hero who is Defending.
    if (!overTime && attack.telegraphed && target.defending) {
      amount = Math.floor(amount * DAMAGE.telegraphVsDefending);
      part.telegraphHalved = true;
    }

    part.amount = amount;
  }

  // 8. SUM.
  const subtotal = parts.reduce((total, part) => total + part.amount, 0);

  // 9. DAMAGE REDUCTION, once per hit.
  const dr = overTime
    ? 0
    : damageReduction(target, parts, (payload.conditionDr ?? 0) + (payload.dr ?? 0));
  let total = subtotal - dr;

  // 10. MINIMUM: at least 1, unless every part was Immune.
  const immuneAll = parts.length > 0 && parts.every((part) => part.multiplier === DAMAGE.immune);
  if (immuneAll) total = 0;
  else total = Math.max(DAMAGE.minimum, total);
  if (parts.length === 0) total = 0;

  return { parts, subtotal, dr, total, crit, immuneAll, overTime };
}

/**
 * Steps 11 and 12: temporary HP takes it first, then hit points, and anything
 * that answers to being hurt — waking a sleeper, a grab coming loose, a boss
 * phase, morale — hangs off `damageTaken`.
 *
 * Step 13, the zero-HP check, is the caller's: an attack asks section 9 the
 * moment it lands, and a turn asks it after the start-of-turn damage.
 *
 * @param {object} combat
 * @param {object} target
 * @param {number} amount
 * @param {object} [source] `{ attacker, attack, kind, type }`
 */
export function dealDamage(combat, target, amount, source = {}) {
  const dealt = Math.max(0, Math.floor(amount));

  // 11. TEMPORARY HP absorbs first (Mystic).
  const absorbed = Math.min(target.tempHp ?? 0, dealt);
  if (absorbed > 0) target.tempHp -= absorbed;

  // 12. APPLY.
  const toHp = dealt - absorbed;
  target.hp -= toHp;

  combat.hooks?.fire('damageTaken', {
    combat,
    target,
    unit: target,
    attacker: source.attacker,
    attack: source.attack,
    // Damage is damage even when temporary HP ate it, so a sleeper still wakes.
    amount: dealt,
    toHp,
    absorbed,
    source,
  });

  return { dealt, absorbed, toHp, hp: target.hp };
}

/**
 * The `damage` service `06` section 6 step 9 hands the hit to: the whole
 * order, then the application.
 *
 * Magic Missile is the documented exception — each missile is its own hit and
 * applies DR separately, still at least 1 each — so an attack that says how
 * many missiles it has runs the pipeline once per missile.
 */
export function resolveDamage(combat, hit, options = {}) {
  const missiles = Math.max(1, hit.attack?.missiles ?? 1);
  const rolls = [];
  let total = 0;

  for (let i = 0; i < missiles; i += 1) {
    const calculated = calcDamage(combat, hit, options);
    rolls.push(calculated);
    total += calculated.total;
    dealDamage(combat, hit.target, calculated.total, {
      attacker: hit.attacker,
      attack: hit.attack,
      kind: 'attack',
      // What the blow was made of: a Fallen troll burns on fire or holy, and
      // a standing one skips its regeneration for the same reason.
      types: calculated.parts.filter((part) => part.amount > 0).map((part) => part.type),
    });
  }

  const first = rolls[0];
  return {
    ...first,
    total,
    amount: total,
    ...(missiles > 1 ? { missiles: rolls } : {}),
  };
}

/**
 * Damage from a condition or an aura: the same order with steps 2, 7 and 9
 * left out, and the type still read off the condition, so a fire-immune unit
 * ignores Burning.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {number} amount   what the condition rolled
 * @param {string} [type]   the damage type, if it has one
 * @param {object} [source]
 */
export function overTimeDamage(combat, unit, amount, type, source = {}) {
  const part = { count: 0, sides: 0, flat: amount, type, main: true };
  source = { ...source, types: type ? [type] : [] };
  const multiplier = typeMultiplier(unit, part, { magic: true });
  const dealt = multiplier === DAMAGE.immune ? 0 : Math.max(DAMAGE.minimum, Math.floor(amount * multiplier));
  if (dealt === 0) return { dealt: 0, immune: true, hp: unit.hp };
  return { ...dealDamage(combat, unit, dealt, { ...source, overTime: true, type }), immune: false };
}

/**
 * The `hurt` service the condition hooks take: it knows which condition is
 * doing the hurting, so it can read the type off `conditions.json`.
 * @param {object} combat
 */
export function conditionHurt(combat) {
  return (unit, amount, source = {}) => {
    const type = source.id ? spec(source.id).damageType : undefined;
    return overTimeDamage(combat, unit, amount, type, source);
  };
}

/** True while a unit is asleep and would be woken by a blow — for the log. */
export function wouldWake(unit) {
  return has(unit, 'asleep');
}
