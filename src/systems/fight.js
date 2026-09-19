/**
 * The fight in progress, and everything the Combat screen acts on.
 *
 * The engine's turn loop asks a caller what the hero does; a screen has to
 * wait for a tap instead. So this drives the round **one turn at a time**
 * (`round.js`'s `takeNextTurn`), stops when the hero's turn comes round, and
 * carries on when `act` is called. Nothing here touches the DOM, so a test or
 * the balance simulator drives the same fight the screen does.
 *
 * Resolve first, render second: a tap resolves the whole turn — and every
 * monster turn after it, up to the hero's next — before the screen is told
 * anything (CLAUDE.md; `06` section 1).
 */
import { createCombat, countedEnemies, isTargetable, onField } from '../engine/field.js';
import { createHooks } from '../engine/hooks.js';
import { registerRules } from '../engine/rules.js';
import { beginCombat, endRound, peekTurn, startRound, takeNextTurn } from '../engine/round.js';
import { takeTurn } from '../engine/turn.js';
import { coverPenalty, resolveAction, reachableTargets } from '../engine/attack.js';
import { chooseAction } from '../engine/ai.js';
import { legalityOf } from '../engine/actions.js';
import { endCombat, heroFlees, outcomeOf } from '../engine/ending.js';
import { combatOver } from '../engine/round.js';
import { defendBonus } from '../engine/turn.js';
import { defenceOf } from '../engine/attack.js';
import { listed, spec } from '../engine/conditions.js';
import { rollEncounter } from '../data/encounters.js';
import { carriedStreams } from '../engine/rng.js';
import { awardXp } from './levelling.js';
import { t } from '../data/strings.js';

/** How many log lines are kept, as on the Exploration screen. */
export const LOG_KEPT = 40;

/**
 * What a level 1 hero brings to a fight until `01` section 4 derives it
 * (Phase 4): the run's stand-in with the numbers a starting hero would have —
 * BA 0, a Might modifier of +2, leather and a shield, a short sword.
 * `main.js` and `tools/fight.js` both build their hero from this, so the
 * screen and the audit fight the same person.
 */
export function standInHero(hero) {
  return {
    ...hero,
    atk: hero.atk ?? 2,
    def: hero.def ?? 12,
    init: hero.init ?? 0,
    saves: hero.saves ?? { body: 1, reflex: 1, mind: 1 },
    attack: hero.attack ?? { name: 'sword', kind: 'melee', damage: '1d6+1 slash' },
    // The solo protections are a flag on the unit, not a check for the hero.
    protected: true,
  };
}

/** The six actions of the outline's Combat table, in its order. */
export const ACTIONS = ['attack', 'skill', 'item', 'defend', 'swap', 'flee'];

/**
 * The line one turn step puts in the log, or null when it is not something the
 * player would see. The engine's records are structured; the words are here.
 *
 * @param {object} step
 * @param {object} unit the unit whose turn it was
 * @returns {object | object[] | null} one line, several, or none
 */
export function lineFor(step, unit) {
  // A step may name its own actor: a Volley's other archers act inside the
  // volleying archer's turn (`06` section 12).
  const actor = step.by ?? unit;
  const who = actor?.name ?? actor?.id ?? '';
  const mine = actor?.side === 'hero';
  switch (step.type) {
    case 'turnDamage': {
      const total = step.damage.reduce((sum, row) => sum + row.amount, 0);
      return { text: t(mine ? 'combat.log.hurtYou' : 'combat.log.hurt', { who, n: total }), tone: 'danger' };
    }
    case 'lostTurn':
      return { text: t(mine ? 'combat.log.youLose' : 'combat.log.theyLose', { who }), tone: 'muted' };
    case 'grit':
      return { text: t('combat.grit'), tone: 'accent' };
    case 'defend':
      return { text: t('combat.defend'), tone: 'accent' };
    case 'telegraph':
      return { text: t('combat.log.telegraph', { who }), tone: 'danger' };
    case 'telegraphResolves':
      return { text: t('combat.log.telegraphLands', { who }), tone: 'danger' };
    case 'telegraphCancelled':
      return { text: t('combat.log.telegraphGone', { who }), tone: 'muted' };
    case 'fled':
      return { text: t('combat.log.monsterFlees', { who }), tone: 'muted' };
    case 'died':
      return { text: t('combat.log.dies', { who }) };
    case 'breakFree':
      return { text: t(step.freed ? 'combat.log.freed' : 'combat.log.stillHeld'), tone: step.freed ? 'accent' : 'muted' };
    case 'illegal':
      return { text: t(`combat.illegal.${step.why}`) ?? null, tone: 'muted' };
    case 'action':
      return lineForAction(step, actor, who, mine);
    default:
      return null;
  }
}

/**
 * What one resolved action says. A blow that killed says two things: what it
 * did, and what fell — the death is part of the attack (`06` section 6 step 9),
 * not a step of the turn.
 */
