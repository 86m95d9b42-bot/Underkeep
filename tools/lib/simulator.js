/**
 * The balance simulator (`00-build-outline.md`, "Balance simulator").
 *
 * It auto-plays the four example builds of `01` section 6 through the game's
 * own rules — the same `createFight` the Combat screen drives, the same
 * floors `npm run walk` walks — and measures three things the outline asks
 * for: **win rate per boss**, **XP per level**, and **gold per trip**.
 *
 * "Beatable" means beatable by someone who plays the build the way it is
 * meant to be played, so the pilot is a careful player rather than Auto-Fight:
 * the tactics lines of `02` and the skill texts of `01` section 6 are the
 * whole of its knowledge. In order, each turn:
 *
 *   1. drink below 30% HP (Auto-Fight's own rule, `06` section 17);
 *   2. break out of a web;
 *   3. Defend into a telegraph that hurts (`06` section 4) — not into a
 *      shield being raised or a summoning;
 *   4. break what is protecting the boss — the Phylactery, the valves;
 *   5. a heal skill when it is needed and no potion is left;
 *   6. set up: a ward, Blink, Hunter's Mark on the boss, Envenom, Vanish;
 *   7. Sleep or a Fireball on a row worth it;
 *   8. the best attacking skill it can pay for — Death Strike on the boss
 *      from hiding first;
 *   9. otherwise a swing at the weakest enemy it can reach.
 */
import { createFight } from '../../src/systems/fight.js';
import { BOSSES, bossOnFloor } from '../../src/data/bosses.js';
import { EXPECTED_LEVEL, buildHero, buildIds } from './builds.js';
import { skill } from '../../src/data/skills.js';
import { rollEncounter } from '../../src/data/encounters.js';
import { carriedStreams } from '../../src/engine/rng.js';
import { abilityOf } from '../../src/engine/ai.js';
import { buffOf } from '../../src/engine/skill-actions.js';
import { has } from '../../src/engine/conditions.js';

/** How many rounds a fight may take before it is called a draw. */
const ROUND_CAP = 80;

/** Below this share of hit points, Auto-Fight drinks (`06` section 17). */
const DRINK_BELOW = 0.3;

/** Below this share, a hero with no potion left reaches for a heal skill. */
const HEAL_BELOW = 0.4;

/** Second Wind is a quarter of the hero back, so it waits for a real dent. */
const SECOND_WIND_BELOW = 0.5;

/**
 * Where the tactics lines of `02` say to go for the boss rather than what is
 * around it: the Hydra's body ("go straight for the Body"). Everywhere else
 * the weakest enemy goes first — measured against the Bone Warden, Grukk and
 * the Brood Mother, it wins more often than chasing the boss through its
 * escort.
 */
const FOCUS = {
  hydra: 'boss',
};

/** Telegraphed abilities that are not blows: nothing to Defend against. */
const HARMLESS_ROLES = new Set(['defensive', 'summon', 'support', 'buff', 'heal']);

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

