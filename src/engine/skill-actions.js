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
 * Five shapes, each read off the block rather than off the skill's name:
 *
 *   - **attack** (`kind`): Power Strike, Frost Shard, Magic Missile, Smite,
 *     Death Strike, Twin Shot, Shield Bash;
 *   - **row** (`target: "row"`): Fireball, Sleep, Turn Undead — every enemy in
 *     the row the hero points at;
 *   - **heal** (`heal`): Mend, Second Wind;
 *   - **buff** (`buff`, `choose`): Envenom, Blink, Spirit Ward, Hunter's Mark,
 *     Vanish — a state the fight keeps, which the skill's own hooks read;
 *   - **cleanse** (`removes`): Cleanse.
 *
 * What a fight cannot play yet says so by name rather than silently doing
 * nothing: `NOT_YET` is the list. The Combat: Skills sheet dims those and
 * gives the reason.
 */
import { DERIVED, modFor } from '../data/attributes.js';
import { PATHS, skill } from '../data/skills.js';
import { resolveAttack, resolveAttacks } from './attack.js';
import { dealDamage, parsePart } from './damage.js';
import { applyCondition, endCondition, has, listed, spec } from './conditions.js';
import { isTargetable, targetableEnemies, unitById } from './field.js';
import { rollSave } from './riders.js';
import { zeroHp } from './defeat.js';
// Called only at run time, so the two modules may name each other.
import { skillsOf } from './skill-hooks.js';

/**
 * Action shapes a fight cannot resolve yet, and what each waits for. A skill
 * whose action has one of these keys is offered, dimmed, with its reason.
 */