function lineForAction(step, unit, who, mine) {
  const result = step.result;
  // A multi-attack action hands back a list; each attack spoke for itself.
  if (!result || result.hit === undefined) return null;
  const target = result.targetName ?? result.target ?? '';
  if (!result.hit) {
    return { text: t(mine ? 'combat.log.youMiss' : 'combat.log.theyMiss', { who, target }), tone: 'muted' };
  }

  const amount = result.damage?.total ?? 0;
  const key = result.crit
    ? mine ? 'combat.log.youCrit' : 'combat.log.theyCrit'
    : mine ? 'combat.log.youHit' : 'combat.log.theyHit';
  const hit = {
    text: t(key, { who, target, n: amount }),
    tone: mine ? (result.crit ? 'accent' : undefined) : 'danger',
  };
  // The hero falling is the fight's ending line, not one blow's aftermath.
  if (!result.killed || result.targetIsHero) return hit;
  return [hit, { text: t('combat.log.dies', { who: target }), tone: mine ? 'accent' : 'danger' }];
}

/**
 * Starts a fight.
 *
 * @param {object} options
 * @param {object} options.hero the unit the run is carrying
 * @param {object[]} [options.monsters] already-built monster units
 * @param {number} [options.floor] which floor's table to roll on
 * @param {Record<string, import('../engine/rng.js').Stream>} [options.streams]
 * @param {number} [options.masterSeed] when there are no streams yet
 * @param {string} [options.difficulty]
 * @param {boolean} [options.surprise] false skips the surprise roll
 * @param {(combat: object) => void} [options.watch] called once the field and
 *   the rules are ready and before the first round runs, which is the only
 *   moment a second observer can register hooks and see everything
 * @param {number} [options.logKept] how many lines the log holds. The screen
 *   keeps the last forty, as Exploration does; a tool auditing the log against
 *   the rules asks for all of them
 */
