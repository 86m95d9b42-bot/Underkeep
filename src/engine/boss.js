/**
 * What only a boss does (`02` sections 4 to 13, `06` sections 12 and 13).
 *
 * Four things an ordinary monster never needs:
 *
 *   - **Phases.** A threshold is crossed, the change is queued, and it takes
 *     effect at the start of the next round — step 5 of `06` section 3.
 *   - **A state machine.** Vyrmathrax's phase 3 is not a list of rules but a
 *     cycle: grounded, takeoff, three turns in the air, and down again.
 *   - **Summons.** A row, a count, and a cap, with the crowd cap of five
 *     turning away whatever will not fit (`06` section 13).
 *   - **Actions of its own**: raising a shield, sacrificing a zealot, erasing
 *     a spell, pointing a finger.
 *
 * Nothing here draws, and every roll is the combat's own stream.
 */
import { countedEnemies, place, toUnit } from './field.js';
import { makeMonster } from '../data/monsters.js';
import { registerFor } from './monster-traits.js';
import { applyCondition } from './conditions.js';
import { rollSave } from './riders.js';
import { resolveDamage } from './damage.js';
import { abilityOf, basicAttack, evaluate } from './ai.js';

/* -------------------------------------------------------------------------- */
/* Phases                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which phase a boss should be in for the hit points it has left. The list is
 * written deepest last, so the last threshold it is under wins.
 */
export function phaseFor(unit) {
  const share = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
  let phase = unit.phase ?? 1;
  for (const row of unit.phases ?? []) {
    if (row.below === undefined || share < row.below) phase = Math.max(phase, row.phase);
  }
  return phase;
}

/**
 * Queues a phase change the moment the threshold is crossed. It does not take
 * effect here: `06` section 3 step 5 applies it at the start of the next
 * round, which is what gives the hero the turn in between.
 */
export function queuePhase(unit) {
  if (!unit.phases?.length || !unit.alive) return null;
  const wanted = phaseFor(unit);
  if (wanted <= (unit.phase ?? 1) || unit.queuedPhase >= wanted) return null;
  unit.queuedPhase = wanted;
  return wanted;
}

/**
 * Step 5 of the round: the queued change happens. The row it moves to, what
 * it becomes immune to, how many blows it makes — all of it is the phase's
 * own row in `bosses.json`.
 *
 * @returns {object[]} what changed, for the log
 */
export function applyQueuedPhases(combat) {
  const changes = [];
  for (const unit of combat.units) {
    if (!unit.queuedPhase || !unit.alive) continue;
    const to = unit.queuedPhase;
    unit.queuedPhase = null;
    const row = (unit.phases ?? []).find((one) => one.phase === to);
    if (!row) continue;

    unit.phase = to;
    if (row.row) unit.row = row.row;
    if (row.anchored !== undefined) unit.anchored = row.anchored;
    if (row.atk !== undefined) unit.atk = row.atk;
    if (row.attacks) unit.attack = { ...unit.attack, attacks: row.attacks };
    if (row.immune) unit.immune = [...new Set([...(unit.immune ?? []), ...row.immune])];
    if (row.immune) unit.immunities = [...new Set([...(unit.immunities ?? []), ...row.immune])];
    if (row.aura) unit.aura = row.aura;
    if (row.state) unit.state = row.state;
    if (row.state) unit.stateTurns = 0;

    changes.push({ unit: unit.id, phase: to, say: row.say ?? null, onEnter: row.onEnter ?? [] });
  }
  return changes;
}

/** The hook that watches for a threshold, registered with the rest. */
export function registerPhases(hooks) {
  const off = [
    hooks.on(
      'damageTaken',
      (payload) => {
        if (!payload.target?.phases) return;
        const queued = queuePhase(payload.target);
        if (queued) payload.say?.(`${payload.target.id} changes`);
      },
      { name: 'phase', source: 'boss' },
    ),
  ];
  return () => {
    for (const remove of off) remove();
  };
}

/* -------------------------------------------------------------------------- */
/* Summons                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Brings units onto the field (`06` section 13): in the row the ability
 * names, filling the leftmost open spot, and never past the ability's own
 * maximum or the crowd cap of five.
 *
 * @param {object} combat
 * @param {object} summoner
 * @param {{ id: string, count: string | number, max?: number, row?: string,
 *   refill?: boolean }} spec
 * @returns {object[]} what arrived
 */
