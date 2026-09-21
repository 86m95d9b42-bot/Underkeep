/**
 * Playing a fight to the end, and checking the log against the rules.
 *
 * This is the Phase 3 "done when": *a fight against rats and kobolds runs
 * start to finish with the log matching the rules*. It drives the same
 * `createFight` the Combat screen drives — the same turn order, the same
 * attack and damage rules, the same log lines — and audits what came out.
 *
 * The audit is deliberately a **second observer**. It watches the engine
 * through its own hooks (`06` section 16) and compares what it saw with what
 * the log said, so a turn that forgot to record a step is caught: the hook
 * still fired, and the line is missing.
 *
 * What it checks, with the section each rule comes from:
 *
 *   1. every attack's hit or miss follows from its own roll (`06` section 6
 *      steps 6-7: a natural 1 always misses, a natural 20 always hits);
 *   2. the damage a line reports is the damage the target actually lost, and
 *      no hit deals less than 1 unless every part was Immune (`06` section 7
 *      steps 10-12);
 *   3. every hit, miss and death has exactly one line in the log;
 *   4. units act in the order initiative rolled, once each, and never after
 *      they fall (`06` section 3);
 *   5. the fight ends one of the three ways section 15 allows, and the XP is
 *      the sum of what was defeated (sections 13 and 15).
 */
import { createFight, standInHero } from '../../src/systems/fight.js';
import { makeMonster } from '../../src/data/monsters.js';
import { rollEncounter } from '../../src/data/encounters.js';
import { carriedStreams } from '../../src/engine/rng.js';
import { ATTACK } from '../../src/engine/attack.js';
import { DAMAGE } from '../../src/engine/damage.js';
import { t } from '../../src/data/strings.js';

/**
 * The hero the Combat screen fights with today. The 12 HP is the run's
 * stand-in from Phase 2, not a level 1 hero: `01` section 4 gives one
 * 10 + their VIG *score*, which is around 22. `--hp` is how the tool asks what
 * the fight looks like for the hero Phase 4 will actually roll.
 */
export function auditHero(hp = 12) {
  return standInHero({
    id: 'hero',
    name: 'Harrow',
    level: 1,
    hp,
    maxHp: hp,
    fp: 4,
    maxFp: 4,
  });
}

/** The cast the phase's "done when" names, and the floor-1 line it comes from. */
export const RATS_AND_KOBOLDS = ['giant_rat', 'giant_rat', 'kobold', 'kobold'];

/** How many rounds a fight may take before something is wrong. */
const ROUND_CAP = 60;

/**
 * Watches one fight through the engine's own events.
 * @param {object} combat
 */
function observe(combat) {
  const seen = {
    /** @type {object[]} */ attacks: [],
    /** @type {object[]} */ deaths: [],
    /** @type {Map<string, number>} */ damage: new Map(),
    /** @type {object[]} */ turns: [],
    /** @type {object[]} */ rounds: [],
  };

  // The last blow's damage, so a hit can be matched to the HP that went.
  let pending = null;

  combat.hooks.on(
    'damageTaken',
    (payload) => {
      if (payload.source?.kind !== 'attack') return;
      pending = { target: payload.target.id, dealt: payload.amount, toHp: payload.toHp };
    },
    { name: 'audit', order: 99, source: 'audit' },
  );

  for (const event of ['hit', 'kill']) {
    combat.hooks.on(
      event,
      (payload) => {
        if (!payload.result) return;
        seen.attacks.push({
          attacker: payload.attacker?.id,
          target: payload.target?.id,
          result: payload.result,
          damage: payload.damage,
          dealt: pending?.target === payload.target?.id ? pending.dealt : null,
          killed: event === 'kill',
          // An ability with no dice — a Web, a Wail, a Wing Buffet — lands
          // without being a blow, and says so in its own words.
          effectOnly: Boolean(payload.result?.effectOnly),
        });
        pending = null;
      },
      { name: 'audit', order: 99, source: 'audit' },
    );
  }

  combat.hooks.on(
    'miss',
    (payload) => {
      seen.attacks.push({
        attacker: payload.attacker?.id,
        target: payload.target?.id,
        result: payload.result,
        missed: true,
      });
    },
    { name: 'audit', order: 99, source: 'audit' },
  );

  combat.hooks.on(
    'kill',
    (payload) => {
      const dead = payload.target ?? payload.unit;
      // The hero's fall is announced by the ending line, not by a death line
      // among the blows, so only monsters are counted here.
      if (dead && dead.side === 'monsters') seen.deaths.push({ id: dead.id, round: combat.round });
    },
    { name: 'audit', order: 98, source: 'audit' },
  );

  return seen;
}

