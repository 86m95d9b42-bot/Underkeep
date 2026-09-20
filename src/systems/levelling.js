/**
 * Gaining experience, and what a level is worth (`01` section 5).
 *
 * ```text
 * XP to reach level L   50 x L x (L - 1), to a cap of 20
 * On each level-up      +1d6 + VIG mod hit points, never less than 2
 *                       Focus re-derived: 4 + level + INT mod + WIT mod
 *                       +1 skill point
 *                       At 4, 8, 12, 16 and 20, +1 to an attribute of choice
 * ```
 *
 * The hit point roll is the only random part, and it comes from the **loot**
 * stream: `06` section 15 awards XP and loot in the same breath at the end of
 * a fight, and both are that fight's reward. It is a carried stream, so a
 * reload cannot re-roll the level (`05` section 11).
 *
 * Levelling changes the hero in place and rebuilds their sheet, because a
 * level moves Focus, saves, the Base Attack and the effect DCs at once — and
 * then the skills are folded back on top.
 */
import { LEVELING, levelForXp, modFor, xpForLevel } from '../data/attributes.js';
import { derivedFor, hpGain } from './derived.js';
import { gearDef } from './kit.js';
import { applySkillSheet } from '../engine/skill-hooks.js';

/** The level a hero cannot climb past (`01` section 5). */
export const LEVEL_CAP = LEVELING.cap;

/** True while there is a level above this one. */
export function canLevel(hero) {
  return (hero?.level ?? 1) < LEVEL_CAP;
}

/** The XP total the hero's next level asks for, or null at the cap. */
export function xpNeeded(hero) {
  if (!canLevel(hero)) return null;
  return xpForLevel((hero.level ?? 1) + 1);
}

/**
 * Where the hero is on the way to the next level, which is what the XP bar
 * on the Hero screen shows.
 * @param {object} hero
 */
export function progress(hero) {
  const level = hero?.level ?? 1;
  const xp = hero?.xp ?? 0;
  if (!canLevel(hero)) return { level, xp, into: 0, needed: 0, share: 1 };

  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const into = Math.max(0, xp - from);
  const needed = to - from;
  return { level, xp, into, needed, share: needed > 0 ? Math.min(1, into / needed) : 1 };
}

/**
 * Rebuilds everything a level or an attribute moves, then folds the skills
 * back on. Hit points are the exception: they were rolled for, so they are
 * carried rather than recomputed (`01` section 4).
 * @param {object} hero
 */
export function rebuildSheet(hero) {
  // The hit points a hero has rolled over their levels are the base; the
  // sheet they are showing may already have a skill's bonus folded into it.
  const rolledHp = hero.baseSheet?.maxHp ?? hero.maxHp;
  // The gear is read again rather than remembered, so armour is never folded
  // into DEF twice (the same reasoning as the skill sheet's base).
  const derived = derivedFor(hero.attributes, {
    level: hero.level,
    maxHp: rolledHp,
    gear: gearDef(hero),
  });
  hero.mods = derived.mods;
  hero.maxFp = derived.maxFp;
  hero.ba = derived.ba;
  hero.attacks = derived.attacks;
  hero.atk = derived.attacks.melee;
  hero.def = derived.def;
  hero.init = derived.init;
  hero.saves = derived.saves;
  hero.slots = derived.slots;
  hero.critFrom = derived.critFrom;
  hero.maxHp = rolledHp;
  // The base has moved, so the skill sheet takes a fresh snapshot of it.
  hero.baseSheet = null;
  return applySkillSheet(hero);
}

/**
 * One level-up (`01` section 5). Returns what was gained, which is what the
 * Level Up screen shows.
 *
 * @param {object} hero
 * @param {import('../engine/rng.js').Stream} rng the loot stream
 * @returns {{ level: number, hp: number, fp: number, skillPoints: number,
 *   attributePoint: boolean }}
 */
export function levelUp(hero, rng) {
  const fpBefore = hero.maxFp;
  hero.level += 1;

  // Hit points are rolled and kept; everything else is re-derived. The roll
  // is added to the base, not to whatever a skill has raised it to.
  const hp = hpGain(hero.attributes, rng);
  if (hero.baseSheet) hero.baseSheet.maxHp += hp;
  else hero.maxHp += hp;
  hero.hp += hp;

  hero.skillPoints = (hero.skillPoints ?? 0) + LEVELING.skillPointsPerLevel;

  // "At levels 4, 8, 12, 16 and 20, gain +1 to any attribute" — the hero
  // chooses which on the Level Up screen, so it is owed until they do.
  const attributePoint = LEVELING.attributePointLevels.includes(hero.level);
  if (attributePoint) hero.attributePoints = (hero.attributePoints ?? 0) + 1;

  rebuildSheet(hero);
  // A raised maximum hands the difference over at once, as a learned skill does.
  const fp = hero.maxFp - fpBefore;
  if (fp > 0) hero.fp = Math.min(hero.maxFp, hero.fp + fp);

  // The Level Up screen draws "52 -> 57", so a gain carries the totals it
  // arrived at as well as the difference it made.
  return {
    level: hero.level,
    hp,
    fp,
    maxHp: hero.maxHp,
    maxFp: hero.maxFp,
    skillPoints: LEVELING.skillPointsPerLevel,
    attributePoint,
  };
}

/**
 * Awards experience, and levels the hero as many times as it earns
 * (`06` section 15 step 5: "leveling happens immediately").
 *
 * @param {object} hero
 * @param {number} amount
 * @param {import('../engine/rng.js').Stream} rng the loot stream
 * @returns {{ xp: number, total: number, levels: object[] }}
 */
export function awardXp(hero, amount, rng) {
  const gained = Math.max(0, Math.floor(amount || 0));
  hero.xp = (hero.xp ?? 0) + gained;

  const levels = [];
  // A single award can be worth more than one level, and each is rolled for.
  while (canLevel(hero) && hero.xp >= xpForLevel(hero.level + 1)) {
    levels.push(levelUp(hero, rng));
  }
  return { xp: gained, total: hero.xp, levels };
}

/** How many attribute points the hero has been given and not yet spent. */
export function attributePointsOwed(hero) {
  return hero?.attributePoints ?? 0;
}

/**
 * Spends one on an attribute. `01` section 5 caps an attribute at 20, which
 * is above what creation can roll.
 * @param {object} hero @param {string} attribute
 * @returns {{ spent: boolean, why?: string, score?: number }}
 */
export function spendAttributePoint(hero, attribute) {
  if (attributePointsOwed(hero) < 1) return { spent: false, why: 'noPoints' };
  const score = hero.attributes?.[attribute];
  if (score === undefined) return { spent: false, why: 'unknown' };
  if (score >= LEVELING.attributePointMax) return { spent: false, why: 'atMaximum' };

  hero.attributes[attribute] = score + 1;
  hero.attributePoints -= 1;
  rebuildSheet(hero);
  return { spent: true, score: hero.attributes[attribute] };
}

/** True when the level a total of XP has reached is above the hero's own. */
export function owesLevel(hero) {
  return levelForXp(hero?.xp ?? 0) > (hero?.level ?? 1);
}

/** What one attribute is worth to the hero right now, for the Level Up screen. */
export function previewPoint(hero, attribute) {
  const score = (hero?.attributes?.[attribute] ?? 0) + 1;
  return {
    attribute,
    score,
    mod: modFor(score),
    // A point that changes the modifier is the one worth taking.
    raisesMod: modFor(score) > modFor(score - 1),
    atMaximum: score > LEVELING.attributePointMax,
  };
}
