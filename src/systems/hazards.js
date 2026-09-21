/**
 * Dungeon hazards, curiosities and theme features (`03` section 8,
 * `05` section 6).
 *
 * A hazard is not a trap: it does not go off once and stop. It is a property
 * of a tile the hero keeps meeting — the floor turns them around, the water
 * drags at their armour, the pad moves them somewhere else, the ice will not
 * let them stop. So this module answers questions about tiles ("is this
 * dark", "does this block", "where does a slide end") and resolves the ones
 * that need a roll, and the exploration loop carries the answers out.
 *
 * Finding one is the traps' own Search, at `03` section 8's own TN of 12 + F.
 *
 * No DOM, and nothing here moves the hero: every outcome is returned.
 */
import {
  CURIOSITIES,
  feature as featureSpec,
  hazard as hazardSpec,
  hazardTn,
  isHidden,
  offeringCost,
  onFloor,
} from '../data/hazards.js';
import { detectionBonus, detectionMod, hurt, rollSave } from './traps.js';
import { DETECTION } from '../data/traps.js';
import { hasExplore } from './skill-tree.js';
import { applyCondition } from '../engine/conditions.js';
import { applySkillSheet } from '../engine/skill-hooks.js';
import { ATTRIBUTE_ORDER, modFor } from '../data/attributes.js';
import { chooseBase, rollOnTable } from './loot.js';
import { poolFor } from '../data/loot.js';
import { GEMS, gemFor, item } from '../data/items.js';

const key = (x, y) => `${x},${y}`;

/* -------------------------------------------------------------------------- */
/* What is on a tile                                                          */
/* -------------------------------------------------------------------------- */

/** The hazard on a tile, or null. */
export function hazardAt(floor, pos) {
  return floor?.hazards?.[key(...pos)] ?? null;
}

/** The theme feature on a tile, or null. */
export function featureAt(floor, pos) {
  return floor?.features?.[key(...pos)] ?? null;
}

/** True for a tile inside an Anti-Magic Field (`03` section 8). */
export function inAntiMagic(floor, pos) {
  return hazardAt(floor, pos)?.kind === 'anti_magic_field';
}

/** True for a tile the hero cannot walk through: scenery, or living webbing. */
export function blocks(floor, pos, ex) {
  const at = key(...pos);
  if (floor?.features?.[at]?.blocks) return true;
  const hazard = floor?.hazards?.[at];
  if (hazard?.kind !== 'web_curtain') return false;
  return !hazard.burned && !ex?.hazardsCleared?.has(at);
}

/** True inside a Glowcap Room, where a torch does not burn down (`05` §6). */
export function isLit(floor, pos) {
  const room = roomAt(floor, pos);
  return Boolean(room?.lit);
}

/** Which room a tile is in, if any. */
function roomAt(floor, [x, y]) {
  return floor?.rooms?.find((room) => {
    const [rx, ry, rw, rh] = room.rect;
    return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
  });
}

/* -------------------------------------------------------------------------- */
/* Finding one                                                                */
/* -------------------------------------------------------------------------- */

/** Why the hero cannot search this hazard, or null. */
export function whyNotSearch(entry, { dark = false, careful = false } = {}) {
  if (!entry) return 'nothingHere';
  if (!isHidden(entry.kind)) return 'plainToSee';
  if (entry.found) return 'found';
  if (dark) return 'tooDark';
  const done = entry.searches ?? {};
  return (careful ? done.careful : done.normal) ? 'searched' : null;
}

/**
 * The look the game takes for the hero as they come up to something, at the
 * same -4 a trap gets (`03` section 3). It is rolled whether or not there is
 * anything there, so the roll itself gives nothing away.
 */
export function notice(rng, hero, entry, floor, { dark = false } = {}) {
  if (!entry || !isHidden(entry.kind) || entry.found) return { found: false, passive: true };
  const roll = rng.d20();
  const penalty = hero?.explore?.noPassiveNoticePenalty ? 0 : DETECTION.passivePenalty;
  const total = roll + detectionMod(hero) + detectionBonus(hero) + penalty;
  const tn = hazardTn(floor);
  const found = roll === 20 || (roll !== 1 && total >= tn && !dark);
  if (found) entry.found = true;
  return { found, roll, total, tn, passive: true };
}