/**
 * Plays one fight to its ending and audits it.
 *
 * @param {object} options
 * @param {number} options.seed
 * @param {string[]} [options.monsters] monster ids; a floor roll when absent
 * @param {number} [options.floor]
 * @param {string} [options.difficulty]
 * @param {'attack' | 'defend'} [options.play] what the hero does each turn
 * @param {number} [options.hp] the hero's hit points
 * @returns {{ ok: boolean, problems: string[], rounds: number, outcome: string,
 *   log: object[], transcript: string[], attacks: number }}
 */
export function playFight({
  seed,
  monsters,
  floor = 1,
  difficulty = 'normal',
  play = 'attack',
  hp = 12,
} = {}) {
  const streams = carriedStreams(seed);
  const cast = monsters
    ? monsters.map((id) => makeMonster(id, { floor }))
    : rollEncounter(floor, streams.encounter).monsters;

  /** @type {any} */
  let seen = null;
  const fight = createFight({
    hero: auditHero(hp),
    monsters: cast,
    floor,
    streams,
    difficulty,
    surprise: true,
    // The screen keeps the last forty lines; an audit of the log against the
    // rules has to see every one of them.
    logKept: Number.POSITIVE_INFINITY,
    // The first round runs inside createFight, so the observer has to be in
    // place before it: a watcher that starts late has not seen the fight.
    watch: (combat) => {
      seen = observe(combat);
    },
  });
  let guard = 0;
  while (!fight.over && guard < ROUND_CAP * 4) {
    guard += 1;
    // What the player would do: the chosen action, or the best of what is
    // left when a condition has taken it away (`06` section 4, Legality).
    const choice = [play, 'defend', 'wait'].find((id) => fight.legality(id).legal) ?? play;
    if (!fight.act(choice).acted) break;
  }

  // Each line knows the round it was said in, so the transcript reads the way
  // the fight happened rather than the way the turns were batched.
  const transcript = [];
  let round = null;
  for (const line of fight.log) {
    if (line.round !== round) {
      round = line.round;
      transcript.push(`  round ${round}`);
    }
    transcript.push(`    ${line.text}`);
  }

  const problems = audit(fight, seen, guard);
  return {
    ok: problems.length === 0,
    problems,
    rounds: fight.round ?? 0,
    outcome: fight.outcome,
    turns: guard,
    attacks: seen.attacks.length,
    log: fight.log,
    transcript,
    summary: fight.summary,
  };
}

/* -------------------------------------------------------------------------- */
/* The audit                                                                  */
/* -------------------------------------------------------------------------- */

/** Every line the log holds, as plain text. */
const textOf = (log) => log.map((line) => line.text);

/**
 * Checks one finished fight against the rules.
 * @returns {string[]} what is wrong, empty when nothing is
 */
