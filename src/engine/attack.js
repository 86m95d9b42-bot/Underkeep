/**
 * Resolving an attack (`06` section 6) — weapon attacks, attack-roll spells
 * and monster attacks alike.
 *
 * ```text
 *  1 DECLARE     attacker, target, attack type
 *  2 REDIRECT    Guardian may take the attack instead
 *  3 LEGALITY    row, reach, submerged, units that have left
 *  4 AUTO-HIT?   Magic Missile, or a helpless target → straight to 9
 *  5 ROLL        d20, with advantage or disadvantage (they cancel)
 *  6 NATURALS    1 always misses, 20 always hits and crits
 *  7 COMPARE     total vs DEF, and the crit range
 *  8 REACTIONS   Lucky → reroll, Arcane Shield / Shield Block → more DEF,
 *                Blink → the hit becomes a miss
 *  9 HIT         damage (section 7), then the on-hit effects
 * 10 MISS        Riposte
 * ```
 *
 * Steps 2 and 8 are hooks, and so is every modifier that is not a condition:
 * the engine fires `attackRoll` twice, once to **gather** what the roll is
 * owed before the die is thrown, and once to **judge** the result afterwards,
 * which is where the defender's reactions live. The payload's `phase` says
 * which moment it is.
 *
 * Damage is section 7 and lands next: this module takes the hit as far as
 * "it connects", hands it to the caller's `damage` service, and fires the
 * `hit`, `kill` and `miss` events in the order `06` section 18 gives.
 */
import data from '../data/combat.json' with { type: 'json' };
import { attackMods, defMod, defenceMods, isHelpless } from './conditions.js';
import { rollSave } from './riders.js';
import { ROWS, countedEnemies, targetableEnemies, isTargetable, onField, unitById } from './field.js';
import { targetsFor } from './actions.js';
import { resolveDamage } from './damage.js';
import { zeroHp } from './defeat.js';
import { defendBonus } from './turn.js';

export const ATTACK = data.attack;

/**
 * @typedef {object} Attack
 * @property {string} [id]      the action's id; `attack` by default
 * @property {'melee' | 'ranged' | 'spell'} [kind]
 * @property {string | object} [target] the unit, or its id
 * @property {number} [bonus]   what the attacker adds, over its own `atk`
 * @property {boolean} [autoHit] Magic Missile and its like
 * @property {boolean} [canCrit] false for an attack that never crits
 * @property {boolean} [reach]  a Reach weapon, which passes the front row
 * @property {boolean} [requirementMet] false costs −2 (`06` section 6)
 * @property {number} [attacks] how many attacks this action makes
 * @property {boolean} [telegraphed] resolved from a wind-up
 */

/**
 * @typedef {object} AttackResult
 * @property {boolean} hit
 * @property {boolean} crit
 * @property {number} [roll]    the natural d20
 * @property {number} [total]   roll + bonuses
 * @property {number} [def]     what it had to beat
 * @property {boolean} [autoHit]
 * @property {boolean} [legal]
 * @property {string} [why]     why it never happened
 * @property {object} [damage]  whatever the damage service returned
 */

/* -------------------------------------------------------------------------- */
/* The numbers                                                                */
/* -------------------------------------------------------------------------- */

/** What a unit's attack roll adds before situational modifiers. */
export function attackBonus(unit, attack = {}) {
  return (attack.bonus ?? unit.atk ?? 0) + (attack.atkMod ?? 0);
}

/**
 * The DEF an attack has to beat: the unit's own, plus Defend, plus what its
 * conditions do to it — Slowed −2, Knocked Down −2 (`06` section 6 step 7).
 */
export function defenceOf(unit) {
  return (unit.def ?? 10) + defendBonus(unit) + defMod(unit);
}

/**
 * −2 Half Cover: a ranged weapon attack or a spell attack against the back
 * row, while any front-row enemy is standing. Auto-hit spells and area saves
 * don't pay it (`06` section 6, Attack Modifiers).
 */