/**
 * A Search for a hazard: the traps' own roll against `03` section 8's TN of
 * 12 + F. A found hazard goes on the map (`05` section 10).
 */
export function search(rng, hero, entry, floor, { careful = false, dark = false } = {}) {
  const why = whyNotSearch(entry, { careful, dark });
  if (why) return { found: false, roll: 0, total: 0, tn: 0, why };

  entry.searches ??= { normal: false, careful: false };
  entry.searches[careful ? 'careful' : 'normal'] = true;

  const roll = rng.d20({ advantage: careful });
  const total = roll + detectionMod(hero) + detectionBonus(hero);
  const tn = hazardTn(floor);
  const found = roll === 20 || (roll !== 1 && total >= tn);
  if (found) entry.found = true;
  return { found, roll, total, tn };
}

/* -------------------------------------------------------------------------- */
/* Standing on one                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a hazard does to the hero who steps onto it (`03` section 8).
 *
 * Nothing is carried out here: a Spinner reports the facing it wants, a pad
 * reports where it is sending the hero, and the exploration loop moves them.
 *
 * @param {object} services `{ rng }`, and the hooks a fight would bring
 * @param {object} hero
 * @param {object} floor
 * @param {object} ex the exploration state, read only
 * @param {[number, number]} pos the tile just stepped onto
 * @returns {{ events: object[], facing?: number, teleportTo?: [number, number] }}
 */
export function onEnter(services, hero, floor, ex, pos) {
  const entry = hazardAt(floor, pos);
  const out = { events: [] };
  if (!entry) return out;
  const rng = services.rng;

  switch (entry.kind) {
    // "Silently turns the hero to a random facing." A Lodestone Compass keeps
    // them straight; a hero who found the spinner still turns, but knows it.
    case 'spinner': {
      // The Lodestone Compass keeps the hero pointing the way they were
      // (`03` section 8, Counter). It is gear, so the flag is on the sheet.
      if (hero.explore?.spinnerProof || hasExplore(hero, 'spinnerProof')) {
        out.events.push({ type: 'spinnerHeld', at: pos });
        break;
      }
      const facing = rng.int(4);
      if (facing === ex.facing) break;
      out.facing = facing;
      out.events.push({ type: 'spun', at: pos, facing, silent: !entry.found });
      break;
    }

    // "Always sends the hero to the same fixed spot."
    case 'teleporter_pad': {
      if (!entry.destination) break;
      out.teleportTo = /** @type {[number, number]} */ ([...entry.destination]);
      out.events.push({ type: 'teleported', at: pos, to: out.teleportTo });
      break;
    }

    // Each step in heavy armour is a Body save, and every scroll carried may
    // be ruined.
    case 'deep_water':
      out.events.push(...wade(services, hero, floor.floor));
      break;

    default:
      break;
  }
  return out;
}

/**
 * One step through Deep Water (`03` section 8): a Body save at DC 10 + F for
 * a hero in heavy armour, and a 1-in-6 per scroll carried.
 */
export function wade(services, hero, floorNumber) {
  const rules = hazardSpec('deep_water').perStep;
  /** @type {object[]} */
  const events = [];
  const rng = services.rng;

  if (hero.gear?.heavyArmor) {
    const dc = onFloor(rules.whenHeavyArmor.dc, floorNumber);
    const save = rollSave(rng, hero, rules.whenHeavyArmor.save, dc, {});
    if (!save.passed) {
      const damage = hurt(services, hero, rules.whenHeavyArmor.damage, null, { kind: 'deep_water' });
      events.push({ type: 'drowning', damage, save, dc });
    } else {
      events.push({ type: 'waded', save, dc });
    }
  }

  // "Each scroll carried has a 1-in-6 chance to be ruined."
  for (const entry of [...(hero.pack?.items ?? [])]) {
    if (item(entry.baseId).category !== 'scroll') continue;
    if (!rng.chance(1 / rules.scrollRuinedOneIn)) continue;
    entry.count = (entry.count ?? 1) - 1;
    events.push({ type: 'scrollRuined', baseId: entry.baseId });
  }
  if (hero.pack?.items) hero.pack.items = hero.pack.items.filter((one) => (one.count ?? 1) > 0);
  return events;
}

