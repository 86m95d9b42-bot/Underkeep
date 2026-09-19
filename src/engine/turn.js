/**
 * The hero's turn and a monster's turn (`06` sections 4 and 5).
 *
 * ```text
 * HERO                              MONSTER
 *  1 Hidden check                    1 Fleeing: leave, drop half its gold
 *  2 the Defend bonus ends           2 Stunned: remove it, lose the turn
 *  3 Grit                            3 start-of-turn damage, then healing
 *  4 Stunned: remove it, lose        4 death check
 *  5 start-of-turn damage            5 helpless: lose the turn
 *  6 start-of-turn healing           6 recharge rolls
 *  7 death check                     7 free start-of-turn traits
 *  8 helpless: lose the turn         8 a waiting telegraph resolves
 *  9 the action menu                 9 otherwise, the AI script
 * 10 one free action                10 end-of-turn saves and ticks
 * 11 pay costs, resolve
 * 12 the lost-turn counter resets
 * 13 end-of-turn saves
 * 14 tick durations
 * 15 tick control immunity
 * ```
 *
 * Steps 5, 6, 13, 14 and 15 are the `turnStart` and `turnEnd` hooks, which the
 * condition engine is already registered on. The action itself is the caller's
 * `resolveAction`, because resolving an attack is `06` section 6 and comes
 * next; everything the *turn* owns — Grit, the lost-turn count, Defend,
 * Hidden, the one free action, recharge rolls and telegraph timing — is here.
 *
 * Resolve first, render second: a turn returns a record of what happened, and
 * the screen animates it afterwards (`06` section 1).
 */
import data from '../data/combat.json' with { type: 'json' };
import {
  acted,
  breakFree as rollBreakFree,
  endCondition,
  grit,
  has,
  helplessStart,
  isHelpless,
  stunnedStart,
} from './conditions.js';
import { legalityOf, tagsOf } from './actions.js';
import { spend } from './ai.js';
import { monsterFlees, zeroHp } from './defeat.js';
import { onField } from './field.js';

export const DEFEND = data.turn.defend;
export const HIDDEN_TURNS = data.turn.hiddenTurns;
export const RECHARGE = data.turn.recharge;
export const FREE_ACTIONS_PER_TURN = data.turn.freeActionsPerTurn;

/**
 * @typedef {object} TurnRecord
 * @property {object} unit
 * @property {'hero' | 'monster'} kind
 * @property {boolean} acted   false when the turn was lost or skipped
 * @property {string} [lost]   the condition that took it
 * @property {object[]} steps  what happened, in order, for the log
 */

/* -------------------------------------------------------------------------- */
/* The turn                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Takes one unit's turn. This is what the round's `takeTurn` service is.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {object} [services]
 * @param {(combat: object, unit: object, record: TurnRecord) => any} [services.chooseAction]
 *   what the hero does: the screen's answer, or the simulator's
 * @param {(combat: object, unit: object, action: object) => any} [services.resolveAction]
 *   resolves one action — `06` section 6 onward
 * @param {(combat: object, unit: object) => any} [services.script] a monster's AI
 * @param {(combat: object, unit: object) => void} [services.onDeath]
 */
export function takeTurn(combat, unit, services = {}) {
  return unit.side === 'hero'
    ? takeHeroTurn(combat, unit, services)
    : takeMonsterTurn(combat, unit, services);
}

/** The hero's turn: `06` section 4. */
export function takeHeroTurn(combat, hero, services = {}) {
  const record = startRecord(combat, hero, 'hero');

  // 1. Hidden ends once it has covered two of the hero's turns.
  tickHidden(hero, record);

  // 2. Last turn's Defend bonus ends as this turn begins.
  if (hero.defending) {
    hero.defending = false;
    step(record, { type: 'defendEnds' });
  }

  // 3. Grit: never more than two lost turns in a row.
  const freed = grit(hero);
  if (freed) step(record, { type: 'grit', conditions: freed });

  // 4. Stunned costs the turn, and opens its immunity window.
  const stunned = freed ? null : stunnedStart(hero);
  if (stunned) {
    step(record, { type: 'lostTurn', why: 'stunned', immuneFor: stunned.immuneFor });
    return endTurn(combat, hero, record, { lost: 'stunned' });
  }

  // 5 and 6. Every source of damage, then every source of healing.
  fireTurnStart(combat, hero, record);

  // 7. One death check, after both.
  if (deathCheck(combat, hero, record, services)) return record;

  // 8. Asleep, Paralyzed or Petrified: the turn is lost and the condition stays.
  if (!freed) {
    const helpless = helplessStart(hero);
    if (helpless) {
      step(record, { type: 'lostTurn', why: helpless.lost });
      return endTurn(combat, hero, record, { lost: helpless.lost });
    }
  }

  // 9-11. The menu, the one free action, the costs, and the action itself.
  const chosen = services.chooseAction?.(combat, hero, record) ?? { id: 'wait' };
  for (const action of [].concat(chosen)) {
    perform(combat, hero, action, record, services);
  }

  // 12. The hero acted, so the lost-turn run is broken.
  acted(hero);
  record.acted = true;
  combat.heroTurns = (combat.heroTurns ?? 0) + 1;

  return endTurn(combat, hero, record);
}