export function coverPenalty(combat, attacker, target, attack = {}) {
  const kind = attack.kind ?? 'melee';
  if (kind === 'melee' || attack.autoHit) return 0;
  if (target.row !== ROWS[1]) return 0;
  const frontStands = combat.units.some(
    (unit) =>
      unit.side === target.side && unit.row === ROWS[0] && unit.alive && onField(unit),
  );
  return frontStands ? ATTACK.halfCover : 0;
}

/** The lowest natural that crits for this attacker: 20, or 19 with Luck. */
export function critFrom(unit, attack = {}) {
  return attack.critFrom ?? unit.critFrom ?? ATTACK.critFrom;
}

/* -------------------------------------------------------------------------- */
/* Resolving one attack                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One attack, start to finish.
 *
 * @param {object} combat
 * @param {object} attacker
 * @param {Attack} attack
 * @param {object} [services]
 * @param {(combat: object, hit: object) => any} [services.damage] section 7,
 *   which is `resolveDamage` unless the caller has its own
 * @returns {AttackResult}
 */
export function resolveAttack(combat, attacker, attack = {}, services = {}) {
  const rng = combat.rng;
  const kind = attack.kind ?? 'melee';

  // 1. DECLARE.
  let target = asUnit(combat, attack.target) ?? firstTarget(combat, attacker, attack);
  if (!target) return { hit: false, crit: false, legal: false, why: 'noTarget' };

  // 2. REDIRECT: Guardian may step in front of the blow.
  const redirect = combat.hooks?.fire('beforeAction', {
    combat,
    unit: attacker,
    attacker,
    target,
    attack,
    phase: 'redirect',
  });
  if (redirect?.cancelled) {
    return { hit: false, crit: false, legal: false, why: redirect.cancelledBy ?? 'cancelled' };
  }
  if (redirect?.target && redirect.target !== target) target = redirect.target;

  // 3. LEGALITY: rows, reach, and anything that cannot be touched.
  const legality = canReach(combat, attacker, target, attack);
  if (!legality.legal) return { hit: false, crit: false, ...legality };

  // Everything the roll is owed, gathered before the die is thrown.
  const mods = gatherModifiers(combat, attacker, target, attack);
  const def = defenceOf(target) + (attack.defMod ?? 0);
  const bonus = attackBonus(attacker, attack) + mods.bonus;
  const crits = attack.canCrit !== false;
  // The hero is never critically hit while helpless (`06` section 6 step 4).
  const critAllowed = crits && !(target.protected && isHelpless(target));

  // 4. AUTO-HIT: the d20 is still thrown, but only to see whether it crits.
  if (attack.autoHit || mods.autoHit) {
    const roll = rng.d20();
    const crit = critAllowed && roll >= critFrom(attacker, attack);
    return land(combat, attacker, target, attack, { hit: true, crit, roll, autoHit: true, def }, services);
  }

  // 5-8, with Lucky's reroll sending it back to step 6.
  let result = null;
  let extraDef = 0;
  for (let attempt = 0; attempt <= ATTACK.maxRerolls; attempt += 1) {
    // 5. ROLL.
    const roll = rng.d20({ advantage: mods.advantage, disadvantage: mods.disadvantage });
    const total = roll + bonus;

    // 6. NATURALS, then 7. COMPARE.
    result = judge(roll, total, def + extraDef, { critFrom: critFrom(attacker, attack), critAllowed });

    // 8. DEFENDER REACTIONS, in the order `06` section 16 lists them.
    const judged = combat.hooks?.fire('attackRoll', {
      combat,
      attacker,
      unit: attacker,
      target,
      attack,
      phase: 'judge',
      roll,
      total,
      def: def + extraDef,
      hit: result.hit,
      crit: result.crit,
      reroll: false,
      bonusDef: 0,
    });

    if (judged) {
      // b) Arcane Shield, Shield Block, Warded: more DEF, compared again. A
      //    natural 20 still hits, which step 6 settles before this.
      if (judged.bonusDef) {
        extraDef += judged.bonusDef;
        result = judge(roll, total, def + extraDef, {
          critFrom: critFrom(attacker, attack),
          critAllowed,
        });
      }
      // c) Blink and anything else that turns a hit into a miss.
      if (judged.hit === false) result = { ...result, hit: false, crit: false, turned: true };
      // a) Lucky: throw it again.
      if (judged.reroll) continue;
    }
    break;
  }

  return land(combat, attacker, target, attack, { ...result, def: def + extraDef }, services);
}

