/**
 * Finding a trap, dealing with it, and what happens when it goes off
 * (`03` sections 3, 4 and 5).
 *
 * Three ways to find one — the passive notice the game rolls for the hero,
 * a Search, and a Careful Search — and four things to do about it: disarm
 * it, spring it with a pole, walk around it, or take it in the face.
 *
 * Every roll is returned rather than acted on, the way `05` section 11 wants
 * an outcome committed before it is shown, and the world-level effects a trap
 * can have — an encounter, a teleport, a chute to the floor below — come back
 * as events for the exploration loop to carry out. Nothing here moves the
 * hero or starts a fight.
 *
 * No DOM.
 */
import {
  DETECTION,
  DISARM,
  POLE,
  TRIGGER,
  damageNotation,
  isArcane,
  poleAdvantage,
  poleable,
  salvageFor,
  trap,
  xpFor,
} from '../data/traps.js';
import { lockData, tn } from './locks.js';
import { modFor } from '../data/attributes.js';
import { applyCondition } from '../engine/conditions.js';
import { resolveDamage } from '../engine/damage.js';
import { createHooks } from '../engine/hooks.js';
import { hasExplore } from './skill-tree.js';

/** What a save that "halves" a trap's damage multiplies it by. */
const HALF_ON_SAVE = 0.5;

/** A trap's tier row from the shared table (`03` section 2). */
function tierOf(tier) {
  return lockData.tiers[tier] ?? lockData.tiers.standard;
}

/** The TN to spot this trap on this floor. */
export function detectTn(tier, floor) {
  return tn(tierOf(tier).detectTn, floor);
}

/** The TN to disarm it. */
export function disarmTn(tier, floor) {
  return tn(tierOf(tier).pickTn, floor);
}

/** The DC of the save it forces. */
export function saveDc(tier, floor) {
  return tn(tierOf(tier).saveDc, floor);
}

/** What the hero's own sheet adds to a detection roll (`03` section 3). */
export function detectionBonus(hero, { magical = false } = {}) {
  const explore = hero?.explore ?? {};
  let bonus = (explore.search ?? 0) + (explore.trap ?? 0);
  if (magical) bonus += explore.magicTrap ?? 0;
  return bonus;
}

/** The attribute a detection roll uses: WIT, or the better of WIT and INT. */
export function detectionMod(hero, { magical = false } = {}) {
  const scores = hero?.attributes ?? {};
  const wits = modFor(scores[DETECTION.attribute]);
  if (!magical) return wits;
  return Math.max(...DETECTION.arcaneAttributes.map((id) => modFor(scores[id])));
}

/**
 * The roll the game makes for the hero as they are about to step on a hidden
 * trap, or open something without searching it: **d20 + WIT mod + bonuses − 4**
 * (`03` section 3, Passive Notice).
 *
 * Trapfinding rank 2 removes the penalty, and an Arcane trap glows enough to
 * be noticed without it in the dark.
 */
export function passiveNotice(rng, hero, entry, floor, { dark = false } = {}) {
  const magical = isArcane(entry.kind, entry.tier);
  const noPenalty =
    hero?.explore?.noPassiveNoticePenalty || (dark && magical && DETECTION.darkness.arcaneNoticedWithoutPenalty);
  const penalty = noPenalty ? 0 : DETECTION.passivePenalty;
  const roll = rng.d20();
  const total = roll + detectionMod(hero, { magical }) + detectionBonus(hero, { magical }) + penalty;
  const target = detectTn(entry.tier, floor);
  const found = roll === 20 || (roll !== 1 && total >= target);
  return { roll, total, tn: target, found, passive: true };
}

/** Why the hero cannot search here, or null (`03` section 3, Darkness). */
export function whyNotSearch(entry, { dark = false, careful = false } = {}) {
  if (!entry) return 'nothingHere';
  if (dark) return 'tooDark';
  const done = entry.searches ?? {};
  if (careful ? done.careful : done.normal) return 'searched';
  return null;
}

