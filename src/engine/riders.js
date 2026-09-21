/**
 * On-hit condition riders (`06` section 8, on-hit step 1).
 *
 * "Condition riders — Poisoned, Grabbed, Paralyzed, Knocked Down, and so on.
 * Each allows its listed save. A rider is skipped if the target is immune or
 * inside a control-immunity window."
 *
 * Every one of them is data: the bestiary writes the rider under the attack
 * that carries it (`onHit: { save, dc, condition }`), so the Zombie's Grab,
 * the Ghoul's Paralyzing Claw and the Giant Rat's Filthy Bite are one hook
 * between them rather than three.
 *
 * Saves are `06` section 8: **d20 + the save bonus vs. the DC**, a natural 20
 * always succeeds and a natural 1 always fails.
 */
import { applyCondition, blockedFrom } from './conditions.js';
import { resolveDamage } from './damage.js';
import { remember } from './ai.js';
import { effectDcOf } from '../data/monsters.js';

/** The rider an attack carries, if it carries one. */
export function riderOf(attack) {
  return attack?.onHit ?? null;
}

/** A unit's bonus on one kind of save. */
export function saveBonus(unit, type) {
  return unit?.saves?.[type] ?? 0;
}

/**
 * One saving throw (`06` section 8).
 * @returns {{ roll: number, total: number, dc: number, passed: boolean }}
 */
export function rollSave(unit, type, dc, rng, { advantage = false } = {}) {
  const roll = rng.d20({ advantage });
  const total = roll + saveBonus(unit, type);
  const passed = roll === 20 || (roll !== 1 && total >= dc);
  return { roll, total, dc, save: type, passed };
}

/**
 * Applies an attack's rider, if it has one and it should land.
 *
 * @param {object} combat
 * @param {object} attacker
 * @param {object} target
 * @param {object} attack
 * @param {object} result the attack result, for riders that want a natural
 * @returns {object | null} what happened, or null when there was no rider
 */
export function applyRider(combat, attacker, target, attack, result = {}) {
  const rider = riderOf(attack);
  if (!rider?.condition) return null;

  // Filthy Bite only bites on a natural 18-20.
  if (rider.natural) {
    const [low, high] = rider.natural;
    const natural = result.roll ?? 0;
    if (natural < low || natural > high) return null;
  }

  // Skipped if the target is immune or inside a control-immunity window — and
  // a monster remembers what the hero shrugs off (`06` section 11).
  const blocked = blockedFrom(target, rider.condition);
  if (blocked) {
    if (attacker && target.side === 'hero') remember(attacker, rider.condition);
    return { condition: rider.condition, applied: false, why: blocked };
  }

  // Most stat blocks state the DC; anything that does not falls back to the
  // monster's own, which is `01` section 4's 10 + floor(HD / 2).
  const dc = rider.dc ?? attack.save?.dc ?? effectDcOf(attacker);
  // One save can do two jobs: a breath weapon's Reflex save halves the damage
  // *and* decides the Burning, so the rider reuses the roll the attack made
  // rather than asking for a second one (`02` sections 9 and 12).
  const save = rider.useAttackSave
    ? (result.save ?? null)
    : rider.save
      ? rollSave(target, rider.save, dc, combat.rng, {
          // A telegraphed attack's saves get advantage while the hero Defends.
          advantage: Boolean(attack.telegraphed && target.defending),
        })
      : null;
  if (save?.passed) return { condition: rider.condition, applied: false, why: 'saved', save };

  // "Failing by 5 or more also deals 3d6": the Banshee's Wail is the one
  // rider that hurts as well as frightens (`02` section 11).
  if (rider.failBy && save && save.total <= save.dc - rider.failBy && rider.failDamage) {
    resolveDamage(combat, {
      attacker,
      target,
      attack: {
        name: rider._trait ?? 'wail',
        kind: 'burst',
        damage: `${rider.failDamage}${rider.failDamageType ? ` ${rider.failDamageType}` : ''}`,
        noAttributeDamage: true,
      },
    });
  }

  const applied = applyCondition(target, rider.condition, {
    dc,
    source: attacker?.id,
    // A rider lands on the *target's* turn only when it is the target acting,
    // which an on-hit rider never is.
    onOwnTurn: false,
    ...(rider.damage ? { damage: rider.damage } : {}),
    ...(rider.rounds ? { rounds: rider.rounds } : {}),
  });
  return { condition: rider.condition, applied: applied.applied, why: applied.why, save };
}

/**
 * Registers the rider hook. It runs first inside `hit`, which is the order
 * `06` section 8 gives: riders, then attacker healing, then the target's own
 * reactions.
 *
 * @param {ReturnType<import('./hooks.js').createHooks>} hooks
 * @returns {() => void}
 */
export function registerRiders(hooks) {
  return hooks.on(
    'hit',
    (payload) => {
      const { combat, attacker, target, attack, result } = payload;
      if (!combat || !target || !attack) return;
      const landed = applyRider(combat, attacker, target, attack, result ?? {});
      if (!landed) return;
      payload.rider = landed;
      if (landed.applied) payload.say(`${target.id} is ${landed.condition}`);
    },
    { name: 'rider', source: 'riders' },
  );
}
