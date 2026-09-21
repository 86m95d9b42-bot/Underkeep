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
import { createCombat, countedEnemies, isTargetable, onField, place, toUnit } from '../engine/field.js';
import { createHooks } from '../engine/hooks.js';
import { actionForSkill, resolveSkillAction } from '../engine/skill-actions.js';
import { clearCombatBuffs, resolveItemAction } from '../engine/item-actions.js';
import { actionForItem, consumeItem, usableItems } from './use-item.js';
import { lootAfterCombat } from './loot.js';
import { registerRules } from '../engine/rules.js';
import { beginCombat, endRound, peekTurn, startRound, takeNextTurn } from '../engine/round.js';
import { takeTurn } from '../engine/turn.js';
import { coverPenalty, resolveAction, reachableTargets } from '../engine/attack.js';
import { chooseAction } from '../engine/ai.js';
import { resolveSupport } from '../engine/support.js';
import { registerFor } from '../engine/monster-traits.js';
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
 * What a level 1 hero brings to a fight until the pack arrives (`04`,
 * Phase 5): the numbers a starting hero would have — BA 0, a Might modifier
 * of +2, leather and a shield, a short sword. A created hero already carries
 * every one of them but the weapon. `main.js` and `tools/fight.js` both build
 * their hero from this, so the screen and the audit fight the same person.
 *
 * It fills the gaps **in place** and hands the same hero back: the XP and the
 * gold a fight pays are paid to whoever fought it, and a copy would take them
 * out of the run.
 */