/**
 * Steps 6 and 7 as one judgement: a natural 1 always misses, a natural 20
 * always hits and crits, and anything else compares.
 */
export function judge(roll, total, def, { critFrom: from = ATTACK.critFrom, critAllowed = true } = {}) {
  if (roll === ATTACK.naturalMiss) return { hit: false, crit: false, roll, total, natural: 'miss' };
  if (roll === ATTACK.die) {
    return { hit: true, crit: critAllowed, roll, total, natural: 'hit' };
  }
  const hit = total >= def;
  return { hit, crit: hit && critAllowed && roll >= from, roll, total };
}

/**
 * Steps 9 and 10: the hit goes to damage and then to the on-hit effects, and
 * the miss to its own triggers. The order is `06` section 18's `applyHit`:
 * damage, then the zero-HP check, then `hit` on a survivor or `kill` on a
 * death.
 */
function land(combat, attacker, target, attack, result, services) {
  const out = { ...result, legal: true, attacker: attacker.id, target: target.id };

  if (!result.hit) {
    // 10. MISS: Riposte, for a melee miss.
    combat.hooks?.fire('miss', { combat, attacker, unit: attacker, target, attack, result: out });
    return out;
  }

  // A breath weapon or a burst allows one save, rolled before the dice, and
  // the same save decides the rider: "Reflex save for half, and Burning on a
  // failed save" is one roll, not two (`02` sections 9 and 12).
  if (attack.save) {
    out.save = rollSave(target, attack.save.type ?? 'reflex', attack.save.dc ?? 10, combat.rng, {
      advantage: Boolean(attack.telegraphed && target.defending),
    });
  }

  // Some abilities carry no dice at all: a Web, a Wing Buffet, a Wail. They
  // land, they do something, and there is nothing to add up (`02` sections 7
  // and 13), so the damage rules are never asked. A plain attack with no
  // dice is not one of these — it is a weapon whose damage is elsewhere.
  if (attack.ability && !attack.damage && !attack.parts) {
    out.effectOnly = true;
    out.name = attack.name ?? attack.ability;
    const payload = { combat, attacker, unit: attacker, target, attack, result: out, damage: null };
    combat.hooks?.fire('hit', payload);
    return out;
  }

  // 9. HIT: section 7 does the arithmetic.
  const damage = services.damage ?? resolveDamage;
  const saved = out.save?.passed ?? false;
  const halved = saved && attack.save?.half;
  out.damage =
    saved && attack.save && !attack.save.half
      ? null
      : damage(
          combat,
          { attacker, target, attack, result: out },
          halved ? { allPartsMultiplier: 0.5 } : {},
        ) ?? null;

  // 13. ZERO HP? Section 9's ladder: the traits that catch it, then the fall.
  if (target.hp <= 0 && target.alive) {
    const zero = zeroHp(combat, target, { attacker, attack, result: out, cause: 'attack' });
    if (zero.died) out.killed = true;
    if (zero.fallen) out.fallen = true;
  }

  const payload = { combat, attacker, unit: attacker, target, attack, result: out, damage: out.damage };
  combat.hooks?.fire(out.killed ? 'kill' : 'hit', payload);
  return out;
}

/**
 * Every attack of a multi-attack action, each resolved completely — damage
 * and death check included — before the next begins. If one kills its target,
 * the next may pick a new legal target; otherwise it is lost
 * (`06` section 6, Multiple Attacks).
 */
