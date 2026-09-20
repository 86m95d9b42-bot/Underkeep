/**
 * The town, and the counters over it (`00-build-outline.md`, "Town";
 * `05` sections 8 and 12).
 *
 * Two numbers are kept here and shown on every town screen:
 *
 *   - **The day.** `05` section 12 counts "days in the dungeon (town visits)",
 *     so a day is one stay in town: the hero arrives on day 1 and every
 *     return turns the day over.
 *   - **The trip.** How many times the hero has gone down. The Hub shows the
 *     trip the Dungeon Gate would begin, which is one more than the number
 *     taken — the mockup's *"Day 7 · Return trip 8"*.
 *
 * Which services are open is the third thing the town knows. `04` section 15
 * unlocks the Shop's stock a tier at a time as bosses fall, and section 12
 * opens the Alchemist after the floor 2 boss; everything else is open from
 * the first day.
 *
 * No DOM. Nothing here spends gold or moves an item: the services do that.
 */
import shops from '../data/shops.json' with { type: 'json' };
import { ALCHEMY } from '../data/items.js';

/** The six services of the Hub's grid, in the outline's order. */
export const SERVICES = /** @type {const} */ ([
  'inn',
  'shop',
  'temple',
  'sage',
  'alchemist',
  'stash',
]);

/** The Shop's tiers (`04` section 15). */
export const SHOP_TIERS = shops.tiers;

/** What each service charges, for the hint under its button. */
export const SERVICE_PRICES = shops.services;

/**
 * A town, as the save carries it.
 * @param {object} [state]
 * @returns {{ day: number, trips: number, bosses: number[] }}
 */
export function createTown({ day = 1, trips = 0, bosses = [] } = {}) {
  return { day, trips, bosses: [...bosses] };
}

/** The trip the Dungeon Gate would begin: one more than those taken. */
export function nextTrip(town) {
  return (town?.trips ?? 0) + 1;
}

/**
 * The hero goes down. Returns the trip number that just began, and the town
 * counts it whether or not they come back.
 */
export function descend(town) {
  town.trips += 1;
  return town.trips;
}

/**
 * The hero comes back. A return turns the day over (`05` section 12), and
 * `05` section 8's restocking hangs off this same moment.
 */
export function arrive(town) {
  town.day += 1;
  return town.day;
}

/** Remembers a boss as defeated, which is what opens the Shop's next tier. */
export function bossDefeated(town, floor) {
  if (!town.bosses.includes(floor)) town.bosses.push(floor);
  return town.bosses;
}

/** How deep the hero has beaten a boss, which is what the tiers read. */
export function deepestBoss(town) {
  return (town?.bosses ?? []).reduce((deepest, floor) => Math.max(deepest, floor), 0);
}

/** Which tier the Shop is stocking (`04` section 15). */
export function shopTier(town) {
  const beaten = deepestBoss(town);
  return SHOP_TIERS.reduce(
    (tier, row) => (row.unlockedBy === null || beaten >= row.unlockedBy.boss ? row.tier : tier),
    1,
  );
}

/** The floor whose boss opens a service, or null for one that is always open. */
export function unlockFloorFor(service) {
  if (service === 'alchemist') return ALCHEMY.unlockedBy?.boss ?? null;
  return null;
}

/** True once a service is open for business. */
export function isOpen(town, service) {
  const floor = unlockFloorFor(service);
  return floor === null || deepestBoss(town) >= floor;
}

/** Every service, with whether it is open and what still shuts it. */
export function servicesOf(town) {
  return SERVICES.map((id) => ({
    id,
    open: isOpen(town, id),
    unlockFloor: unlockFloorFor(id),
  }));
}

/** What a night at the Inn costs: 5 gp x level (`01`, and the Temple ruling). */
export function innCost(hero) {
  return SERVICE_PRICES.inn.goldPerLevel * (hero?.level ?? 1);
}

/** What the Sage charges an item (`04` section 5). */
export function sageCost() {
  return SERVICE_PRICES.sage.goldPerItem;
}