/** A monster's turn: `06` section 5. */
export function takeMonsterTurn(combat, unit, services = {}) {
  const record = startRecord(combat, unit, 'monster');

  // 1. A monster that failed its morale check leaves, dropping half its gold.
  if (unit.fleeing) {
    step(record, { type: 'fled', ...monsterFlees(combat, unit) });
    return endTurn(combat, unit, record, { lost: 'fleeing' });
  }

  // A Volley spends the turns of every archer in the group (`06` section 12).
  if (unit.actedInRound === combat.round) {
    step(record, { type: 'turnSpent', unit: unit.id });
    return endTurn(combat, unit, record, { lost: 'spent' });
  }

  // 2. Stunned. Monsters have no Grit.
  const stunned = stunnedStart(unit);
  if (stunned) {
    step(record, { type: 'lostTurn', why: 'stunned' });
    return endTurn(combat, unit, record, { lost: 'stunned' });
  }

  // 3. Damage, then healing. A troll that has been burned since its last turn
  //    does not regenerate, which its own hook reads off the payload.
  fireTurnStart(combat, unit, record);

  // 4. Death check.
  if (deathCheck(combat, unit, record, services)) return record;

  // 5. Helpless.
  const helpless = helplessStart(unit);
  if (helpless) {
    step(record, { type: 'lostTurn', why: helpless.lost });
    return endTurn(combat, unit, record, { lost: helpless.lost });
  }

  // 6. Recharge rolls, for a monster that is going to act.
  const recharged = rechargeAbilities(unit, combat.rng);
  if (recharged.length) step(record, { type: 'recharged', abilities: recharged });

  // 7. Free start-of-turn traits, now that the monster is certainly acting.
  combat.hooks?.fire('turnStart', { combat, unit, phase: 'free', rng: combat.rng });

  // 8. A telegraphed attack that is due resolves instead of the script.
  const due = telegraphDue(combat, unit);
  if (due) {
    step(record, { type: 'telegraphResolves', ability: due.ability });
    unit.telegraph = null;
    services.resolveAction?.(combat, unit, { id: 'attack', ...due, telegraphed: true });
  } else {
    // 9. Otherwise the monster's own script (`06` section 11).
    const action = services.script?.(combat, unit, record);
    if (action) perform(combat, unit, action, record, services);
  }

  acted(unit);
  record.acted = true;
  return endTurn(combat, unit, record);
}

/* -------------------------------------------------------------------------- */
/* The pieces                                                                 */
/* -------------------------------------------------------------------------- */

/** @returns {TurnRecord} */
function startRecord(combat, unit, kind) {
  unit.turn = { freeUsed: 0, round: combat.round };
  return { unit, kind, acted: false, steps: [] };
}

function step(record, entry) {
  record.steps.push(entry);
  return entry;
}

/**
 * Steps 5 and 6 of the hero's turn, step 3 of a monster's: one `turnStart`
 * firing, whose hooks run in the order `combat.json` lists — every source of
 * damage, then every source of healing.
 */
function fireTurnStart(combat, unit, record) {
  const payload = combat.hooks?.fire('turnStart', {
    combat,
    unit,
    phase: 'start',
    rng: combat.rng,
    // A hook that must not fire on a unit that is about to lose its turn can
    // ask; the free traits of section 5 step 7 use the `free` phase instead.
    helpless: isHelpless(unit),
  });
  if (payload?.damage?.length) step(record, { type: 'turnDamage', damage: payload.damage });
  if (payload?.healing) step(record, { type: 'turnHealing', amount: payload.healing });
  return payload;
}

/**
 * Step 7 of the hero's turn, step 4 of a monster's. The traits that can save a
 * unit at 0 HP are `zeroHP` hooks (`06` section 9), so this fires the event and
 * believes the answer.
 * @returns {boolean} true when the unit is out of the fight
 */
