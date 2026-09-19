/**
 * The engine's own hooks, in one place.
 *
 * `06` section 16 says every rule hangs off an event, and three sets of them
 * belong to the engine rather than to any skill or trait: the conditions, the
 * zero-HP ladder's Fallen countdown, and morale with the row movement behind
 * it. A fight registers these once, at setup, before `combatStart` fires.
 *
 * Skills, items, elite traits and boss phases register on top of these, and
 * the documented order sorts them all.
 */
import { registerConditionHooks } from './condition-hooks.js';
import { registerDefeatHooks } from './defeat.js';
import { registerMonsterTraits } from './monster-traits.js';
import { registerMoraleHooks } from './morale.js';
import { registerRiders } from './riders.js';
import { conditionHurt } from './damage.js';

/**
 * Registers every rule the engine owns on a fight's register.
 *
 * @param {object} combat
 * @param {object} [services]
 * @param {(unit: object, save: string) => number} [services.saveBonus]
 * @returns {() => void} removes them all again
 */
export function registerRules(combat, services = {}) {
  const hooks = combat.hooks;
  if (!hooks) return () => {};

  const off = [
    registerConditionHooks(hooks, {
      rng: combat.rng,
      saveBonus: services.saveBonus,
      // Condition damage goes through the damage rules, so a fire-immune unit
      // ignores Burning (`06` section 7).
      hurt: conditionHurt(combat),
    }),
    registerDefeatHooks(hooks),
    registerMoraleHooks(hooks),
    // `06` section 8's on-hit riders, and then the traits of whatever is
    // standing on the field.
    registerRiders(hooks),
    registerMonsterTraits(combat),
  ];

  return () => {
    for (const remove of off) remove();
  };
}
