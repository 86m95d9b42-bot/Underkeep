/**
 * Zero HP (`06` section 9).
 *
 * Every trait that catches a unit on the way down — Undying, the Phylactery
 * Shard, Ferocity, Relentless, Won't Stay Down, the Lich's vessel — is a
 * `zeroHP` hook, and `06` section 16 lists them in the order they are asked.
 * This module is the ladder they hang on: it fires the event, believes the
 * answer, and otherwise takes the unit out of the fight.
 *
 * The one outcome the engine has to know about itself is the **Fallen** troll,
 * because the combat does not end while an unburned one lies there: it revives
 * after three rounds with 10 HP unless fire or holy damage finds it first.
 *
 * No DOM, no randomness of its own.
 */
import data from '../data/combat.json' with { type: 'json' };
import { onField } from './field.js';

export const ZERO_HP = data.zeroHp;
export const FLEEING = data.fleeing;
export const FALLEN = data.zeroHp.fallen;

/**
 * The zero-HP check (`06` section 9), asked the moment a unit's hit points
 * reach zero: by an attack when it lands, and by a turn after its start-of-turn
 * damage. Firing `kill` afterwards is the caller's, because only the caller
 * knows whether the blow was an attack.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {{ attacker?: object, attack?: object, cause?: string }} [context]
 * @returns {{ resolved: boolean, saved?: boolean, savedBy?: string,
 *   fallen?: boolean, died?: boolean }}
 */
export function zeroHp(combat, unit, context = {}) {
  if (!unit || !unit.alive || unit.hp > 0) return { resolved: false };

  const payload = combat.hooks?.fire('zeroHP', {
    combat,
    unit,
    target: unit,
    attacker: context.attacker,
    attack: context.attack,
    result: context.result,
    cause: context.cause,
    saved: false,
    fallen: false,
  });

  // A trait caught it: Undying and the Phylactery Shard put the hero back on
  // their feet at half HP, Ferocity holds an Orc at 1.
  if (payload?.saved) {
    if (unit.hp <= 0) unit.hp = recoveryHp(unit, payload.recoverTo);
    return { resolved: true, saved: true, savedBy: payload.savedBy };
  }

  // Won't Stay Down: the troll goes down but its wounds are already closing.
  if (payload?.fallen) {
    fall(unit, payload.fallenFor);
    return { resolved: true, fallen: true };
  }

  unit.alive = false;
  if (unit.side === 'hero') unit.defeated = true;
  return { resolved: true, died: true };
}

/** Half of maximum HP, which is where the hero's two rescues put them back. */
export function recoveryHp(unit, share = ZERO_HP.heroRecoveryShare) {
  return Math.max(1, Math.floor((unit.maxHp ?? 1) * share));
}

/**
 * Lays a troll down Fallen: not alive, not dead, and counting.
 * @param {object} unit
 * @param {{ rounds?: number, hp?: number }} [how]
 */
export function fall(unit, how = {}) {
  unit.alive = false;
  unit.burned = false;
  unit.fallen = { rounds: how.rounds ?? FALLEN.rounds, hp: how.hp ?? FALLEN.hp };
  return unit.fallen;
}

/** True while a Fallen unit is still coming back (`06` sections 9 and 15). */
export function isFallen(unit) {
  return Boolean(unit?.fallen && !unit.burned);
}

/**
 * Fire or holy damage finishes a Fallen unit for good — and an Item action
 * with a torch or an oil flask counts, which is why this takes damage types
 * rather than asking what the attack was.
 * @param {object} unit
 * @param {string[]} types
 */
export function burn(unit, types = []) {
  if (!isFallen(unit)) return false;
  if (!types.some((type) => FALLEN.burnedBy.includes(type))) return false;
  unit.burned = true;
  unit.fallen = null;
  return true;
}

/**
 * A monster that failed its morale check leaves on its next turn, dropping
 * half its gold where it stood, and giving no XP (`06` section 14). The turn
 * engine calls this at step 1 of a monster's turn.
 */
export function monsterFlees(combat, unit) {
  const dropped = Math.floor((unit.gold ?? 0) * FLEEING.goldDroppedShare);
  unit.fled = true;
  unit.gold = (unit.gold ?? 0) - dropped;
  combat.droppedGold = (combat.droppedGold ?? 0) + dropped;
  return { unit: unit.id, gold: dropped };
}

/**
 * The Fallen countdown of `06` section 3 step 4, one tick a round. A troll
 * that reaches zero stands up with 10 HP.
 * @returns {object[]} what came back
 */
export function tickFallen(combat) {
  const risen = [];
  for (const unit of combat.units) {
    if (!isFallen(unit) || !onField(unit)) continue;
    unit.fallen.rounds -= 1;
    if (unit.fallen.rounds > 0) continue;
    unit.hp = unit.fallen.hp;
    unit.alive = true;
    unit.fallen = null;
    risen.push(unit);
  }
  return risen;
}

/**
 * The engine's own zero-HP hooks: the Fallen countdown, and the record of
 * fire or holy damage that both the burning rule and a troll's regeneration
 * read (`06` section 5 step 3).
 *
 * @param {ReturnType<import('./hooks.js').createHooks>} hooks
 * @returns {() => void}
 */
export function registerDefeatHooks(hooks) {
  const source = 'defeat';
  const off = [];

  off.push(
    hooks.on(
      'roundStart',
      (payload) => {
        for (const unit of tickFallen(payload.combat)) payload.say(`${unit.id} rises`);
      },
      { name: 'fallenTroll', source },
    ),
  );

  off.push(
    hooks.on(
      'damageTaken',
      (payload) => {
        const types = payload.source?.types ?? [];
        if (!types.length) return;
        // What put it down, for Reassemble and Relentless to read.
        payload.target.lastDamageTypes = types;
        // Remembered until the unit's own turn end, for Troll regeneration.
        if (types.some((type) => FALLEN.burnedBy.includes(type))) payload.target.burnedSinceTurn = true;
        if (burn(payload.target, types)) payload.say(`${payload.target.id} burns`);
      },
      { name: 'fallenBurn', source },
    ),
  );

  return () => {
    for (const remove of off) remove();
  };
}
