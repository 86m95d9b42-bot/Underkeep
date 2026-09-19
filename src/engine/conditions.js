/**
 * Conditions: what they do, how long they last, and the two rules that keep a
 * solo hero's fight fair (`01` section 7, `06` section 10).
 *
 * Four rules shape everything here:
 *   - **Durations count the affected unit's own turns**, and tick at the end of
 *     that unit's turn, so a condition applied on a unit's own turn survives
 *     until the end of its *next* turn.
 *   - **Applying a condition twice refreshes it** to the longer duration, and a
 *     stronger version replaces a weaker one. Only Drained stacks.
 *   - **Control immunity**: when Stunned, Asleep, Paralyzed, Petrified or
 *     Webbed ends on the hero, that condition cannot be reapplied for 2 turns.
 *   - **Grit**: the hero never loses more than 2 turns in a row.
 *
 * A unit here is any plain object with a `conditions` map; the engine never
 * looks at what else is on it. No DOM, and every roll comes from the stream it
 * is handed.
 */
import data from '../data/conditions.json' with { type: 'json' };

/** @typedef {'body' | 'reflex' | 'mind'} SaveType */

/**
 * @typedef {object} Condition
 * @property {number | null} rounds turns left on the affected unit's own clock
 * @property {number} [dc] the save DC the source set
 * @property {string} [damage] overrides the condition's own damage dice
 * @property {number} [stacks] Drained only
 * @property {string} [source] the unit that applied it
 * @property {boolean} [appliedOnOwnTurn] set when it must skip one tick
 */

export const CONDITIONS = data.conditions;
export const CONTROL_CONDITIONS = data.controlConditions;
export const CONTROL_IMMUNITY_TURNS = data.controlImmunityTurns;
export const GRIT_LOST_TURNS = data.gritLostTurns;
export const START_OF_TURN_DAMAGE_ORDER = data.startOfTurnDamageOrder;
export const END_OF_TURN_SAVE_ORDER = data.endOfTurnSaveOrder;

/** @param {string} id */
export function spec(id) {
  const found = CONDITIONS[id];
  if (!found) throw new Error(`unknown condition: ${id}`);
  return found;
}

/** True for the five conditions that take a turn away (`01`, Solo Hero Protections). */
export function isControl(id) {
  return CONTROL_CONDITIONS.includes(id);
}

/** Everything a unit needs before the engine will touch it. */
export function prepare(unit) {
  unit.conditions ??= {};
  unit.immunities ??= [];
  unit.controlImmunity ??= {};
  unit.freshImmunity ??= [];
  unit.lostTurns ??= 0;
  return unit;
}

/** @param {object} unit @param {string} id */
export function has(unit, id) {
  return Boolean(unit.conditions?.[id]);
}

/** Every condition on a unit, in the order the data lists them. */
export function listed(unit) {
  return Object.keys(CONDITIONS).filter((id) => has(unit, id));
}

/* -------------------------------------------------------------------------- */
/* Applying and ending                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Why a condition would not land, or null when it would.
 * @param {object} unit @param {string} id
 */
export function blockedFrom(unit, id) {
  if (unit.immunities?.includes(id)) return 'immune';
  if (unit.controlImmunity?.[id] > 0) return 'controlImmunity';
  return null;
}

/**
 * Applies a condition.
 *
 * Refreshes rather than adds: the longer duration wins, a stronger damage die
 * replaces a weaker one, and only Drained stacks (`06` section 10).
 *
 * @param {object} unit
 * @param {string} id
 * @param {object} [options]
 * @param {number | null} [options.rounds] overrides the condition's own duration
 * @param {number} [options.dc] the save DC to beat to end it early
 * @param {string} [options.damage] a stronger die, as the Brood Mother's 1d6
 * @param {string} [options.source] which unit applied it
 * @param {boolean} [options.onOwnTurn] applied during the affected unit's turn
 * @returns {{ applied: boolean, why?: string, refreshed?: boolean, stacked?: boolean }}
 */