export function audit(fight, seen, turnsTaken) {
  const problems = [];
  const combat = fight.combat;
  const lines = textOf(fight.log);

  /* 1. Every attack's outcome follows from its own roll (`06` section 6). */
  for (const attack of seen.attacks) {
    const { result } = attack;
    if (!result || result.autoHit) continue;
    const expected =
      result.roll === ATTACK.naturalMiss
        ? false
        : result.roll === ATTACK.die
          ? true
          : result.total >= result.def;
    // A defender's reaction may turn a hit into a miss (Blink, section 6 8c).
    if (result.hit !== expected && !result.turned) {
      problems.push(
        `${attack.attacker} rolled ${result.roll} (${result.total} vs DEF ${result.def}) ` +
          `and the engine called it a ${result.hit ? 'hit' : 'miss'}`,
      );
    }
  }

  /* 2. The damage reported is the damage taken, and never below the minimum. */
  for (const attack of seen.attacks) {
    if (attack.missed || !attack.damage) continue;
    const reported = attack.damage.total ?? 0;
    if (attack.dealt != null && attack.dealt !== reported) {
      problems.push(`${attack.target} took ${attack.dealt} from a hit reported as ${reported}`);
    }
    if (reported < DAMAGE.minimum && !attack.damage.immuneAll) {
      problems.push(`a hit on ${attack.target} dealt ${reported}, under the minimum of ${DAMAGE.minimum}`);
    }
  }

  /* 3. Every hit, miss and death has a line, and the log invents nothing. */
  const hits = seen.attacks.filter((a) => !a.missed && !a.effectOnly).length;
  const misses = seen.attacks.filter((a) => a.missed && !a.effectOnly).length;
  const hitLines = lines.filter((line) => looksLike(line, ['youHit', 'youCrit', 'theyHit', 'theyCrit'])).length;
  const missLines = lines.filter((line) => looksLike(line, ['youMiss', 'theyMiss'])).length;
  const deathLines = lines.filter((line) => looksLike(line, ['dies'])).length;

  if (hitLines !== hits) problems.push(`${hits} hits landed but the log shows ${hitLines}`);
  if (missLines !== misses) problems.push(`${misses} misses but the log shows ${missLines}`);
  // A monster that rises again (Relentless, Reassemble) dies more than once.
  if (deathLines !== seen.deaths.length) {
    problems.push(`${seen.deaths.length} deaths but the log shows ${deathLines}`);
  }

  /* 4. The turn order is the one initiative rolled (`06` section 3). */
  const order = (combat.order ?? []).map((entry) => entry.unit.id);
  if (new Set(order).size !== order.length) problems.push('a unit appears twice in one turn order');
  for (const entry of combat.order ?? []) {
    if (!['first', 'normal', 'last'].includes(entry.band)) {
      problems.push(`${entry.unit.id} acts in band "${entry.band}"`);
    }
  }

  /* 5. The ending, and what it was worth (`06` sections 13 and 15). */
  if (!fight.over) problems.push(`the fight did not end in ${turnsTaken} turns`);
  if (!['victory', 'defeat', 'fled'].includes(fight.outcome)) {
    problems.push(`the fight ended as "${fight.outcome}"`);
  }
  if (fight.outcome === 'victory') {
    const owed = combat.units
      .filter((unit) => unit.side === 'monsters' && !unit.alive && !unit.fled && !unit.object)
      .reduce((total, unit) => total + (unit.xp ?? 0), 0);
    // A monster that ran is alive and gone, and is not still standing.
    if ((fight.summary?.xp ?? 0) !== owed) {
      problems.push(`victory paid ${fight.summary?.xp} XP, and the dead were worth ${owed}`);
    }
    if (combat.units.some((unit) => unit.side === 'monsters' && unit.alive && !unit.fled && !unit.object)) {
      problems.push('the fight ended in victory with something still standing');
    }
  }
  if (fight.outcome === 'defeat' && combat.hero.alive) {
    problems.push('the fight ended in defeat with the hero still up');
  }

  /* And nothing the player was never told about. */
  const unexplained = lines.filter((line) => line.includes('combat.log.') || line.includes('undefined'));
  if (unexplained.length) problems.push(`the log shows a raw key: ${unexplained[0]}`);

  return problems;
}

/**
 * Does this line come from one of these string templates? The templates carry
 * `{placeholders}`, so the check is on the fixed words around them.
 * @param {string} line
 * @param {string[]} keys
 */
function looksLike(line, keys) {
  return keys.some((key) => {
    const template = t(`combat.log.${key}`);
    const parts = template.split(/\{\w+\}/).filter((part) => part.trim().length > 1);
    return parts.length > 0 && parts.every((part) => line.includes(part));
  });
}
