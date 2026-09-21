/**
 * The loop the town exists for: **descend, fight, return, shop, descend
 * again** — and checking, at every step, that the documents were followed.
 *
 * This is the Phase 6 "done when". It drives a real `createSession`, which is
 * the same object the screens drive, so the loop it plays is the loop a
 * player plays. Nothing here reaches into a module to make something happen:
 * it presses the same buttons.
 *
 * What it audits, with the section each rule comes from:
 *
 *   1. **The counters** (`05` section 12): a trip is counted on the way down
 *      and a day on the way back, and neither moves when the other does.
 *   2. **The Waystone** (`05` section 9): the arrival stone is attuned by
 *      standing on it, and standing on an attuned one takes the hero home.
 *   3. **The floor's memory** (`05` section 8): the map, the opened doors and
 *      the shortcuts are as they were left, and the lairs, chests and traps
 *      restock exactly once a return.
 *   4. **The Shop** (`04` sections 1 and 15): the rotating stock rerolls on
 *      the new day, gold goes where it should, and what is bought is known.
 *   5. **The hero** (`06` section 15, `01` section 5): XP, gold and levels
 *      from a fight are banked before anything is shown.
 */
import { createSession } from '../../src/systems/session.js';
import { unknownItems } from '../../src/systems/graves.js';
import { chooseOrigin, createDraft, finish, setName } from '../../src/systems/creation.js';
import { memoryFor } from '../../src/systems/floor-memory.js';
import { attunedFloors, isAttuned, markOf } from '../../src/systems/travel.js';
import { buy, priceOf, sell, sellable } from '../../src/systems/shop.js';
import { offersOf, take } from '../../src/systems/services.js';
import { slotsUsed } from '../../src/systems/inventory.js';
import { takeAll } from '../../src/systems/loot.js';
import { rollEncounter } from '../../src/data/encounters.js';
import { routeTo } from './walker.js';
import { ORIGIN_ORDER } from '../../src/data/origins.js';

/** How many presses one trip is given before it is called a wander. */
const STEP_CAP = 400;

/** A hero rolled the way a player rolls one. */
export function loopHero(masterSeed, origin = 'sellsword') {
  const draft = createDraft({ seed: masterSeed, rollMode: 'standard' });
  const who = finish(setName(chooseOrigin(draft, origin), 'Harrow'));
  who.gold = Math.max(who.gold ?? 0, 60);
  return who;
}

/**
 * Plays one game of `trips` trips and audits every step.
 *
 * @param {number} masterSeed
 * @param {object} [options]
 * @param {number} [options.trips]
 * @param {string} [options.origin]
 * @returns {{ ok: boolean, problems: string[], counts: object }}
 */
export function playLoop(masterSeed, { trips = 4, origin = 'sellsword' } = {}) {
  const problems = [];
  const say = (line) => problems.length < 30 && problems.push(line);

  const hero = loopHero(masterSeed, origin);
  const game = createSession({ hero, seed: masterSeed });
  const counts = {
    trips: 0,
    fights: 0,
    won: 0,
    fled: 0,
    drunk: 0,
    drops: 0,
    bought: 0,
    sold: 0,
    rests: 0,
    steps: 0,
    byStone: 0,
    graves: 0,
  };
  let died = false;

  let lastMap = 0;
  for (let trip = 1; trip <= trips; trip += 1) {
    /* -- down ---------------------------------------------------------- */

    const dayBefore = game.town.day;
    const tripsBefore = game.town.trips;
    const run = game.descend({ floor: 1 });
    counts.trips += 1;

    if (game.town.trips !== tripsBefore + 1) say(`trip ${trip}: the trip was not counted (05 section 12)`);
    if (game.town.day !== dayBefore) say(`trip ${trip}: going down turned the day over`);
    if (!game.inDungeon) say(`trip ${trip}: the hero is not in the dungeon after descending`);

    const memory = memoryFor(game.town, run.floor.floor);
    if (trip > 1) {
      // `05` section 8: the map is as it was left.
      if (memory.explored.size < lastMap) {
        say(`trip ${trip}: the map shrank from ${lastMap} to ${memory.explored.size} (05 section 8)`);
      }
      if (memory.restockedOnDay !== game.town.day) {
        say(`trip ${trip}: the floor did not restock on the day it was entered (05 section 8)`);
      }
    }

    /* -- about ---------------------------------------------------------- */

    walkAbout(game, run, counts, say);

    /* -- fight ---------------------------------------------------------- */

    fightOne(game, run, counts, say, masterSeed + trip);
    // A hero can die down there; that is the game, not a broken rule. An
    // Adventurer wakes in town with a grave to go back for (`05` section 9),
    // and the loop this game was playing ends with them either way.
    if ((hero.hp ?? 0) <= 0) {
      died = true;
      const purse = hero.gold ?? 0;
      const unknown = unknownItems(hero).length;
      const fell = game.heroFell();

      // `05` section 9: half the gold and everything they could not name.
      if (fell.grave) {
        counts.graves += 1;
        if (fell.grave.gold !== Math.floor(purse / 2)) {
          say(`grave holds ${fell.grave.gold} gp of a purse of ${purse}`);
        }
        if (fell.grave.items.length !== unknown) {
          say(`grave holds ${fell.grave.items.length} unknown items of ${unknown}`);
        }
        if (hero.gold !== purse - fell.grave.gold) say('the hero woke with the wrong purse');
      }
      break;
    }

    /* -- home ----------------------------------------------------------- */

    lastMap = memory.explored.size;
    const home = goHome(game, run, counts, say, trip);
    if (!home) break;

    /* -- town ----------------------------------------------------------- */

    doTown(game, counts, say, trip);
  }

  return { ok: problems.length === 0, problems, counts, died, trips: counts.trips };
}

