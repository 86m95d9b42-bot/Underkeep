/**
 * Monsters (`02` sections 4, 5 and 19).
 *
 * `monsters.json` keeps the bestiary's own JSON shape — `attacks`, `resist`,
 * `group`, `saves` — because a stat block that reads like the document can be
 * checked against the document. This module turns one of those into the plain
 * unit the combat engine takes: `resist` becomes `resistant`, the first attack
 * becomes the unit's basic attack, and the rider under it stays with it.
 *
 * Nothing here rolls hit points: the bestiary gives every monster a fixed HP,
 * and the engine's job is to run what the table says.
 */
import data from './monsters.json' with { type: 'json' };
import { DERIVED } from './attributes.js';

export const MONSTERS = data.monsters;

/** Every monster id, in the order the bestiary lists them. */
export function monsterIds() {
  return Object.keys(MONSTERS).filter((id) => !id.startsWith('_'));
}

/** One stat block, as the document writes it. */
export function statBlock(id) {
  const found = MONSTERS[id];
  if (!found) throw new Error(`unknown monster: ${id}`);
  return found;
}

/** The monsters a floor can throw, by its number. */
export function monstersOnFloor(floor) {
  return monsterIds().filter((id) => (MONSTERS[id].floors ?? []).includes(floor));
}

/**
 * Resolves the Coin Imp's per-floor numbers: `"floor * 4"`, `"14 + floor / 2"`.
 * Nothing else in the bestiary is written this way, and everything rounds down
 * (`06` section 1 rule 4).
 * @param {number | string} value
 * @param {number} floor
 */
export function scale(value, floor = 1) {
  if (typeof value !== 'string' || !/floor/.test(value)) return value;
  const parts = /^\s*(?:(\d+)\s*\+\s*)?floor\s*(?:([*/])\s*(\d+))?\s*$/.exec(value);
  if (!parts) throw new SyntaxError(`cannot read per-floor value "${value}"`);
  const [, base, operator, operand] = parts;
  let result = floor;
  if (operator === '*') result = floor * Number(operand);
  if (operator === '/') result = Math.floor(floor / Number(operand));
  return (base ? Number(base) : 0) + result;
}

/**
 * One attack from the bestiary's `attacks` list, as the engine's attack shape.
 * @param {object} attack
 */
function toAttack(attack) {
  if (!attack) return { damage: '1' };
  return {
    name: attack.name,
    kind: attack.kind ?? 'melee',
    damage: `${attack.dmg}${attack.dmgType ? ` ${attack.dmgType}` : ''}`,
    ...(attack.bonus !== undefined ? { bonus: attack.bonus } : {}),
    ...(attack.onHit ? { onHit: attack.onHit } : {}),
  };
}

/** An ability, with its damage written the way the engine reads it. */
function toAbility(ability) {
  const { dmg, dmgType, ...rest } = ability;
  return {
    ...rest,
    ...(dmg ? { damage: `${dmg}${dmgType ? ` ${dmgType}` : ''}` } : {}),
    // Everything starts ready; a recharge ability is spent when it is used.
    ready: ability.ready ?? true,
  };
}

/**
 * Builds the unit the engine fights with.
 *
 * @param {string} id
 * @param {object} [options]
 * @param {number} [options.floor] for the Coin Imp's per-floor numbers
 * @param {boolean} [options.elite] marked by the encounter table's 12
 * @param {object} [options.overrides] anything the encounter wants to change
 */
export function makeMonster(id, { floor = 1, elite = false, overrides = {} } = {}) {
  const block = statBlock(id);
  const at = (value) => scale(value, floor);
  const attacks = (block.attacks ?? []).map(toAttack);

  return {
    type: id,
    name: block.name,
    side: 'monsters',
    hd: at(block.hd),
    hp: at(block.hp),
    maxHp: at(block.hp),
    atk: at(block.atk),
    def: at(block.def),
    init: at(block.init),
    saves: {
      body: at(block.saves?.body ?? 0),
      reflex: at(block.saves?.reflex ?? 0),
      mind: at(block.saves?.mind ?? 0),
    },
    row: block.row ?? 'front',
    morale: block.morale ?? null,
    archetype: block.archetype ?? 'brute',
    ...(block.script ? { script: block.script } : {}),
    ...(block.actsLast ? { actsLast: true } : {}),
    ...(block.anchored ? { anchored: true } : {}),
    attack: attacks[0] ?? { damage: '1' },
    attacks,
    abilities: (block.abilities ?? []).map(toAbility),
    traits: [...(block.traits ?? [])],
    // The damage rules read these three names.
    resistant: [...(block.resist ?? [])],
    weak: [...(block.weak ?? [])],
    immune: [...(block.immune ?? [])],
    // Conditions the bestiary lists as immunities are immunities to conditions
    // as well as to damage; the condition engine reads the same list.
    immunities: [...(block.immune ?? [])],
    xp: at(block.xp),
    goldRoll: at(block.gold ?? '0'),
    drops: block.drops ?? [],
    ...(block.swallowedGold ? { swallowedGold: block.swallowedGold } : {}),
    ...(elite ? { elite: true } : {}),
    ...overrides,
  };
}

/**
 * The DC of an effect a monster forces: **10 + floor(HD / 2)**
 * (`01` section 4, Effect DCs). A stat block that states its own DC — most of
 * them do — keeps it; this is what anything else falls back to.
 * @param {object} unit
 */
export function effectDcOf(unit) {
  const rule = DERIVED.effectDc.monster;
  return rule.base + Math.floor((unit?.hd ?? 0) / rule.perHd);
}

/**
 * How many of a monster an encounter line asks for, and the bestiary's own
 * group range when it does not say.
 * @param {string} id
 * @param {import('../engine/rng.js').Stream} rng
 * @param {[number, number]} [range]
 */
export function groupSize(id, rng, range) {
  const [low, high] = range ?? statBlock(id).group ?? [1, 1];
  return low === high ? low : rng.range(low, high);
}

/**
 * The gold a defeated monster leaves. Rolled when the fight ends, from the
 * loot stream (`05` section 11).
 * @param {object} unit
 * @param {import('../engine/rng.js').Stream} rng
 */
export function goldFrom(unit, rng) {
  const notation = String(unit.goldRoll ?? '0');
  if (notation === '0') return 0;
  return /^\d+$/.test(notation) ? Number(notation) : rng.roll(notation);
}