/**
 * A Search, or a Careful Search (`03` section 3).
 *
 * A failure says "you find nothing" whether or not there was anything to
 * find, so this answers the same shape either way; a success by 5 or more —
 * or any success with Lore, on a magical trap — names the trap exactly.
 *
 * @returns {{ found: boolean, exact: boolean, roll: number, total: number,
 *   tn: number, steps: number, why?: string }}
 */
export function search(rng, hero, entry, floor, { careful = false, dark = false } = {}) {
  const steps = careful ? DETECTION.carefulSteps : DETECTION.searchSteps;
  const why = whyNotSearch(entry, { dark, careful });
  if (why) return { found: false, exact: false, roll: 0, total: 0, tn: 0, steps: 0, why };

  entry.searches ??= { normal: false, careful: false };
  entry.searches[careful ? 'careful' : 'normal'] = true;

  const magical = isArcane(entry.kind, entry.tier);
  const roll = rng.d20({ advantage: careful });
  const total = roll + detectionMod(hero, { magical }) + detectionBonus(hero, { magical });
  const target = detectTn(entry.tier, floor);
  const found = roll === 20 || (roll !== 1 && total >= target);

  // `03` section 3: by 5 or more names it, and Lore names any magical trap
  // it finds at all.
  const lore = magical && hasExplore(hero, 'identify');
  const exact = found && (lore || total >= target + DETECTION.exactBy);
  if (found) {
    entry.found = true;
    if (exact) entry.typeKnown = true;
  }
  return { roll, total, tn: target, found, exact, steps };
}

/**
 * Why the hero cannot try to disarm this, or null.
 * `03` section 4: mechanical traps want lockpicks; an Arcane one wants Dispel
 * Ward, and without it the roll is made on INT with disadvantage — so it is
 * never refused outright.
 */
export function whyNotDisarm(hero, entry) {
  if (!entry?.found) return 'notFound';
  if (entry.disarmed || entry.sprung) return 'alreadyGone';
  if (!isArcane(entry.kind, entry.tier) && !hero?.has?.lockpicks) return 'noLockpicks';
  return null;
}

/**
 * Disarming a found trap (`03` section 4).
 *
 * @returns {{ ok: boolean, why?: string, roll: number, total: number, tn: number,
 *   disarmed: boolean, salvage?: string, sprung: boolean, retry: boolean,
 *   xp: number, steps: number }}
 */
export function disarm(rng, hero, entry, floor) {
  const why = whyNotDisarm(hero, entry);
  if (why) return { ok: false, why, roll: 0, total: 0, tn: 0, disarmed: false, sprung: false, retry: false, xp: 0, steps: 0 };

  const magical = isArcane(entry.kind, entry.tier);
  const dispel = Boolean(hero?.has?.dispelWard);
  const attribute = magical ? DISARM.arcane.attribute : DISARM.mechanical.attribute;
  const roll = rng.d20({ disadvantage: magical && !dispel });

  let total = roll + modFor(hero?.attributes?.[attribute]);
  if (magical) {
    total += hero?.explore?.magicTrap ?? 0;
    if (dispel) total += DISARM.arcane.withDispel;
  } else {
    total += hero?.explore?.disarm ?? 0;
  }
  // "Apply −2 if the trap's type is unknown."
  if (!entry.typeKnown) total += DETECTION.unknownTypePenalty;

  const target = disarmTn(entry.tier, floor);
  const by = total - target;
  const natural1 = roll === 1;
  const success = roll === 20 || (!natural1 && by >= 0);

  if (success) {
    entry.disarmed = true;
    const clean = by >= DISARM.salvageBy;
    return {
      ok: true,
      roll,
      total,
      tn: target,
      disarmed: true,
      sprung: false,
      retry: false,
      ...(clean ? { salvage: salvageFor(entry.kind) } : {}),
      xp: xpFor('disarm', floor, entry.tier),
      steps: DISARM.steps,
    };
  }

  // "Fail by 5+, or natural 1: the trap goes off." Anything shorter is just
  // time lost, and the hero may try again.
  const sprung = natural1 || by <= -DISARM.failBy;
  if (sprung) entry.sprung = true;
  return {
    ok: false,
    roll,
    total,
    tn: target,
    disarmed: false,
    sprung,
    retry: !sprung,
    xp: 0,
    steps: sprung ? DISARM.steps : DISARM.retrySteps,
  };
}