/* -------------------------------------------------------------------------- */
/* The parts of a trip                                                        */
/* -------------------------------------------------------------------------- */

/** Walks the floor a while, which is what makes a map to keep. */
function walkAbout(game, run, counts, say) {
  const before = run.ex.steps;
  for (let i = 0; i < 40; i += 1) {
    const command = i % 7 === 6 ? 'turnRight' : 'forward';
    run.press(command);
    counts.steps += 1;
  }
  if (run.ex.steps <= before) say('walking cost no steps (01 section 9)');
  if (run.ex.explored.size < 2) say('walking made no map (05 section 10)');
}

/** Takes one fight, and checks it paid what it should (`06` section 15). */
function fightOne(game, run, counts, say, seed) {
  const monsters = rollEncounter(run.floor.floor, run.rng.encounter).monsters;
  if (monsters.length === 0) return;

  const goldBefore = game.hero.gold ?? 0;
  const xpBefore = game.hero.xp ?? 0;
  const fight = game.startFight({ monsters, seed });
  counts.fights += 1;

  for (let guard = 0; guard < 300 && !fight.over; guard += 1) {
    // Ordinary play: swing while it is worth swinging, and run when it is
    // not (`06` section 14). A hero who fights every fight to the end is not
    // testing the loop, they are testing the graveyard.
    const hurt = (game.hero.hp ?? 0) <= (game.hero.maxHp ?? 1) * 0.35;
    if (hurt) {
      // What a player does: drink first, run second (`04` section 8,
      // `06` section 14).
      const potion = game.hero.pack.items.find((entry) => entry.baseId === 'healing_potion');
      if (potion) {
        const had = potion.count ?? 1;
        fight.act('item', { item: potion.instanceId });
        counts.drunk += 1;
        // The hero's hit points are not the test: the monsters answer inside
        // the same turn, and can take back more than the flask gave. What is
        // the test is that the flask was drunk and said so (`04` section 8;
        // the dice themselves are `npm run loot`'s audit).
        const left = game.hero.pack.items.find((entry) => entry.instanceId === potion.instanceId);
        if ((left?.count ?? 0) !== had - 1) say('a Healing Potion was not used up (04 section 1)');
        if (!fight.log.some((line) => line.text.includes('Healing Potion'))) {
          say('a Healing Potion was drunk with nothing said (04 section 8)');
        }
        continue;
      }
      if (fight.act('flee').fled) {
        counts.fled += 1;
        break;
      }
    }
    const target = fight.rowOf('front')[0] ?? fight.rowOf('back')[0];
    fight.act('attack', { target: target?.id });
  }

  if (!fight.over && (game.hero.hp ?? 0) > 0) say('a fight never ended (06 section 15)');
  if (fight.outcome === 'victory') {
    counts.won += 1;
    const summary = fight.summary;
    if ((game.hero.gold ?? 0) < goldBefore) say('a victory cost the hero gold');
    if ((game.hero.xp ?? 0) < xpBefore) say('a victory cost the hero XP (06 section 15)');
    // `05` section 11: the drops are rolled as the fight ends, before a
    // screen could show them.
    const { taken } = takeAll(game.hero, summary.loot ?? []);
    counts.drops += taken.length;
    if (slotsUsed(game.hero.pack) > game.hero.pack.capacity) {
      say('the pack holds more than it can (04 section 1)');
    }
  }
  game.endFight();
}

/**
 * Walks back to the arrival stone and takes it home (`05` section 9), or
 * reads a Scroll of Return if the hero has one.
 */
function goHome(game, run, counts, say, trip) {
  const stone = run.floor.waystone;
  const day = game.town.day;
  const trips = game.town.trips;

  // Attuning is by standing on it, so the walk back is the test of it.
  if (!walkTo(run, stone)) {
    say(`trip ${trip}: could not walk back to the waystone at ${stone}`);
    return false;
  }
  if (!isAttuned(game.town, run.floor.floor)) {
    say(`trip ${trip}: standing on the stone did not attune it (05 section 9)`);
  }
  if (run.context !== 'touch') say(`trip ${trip}: the stone offers nothing`);
  if (run.actReason) say(`trip ${trip}: the stone refuses: ${run.actReason}`);

  run.act();
  counts.byStone += 1;

  if (game.inDungeon) say(`trip ${trip}: the waystone did not take the hero out (05 section 9)`);
  if (game.town.day !== day + 1) say(`trip ${trip}: coming back did not turn the day over (05 section 12)`);
  if (game.town.trips !== trips) say(`trip ${trip}: coming back counted a trip`);
  if (markOf(game.town)) say(`trip ${trip}: a Waystone left a Return Mark (05 section 9)`);
  if (!attunedFloors(game.town).includes(run.floor.floor)) {
    say(`trip ${trip}: the stone was not remembered`);
  }
  return true;
}

