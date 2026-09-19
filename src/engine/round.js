/**
 * The round (`06` section 3).
 *
 * ```text
 * ROUND START            1 round += 1 (the surprise round is round 0)
 *                        2 reset the per-round reaction flags
 *                        3 Grimoire page  4 start-of-round effects
 *                        5 queued boss phase changes  6 roll initiative
 * TURNS                  7 each unit in order, checking combat end after each
 * ROUND END              8 end-of-round effects  9 check combat end  10 save
 * ```
 *
 * Steps 3-5 and step 8 are hooks, not code: `06` section 16 says every trait
 * and skill registers on an event, and the two ordered lists in `combat.json`
 * are those hooks' names in the order this section gives them. A round
 * therefore fires two events and calls one service, and the Grimoire, the
 * Ghast and the Hydra arrive later without this file changing.
 *
 * The turn itself (`06` sections 4 and 5) is the caller's `takeTurn`, so the
 * round can be tested — and its order proved — before a single attack exists.
 *
 * Resolve first, render second: each turn is resolved and saved before
 * anything is shown (`06` section 1, `05` section 11).
 */
import data from '../data/combat.json' with { type: 'json' };
import { rollInitiative } from './initiative.js';
import {
  REACTION_FLAGS,
  SURPRISE,
  clearSurprise,
  countedEnemies,
  sideOf,
  stillFighting,
  takesTurns,
} from './field.js';

export const SURPRISE_ROUND = SURPRISE.surpriseRound;
export const ROUND_START_HOOKS = data.roundStartOrder.hooks;
export const ROUND_END_HOOKS = data.roundEndOrder.hooks;

/**
 * Fires `combatStart` and saves, which is `06` section 2 step 5 and the first
 * row of section 16's table. Hooks — elite traits, boss phase 1, Sneak — are
 * registered before this is called.
 * @param {object} combat
 * @param {{ save?: (combat: object) => void }} [services]
 */
export function beginCombat(combat, { save } = {}) {
  combat.round = null;
  combat.over = false;
  const payload = combat.hooks?.fire('combatStart', { combat });
  record(combat, { type: 'combatStart', surprise: combat.surprise?.side ?? null });
  save?.(combat);
  return payload;
}

/**
 * Round start: steps 1-6. Returns the turn order, which is also left on
 * `combat.order`.
 *
 * @param {object} combat
 * @param {{ surprise?: boolean }} [options] a surprise round is round 0, and
 *   only the surprising side acts in it
 * @returns {{ round: number, order: object[], log: string[] }}
 */
export function startRound(combat, { surprise = false } = {}) {
  // 1. The surprise round is round 0, so the first real round is still 1.
  combat.round = surprise ? SURPRISE_ROUND : (combat.round ?? 0) + 1;

  // 2. Per-round reactions come back: the flags a unit carries, and the hooks
  //    the register limits to one use a round.
  resetReactions(combat);
  combat.hooks?.resetLimits('round');

  // 3-5. The Grimoire's page, then the start-of-round effects in order, then
  //      the boss phase changes queued last round. All of them are hooks.
  const payload = combat.hooks?.fire('roundStart', { combat, round: combat.round }) ?? { log: [] };

  // 6. Initiative, over whoever is allowed to act this round. The index is
  //    where the turn order has got to, for a caller taking one turn at a time.
  combat.turnIndex = 0;
  const acting = surprise && combat.surprise?.side ? sideOf(combat, combat.surprise.side) : combat.units;
  combat.order = rollInitiative(combat, { units: acting });

  record(combat, {
    type: 'roundStart',
    round: combat.round,
    surprise: surprise ? combat.surprise?.side ?? null : null,
    order: combat.order.map((entry) => ({
      id: entry.unit.id,
      band: entry.band,
      roll: entry.roll,
      total: entry.total,
    })),
  });

  return { round: combat.round, order: combat.order, log: payload.log ?? [] };
}

/**
 * The next unit due to act this round, or null when the order is spent. Units
 * that died, fled or had their turn taken by a Volley are stepped over.
 */
export function peekTurn(combat) {
  const order = combat.order ?? [];
  for (let i = combat.turnIndex ?? 0; i < order.length; i += 1) {
    if (takesTurns(order[i].unit)) return order[i];
  }
  return null;
}