/* -------------------------------------------------------------------------- */
/* Ice                                                                        */
/* -------------------------------------------------------------------------- */

/** True for a tile of ice (`05` section 6, Ice Slide). */
export function isIce(floor, pos) {
  return hazardAt(floor, pos)?.kind === 'ice_slide';
}

/**
 * Where a slide ends (`05` section 6, Ice Slide).
 *
 * "Stepping onto ice slides you forward until you hit a wall or a non-ice
 * tile; you can't turn while sliding." Every tile slid still counts on the
 * step clock, so the path is returned rather than just its end.
 *
 * @param {object} floor
 * @param {[number, number]} from the ice tile just stepped onto
 * @param {[number, number]} heading the direction of travel, as [dx, dy]
 * @param {(pos: [number, number]) => boolean} passable
 * @returns {{ path: [number, number][], at: [number, number] }}
 */
export function slideFrom(floor, from, heading, passable) {
  /** @type {[number, number][]} */
  const path = [];
  let at = /** @type {[number, number]} */ ([...from]);
  // A floor is at most 49 tiles across, so nothing can slide further.
  for (let step = 0; step < floor.width + floor.height; step += 1) {
    if (!isIce(floor, at)) break;
    const next = /** @type {[number, number]} */ ([at[0] + heading[0], at[1] + heading[1]]);
    if (!passable(next)) break;
    at = next;
    path.push(at);
  }
  return { path, at };
}

/* -------------------------------------------------------------------------- */
/* Webbing                                                                    */
/* -------------------------------------------------------------------------- */

/** The TN to bash a web curtain down: 10 + F (`03` section 8). */
export function webBashTn(floorNumber) {
  return onFloor(hazardSpec('web_curtain').bashTn, floorNumber);
}

/**
 * Bashing a web curtain (`03` section 8). Burning one needs no roll and is
 * the exploration loop's own BURN key; this is the other way through.
 */
export function bashWeb(rng, hero, floorNumber) {
  const tn = webBashTn(floorNumber);
  const bonus = modFor(hero?.attributes?.might) + (hero?.explore?.bash ?? 0);
  const roll = rng.d20();
  const total = roll + bonus;
  return { roll, bonus, total, tn, cleared: roll === 20 || (roll !== 1 && total >= tn) };
}

/* -------------------------------------------------------------------------- */
/* Theme features                                                             */
/* -------------------------------------------------------------------------- */

/** Why this feature cannot be used, or null. */
export function whyNotUse(entry, hero) {
  if (!entry) return 'nothingHere';
  const spec = featureSpec(entry.kind);
  if (spec.search) return entry.searched ? 'searched' : null;
  if (spec.open) return entry.opened ? 'opened' : null;
  if (spec.gemOneIn) {
    if (entry.taken) return 'taken';
    return hero?.has?.pole ? null : 'noPole';
  }
  return 'nothingToDo';
}

/**
 * Searching a Wine Rack or a Bookshelf (`05` section 6): one look, one
 * chance — 1 in 6 for a ration or a Healing Potion, 1 in 8 for an Uncommon
 * scroll.
 */
export function searchFeature(rng, hero, entry, floorNumber) {
  const why = whyNotUse(entry, hero);
  if (why) return { ok: false, why, drops: [] };
  const spec = featureSpec(entry.kind).search;
  entry.searched = true;

  if (!rng.chance(1 / spec.oneIn)) return { ok: true, drops: [], found: false };
  const baseId = spec.oneOf
    ? rng.pick(spec.oneOf)
    : chooseBase(rng, poolFor(spec.pool), hero);
  return {
    ok: true,
    found: true,
    drops: [{ baseId, count: 1, identified: item(baseId).category !== 'scroll' }],
  };
}

/**
 * Opening a Sarcophagus (`05` section 6): d6, and two faces in six wake
 * something up.
 */
