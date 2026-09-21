/**
 * The balance simulator (`00-build-outline.md`, "Balance simulator").
 *
 * It auto-plays the four example builds of `01` section 6 through the game's
 * own rules — the same `createFight` the Combat screen drives, the same
 * floors `npm run walk` walks — and measures three things the outline asks
 * for: **win rate per boss**, **XP per level**, and **gold per trip**.
 *
 * The hero is flown by the Auto-Fight rules of `06` section 17, plus the two
 * decisions those rules leave to the player and every tactics line in `02`
 * spells out anyway:
 *
 *   1. **Defend into a telegraph.** A wind-up halves against a Defending
 *      hero and its saves get advantage (`06` section 4).
 *   2. **Break what is protecting the boss.** The Phylactery keeps the Lich
 *      standing and a coolant valve douses the Colossus; `02` says so in as
 *      many words.
 *
 * Everything else is Auto-Fight: a potion below 30%, the best skill the hero
 * can afford, otherwise a swing at the enemy with the fewest hit points.
 */
import { createFight } from '../../src/systems/fight.js';
import { createRun } from '../../src/systems/run.js';
import { createSession } from '../../src/systems/session.js';
import { BOSSES, bossOnFloor } from '../../src/data/bosses.js';
import { EXPECTED_LEVEL, buildHero, buildIds } from './builds.js';
import { skill } from '../../src/data/skills.js';
import { rollEncounter } from '../../src/data/encounters.js';
import { carriedStreams } from '../../src/engine/rng.js';

/** How many rounds a fight may take before it is called a draw. */
const ROUND_CAP = 80;

/** Below this share of hit points, Auto-Fight drinks (`06` section 17). */
const DRINK_BELOW = 0.3;

/* -------------------------------------------------------------------------- */
/* Flying the hero                                                            */
/* -------------------------------------------------------------------------- */

/** The healing potion in a quick slot, if there is one. */
function potionInReach(fight) {
  return fight.items.find(
    (entry) => entry.quick && !entry.why && /healing_potion|elixir/.test(entry.baseId),
  );
}

/**
 * Every enemy this action could actually reach, weakest first. Rows are the
 * whole of it: melee reaches the front row while anyone stands in it
 * (`01` section 7), so the legality check is what knows.
 */
function targets(fight, action = 'attack', options = {}) {
  const check = fight.legality(action, options);
  return [...(check.targets ?? [])]
    .filter((unit) => unit.alive && !unit.object)
    .sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0));
}

/**
 * What is holding the boss up: an object whose breaking is the fight's own
 * answer (`02` sections 10 and 12).
 */
function propOf(fight) {
  return (fight.combat.units ?? []).find(
    (unit) => unit.object && unit.alive && !unit.spent && unit.side === 'monsters',
  );
}

/**
 * The skills worth trying this turn, dearest first: anything that attacks
 * (it has a `kind`: melee, ranged or spell) and, when the hero is below
 * half, anything that heals. Whether it can actually be used — Death Strike
 * wants a helpless target, a spell wants Focus — is the fight's to say.
 */
function skillsToTry(fight) {
  const hero = fight.hero;
  const hurt = (hero.hp ?? 0) < (hero.maxHp ?? 1) * 0.5;
  return (hero.skills ?? [])
    .map((row) => ({ row, entry: skill(row.id) }))
    .filter(({ entry }) => entry.type === 'active' && (entry.fp ?? 0) <= (hero.fp ?? 0))
    .filter(({ entry }) => (entry.action?.heal ? hurt : Boolean(entry.action?.kind)))
    .sort((a, b) => (b.entry.fp ?? 0) - (a.entry.fp ?? 0))
    .map(({ row }) => row.id);
}

/** Uses the dearest skill that is legal now, on the weakest thing it reaches. */
function useBestSkill(fight) {
  for (const id of skillsToTry(fight)) {
    const reach = targets(fight, 'skill', { skill: id });
    // A heal or a whole-row spell may have no single target to pick.
    const tries = reach.length > 0 ? reach : [null];
    for (const unit of tries) {
      const options = { skill: id, ...(unit ? { target: unit.id } : {}) };
      if (!fight.legality('skill', options).legal) continue;
      if (fight.act('skill', options).acted) return true;
    }
  }
  return false;
}

/**
 * One turn of the hero's, by the rules above.
 * @returns {string} what it did, for the report
 */
export function flyOneTurn(fight) {
  const hero = fight.hero;

  // 1. A potion below 30% (`06` section 17).
  if ((hero.hp ?? 0) < (hero.maxHp ?? 1) * DRINK_BELOW) {
    const potion = potionInReach(fight);
    if (potion && fight.act('item', { item: potion.id }).acted) return 'potion';
  }

  // 2. Get out of the web: a Webbed hero cannot attack at all, and
  //     Break Free is the action `06` section 4 gives them for it.
  if (fight.legality('breakFree').legal && fight.act('breakFree').acted) return 'breakFree';

  // 3. Defend into a wind-up: half damage, and the save has advantage.
  const winding = fight.telegraphPending;
  if (winding && fight.legality('defend').legal && fight.act('defend').acted) return 'defend';

  // 4. Break what is keeping the boss up.
  const prop = propOf(fight);
  if (prop && fight.legality('attack', { target: prop.id }).legal) {
    if (fight.act('attack', { target: prop.id }).acted) return 'object';
  }

  // 5. The best skill, then a swing at the weakest thing it can reach.
  if (useBestSkill(fight)) return 'skill';
  const weakest = targets(fight)[0];
  if (weakest && fight.act('attack', { target: weakest.id }).acted) return 'attack';
  if (fight.act('attack').acted) return 'attack';
  return fight.act('defend').acted ? 'defend' : 'stuck';
}