export const NOT_YET = {
  opens: 'exploration',
  disarms: 'exploration',
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
 * The attribute a skill's DC answers to: its Path's first (`01` section 6's
 * headings). A Crossroads skill takes the first of its first Path.
 */
function governingAttribute(entry) {
  const path = entry.path === 'crossroads' ? entry.paths?.[0] : entry.path;
  return PATHS[path]?.attributes?.[0] ?? 'wits';
}

/**
 * A player ability's DC: **10 + ⌊level ÷ 2⌋ + the governing attribute mod**
 * (`01` section 4, Effect DCs).
 */
export function skillDc(unit, id) {
  const rule = DERIVED.effectDc;
  return (
    rule.base +
    Math.floor((unit.level ?? 1) / rule.perLevels) +
    modFor(unit.attributes?.[governingAttribute(skill(id))])
  );
}

/**
 * What the skill costs this unit: its FP, less Archmage's 1 on a spell, never
 * below 1 (`01` section 6).
 */
export function costOf(unit, id) {
  const entry = skill(id);
  const base = entry.fp ?? 0;
  if (base <= 0 || entry.path !== 'arcana' || !unit.spellCost) return base;
  return Math.max(1, base + unit.spellCost);
}

/* -------------------------------------------------------------------------- */
/* What the fight keeps for a skill                                           */
/* -------------------------------------------------------------------------- */

/**
 * The fight's own record of one unit's skills: uses of the once-per-combat
 * ones, and the buffs that are up. It lives on the combat, not the hero, so
 * nothing outlives the fight (`06` section 10, After Combat).
 * @returns {{ uses: Record<string, number>, buffs: Record<string, any> }}
 */
export function skillStateOf(combat, unit) {
  combat.skillState ??= {};
  combat.skillState[unit.id] ??= { uses: {}, buffs: {} };
  return combat.skillState[unit.id];
}

/** A buff this unit has up, or null. Blink runs out with its rounds. */
export function buffOf(combat, unit, id) {
  const buff = combat?.skillState?.[unit?.id]?.buffs?.[id];
  if (buff === undefined || buff === null) return null;
  if (buff.untilRound !== undefined && (combat.round ?? 0) > buff.untilRound) return null;
  return buff;
}

/** The harmful conditions a unit carries, which Cleanse can lift. */
function cleansable(unit) {
  return listed(unit).filter((id) => !spec(id)?.buff);
}

/* -------------------------------------------------------------------------- */
/* Building the action                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Why this unit cannot use this skill right now, beyond Focus and targets —
 * which the legality rules already answer — or null.
 */
function whyNotNow(combat, unit, id, target, { fromItem = false } = {}) {
  const entry = skill(id);
  const act = entry.action;

  // Only what the hero has learned, or what their gear grants — a scroll
  // casts what is written on it (`04` section 9).
  if (!fromItem && !skillsOf(unit).some((known) => known.id === id)) return 'notLearned';

  // Shield Bash needs a shield on the arm (`01` section 6).
  if (entry.requires?.equipped === 'shield' && !unit.gear?.shield) return 'needsShield';

  // Once per combat: Second Wind, Vanish, Envenom.
  if (act.limit && combat) {
    const used = skillStateOf(combat, unit).uses[id] ?? 0;
    if (used >= act.limit.uses) return 'usedUp';
  }

  // Death Strike wants an opening: a helpless or surprised target, or a hero
  // who is Hidden (`01` section 6).
  if (act.vs && combat) {
    if (!(act.vs.includes('hidden') && has(unit, 'hidden'))) {
      const at = target ? unitById(combat, target) : null;
      const open = (one) => one && act.vs.some((c) => (c === 'surprised' ? one.surprised : has(one, c)));
      const any = at ? open(at) : targetableEnemies(combat).some(open);
      if (!any) return 'needsOpening';
    }
  }

  if (act.removes && cleansable(unit).length === 0) return 'nothingToCleanse';
  if (act.buff && combat && !act.limit && act.buff !== 'huntersMark' && buffOf(combat, unit, act.buff)) {
    return 'alreadyUp';
  }
  return null;
}

/**
 * Turns one learned skill into an action.
 *
 * @param {object} unit the hero using it
 * @param {string} id the skill's id
 * @param {object} [options]
 * @param {string} [options.target] the unit id it is aimed at
 * @param {object} [options.combat] the fight, for what depends on it
 * @param {string} [options.choose] which of Vanish's two uses
 * @param {boolean} [options.fromItem] cast from a scroll, which needs no learning
 * @returns {{ action?: object, why?: string }}
 */
export function actionForSkill(unit, id, { target, combat, choose, fromItem = false } = {}) {
  const entry = skill(id);
  const why = whyNotPlayable(id) ?? whyNotNow(combat, unit, id, target, { fromItem });
  if (why) return { why };

  const act = entry.action;
  const base = {
    id: 'skill',
    skill: id,
    fp: costOf(unit, id),
    tags: [entry.path],
    ...(act.limit ? { limit: act.limit } : {}),
  };

  if (act.heal) return { action: { ...base, heal: act.heal } };
  if (act.removes) return { action: { ...base, removes: act.removes } };
  if (act.choose) return { action: { ...base, choose: choose ?? act.choose[act.choose.length - 1] } };
  if (act.buff) {
    const aimed = act.buff === 'huntersMark';
    return {
      action: {
        ...base,
        buff: act.buff,
        ...(act.rounds ? { rounds: act.rounds } : {}),
        ...(aimed ? { needsTarget: true, target, mark: { toHit: act.toHit ?? 0, extraDice: act.extraDice } } : {}),
      },
    };
  }

  // A row spell is aimed at one enemy and lands on everyone beside it.
  if (act.target === 'row') {
    return {
      action: {
        ...base,
        tags: [...base.tags, 'attack'],
        kind: act.kind ?? 'spell',
        needsTarget: true,
        target,
        row: rowSpell(unit, id, act),
      },
    };
  }

  const weapon = weaponOf(unit);
  const attack = {
    // A melee or ranged skill is the hero's own weapon, swung or loosed
    // differently — Twin Shot is two arrows from the bow; a spell brings its
    // own dice.
    ...(act.kind === 'melee' || act.kind === 'ranged' ? { name: weapon.name, damage: weapon.damage } : {}),
    ...(act.damage ? { damage: act.damage } : {}),
    kind: act.kind ?? 'melee',
    atkMod: act.toHit ?? 0,
    autoHit: act.autoHit,
    attacks: missilesOf(unit, act) ?? act.attacks,
    target,
    extraDice: extraDiceFor(act, weapon),
    // Smite adds WIT to the roll as well as its dice (`01` section 6).
    ...(act.addModToHit ? { atkMod: (act.toHit ?? 0) + modFor(unit.attributes?.[act.addModToHit]) } : {}),
    // A spell's damage uses its own attribute, where it names one.
    ...(act.addMod ? { damageAttribute: act.addMod } : {}),
    // Shield Bash's stun and Frost Shard's slow are riders like a monster's,
    // at the hero's own DC.
    ...(act.onHit?.condition ? { onHit: { ...act.onHit, dc: skillDc(unit, id) } } : {}),
    ...(act.onHit?.orDies ? { deathStrike: { dc: skillDc(unit, id), save: act.onHit.save } } : {}),
    ...(act.doubleVs ? { doubleVs: act.doubleVs } : {}),
    skill: id,
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

/** Magic Missile: 1 missile, and 1 more per 4 levels, to 5 (`01` section 6). */
function missilesOf(unit, act) {
  const rule = act.missiles;
  if (!rule) return undefined;
  return Math.min(rule.max, rule.base + Math.floor((unit.level ?? 1) / rule.perLevels));
}

/** What a row spell does to each enemy it reaches. */
function rowSpell(unit, id, act) {
  const level = unit.level ?? 1;
  const dc = skillDc(unit, id);
  const spell = { id, dc, save: act.save, only: act.only, immune: act.immune };
  if (act.damage?.perLevel) {
    const part = parsePart(act.damage.perLevel);
    const dice = Math.min(act.damage.maxDice ?? level, level) * part.count;
    spell.damage = `${dice}d${part.sides}${act.damage.type ? ` ${act.damage.type}` : ''}`;
    spell.half = act.onSave === 'half';
    spell.area = Boolean(act.area);
  }
  if (act.condition) spell.condition = act.condition;
  if (act.maxHd) spell.maxHd = level * (act.maxHd.perLevel ?? 1) + (act.maxHd.plus ?? 0);
  if (act.fleesAtHd) spell.fleesAtHd = level * act.fleesAtHd.perLevel;
  if (act.destroysAtHd) spell.destroysAtHd = Math.floor(level * act.destroysAtHd.perLevel);
  return spell;
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

/* -------------------------------------------------------------------------- */
/* Resolving it                                                               */
/* -------------------------------------------------------------------------- */

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
  const state = skillStateOf(combat, unit);
  if (action.limit) state.uses[action.skill] = (state.uses[action.skill] ?? 0) + 1;

  if (action.heal) return { skill: action.skill, ...resolveHeal(combat, unit, action.heal) };
  if (action.removes) return resolveCleanse(unit, action);
  if (action.choose) return resolveVanish(combat, unit, action);
  if (action.buff) return resolveBuff(combat, unit, action, state);
  if (action.row) return resolveRow(combat, unit, action, services);
  if (!action.attack) return null;

  const target = unitById(combat, action.target ?? action.attack.target);
  const attack = {
    ...action.attack,
    target: target ?? action.target ?? action.attack.target,
    fromHiding: action.fromHiding,
    damageMultiplier: multiplierFor(action.attack, target),
  };
  const result = attack.attacks > 1
    ? resolveAttacks(combat, unit, attack, services)
    : resolveAttack(combat, unit, attack, services);
  if (attack.deathStrike) finishDeathStrike(combat, unit, attack, result);
  return result;
}

/**
 * Death Strike triples its damage against a boss, and Smite doubles against
 * the undead and demons (`01` section 6).
 */
function multiplierFor(attack, target) {
  if (!target) return 1;
  if (attack.deathStrike && target.boss) return 3;
  if (attack.doubleVs?.includes(target.family)) return 2;
  return 1;
}

/** A Death Strike that hits anything but a boss: a Body save, or it dies. */
function finishDeathStrike(combat, unit, attack, result) {
  if (!result?.hit || result.killed) return;
  const target = unitById(combat, result.target);
  if (!target || target.boss || !target.alive) return;
  const save = rollSave(target, attack.deathStrike.save ?? 'body', attack.deathStrike.dc, combat.rng);
  result.deathSave = save;
  if (save.passed) return;
  dealDamage(combat, target, target.hp, { attacker: unit, attack });
  const zero = zeroHp(combat, target, { attacker: unit, attack, result, cause: 'attack' });
  if (zero.died) result.killed = true;
}

/** Cleanse: the first harmful condition comes off (`01` section 6). */
function resolveCleanse(unit, action) {
  const lifted = cleansable(unit).slice(0, action.removes ?? 1);
  for (const id of lifted) endCondition(unit, id);
  return { skill: action.skill, cured: lifted };
}

/**
 * Vanish: become Hidden, or flee outright. The fight offers the flight only
 * where fleeing is allowed; a boss arena leaves the hiding.
 */
function resolveVanish(combat, unit, action) {
  if (action.choose === 'flee') return { skill: action.skill, flee: true };
  const applied = applyCondition(unit, 'hidden', { source: unit.id, onOwnTurn: true });
  return { skill: action.skill, buff: 'hidden', applied: applied.applied };
}

/** Envenom, Blink, Spirit Ward and Hunter's Mark: the fight remembers them. */
function resolveBuff(combat, unit, action, state) {
  const buff = { since: combat.round ?? 0 };
  if (action.rounds) buff.untilRound = (combat.round ?? 0) + action.rounds - 1;
  if (action.mark) {
    buff.target = action.target;
    Object.assign(buff, action.mark);
  }
  state.buffs[action.buff] = buff;
  return { skill: action.skill, buff: action.buff };
}

/**
 * Fireball, Sleep and Turn Undead: the row of the enemy pointed at, each one
 * resolved in turn. A row spell rolls no attack; what it asks for is a save
 * (`06` section 6, Attack Modifiers: area saves don't pay Half Cover).
 */
function resolveRow(combat, unit, action, services) {
  const aimed = unitById(combat, action.target);
  const spell = action.row;
  const row = aimed?.row;
  const caught = targetableEnemies(combat).filter(
    (enemy) => isTargetable(enemy) && enemy.row === row && !enemy.object,
  );
  const results = [{ skill: action.skill, used: true }];

  for (const enemy of caught) {
    if (!enemy.alive && !isTargetable(enemy)) continue;
    // Turn Undead only answers to the undead, and Sleep never to them.
    if (spell.only && !spell.only.includes(enemy.family)) continue;
    if (spell.immune?.includes(enemy.family)) {
      results.push({ target: enemy.id, unaffected: true });
      continue;
    }

    if (spell.damage) {
      results.push(
        resolveAttack(
          combat,
          unit,
          {
            kind: 'spell',
            name: action.skill,
            skill: action.skill,
            autoHit: true,
            canCrit: false,
            area: spell.area,
            damage: spell.damage,
            noAttributeDamage: true,
            fromHiding: action.fromHiding,
            save: { type: spell.save, dc: spell.dc, half: spell.half },
            target: enemy,
          },
          services,
        ),
      );
      continue;
    }

    if (spell.condition) {
      if (spell.maxHd !== undefined && (enemy.hd ?? 0) > spell.maxHd) {
        results.push({ target: enemy.id, unaffected: true });
        continue;
      }
      results.push(
        resolveAttack(
          combat,
          unit,
          {
            kind: 'spell',
            ability: action.skill,
            name: action.skill,
            autoHit: true,
            canCrit: false,
            onHit: { save: spell.save, dc: spell.dc, condition: spell.condition },
            target: enemy,
          },
          services,
        ),
      );
      continue;
    }

    if (spell.fleesAtHd !== undefined) results.push(turnOne(combat, unit, enemy, spell));
  }
  return results;
}

/**
 * Turn Undead on one of them: a Mind save, or it flees — or, if it is weak
 * enough, it is destroyed. A boss is neither (docs/DECISIONS.md).
 */
function turnOne(combat, unit, enemy, spell) {
  if (enemy.boss || (enemy.hd ?? 0) > spell.fleesAtHd) return { target: enemy.id, unaffected: true };
  const save = rollSave(enemy, spell.save ?? 'mind', spell.dc, combat.rng);
  if (save.passed) return { target: enemy.id, saved: true, save };
  if ((enemy.hd ?? 0) <= spell.destroysAtHd) {
    dealDamage(combat, enemy, enemy.hp, { attacker: unit });
    const zero = zeroHp(combat, enemy, { attacker: unit, cause: 'attack' });
    return { target: enemy.id, turnUndead: 'destroyed', killed: zero.died, save };
  }
  enemy.fleeing = true;
  return { target: enemy.id, turnUndead: 'fled', save };
}