export function summon(combat, summoner, spec) {
  const kind = spec.id;
  const standing = combat.units.filter(
    (unit) => unit.side === 'monsters' && unit.alive && unit.type === kind,
  ).length;
  const room = Math.max(0, (spec.max ?? Infinity) - standing);
  if (room === 0) return [];

  // A count is a number of them or a roll for how many: "2", or "1d3".
  const written = String(spec.count ?? 1);
  const rolled = /d/i.test(written) ? combat.rng.roll(written) : Number(written);
  // "Refills the Front row to 2 Revenants" is a top-up, not a fresh pair.
  const wanted = Math.min(room, spec.refill ? room : rolled);

  const arrived = [];
  for (let i = 0; i < wanted; i += 1) {
    const ordinal = combat.units.filter((unit) => unit.type === kind).length;
    const unit = toUnit(makeMonster(kind, { floor: combat.floor ?? 1 }), 'monsters', ordinal);
    unit.row = spec.row ?? unit.row ?? 'front';
    unit.summoned = true;
    unit.summonedBy = summoner?.id ?? null;
    if (!place(combat, unit).placed) break;
    registerFor(combat, unit);
    arrived.push(unit);
  }
  return arrived;
}

/* -------------------------------------------------------------------------- */
/* The actions only a boss takes                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolves one boss action, or null when this is not one.
 *
 * @param {object} combat
 * @param {object} unit
 * @param {object} action from `actionFor`
 */
export function resolveBossAction(combat, unit, action) {
  switch (action?.id) {
    case 'summon':
      return summonAction(combat, unit, action);
    case 'guard':
      return guardAction(combat, unit, action);
    case 'sacrifice':
      return sacrificeAction(combat, unit, action);
    case 'erase':
      return eraseAction(combat, unit, action);
    case 'fingerOfDeath':
      return fingerAction(combat, unit, action);
    default:
      return null;
  }
}

function summonAction(combat, unit, action) {
  const arrived = summon(combat, unit, action.summon ?? {});
  return {
    id: 'summon',
    ability: action.ability,
    name: action.name,
    attacker: unit.id,
    arrived: arrived.map((one) => one.id),
    kind: action.summon?.id,
  };
}

/** Tower Shield: +4 DEF until its own next turn (`02` section 5). */
function guardAction(combat, unit, action) {
  const guard = action.guard ?? {};
  unit.guardDef = guard.def ?? 4;
  unit.guardUntilOwnTurn = true;
  return { id: 'guard', ability: action.ability, name: action.name, attacker: unit.id, def: unit.guardDef };
}

/**
 * Dark Pact: she sacrifices a zealot, which does not explode, and heals
 * (`02` section 9). Killing that zealot first denies the heal, which is what
 * a telegraph is for.
 */
function sacrificeAction(combat, unit, action) {
  const spec = action.sacrifice ?? {};
  const victim = countedEnemies(combat).find(
    (one) => one.alive && one !== unit && one.type === spec.id,
  );
  if (!victim) return { id: 'sacrifice', ability: action.ability, name: action.name, fizzled: true };

  victim.alive = false;
  victim.sacrificed = true;
  const healed = Math.min((unit.maxHp ?? 0) - unit.hp, spec.heal ?? 0);
  unit.hp += healed;
  return {
    id: 'sacrifice',
    ability: action.ability,
    name: action.name,
    attacker: unit.id,
    target: victim.id,
    healed,
  };
}

/** Erase: one of the hero's buffs goes, and some Focus with it. */
function eraseAction(combat, unit, action) {
  const hero = combat.hero;
  const spec = action.erase ?? {};
  const removed = [];
  for (let i = 0; i < (spec.buffs ?? 1); i += 1) {
    const buff = (hero.buffs ?? []).at(-1);
    if (!buff) break;
    hero.buffs = hero.buffs.slice(0, -1);
    removed.push(buff.id ?? buff.name ?? 'buff');
  }
  const lost = Math.min(hero.fp ?? 0, combat.rng.roll(String(spec.fp ?? '1d6')));
  hero.fp = (hero.fp ?? 0) - lost;
  return { id: 'erase', ability: action.ability, name: action.name, attacker: unit.id, removed, fp: lost };
}

/**
 * Finger of Death: a Body save, or the hero drops to 1 HP. A success is still
 * 6d6 necrotic (`02` section 12).
 */