export function resolveAttacks(combat, attacker, attack = {}, services = {}) {
  const count = Math.max(1, attack.attacks ?? 1);
  const results = [];
  let target = asUnit(combat, attack.target) ?? firstTarget(combat, attacker, attack);

  for (let i = 0; i < count; i += 1) {
    if (!target) break;
    const result = resolveAttack(combat, attacker, { ...attack, target }, services);
    results.push(result);
    if (!target.alive) {
      // A new legal target, or the rest of the attacks are lost.
      target = firstTarget(combat, attacker, attack);
    }
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* The pieces                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Step 5's advantage and disadvantage, and every modifier the roll is owed,
 * gathered before the die is thrown. Conditions answer through their own
 * `attackRoll` hook; so does anything else with an opinion — Hex, Averted
 * Eyes, Echolocation, darkness.
 */
export function gatherModifiers(combat, attacker, target, attack = {}) {
  const payload = combat.hooks?.fire('attackRoll', {
    combat,
    attacker,
    unit: attacker,
    target,
    attack,
    phase: 'gather',
    advantage: Boolean(attack.advantage),
    disadvantage: Boolean(attack.disadvantage),
    autoHit: Boolean(attack.autoHit),
    bonus: 0,
  }) ?? {
    // With no register at all, the conditions still have to be read.
    advantage: Boolean(attack.advantage) || attackMods(attacker).advantage || defenceMods(target).advantage,
    disadvantage:
      Boolean(attack.disadvantage) || attackMods(attacker).disadvantage || defenceMods(target).disadvantage,
    autoHit: Boolean(attack.autoHit) || defenceMods(target).autoHit,
    bonus: 0,
  };

  // The two modifiers `06` section 6 names itself.
  payload.bonus += coverPenalty(combat, attacker, target, attack);
  if (attack.requirementMet === false) payload.bonus += ATTACK.requirementNotMet;

  return payload;
}

/**
 * Step 3. Rows and reach come from the action rules; on top of them, a unit
 * that has left the field or cannot be touched at all — submerged, or a Lich
 * that is Reforming — is no target.
 */
export function canReach(combat, attacker, target, attack = {}) {
  if (!target || !onField(target)) return { legal: false, why: 'gone' };
  if (target.untargetable) return { legal: false, why: 'untargetable' };
  // A Fallen troll is not alive and is still a target, until it is burned.
  if (!isTargetable(target)) return { legal: false, why: 'gone' };
  if (target.side === attacker.side) return { legal: false, why: 'ownSide' };
  const reachable = targetsFor(combat, attacker, { id: 'attack', tags: ['attack'], ...attack });
  if (!reachable.some((unit) => unit.id === target.id)) return { legal: false, why: 'badTarget' };
  return { legal: true };
}

/** The first target this attack could legally take, or null. */
function firstTarget(combat, attacker, attack) {
  const reachable = targetsFor(combat, attacker, { id: 'attack', tags: ['attack'], ...attack });
  return reachable.find(isTargetable) ?? null;
}

/** A unit, from a unit or an id. */
function asUnit(combat, target) {
  if (!target) return null;
  return typeof target === 'string' ? unitById(combat, target) : target;
}

/**
 * The `resolveAction` the turn engine asks for: an attack action goes through
 * section 6, and everything else waits for the phase that builds it.
 */
export function resolveAction(combat, unit, action, services = {}) {
  if (action.id !== 'attack') return null;
  if (action.sequence) return resolveSequence(combat, unit, action, services);
  return action.attacks > 1
    ? resolveAttacks(combat, unit, action, services)
    : resolveAttack(combat, unit, action, services);
}

/**
 * Two different blows in one turn: a bite and then a claw. Each is resolved
 * completely before the next, as every multi-attack is (`06` section 6).
 */
export function resolveSequence(combat, attacker, action, services = {}) {
  const results = [];
  for (const blow of action.sequence ?? []) {
    const target = asUnit(combat, action.target) ?? firstTarget(combat, attacker, blow);
    if (!target) break;
    results.push(resolveAttack(combat, attacker, { ...blow, target }, services));
  }
  return results;
}

/** Every enemy an attack could reach, for the target picker. */
export function reachableTargets(combat, attacker, attack = {}) {
  return targetsFor(combat, attacker, { id: 'attack', tags: ['attack'], ...attack }).filter(isTargetable);
}

/** Whether any enemy at all is standing, which the round's end check wants. */
export function anyTargets(combat) {
  return targetableEnemies(combat).some((unit) => unit.alive);
}