/** Plays a fight to its end, and says how it went. */
export function flyFight(fight) {
  const did = { potion: 0, defend: 0, skill: 0, attack: 0, object: 0, breakFree: 0 };
  let guard = 0;
  while (!fight.over && guard < ROUND_CAP * 6) {
    guard += 1;
    const what = flyOneTurn(fight);
    if (what === 'stuck') break;
    did[what] = (did[what] ?? 0) + 1;
  }
  return { outcome: fight.outcome, rounds: fight.round, did, fight };
}

/* -------------------------------------------------------------------------- */
/* What it measures                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One build against one boss, at the level `02` section 3 expects.
 * @param {string} build
 * @param {number} floor
 * @param {number} seed
 */
export function fightBoss(build, floor, seed) {
  const id = bossOnFloor(floor);
  const hero = buildHero(build, { floor, seed });
  const fight = createFight({
    hero,
    boss: id,
    floor,
    masterSeed: seed,
    difficulty: 'normal',
    logKept: 20,
  });
  const played = flyFight(fight);
  return { ...played, boss: id, build, floor, level: hero.level, hp: hero.hp };
}

/**
 * Every build against every boss.
 * @param {{ builds?: string[], floors?: number[], seeds?: number }} [options]
 */
export function bossTable({ builds = buildIds(), floors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seeds = 20 } = {}) {
  const rows = [];
  for (const build of builds) {
    for (const floor of floors) {
      let won = 0;
      let rounds = 0;
      const did = {};
      for (let seed = 0; seed < seeds; seed += 1) {
        const played = fightBoss(build, floor, 7919 * (seed + 1) + floor);
        if (played.outcome === 'victory') won += 1;
        rounds += played.rounds ?? 0;
        for (const [what, times] of Object.entries(played.did)) did[what] = (did[what] ?? 0) + times;
      }
      rows.push({
        build,
        floor,
        boss: bossOnFloor(floor),
        won,
        of: seeds,
        rate: won / seeds,
        rounds: rounds / seeds,
        did,
      });
    }
  }
  return rows;
}

/**
 * A trip's worth of fighting on one floor: what the floor's own encounter
 * table pays in experience and gold (`02` section 16, `06` section 15).
 */
export function fightsOnFloor(build, floor, { seed = 4242, fights = 6 } = {}) {
  const hero = buildHero(build, { floor, seed });
  const streams = carriedStreams(seed);
  const before = { xp: hero.totalXp ?? hero.xp ?? 0, gold: hero.gold ?? 0, level: hero.level };
  let won = 0;

  for (let i = 0; i < fights; i += 1) {
    if (!hero.alive || (hero.hp ?? 0) <= 0) break;
    const rolled = rollEncounter(floor, streams.encounter);
    if (rolled.monsters.length === 0) continue;
    const fight = createFight({
      hero,
      monsters: rolled.monsters,
      floor,
      streams,
      difficulty: 'normal',
      logKept: 10,
    });
    const played = flyFight(fight);
    if (played.outcome === 'victory') won += 1;
    // Between fights a hero rests as far as their own healing takes them,
    // which is what a trip looks like: potions are the only other answer.
    hero.hp = Math.min(hero.maxHp, hero.hp + Math.floor(hero.maxHp * 0.1));
    hero.fp = Math.min(hero.maxFp, hero.fp + Math.ceil(hero.maxFp * 0.2));
  }

  return {
    build,
    floor,
    fights: won,
    xp: (hero.totalXp ?? hero.xp ?? 0) - before.xp,
    gold: (hero.gold ?? 0) - before.gold,
    levels: hero.level - before.level,
    alive: hero.alive && (hero.hp ?? 0) > 0,
  };
}

/** What every build earns on every floor, for the XP and gold columns. */
export function earningTable({ builds = buildIds(), floors = [1, 3, 5, 7, 9], seeds = 5 } = {}) {
  const rows = [];
  for (const build of builds) {
    for (const floor of floors) {
      let xp = 0;
      let gold = 0;
      let survived = 0;
      for (let seed = 0; seed < seeds; seed += 1) {
        const trip = fightsOnFloor(build, floor, { seed: 613 * (seed + 1) + floor });
        xp += trip.xp;
        gold += trip.gold;
        if (trip.alive) survived += 1;
      }
      rows.push({ build, floor, xp: xp / seeds, gold: gold / seeds, survived, of: seeds });
    }
  }
  return rows;
}

/** The target `00` sets: every build beats every boss six times in ten. */
export const TARGET_WIN_RATE = 0.6;

export { BOSSES, EXPECTED_LEVEL };
