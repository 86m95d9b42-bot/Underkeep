/**
 * The field: setting a fight up and knowing who stands where
 * (`06` section 2, with the row capacity of section 13).
 *
 * A fight is a plain object — units, a round number, the streams and the hook
 * register — so it can be saved, replayed and simulated. Nothing here rolls an
 * attack or ends a turn; the round runs in `round.js` and the turns come next.
 *
 * Positions are the two rows the whole game is built on: **front** and
 * **back**, four units each, left to right in the order the encounter lists
 * them. Five enemies at most, and objects (valves, the Phylactery, the Hydra's
 * body) take a back-row spot without counting toward that cap.
 *
 * No DOM, no `Math.random()`: every roll comes from the combat stream it is
 * handed.
 */
import data from '../data/combat.json' with { type: 'json' };
import { prepare } from './conditions.js';

export const ROWS = /** @type {['front', 'back']} */ (data.field.rows);
export const ROW_CAPACITY = data.field.rowCapacity;
export const CROWD_CAP = data.field.crowdCap;
export const SURPRISE = data.surprise;
export const REACTION_FLAGS = data.reactionFlags.flags;

/**
 * @typedef {object} Unit
 * @property {string} id            unique on the field
 * @property {'hero' | 'monsters'} side
 * @property {string} [type]        monsters of one type share an initiative roll
 * @property {'front' | 'back'} row
 * @property {number} slot          0-3, left to right
 * @property {boolean} alive
 * @property {boolean} [object]     scenery: no crowd cap, no turn unless `acts`
 * @property {boolean} [acts]       an object that takes turns anyway
 * @property {boolean} [fled]       left the field (`06` section 14)
 * @property {boolean} [fallen]     a Troll that has not been burned yet
 * @property {number} [init]        the initiative modifier, the bestiary's Init
 * @property {boolean} [actsFirst]  Quicksilver
 * @property {boolean} [actsLast]   the Zombie's tactics
 * @property {boolean} [surprised]  set for round 0 only
 */

/** Where a unit sits for "front row left to right, then back row". */
export function positionOf(unit) {
  const row = ROWS.indexOf(unit.row);
  return (row === -1 ? ROWS.length : row) * ROW_CAPACITY + (unit.slot ?? 0);
}

/** Units in field order: front row left to right, then back row (`06` section 3 step 4). */
export function inFieldOrder(units) {
  return [...units].sort((a, b) => positionOf(a) - positionOf(b) || a.seq - b.seq);
}

/** Everything still on the field on one side. */
export function sideOf(combat, side) {
  return combat.units.filter((unit) => unit.side === side && onField(unit));
}

/** The monsters, objects included. */
export function enemies(combat) {
  return sideOf(combat, 'monsters');
}

/**
 * The enemies that count: objects don't, for the crowd cap, for morale, or for
 * the hero's flee roll (`06` sections 2, 13 and 14).
 *
 * Neither does a **part**. A Hydra's head is not another enemy, it is more of
 * the same one — and `02` section 8 lets it grow to five heads beside a body,
 * which the five-enemy cap would otherwise forbid.
 */
export function countedEnemies(combat) {
  return enemies(combat).filter((unit) => !unit.object && !unit.part);
}

/** Every enemy that can be hit, parts included: what the target picker sees. */
export function targetableEnemies(combat) {
  return enemies(combat).filter((unit) => !unit.object);
}

/**
 * Everything the hero may aim at: the enemies, and the arena's objects —
 * the Phylactery and the coolant valves are hit, though they never act and
 * never keep a fight going (`06` section 13, `02` sections 10 and 12).
 */
export function hittableEnemies(combat) {
  return enemies(combat);
}

/** True while a unit is still standing on the field. */
export function onField(unit) {
  return Boolean(unit) && !unit.fled && !unit.removed;
}

/**
 * True while a unit still keeps the fight going: alive, or an unburned Fallen
 * troll, whose wounds are closing (`06` sections 9 and 15).
 */
export function stillFighting(unit) {
  if (!onField(unit)) return false;
  return Boolean(unit.alive) || Boolean(unit.fallen && !unit.burned);
}

/**
 * True when an attack may be aimed at this unit. A Fallen troll is not alive
 * and is still a target, because burning it is the only way to finish it
 * (`06` section 9).
 */
export function isTargetable(unit) {
  if (!onField(unit) || unit.untargetable) return false;
  return Boolean(unit.alive) || Boolean(unit.fallen && !unit.burned);
}

/** True when this unit gets a place in the turn order. */
export function takesTurns(unit) {
  return onField(unit) && Boolean(unit.alive) && (!unit.object || unit.acts === true);
}

/**
 * The leftmost free slot in one side's row, or −1 when the row is full. Rows
 * are per side: the hero's front row is not the monsters' front row.
 *
 * A corpse holds nothing: only units still in the fight take up a place, so
 * the back row can step forward over the dead and a summon can arrive into a
 * row that has been cleared (`06` section 13).
 */
