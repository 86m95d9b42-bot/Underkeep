/**
 * A whole game, one action at a time (Phase 8's "done when": a full
 * playthrough survives repeated force-closes with no lost progress).
 *
 * `playOne` does exactly one thing a player's tap would do, and works out what
 * from the game's state alone — never from anything it remembered itself — so
 * the game it is handed can be a different object every call: the one that
 * was just restored from the save after a force-close. It does what the
 * screens do, through the same calls:
 *
 *   - in a fight, the balance simulator's careful pilot takes the turn;
 *   - a fight that is over is paid out the way Combat → Loot pays it: the
 *     drops taken, a boss marked beaten, the fight put away;
 *   - in the dungeon, one press toward the arena door, or past a beaten boss
 *     to the down stairs, fetching a key when a door wants one; a blocked step
 *     is answered with the context key; and whatever the step led to — a
 *     fight, another floor, the town — is `session.follow`'s, as it is the
 *     Exploration screen's;
 *   - out of a fight, a healing potion below half HP, else a camp while
 *     the rations last; with neither and below 70%, the walk home by the
 *     floor's Waystone;
 *   - in town, potions, torches and rations from the Shop, a night at the
 *     Inn when hurt, then the
 *     Dungeon Gate to the first floor whose boss still stands.
 */
import { flyOneTurn } from './simulator.js';
import { routeTo, nearestKey } from './walker.js';
import { DELTA, turnBy } from '../../src/dungeon/movement.js';
import { takeAll } from '../../src/systems/loot.js';
import { offersOf, take } from '../../src/systems/services.js';
import { FLOORS } from '../../src/systems/travel.js';
import { buy, priceOf } from '../../src/systems/shop.js';
import { actionForItem, consumeItem, whyNotUse } from '../../src/systems/use-item.js';
import { resolveItemAction } from '../../src/engine/item-actions.js';
import { pin } from '../../src/systems/inventory.js';

/** Out of a fight, a potion below this share of hit points. */
const DRINK_BELOW = 0.5;

/** With no potion left, below this share the hero walks home by the Waystone. */
const GO_HOME_BELOW = 0.7;

/** Potions a careful player carries down, bought one a tap. */
const POTIONS_CARRIED = 6;

/** Torches, for fallen trolls and Hydra stumps (`06` section 9). */
const TORCHES_CARRIED = 15;

/** Rations, for camping (`01` section 9). */
const RATIONS_CARRIED = 5;

/** In a fight, the test hero drinks earlier than the balance pilot's 30%. */
const FIGHT_DRINK_BELOW = 0.5;

/** A fight this long is not going to end: something is wrong with it. */
const ROUNDS_CAP = 500;

/** The first floor whose boss still stands, or null when every one has fallen. */
export function nextBossFloor(game) {
  return FLOORS.find((floor) => !game.town.bosses.includes(floor)) ?? null;
}

/**
 * One action. Returns what it did, for the tally, or 'done' when the last boss
 * has fallen, 'dead' when an Ironman has fallen, or 'stuck' when nothing can
 * be done.
 * @param {ReturnType<import('../../src/systems/session.js').createSession>} game
 */
export function playOne(game) {
  const { hero } = game;
  if (game.town.finished && !game.fight) return 'done';

  const fight = game.fight;
  if (fight && !fight.over) {
    if ((fight.round ?? 0) > ROUNDS_CAP) return 'stuck';
    return fightTurn(fight);
  }
  if (fight) return settle(game, fight);

  if (!hero.alive || (hero.hp ?? 0) <= 0) {
    if (hero.mode === 'ironman' && !game.inDungeon) return 'dead';
    game.heroFell({ cause: game.run?.causeOfDeath ?? null });
    return hero.mode === 'ironman' ? 'dead' : 'fell';
  }

  if (!game.inDungeon) return townTurn(game);
  if (drinkIfHurt(game)) return 'drink';
  // Hurt with nothing to drink: camp, as the Pause Menu's CAMP does.
  if (share(hero) < DRINK_BELOW && !potionOf(hero) && !game.run.campReason) {
    game.camp();
    return 'camp';
  }
  return step(game);
}

/** The hero's share of hit points. */
const share = (hero) => (hero.hp ?? 0) / Math.max(1, hero.maxHp ?? 1);

/** A healing potion from the pack, as the Item Detail sheet's USE drinks it. */
function drinkIfHurt(game) {
  const { hero, run } = game;
  if (share(hero) >= DRINK_BELOW) return false;
  const potion = potionOf(hero);
  if (!potion) return false;
  const built = actionForItem(hero, potion.instanceId, { inCombat: false });
  if (!built.action) return false;
  resolveItemAction({ rng: run.rng.combat, hooks: null, units: [], floor: run.floor.floor }, hero, built.action);
  consumeItem(hero, potion.instanceId);
  return true;
}

function potionOf(hero) {
  return hero.pack.items.find(
    (entry) => /healing_potion/.test(entry.baseId) && !whyNotUse(hero, entry, { inCombat: false }),
  );
}

/**
 * One turn of a fight: the careful pilot, with two habits of its own. It
 * drinks at half HP, and it runs from a fallen troll it has nothing to burn
 * with, since that fight cannot otherwise end (`06` section 9).
 */