/**
 * Springing a trap with a ten-foot pole (`03` section 4). No roll: the trap
 * is used up, the hero gets no XP, and a blade or a crushing trap may take
 * the pole with it.
 */
export function springWithPole(rng, hero, entry) {
  if (!entry?.found) return { ok: false, why: 'notFound' };
  if (entry.disarmed || entry.sprung) return { ok: false, why: 'alreadyGone' };
  if (!hero?.has?.pole) return { ok: false, why: 'noPole' };
  if (!poleable(entry.kind)) return { ok: false, why: 'notPoleable' };

  entry.sprung = true;
  const reaches = poleAdvantage(entry.kind);
  const family = trap(entry.kind).family;
  const breaks = POLE.breaksOn.includes(family) && rng.chance(1 / POLE.breaksOneIn);
  return {
    ok: true,
    // An area trap still reaches the hero, with the save made with advantage.
    reaches,
    advantage: reaches,
    poleBroke: breaks,
    xp: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Going off                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The damage itself, through `06` section 7: the dice, then resistance,
 * weakness, immunity and DR, then the floor of 1 that a hit that lands has.
 * A trap has no attacker, so nothing adds an attribute to it.
 */
function hurt(services, hero, notation, type, entry, { half = false } = {}) {
  const combat = { rng: services.rng, hooks: services.hooks ?? createHooks() };
  const attack = {
    name: entry.kind,
    kind: 'trap',
    damage: `${notation}${type ? ` ${type}` : ''}`,
    noAttributeDamage: true,
  };
  // "Reflex save for half" is a multiplier on every part, which is what
  // `06` section 7 step 6 is for — so it goes on as one, through the hook
  // the section names rather than by halving the answer afterwards.
  const off = half
    ? combat.hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== hero) return;
          payload.allPartsMultiplier = (payload.allPartsMultiplier ?? 1) * HALF_ON_SAVE;
        },
        { name: 'trapHalf', source: 'traps' },
      )
    : null;

  const dealt = resolveDamage(combat, { attacker: null, target: hero, attack });
  off?.();
  return dealt.total;
}

/** One saving throw against a trap (`03` sections 2 and 4). */
function rollSave(rng, hero, save, dc, { advantage = false, disadvantage = false }) {
  const roll = rng.d20({ advantage, disadvantage });
  const total = roll + (hero?.saves?.[save] ?? 0);
  return { save, roll, total, dc, passed: roll === 20 || (roll !== 1 && total >= dc) };
}

/**
 * A trap going off (`03` section 4, When a Trap Goes Off).
 *
 * The damage goes through the damage rules, so a hero resistant to fire takes
 * a Flame Jet the way they take a fireball. Everything a trap does to the
 * *world* — an encounter, a teleport, a chute, a pit to climb out of — is
 * handed back as flags for the exploration loop, which owns the floor.
 *
 * @param {object} services `{ rng }`, and the hooks a fight would bring
 * @param {object} hero
 * @param {object} entry the trap as the floor holds it
 * @param {number} floor
 * @param {object} [options] `detected`, and `advantage` from a pole
 */
