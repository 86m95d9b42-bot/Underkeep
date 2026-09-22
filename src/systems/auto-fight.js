/**
 * Auto-Fight (`06` section 17, "Auto-Fight (optional)").
 *
 * For routine fights, the hero:
 *   1. drinks a Healing Potion below 30% HP, if one is in a quick slot;
 *   2. otherwise makes a basic Attack on the lowest-HP enemy it can legally
 *      target.
 *
 * It stops immediately when a telegraph appears, the hero gains a condition,
 * an elite or boss is present, or HP drops below 30% with no potion left. A
 * Reaction prompt stops it too: that is a question for the player.
 *
 * Turns resolve at once, so Auto-Fight is one call that plays turns until one
 * of those is true, and says which. No DOM.
 */
import rules from '../data/combat.json' with { type: 'json' };

/** Below this share of maximum HP, Auto-Fight drinks, or stops (`06` section 17). */
export const DRINK_BELOW = rules.autoFight.drinkBelow;

/** A healing potion the hero knows is one, in a quick slot and usable now. */
export function potionFor(fight) {
  return (fight.items ?? []).find(
    (entry) => entry.quick && entry.known && !entry.why && /healing_potion$/.test(entry.baseId),
  ) ?? null;
}

/** The conditions the hero carries now, for noticing a new one. */
function conditionsOf(hero) {
  return new Set(Object.keys(hero?.conditions ?? {}));
}

/** True while a boss or an elite stands on the field. */
function bossOrElite(fight) {
  return (fight.combat?.units ?? []).some(
    (unit) => unit.side === 'monsters' && unit.alive && !unit.object && (unit.boss || unit.elite),
  );
}

/**
 * Why Auto-Fight will not go on, or null when it may take another turn.
 * @param {object} fight
 * @param {Set<string>} [had] the hero's conditions when it began
 * @returns {'over' | 'reaction' | 'boss' | 'telegraph' | 'condition' | 'lowHp' | null}
 */
export function stopReason(fight, had = conditionsOf(fight.hero)) {
  if (fight.over) return 'over';
  if (fight.reaction) return 'reaction';
  if (bossOrElite(fight)) return 'boss';
  if (fight.telegraphPending) return 'telegraph';
  for (const id of conditionsOf(fight.hero)) if (!had.has(id)) return 'condition';
  const hero = fight.hero;
  if ((hero.hp ?? 0) < (hero.maxHp ?? 1) * DRINK_BELOW && !potionFor(fight)) return 'lowHp';
  return null;
}

/**
 * Why Auto-Fight cannot even begin, or null. The same stops, before a turn is
 * taken — plus a hero who already carries a condition may still start it; it
 * is gaining one that stops it.
 */
export function whyNotAutoFight(fight) {
  if (!fight) return 'noFight';
  const reason = stopReason(fight);
  return reason === 'condition' ? null : reason;
}

/** One Auto-Fight turn: a potion below 30%, otherwise the weakest target. */
export function autoTurn(fight) {
  const hero = fight.hero;
  if ((hero.hp ?? 0) < (hero.maxHp ?? 1) * DRINK_BELOW) {
    const potion = potionFor(fight);
    if (potion && fight.act('item', { item: potion.id }).acted) return 'potion';
  }
  const check = fight.legality('attack');
  const weakest = [...(check.targets ?? [])]
    .filter((unit) => unit.alive && !unit.object)
    .sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0))[0];
  if (weakest && fight.act('attack', { target: weakest.id }).acted) return 'attack';
  return fight.act('attack').acted ? 'attack' : null;
}

/**
 * Plays Auto-Fight until it has to stop.
 * @param {object} fight
 * @param {{ maxTurns?: number }} [options]
 * @returns {{ turns: number, stoppedBy: string }}
 */
export function autoFight(fight, { maxTurns = rules.autoFight.maxTurns } = {}) {
  const had = conditionsOf(fight.hero);
  let turns = 0;
  for (; turns < maxTurns; turns += 1) {
    const reason = stopReason(fight, had);
    if (reason) return { turns, stoppedBy: reason };
    if (!autoTurn(fight)) return { turns, stoppedBy: 'stuck' };
  }
  return { turns, stoppedBy: 'turns' };
}
