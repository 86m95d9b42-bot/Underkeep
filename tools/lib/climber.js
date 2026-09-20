/**
 * Climbing from level 1 to level 5 on floors 1 and 2 — the Phase 4
 * "done when".
 *
 * It plays the game the way the screens play it, with nothing simulated:
 * `createDraft`/`finish` roll a hero the way Create: Attributes does,
 * `createRun` walks the floor the way Exploration does, the step clock's own
 * wandering check decides when something finds the hero (`05` section 7),
 * `rollEncounter` says what it is (`02` section 18), and `createFight` plays
 * the fight out to `06` section 15 — which is what pays the XP and levels the
 * hero.
 *
 * **What it assumes, and why.** A hero on floors 1 and 2 has no potion and no
 * Inn: `04` items are Phase 5 and the town is Phase 6. So the one thing this
 * tool supplies is the trip itself — the hero walks down, fights what finds
 * them, turns back when they are hurt, and is made whole in town before
 * going again. `--rest=never` asks the other question: how far the same hero
 * gets without ever healing.
 *
 * Death is what the mode says it is (`05` section 9 and 11): an Adventurer
 * wakes in town having lost half their gold and goes back down, an Ironman's
 * climb is over.
 */
import { createRun } from '../../src/systems/run.js';
import { createFight, standInHero } from '../../src/systems/fight.js';
import { rollEncounter } from '../../src/data/encounters.js';
import { chooseOrigin, createDraft, finish, setName, swap } from '../../src/systems/creation.js';
import { progress } from '../../src/systems/levelling.js';
import { learn, spentTotal } from '../../src/systems/skill-tree.js';
import { walkFloor } from './walker.js';

/** The floors the phase names. */
export const FLOORS = [1, 2];

/** How many rounds a fight may take before something is wrong. */
const ROUND_CAP = 60;

/**
 * What each origin wants its best rolls in. A player arranging a Standard
 * set puts them somewhere on purpose, so the tool does too — otherwise the
 * question it answers is "can an unarranged hero climb", which is not the
 * question.
 */
/**
 * What each origin spends its skill points on, in order. A hero who never
 * spends them is not the hero the phase is asking about: `01` section 3 hands
 * two points over at creation and one every level after.
 */
export const BUILDS = {
  sellsword: ['toughness', 'mend', 'toughness', 'toughness', 'weapon_training', 'weapon_training'],
  cutpurse: ['toughness', 'mend', 'toughness', 'marksman', 'marksman', 'toughness'],
  apprentice: ['toughness', 'mend', 'arcane_well', 'toughness', 'toughness', 'arcane_well'],
  pilgrim: ['toughness', 'toughness', 'toughness', 'weapon_training', 'weapon_training', 'keen_senses'],
};

export const PRIORITIES = {
  sellsword: ['might', 'vigor', 'agility', 'wits', 'luck', 'intellect'],
  cutpurse: ['agility', 'vigor', 'might', 'luck', 'wits', 'intellect'],
  apprentice: ['intellect', 'vigor', 'agility', 'wits', 'luck', 'might'],
  pilgrim: ['wits', 'vigor', 'might', 'agility', 'luck', 'intellect'],
};

/**
 * Rolls a hero the way a player rolls one: a Standard set, arranged best-first
 * into what the origin lives on, then the origin and a name.
 */
export function rollHero(seed, { origin = 'sellsword', name = 'Harrow' } = {}) {
  let draft = createDraft({ seed, rollMode: 'standard' });
  const wanted = PRIORITIES[origin] ?? PRIORITIES.sellsword;

  // Selection sort through the screen's own two-tap swap: the highest score
  // left goes to the next attribute on the list.
  for (const [place, attribute] of wanted.entries()) {
    const rest = wanted.slice(place);
    const best = rest.reduce((a, b) => (draft.scores[b] > draft.scores[a] ? b : a));
    if (best !== attribute) draft = swap(draft, attribute, best);
  }

  const hero = finish(setName(chooseOrigin(draft, origin), name));
  spendPoints(hero);
  return hero;
}

/**
 * Spends whatever skill points the hero has, down their origin's list. Called
 * again after every level, because a level hands one more over.
 * @param {object} hero
 */