export function trigger(services, hero, entry, floor, { detected = true, advantage = false } = {}) {
  const rng = services.rng;
  const spec = trap(entry.kind);
  const effect = spec.effect ?? {};
  const out = { kind: entry.kind, tier: entry.tier, damage: 0, conditions: [], events: [] };
  entry.sprung = true;

  // "If the trap was never detected, the hero is caught off guard."
  const surprised = !detected;
  const saveOptions = {
    advantage,
    disadvantage: surprised && TRIGGER.undetected.saveDisadvantage && !advantage,
  };

  // An attack trap rolls against DEF: +F + 3, and +2 more if unseen.
  if (effect.attack) {
    const bonus =
      TRIGGER.attackBonus.perFloor * floor +
      TRIGGER.attackBonus.flat +
      (surprised ? TRIGGER.undetected.attackBonus : 0);
    const roll = rng.d20();
    const total = roll + bonus;
    const hit = roll === 20 || (roll !== 1 && total >= (hero.def ?? 10));
    out.attack = { roll, total, def: hero.def ?? 10, hit };
    if (!hit) return out;
  }

  let save = null;
  if (effect.save) {
    save = rollSave(rng, hero, effect.save, saveDc(entry.tier, floor), saveOptions);
    out.save = save;
  }

  // Damage: full, or half where the document says a save halves it. It goes
  // through `06` section 7's own pipeline, so a hero resistant to fire takes
  // a Flame Jet the way they take a fireball.
  const notation = damageNotation(effect.damage, floor);
  if (notation) {
    const type = Array.isArray(effect.damageType) ? rng.pick(effect.damageType) : effect.damageType;
    const skip = save && save.passed && !effect.halfOnSave;
    if (!skip) {
      const dealt = hurt(services, hero, notation, type, entry, {
        half: Boolean(save && save.passed && effect.halfOnSave),
      });
      out.damage = dealt;
      out.damageType = type;
    }
  }

  const failed = !save || !save.passed;
  const riders = { ...(effect.onFail ?? {}), ...(failed ? {} : {}) };

  // A condition the trap leaves behind, and anything its "then" adds.
  const conditions = [effect.condition, riders.condition].filter(Boolean);
  if (failed) {
    for (const id of conditions) {
      const applied = applyCondition(hero, id, { dc: saveDc(entry.tier, floor), source: 'trap' });
      if (applied.applied) out.conditions.push(id);
    }
    // Extra dice a rider adds: the Spiked Pit's spikes.
    if (riders.extraDamage) {
      out.damage += hurt(
        services,
        hero,
        damageNotation(riders.extraDamage, floor),
        riders.extraDamageType,
        entry,
      );
    }
    if (riders.loseFp) {
      const lost = Math.min(hero.fp ?? 0, rng.roll(riders.loseFp));
      hero.fp = (hero.fp ?? 0) - lost;
      out.fpLost = lost;
    }
    // What the floor has to do about it.
    for (const flag of ['pit', 'chute', 'teleport', 'destroysCarried', 'burnsScrollsInside']) {
      if (riders[flag] !== undefined) out.events.push({ type: flag, value: riders[flag], trap: entry.kind });
    }
    if (riders.climbSteps) out.climbSteps = riders.climbSteps;
  }

  // And what it does whether or not the save held.
  if (effect.encounter) out.events.push({ type: 'encounter', ...effect.encounter, trap: entry.kind });
  const then = effect.then ?? {};
  if (failed && then.save) {
    const second = rollSave(rng, hero, then.save, saveDc(entry.tier, floor), saveOptions);
    out.thenSave = second;
    if (!second.passed && then.condition) {
      const applied = applyCondition(hero, then.condition, { source: 'trap' });
      if (applied.applied) out.conditions.push(then.condition);
    }
  }
  if (then.wanderingCheck || (failed && then.wanderingCheck)) {
    out.events.push({ type: 'wanderingCheck', surprise: Boolean(then.enemySurprise), trap: entry.kind });
  }
  if (effect.escapeSteps) out.escapeSteps = effect.escapeSteps;
  if (effect.durationSteps) out.durationSteps = effect.durationSteps;
  return out;
}