export function freeSlot(combat, row, side = 'monsters') {
  const taken = new Set(
    combat.units
      .filter((unit) => stillFighting(unit) && unit.side === side && unit.row === row)
      .map((unit) => unit.slot),
  );
  for (let slot = 0; slot < ROW_CAPACITY; slot += 1) if (!taken.has(slot)) return slot;
  return -1;
}

/**
 * Puts a unit on the field in the leftmost open spot of its row. Used by setup
 * and, later, by summons — which is why a full row is a refusal and not an
 * error: "a summon that doesn't fit simply fails" (`06` section 13).
 *
 * Setup passes `overflow`, because a group of five front-row monsters — five
 * Giant Rats — is within the crowd cap but one over the row. The fifth stands
 * in the back row, where `02` says a melee monster waits and steps forward
 * when there is room. A summon never overflows: its ability names its row.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {{ overflow?: boolean }} [options]
 * @returns {{ placed: boolean, why?: 'rowFull' | 'crowded', unit?: object }}
 */
export function place(combat, unit, { overflow = false } = {}) {
  const wanted = ROWS.includes(unit.row) ? unit.row : ROWS[0];
  if (!unit.object && countedEnemies(combat).length >= CROWD_CAP && unit.side === 'monsters') {
    return { placed: false, why: 'crowded' };
  }
  const rows = overflow ? [wanted, ...ROWS.filter((row) => row !== wanted)] : [wanted];
  const row = rows.find((candidate) => freeSlot(combat, candidate, unit.side) !== -1);
  if (!row) return { placed: false, why: 'rowFull' };
  const slot = freeSlot(combat, row, unit.side);

  unit.row = row;
  unit.slot = slot;
  unit.seq = combat.nextSeq++;
  prepare(unit);
  tune(combat, unit);
  combat.units.push(unit);
  return { placed: true, unit };
}

/**
 * A boss fight's scale (`BOSS_TUNING`): whatever takes the field on the boss's
 * side — the boss, its escort, a summon, an arena object — has its hit points
 * scaled once, as it arrives. Nothing else is touched.
 * @param {object} combat
 * @param {object} unit
 */
export function tune(combat, unit) {
  const tuning = combat.bossTuning;
  if (!tuning || unit.side !== 'monsters' || unit.tuned) return unit;
  const scale = unit.object ? tuning.objectHpScale ?? 1 : tuning.hpScale ?? 1;
  unit.maxHp = Math.max(1, Math.round((unit.maxHp ?? unit.hp ?? 1) * scale));
  unit.hp = Math.max(1, Math.round((unit.hp ?? unit.maxHp) * scale));
  unit.tuned = true;
  return unit;
}

/**
 * Turns whatever the encounter lists into a unit on the field. A monster
 * template is copied, never shared: two rats are two objects, and the entry
 * in `monsters.json` is a description rather than a creature.
 *
 * **The hero is not a template.** They are the one person the run keeps, so
 * the hero unit *is* the hero object: the hit points they lose, the poison
 * they carry out, the experience the fight pays and the level it earns all
 * happen to the hero the run walked in with. A copy would leave every one of
 * them on the field.
 *
 * @param {object} template
 * @param {'hero' | 'monsters'} side
 * @param {number} ordinal how many of this type came before it
 */
/**
 * What one fight leaves on a unit, and what the next one must not inherit.
 * A monster is built fresh from its template every time, so this is really
 * about the hero: they are their own object (see `toUnit`), and they walk
 * into the next fight carrying their wounds, their poison and their
 * experience — but not last fight's initiative, telegraph or flight.
 *
 * Everything the hero keeps is left alone: hit points, Focus, conditions
 * (`06` section 10's After Combat table has already pruned them), and
 * everything the run owns.
 */
export const COMBAT_LEFTOVERS = [
  'fled',
  'fleeing',
  'removed',
  'defending',
  'defeated',
  'fallen',
  'burned',
  'burnedSinceTurn',
  'surprised',
  'telegraph',
  'lostTurns',
  'turn',
  'actedInRound',
  'controlImmunity',
  'freshImmunity',
  'moraleChecks',
  'usedRelentless',
  'reassembled',
  'stolenGold',
  'lastDamageTypes',
];

/** Clears the last fight off a unit that is about to start another one. */
export function clearCombatState(unit) {
  for (const field of COMBAT_LEFTOVERS) delete unit[field];
  unit.alive = true;
  return unit;
}

export function toUnit(template, side, ordinal) {
  const type = template.type ?? template.id ?? 'monster';
  const fields = {
    type,
    row: side === 'hero' ? 'front' : template.row ?? 'front',
    init: template.init ?? 0,
    id: template.id ?? (side === 'hero' ? 'hero' : `${type}-${ordinal + 1}`),
    side,
    alive: template.alive ?? true,
    hp: template.hp ?? template.maxHp ?? 1,
    maxHp: template.maxHp ?? template.hp ?? 1,
  };
  // Every field above is read off the template first, so the monster's copy
  // and the hero's own object end up carrying exactly the same things.
  const unit = side === 'hero' ? Object.assign(template, fields) : { ...template, ...fields };
  // The hero is reused from fight to fight, so the last one is cleared off
  // them here rather than trusted to have tidied up after itself.
  if (side === 'hero') clearCombatState(unit);
  return prepare(unit);
}

