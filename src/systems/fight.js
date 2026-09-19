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
import { createCombat, countedEnemies, isTargetable } from '../engine/field.js';
import { createHooks } from '../engine/hooks.js';
import { registerRules } from '../engine/rules.js';
import { beginCombat, endRound, peekTurn, startRound, takeNextTurn } from '../engine/round.js';
import { takeTurn } from '../engine/turn.js';
import { coverPenalty, resolveAction, reachableTargets } from '../engine/attack.js';
import { chooseAction } from '../engine/ai.js';
import { legalityOf } from '../engine/actions.js';
import { endCombat, heroFlees, outcomeOf } from '../engine/ending.js';
import { defendBonus } from '../engine/turn.js';
import { defenceOf } from '../engine/attack.js';
import { listed, spec } from '../engine/conditions.js';
import { rollEncounter } from '../data/encounters.js';
import { carriedStreams } from '../engine/rng.js';
import { t } from '../data/strings.js';

/** How many log lines are kept, as on the Exploration screen. */
export const LOG_KEPT = 40;

/** The six actions of the outline's Combat table, in its order. */
export const ACTIONS = ['attack', 'skill', 'item', 'defend', 'swap', 'flee'];

/**
 * The line one turn step puts in the log, or null when it is not something the
 * player would see. The engine's records are structured; the words are here.
 *
 * @param {object} step
 * @param {object} unit the unit whose turn it was
 * @returns {{ text: string, tone?: 'accent' | 'muted' | 'danger' } | null}
 */
export function lineFor(step, unit) {
  const who = unit?.name ?? unit?.id ?? '';
  const mine = unit?.side === 'hero';
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
      return lineForAction(step, unit, who, mine);
    default:
      return null;
  }
}

/** What one resolved action says. Attacks carry their own result. */
function lineForAction(step, unit, who, mine) {
  const result = step.result;
  if (!result || result.hit === undefined) return null;
  const target = result.targetName ?? result.target ?? '';
  if (!result.hit) {
    return { text: t(mine ? 'combat.log.youMiss' : 'combat.log.theyMiss', { who, target }), tone: 'muted' };
  }
  const amount = result.damage?.total ?? 0;
  const key = result.crit
    ? mine ? 'combat.log.youCrit' : 'combat.log.theyCrit'
    : mine ? 'combat.log.youHit' : 'combat.log.theyHit';
  return {
    text: t(key, { who, target, n: amount }),
    tone: mine ? (result.crit ? 'accent' : undefined) : 'danger',
  };
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
 */
export function createFight({
  hero,
  monsters,
  floor = 1,
  streams,
  masterSeed = 1,
  difficulty = 'normal',
  surprise = true,
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

  /** @type {{ text: string, tone?: string }[]} oldest first */
  const log = [];
  /** @type {string | null} */
  let target = null;
  let summary = null;

  const say = (line) => {
    if (!line) return;
    log.push(line);
    if (log.length > LOG_KEPT) log.splice(0, log.length - LOG_KEPT);
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
      }
      return result;
    },
  };

  const unitById = (id) => combat.units.find((unit) => unit.id === id) ?? null;

  /* -- driving the round ---------------------------------------------- */

  /** Runs turns until it is the hero's turn again, or the fight is over. */
  function advance() {
    for (let guard = 0; guard < 200; guard += 1) {
      if (combat.over) return finish();
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

    /** The enemies, front row then back, for the two card rows. */
    rowOf(row) {
      return combat.units
        .filter((unit) => unit.side === 'monsters' && unit.row === row && !unit.removed)
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
        const ran = heroFlees(combat, { bonus: combat.hero.fleeBonus ?? 0 }, {});
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
