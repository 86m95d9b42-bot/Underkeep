/**
 * The Inn, the Temple and the Sage (`01` sections 5 and 7, `04` section 5,
 * and the Temple prices in `docs/DECISIONS.md`).
 *
 * Three shops that sell one thing each: a night's sleep, a cure, and a name
 * for what you are carrying. They share a shape — a list of offers, each with
 * what it costs, why it cannot be taken, and what it does — because the
 * outline gives them one screen between them.
 *
 * An offer never spends the gold itself: `take` does that, once, after asking
 * the same question the screen asked to dim the button.
 *
 * No DOM. The words are in `strings.json`; what is here is the arithmetic.
 */
import shops from '../data/shops.json' with { type: 'json' };
import { CONDITIONS, listed } from '../engine/conditions.js';
import { applySkillSheet } from '../engine/skill-hooks.js';
import { cleanseAtTemple, cleanseFee } from './gear.js';
import { identify, isIdentified, sageFee } from './identification.js';
import { entryOf } from './inventory.js';
import { respec, respecCost, spentTotal } from './skill-tree.js';

export const PRICES = shops.services;

/** The three services that share the outline's Temple layout. */
export const SERVICE_SCREENS = /** @type {const} */ (['inn', 'temple', 'sage']);

/** Conditions a night's sleep is enough to shake off (`01` section 7). */
export function endsOnRest(id) {
  return ['rest', 'templeOrTownRest'].includes(CONDITIONS[id]?.endsOn);
}

/**
 * Conditions the Temple's cure takes away: everything the hero is still
 * carrying, except the level drain, which has a price of its own.
 *
 * What can still be on a hero in town is `06` section 10's "after combat"
 * list — Weakened and Drained are kept, Poisoned becomes the exploration
 * poison — so the cure is written as "all but one" rather than as a list
 * that would have to be kept in step with `conditions.json`.
 */
export function isAilment(id) {
  return id !== 'drained' && Boolean(CONDITIONS[id]);
}

/** What the hero is carrying that no one has named yet (`04` section 5). */
export function unknownItems(hero) {
  return (hero.pack?.items ?? []).filter((entry) => !isIdentified(hero.identification, entry));
}

/** Everything cursed the hero has on or in the pack (`04` section 6). */
export function cursedItems(hero) {
  return (hero.pack?.items ?? []).filter((entry) => entry.curse);
}

/** How many stacks of the Wraith's drain the hero is carrying. */
export function drainedStacks(hero) {
  return hero.conditions?.drained?.stacks ?? (hero.conditions?.drained ? 1 : 0);
}

/* -------------------------------------------------------------------------- */
/* The offers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A night at the Inn: **5 gp x level** for full hit points, full Focus and
 * whatever a rest is enough to shake off (`01` section 7's "rest" column, and
 * the Inn ruling in DECISIONS).
 */
function innOffers(hero) {
  const cost = PRICES.inn.goldPerLevel * (hero.level ?? 1);
  const hurt = (hero.hp ?? 0) < (hero.maxHp ?? 0) || (hero.fp ?? 0) < (hero.maxFp ?? 0);
  const carrying = listed(hero).filter(endsOnRest);
  return [
    {
      id: 'rest',
      cost,
      why: hurt || carrying.length > 0 ? null : 'nothingToRest',
      clears: carrying,
      apply(who) {
        who.hp = who.maxHp;
        who.fp = who.maxFp;
        for (const id of listed(who).filter(endsOnRest)) delete who.conditions[id];
        return { rested: true, cleared: carrying };
      },
    },
  ];
}

/**
 * The Temple (prices in DECISIONS): cure ailments 10 gp x level, one stack of
 * Drained 100 gp x level, a curse 50 gp x the floor the item was found on and
 * the item with it, and a respec at 100 gp x level.
 */
function templeOffers(hero) {
  const level = hero.level ?? 1;
  const ailments = listed(hero).filter(isAilment);
  const drained = drainedStacks(hero);

  const offers = [
    {
      id: 'cure',
      cost: PRICES.temple.cureGoldPerLevel * level,
      why: ailments.length > 0 ? null : 'nothingToCure',
      clears: ailments,
      apply(who) {
        for (const id of listed(who).filter(isAilment)) delete who.conditions[id];
        return { cured: ailments };
      },
    },
    {
      id: 'restore',
      cost: PRICES.temple.drainedGoldPerLevel * level,
      why: drained > 0 ? null : 'notDrained',
      stacks: drained,
      apply(who) {
        const left = drainedStacks(who) - 1;
        if (left > 0) who.conditions.drained.stacks = left;
        else delete who.conditions.drained;
        applySkillSheet(who);
        return { restored: 1, left };
      },
    },
  ];

  // One offer per cursed item: the fee is the floor it came from, and the
  // item does not survive it.
  for (const instance of cursedItems(hero)) {
    offers.push({
      id: 'removeCurse',
      target: instance.instanceId,
      cost: cleanseFee(instance),
      why: null,
      apply(who) {
        return cleanseAtTemple(who, instance.instanceId);
      },
    });
  }

  offers.push({
    id: 'respec',
    cost: respecCost(hero),
    why: spentTotal(hero) > 0 ? null : 'nothingSpent',
    apply(who) {
      respec(who);
      return { respec: true };
    },
  });
  return offers;
}

/** The Sage: **20 gp an item** to name one, or the lot (`04` section 5). */
function sageOffers(hero) {
  const unknown = unknownItems(hero);
  const offers = unknown.map((instance) => ({
    id: 'identify',
    target: instance.instanceId,
    cost: sageFee(1),
    why: null,
    apply(who) {
      const entry = entryOf(who.pack, instance.instanceId);
      if (entry) identify(who.identification, entry);
      return { identified: 1 };
    },
  }));

  offers.push({
    id: 'identifyAll',
    cost: sageFee(unknown.length),
    why: unknown.length > 0 ? null : 'nothingUnknown',
    count: unknown.length,
    apply(who) {
      for (const instance of unknownItems(who)) identify(who.identification, instance);
      return { identified: unknown.length };
    },
  });
  return offers;
}

/**
 * What one service is offering this hero, in the order the screen lists it.
 * @param {'inn' | 'temple' | 'sage'} service
 * @param {object} hero
 * @returns {object[]}
 */
export function offersOf(service, hero) {
  switch (service) {
    case 'inn':
      return innOffers(hero);
    case 'temple':
      return templeOffers(hero);
    case 'sage':
      return sageOffers(hero);
    /* c8 ignore next 2 -- the screens only ever ask for the three */
    default:
      throw new Error(`no such service: ${service}`);
  }
}

/** Why the hero cannot take this offer, or null. */
export function whyNot(hero, offer) {
  if (!offer) return 'pick';
  if (offer.why) return offer.why;
  if ((hero.gold ?? 0) < offer.cost) return 'notEnoughGold';
  return null;
}

/**
 * Takes an offer: the gold goes, and whatever it does happens.
 * @returns {{ ok: boolean, why?: string, paid?: number, result?: object }}
 */
export function take(hero, offer) {
  const why = whyNot(hero, offer);
  if (why) return { ok: false, why };
  const paid = offer.cost;
  // Removing a curse charges its own fee and destroys the item, so it does
  // the paying itself (`04` section 6).
  if (offer.id === 'removeCurse') {
    const done = offer.apply(hero);
    return done.ok ? { ok: true, paid: done.fee, result: done } : { ok: false, why: done.why };
  }
  hero.gold -= paid;
  return { ok: true, paid, result: offer.apply(hero) };
}
