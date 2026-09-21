/**
 * The four example builds of `01` section 6, at any level.
 *
 * The document writes them at level 20, where 21 skill points are spent:
 *
 *   - **Pure Warrior:** Blade 16 + Spirit 4 + Crusader
 *   - **Battle Mage:** Arcana 11 + Blade 4 + Spellblade + 5 spare
 *   - **Assassin:** Shadow 16 + Arcana 4 + Arcane Trickster
 *   - **Wanderer:** Shadow 8 + Spirit 8 + Ranger + 4 spare
 *
 * A simulator needs them at every level on the way there, so each build is
 * written as an **order**: the points it spends, first to last. Take the
 * first N and you have the build at N points, and every prefix is legal —
 * the tier gates of `01` section 6 open at 3, 6 and 10 points in a path, and
 * a Crossroads skill needs 4 in each of its two.
 *
 * Attributes are the **average** of `01` section 2's roll — 4d6 drop lowest,
 * which averages to 15, 14, 13, 12, 10, 9 — assigned by the build's own
 * priority, so the builds differ by their choices rather than by their luck.
 * The points of levels 4, 8, 12, 16 and 20 go the same way.
 *
 * Gear is what the Shop would sell a hero that deep: `04` section 15 opens a
 * tier for every second boss, so a hero on floor F shops at tier
 * 1 + ⌊(F − 1) / 2⌋, and buys the best of it their build can use.
 */
import { chooseOrigin, createDraft, finish, setName } from '../../src/systems/creation.js';
import { learn, whyNot } from '../../src/systems/skill-tree.js';
import { awardXp, rebuildSheet, spendAttributePoint, xpNeeded } from '../../src/systems/levelling.js';
import { addItem, equipNew, pin } from '../../src/systems/inventory.js';
import { refreshGear } from '../../src/systems/kit.js';
import { createIdentification } from '../../src/systems/identification.js';
import { createStream } from '../../src/engine/rng.js';
import { BOSSES, bossOnFloor } from '../../src/data/bosses.js';
import { item } from '../../src/data/items.js';

/** 4d6 drop lowest, averaged and rounded: the spread a hero can expect. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 9];

/** The Hero Level column of `02` section 3's progression targets, per floor. */
export const EXPECTED_LEVEL = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 8, 6: 10, 7: 12, 8: 14, 9: 16, 10: 18 };

/** Which Shop tier a hero on this floor has unlocked (`04` section 15). */
export function shopTier(floor) {
  return Math.min(5, 1 + Math.floor((floor - 1) / 2));
}

/**
 * The four builds. `spend` is the order the points go in; `attributes` is the
 * priority the standard array and every later point follow; `gear` is what
 * the build buys at each Shop tier.
 */
