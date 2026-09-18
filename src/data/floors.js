/**
 * Floor specifications (`05` section 2, and the counts from section 3).
 *
 * `floors.json` keeps the documents' tables as tables, and the counts the
 * documents give as formulas as formulas. This module resolves them for one
 * floor, so the floor builder reads finished numbers and never does arithmetic
 * on rules of its own.
 *
 * No DOM: this is data, used by the floor builder, the tests, and the
 * balance simulator alike.
 */
import floors from './floors.json' with { type: 'json' };

/** The game has ten dungeon floors and a town (`05` section 1). */
export const FLOOR_COUNT = floors.floors.length;

/** @typedef {typeof floors.floors[number]} FloorRow */

/**
 * @typedef {object} FloorSpec
 * @property {number} floor
 * @property {string} id
 * @property {string} theme
 * @property {number} width
 * @property {number} height
 * @property {[number, number]} rooms          how many rooms the floor wants
 * @property {number} roomDensity              the vendored generator's knob for that range
 * @property {string[]} hazards                which hazards this floor may use
 * @property {string[]} features               the floor's theme features
 * @property {string} [corridorStyle]
 * @property {number} arenaSize                the boss arena's side, in tiles
 * @property {{ lairs: number, chests: number, floorTraps: number }} counts
 * @property {{ lockedDoors: number, roomToCorridorDoors: number, extraConnectors: number }} rates
 * @property {number} doorTrapOneIn
 * @property {Record<string, [number, number]>} roomRoles
 * @property {Record<string, { count: [number, number] }>} specialDoors  only those this floor allows
 * @property {number} webCurtainBashTn
 */

/** @param {number} floor */
function assertFloor(floor) {
  if (!Number.isInteger(floor) || floor < 1 || floor > FLOOR_COUNT) {
    throw new RangeError(`floors: there is no floor ${floor} (1..${FLOOR_COUNT})`);
  }
}

/**
 * A count the documents write as "base + floor(F ÷ n)".
 * @param {{ base: number, perFloor: number }} rule @param {number} floor
 */
function resolveCount(rule, floor) {
  return rule.base + Math.floor(floor * rule.perFloor);
}

/**
 * A rate the documents write as a percentage that grows with depth.
 * @param {{ base: number, perFloor: number }} rule @param {number} floor
 */
function resolveRate(rule, floor) {
  return rule.base + floor * rule.perFloor;
}

/**
 * The vendored generator takes a `roomDensity`, from which it works out
 * `maxRooms = floor(w * h * 0.08 * roomDensity)` (`07`, and the module's own
 * docblock). The documents give room counts instead, so the density is derived
 * from the top of the floor's range: it is a cap on attempts, not a promise.
 * @param {number} grid @param {number} maxRooms
 */
export function roomDensityFor(grid, maxRooms) {
  // Half a room is added before dividing so the generator's own floor() lands
  // squarely on `maxRooms`. Dividing exactly puts the product on the boundary,
  // where floating point can round it down to one room fewer.
  return (maxRooms + 0.5) / (grid * grid * 0.08);
}

/**
 * Everything the floor builder needs for one floor, with every formula already
 * worked out.
 * @param {number} floor 1 to 10
 * @returns {FloorSpec}
 */
export function floorSpec(floor) {
  assertFloor(floor);
  const row = floors.floors[floor - 1];

  /** @type {Record<string, { count: [number, number] }>} */
  const specialDoors = {};
  for (const [name, rule] of Object.entries(floors.specialDoors)) {
    if (name.startsWith('_') || typeof rule !== 'object') continue;
    if (floor >= rule.minFloor) specialDoors[name] = { count: rule.count };
  }

  return {
    floor,
    id: row.id,
    theme: row.theme,
    width: row.grid,
    height: row.grid,
    rooms: /** @type {[number, number]} */ ([...row.rooms]),
    roomDensity: roomDensityFor(row.grid, row.rooms[1]),
    hazards: [...row.hazards],
    features: [...row.features],
    corridorStyle: row.corridorStyle,
    arenaSize: floors.bossArena.sizeByFloor[String(floor)] ?? floors.bossArena.size,
    counts: {
      lairs: resolveCount(floors.counts.lairs, floor),
      chests: resolveCount(floors.counts.chests, floor),
      floorTraps: resolveCount(floors.counts.floorTraps, floor),
    },
    rates: {
      lockedDoors: resolveRate(floors.rates.lockedDoors, floor),
      roomToCorridorDoors: resolveRate(floors.rates.roomToCorridorDoors, floor),
      extraConnectors: resolveRate(floors.rates.extraConnectors, floor),
    },
    doorTrapOneIn:
      floor >= floors.doorTraps.oneInFromFloor ? floors.doorTraps.oneInDeep : floors.doorTraps.oneIn,
    roomRoles: {
      treasure: /** @type {[number, number]} */ ([...floors.roomRoles.treasure]),
      curiosity: /** @type {[number, number]} */ ([...floors.roomRoles.curiosity]),
      theme: /** @type {[number, number]} */ ([...floors.roomRoles.theme]),
      secretStash: /** @type {[number, number]} */ ([...floors.roomRoles.secretStash]),
    },
    specialDoors,
    webCurtainBashTn: resolveCount(floors.hazardRules.web_curtain.bashTn, floor),
  };
}

/** Every floor's spec, floor 1 first. */
export function allFloorSpecs() {
  return Array.from({ length: FLOOR_COUNT }, (_, i) => floorSpec(i + 1));
}

/** @param {number} floor @param {string} hazard */
export function hazardAllowed(floor, hazard) {
  return floorSpec(floor).hazards.includes(hazard);
}

export const pacing = floors.pacing;
export const bossArena = floors.bossArena;
export const hazardRules = floors.hazardRules;
export const chestDepthBonus = floors.chestDepthBonus;
export const floorTrapPlacement = floors.floorTrapPlacement;
export const criticalPathMaxLockTier = floors.specialDoors.criticalPathMaxLockTier;

export { floors as floorsData };