export function deathCheck(combat, unit, record, services = {}) {
  if (unit.hp > 0 || !unit.alive) return !unit.alive;

  const outcome = zeroHp(combat, unit, { cause: 'turnStart' });
  if (outcome.saved) {
    step(record, { type: 'saved', by: outcome.savedBy });
    return false;
  }
  if (outcome.fallen) {
    step(record, { type: 'fallen', unit: unit.id });
    return true;
  }

  step(record, { type: 'died', unit: unit.id });
  combat.hooks?.fire('kill', { combat, target: unit, unit });
  services.onDeath?.(combat, unit);
  return true;
}

/**
 * Steps 13-15: the end-of-turn saves, the duration ticks and the control
 * immunity ticks, which are all `turnEnd` hooks.
 */
function endTurn(combat, unit, record, { lost } = {}) {
  if (lost) record.lost = lost;
  // "Since its last turn" ends here, for a troll deciding whether to heal.
  delete unit.burnedSinceTurn;
  const payload = combat.hooks?.fire('turnEnd', { combat, unit, rng: combat.rng });
  if (payload?.saves?.length) step(record, { type: 'saves', saves: payload.saves });
  if (payload?.ended?.length) step(record, { type: 'conditionsEnded', conditions: payload.ended });
  if (payload?.log?.length) record.log = payload.log;
  return record;
}

/**
 * Step 1 of the hero's turn. Hidden is a condition with a duration, so the
 * tick would end it at the end of this turn anyway; section 4 ends it at the
 * start, which is half a turn earlier and is the order that runs.
 */
function tickHidden(hero, record) {
  const state = hero.conditions?.hidden;
  if (!state) return;
  state.turnsHeld = (state.turnsHeld ?? 0) + 1;
  if (state.turnsHeld >= (state.rounds ?? HIDDEN_TURNS)) {
    endCondition(hero, 'hidden');
    step(record, { type: 'hiddenEnds' });
  }
}

/**
 * Steps 9-11: legality, then the cost, then the action.
 *
 * The free action is counted here rather than trusted: `06` section 4 allows
 * at most one per turn, before or after the main action.
 */
function perform(combat, unit, action, record, services) {
  const legality = legalityOf(combat, unit, action);
  if (!legality.legal) {
    step(record, { type: 'illegal', action: action.id, why: legality.why });
    return null;
  }

  // Counterspell and Guardian can stop an action outright (`06` section 16).
  const before = combat.hooks?.fire('beforeAction', {
    combat,
    unit,
    action,
    phase: 'action',
    tags: [...tagsOf(action)],
    free: Boolean(action.free),
    targets: legality.targets,
  });
  if (before?.cancelled) {
    step(record, { type: 'cancelled', action: action.id, by: before.cancelledBy });
    return null;
  }

  // A hook may have resolved something for another unit — a Volley fires every
  // archer in the group (`06` section 12) — and each of those is a thing the
  // player saw happen, so it goes in the record with its own name on it.
  for (const also of before?.alsoResolved ?? []) {
    step(record, { type: 'action', action: also.action ?? 'attack', by: also.by, result: also.result });
  }

  // 11. Pay the cost before anything is resolved. An ability is spent when it
  // is used, which is what the recharge rolls at step 6 are for.
  if (action.fp) unit.fp = (unit.fp ?? 0) - action.fp;
  if (action.free) unit.turn.freeUsed += 1;
  if (action.ability) spend(unit, action.ability);

  const result = builtIn(combat, unit, action, record)
    ?? services.resolveAction?.(combat, unit, { ...action, targets: legality.targets });
  step(record, { type: 'action', action: action.id, target: action.target, result });

  // A monster that has just been stunned, put to sleep or killed cannot see
  // its telegraphed attack through (`06` section 5, Telegraph Timing).
  for (const cancelled of sweepTelegraphs(combat)) {
    step(record, { type: 'telegraphCancelled', ...cancelled });
  }
  return result;
}

/**
 * The actions the turn itself owns: Defend and Break Free are defined in
 * section 4, not in the attack rules.
 */
function builtIn(combat, unit, action, record) {
  if (action.id === 'defend') return defend(unit, record);
  if (action.id === 'breakFree') return breakFree(combat, unit, action, record);
  // A wind-up spends the turn announcing itself (`06` section 5).
  if (action.id === 'telegraph') {
    const waiting = telegraph(combat, unit, action.ability ?? action.name);
    step(record, { type: 'telegraph', unit: unit.id, ability: waiting.ability });
    return waiting;
  }
  if (action.id === 'wait') return { waited: true };
  return null;
}

/**
 * Defend: +4 DEF until the start of the hero's next turn, and 1 FP back.
 * Telegraphed attacks that land while it holds deal half damage and their
 * saves get advantage — both read `unit.defending` when they resolve.
 */
