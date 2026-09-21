/**
 * The abilities a monster spends its turn on that are not attacks
 * (`02` sections 6 and 9, `06` section 11's *support* archetype).
 *
 * Three so far: the Goblin Shaman mends a hurt ally and hexes the hero, and
 * the Cultist's Dark Prayer makes a zealot hit harder for the rest of the
 * fight. Each is an ability with its own `action`, so the AI picks it the
 * same way it picks a spell, and the turn engine resolves it through the same
 * `resolveAction` chain as everything else.
 *
 * No DOM, and the numbers are the stat block's.
 */
import { applyCondition } from './conditions.js';
import { rollSave } from './riders.js';
import { countedEnemies } from './field.js';

/** Allies of this monster that are still standing. */
function allies(combat, unit) {
  return countedEnemies(combat).filter((other) => other !== unit && other.alive);
}

/**
 * Resolves one support action, or null when this is not one.
 *
 * @param {object} combat
 * @param {object} unit the monster acting
 * @param {object} action from `actionFor`
 * @returns {object | null} what happened, for the log
 */
export function resolveSupport(combat, unit, action) {
  if (action?.id === 'heal') return mend(combat, unit, action);
  if (action?.id === 'buff') return bless(combat, unit, action);
  if (action?.id === 'hex') return hex(combat, unit, action);
  return null;
}

/** Mend Kin: 2d4 to the most hurt ally below half HP, three times a fight. */
function mend(combat, unit, action) {
  const hurt = allies(combat, unit)
    .filter((ally) => ally.hp < (ally.maxHp ?? 0) * (action.allyBelow ?? 0.5))
    .sort((a, b) => a.hp / (a.maxHp ?? 1) - b.hp / (b.maxHp ?? 1));
  const target = hurt[0];
  if (!target) return { id: action.id, ability: action.ability, nothing: true };

  const healed = Math.min((target.maxHp ?? 0) - target.hp, combat.rng.roll(action.heal ?? '2d4'));
  target.hp += healed;
  return {
    id: 'heal',
    ability: action.ability,
    name: action.name,
    attacker: unit.id,
    target: target.id,
    healed,
  };
}

/** Dark Prayer: an ally hits harder for the rest of the fight. */
function bless(combat, unit, action) {
  const choices = allies(combat, unit).filter((ally) => !ally.blessedBy);
  const target = choices.find((ally) => ally.row === 'front') ?? choices[0];
  if (!target) return { id: action.id, ability: action.ability, nothing: true };

  for (const [stat, amount] of Object.entries(action.buff ?? {})) {
    target[stat] = (target[stat] ?? 0) + amount;
  }
  target.blessedBy = unit.id;
  return {
    id: 'buff',
    ability: action.ability,
    name: action.name,
    attacker: unit.id,
    target: target.id,
    buff: action.buff,
  };
}

/** Hex: a Mind save, or the hero's next attack is made at disadvantage. */
function hex(combat, unit, action) {
  const hero = combat.hero;
  const dc = action.save?.dc ?? 11;
  const save = rollSave(hero, action.save?.type ?? 'mind', dc, combat.rng);
  const applied = save.passed
    ? { applied: false }
    : applyCondition(hero, action.applies ?? 'hexed', { dc, source: unit.id });
  return {
    id: 'hex',
    ability: action.ability,
    name: action.name,
    attacker: unit.id,
    target: hero.id,
    save,
    condition: applied.applied ? (action.applies ?? 'hexed') : null,
  };
}