export function createFight({
  hero,
  monsters,
  floor = 1,
  streams,
  masterSeed = 1,
  difficulty = 'normal',
  surprise = true,
  watch,
  logKept = LOG_KEPT,
}) {
  const rng = streams ?? carriedStreams(masterSeed);
  const rolled = monsters ?? rollEncounter(floor, rng.encounter).monsters;

  const combat = createCombat({
    hero,
    monsters: rolled,
    rng: rng.combat,
    hooks: createHooks(),
    surprise,
  });
  combat.difficulty = difficulty;
  combat.floor = floor;
  registerRules(combat);
  watch?.(combat);

  /** @type {{ text: string, tone?: string }[]} oldest first */
  const log = [];
  /** @type {string | null} */
  let target = null;
  let summary = null;

  const say = (line) => {
    if (!line) return;
    // Every line remembers the round it was said in: a batch of turns can
    // cross a round boundary, and a log that groups them wrongly reads as if
    // the hero acted twice.
    for (const one of Array.isArray(line) ? line : [line]) log.push({ round: combat.round, ...one });
    if (log.length > logKept) log.splice(0, log.length - logKept);
  };

  const record = (result) => {
    for (const step of result?.steps ?? []) say(lineFor(step, result.unit));
  };

  /** The services a turn needs: the AI for monsters, the attack rules for both. */
  const services = {
    script: chooseAction,
    resolveAction: (fight, unit, action) => {
      const result = resolveAction(fight, unit, action);
      // The log wants a name, and the engine deals in ids.
      if (result && !Array.isArray(result) && result.target) {
        result.targetName = unitById(result.target)?.name ?? result.target;
        result.targetIsHero = result.target === combat.hero.id;
      }
      return result;
    },
  };

  const unitById = (id) => combat.units.find((unit) => unit.id === id) ?? null;

  /* -- driving the round ---------------------------------------------- */

  /** Runs turns until it is the hero's turn again, or the fight is over. */
  function advance() {
    for (let guard = 0; guard < 200; guard += 1) {
      // `combat.over` is settled at round end (`06` section 3 step 9), but a
      // turn can finish the fight in the middle of one — so ask section 15
      // itself rather than waiting for the round to catch up.
      if (combat.over || combatOver(combat)) return finish();
      const next = peekTurn(combat);

      if (!next) {
        // The order is spent: end the round and open the next one.
        endRound(combat, {});
        if (combat.over) return finish();
        startRound(combat, {});
        continue;
      }
      if (next.unit === combat.hero) return 'hero';

      const step = takeNextTurn(combat, {
        takeTurn: (fight, unit) => takeTurn(fight, unit, services),
      });
      record(step.result);
      pickTargetIfGone();
    }
    /* c8 ignore next 2 -- a fight that never ends is a bug, not a state */
    return 'stuck';
  }

  function finish() {
    if (!summary) {
      summary = endCombat(combat, {});

      // `06` section 15 step 5: levelling happens immediately, and `05`
      // section 11 wants it committed before it is shown. The Victory screen
      // reads what already happened rather than causing it.
      if (summary.xp > 0) {
        const gained = awardXp(combat.hero, summary.xp, rng.loot);
        summary.levels = gained.levels;
        summary.totalXp = gained.total;
        for (const level of gained.levels) {
          say({ text: t('combat.log.levelUp', { n: level.level }), tone: 'accent' });
        }
      }

      say({ text: t(`combat.end.${summary.outcome}`), tone: summary.outcome === 'victory' ? 'accent' : 'danger' });
    }
    return 'over';
  }

  /** Keeps the selected target on something that is still standing. */
  function pickTargetIfGone() {
    const current = target ? unitById(target) : null;
    if (current && isTargetable(current)) return;
    const next = reachableTargets(combat, combat.hero, { kind: 'melee' })[0]
      ?? countedEnemies(combat).find(isTargetable);
    target = next?.id ?? null;
  }

  /** The first round starts here: a surprise round when one side earned it. */
  beginCombat(combat, {});
  startRound(combat, { surprise: Boolean(combat.surprise?.side) });
  pickTargetIfGone();
  let phase = advance();

  /* -- what the screen reads ------------------------------------------- */

  const fight = {
    get combat() {
      return combat;
    },
    get hero() {
      return combat.hero;
    },
    get round() {
      return combat.round;
    },
    get log() {
      return log;
    },
    get over() {
      return combat.over;
    },
    get outcome() {
      return summary?.outcome ?? outcomeOf(combat);
    },
    get summary() {
      return summary;
    },
    /** Whose turn it is: `hero` while the screen waits for a tap. */
    get phase() {
      return phase;
    },
    get target() {
      return target ? unitById(target) : null;
    },

    /**
     * The enemies of one row, for its card slots. A monster that ran is gone
     * from the field and gone from the screen (`06` section 14); a Fallen
     * troll is not alive and is still there to be burned (section 9).
     */
    rowOf(row) {
      return combat.units
        .filter((unit) => unit.side === 'monsters' && unit.row === row && onField(unit))
        .filter((unit) => unit.alive || (unit.fallen && !unit.burned))
        .sort((a, b) => a.slot - b.slot);
    },

    /**
     * True when a bow or a spell would pay the −2 half cover against this
     * enemy, which is the chip the card shows (`06` section 6).
     */
    coverOn(unit) {
      return coverPenalty(combat, combat.hero, unit, { kind: 'ranged' }) < 0;
    },

    /** Taps on an enemy card choose the target (`00`, Combat). */
    pick(id) {
      const unit = unitById(id);
      if (unit && isTargetable(unit)) target = id;
      return fight.target;
    },

    /** What the hero's chips show: conditions with turns left, then DEF. */
    get chips() {
      const chips = listed(combat.hero).map((id) => {
        const left = combat.hero.conditions[id].rounds;
        return {
          id,
          text: `${t(`conditions.${id}.name`)}${left ? ` ${left}` : ''}`,
          tone: spec(id).buff ? 'accent' : 'danger',
        };
      });
      for (const [id, left] of Object.entries(combat.hero.controlImmunity ?? {})) {
        chips.push({ id: `shield-${id}`, text: t('combat.chips.shield', { n: left }), tone: 'info' });
      }
      chips.push({
        id: 'def',
        text: t('combat.chips.def', { n: defenceOf(combat.hero) }),
        tone: defendBonus(combat.hero) ? 'accent' : undefined,
      });
      return chips;
    },

    /** Whether an action is legal now, and why not — for a dimmed button. */
    legality(id) {
      if (phase !== 'hero') return { legal: false, why: 'notYourTurn' };
      return legalityOf(combat, combat.hero, actionFor(id));
    },

    /** True while a telegraph is pending, which makes DEFEND the primary. */
    get telegraphPending() {
      return combat.units.some((unit) => unit.telegraph && unit.alive);
    },

    /**
     * The hero's turn. Resolves it, then every monster turn up to the hero's
     * next, and only then hands back.
     * @param {string} id one of `ACTIONS`
     * @param {object} [options] `{ target }`
     */
    act(id, options = {}) {
      if (phase !== 'hero') return { acted: false, why: 'notYourTurn' };
      if (options.target) fight.pick(options.target);

      const action = actionFor(id, target);
      const check = legalityOf(combat, combat.hero, action);
      if (!check.legal) return { acted: false, why: check.why };

      if (id === 'flee') {
        // The bonus is the hero's own AGI and LCK (`06` section 14).
        const ran = heroFlees(combat, {}, {});
        say({
          text: t(ran.fled ? 'combat.log.youFlee' : 'combat.log.fleeFails'),
          tone: ran.fled ? 'accent' : 'danger',
        });
        if (!ran.fled) {
          // A failed flee still costs the turn (`06` section 14).
          takeNextTurn(combat, { takeTurn: () => ({ steps: [] }) });
        }
        phase = advance();
        return { acted: true, fled: ran.fled };
      }

      const step = takeNextTurn(combat, {
        takeTurn: (fightNow, unit) =>
          takeTurn(fightNow, unit, { ...services, chooseAction: () => action }),
      });
      record(step.result);
      pickTargetIfGone();
      phase = advance();
      return { acted: true };
    },
  };

  /** Builds the action the engine resolves from one of the six buttons. */
  function actionFor(id, at = target) {
    const weapon = combat.hero.attack ?? {};
    if (id === 'attack') {
      return { id: 'attack', kind: weapon.kind ?? 'melee', ...weapon, target: at ?? undefined };
    }
    return { id };
  }

  return fight;
}
