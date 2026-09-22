/**
 * What the hero may do this turn, and why a choice is dimmed
 * (`06` section 4, *Action Legality*, *Free Actions*, *Break Free*, *Defend*).
 *
 * The screen shows every action and dims the illegal ones with the reason, so
 * legality is a question with an answer, not a filter: `legalityOf` returns
 * `{ legal: false, why: 'webbed' }` and the button says so. Every reason has a
 * line in `strings.json`, and `npm run data` fails if one is missing.
 *
 * Conditions bring their own blocks from `conditions.json` — Feared blocks
 * `melee`, Webbed blocks `attack`, `flee` and `swap` — and an action is
 * checked by its **tags**, so one entry blocks melee attacks and melee skills
 * alike without naming either.
 *
 * No DOM: this takes the field and an action and answers.
 */
import data from '../data/combat.json' with { type: 'json' };
import { blocked, blockedBy, has } from './conditions.js';
import { ROWS, countedEnemies, hittableEnemies, isTargetable } from './field.js';

export const ACTIONS = data.actions;
export const LEGALITY = data.legality;
export const FREE_ACTIONS_PER_TURN = data.turn.freeActionsPerTurn;

/**
 * @typedef {object} Action
 * @property {string} id       one of `ACTIONS`
 * @property {string} [kind]   melee, ranged or spell
 * @property {string[]} [tags] extra tags: a skill's path, `attack`, `scroll`
 * @property {number} [fp]     what it costs
 * @property {string} [target] the unit id it is aimed at
 * @property {boolean} [free]  taken as the turn's one free action
 * @property {boolean} [ready] false for a skill or item that is not available
 */

/** Every tag an action carries: its own, its kind, and the table's. */
export function tagsOf(action) {
  const spec = ACTIONS[action.id] ?? {};
  const kind = action.kind ?? spec.defaultKind;
  return new Set([action.id, ...(spec.tags ?? []), ...(action.tags ?? []), ...(kind ? [kind] : [])]);
}

/**
 * Which enemies this action can reach.
 *
 * Rows are the whole of it at this stage: a melee attack reaches the front row
 * while anyone stands in it, and the back row only with Reach or once the
 * front row is empty (`02`, Rows). Ranged attacks and spells reach both, and
 * the −2 half cover that costs them is the attack rules' business
 * (`06` section 6).
 *
 * @param {object} combat
 * @param {object} unit
 * @param {Action} action
 */
export function targetsFor(combat, unit, action) {
  const tags = tagsOf(action);
  // A part — a Hydra's head — is something to hit even though it is not
  // another enemy (`06` section 13).
  const enemies = hittableEnemies(combat).filter(isTargetable);
  if (unit.side === 'monsters') return [combat.hero].filter((hero) => hero?.alive);
  if (!tags.has('attack')) return enemies;

  const melee = tags.has('melee');
  if (!melee || action.reach) return enemies;
  const front = enemies.filter((enemy) => enemy.row === ROWS[0]);
  return front.length ? front : enemies;
}

/**
 * Whether a unit may take an action now, and why not.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {Action} action
 * @returns {{ legal: boolean, why?: string, targets?: object[] }}
 */
export function legalityOf(combat, unit, action) {
  if (!ACTIONS[action.id]) return { legal: false, why: 'unknown' };
  const tags = tagsOf(action);

  // Break Free is the one action a Webbed unit is meant to take, and it is
  // pointless otherwise.
  if (action.id === 'breakFree' && !has(unit, 'webbed')) return { legal: false, why: 'notWebbed' };

  // What conditions forbid: Feared blocks melee, Webbed blocks attacks,
  // fleeing and swapping, Grabbed blocks fleeing and swapping.
  const stopped = blocked(unit).find((tag) => tags.has(tag));
  if (stopped) return { legal: false, why: blockedBy(unit, stopped) ?? stopped };

  // An Anti-Magic Field silences Arcana, Spirit and scrolls.
  if (combat.antiMagic && LEGALITY.antiMagicField.blocks.some((tag) => tags.has(tag))) {
    return { legal: false, why: 'antiMagic' };
  }

  // There is no running from a boss, or from a Frozen Revenant.
  if (LEGALITY.noEscape.blocks.some((tag) => tags.has(tag)) && cannotEscape(combat)) {
    return { legal: false, why: 'noEscape' };
  }

  // What the gear forbids: the Bloodthirsty curse takes Defend and Flee away
  // (`04` section 6). The sheet carries the list, so nothing here knows what
  // a curse is.
  if ((unit.cannot ?? []).some((id) => tags.has(id))) return { legal: false, why: 'cursedGrip' };

  if (action.ready === false) return { legal: false, why: 'notReady' };

  const cost = action.fp ?? 0;
  if (cost > (unit.fp ?? 0)) return { legal: false, why: 'notEnoughFp' };

  if (action.free && (unit.turn?.freeUsed ?? 0) >= FREE_ACTIONS_PER_TURN) {
    return { legal: false, why: 'freeUsed' };
  }

  if (ACTIONS[action.id].needsTarget || action.needsTarget) {
    const targets = targetsFor(combat, unit, action);
    if (targets.length === 0) return { legal: false, why: 'noTarget' };
    if (action.target && !targets.some((enemy) => enemy.id === action.target)) {
      return { legal: false, why: 'badTarget', targets };
    }
    return { legal: true, targets };
  }

  return { legal: true };
}

/** True when nothing may flee: a boss fight, or a monster that holds the way. */
export function cannotEscape(combat) {
  return (
    Boolean(combat.boss) ||
    countedEnemies(combat).some((enemy) => enemy.alive && enemy.preventsFlight)
  );
}

/**
 * The whole menu, each entry with its answer — which is what the screen draws:
 * one row per action, dimmed ones carrying their reason.
 * @param {object} combat
 * @param {object} unit
 * @param {Action[]} actions
 */
export function menuFor(combat, unit, actions) {
  return actions.map((action) => ({ action, ...legalityOf(combat, unit, action) }));
}