/**
 * Takes one turn and stops — the step-wise half of step 7, for a screen that
 * has to wait for a tap between turns. `runTurns` is this in a loop.
 *
 * @param {object} combat
 * @param {object} services the same ones `runTurns` takes
 * @returns {{ done: boolean, entry?: object, unit?: object, result?: any }}
 */
export function takeNextTurn(combat, { takeTurn, save, isOver = combatOver } = {}) {
  const order = combat.order ?? [];
  if (isOver(combat)) return { done: true, over: true };

  while ((combat.turnIndex ?? 0) < order.length) {
    const entry = order[combat.turnIndex];
    combat.turnIndex += 1;
    if (!takesTurns(entry.unit)) {
      record(combat, { type: 'turnSkipped', unit: entry.unit.id });
      continue;
    }
    const result = takeTurn?.(combat, entry.unit, entry);
    // Resolved, then saved, then shown.
    save?.(combat);
    return { done: false, entry, unit: entry.unit, result };
  }
  return { done: true };
}

/**
 * Step 7: every unit takes its turn in the order rolled at step 6.
 *
 * New arrivals join at the start of the next round (`06` section 3 step 5), so
 * the order is the list built above and nothing is inserted into it. A unit
 * that died, fled or was made helpless-and-removed before its turn comes round
 * is skipped.
 *
 * @param {object} combat
 * @param {object} services
 * @param {(combat: object, unit: object, entry: object) => any} services.takeTurn
 * @param {(combat: object) => void} [services.save] called after every turn
 * @param {(combat: object) => boolean} [services.isOver]
 */
export function runTurns(combat, services = {}) {
  const turns = [];
  for (;;) {
    // After every action: check combat end (morale and row movement are hooks
    // on `kill` and `damageTaken`, fired inside the turn).
    const step = takeNextTurn(combat, services);
    if (step.done) break;
    turns.push({ unit: step.unit, entry: step.entry, result: step.result });
  }
  return turns;
}

/**
 * Round end: steps 8-10.
 * @param {object} combat
 * @param {{ save?: (combat: object) => void, isOver?: (combat: object) => boolean }} [services]
 */
export function endRound(combat, { save, isOver = combatOver } = {}) {
  // 8. Shriek, Regrowth, Reassemble, arrivals, then Sickened expiring.
  const payload = combat.hooks?.fire('roundEnd', { combat, round: combat.round }) ?? { log: [] };

  // The surprise is spent: it lasted the one round it bought.
  if (combat.round === SURPRISE_ROUND) clearSurprise(combat);

  // 9. Combat end, and 10. save.
  combat.over = isOver(combat);
  record(combat, { type: 'roundEnd', round: combat.round, over: combat.over });
  save?.(combat);
  return { over: combat.over, log: payload.log ?? [] };
}

/**
 * One whole round, start to end.
 * @param {object} combat
 * @param {object} [services] `takeTurn`, `save`, `isOver`, and `surprise`
 */
export function runRound(combat, services = {}) {
  const { surprise = false } = services;
  const start = startRound(combat, { surprise });
  const turns = runTurns(combat, services);
  const end = endRound(combat, services);
  return { round: start.round, order: start.order, turns, over: end.over };
}

/**
 * Combat ends when no enemies remain — dead, fled, or Fallen trolls that have
 * been burned — or the hero flees, or the hero is defeated (`06` section 15).
 *
 * An unburned Fallen troll keeps the fight going on purpose: its wounds are
 * already closing.
 * @param {object} combat
 */
export function combatOver(combat) {
  const hero = combat.hero;
  if (!hero || !hero.alive || hero.fled) return true;
  return !countedEnemies(combat).some(stillFighting);
}

/**
 * Step 2: the per-round reactions come back. Only flags a unit already carries
 * are reset — a hero without Riposte never gains one.
 * @param {object} combat
 */
export function resetReactions(combat) {
  for (const unit of combat.units) {
    if (!unit.reactions) continue;
    for (const flag of REACTION_FLAGS) {
      if (flag in unit.reactions) unit.reactions[flag] = true;
    }
  }
}

/** Adds a structured event; the run turns these into log lines. */
function record(combat, event) {
  combat.events ??= [];
  combat.events.push(event);
  return event;
}