export function spendPoints(hero) {
  const wanted = BUILDS[hero.origin] ?? BUILDS.sellsword;
  for (const id of wanted) {
    if ((hero.skillPoints ?? 0) - spentTotal(hero) <= 0) return hero;
    learn(hero, id);
  }
  return hero;
}

/**
 * Plays one fight to its end. The hero attacks, and runs when they are hurt
 * badly enough — the only two things a hero without a pack can do
 * (`06` section 4's action list, minus the items and skills of later phases).
 *
 * @param {object} run
 * @param {object} options
 * @param {number} options.fleeBelow the share of hit points left at which the
 *   hero stops trading blows and takes the flee roll's two free attacks
 * @param {boolean} [options.surprise] the monsters caught the hero out
 */
export function fightOut(run, { fleeBelow, surprise = false }) {
  const monsters = rollEncounter(run.floor.floor, run.rng.encounter).monsters;
  const fight = createFight({
    hero: standInHero(run.hero),
    monsters,
    floor: run.floor.floor,
    streams: run.rng,
    surprise,
    difficulty: run.hero.difficulty ?? 'normal',
  });

  let turns = 0;
  while (!fight.over && turns < ROUND_CAP * 4) {
    turns += 1;
    const acted = fight.act(...chooseTurn(fight, fleeBelow));
    // A refused action would spin the loop; defending always passes.
    if (!acted.acted) fight.act('defend');
  }

  return {
    outcome: fight.outcome,
    xp: fight.summary?.xp ?? 0,
    gold: fight.summary?.gold ?? 0,
    levels: fight.summary?.levels ?? [],
    monsters: monsters.map((one) => one.type ?? one.id ?? one),
    rounds: fight.round ?? 0,
  };
}

/**
 * What the hero does with their turn: heal when a wound is getting dangerous
 * and they can still pay for it, run when healing is not going to be enough,
 * and otherwise hit the thing in front of them with the best swing they have.
 *
 * This is a careful player, not a clever one: no positioning, no saving Focus
 * for later, no picking targets. If *this* reaches level 5, a player can.
 *
 * @param {object} fight
 * @param {number} fleeBelow
 * @returns {[string, object]} the arguments for `fight.act`
 */
export function chooseTurn(fight, fleeBelow) {
  const hero = fight.hero;
  const share = hero.hp / Math.max(1, hero.maxHp);
  const can = (id) => fight.legality('skill', { skill: id }).legal;

  // A heal is worth taking while there is still a turn to spare for it.
  if (share <= 0.6) {
    for (const id of ['mend', 'second_wind']) if (can(id)) return ['skill', { skill: id }];
  }
  if (share <= fleeBelow && fight.legality('flee').legal) return ['flee', {}];
  for (const id of ['power_strike', 'smite', 'magic_missile']) {
    if (can(id)) return ['skill', { skill: id }];
  }
  return ['attack', {}];
}

/**
 * One trip: floor 1 to its arena door, then floor 2, fighting whatever the
 * clock turns up on the way. The trip ends early when the hero dies or
 * reaches the level being climbed to.
 *
 * @param {object} state
 */