export const BUILDS = {
  pure_warrior: {
    name: 'Pure Warrior',
    origin: 'sellsword',
    _source: '01 section 6: Blade 16 + Spirit 4 + Crusader.',
    attributes: ['might', 'vigor', 'agility', 'wits', 'luck', 'intellect'],
    spend: [
      'weapon_training', 'toughness', 'brute_force',
      'weapon_training', 'toughness', 'cleave',
      'armor_training', 'weapon_training', 'toughness',
      'weapon_mastery', 'riposte', 'second_wind',
      'armor_training', 'juggernaut',
      // Spirit 4 and the Crossroads it opens. `01` section 6 writes it as
      // "Resilience x2, Mend, Cleanse"; Resilience is tier II, which wants 3
      // points in the path first, so the order fills the tier below it
      // (docs/DECISIONS.md).
      'mend', 'keen_senses', 'keen_senses', 'resilience',
      'crusader',
      'shield_bash', 'power_strike', 'cleanse',
    ],
    weapons: ['long_sword', 'flail', 'great_sword', 'warhammer'],
    gear: {
      1: { armor: 'chain_mail', offHand: 'shield' },
      2: { armor: 'plate', offHand: 'tower_shield' },
      3: { armor: 'plate', offHand: 'tower_shield', bonus: 1 },
      4: { armor: 'plate', offHand: 'tower_shield', bonus: 2 },
      5: { armor: 'plate', offHand: 'tower_shield', bonus: 2 },
    },
  },

  battle_mage: {
    name: 'Battle Mage',
    origin: 'apprentice',
    _source: '01 section 6: Arcana 11 (through Archmage) + Blade 4 + Spellblade + 5 spare.',
    attributes: ['intellect', 'vigor', 'agility', 'might', 'wits', 'luck'],
    spend: [
      'magic_missile', 'arcane_well', 'arcane_well',
      'frost_shard', 'arcane_shield', 'fireball',
      'arcane_well', 'mana_siphon', 'blink',
      'archmage', 'sleep',
      'weapon_training', 'toughness', 'weapon_training', 'toughness',
      'spellblade',
      'power_strike', 'brute_force', 'lore', 'knock', 'dispel_ward',
    ],
    weapons: ['staff', 'mace', 'short_sword'],
    gear: {
      1: { armor: 'leather_armor', offHand: null },
      2: { armor: 'studded_leather', offHand: null },
      3: { armor: 'studded_leather', offHand: null, bonus: 1 },
      4: { armor: 'studded_leather', offHand: null, bonus: 2 },
      5: { armor: 'studded_leather', offHand: null, bonus: 2 },
    },
  },

  assassin: {
    name: 'Assassin',
    origin: 'cutpurse',
    _source: '01 section 6: Shadow 16 + Arcana 4 + Arcane Trickster.',
    attributes: ['agility', 'luck', 'intellect', 'vigor', 'wits', 'might'],
    spend: [
      'sneak', 'marksman', 'trapfinding',
      'backstab', 'evasion', 'nimble_fingers',
      'lockpicking', 'evasion', 'lucky',
      'vanish', 'death_strike', 'envenom',
      'trapfinding', 'lockpicking', 'trapfinding', 'lockpicking',
      'magic_missile', 'arcane_well', 'lore', 'arcane_well',
      'arcane_trickster',
    ],
    weapons: ['rapier', 'short_sword', 'mace'],
    gear: {
      1: { armor: 'leather_armor', offHand: null },
      2: { armor: 'studded_leather', offHand: null },
      3: { armor: 'studded_leather', offHand: null, bonus: 1 },
      4: { armor: 'studded_leather', offHand: null, bonus: 2 },
      5: { armor: 'studded_leather', offHand: null, bonus: 2 },
    },
  },

  wanderer: {
    name: 'Wanderer',
    origin: 'pilgrim',
    _source: '01 section 6: Shadow 8 + Spirit 8 + Ranger + 4 spare.',
    attributes: ['agility', 'wits', 'vigor', 'luck', 'might', 'intellect'],
    spend: [
      'marksman', 'sneak', 'evasion',
      'mend', 'keen_senses', 'resilience',
      'marksman', 'evasion', 'cleanse',
      'resilience', 'regeneration', 'smite',
      'ranger',
      'marksman', 'keen_senses', 'lucky',
      'forager', 'trapfinding', 'lockpicking', 'spirit_ward', 'turn_undead',
    ],
    weapons: ['longbow', 'sling', 'shortbow'],
    gear: {
      1: { armor: 'leather_armor', offHand: null },
      2: { armor: 'studded_leather', offHand: null },
      3: { armor: 'studded_leather', offHand: null, bonus: 1 },
      4: { armor: 'studded_leather', offHand: null, bonus: 2 },
      5: { armor: 'studded_leather', offHand: null, bonus: 2 },
    },
  },
};

/** Every build id, in the order `01` section 6 lists them. */
export function buildIds() {
  return Object.keys(BUILDS);
}

/** The scores the standard array gives this build. */
function scoresFor(build) {
  const scores = {};
  build.attributes.forEach((attribute, index) => {
    scores[attribute] = STANDARD_ARRAY[index];
  });
  return scores;
}

/**
 * One example build, at the level the floor expects.
 *
 * @param {string} id
 * @param {{ floor?: number, level?: number, seed?: number, potions?: number }} options
 * @returns {object} a hero the fight rules can take
 */
export function buildHero(id, { floor = 1, level, seed = 20260921, potions = 4 } = {}) {
  const build = BUILDS[id];
  if (!build) throw new Error(`unknown build: ${id}`);
  const wanted = level ?? EXPECTED_LEVEL[floor] ?? 1;

  const draft = { ...createDraft({ seed, rollMode: 'standard' }), scores: scoresFor(build) };
  const hero = finish(setName(chooseOrigin(draft, build.origin), build.name));
  hero.identification = createIdentification(seed);

  // Levels first: the XP the curve asks for, all at once (`01` section 5).
  levelTo(hero, wanted, seed);

  // Then the points, in the build's own order — the attribute points of
  // levels 4, 8, 12, 16 and 20 by priority, and the skill points down the
  // list until they run out.
  spendAttributes(hero, build);
  spendSkills(hero, build);

  // And what the Shop would have sold them by now.
  equip(hero, build, floor, potions);
  rebuildSheet(hero);
  hero.hp = hero.maxHp;
  hero.fp = hero.maxFp;
  hero.alive = true;
  hero.build = id;
  return hero;
}

