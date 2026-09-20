/**
 * What the hero's gear does in a fight (`04` sections 4, 6 and 7, on
 * `06` section 16's events).
 *
 * The sheet half of an item's effects — a charm's +1 DEF, a curse's -3 Focus —
 * is folded into the hero when the gear changes (`skill-hooks.js`). This is
 * the other half: the effects that need a hit, a kill or a round to have
 * happened. Flaming's fire die, Venomous' critical, Thorned's answer to a
 * melee attacker, the Bloodstone's healing after the fight.
 *
 * Every one is data: the item, its property or its curse names an event and a
 * handler, and the handler is written once here for whatever names it. A
 * handler that waits on another phase is listed in `PENDING` with the reason,
 * and `npm run data` fails on a handler that is neither.
 *
 * No DOM, and no special case for a particular item.
 */
import { applyCondition, blockedFrom } from './conditions.js';
import { parsePart, resolveDamage } from './damage.js';
import { HANDLERS as SKILL_HANDLERS } from './skill-hooks.js';
import { modFor } from '../data/attributes.js';

/**
 * Handlers whose systems are not built yet, each with what it waits for.
 */
export const PENDING = {
  whisperBackstab: 'The extra weapon die rides on Backstab, which is still pending itself.',
  storeScroll: 'A scroll cast from the ring needs the Reaction prompt and the rest (Phase 8).',
};

/** Whether an effect's conditions hold for this hit. */
function applies(effect, payload) {
  const attack = payload.attack ?? {};
  const kind = attack.kind ?? 'melee';
  // A spell is never a weapon's doing.
  if (kind === 'spell' && !effect.spells) return false;
  if (effect.attack && effect.attack !== kind) return false;
  if (effect.vs && !effect.vs.includes(payload.target?.family)) return false;
  // "+1 crush damage" only when the blow is a crushing one.
  if (effect.whenType) {
    const main = (payload.parts ?? []).find((part) => part.main) ?? (payload.parts ?? [])[0];
    if (main?.type !== effect.whenType) return false;
  }
  return true;
}

/**
 * The handlers that are written. Each takes the fight's register, the unit and
 * the effect's own numbers, and returns its removers — the same shape
 * `skill-hooks.js` and `monster-traits.js` use.
 * @type {Record<string, (hooks: any, unit: object, effect: object) => (() => void)[]>}
 */
export const HANDLERS = {
  /**
   * A die or a point of extra damage on every hit: Flaming, Frost, Holy, the
   * Ram's Horn, the Hunter's Tooth (`04` sections 4 and 7).
   */
  extraDamage(hooks, unit, effect) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit) return;
          if (payload.overTime) return;
          if (!applies(effect, payload)) return;
          if (effect.add) {
            // Step 2 of `06` section 7: an extra part is its own damage, and
            // a critical doubles its dice with the rest.
            payload.parts.push(parsePart(effect.add, { type: effect.damageType }));
          } else {
            payload.flat = (payload.flat ?? 0) + (effect.value ?? 0);
          }
        },
        { name: 'extraDamage', owner: unit.id, source: 'items' },
      ),
    ];
  },

  /**
   * A property that works on a critical hit: Frost Slows, Venomous Poisons,
   * Thundering Stuns (`04` section 4). No save — the document gives none.
   */
  onCritCondition(hooks, unit, effect) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || !payload.target) return;
          if (effect.onCrit && !payload.result?.crit) return;
          const blocked = blockedFrom(payload.target, effect.condition);
          if (blocked) return;
          const applied = applyCondition(payload.target, effect.condition, {
            source: unit.id,
            onOwnTurn: false,
          });
          if (applied.applied) payload.say(`${payload.target.id} is ${effect.condition}`);
        },
        { name: 'onCritCondition', owner: unit.id, source: 'items' },
      ),
    ];
  },

  /** Vampiric: heal 2 HP on each hit (`04` section 4). */
  vampiric(hooks, unit, effect) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit) return;
          const healed = Math.min(unit.maxHp ?? unit.hp, unit.hp + (effect.heal ?? 2)) - unit.hp;
          if (healed <= 0) return;
          unit.hp += healed;
          payload.healing = (payload.healing ?? 0) + healed;
        },
        { name: 'vampiric', owner: unit.id, source: 'items' },
      ),
    ];
  },

  /** Thorned: a melee attacker takes 1d4 each time they hit you. */
  thorned(hooks, unit, effect) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit) return;
          const attacker = payload.attacker;
          if (!attacker || attacker === unit || !attacker.alive) return;
          const kind = payload.attack?.kind ?? 'melee';
          if (!(effect.from ?? ['melee']).includes(kind)) return;
          const amount = payload.combat.rng.roll(effect.damage ?? '1d4');
          resolveDamage(payload.combat, {
            attacker: unit,
            target: attacker,
            attack: { damage: `${amount}`, kind: 'thorns', noAttributeDamage: true },
          });
          payload.say(`${attacker.id} is torn on the thorns`);
        },
        { name: 'thorned', owner: unit.id, source: 'items' },
      ),
    ];
  },

  /** The Bloodstone: heal 1d6 + VIG mod after every combat (`04` section 7). */
  bloodstone(hooks, unit, effect) {
    return [
      hooks.on(
        'combatEnd',
        (payload) => {
          if (payload.outcome !== 'victory' || !unit.alive) return;
          const bonus = effect.plus === 'vigorMod' ? modFor(unit.attributes?.vigor) : 0;
          const rolled = payload.combat.rng.roll(effect.heal ?? '1d6') + bonus;
          const healed = Math.min(unit.maxHp ?? unit.hp, unit.hp + Math.max(0, rolled)) - unit.hp;
          unit.hp += healed;
          payload.healing = (payload.healing ?? 0) + healed;
        },
        { name: 'bloodstone', owner: unit.id, source: 'items' },
      ),
    ];
  },

  /** Whisper: after a kill, you become Hidden (`04` section 13). */
  hiddenOnKill(hooks, unit, effect) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (payload.attacker !== unit) return;
          const applied = applyCondition(unit, effect.condition ?? 'hidden', { source: unit.id });
          if (applied.applied) payload.say(`${unit.id} slips out of sight`);
        },
        { name: 'hiddenOnKill', owner: unit.id, source: 'items' },
      ),
    ];
  },

  /** Ring of Regeneration: the same healing a skill gives, from an item. */
  regeneration(hooks, unit, effect) {
    return SKILL_HANDLERS.regeneration(hooks, unit, effect, 1);
  },
};

/**
 * Registers everything the unit's gear hangs off an event. Returns a remover,
 * so a fight can be torn down and rebuilt without leaking hooks.
 *
 * @param {object} combat
 * @param {object} [unit] the hero, whose `gear.effects` the pack gathered
 * @returns {() => void}
 */
export function registerItems(combat, unit = combat.hero) {
  const off = [];
  for (const effect of unit?.gear?.effects ?? []) {
    if (!effect.hook) continue;
    const handler = HANDLERS[effect.handler];
    if (!handler) {
      // A handler waiting on another phase is listed in PENDING; anything
      // else is a typo, and the data check catches it before this runs.
      if (!PENDING[effect.handler]) throw new Error(`unknown item handler: ${effect.handler}`);
      continue;
    }
    off.push(...handler(combat.hooks, unit, effect));
  }
  return () => {
    for (const remove of off) remove();
  };
}

/** Every handler an item names, for the data check. */
export function handlerNames(effects = []) {
  return effects.filter((effect) => effect.hook).map((effect) => effect.handler);
}
