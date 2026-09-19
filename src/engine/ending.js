/**
 * Fleeing and the end of a fight (`06` sections 14 and 15).
 *
 * The hero's flee is a roll against the crowd: **d20 + AGI mod + LCK mod vs.
 * 10 + the number of living enemies**. Failing it costs blood — the two
 * highest-HD enemies each get a free attack at once, and still take their own
 * turns later in the round.
 *
 * A fight ends when no enemies remain, when the hero runs, or when the hero
 * falls. What happens next — the XP, the loot, the level-up — is the
 * `combatEnd` event, in the order `06` section 16 lists: Bloodstone, Forager,
 * XP, loot. This module counts the XP the document promises and leaves the
 * rest to the phases that own it.
 */
import data from '../data/combat.json' with { type: 'json' };
import { cannotEscape } from './actions.js';
import { resolveAttack } from './attack.js';
import { monsterFlees } from './defeat.js';
import { countedEnemies, sideOf } from './field.js';
import { combatOver } from './round.js';

export const FLEEING = data.fleeing;

// Section 14's other half lives with the rest of leaving a fight.
export { monsterFlees };
export const VICTORY = data.victory;

/* -------------------------------------------------------------------------- */
/* Fleeing                                                                    */
/* -------------------------------------------------------------------------- */

/** What the hero has to beat to get away: 10 + the living enemies. */
export function fleeTn(combat) {
  const standing = countedEnemies(combat).filter((unit) => unit.alive).length;
  return FLEEING.tn + standing * FLEEING.perLivingEnemy;
}

/**
 * The hero runs (`06` section 14).
 *
 * @param {object} combat
 * @param {object} [options]
 * @param {number} [options.bonus] AGI mod + LCK mod, and anything else
 * @param {boolean} [options.automatic] Smoke Bomb, Vanish, Scroll of Teleport
 * @param {object} [services] `attack`, for the free attacks a failure costs
 * @returns {{ fled: boolean, why?: string, roll?: number, total?: number,
 *   tn?: number, freeAttacks?: object[] }}
 */
export function heroFlees(combat, { bonus = 0, automatic = false } = {}, services = {}) {
  // There is no running from a boss or a Frozen Revenant, and the automatic
  // escapes fail there too.
  if (cannotEscape(combat)) return { fled: false, why: 'noEscape' };

  const tn = fleeTn(combat);
  if (automatic) return escape(combat, { automatic: true, tn });

  const roll = combat.rng.d20();
  const total = roll + bonus;
  if (total >= tn) return escape(combat, { roll, total, tn });

  // A failure is not a wasted turn, it is a beating: the two highest-HD
  // enemies each make one free attack immediately, and still act later.
  const attack = services.attack ?? resolveAttack;
  const freeAttacks = [];
  for (const enemy of biggest(combat, FLEEING.freeAttackers)) {
    freeAttacks.push(
      attack(combat, enemy, { ...(enemy.attack ?? {}), target: combat.hero, free: true }, services),
    );
  }
  return { fled: false, roll, total, tn, freeAttacks };
}

/** The `freeAttackers` living enemies with the highest hit dice. */
function biggest(combat, count) {
  return countedEnemies(combat)
    .filter((unit) => unit.alive)
    .sort((a, b) => (b.hd ?? 0) - (a.hd ?? 0) || a.seq - b.seq)
    .slice(0, count);
}

/** The hero is away: the fight is over, with no XP and no loot. */
function escape(combat, detail) {
  combat.hero.fled = true;
  combat.over = true;
  combat.outcome = 'fled';
  return { fled: true, ...detail };
}

/* -------------------------------------------------------------------------- */
/* The end                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which of the three endings this is, or null while the fight goes on
 * (`06` section 15).
 */
export function outcomeOf(combat) {
  if (!combatOver(combat)) return null;
  if (combat.hero?.fled) return 'fled';
  if (!combat.hero?.alive) return 'defeat';
  return 'victory';
}

/**
 * The XP a victory is worth: every defeated monster, and only the first four
 * summons, which is what stops a Rat King fight from being farmed
 * (`06` sections 13 and 15).
 */
export function xpFrom(combat) {
  let total = 0;
  let summons = 0;
  const from = [];
  for (const unit of combat.units) {
    if (unit.side !== 'monsters' || unit.object) continue;
    // A monster that ran gives nothing, and neither does one still standing.
    if (unit.alive || unit.fled) continue;
    if (unit.summoned) {
      if (summons >= VICTORY.summonsWorthXp) continue;
      summons += 1;
    }
    total += unit.xp ?? 0;
    from.push(unit.id);
  }
  return { xp: total, from };
}

/**
 * Ends the fight (`06` section 15).
 *
 * Steps 1 and 2 — clearing what the fight leaves behind, and the post-combat
 * healing — are `combatEnd` hooks, and the condition engine is already one of
 * them. The XP is counted here; the loot, the level-up and the save belong to
 * the phases that own them and read this summary.
 *
 * @param {object} combat
 * @param {object} [services]
 * @param {(combat: object) => void} [services.save]
 * @returns {{ outcome: string, xp: number, gold: number, defeated: string[] }}
 */
export function endCombat(combat, services = {}) {
  const outcome = outcomeOf(combat) ?? 'victory';
  combat.over = true;
  combat.outcome = outcome;

  const earned = outcome === 'victory' ? xpFrom(combat) : { xp: 0, from: [] };
  const payload = combat.hooks?.fire('combatEnd', {
    combat,
    outcome,
    units: combat.units,
    // Hooks add to these: Bloodstone and Forager to the healing, the loot
    // tables to the drops.
    xp: earned.xp,
    gold: combat.droppedGold ?? 0,
    defeated: earned.from,
    loot: [],
    healing: 0,
  }) ?? { xp: earned.xp, gold: combat.droppedGold ?? 0, loot: [], healing: 0 };

  const summary = {
    outcome,
    xp: payload.xp ?? 0,
    gold: payload.gold ?? 0,
    loot: payload.loot ?? [],
    healing: payload.healing ?? 0,
    defeated: earned.from,
    log: payload.log ?? [],
  };
  combat.summary = summary;
  services.save?.(combat);
  return summary;
}

/** The enemies still standing, which the flee roll and the log both want. */
export function standingEnemies(combat) {
  return sideOf(combat, 'monsters').filter((unit) => unit.alive && !unit.object);
}
