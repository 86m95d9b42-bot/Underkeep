/**
 * Morale, and the row moving up behind a death
 * (`06` section 9's *Morale Triggers*, section 8's on-kill step 4, section 13).
 *
 * Three things can shake a monster, each at most **once per monster**:
 * the group falling to half or fewer, its own HP falling below a quarter, and
 * its leader dying. It then rolls 2d6, and flees if the roll beats its Morale.
 * A mindless monster (Morale "—") and a fearless one (Morale 12) never roll.
 *
 * Both triggers and row movement hang off the events `06` section 16 lists
 * them under — `kill` and `damageTaken` — so nothing in the attack or damage
 * code has to know that morale exists.
 */
import data from '../data/combat.json' with { type: 'json' };
import { ROWS, countedEnemies, freeSlot, onField } from './field.js';

export const MORALE = data.morale;

/** A monster's Morale, or null for the mindless, who never roll. */
export function moraleOf(unit) {
  const morale = unit.morale;
  if (morale === undefined || morale === null || morale === '—' || morale === '-') return null;
  return Number(morale);
}

/** True when this unit can be shaken at all (`06` section 9). */
export function canBreak(unit) {
  const morale = moraleOf(unit);
  return morale !== null && morale < MORALE.fearless && unit.alive && !unit.fleeing;
}

/**
 * One morale check. A trigger fires at most once per monster, whether or not
 * the roll held, so a monster cannot be made to roll twice for the same fright.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {'groupHalved' | 'hurt' | 'leaderDead'} trigger
 * @returns {{ unit: string, trigger: string, roll: number, morale: number, flees: boolean } | null}
 */
export function checkMorale(combat, unit, trigger) {
  if (!canBreak(unit)) return null;
  unit.moraleChecks ??= {};
  if (unit.moraleChecks[trigger]) return null;
  unit.moraleChecks[trigger] = true;

  const morale = moraleOf(unit);
  const roll = combat.rng.roll(MORALE.dice);
  const flees = roll > morale;
  if (flees) unit.fleeing = true;
  return { unit: unit.id, trigger, roll, morale, flees };
}

/**
 * True once the encounter is down to half its starting count or fewer.
 * Summons don't count: a fight that spawns rats is not a fight that is losing.
 */
export function groupHalved(combat) {
  const start = combat.startingGroupSize ?? 0;
  if (start <= 0) return false;
  const standing = countedEnemies(combat).filter((unit) => unit.alive && !unit.summoned).length;
  return standing <= Math.floor(start * MORALE.groupShare);
}

/** Every check a death sets off: the group thinning, and a leader falling. */
export function onKill(combat, dead) {
  const results = [];
  if (dead.side !== 'monsters') return results;

  const halved = groupHalved(combat);
  for (const unit of countedEnemies(combat)) {
    if (unit === dead) continue;
    if (halved) results.push(checkMorale(combat, unit, 'groupHalved'));
    if (unit.leader && unit.leader === dead.id) results.push(checkMorale(combat, unit, 'leaderDead'));
  }
  return results.filter(Boolean);
}

/** The check a wound sets off: below a quarter of its hit points. */
export function onHurt(combat, unit) {
  if (unit.side !== 'monsters' || !unit.alive) return null;
  if (unit.hp > (unit.maxHp ?? 0) * MORALE.hurtBelow) return null;
  return checkMorale(combat, unit, 'hurt');
}

/**
 * Row movement (`06` section 8's on-kill step 4, and section 13): when the
 * front row empties, back-row monsters step forward at once. Anchored units
 * never move — the Hydra's body, the Phylactery, the coolant valves, the
 * Bound Grimoire, Veyra in phase 1.
 *
 * @returns {object[]} who stepped up
 */
export function stepForward(combat, side = 'monsters') {
  const standing = (unit) => unit.side === side && onField(unit) && unit.alive;
  if (combat.units.some((unit) => standing(unit) && unit.row === ROWS[0])) return [];

  const moved = [];
  for (const unit of combat.units) {
    if (!standing(unit) || unit.row !== ROWS[1] || unit.anchored) continue;
    const slot = freeSlot(combat, ROWS[0], side);
    if (slot === -1) break;
    unit.row = ROWS[0];
    unit.slot = slot;
    moved.push(unit);
  }
  return moved;
}

/**
 * Registers morale and row movement on the events `06` section 16 puts them
 * under. The order inside `kill` is section 8's: the morale triggers, then the
 * row movement.
 *
 * @param {ReturnType<import('./hooks.js').createHooks>} hooks
 * @returns {() => void}
 */
export function registerMoraleHooks(hooks) {
  const source = 'morale';
  const off = [];

  off.push(
    hooks.on(
      'kill',
      (payload) => {
        const dead = payload.target ?? payload.unit;
        if (!dead) return;
        const broken = onKill(payload.combat, dead).filter((check) => check.flees);
        payload.morale = broken;
        for (const check of broken) payload.say(`${check.unit} breaks`);
      },
      { name: 'morale', source },
    ),
  );

  off.push(
    hooks.on(
      'kill',
      (payload) => {
        const moved = stepForward(payload.combat);
        if (moved.length) payload.say(`${moved.map((unit) => unit.id).join(', ')} step up`);
      },
      { name: 'rowMovement', source },
    ),
  );

  off.push(
    hooks.on(
      'damageTaken',
      (payload) => {
        const check = onHurt(payload.combat, payload.target);
        if (check?.flees) payload.say(`${check.unit} breaks`);
      },
      { name: 'morale', source },
    ),
  );

  return () => {
    for (const remove of off) remove();
  };
}
