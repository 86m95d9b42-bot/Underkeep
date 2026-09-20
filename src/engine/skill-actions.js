/**
 * Using an active skill in a fight (`01` section 6, through `06` section 4).
 *
 * A skill's `action` block in `skills.json` is data, not code: this turns one
 * into the action the turn engine already knows how to resolve. An attacking
 * skill becomes an attack with the skill's own modifiers folded in, so it goes
 * through every step of `06` section 6 and 7 exactly as a swing does — the
 * same roll, the same crit, the same damage order. A healing skill is resolved
 * here, because nothing else in the engine hands hit points back.
 *
 * What a fight cannot play yet says so by name rather than silently doing
 * nothing: `NOT_YET` is the list, and each entry names the phase that brings
 * it. The Combat: Skills sheet dims those and gives the reason.
 */
import { modFor } from '../data/attributes.js';
import { skill } from '../data/skills.js';
import { resolveAttack, resolveAttacks } from './attack.js';
import { parsePart } from './damage.js';

/**
 * Action shapes a fight cannot resolve yet, and what each waits for. A skill
 * whose action has one of these keys is offered, dimmed, with its reason.
 */
export const NOT_YET = {
  buff: 'buffs',
  choose: 'buffs',
  removes: 'conditions',
  opens: 'exploration',
  disarms: 'exploration',
  target: 'rows',
  only: 'rows',
  area: 'rows',
};

/** Why this skill cannot be used as an action at all, or null. */
export function whyNotPlayable(id) {
  const entry = skill(id);
  if (!entry?.action) return 'notAnAction';
  const waiting = Object.keys(NOT_YET).find((key) => entry.action[key] !== undefined);
  return waiting ? NOT_YET[waiting] : null;
}

/** The weapon a melee skill swings, which is the one the hero is holding. */
function weaponOf(unit) {
  return unit.attack ?? { kind: 'melee', damage: '1d4 crush', name: 'fists' };
}

/**
 * Turns one learned skill into an action.
 *
 * @param {object} unit the hero using it
 * @param {string} id the skill's id
 * @param {object} [options]
 * @param {string} [options.target] the unit id it is aimed at
 * @returns {{ action?: object, why?: string }}
 */
export function actionForSkill(unit, id, { target } = {}) {
  const entry = skill(id);
  const why = whyNotPlayable(id);
  if (why) return { why };

  const act = entry.action;
  const base = { id: 'skill', skill: id, fp: entry.fp ?? 0, tags: [entry.path] };

  if (act.heal) {
    return { action: { ...base, heal: act.heal } };
  }

  const weapon = weaponOf(unit);
  const attack = {
    // A melee skill is the hero's own weapon, swung differently; a spell
    // brings its own dice.
    ...(act.kind === 'melee' ? { name: weapon.name, damage: weapon.damage } : {}),
    ...(act.damage ? { damage: act.damage } : {}),
    kind: act.kind ?? 'melee',
    atkMod: act.toHit ?? 0,
    autoHit: act.autoHit,
    attacks: act.attacks,
    target,
    extraDice: extraDiceFor(act, weapon),
    // Smite adds WIT to the roll as well as its dice (`01` section 6).
    ...(act.addModToHit ? { atkMod: (act.toHit ?? 0) + modFor(unit.attributes?.[act.addModToHit]) } : {}),
    // A spell's damage uses its own attribute, where it names one.
    ...(act.addMod ? { damageAttribute: act.addMod } : {}),
  };

  return {
    action: {
      ...base,
      tags: [...base.tags, 'attack'],
      kind: attack.kind,
      needsTarget: true,
      target,
      attack,
    },
  };
}

/** A skill's extra damage: more of the weapon's own dice, or dice of its own. */
function extraDiceFor(act, weapon) {
  const extra = [];
  if (act.extraWeaponDice) {
    const part = parsePart(weapon.damage ?? '1d4');
    for (let i = 0; i < act.extraWeaponDice; i += 1) {
      extra.push(`${part.count}d${part.sides}${part.type ? ` ${part.type}` : ''}`);
    }
  }
  if (act.extraDice) extra.push(act.extraDice);
  return extra.length ? extra : undefined;
}

/**
 * Heals a unit, never above its maximum. The amount is rolled first and
 * reported whole, so the log can say what the skill was worth even when some
 * of it was wasted (`06` section 1: resolve first, render second).
 *
 * @param {object} combat
 * @param {object} unit
 * @param {{ dice?: string, addMod?: string, shareOfMaxHp?: number }} heal
 */
export function resolveHeal(combat, unit, heal) {
  const rolled = heal.dice ? combat.rng.roll(heal.dice) : 0;
  const share = heal.shareOfMaxHp ? Math.floor(unit.maxHp * heal.shareOfMaxHp) : 0;
  const mod = heal.addMod ? modFor(unit.attributes?.[heal.addMod]) : 0;
  const amount = Math.max(0, rolled + share + mod);

  const before = unit.hp ?? 0;
  unit.hp = Math.min(unit.maxHp ?? before, before + amount);
  return { healed: unit.hp - before, rolled: amount, hp: unit.hp, maxHp: unit.maxHp };
}

/**
 * The `resolveAction` a fight adds to the engine's own: a skill action.
 * Anything else is left to the caller's next resolver.
 */
export function resolveSkillAction(combat, unit, action, services = {}) {
  if (action.id !== 'skill') return null;
  if (action.heal) return { skill: action.skill, ...resolveHeal(combat, unit, action.heal) };
  if (!action.attack) return null;

  const attack = { ...action.attack, target: action.target ?? action.attack.target };
  return attack.attacks > 1
    ? resolveAttacks(combat, unit, attack, services)
    : resolveAttack(combat, unit, attack, services);
}
