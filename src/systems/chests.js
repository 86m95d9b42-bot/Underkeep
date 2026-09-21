/**
 * Treasure chests, and the sequence `03` section 7 puts the hero through.
 *
 * A chest asks four questions in order: is it what it looks like, is it
 * trapped, is it locked, and what is inside. The steps are the document's own
 * — Inspect, Handle the trap, Unlock, Open, Loot — and each is one call here,
 * over rules that already exist: the searching and disarming are `traps.js`,
 * the picking and bashing are `locks.js`, and the contents are `04` section
 * 14's own table. What this module adds is the part that belongs to chests:
 * the Mimic, and the fact that an armed trap can go off at three different
 * moments.
 *
 * Nothing here draws, and nothing acts on the world: a Mimic is reported, not
 * fought, and every roll comes back so the caller can save it before it is
 * shown (`05` section 11).
 */
import { lockData, tryOpen, waysToOpen } from './locks.js';
import {
  detectionBonus,
  detectionMod,
  disarm,
  search,
  springWithPole,
  trigger,
} from './traps.js';
import { rollLoot, rollOnTable } from './loot.js';
import { DETECTION } from '../data/traps.js';
import { hasExplore } from './skill-tree.js';

export const CHEST_RULES = lockData.chests;

/** What a look costs, trap or no trap (`03` section 3). */
function searchSteps(careful) {
  return careful ? DETECTION.carefulSteps : DETECTION.searchSteps;
}

/**
 * How likely a chest on this floor is trapped, locked, or not a chest at all
 * (`03` section 7, "Generating a Chest").
 * @param {'trapped' | 'locked' | 'mimic'} what
 * @param {number} floor
 */
export function chanceOf(what, floor) {
  if (what === 'mimic') {
    return CHEST_RULES.mimic.bands.find((band) => floor <= band.upToFloor)?.chance ?? 0;
  }
  const rule = CHEST_RULES[what];
  return Math.min(rule.max, rule.base + rule.perFloor * floor);
}

/** True while the chest is still shut behind its lock. */
export function isLocked(chest) {
  return chest.lock !== 'none' && !chest.unlocked;
}

/** True while the chest has a trap that could still go off. */
export function isArmed(chest) {
  return Boolean(chest.trap?.kind) && !chest.trap.disarmed && !chest.trap.sprung;
}

/**
 * What the chest panel knows (`03` section 7): the lock is always visible,
 * the trap is *Unknown* until it has been searched for.
 * @returns {{ lock: string, trap: 'unknown' | 'none' | 'armed' | 'disarmed' | 'sprung' }}
 */
export function chestState(chest) {
  const searched = Boolean(chest.searches?.normal || chest.searches?.careful);
  let trap = 'unknown';
  if (chest.trap?.sprung) trap = 'sprung';
  else if (chest.trap?.disarmed) trap = 'disarmed';
  else if (chest.trap?.found) trap = 'armed';
  else if (searched) trap = 'none'; // as far as the hero knows
  return { lock: chest.lock, trap, locked: isLocked(chest), opened: Boolean(chest.opened) };
}

/** The chest seen as a door, so the lock rules can be used unchanged. */
export function asDoor(chest) {
  return {
    kind: chest.lock === 'sealed' ? 'sealed' : 'locked',
    tier: chest.tier,
    jammed: chest.jammed,
  };
}

/** The ways this chest could be opened, and why each one is or is not usable. */
export function waysIn(chest, options) {
  return waysToOpen(asDoor(chest), options);
}

/* -------------------------------------------------------------------------- */
/* 1. Inspect                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Step 1, **Inspect**. The only step that can find the trap or show what the
 * chest really is: a Mimic hides behind TN 18, and Lore knows one on sight
 * (`03` section 7).
 *
 * @param {import('../engine/rng.js').Stream} rng the combat stream
 * @param {object} hero
 * @param {object} chest
 * @param {number} floor
 * @param {{ careful?: boolean, dark?: boolean }} [options]
 * @returns {{ mimic: boolean, trap: object | null, steps: number, why?: string }}
 */