function oneTrip(state) {
  const { masterSeed, target, fleeBelow, turnBackAt, notes } = state;
  state.retreat = false;

  for (const floorNumber of FLOORS) {
    // The streams carry from floor to floor, as a resumed run does
    // (`05` section 11): the same trip cannot be re-rolled by walking down.
    const run = createRun({
      masterSeed,
      floor: floorNumber,
      hero: state.hero,
      streams: state.streams,
    });
    state.streams = run.rng;
    state.walked = 0;

    for (let leg = 0; leg < 200; leg += 1) {
      const walk = walkFloor(masterSeed, floorNumber, {
        run,
        bashBonus: state.bashBonus,
        onEvents: (events) => {
          const found = events.find((event) => event.encounter);
          if (!found) return undefined;
          const result = fightOut(run, { fleeBelow, surprise: found.surprise });
          notes.fights += 1;
          notes.xp += result.xp;
          notes.gold += result.gold;
          notes.rounds += result.rounds;
          notes.outcomes[result.outcome] = (notes.outcomes[result.outcome] ?? 0) + 1;
          for (const level of result.levels) notes.levels.push(level.level);
          if (result.levels.length) spendPoints(state.hero);
          // A careful player who is badly hurt turns round and walks out
          // rather than meeting the next thing on the floor. There is nothing
          // else to do about a wound until Phase 5's potions and Phase 6's Inn.
          if (state.hero.hp / Math.max(1, state.hero.maxHp) < turnBackAt) {
            state.retreat = true;
            notes.retreats += 1;
          }
          return 'stop';
        },
      });

      notes.steps += run.ex.steps - (state.walked ?? 0);
      state.walked = run.ex.steps;
      if (!state.hero.alive || state.hero.hp <= 0) return 'died';
      if (state.hero.level >= target) return 'reached';
      if (state.retreat) return 'walked';
      // The walk stopped for a fight: pick it up from the same tile.
      if (walk.stopped) continue;
      if (!walk.ok) return `stuck on floor ${floorNumber}: ${walk.why}`;
      break;
    }
  }
  return 'walked';
}

/**
 * Climbs one hero from level 1 as far as the target level, or until they fall.
 *
 * @param {number} masterSeed
 * @param {object} [options]
 * @param {number} [options.target] the level to climb to
 * @param {number} [options.trips] how many trips down they may take
 * @param {'trip' | 'never'} [options.rest] whether town makes them whole
 *   between trips (Phase 6's Inn) or they never heal at all
 * @param {number} [options.fleeBelow] the share of hit points at which the
 *   hero runs from a fight rather than trading another blow
 * @param {number} [options.turnBackAt] the share at which they leave the
 *   floor altogether
 * @param {string} [options.origin]
 * @param {'adventurer' | 'ironman'} [options.mode] what a death costs
 */
export function climb(masterSeed, {
  target = 5,
  trips = 60,
  rest = 'trip',
  fleeBelow = 0.5,
  turnBackAt = 0.8,
  origin = 'sellsword',
  mode = 'adventurer',
} = {}) {
  const hero = rollHero(masterSeed, { origin });
  const notes = {
    fights: 0,
    xp: 0,
    gold: 0,
    rounds: 0,
    steps: 0,
    retreats: 0,
    deaths: 0,
    levels: [],
    outcomes: {},
  };
  const state = {
    masterSeed,
    hero,
    target,
    fleeBelow,
    turnBackAt,
    notes,
    streams: undefined,
    bashBonus: hero.bashBonus ?? 0,
  };

  let why = 'out of trips';
  let taken = 0;
  for (; taken < trips; taken += 1) {
    if (taken > 0 && rest === 'trip') {
      // The Inn and the Temple, standing in for themselves until Phase 6
      // builds them. Focus comes back only by resting (`01` section 4).
      hero.hp = hero.maxHp;
      hero.fp = hero.maxFp;
    }
    const outcome = oneTrip(state);
    if (outcome === 'reached') {
      why = 'reached';
      taken += 1;
      break;
    }
    if (outcome === 'died') {
      notes.deaths += 1;
      // `05` section 9: an Ironman's run ends here. An Adventurer wakes in
      // town, half their gold left behind in a Grave, and goes down again —
      // their level and their experience are theirs to keep.
      if (mode === 'ironman') {
        why = 'died';
        taken += 1;
        break;
      }
      hero.gold = Math.floor((hero.gold ?? 0) / 2);
      hero.hp = hero.maxHp;
      hero.fp = hero.maxFp;
      hero.alive = true;
      continue;
    }
    if (outcome !== 'walked') {
      why = outcome;
      taken += 1;
      break;
    }
  }

  const climbed = progress(hero);
  return {
    ok: hero.level >= target,
    why,
    mode,
    trips: taken,
    level: hero.level,
    xp: hero.xp,
    into: climbed.into,
    needed: climbed.needed,
    hp: hero.hp,
    maxHp: hero.maxHp,
    gold: hero.gold ?? 0,
    alive: hero.alive !== false && hero.hp > 0,
    ...notes,
  };
}