/**
 * Awards exactly the experience the levels cost, and takes them.
 *
 * The hit points and Focus a level pays are rolled (`01` section 5), so they
 * are rolled here too, from a stream of the build's own — a hero levelled on
 * minimum rolls is not the hero the document describes.
 */
function levelTo(hero, level, seed = 1) {
  const rng = createStream(`levels-${seed}`, 'creation');
  let guard = 0;
  while (hero.level < level && guard < 100) {
    guard += 1;
    // `xpNeeded` is the total the next level asks for, so what is awarded is
    // the gap: one level at a time, each with its own roll.
    const needed = xpNeeded(hero);
    if (needed === null) break;
    awardXp(hero, Math.max(1, needed - (hero.xp ?? 0)), rng);
  }
  return hero;
}

/** The attribute points of `01` section 5, spent down the build's priority. */
function spendAttributes(hero, build) {
  let guard = 0;
  while ((hero.attributePoints ?? 0) > 0 && guard < 20) {
    guard += 1;
    // The build's first attribute that the cap still allows.
    const wanted = build.attributes.find((attribute) => (hero.attributes[attribute] ?? 0) < 20)
      ?? build.attributes[0];
    if (!spendAttributePoint(hero, wanted).spent) break;
  }
  return hero;
}

/**
 * The skill points, down the order.
 *
 * A point that cannot go where the order wants it yet — a tier that is still
 * shut, an attribute still too low — waits: the next legal entry takes it,
 * and the one that was skipped is tried again on the following point.
 */
function spendSkills(hero, build) {
  const taken = new Map();
  let guard = 0;
  while ((hero.skillPoints ?? 0) > 0 && guard < 60) {
    guard += 1;
    const next = build.spend.find((id, index) => !taken.has(index) && whyNot(hero, id) === null);
    if (next === undefined) break;
    taken.set(build.spend.findIndex((id, index) => !taken.has(index) && id === next), true);
    if (!learn(hero, next).learned) break;
  }
  return hero;
}

/**
 * Which of the build's weapons it takes down this floor.
 *
 * A hero shops for the floor they are going to, which is what every tactics
 * line in `02` tells them to do: blunt weapons for the crypt, anything but
 * slash for a Bone Warden. So the build brings the first weapon on its list
 * that the floor's boss does not turn aside, and that it can lift.
 *
 * @param {object} build
 * @param {object} hero
 * @param {number} floor
 */
export function weaponFor(build, hero, floor) {
  const id = bossOnFloor(floor);
  const guard = id ? BOSSES[id] : null;
  const resisted = new Set(guard?.resist ?? []);
  const weak = new Set(guard?.weak ?? []);
  const usable = (baseId) => {
    const needs = item(baseId).requires ?? {};
    return Object.entries(needs).every(([attribute, score]) => (hero.attributes[attribute] ?? 0) >= score);
  };

  // The biggest die it can swing, of the ones that are worth swinging: what
  // the boss is weak to first, then anything it does not resist.
  const carried = (build.weapons ?? []).filter(usable);
  const biggest = (list) =>
    [...list].sort((a, b) => sides(item(b).damage) - sides(item(a).damage))[0];

  const hurts = carried.filter((baseId) => weak.has(item(baseId).damageType));
  const through = carried.filter((baseId) => !resisted.has(item(baseId).damageType));
  return biggest(hurts) ?? biggest(through) ?? carried[0];
}

/** The size of a weapon's die, for comparing two of them. */
function sides(damage) {
  const [, count = '1', face = '4'] = /(\d*)d(\d+)/.exec(String(damage ?? '')) ?? [];
  return Number(count || 1) * Number(face);
}

/** What the Shop of this floor's tier would have sold them (`04` section 15). */
function equip(hero, build, floor, potions) {
  const kit = build.gear[shopTier(floor)] ?? build.gear[1];
  const bonus = kit.bonus ?? 0;

  const weapon = weaponFor(build, hero, floor);
  for (const [slot, baseId] of [['weapon', weapon], ['armor', kit.armor], ['offHand', kit.offHand]]) {
    if (!baseId) continue;
    // A two-handed weapon leaves no hand for a shield (`04` section 2).
    if (slot === 'offHand' && (item(weapon).properties ?? []).includes('twoHanded')) continue;
    equipNew(hero.pack, baseId, { identified: true, ...(bonus ? { bonus } : {}) });
  }

  // Potions in the quick slots, which is what Auto-Fight reaches for
  // (`06` section 17).
  const potion = shopTier(floor) >= 2 ? 'greater_healing_potion' : 'healing_potion';
  const { entry } = addItem(hero.pack, potion, { count: potions, identified: true });
  if (entry) pin(hero.pack, entry.instanceId);
  refreshGear(hero);
  return hero;
}