function fightTurn(fight) {
  const { hero } = fight;
  if (share(hero) < FIGHT_DRINK_BELOW) {
    const potion = fight.items.find((entry) => entry.quick && !entry.why && /healing_potion/.test(entry.baseId));
    if (potion && fight.act('item', { item: potion.id }).acted) return 'turn';
  }
  const unburnable = fight.combat.units.some((unit) => unit.fallen && !unit.burned && !unit.untargetable && !unit.fallen.untargetable);
  const torch = fight.items.some((entry) => entry.baseId === 'torch' && !entry.why);
  if (unburnable && !torch && fight.legality('flee').legal && fight.act('flee').acted) return 'flee';
  flyOneTurn(fight);
  return 'turn';
}

/** Combat → Loot → Exploration, as the screens do it. */
function settle(game, fight) {
  if (fight.outcome === 'victory') {
    takeAll(game.hero, fight.summary?.loot ?? []);
    const boss = fight.combat.boss ? fight.combat.floor : null;
    if (boss) game.bossBeaten(boss);
    game.endFight();
    return boss ? 'boss' : 'won';
  }
  if (fight.leftDungeon) {
    game.leaveDungeon({ leaveMark: fight.leftDungeon.leaveMark });
    return 'returned';
  }
  if (fight.outcome === 'fled') {
    game.endFight();
    return 'fled';
  }
  game.heroFell({ cause: fight.causeOfDeath });
  return game.hero.mode === 'ironman' ? 'dead' : 'fell';
}

/** In town: potions, a rest when hurt, then down to the next boss. */
function townTurn(game) {
  const { hero } = game;
  const carried = hero.pack.items
    .filter((entry) => /healing_potion/.test(entry.baseId))
    .reduce((total, entry) => total + (entry.count ?? 1), 0);
  if (carried < POTIONS_CARRIED) {
    const shelves = game.shop;
    const potion = ['greater_healing_potion', 'healing_potion']
      .map((baseId) => shelves.stock.find((row) => row.baseId === baseId))
      .find((row) => row && priceOf(hero, row) <= (hero.gold ?? 0));
    const bought = potion && buy(shelves, hero, potion.id);
    if (bought?.ok) {
      // On a quick slot, where a fight can reach it (`06` section 17).
      if (bought.entry && !hero.pack.quick.includes(bought.entry.instanceId)) pin(hero.pack, bought.entry.instanceId);
      return 'buy';
    }
  }
  for (const [baseId, wanted] of [['torch', TORCHES_CARRIED], ['ration', RATIONS_CARRIED]]) {
    const held = hero.pack.items.filter((entry) => entry.baseId === baseId).reduce((total, entry) => total + (entry.count ?? 1), 0);
    if (held >= wanted) continue;
    const row = game.shop.stock.find((one) => one.baseId === baseId && priceOf(hero, one) <= (hero.gold ?? 0));
    if (row && buy(game.shop, hero, row.id).ok) return 'buy';
  }
  if ((hero.hp ?? 0) < (hero.maxHp ?? 1)) {
    const rest = offersOf('inn', hero).find((offer) => offer.id === 'rest');
    if (rest && !rest.why && (hero.gold ?? 0) >= rest.cost) {
      take(hero, rest);
      return 'rest';
    }
  }
  const floor = nextBossFloor(game);
  if (floor === null) return 'done';
  game.descend({ floor });
  return 'descend';
}

/**
 * Where the hero is going on this floor: home by the Waystone when badly hurt
 * with nothing to drink, otherwise the arena door, or past a beaten boss the
 * down stairs.
 */
function targetOf(game) {
  const { floor } = game.run;
  if (share(game.hero) < GO_HOME_BELOW && !potionOf(game.hero) && floor.waystone) return floor.waystone;
  return game.town.bosses.includes(floor.floor) ? floor.stairs.down : floor.arena.door;
}

/** One press toward the target, and whatever it leads to. */
function step(game) {
  const run = game.run;
  const { ex } = run;
  const target = targetOf(game);
  // What the run itself bashes with: MIG mod and Brute Force (`03` section 6).
  const bash = run.hero.bashBonus ?? (run.hero.mods?.might ?? 0) + (run.hero.explore?.bash ?? 0);
  // On the Waystone and heading home: touch it.
  if (target === run.floor.waystone && ex.pos[0] === target[0] && ex.pos[1] === target[1] && run.context === 'touch') {
    game.follow(run.act());
    return 'home';
  }
  let route = routeTo(run, target, bash);
  if (!route) {
    const key = nearestKey(run, bash);
    route = key && routeTo(run, key, bash);
  }
  // Standing on the target already: the arena door with the boss beaten, or
  // stairs that did not take the hero anywhere. Step off and back on.
  if (route && route.length === 0) {
    const off = DELTA.findIndex(([dx, dy]) => run.floor.map[ex.pos[1] + dy]?.[ex.pos[0] + dx] !== 1);
    route = off >= 0 ? [[ex.pos[0] + DELTA[off][0], ex.pos[1] + DELTA[off][1]]] : null;
  }
  if (!route) return 'stuck';

  const [to] = route;
  const heading = DELTA.findIndex(([dx, dy]) => ex.pos[0] + dx === to[0] && ex.pos[1] + dy === to[1]);
  let result;
  if (heading >= 0 && ex.facing !== heading) {
    result = run.press(turnBy(ex.facing, 1) === heading ? 'turnRight' : 'turnLeft');
  } else {
    result = run.press('forward');
    // Blocked: the context key, as a player would — open, bash, burn.
    if (!result.outcome.moved && result.outcome.blocked) {
      const acted = run.act();
      game.follow(acted);
      return 'act';
    }
  }
  const { next } = game.follow(result);
  return next ? `step:${next}` : 'step';
}