/**
 * Rolls surprise for both sides (`06` section 2 step 3, `01` section 12).
 *
 * Both dice are always drawn, even when a side cannot be surprised, so the
 * combat stream advances the same way however the fight was reached — the same
 * reasoning as the cancelled advantage pair in `rng.d20`.
 *
 * @param {object} combat
 * @returns {{ heroRoll: number, monsterRoll: number, heroSurprised: boolean,
 *   monstersSurprised: boolean, side: 'hero' | 'monsters' | null }}
 */
export function rollSurprise(combat) {
  const { rng, hero } = combat;
  const heroRoll = rng.die(SURPRISE.die);
  const monsterRoll = rng.die(SURPRISE.die);

  // The hero surprises on a 1, or 1-2 with Sneak; enemies never surprise a
  // hero with Keen Senses rank 2.
  const monsters = countedEnemies(combat);
  const monstersSurprised =
    heroRoll <= (hero?.surpriseOn ?? SURPRISE.heroSurprisesUpTo) &&
    monsters.some((unit) => !unit.cannotBeSurprised);
  // A monster may be better at it than the die allows: a Giant Spider drops
  // from the ceiling on a 1-3, a Gargoyle stands still until a 4
  // (`02` sections 7 and 9). The best ambusher on the field sets the band.
  const band = Math.max(
    combat.monsterSurpriseOn ?? SURPRISE.monstersSurpriseUpTo,
    ...monsters.filter((unit) => unit.alive).map((unit) => unit.surprise ?? 0),
  );
  const heroSurprised = monsterRoll <= band && !hero?.cannotBeSurprised;

  // Both or neither surprised means no surprise round at all.
  const side = monstersSurprised === heroSurprised ? null : monstersSurprised ? 'hero' : 'monsters';

  if (side === 'hero') for (const unit of monsters) if (!unit.cannotBeSurprised) unit.surprised = true;
  if (side === 'monsters' && hero) hero.surprised = true;

  return { heroRoll, monsterRoll, heroSurprised, monstersSurprised, side };
}

/** Clears the surprised flags: the surprise round is over (`06` section 2 step 3). */
export function clearSurprise(combat) {
  for (const unit of combat.units) delete unit.surprised;
}

/**
 * Sets a fight up: `06` section 2, steps 1, 3 and 4.
 *
 * Step 2 (elite traits and boss phase 1) and step 5 (save, then show the
 * screen) belong to the caller: traits register hooks, and saving is the run's
 * job. `beginCombat` in `round.js` is what fires `combatStart` afterwards.
 *
 * @param {object} options
 * @param {object} options.hero
 * @param {object[]} [options.monsters] templates, in the order the encounter lists them
 * @param {import('./rng.js').Stream} options.rng the combat stream
 * @param {ReturnType<import('./hooks.js').createHooks>} [options.hooks]
 * @param {boolean} [options.surprise] false skips the surprise roll entirely
 * @param {object} [options.encounter] what this fight is, for the log and for loot
 * @param {boolean} [options.ambush] the monsters surprise on any roll: a trap's
 *   noise, a gas cloud, a Mimic (`03` sections 4, 5 and 7)
 */
export function createCombat({ hero, monsters = [], rng, hooks, surprise = true, encounter, ambush = false }) {
  const combat = {
    round: null,
    units: [],
    hero: null,
    rng,
    hooks,
    encounter,
    nextSeq: 0,
    /** @type {object[]} the turn order for the round in progress */
    order: [],
    /** @type {object[]} structured events; the run turns them into log lines */
    events: [],
    over: false,
    turnedAway: [],
  };

  combat.hero = toUnit(hero, 'hero', 0);
  place(combat, combat.hero);

  // Left to right in the order the encounter lists them, front row first, so
  // an encounter's own ordering is what the player sees.
  const counts = new Map();
  for (const template of monsters) {
    const type = template.type ?? template.id ?? 'monster';
    const ordinal = counts.get(type) ?? 0;
    counts.set(type, ordinal + 1);
    const unit = toUnit(template, 'monsters', ordinal);
    const result = place(combat, unit, { overflow: true });
    // Over the crowd cap or into a full row: the monster simply isn't there.
    if (!result.placed) combat.turnedAway.push({ unit, why: result.why });
  }

  // Step 4: the starting group size, for morale, not counting objects.
  combat.startingGroupSize = countedEnemies(combat).length;
  // An ambush still rolls both dice, so the stream moves as it always does;
  // the hero's own senses (Keen Senses 2) can still refuse it.
  if (ambush) combat.monsterSurpriseOn = SURPRISE.die;

  combat.surprise = surprise
    ? rollSurprise(combat)
    : { heroRoll: 0, monsterRoll: 0, heroSurprised: false, monstersSurprised: false, side: null };

  return combat;
}

/** @param {object} combat @param {string} id */
export function unitById(combat, id) {
  return combat.units.find((unit) => unit.id === id) ?? null;
}