export function applyCondition(unit, id, options = {}) {
  const rules = spec(id);
  prepare(unit);

  const blocked = blockedFrom(unit, id);
  if (blocked) return { applied: false, why: blocked };

  const rounds = options.rounds ?? rules.rounds ?? null;
  const existing = unit.conditions[id];

  if (existing) {
    // Drained is the only condition that stacks (`06` section 10).
    if (rules.stacks) {
      existing.stacks = (existing.stacks ?? 1) + 1;
      return { applied: true, stacked: true };
    }
    // The longer duration wins; null means "until something ends it".
    existing.rounds =
      existing.rounds === null || rounds === null ? null : Math.max(existing.rounds, rounds);
    if (options.dc !== undefined) existing.dc = Math.max(existing.dc ?? 0, options.dc);
    // A stronger version replaces a weaker one.
    if (options.damage && strongerDamage(options.damage, existing.damage ?? rules.damagePerTurn)) {
      existing.damage = options.damage;
    }
    return { applied: true, refreshed: true };
  }

  unit.conditions[id] = {
    rounds,
    ...(options.dc !== undefined ? { dc: options.dc } : {}),
    ...(options.damage ? { damage: options.damage } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(rules.stacks ? { stacks: 1 } : {}),
    // A condition applied during the unit's own turn does not tick at the end
    // of that turn (`06` section 10).
    ...(options.onOwnTurn ? { appliedOnOwnTurn: true } : {}),
  };
  return { applied: true };
}

/** Rough strength of a damage expression, for "stronger replaces weaker". */
function strongerDamage(next, current) {
  const value = (text) => {
    const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(String(text ?? '').trim());
    if (!match) return Number(text) || 0;
    const count = match[1] === '' ? 1 : Number(match[1]);
    return count * (Number(match[2]) + 1) / 2 + Number(match[3] ?? 0);
  };
  return value(next) > value(current);
}

/**
 * Ends a condition. When a control condition ends on a unit that gets the solo
 * hero's protections, its immunity window opens (`01`, Solo Hero Protections).
 *
 * @param {object} unit
 * @param {string} id
 * @param {{ immunity?: boolean }} [options] immunity defaults to the unit's
 *   own `protected` flag, which is the hero's
 */
export function endCondition(unit, id, { immunity } = {}) {
  if (!has(unit, id)) return { ended: false };
  delete unit.conditions[id];

  const wantsImmunity = immunity ?? Boolean(unit.protected);
  if (wantsImmunity && isControl(id)) {
    unit.controlImmunity ??= {};
    unit.controlImmunity[id] = CONTROL_IMMUNITY_TURNS;
    // A control condition always ends on the affected unit's own turn — at
    // step 4, or on an end-of-turn save or tick — so the window would lose a
    // turn to that same turn's step 15. It skips the first tick, exactly as a
    // condition applied on its unit's own turn does (`06` section 10).
    unit.freshImmunity ??= [];
    if (!unit.freshImmunity.includes(id)) unit.freshImmunity.push(id);
    return { ended: true, immuneFor: CONTROL_IMMUNITY_TURNS };
  }
  return { ended: true };
}

/** Ends several at once, for Grit and for the end of a fight. */
export function endMany(unit, ids, options) {
  return ids.filter((id) => endCondition(unit, id, options).ended);
}

/* -------------------------------------------------------------------------- */
/* What conditions do                                                         */
/* -------------------------------------------------------------------------- */

/** Helpless: attacks hit automatically, and the unit loses its turn. */
export function isHelpless(unit) {
  return listed(unit).some((id) => spec(id).helpless);
}

/** True when this action is not allowed right now (`06` section 4, Legality). */
export function blocks(unit, action) {
  return listed(unit).some((id) => (spec(id).blocks ?? []).includes(action));
}

/** Which condition forbids this action, or null (`06` section 4, Legality). */
export function blockedBy(unit, action) {
  return listed(unit).find((id) => (spec(id).blocks ?? []).includes(action)) ?? null;
}

/** Everything the unit cannot do. */
export function blocked(unit) {
  const out = new Set();
  for (const id of listed(unit)) for (const action of spec(id).blocks ?? []) out.add(action);
  return [...out];
}

/** The total DEF change from conditions (Slowed and Knocked Down are −2). */
export function defMod(unit) {
  return listed(unit).reduce((total, id) => total + (spec(id).defMod ?? 0), 0);
}

/** Damage reduction from conditions — Petrified's DR 5. */
export function drFrom(unit) {
  return listed(unit).reduce((total, id) => Math.max(total, spec(id).dr ?? 0), 0);
}

/** True while the unit's weapon damage is halved (Weakened). */
export function halvesWeaponDamage(unit) {
  return listed(unit).some((id) => spec(id).halfWeaponDamage);
}

/** True when the unit must act last in the round (Slowed). */
export function actsLast(unit) {
  return listed(unit).some((id) => spec(id).actsLast);
}

/**
 * How this unit's own attack rolls are affected.
 * @returns {{ advantage: boolean, disadvantage: boolean }}
 */
export function attackMods(unit) {
  const ids = listed(unit);
  return {
    advantage: ids.some((id) => spec(id).attacksAtAdvantage),
    disadvantage: ids.some(
      (id) => spec(id).attacksAtDisadvantage || spec(id).nextAttackAtDisadvantage,
    ),
  };
}

/**
 * How attacks *against* this unit are affected.
 * @returns {{ advantage: boolean, disadvantage: boolean, autoHit: boolean }}
 */
export function defenceMods(unit) {
  const ids = listed(unit);
  return {
    advantage: ids.some((id) => spec(id).attackedWithAdvantage),
    disadvantage: ids.some((id) => spec(id).attackedWithDisadvantage),
    // Helpless means attacks hit automatically — but never as crits, for the
    // hero (`01`, Solo Hero Protections; the crit half is the attack rules').
    autoHit: ids.some((id) => spec(id).helpless),
  };
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Start-of-turn damage, in the order `06` section 4 step 5 gives. Nothing is
 * applied here: the caller takes the total through the damage rules and the
 * death check.
 *
 * @param {object} unit
 * @param {import('./rng.js').Stream} rng the combat stream
 * @returns {{ id: string, amount: number }[]}
 */
export function startOfTurnDamage(unit, rng) {
  const out = [];
  for (const id of START_OF_TURN_DAMAGE_ORDER) {
    if (!has(unit, id)) continue;
    const dice = unit.conditions[id].damage ?? spec(id).damagePerTurn;
    if (!dice) continue;
    const amount = /^\d+$/.test(String(dice)) ? Number(dice) : rng.roll(String(dice));
    out.push({ id, amount });
  }
  return out;
}

/**
 * End-of-turn saves, in the order `06` section 4 step 13 gives. A natural 20
 * always succeeds and a natural 1 always fails (`06` section 8).
 *
 * @param {object} unit
 * @param {import('./rng.js').Stream} rng the combat stream
 * @param {(type: SaveType) => number} bonusFor the unit's save bonus
 * @returns {{ id: string, roll: number, total: number, dc: number, passed: boolean }[]}
 */
export function endOfTurnSaves(unit, rng, bonusFor = () => 0) {
  const results = [];
  for (const id of END_OF_TURN_SAVE_ORDER) {
    if (!has(unit, id)) continue;
    const rules = spec(id);
    if (!rules.save) continue;
    const dc = unit.conditions[id].dc ?? 0;
    const roll = rng.d20();
    const total = roll + bonusFor(rules.save);
    const passed = roll === 20 || (roll !== 1 && total >= dc);
    results.push({ id, save: rules.save, roll, total, dc, passed });
    if (passed) endCondition(unit, id);
  }
  return results;
}

/**
 * Ticks every duration at the end of the unit's own turn (`06` section 10).
 * A condition applied during this turn waits for the next one.
 *
 * @param {object} unit
 * @returns {string[]} the conditions that ended
 */
export function tickDurations(unit) {
  const ended = [];
  for (const id of listed(unit)) {
    const state = unit.conditions[id];
    if (state.appliedOnOwnTurn) {
      state.appliedOnOwnTurn = false;
      continue;
    }
    if (state.rounds === null || state.rounds === undefined) continue;
    state.rounds -= 1;
    if (state.rounds <= 0 && endCondition(unit, id).ended) ended.push(id);
  }
  return ended;
}

/** Ticks the control-immunity windows, which also count the unit's own turns. */
export function tickControlImmunity(unit) {
  const over = [];
  const fresh = unit.freshImmunity ?? [];
  for (const [id, left] of Object.entries(unit.controlImmunity ?? {})) {
    // Opened this turn: it waits for the next one.
    if (fresh.includes(id)) continue;
    const next = left - 1;
    if (next <= 0) {
      delete unit.controlImmunity[id];
      over.push(id);
    } else {
      unit.controlImmunity[id] = next;
    }
  }
  unit.freshImmunity = [];
  return over;
}

/** Conditions that end when the round does — Sickened (`01`, `06` section 10). */
export function endOfRound(unit) {
  return listed(unit)
    .filter((id) => spec(id).endsAtRoundEnd)
    .filter((id) => endCondition(unit, id).ended);
}

/* -------------------------------------------------------------------------- */
/* The turn a condition takes away, and Grit                                  */
/* -------------------------------------------------------------------------- */

/**
 * Grit: the hero never loses more than two turns in a row (`01`, Solo Hero
 * Protections; `06` section 4 step 3). Returns the conditions it tore off, or
 * null when Grit had nothing to do.
 * @param {object} unit
 * @returns {string[] | null}
 */
export function grit(unit) {
  prepare(unit);
  if (!unit.protected || unit.lostTurns < GRIT_LOST_TURNS) return null;
  const freed = endMany(unit, CONTROL_CONDITIONS.filter((id) => has(unit, id)), { immunity: false });
  if (!freed.length) return null;
  // Grit ends them because the hero tore free, so no immunity window opens.
  unit.lostTurns = 0;
  return freed;
}

/**
 * Stunned costs this turn and then goes, opening its immunity window
 * (`06` section 4 step 4, section 5 step 2).
 * @param {object} unit
 * @returns {{ lost: 'stunned', immuneFor?: number } | null}
 */
export function stunnedStart(unit) {
  prepare(unit);
  if (!has(unit, 'stunned')) return null;
  const { immuneFor } = endCondition(unit, 'stunned');
  unit.lostTurns += 1;
  return { lost: 'stunned', immuneFor };
}

/**
 * Asleep, Paralyzed or Petrified: the turn is lost and the condition stays
 * (`06` section 4 step 8, section 5 step 5).
 * @param {object} unit
 * @returns {{ lost: string } | null}
 */
export function helplessStart(unit) {
  prepare(unit);
  if (!isHelpless(unit)) return null;
  unit.lostTurns += 1;
  return { lost: listed(unit).find((id) => spec(id).helpless) };
}

/**
 * The three checks above in the order `06` section 4 gives them, for a caller
 * that has no start-of-turn damage to fit between them. The turn engine calls
 * the parts, because the helpless check belongs after the damage and the death
 * check; this is the same rules in one call.
 *
 * @param {object} unit
 * @returns {{ acts: boolean, grit?: string[], lost?: string, immuneFor?: number }}
 */
export function startOfTurn(unit) {
  const freed = grit(unit);
  if (freed) return { acts: true, grit: freed };

  const stunned = stunnedStart(unit);
  if (stunned) return { acts: false, ...stunned };

  const helpless = helplessStart(unit);
  if (helpless) return { acts: false, ...helpless };

  unit.lostTurns = 0;
  return { acts: true };
}

/** Called when the unit actually acts: the lost-turn run is broken. */
export function acted(unit) {
  unit.lostTurns = 0;
}

/* -------------------------------------------------------------------------- */
/* Reacting to what happens                                                   */
/* -------------------------------------------------------------------------- */

/** Damage wakes a sleeper, but not the paralysed or the petrified. */
export function onDamageTaken(unit) {
  return listed(unit)
    .filter((id) => spec(id).endsOnDamage)
    .filter((id) => endCondition(unit, id).ended);
}

/** Any healing ends Bleeding (`01` section 7). */
export function onHealed(unit) {
  return listed(unit)
    .filter((id) => spec(id).endsOnHealing)
    .filter((id) => endCondition(unit, id).ended);
}

/** Hitting what holds you frees you (`06` section 8, Grab release). */
export function onHitting(unit, targetId) {
  return listed(unit)
    .filter((id) => spec(id).endsOnHittingSource && unit.conditions[id].source === targetId)
    .filter((id) => endCondition(unit, id).ended);
}

/** Fire frees a webbed unit, and burns it for 1d4 (`01` section 7). */
export function onFireDamage(unit, rng) {
  if (!has(unit, 'webbed')) return null;
  const rules = spec('webbed').freedByFire;
  endCondition(unit, 'webbed');
  return { freed: 'webbed', damage: rng ? rng.roll(rules.damage) : 0 };
}

/**
 * Attacking or using an active skill ends Hidden, and a unit's own attack ends
 * Knocked Down (`01` section 7, `06` sections 4 and 10). Defending, waiting or
 * drinking a potion is none of those, so a caller that knows what the action
 * was passes `active: false` and stays Hidden.
 */
export function onOwnAction(unit, { attacked = false, active = true } = {}) {
  const ended = [];
  for (const id of listed(unit)) {
    const rules = spec(id);
    if ((active && rules.endsOnAction) || (attacked && rules.endsAfterOwnAttack)) {
      if (endCondition(unit, id).ended) ended.push(id);
    }
  }
  return ended;
}

/**
 * Break Free from a web: d20 + the better of Might or Agility against TN 12
 * (`06` section 4). It costs the action either way.
 *
 * @param {object} unit
 * @param {import('./rng.js').Stream} rng
 * @param {number} bonus the better of the two modifiers
 */
export function breakFree(unit, rng, bonus = 0) {
  const roll = rng.d20();
  const total = roll + bonus;
  const freed = total >= data.breakFreeTn;
  if (freed) endCondition(unit, 'webbed');
  return { roll, bonus, total, tn: data.breakFreeTn, freed };
}

/* -------------------------------------------------------------------------- */
/* When the fight ends                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Clears what a fight leaves behind (`06` section 10, After Combat): Weakened
 * and Drained stay, Poisoned carries on as exploration poison, and everything
 * else ends — buffs, temporary HP and Hidden included.
 *
 * @param {object} unit
 * @returns {{ kept: string[], exploration: string[], ended: string[] }}
 */
export function afterCombat(unit) {
  const kept = [];
  const exploration = [];
  const ended = [];

  for (const id of listed(unit)) {
    if (data.afterCombat.keep.includes(id)) {
      kept.push(id);
      continue;
    }
    if (data.afterCombat.becomesExploration.includes(id)) {
      exploration.push(id);
      continue;
    }
    if (endCondition(unit, id, { immunity: false }).ended) ended.push(id);
  }
  unit.controlImmunity = {};
  unit.lostTurns = 0;
  return { kept, exploration, ended };
}

/** How exploration poison works once the fight is over (`06` section 10). */
export const EXPLORATION_POISON = data.afterCombat.explorationPoison;

export { data as conditionData };