export function standInHero(hero) {
  hero.atk ??= 2;
  hero.def ??= 12;
  hero.init ??= 0;
  hero.saves ??= { body: 1, reflex: 1, mind: 1 };
  hero.attack ??= { name: 'sword', kind: 'melee', damage: '1d6+1 slash' };
  // The solo protections are a flag on the unit, not a check for the hero.
  hero.protected = true;
  return hero;
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
      // The hero falling is the fight's ending line, not a step of a turn —
      // the same rule a killing blow follows.
      return mine ? null : { text: t('combat.log.dies', { who }) };
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
/** What using an item says in the log (`04` sections 8 to 10). */
function lineForItem(result, mine) {
  const name = result.name ?? '';
  const lines = [];
  if (result.thrown) {
    lines.push({ text: t('combat.log.throw', { name }), tone: 'accent' });
    for (const hit of result.hits ?? []) {
      const who = hit.targetName ?? hit.target;
      if (hit.immune) lines.push({ text: t('combat.log.shrugsOff', { who }), tone: 'muted' });
      else if (hit.saved) lines.push({ text: t('combat.log.shrugsOff', { who }), tone: 'muted' });
      else if (hit.applied) {
        lines.push({ text: t('combat.log.condition', { who, what: t(`conditions.${hit.condition}.name`) }) });
      } else if (hit.hit) {
        lines.push({
          text: t('combat.log.youHit', { who: '', target: who, n: hit.damage?.total ?? 0 }),
          tone: 'accent',
        });
        if (hit.killed) lines.push({ text: t('combat.log.dies', { who }), tone: 'accent' });
      } else if (hit.hit === false) {
        lines.push({ text: t('combat.log.youMiss', { who: '', target: who }), tone: 'muted' });
      }
    }
    return lines;
  }

  lines.push({ text: t('combat.log.useItem', { name }), tone: 'accent' });
  if (result.healed > 0) lines.push({ text: t('combat.log.itemHeals', { n: result.healed }), tone: 'accent' });
  if (result.fp > 0) lines.push({ text: t('combat.log.itemFocus', { n: result.fp }), tone: 'accent' });
  for (const id of result.cured ?? []) {
    lines.push({ text: t('combat.log.cured', { what: t(`conditions.${id}.name`) }), tone: 'accent' });
  }
  if (result.buff) lines.push({ text: t('combat.log.itemBuff'), tone: 'accent' });
  return lines;
}

function lineForAction(step, unit, who, mine) {
  const result = step.result;
  // Two claws, three missiles: each attack of a multi-attack action spoke for
  // itself, so each gets its line (`06` section 6, Multiple Attacks).
  if (Array.isArray(result)) {
    return result.flatMap((one) => lineForAction({ ...step, result: one }, unit, who, mine) ?? []);
  }
  // An item says what it was and what it did (`04` section 16's loot card is
  // the same idea: the player is told what they got out of it).
  if (result?.item && !result.hit) return lineForItem(result, mine);
  // A monster's support ability: a Shaman mends kin, a Cultist prays, a Hex
  // lands or is shrugged off (`02` sections 6 and 9).
  if (result?.id === 'heal' && result.attacker !== undefined) {
    return {
      text: t('combat.log.mends', { who, target: result.target, n: result.healed }),
      tone: 'danger',
    };
  }
  if (result?.id === 'buff') {
    return { text: t('combat.log.blesses', { who, target: result.target }), tone: 'danger' };
  }
  if (result?.id === 'hex') {
    return {
      text: t(result.condition ? 'combat.log.hexed' : 'combat.log.hexResisted', { who }),
      tone: result.condition ? 'danger' : 'muted',
    };
  }
  if (result?.nothing) return null;

  // A skill that healed says what it was worth, not what it hit.
  if (result?.healed !== undefined) {
    const name = t(`skills.${result.skill}.name`);
    return {
      text: result.healed > 0
        ? t('combat.log.youHeal', { skill: name, n: result.healed })
        : t('combat.log.youHealFull', { skill: name }),
      tone: 'accent',
    };
  }
  // An ability with no dice: the Web, the Wail, the Wing Buffet. What it did
  // is the condition it left, which the rider's own line says.
  if (result?.effectOnly) {
    return {
      text: t(mine ? 'combat.log.youUse' : 'combat.log.theyUse', {
        who,
        what: result.name ?? result.ability ?? '',
      }),
      tone: mine ? 'accent' : 'danger',
    };
  }

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
  antiMagic = false,
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

  /**
   * What a Shrieker calls in (`02` section 7): a wandering group from this
   * floor's own table, joining the fight as any monster does. The crowd cap
   * of five turns away whatever will not fit (`02` section 2).
   */
  combat.reinforce = (current, { floor: on = floor } = {}) => {
    const rolled = rollEncounter(on, rng.encounter);
    const joined = [];
    for (const template of rolled.monsters) {
      // The ordinal is per kind, as it is when the fight is set up: a third
      // kobold is "kobold-3", whatever else is on the field.
      const kind = template.type ?? template.id ?? 'monster';
      const ordinal = current.units.filter((unit) => unit.type === kind).length;
      const unit = toUnit(template, 'monsters', ordinal);
      if (!place(current, unit, { overflow: true }).placed) break;
      registerFor(current, unit);
      joined.push(unit);
    }
    return joined;
  };
  // A fight inside an Anti-Magic Field is fought without Arcana, Spirit or
  // scrolls (`03` section 8); `engine/actions.js` is what refuses them.
  combat.antiMagic = antiMagic;
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
      // A skill action is resolved by the skill rules; everything else is
      // section 6's.
      const result =
        resolveItemAction(fight, unit, action, services) ??
        resolveSkillAction(fight, unit, action, services) ??
        resolveSupport(fight, unit, action) ??
        resolveAction(fight, unit, action);
      // The log wants a name, and the engine deals in ids. A multi-attack
      // action hands back one result per blow, and each of them is a blow
      // the player saw (`06` section 6, Multiple Attacks).
      for (const one of Array.isArray(result) ? result : [result]) {
        if (!one?.target) continue;
        one.targetName = unitById(one.target)?.name ?? one.target;
        one.targetIsHero = one.target === combat.hero.id;
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
      // The loot stream rolls the gold the defeated were carrying, so a
      // reload cannot re-roll the purse (`05` section 11).
      summary = endCombat(combat, { loot: rng.loot });

      // `02` section 17 and `04` section 14: what the defeated were carrying,
      // and the encounter's own roll. Rolled here, before the Victory screen
      // is built, because `05` section 11 wants an outcome committed before
      // it is shown.
      if (summary.outcome === 'victory') {
        const defeated = summary.defeated.map((id) => unitById(id)).filter(Boolean);
        combat.hero.found ??= [];
        const rolled = lootAfterCombat(rng.loot, defeated, {
          floor: combat.floor,
          hero: combat.hero,
          found: combat.hero.found,
        });
        summary.loot = [...(summary.loot ?? []), ...rolled.drops];
        summary.lootRolls = rolled.rolls;
      }

      // What was drunk for one fight lasts one fight (`04` section 8).
      clearCombatBuffs(combat.hero);

      // `06` section 15 step 5: levelling happens immediately, and `05`
      // section 11 wants it committed before it is shown. The Victory screen
      // reads what already happened rather than causing it.
      // `06` section 15 step 4: the gold is part of the fight's loot, and it
      // was rolled as each monster fell. The screen reports a purse that has
      // already been filled.
      if (summary.gold > 0) combat.hero.gold = (combat.hero.gold ?? 0) + summary.gold;

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
    /** What the hero can reach for, quick slots first (`04` sections 1, 16). */
    get items() {
      return usableItems(combat.hero, { inCombat: true }).map((entry) => ({
        ...entry,
        reason: entry.why ? t(`combat.illegal.${entry.why}`) : undefined,
      }));
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
    /** Set when a Scroll of Return ended the fight by ending the trip. */
    get leftDungeon() {
      return combat.leftDungeon ?? null;
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
    legality(id, options = {}) {
      if (phase !== 'hero') return { legal: false, why: 'notYourTurn' };
      const action = actionFor(id, target, options);
      if (action.ready === false && action.why) return { legal: false, why: action.why };
      return legalityOf(combat, combat.hero, action);
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

      const action = actionFor(id, target, options);
      if (action.ready === false && action.why) return { acted: false, why: action.why };
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

      // An item is used up by using it, and using it is one of the ways to
      // learn what it was (`04` sections 1 and 5).
      const spent = id === 'item' ? action.item : null;

      const step = takeNextTurn(combat, {
        takeTurn: (fightNow, unit) =>
          takeTurn(fightNow, unit, { ...services, chooseAction: () => action }),
      });
      record(step.result);
      // An item is used up by using it, and using it is one of the ways to
      // learn what it was (`04` sections 1 and 5).
      if (spent) consumeItem(combat.hero, spent);
      pickTargetIfGone();
      phase = advance();
      // A Smoke Bomb flees the fight outright (`04` section 10), and a
      // Scroll of Return takes the hero out of the dungeon with it.
      const used = step.result?.steps?.find((one) => one.result?.flee);
      if (used?.result?.returnToTown) {
        combat.leftDungeon = { leaveMark: Boolean(used.result.leavesMark) };
      }
      if (used) {
        const ran = heroFlees(combat, { automatic: true });
        say({
          text: t(ran.fled ? 'combat.log.youFlee' : 'combat.illegal.noEscape'),
          tone: ran.fled ? 'accent' : 'muted',
        });
        phase = advance();
        return { acted: true, fled: ran.fled ?? true };
      }
      return { acted: true };
    },
  };

  /**
   * Builds the action the engine resolves from one of the six buttons. SKILL
   * carries which skill was tapped; the sheet is what picks it.
   */
  function actionFor(id, at = target, options = {}) {
    const weapon = combat.hero.attack ?? {};
    if (id === 'attack') {
      return { id: 'attack', kind: weapon.kind ?? 'melee', ...weapon, target: at ?? undefined };
    }
    if (id === 'item' && options.item) {
      const built = actionForItem(combat.hero, options.item, {
        target: at ?? undefined,
        floor: combat.floor,
      });
      return built.action ?? { id: 'item', item: options.item, ready: false, why: built.why };
    }
    if (id === 'skill' && options.skill) {
      const built = actionForSkill(combat.hero, options.skill, { target: at ?? undefined });
      // A skill whose shape no phase has built yet is offered and refused by
      // name, the way every other dimmed button is.
      return built.action ?? { id: 'skill', skill: options.skill, ready: false, why: built.why };
    }
    return { id };
  }

  return fight;
}