function fingerAction(combat, unit, action) {
  const hero = combat.hero;
  const save = rollSave(hero, action.save?.type ?? 'body', action.save?.dc ?? 18, combat.rng, {
    advantage: Boolean(action.telegraphed && hero.defending),
  });
  if (!save.passed) {
    const lost = Math.max(0, hero.hp - 1);
    hero.hp = 1;
    return { id: 'fingerOfDeath', ability: action.ability, name: action.name, attacker: unit.id, save, toOne: true, damage: { total: lost } };
  }
  const dealt = resolveDamage(combat, {
    attacker: unit,
    target: hero,
    attack: { name: action.name, kind: 'spell', damage: action.damage, noAttributeDamage: true },
  });
  return { id: 'fingerOfDeath', ability: action.ability, name: action.name, attacker: unit.id, save, damage: dealt };
}

/* -------------------------------------------------------------------------- */
/* The bribe                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Coward's Gold (`02` section 6): at a quarter of his hit points Grukk offers
 * a bribe, and the fight stops for the answer.
 *
 * Accepting is 200 gp and he leaves — no XP and no unique item. Refusing is
 * the rest of the fight, and he never asks again.
 *
 * @param {object} combat
 * @param {boolean} accepted
 */
export function answerOffer(combat, accepted) {
  const offer = combat.offer;
  if (!offer) return null;
  combat.offer = null;

  const unit = combat.units.find((one) => one.id === offer.from);
  if (!unit) return null;
  if (!accepted) {
    unit.refused = true;
    return { accepted: false, unit: unit.id };
  }

  // He goes the way a monster that breaks goes: alive, gone, and worth
  // nothing (`06` section 14).
  unit.fled = true;
  unit.alive = false;
  unit.bribed = true;
  combat.hero.gold = (combat.hero.gold ?? 0) + (offer.gold ?? 0);
  return { accepted: true, unit: unit.id, gold: offer.gold ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* The state machine                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Vyrmathrax's phase 3 (`06` section 12): grounded for two turns, then up,
 * a breath, a dive, and down again stunned — which is the hero's window.
 *
 * @returns {object | null} the action this state takes, or null for the script
 */
export function stateAction(combat, unit) {
  const machine = unit.states;
  if (!machine || !unit.state) return null;
  const state = machine[unit.state];
  if (!state) return null;

  unit.stateTurns = (unit.stateTurns ?? 0) + 1;
  const done = !state.turns || unit.stateTurns >= state.turns;
  const action = actionForState(combat, unit, state);

  if (done) {
    if (state.row) unit.row = state.row;
    if (state.thenStunned) applyCondition(unit, 'stunned', { rounds: state.thenStunned });
    unit.state = state.next ?? unit.state;
    unit.stateTurns = 0;
    unit.stateSaid = state.say ?? null;
  }
  return action;
}

/** What one state does on its turn. */
function actionForState(combat, unit, state) {
  if (state.do === 'telegraph') {
    const ability = abilityOf(unit, state.ability);
    return ability ? { id: 'telegraph', ability: ability.id, name: ability.name } : null;
  }
  if (state.do === 'resolve') return null; // the telegraph resolves itself (`06` section 5 step 8)
  // Grounded: the same bite and claw it makes in every other phase.
  return basicAttack(unit);
}

/**
 * The Grimoire's page (`02` section 11): a d6 at the start of each round,
 * rerolled once when the page it turned up could do nothing.
 *
 * @returns {object | null} the ability it will cast this round
 */
export function turnThePage(combat, unit, { rerolls = 1 } = {}) {
  const pages = (unit.abilities ?? []).filter((ability) => ability.page);
  if (pages.length === 0) return null;

  for (let tries = 0; tries <= rerolls; tries += 1) {
    const roll = combat.rng.die(6);
    const page = pages.find((ability) => ability.page === roll);
    if (!page) continue;
    if (tries < rerolls && useless(combat, unit, page)) continue;
    unit.page = page.id;
    unit.pageRoll = roll;
    return page;
  }
  unit.page = pages[0].id;
  return pages[0];
}

/** A page that could do nothing this round: summon, sleep, or erase. */
function useless(combat, unit, page) {
  if (page.action === 'summon') {
    const spec = page.summon ?? {};
    const standing = countedEnemies(combat).filter((one) => one.alive && one.type === spec.id).length;
    return standing >= (spec.max ?? Infinity);
  }
  if (page.action === 'erase') return (combat.hero.buffs ?? []).length === 0;
  if (page.control) return !evaluate(`hero can be ${page.control}`, { combat, unit, hero: combat.hero });
  return false;
}