/** The boss, while it stands. */
function bossOf(fight) {
  return (fight.combat.units ?? []).find((unit) => unit.boss && unit.alive) ?? null;
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
 * Whether now is the time to break this object. The Phylactery, always: it is
 * the whole fight. A coolant valve is worth more held back, for the Colossus
 * burning red or a Hammerfall on its way (`02` section 10's tactics line).
 */
function breakNow(fight, prop) {
  if (prop.type !== 'coolant_valve') return true;
  const boss = bossOf(fight);
  return Boolean(boss && (boss.stoked || boss.telegraph));
}

/** A torch in the pack, for a stump that must not grow back. */
function torchInReach(fight) {
  return fight.items.find((entry) => entry.baseId === 'torch' && !entry.why);
}

/** True when a wind-up is coming that will actually hurt. */
function harmfulTelegraph(fight) {
  return (fight.combat.units ?? []).some((unit) => {
    if (!unit.alive || !unit.telegraph) return false;
    const ability = abilityOf(unit, unit.telegraph.ability);
    return !(ability && (HARMLESS_ROLES.has(ability.role) || ability.action === 'guard'));
  });
}

/**
 * The enemies this action reaches, in the order a careful player would take
 * them: the boss first when the tactics say so, otherwise the weakest.
 */
function ordered(fight, action = 'attack', options = {}) {
  const reach = targets(fight, action, options);
  const boss = bossOf(fight);
  if (!boss || !reach.some((unit) => unit.id === boss.id)) return reach;
  const focus = FOCUS[boss.type] ?? 'escort';
  const ranged = (fight.hero.attack?.kind ?? 'melee') !== 'melee' || action === 'skill';
  const bossFirst = focus === 'boss' || (focus === 'ranged' && ranged);
  return bossFirst ? [boss, ...reach.filter((unit) => unit.id !== boss.id)] : reach;
}

/** Whether the hero knows a skill and could use it on this target now. */
function canUse(fight, id, target) {
  const known = (fight.hero.skills ?? []).some((row) => row.id === id);
  if (!known) return false;
  return fight.legality('skill', { skill: id, ...(target ? { target } : {}) }).legal;
}

function use(fight, id, target) {
  return fight.act('skill', { skill: id, ...(target ? { target } : {}) }).acted;
}

/** Heal skills, when the hero is low and the potions are gone. */
function healIfNeeded(fight) {
  const hero = fight.hero;
  const share = (hero.hp ?? 0) / Math.max(1, hero.maxHp ?? 1);
  if (share < SECOND_WIND_BELOW && canUse(fight, 'second_wind') && use(fight, 'second_wind')) return true;
  if (share < HEAL_BELOW && !potionInReach(fight) && canUse(fight, 'mend') && use(fight, 'mend')) return true;
  return false;
}

/**
 * The setting-up a player does when a fight is worth it: a ward against a
 * boss, Blink before its blows, the Mark on it, poison on the blade, and
 * Vanish for the Death Strike to follow.
 */
function setUp(fight) {
  const boss = bossOf(fight);
  const hero = fight.hero;
  const tough = boss || fight.combat.units.some((unit) => unit.alive && unit.side === 'monsters' && (unit.hd ?? 0) >= (hero.level ?? 1));
  if (!tough) return false;
  const combat = fight.combat;

  if (!buffOf(combat, hero, 'spiritWard') && canUse(fight, 'spirit_ward') && use(fight, 'spirit_ward')) return true;
  if (boss && !buffOf(combat, hero, 'blink') && canUse(fight, 'blink') && use(fight, 'blink')) return true;

  const mark = buffOf(combat, hero, 'huntersMark');
  const markOn = boss ?? targets(fight)[targets(fight).length - 1];
  const markedAlive = mark && combat.units.some((unit) => unit.id === mark.target && unit.alive);
  if (markOn && !markedAlive && canUse(fight, 'ranger', markOn.id) && use(fight, 'ranger', markOn.id)) return true;

  if (canUse(fight, 'envenom') && use(fight, 'envenom')) return true;

  // Vanish is worth a turn only with a Death Strike to follow it.
  const strikeCost = skill('death_strike').fp ?? 0;
  const knowsStrike = (hero.skills ?? []).some((row) => row.id === 'death_strike');
  if (knowsStrike && !has(hero, 'hidden') && (hero.fp ?? 0) >= (skill('vanish').fp ?? 0) + strikeCost) {
    if (canUse(fight, 'vanish') && use(fight, 'vanish')) return true;
  }
  return false;
}

/** Sleep a row of two or more that can sleep, or Fireball a row of two or more. */
function rowSpell(fight) {
  const enemies = (fight.combat.units ?? []).filter((unit) => unit.alive && unit.side === 'monsters' && !unit.object);
  for (const row of ['front', 'back']) {
    const here = enemies.filter((unit) => unit.row === row);
    if (here.length === 0) continue;
    const aim = here[0].id;
    const sleepable = here.filter(
      (unit) => unit.family !== 'undead' && (unit.hd ?? 0) <= (fight.hero.level ?? 1) + 2 && !has(unit, 'asleep') && !unit.boss,
    );
    if (sleepable.length >= 2 && canUse(fight, 'sleep', sleepable[0].id) && use(fight, 'sleep', sleepable[0].id)) return true;
    const worth = here.length >= 2 || here.some((unit) => unit.boss);
    if (worth && canUse(fight, 'fireball', aim) && use(fight, 'fireball', aim)) return true;
  }
  return false;
}

/**
 * The best attack skill it can pay for, dearest first. Death Strike and a
 * sleeping or stunned target come first; the boss is the target of anything
 * that trebles against it.
 */
function attackSkill(fight) {
  const hero = fight.hero;
  const boss = bossOf(fight);
  if (boss && canUse(fight, 'death_strike', boss.id) && use(fight, 'death_strike', boss.id)) return true;

  const ids = (hero.skills ?? [])
    .map((row) => row.id)
    .filter((id) => {
      const act = skill(id).action;
      return act?.kind && act.target !== 'row' && id !== 'death_strike';
    })
    .sort((a, b) => (skill(b).fp ?? 0) - (skill(a).fp ?? 0));

  for (const id of ids) {
    for (const unit of ordered(fight, 'skill', { skill: id })) {
      if (canUse(fight, id, unit.id) && use(fight, id, unit.id)) return true;
    }
  }
  // A sleeping or stunned enemy is a Death Strike waiting to happen.
  for (const unit of targets(fight)) {
    if (canUse(fight, 'death_strike', unit.id) && use(fight, 'death_strike', unit.id)) return true;
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

  // 3. Defend into a wind-up that hurts: half damage, and the save has advantage.
  if (harmfulTelegraph(fight) && fight.legality('defend').legal && fight.act('defend').acted) return 'defend';

  // 4. Break what is keeping the boss up, when it is time.
  const prop = propOf(fight);
  if (prop && breakNow(fight, prop) && fight.legality('attack', { target: prop.id }).legal) {
    if (fight.act('attack', { target: prop.id }).acted) return 'object';
  }

  // 4b. Sear a Hydra stump before it grows back double (`02` section 8).
  const stumped = (fight.combat.units ?? []).some((unit) => (unit.stumps ?? 0) > 0);
  const torch = stumped && torchInReach(fight);
  if (torch && fight.act('item', { item: torch.id }).acted) return 'torch';

  // 5-8. Heal, set up, a row spell, the best attack skill.
  if (healIfNeeded(fight)) return 'heal';
  if (setUp(fight)) return 'setUp';
  if (rowSpell(fight)) return 'skill';
  if (attackSkill(fight)) return 'skill';

  // 9. A swing at whoever the tactics say comes first.
  const first = ordered(fight)[0];
  if (first && fight.act('attack', { target: first.id }).acted) return 'attack';
  if (fight.act('attack').acted) return 'attack';
  return fight.act('defend').acted ? 'defend' : 'stuck';
}

/** Plays a fight to its end, and says how it went. */
export function flyFight(fight) {
  const did = { potion: 0, defend: 0, heal: 0, setUp: 0, skill: 0, attack: 0, object: 0, torch: 0, breakFree: 0 };
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