export function defend(unit, record) {
  unit.defending = true;
  const before = unit.fp ?? 0;
  unit.fp = Math.min(before + DEFEND.fp, unit.maxFp ?? before + DEFEND.fp);
  const result = { defending: true, def: DEFEND.def, fp: unit.fp - before };
  if (record) step(record, { type: 'defend', ...result });
  return result;
}

/** The DEF a unit gains from Defending this moment (`06` section 4). */
export function defendBonus(unit) {
  return unit.defending ? DEFEND.def : 0;
}

/** Break Free: d20 + the better of Might or Agility against TN 12. */
function breakFree(combat, unit, action, record) {
  const result = rollBreakFree(unit, combat.rng, action.bonus ?? 0);
  step(record, { type: 'breakFree', ...result });
  return result;
}

/* -------------------------------------------------------------------------- */
/* Recharge and telegraphs                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Step 6 of a monster's turn: every ability that is not ready rolls a d6 and
 * comes back on a 5 or 6. A monster may name its own band — Vyrmathrax
 * recharges on 4-6 below 10% HP — through `rechargeFrom`.
 *
 * `06` section 16 lists recharge rolls under `turnStart`; section 5 numbers it
 * step 6, after the helpless check, so a sleeping monster does not recharge.
 * The step list is the one that runs.
 *
 * @param {object} unit
 * @param {import('./rng.js').Stream} rng
 * @returns {string[]} the abilities that came back
 */
export function rechargeAbilities(unit, rng) {
  const ready = [];
  for (const ability of unit.abilities ?? []) {
    if (ability.ready !== false || !ability.recharges) continue;
    const from = rechargeFrom(unit, ability);
    const roll = rng.die(RECHARGE.die);
    if (roll >= from) {
      ability.ready = true;
      ready.push(ability.id);
    }
  }
  return ready;
}

/** The lowest d6 that brings an ability back. */
function rechargeFrom(unit, ability) {
  const own = ability.rechargeFrom ?? unit.rechargeFrom;
  if (typeof own === 'number') return own;
  // Vyrmathrax recharges on 4-6 below 10% HP (`06` section 5 step 6).
  if (unit.desperateRechargeFrom && unit.hp <= (unit.maxHp ?? 0) * (unit.desperateBelow ?? 0.1)) {
    return unit.desperateRechargeFrom;
  }
  return RECHARGE.readyFrom;
}

/**
 * Winds up a telegraphed attack (`06` section 5, *Telegraph Timing*). It
 * remembers how many turns the hero had taken, because it resolves on the
 * monster's first turn after the hero has had one — initiative is rerolled
 * every round, and without this a monster could wind up after the hero and
 * strike before the hero could answer.
 */
export function telegraph(combat, unit, ability) {
  unit.telegraph = {
    ability,
    round: combat.round,
    heroTurnsAtWindUp: combat.heroTurns ?? 0,
  };
  return unit.telegraph;
}

/** The telegraphed attack that is due to resolve now, or null. */
export function telegraphDue(combat, unit) {
  const waiting = unit.telegraph;
  if (!waiting) return null;
  return (combat.heroTurns ?? 0) > waiting.heroTurnsAtWindUp ? waiting : null;
}

/**
 * Cancels a waiting telegraph when the monster is Stunned, Asleep, Paralyzed,
 * Petrified or killed before it resolves. The engine calls this whenever one
 * of those lands, and when a unit dies.
 * @returns {object | null} what was cancelled
 */
export function cancelTelegraph(unit, why) {
  if (!unit.telegraph) return null;
  const cancelled = { ...unit.telegraph, why };
  unit.telegraph = null;
  return cancelled;
}

/** True when this unit can no longer see a telegraph through. */
export function telegraphBroken(unit) {
  if (!unit.alive || !onField(unit)) return true;
  return ['stunned', 'asleep', 'paralyzed', 'petrified'].some((id) => has(unit, id));
}

/**
 * Cancels the telegraphs of every monster that can no longer carry one
 * through. The turn engine calls it after anything that could have changed
 * that — a hit, a condition, a death.
 */
export function sweepTelegraphs(combat) {
  const cancelled = [];
  for (const unit of combat.units) {
    if (unit.telegraph && telegraphBroken(unit)) {
      cancelled.push(cancelTelegraph(unit, reasonBroken(unit)));
    }
  }
  return cancelled;
}

function reasonBroken(unit) {
  if (!unit.alive) return 'killed';
  return ['stunned', 'asleep', 'paralyzed', 'petrified'].find((id) => has(unit, id)) ?? 'gone';
}