export function openFeature(rng, hero, entry, floorNumber) {
  const why = whyNotUse(entry, hero);
  if (why) return { ok: false, why };
  const spec = featureSpec(entry.kind).open;
  entry.opened = true;

  const roll = rng.roll(spec.dice);
  const band = spec.bands.find((one) => roll <= one.upTo) ?? spec.bands.at(-1);
  if (band.fight) return { ok: true, roll, fight: [...band.fight] };
  if (band.loot) {
    return { ok: true, roll, drops: rollOnTable(rng, band.loot, { floor: floorNumber, hero }) };
  }
  return { ok: true, roll, empty: true };
}

/**
 * Reaching into an Ash Pit with a ten-foot pole (`05` section 6): some hold a
 * gemstone, and the pole is what gets it out.
 */
export function reachIn(rng, hero, entry, floorNumber) {
  const why = whyNotUse(entry, hero);
  if (why) return { ok: false, why, drops: [] };
  entry.taken = true;
  if (!entry.gem) return { ok: true, drops: [], found: false };
  const baseId = gemFor(rng.die(100) + GEMS.perFloor * floorNumber, { floor: floorNumber });
  return { ok: true, found: true, drops: [{ baseId, count: 1, identified: true }] };
}

/* -------------------------------------------------------------------------- */
/* Curiosities                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Drinking from a Mysterious Fountain (`03` section 8): once each, d6, and
 * one face in six is worth a point of an attribute for the rest of the game.
 *
 * @param {object} services `{ rng }`
 * @param {object} hero
 * @param {object} entry the fountain as the floor holds it
 * @param {object} [game] the trip's own state, for the once-per-game gift
 */
export function drink(services, hero, entry, game = null) {
  if (!entry || entry.used) return { ok: false, why: 'used' };
  const rng = services.rng;
  entry.used = true;

  const roll = rng.roll(CURIOSITIES.fountain.dice);
  const result = CURIOSITIES.fountain.results.find((one) => one.roll === roll);
  const out = { ok: true, roll, events: [] };

  if (result.condition) {
    const applied = applyCondition(hero, result.condition, { source: 'fountain' });
    if (applied.applied) out.events.push({ type: 'condition', id: result.condition });
  }
  if (result.teleport) out.teleport = 'random';
  if (result.heal) {
    const healed = Math.min(hero.maxHp - hero.hp, rng.roll(result.heal));
    hero.hp += healed;
    out.events.push({ type: 'healed', hp: healed });
  }
  if (result.restoreFp) {
    const gained = hero.maxFp - hero.fp;
    hero.fp = hero.maxFp;
    out.events.push({ type: 'focus', fp: gained });
  }
  if (result.attribute) {
    // "Each fountain works only once per game", so the gift is counted on the
    // game rather than on the floor, which is restocked (`05` section 8).
    const given = game?.fountainGift;
    if (given) {
      out.events.push({ type: 'nothing' });
    } else {
      const which = rng.pick(ATTRIBUTE_ORDER);
      hero.attributes[which] += result.value;
      if (game) game.fountainGift = true;
      applySkillSheet(hero);
      out.events.push({ type: 'attribute', attribute: which, value: result.value });
    }
  }
  if (result.nothing) out.events.push({ type: 'nothing' });
  return out;
}

/**
 * An Offering Shrine, and the Altar that works as one (`03` section 8,
 * `05` section 6): 20 x F gold for +2 to all saves until the next rest.
 */
export function offer(hero, entry, floorNumber) {
  if (!entry || entry.used) return { ok: false, why: 'used' };
  const cost = offeringCost(floorNumber);
  if ((hero.gold ?? 0) < cost) return { ok: false, why: 'notEnoughGold', cost };

  entry.used = true;
  hero.gold -= cost;
  const blessing = CURIOSITIES.shrine.blessing;
  hero.buffs = [
    ...(hero.buffs ?? []).filter((buff) => buff.id !== 'shrine'),
    { id: 'shrine', name: CURIOSITIES.shrine.name, effects: blessing.effects, until: blessing.until, steps: null },
  ];
  applySkillSheet(hero);
  return { ok: true, cost, blessing };
}
