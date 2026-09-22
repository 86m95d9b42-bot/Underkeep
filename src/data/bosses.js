/**
 * The ten bosses (`02` sections 4 to 13, `06` sections 12 and 13).
 *
 * A boss is a monster with three things an ordinary monster does not have:
 * an **escort** it starts the fight with, **objects** in its arena — coolant
 * valves, the Phylactery — and **phases** that change what it is partway
 * through. The Hydra adds a fourth: **parts**, its heads, which are units of
 * their own on the body's initiative.
 *
 * `bossParty` builds all of it, in the order the field takes them. Nothing
 * here rolls: the numbers are the document's.
 */
import data from './bosses.json' with { type: 'json' };

/**
 * How far a boss fight is scaled from `02`'s numbers (the balance pass,
 * docs/DECISIONS.md): hit points for the boss's side and its arena objects,
 * and the damage the boss's side deals.
 */
export const BOSS_TUNING = data.tuning ?? { hpScale: 1, objectHpScale: 1, damageScale: 1 };
import { buildUnit, makeMonster } from './monsters.js';

export const BOSSES = data.bosses;

/**
 * One boss fight's scales: the shared ones, with the boss's own `tuning`
 * over them, so each fight can be tuned alone (docs/DECISIONS.md).
 * @param {string} id
 */
export function bossTuning(id) {
  return { ...BOSS_TUNING, ...(BOSSES[id]?.tuning ?? {}) };
}
export const BOSS_UNITS = data.units;

/** Every boss id, floor 1 first. */
export function bossIds() {
  return Object.keys(BOSSES).filter((id) => !id.startsWith('_'));
}

/** One boss's stat block, as `02` writes it. */
export function boss(id) {
  const found = BOSSES[id];
  if (!found) throw new Error(`unknown boss: ${id}`);
  return found;
}

/** The boss that guards a floor's stairs (`05` section 1, Boss gates). */
export function bossOnFloor(floor) {
  return bossIds().find((id) => BOSSES[id].floor === floor) ?? null;
}

/** What a boss is worth: XP, gold, and the one item it is carrying. */
export function rewardOf(id) {
  const block = boss(id);
  return { xp: block.xp, gold: block.gold, ...block.reward };
}

/**
 * Builds a boss unit from its own stat block. The block is shaped like a
 * monster's, so the monster builder does the work; what is added here is what
 * only a boss carries.
 *
 * @param {string} id
 * @param {{ floor?: number }} [options]
 */
export function makeBoss(id, { floor } = {}) {
  const block = boss(id);
  const unit = buildUnit(block, { id, floor: floor ?? block.floor });
  unit.boss = true;
  unit.floorNumber = block.floor;
  // What it is carrying: `02` names one item per boss, and a boss always has
  // it (`02` section 17, "plus the boss's own reward").
  if (block.reward?.item) unit.drops = [{ item: block.reward.item, chance: 1 }];
  return unit;
}

/**
 * Everything that stands in the arena when the fight begins (`06` section 13).
 *
 * @param {string} id
 * @param {{ floor?: number }} [options]
 * @returns {{ boss: object, units: object[] }} the boss, and every unit on the
 *   field in the order they are placed — the boss, its parts, its escort, and
 *   the objects that belong to the room
 */
export function bossParty(id, { floor } = {}) {
  const block = boss(id);
  const on = floor ?? block.floor;
  const leader = makeBoss(id, { floor: on });
  const units = [leader];

  // The Hydra's heads: its own units, on its initiative (`02` section 8).
  for (const part of block.parts ?? []) {
    for (let i = 0; i < part.count; i += 1) {
      const head = makeMonster(part.id, { floor: on });
      head.part = true;
      head.partOf = id;
      head.row = part.row ?? 'front';
      head.init = leader.init;
      units.push(head);
    }
  }

  for (const line of block.escort ?? []) {
    for (let i = 0; i < line.count; i += 1) units.push(makeMonster(line.id, { floor: on }));
  }

  for (const line of block.objects ?? []) {
    for (let i = 0; i < line.count; i += 1) {
      const thing = makeMonster(line.id, { floor: on });
      thing.row = line.row ?? 'back';
      thing.owner = id;
      units.push(thing);
    }
  }

  return { boss: leader, units };
}