export function inspect(rng, hero, chest, floor, { careful = false, dark = false } = {}) {
  const done = (chest.searches ??= { normal: false, careful: false });
  if (careful ? done.careful : done.normal) {
    return { mimic: false, trap: null, steps: 0, why: 'searched' };
  }
  if (dark) return { mimic: false, trap: null, steps: 0, why: 'tooDark' };
  done[careful ? 'careful' : 'normal'] = true;

  // The Mimic first, at its own TN. Lore names it whatever the roll.
  let mimic = false;
  if (chest.mimic && !chest.mimicKnown) {
    const roll = rng.d20({ advantage: careful });
    const total = roll + detectionMod(hero) + detectionBonus(hero);
    mimic =
      (CHEST_RULES.mimic.loreAutomatic && hasExplore(hero, 'identify')) ||
      roll === 20 ||
      (roll !== 1 && total >= CHEST_RULES.mimic.detectTn);
    if (mimic) chest.mimicKnown = true;
  }

  // Then the trap, by the traps' own rules (`03` section 3). An untrapped
  // chest still costs the search and still answers "you find nothing": a
  // hero cannot tell an empty look from a missed roll.
  const looked = chest.trap?.kind
    ? search(rng, hero, chest.trap, floor, { careful, dark })
    : { found: false, roll: 0, total: 0, tn: 0, steps: searchSteps(careful) };

  return {
    mimic,
    trap: chest.trap?.kind && looked.found ? looked : null,
    roll: looked.roll,
    total: looked.total,
    tn: looked.tn,
    steps: looked.steps,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Handle the trap                                                         */
/* -------------------------------------------------------------------------- */

/** Step 2: disarming a found trap, which is the traps' own roll. */
export function disarmTrap(rng, hero, chest, floor) {
  if (!chest.trap?.kind) return { ok: false, why: 'noTrap' };
  return disarm(rng, hero, chest.trap, floor);
}

/** Step 2, the safe way: springing it with a ten-foot pole. */
export function poleTrap(rng, hero, chest) {
  if (!chest.trap?.kind) return { ok: false, why: 'noTrap' };
  return springWithPole(rng, hero, chest.trap);
}

/* -------------------------------------------------------------------------- */
/* 3. Unlock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Step 3, **Unlock**: pick, bash, key, Knock or Dispel Ward, by `03` section
 * 6's rolls. What belongs to chests is the risk: an armed trap can still go
 * off here — a pick that fails by 5 or more sets it off, and bashing sets off
 * any armed trap whatever the roll (`03` section 7 step 3).
 *
 * @param {object} services `{ rng }` and the hooks a fight would bring
 * @param {object} hero
 * @param {object} chest
 * @param {number} floor
 * @param {{ method?: string, keysHeld?: Set<string>, has?: object, bashBonus?: number }} [options]
 */
export function unlock(services, hero, chest, floor, options = {}) {
  if (!isLocked(chest)) return { ok: false, why: 'unlocked' };
  const door = asDoor(chest);
  const outcome = tryOpen({
    door,
    floor,
    rng: services.rng,
    hero,
    keysHeld: options.keysHeld,
    has: options.has ?? hero.has ?? {},
    bashBonus: options.bashBonus ?? 0,
    method: options.method,
  });
  if (!outcome) return { ok: false, why: 'noWay' };

  if (door.jammed) chest.jammed = true;
  if (outcome.opened) chest.unlocked = true;

  // "Bashing sets off any armed trap"; a pick that fails by 5+ sets off the
  // needle. Either way the trap is the chest's, not the lock's.
  const bashed = outcome.method === 'bash';
  const setsOff = isArmed(chest) && (bashed || Boolean(outcome.springsTrap));
  const sprung = setsOff ? fireTrap(services, hero, chest, floor) : null;

  return { ok: true, ...outcome, sprung };
}

/** The trap going off, with the disadvantage an unfound trap brings. */
function fireTrap(services, hero, chest, floor, { advantage = false } = {}) {
  return trigger(services, hero, chest.trap, floor, {
    detected: Boolean(chest.trap.found),
    advantage,
  });
}

/* -------------------------------------------------------------------------- */
/* 4 and 5. Open, and loot                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a hard chest is worth on the loot table (`03` section 7, "Chest
 * Contents"): a Masterwork trap or lock adds +5 each, an Arcane trap or a
 * Sealed lock +10 each. The numbers live on the tiers, as `chestLootBonus`.
 */
export function lootBonusOf(chest) {
  const bonusFor = (tier) => lockData.tiers[tier]?.chestLootBonus ?? 0;
  // A Goblin Camp's chest carries its own +10 (`05` section 6).
  return bonusFor(chest.tier) + bonusFor(chest.trap?.tier) + (chest.lootBonus ?? 0);
}

/**
 * Why the chest cannot be opened yet, or null.
 */
export function whyNotOpen(chest) {
  if (chest.opened) return 'alreadyOpen';
  if (isLocked(chest)) return 'locked';
  return null;
}

/**
 * Steps 4 and 5, **Open** and **Loot** (`03` section 7).
 *
 * Any trap still armed goes off first, and if it was never found the hero
 * saves with disadvantage. A Mimic stops the sequence here: it is a fight,
 * not a container, and it gets a free surprise round if nobody looked at it.
 * Otherwise: **F x 3d10** gold, and one loot roll with the chest's own
 * difficulty added to it.
 *
 * @param {object} services `{ rng }` and the hooks a fight would bring
 * @param {object} hero
 * @param {object} chest
 * @param {number} floor
 */
export function open(services, hero, chest, floor) {
  const why = whyNotOpen(chest);
  if (why) return { opened: false, why, gold: 0, drops: [] };

  const rng = services.rng;
  const out = { opened: false, mimic: false, gold: 0, drops: [], sprung: null };

  if (isArmed(chest)) out.sprung = fireTrap(services, hero, chest, floor);

  // "If the hero skipped the Inspect step and the chest is a Mimic, the Mimic
  // gets a free surprise round." A Mimic is never opened, and never looted.
  if (chest.mimic) {
    chest.sprungMimic = true;
    return { ...out, mimic: true, surprise: !chest.mimicKnown };
  }

  chest.opened = true;
  out.opened = true;
  out.gold = floor * rng.roll(CHEST_RULES.gold.dice);

  // A boss chest always holds one Rare item (`03` section 7).
  if (chest.boss) {
    out.drops = rollOnTable(rng, 'rare', { floor, hero });
  } else {
    const rolled = rollLoot(rng, { floor, hero, bonus: lootBonusOf(chest) });
    out.drops = rolled.drops;
    out.rolls = rolled.rolls;
  }
  return out;
}