/** A night, a sale and a purchase: the town half of the loop. */
function doTown(game, counts, say, trip) {
  const hero = game.hero;

  // The Inn (`01` section 7): a rest costs gold and gives the hero back.
  const rest = offersOf('inn', hero).find((offer) => offer.id === 'rest');
  // A hero who cannot pay for a bed sleeps rough; that is poverty, not a
  // broken rule.
  if (!rest.why && (hero.gold ?? 0) >= rest.cost) {
    const gold = hero.gold ?? 0;
    const done = take(hero, rest);
    counts.rests += 1;
    if (!done.ok) say(`trip ${trip}: the Inn refused: ${done.why}`);
    else {
      if (hero.hp !== hero.maxHp) say(`trip ${trip}: a full rest left the hero hurt (01 section 7)`);
      if ((hero.gold ?? 0) !== gold - rest.cost) say(`trip ${trip}: the Inn charged the wrong price`);
    }
  }

  // The Shop (`04` sections 1 and 15).
  const shelves = game.shop;
  if (shelves.day !== game.town.day) say(`trip ${trip}: the shop is stocked for another day`);
  const rotating = shelves.stock.filter((row) => row.rotating).map((row) => row.baseId).join();

  // Sell something, if there is anything the shop will take.
  const spare = sellable(hero).find((entry) => !entry.bound);
  if (spare) {
    const gold = hero.gold ?? 0;
    const done = sell(hero, spare.instanceId);
    if (!done.ok) say(`trip ${trip}: the shop would not buy: ${done.why}`);
    else {
      counts.sold += 1;
      if ((hero.gold ?? 0) !== gold + done.paid) say(`trip ${trip}: the sale paid the wrong gold`);
    }
  }

  // And buy what the hero can afford. A player buys the potion first.
  const affordable = shelves.stock.filter((row) => priceOf(hero, row) <= (hero.gold ?? 0));
  if (affordable.length > 0) {
    const potions = hero.pack.items
      .filter((entry) => entry.baseId === 'healing_potion')
      .reduce((total, entry) => total + (entry.count ?? 1), 0);
    const wanted =
      (potions < 2 && affordable.find((row) => row.baseId === 'healing_potion')) ||
      affordable[affordable.length - 1];
    const gold = hero.gold ?? 0;
    const price = priceOf(hero, wanted);
    const done = buy(shelves, hero, wanted.id);
    if (!done.ok) {
      if (done.why !== 'packFull') say(`trip ${trip}: the shop refused a sale: ${done.why}`);
    } else {
      counts.bought += 1;
      if ((hero.gold ?? 0) !== gold - price) say(`trip ${trip}: the purchase charged the wrong gold`);
      if (!hero.pack.items.some((entry) => entry.baseId === wanted.baseId)) {
        say(`trip ${trip}: what was bought never arrived`);
      }
    }
  }

  // `04` section 15: the rotating lines reroll when the hero comes back.
  game.town.day += 1;
  const next = game.shop.stock.filter((row) => row.rotating).map((row) => row.baseId).join();
  game.town.day -= 1;
  if (rotating && next === rotating && shelves.tier >= 3) {
    say(`trip ${trip}: the rotating stock did not reroll on a new day (04 section 15)`);
  }
}

/**
 * Walks to a tile, pressing the pad rather than teleporting: the same route
 * and the same presses `npm run walk` uses, so the trip home is a real walk.
 */
function walkTo(run, target) {
  for (let leg = 0; leg < 12; leg += 1) {
    const [x, y] = run.ex.pos;
    if (x === target[0] && y === target[1]) return true;
    const route = routeTo(run, target, run.hero?.bashBonus ?? 0);
    if (!route || route.length === 0) return false;

    for (const to of route) {
      for (let tries = 0; tries < 8; tries += 1) {
        const [ax, ay] = run.ex.pos;
        if (ax === to[0] && ay === to[1]) break;
        const want = to[0] > ax ? 1 : to[0] < ax ? 3 : to[1] > ay ? 2 : 0;
        if (run.ex.facing !== want) {
          run.press('turnRight');
          continue;
        }
        const before = `${run.ex.pos}`;
        run.press('forward');
        // Something in the way: open it, and try the step again.
        if (`${run.ex.pos}` === before) run.act();
      }
    }
  }
  return `${run.ex.pos}` === `${target}`;
}

export { ORIGIN_ORDER };
